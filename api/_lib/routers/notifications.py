"""Notificaciones in-app del usuario logueado — la campana del topbar.

Dos bandejas detrás de la misma campana:

  Novedades   → tabla `notifications` (migración 049). Algo puntual que pasó
                ("cargaron un gasto de IT para aprobar"). La escriben otros
                módulos con `notify()` (api/_lib/services/notify.py); acá solo
                se leen y se marcan leídas.
  Pendientes  → GET /pending. NO se guardan: se calculan en vivo según los
                permisos de quien pregunta ("tenés 3 gastos para aprobar").

Como `/me` (profile.py), no lleva permiso de módulo: son las notificaciones
PROPIAS, con `require_user` (401 sin usuario, falla cerrado). El aislamiento
entre usuarios vive en el código, no en RLS (el backend usa service_role): TODA
query de este router filtra por `user_id = me`, incluido el UPDATE de marcar
leída — una ajena da 404 igual que una inexistente.

/pending sí mira permisos de módulo, pero solo para decidir qué contar: cada
ítem se calcula únicamente si el caller tiene el permiso correspondiente, y lo
que devuelve son contadores y un link, nunca filas.
"""
import logging
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from api._lib.auth import has_edit, has_view, is_superadmin_request, require_user
from api._lib.database import supabase

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/me/notifications",
    tags=["notifications"],
    dependencies=[Depends(require_user)],
)

_COLUMNS = "id, kind, title, body, entity_type, entity_id, link, read_at, created_at"
_PAGE_MAX = 100
# El contador de no leídas se calcula trayendo ids (el wrapper no expone el
# count de PostgREST). Tope para no traer miles: la campana muestra "99+".
_UNREAD_CAP = 1000
# Chunk para los `in_` sobre UUIDs: mantiene la URL de PostgREST acotada.
_IN_CHUNK = 100


def _uid(request: Request) -> str:
    user = getattr(request.state, "user", None) or {}
    uid = user.get("id")
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")
    return uid


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _unread_count(uid: str) -> int:
    rows = (
        supabase.table("notifications")
        .select("id")
        .eq("user_id", uid)
        .is_("read_at", "null")
        .limit(_UNREAD_CAP)
        .execute()
        .data
    ) or []
    return len(rows)


# ── Novedades ────────────────────────────────────────────────────────────────

@router.get("")
def list_notifications(
    request: Request,
    unread: bool = Query(False, description="Solo las no leídas"),
    limit: int = Query(20, ge=1, le=_PAGE_MAX),
    offset: int = Query(0, ge=0),
):
    uid = _uid(request)
    q = supabase.table("notifications").select(_COLUMNS).eq("user_id", uid)
    if unread:
        q = q.is_("read_at", "null")
    rows = q.order("created_at", desc=True).limit(limit + 1).offset(offset).execute().data or []
    return {
        "items": rows[:limit],
        "unread_count": _unread_count(uid),
        "has_more": len(rows) > limit,
    }


@router.post("/read-all")
def mark_all_read(request: Request):
    uid = _uid(request)
    (
        supabase.table("notifications")
        .update({"read_at": _now_iso()})
        .eq("user_id", uid)
        .is_("read_at", "null")
        .execute()
    )
    return {"ok": True, "unread_count": _unread_count(uid)}


@router.post("/{notification_id}/read")
def mark_read(notification_id: str, request: Request):
    uid = _uid(request)
    try:
        uuid.UUID(notification_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Notification not found")
    # id Y user_id en el MISMO update: una notificación ajena no matchea y da
    # 404, sin un SELECT previo que pudiera distinguir "existe pero no es tuya".
    updated = (
        supabase.table("notifications")
        .update({"read_at": _now_iso()})
        .eq("id", notification_id)
        .eq("user_id", uid)
        .execute()
        .data
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True, "unread_count": _unread_count(uid)}


# ── Pendientes (en vivo) ─────────────────────────────────────────────────────

def _approve_departments(request: Request) -> Optional[list]:
    """Departamentos donde el caller aprueba gastos. None = todos, [] = ninguno.

    `_departments_for(request, 'approve')` lo agrega la migración 048 / WP4.
    Antes de eso la acción no existe y la función cae en `can_view`: contar con
    eso le diría "tenés gastos para aprobar" a cualquiera que mire budget. Por
    eso, si las filas de budget_access no traen la columna `can_approve`, se
    trata como que no aprueba nada (el superadmin sí: aprueba con override).
    """
    try:
        from api._lib.routers.budget import _access_rows, _departments_for
        if not is_superadmin_request(request):
            rows = _access_rows(request)
            if not rows or not any("can_approve" in r for r in rows):
                return []
        return _departments_for(request, "approve")
    except Exception as exc:
        logger.warning("[notifications] approve scope unavailable: %s", exc)
        return []


def _expenses_to_approve(request: Request, uid: str) -> int:
    depts = _approve_departments(request)
    if depts is not None and not depts:
        return 0
    q = supabase.table("expenses").select("id, created_by").eq("status", "draft")
    if depts is not None:
        q = q.in_("department_code", depts)
    rows = q.execute().data or []
    # Los propios no cuentan: nadie aprueba su propio gasto.
    return sum(1 for r in rows if r.get("created_by") != uid)


def _in_process_payments() -> list:
    return (
        supabase.table("payments")
        .select("id, nominations(personnel_id, cm_approved)")
        .eq("status", "in_process")
        .execute()
        .data
    ) or []


def _tax_form_valid(banking: Optional[dict], today: str) -> bool:
    if not banking:
        return False
    kind = banking.get("tax_form_kind")
    if kind == "exempt":
        return True
    if not kind:
        return False
    expires = banking.get("tax_form_expires_at")
    return not expires or str(expires)[:10] >= today


def _payments_missing_docs(payments: list) -> Optional[int]:
    """Pagos en curso cuya persona no tiene W-8 válido.

    None si `personnel_banking` (migración 047 / WP3) todavía no existe: el ítem
    se omite en vez de reportar todos los pagos como "sin documentos".
    """
    pids = sorted({
        (p.get("nominations") or {}).get("personnel_id")
        for p in payments
        if (p.get("nominations") or {}).get("personnel_id")
    })
    banking: dict = {}
    try:
        for i in range(0, len(pids), _IN_CHUNK):
            chunk = pids[i:i + _IN_CHUNK]
            rows = (
                supabase.table("personnel_banking")
                .select("personnel_id, tax_form_kind, tax_form_expires_at")
                .in_("personnel_id", chunk)
                .execute()
                .data
            ) or []
            banking.update({r["personnel_id"]: r for r in rows})
    except Exception as exc:
        logger.warning("[notifications] personnel_banking unavailable: %s", exc)
        return None
    today = date.today().isoformat()
    return sum(
        1 for p in payments
        if not _tax_form_valid(banking.get((p.get("nominations") or {}).get("personnel_id")), today)
    )


def _recurring_pending(request: Request) -> int:
    from api._lib.routers.budget import _pending_recurring
    return len(_pending_recurring(request, date.today().strftime("%Y-%m")))


@router.get("/pending")
def pending(request: Request):
    """Contadores de lo que espera una acción del caller. Calculado, no guardado.

    Cada ítem `{key, count, link}` solo si el caller tiene el permiso que lo
    habilita y `count > 0`. Un ítem que falla se omite (con warning) sin tirar
    los demás: la campana nunca debería romper la pantalla.
    """
    uid = _uid(request)
    out = []

    def add(key: str, count: Optional[int], link: str) -> None:
        if count:
            out.append({"key": key, "count": count, "link": link})

    if has_view(request, "budget"):
        try:
            add("expenses_to_approve", _expenses_to_approve(request, uid),
                "/budget?tab=expenses&status=pending_approval")
        except Exception as exc:
            logger.warning("[notifications] expenses_to_approve failed: %s", exc)

    if has_view(request, "payments"):
        try:
            payments = _in_process_payments()
        except Exception as exc:
            logger.warning("[notifications] payments lookup failed: %s", exc)
            payments = []
        if payments:
            add("payments_missing_docs", _payments_missing_docs(payments),
                "/payments?tab=queue&missing_docs=1")
            add("payments_awaiting_cm",
                sum(1 for p in payments if (p.get("nominations") or {}).get("cm_approved") is False),
                "/payments?tab=queue&status=in_process")

    if has_edit(request, "budget"):
        try:
            add("recurring_pending", _recurring_pending(request), "/budget?tab=recurring")
        except Exception as exc:
            logger.warning("[notifications] recurring_pending failed: %s", exc)

    return out
