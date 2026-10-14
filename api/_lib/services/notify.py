"""Notificaciones in-app — escribir "novedades" en la campana de alguien.

Es el lado de ESCRITURA de `notifications` (migración 049). La lectura vive en
api/_lib/routers/notifications.py (`/api/me/notifications`).

Pensado para que lo llamen las transiciones de otros módulos (pagos, gastos):

    from api._lib.services.notify import notify, budget_approvers_for

    notify(
        budget_approvers_for(expense["department_code"]),
        "expense_submitted",
        "Gasto pendiente de aprobación",
        body=expense["description"],
        entity_type="expense", entity_id=expense["id"],
        link=f"/budget?tab=expenses&open={expense['id']}",
        exclude=_user_id(request),          # no me aviso a mí mismo
    )

**Best-effort.** Una notificación que no se pudo guardar NUNCA rompe el request
que la disparó: aprobar un gasto es lo importante, el aviso es accesorio. Todo
error se loguea como warning y se traga.

Los destinatarios son ids de auth.users. Los helpers de acá resuelven "quién
debería enterarse" a partir de los permisos; el que llama decide a quién excluir
(normalmente, al autor de la acción).
"""
import logging
from typing import Iterable, Optional

from api._lib.database import supabase

logger = logging.getLogger(__name__)

_MAX_TITLE = 300
_MAX_BODY = 2000
_MAX_LINK = 500


def _clean_ids(ids: Optional[Iterable]) -> set:
    if not ids:
        return set()
    if isinstance(ids, str):
        ids = [ids]
    return {str(i) for i in ids if i}


def notify(
    user_ids,
    kind: str,
    title: str,
    body: Optional[str] = None,
    entity_type: Optional[str] = None,
    entity_id=None,
    link: Optional[str] = None,
    exclude=None,
) -> int:
    """Inserta una novedad por destinatario, en un solo INSERT.

    `user_ids`: iterable de user_ids (o uno solo como string). Se deduplica.
    `exclude`: id o iterable de ids a sacar (típicamente el autor de la acción).
    Devuelve cuántas filas intentó insertar (0 si no había destinatarios o si
    falló). Nunca levanta.
    """
    try:
        targets = _clean_ids(user_ids) - _clean_ids(exclude)
        if not targets:
            return 0
        title = (title or kind or "").strip()[:_MAX_TITLE] or "Notification"
        rows = [
            {
                "user_id": uid,
                "kind": kind,
                "title": title,
                "body": body[:_MAX_BODY] if body else None,
                "entity_type": entity_type,
                "entity_id": str(entity_id) if entity_id is not None else None,
                "link": link[:_MAX_LINK] if link else None,
            }
            for uid in sorted(targets)
        ]
        supabase.table("notifications").insert(rows).execute()
        return len(rows)
    except Exception as exc:  # best-effort: nunca rompe el request
        logger.warning("[notify] could not insert %r notifications: %s", kind, exc)
        return 0


def _superadmins() -> set:
    rows = (
        supabase.table("user_profiles")
        .select("user_id")
        .eq("is_superadmin", True)
        .execute()
        .data
    ) or []
    return {r["user_id"] for r in rows if r.get("user_id")}


def budget_approvers_for(department_code: Optional[str]) -> set:
    """user_ids que pueden aprobar gastos de `department_code`.

    Filas de `budget_access` con `can_approve = true` para ese departamento o
    para '*' (administrador general), INTERSECTADAS con quienes pueden entrar
    al módulo: `user_permissions` de `budget` con `can_view`, o superadmin. Una
    fila de budget_access sin el permiso del módulo (se lo sacaron y quedó la
    fila) no abre la página: avisarle sería mandarlo a un 403.

    No suma superadmins que no tengan fila: aprobar gastos es un rol asignado,
    no un efecto colateral de ser admin del sistema.

    `can_approve` la crea la migración 048: si todavía no está aplicada la
    query falla y se devuelve un set vacío (con warning) en vez de romper.
    """
    if not department_code:
        return set()
    try:
        rows = (
            supabase.table("budget_access")
            .select("user_id")
            .in_("department_code", [department_code, "*"])
            .eq("can_approve", True)
            .execute()
            .data
        ) or []
        approvers = {r["user_id"] for r in rows if r.get("user_id")}
        if not approvers:
            return set()
        perms = (
            supabase.table("user_permissions")
            .select("user_id")
            .eq("module", "budget")
            .eq("can_view", True)
            .in_("user_id", sorted(approvers))
            .execute()
            .data
        ) or []
        allowed = {r["user_id"] for r in perms if r.get("user_id")}
        if approvers - allowed:
            allowed |= _superadmins() & approvers
    except Exception as exc:
        logger.warning("[notify] budget_approvers_for(%s) failed: %s", department_code, exc)
        return set()
    return approvers & allowed


def module_editors(module: str) -> set:
    """user_ids con `can_edit` sobre `module`, más todos los superadmins.

    Superadmin pasa cualquier `require_edit`, así que también puede actuar
    sobre lo que se notifica. Best-effort: si una de las dos lecturas falla se
    devuelve lo que se haya podido resolver.
    """
    out: set = set()
    try:
        rows = (
            supabase.table("user_permissions")
            .select("user_id")
            .eq("module", module)
            .eq("can_edit", True)
            .execute()
            .data
        ) or []
        out |= {r["user_id"] for r in rows if r.get("user_id")}
    except Exception as exc:
        logger.warning("[notify] module_editors(%s) failed: %s", module, exc)
    try:
        out |= _superadmins()
    except Exception as exc:
        logger.warning("[notify] superadmin lookup failed: %s", exc)
    return out
