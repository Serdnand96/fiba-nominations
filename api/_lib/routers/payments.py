"""Payments module — payments to event personnel, anchored to nominations.

Each payment hangs off a nomination (the person nominated to a competition),
picks the budget it comes out of, adds an optional extra + comments, carries a
status the finance team advances, and can have financial-control files
attached (EXPENSES / W8 / BANK_INFO / INVOICE / RECEIPT / OTHER).

Sensitive data (amounts, bank confirmations, W8 docs) lives here, so the
tables are backend-only (RLS on, no policies) and this router is gated by the
`payments` module permission — view separate from edit.

Cada pago se imputa además al presupuesto (`department_code` / `account_code`,
migración 036) para que cuente como ejecutado en `/budget/summary`. Esas dos
columnas se derivan acá — ver `_budget_dimensions()` — y no se piden en el
formulario.

Pipeline (migración 047):

- **El `status` no se edita por PUT.** Solo cambia por
  `POST /payments/{id}/transition` (o `/bulk-status`), que pasa por la función
  pura `check_payment_transition()` y deja traza con `record_transition()` en
  `finance_status_history`. Un PUT con `status` es 400.
- **Completar es soltar la plata** y pide el permiso no-página
  `payments_approve` (precedente: `comp_days`), que lo complete alguien
  distinto de quien creó el pago y de quien tocó sus montos por última vez
  (`last_financial_edit_by`, migración 050; superadmin puede, con motivo, y
  queda `meta.override` en el historial), fecha de pago, aprobación del CM,
  formulario fiscal vigente y datos bancarios. Un `completed` está pagado
  entero: `paid_amount == total`.
- **Pago parcial** = `POST /payments/{id}/record-partial` sobre un
  `in_process`, con los mismos sellos que completar. `paid_amount` no se edita
  por PUT.
- **Ficha bancaria por persona** (`personnel_banking`): vive bajo
  `/payments/personnel/{id}/banking` y en NINGÚN otro router — quien tiene
  `personnel` sin `payments` no la ve. El GET enmascara; `POST …/reveal` muestra
  los números completos y es POST a propósito para que el middleware de
  activity_log lo audite.
"""
import logging
import os
import re
import unicodedata
import uuid
from datetime import date, datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, Depends, UploadFile, File, Form
from fastapi.responses import Response

from api._lib.database import supabase
from api._lib.auth import require_view, require_edit, has_view, is_superadmin_request
from api._lib.finance_years import payment_status_year
from api._lib.schemas import (
    PaymentBulkCreate,
    PaymentBulkStatus,
    PaymentCreate,
    PaymentRecordPartial,
    PaymentSyncAmount,
    PaymentTransition,
    PaymentUpdate,
    PersonnelBankingPut,
)
from api._lib.budget_accounts import account_for_role
from api._lib.services.finance_history import history_for, record_transition
from api._lib.services.notify import module_editors, notify

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payments", tags=["payments"], dependencies=[Depends(require_view("payments"))])

_BUCKET = "nominations"
_ATTACH_PREFIX = "payments"
_BANKING_PREFIX = "banking"
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
_ALLOWED_CONTENT = ("application/pdf", "image/")
_SAFE_FILENAME_RE = re.compile(r"[^\w\s\-\.\(\)]")
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_IN_CHUNK = 200  # ids por `in.(…)`: la URL de PostgREST tiene un largo máximo

# Permiso no-página que habilita `in_process → completed` (migración 047).
APPROVE_MODULE = "payments_approve"

PAYMENT_STATUSES = ("new", "in_process", "completed", "cancelled")
OPEN_STATUSES = ("new", "in_process")
ATTACHMENT_KINDS = ("EXPENSES", "W8", "BANK_INFO", "INVOICE", "RECEIPT", "OTHER")
TAX_FORM_KINDS = ("W-8BEN", "W-8BEN-E", "W-9", "exempt")

# Columnas NOT NULL que un PUT puede cambiar pero nunca vaciar. Mismo criterio
# que _REQUIRED_ON_UPDATE en budget.py: con exclude_unset un null mandado a
# propósito llega hasta acá, y sobre estas columnas sería un 500 de Postgres.
_PAYMENT_NOT_NULL = {"budget_code", "amount", "extra", "airfare"}

# Lo único que se puede tocar de un pago ya completado: la plata salió, así que
# monto, budget, fecha y lo pagado quedan congelados. Para corregirlos hay que
# reabrirlo (completed → in_process, solo superadmin y con motivo).
_COMPLETED_EDITABLE = {"comments", "bank_confirmation"}

# Lo que sella `last_financial_edit_by` (migración 050) y deja `meta.edit` en el
# historial: quien cambió cuánto se paga o de qué budget sale no completa el
# pago ni registra un parcial.
_FINANCIAL_FIELDS = ("amount", "extra", "airfare", "budget_code")

# Embed completo de un pago: todo lo que hace falta para la máquina de estados
# (estado y CM de la nominación), la cola (año, competencia) y las
# notificaciones (record_no, nombre, evento) en UNA sola query.
_PAYMENT_SELECT = (
    "*, nominations(id, competition_id, personnel_id, total, status, "
    "confirmation_status, cm_approved, personnel(name, role, country), "
    "competitions(name, year, start_date))"
)

_BANKING_FIELDS = (
    "payment_method", "bank_name", "bank_address", "account_holder",
    "account_number", "routing_number", "swift", "iban", "currency", "notes",
    "tax_form_kind", "tax_form_signed_at", "tax_form_expires_at",
)
# Los que el GET enmascara. SWIFT y nombre del banco no: son públicos por
# naturaleza y sin ellos la ficha no sirve para reconocer de qué banco se trata.
_MASKED_FIELDS = ("account_number", "routing_number", "iban")


def _user_id(request: Request) -> Optional[str]:
    user = getattr(request.state, "user", None)
    if isinstance(user, dict):
        return user.get("id")
    return None


def _user_email(request: Request) -> Optional[str]:
    user = getattr(request.state, "user", None)
    if isinstance(user, dict):
        return user.get("email")
    return None


def _same_user(a, b) -> bool:
    """Mismo usuario, sin que dos None cuenten como "el mismo"."""
    return bool(a and b and str(a) == str(b))


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_uuid(value) -> bool:
    return isinstance(value, str) and bool(_UUID_RE.match(value))


def _chunks(values: list, size: int = _IN_CHUNK):
    for i in range(0, len(values), size):
        yield values[i:i + size]


def _num(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _parse_date(value) -> Optional[date]:
    """date desde 'YYYY-MM-DD' (o el prefijo de un timestamptz). None si no hay.

    Levanta ValueError si viene algo que no es una fecha: el que llama decide
    si eso es un 400 (input del usuario) o se ignora (dato viejo de la base).
    """
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _date_or_400(value, field: str) -> Optional[str]:
    try:
        parsed = _parse_date(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field} must be a date (YYYY-MM-DD)")
    return parsed.isoformat() if parsed else None


def _budget_row(code: str, include_inactive: bool = False) -> Optional[dict]:
    """Fila del catálogo `payment_budgets`, o None si el código no existe.

    Por defecto solo las activas: es lo que se valida al ELEGIR un budget (alta
    o cambio). `include_inactive=True` es para derivar la imputación de un pago
    que ya estaba en ese budget: desactivar un budget lo saca del desplegable,
    no puede dejar sus pagos viejos sin poder editarse ni sin departamento.
    """
    q = (
        supabase.table("payment_budgets")
        .select("code, department_code")
        .eq("code", code)
    )
    if not include_inactive:
        q = q.eq("active", True)
    rows = q.execute().data
    return rows[0] if rows else None


# ─── Imputación al presupuesto (módulo Budget) ───────────────────────────────
#
# `payments.department_code` / `account_code` (migración 036) son lo que hace
# que un pago cuente como ejecutado en `/budget/summary`. Esa migración
# clasificó los pagos que ya existían; acá se aplica el MISMO criterio en el
# write path, para que un pago nuevo no nazca sin imputar y termine en
# `unallocated_payments`.
#
# Ninguno de los dos mapeos vive en este archivo, a propósito:
#   - departamento → columna `payment_budgets.department_code` (migración 041).
#     Es dato: agregar un budget obliga a decir de qué departamento sale.
#   - cuenta       → `api/_lib/budget_accounts.py`, compartido con el read path
#     de budget.py, que usa el mismo mapa para imputar el pasaje a travel.


def _budget_dimensions(budget: Optional[dict], role: Optional[str]) -> dict:
    """Departamento y cuenta de un pago. Devuelve las dos claves siempre.

    Un budget sin departamento o un rol sin cuenta dan `None` a propósito: el
    summary de budget lo reporta aparte como *sin imputar* en vez de esconderlo
    en el total de un área que no le corresponde. Pero deja rastro en el log:
    sin eso, el agujero se abre en silencio y recién se nota cuando alguien
    mira por qué el ámbar del dashboard creció.

    En el alta las claves en `None` se descartan junto con el resto; en la
    edición se escriben, porque cambiar el presupuesto de un pago tiene que
    poder despintar la imputación vieja.
    """
    department = (budget or {}).get("department_code")
    account = account_for_role(role)
    if budget and not department:
        logger.warning(
            "[budget] payment_budgets.%s no tiene department_code: el pago queda "
            "sin imputar (ver migración 041)", budget.get("code"),
        )
    if role and not account:
        logger.warning(
            "[budget] el rol %s no tiene cuenta mapeada: el pago queda sin "
            "imputar (ver api/_lib/budget_accounts.py)", role,
        )
    return {"department_code": department, "account_code": account}


def _nomination_role(nomination_id: str) -> Optional[str]:
    """Rol (TD / VGO / REF / …) de la persona nominada."""
    rows = (
        supabase.table("nominations")
        .select("personnel(role)")
        .eq("id", nomination_id)
        .execute()
        .data
    )
    return ((rows[0] if rows else {}).get("personnel") or {}).get("role")


# ─── Storage helpers (private bucket) ────────────────────────────────────────
def _extract_storage_key(storage_path: Optional[str]) -> Optional[str]:
    """Object key inside the `nominations` bucket for any supported path format."""
    if not storage_path:
        return None
    if storage_path.startswith(f"storage://{_BUCKET}/"):
        return storage_path[len(f"storage://{_BUCKET}/"):]
    if f"/storage/v1/object/public/{_BUCKET}/" in storage_path:
        return storage_path.split(f"/storage/v1/object/public/{_BUCKET}/", 1)[1]
    if f"/storage/v1/object/{_BUCKET}/" in storage_path:
        return storage_path.split(f"/storage/v1/object/{_BUCKET}/", 1)[1]
    return None


def _delete_from_storage(storage_path: Optional[str]) -> None:
    """Best-effort removal of an attachment object."""
    key = _extract_storage_key(storage_path)
    if not key:
        return
    try:
        supabase.storage.from_(_BUCKET).remove([key])
    except Exception as e:
        logger.warning(f"[storage cleanup] could not remove {key}: {e}")


def _stream_private(storage_path: Optional[str], filename: str) -> Response:
    """Sirve un objeto del bucket privado como descarga autenticada.

    El bucket `nominations` es privado: nunca se arma una URL pública, se baja
    con el service_role y se devuelve como blob (el frontend manda el JWT).
    """
    key = _extract_storage_key(storage_path)
    if not key:
        raise HTTPException(status_code=404, detail="File not available")
    filename = _SAFE_FILENAME_RE.sub("", filename or "").strip() or "attachment"

    supabase_url = os.environ.get("SUPABASE_URL", "")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or os.environ.get("SUPABASE_KEY", "")
    object_url = f"{supabase_url}/storage/v1/object/{_BUCKET}/{key}"
    try:
        headers = {"Authorization": f"Bearer {supabase_key}", "apikey": supabase_key}
        resp = httpx.get(object_url, headers=headers, timeout=30.0, follow_redirects=True)
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail="File not available")
        return Response(
            content=resp.content,
            media_type=resp.headers.get("content-type", "application/octet-stream"),
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Cache-Control": "private, no-store",
            },
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Storage fetch failed")


def _normalize_attachment_kind(kind: Optional[str]) -> str:
    """Lleva cualquier etiqueta a una de ATTACHMENT_KINDS (CHECK de la 047).

    Mismo criterio que el UPDATE de la migración: un cliente viejo que manda
    "BANK INFO" o "w-8" no rompe contra el CHECK; lo que no se reconoce es OTHER.
    """
    compact = re.sub(r"[^A-Za-z0-9]", "", kind or "").upper()
    return {
        "W8": "W8", "W8BEN": "W8", "W8BENE": "W8",
        "BANKINFO": "BANK_INFO", "BANK": "BANK_INFO",
        "EXPENSES": "EXPENSES", "EXPENSE": "EXPENSES",
        "INVOICE": "INVOICE", "RECEIPT": "RECEIPT",
    }.get(compact, "OTHER")


# ─── Reglas puras (sin I/O — testeables sin base) ────────────────────────────
def tax_form_expiry(banking: Optional[dict]) -> Optional[date]:
    """Vencimiento efectivo del formulario fiscal, o None si no vence/no se sabe.

    Si no se cargó `tax_form_expires_at` y es un W-8, se deriva de la firma: un
    W-8BEN vale hasta el 31/12 del tercer año calendario posterior a la firma
    (regla del IRS). El W-9 no vence.
    """
    if not banking:
        return None
    try:
        explicit = _parse_date(banking.get("tax_form_expires_at"))
    except ValueError:
        explicit = None
    if explicit:
        return explicit
    if str(banking.get("tax_form_kind") or "").startswith("W-8"):
        try:
            signed = _parse_date(banking.get("tax_form_signed_at"))
        except ValueError:
            signed = None
        if signed:
            return date(signed.year + 3, 12, 31)
    return None


def tax_form_status(banking: Optional[dict], today: Optional[date] = None) -> str:
    """`ok` | `missing` | `expired` | `exempt`. Pura.

    `missing` incluye "eligió W-8BEN pero no subió el PDF": lo que habilita a
    pagar es el documento firmado, no haber tildado un tipo. `exempt` lo decide
    Finance a mano (no corresponde formulario) y no lleva archivo.
    """
    if not banking:
        return "missing"
    kind = banking.get("tax_form_kind")
    if kind == "exempt":
        return "exempt"
    if not kind or not banking.get("tax_form_path"):
        return "missing"
    expires = tax_form_expiry(banking)
    if expires and expires < (today or date.today()):
        return "expired"
    return "ok"


def has_bank_info(banking: Optional[dict]) -> bool:
    """¿Hay a dónde transferir? Número de cuenta o IBAN; lo demás es accesorio."""
    return bool(banking and ((banking.get("account_number") or "").strip()
                             or (banking.get("iban") or "").strip()))


def mask_value(value: Optional[str]) -> Optional[str]:
    """`****` + últimos 4. Un valor de 4 o menos caracteres no se muestra."""
    if not value:
        return value
    compact = re.sub(r"\s+", "", str(value))
    return "****" + compact[-4:] if len(compact) > 4 else "****"


# Transiciones válidas. Todo lo que no está acá es 409.
_TRANSITIONS = {
    ("new", "in_process"),
    ("in_process", "completed"),
    ("in_process", "new"),
    ("new", "cancelled"),
    ("in_process", "cancelled"),
    ("cancelled", "new"),
    ("completed", "in_process"),
}


def payment_total(payment: dict) -> float:
    """amount + extra (= la columna generada `total`, que puede no venir)."""
    if payment.get("total") is not None:
        return round(_num(payment.get("total")), 2)
    return round(_num(payment.get("amount")) + _num(payment.get("extra")), 2)


def check_payment_transition(
    payment: dict,
    nomination: Optional[dict],
    banking: Optional[dict],
    target: str,
    payload: Optional[dict],
    *,
    user_id: Optional[str],
    has_approve: bool,
    is_superadmin: bool,
    today: Optional[date] = None,
    now: Optional[datetime] = None,
) -> dict:
    """Valida `payment.status → target` y arma lo que hay que escribir. Pura.

    Devuelve `{"updates": {...}, "warnings": [...], "meta": {...},
    "tax_form_status": "..."}` o levanta HTTPException:
      - 400 → falta un dato que el usuario puede mandar (fecha, motivo, monto).
      - 403 → no le corresponde a este usuario (permiso, separación de funciones).
      - 409 → el estado o una regla de negocio no lo permite.

    `updates` es lo que se escribe en `payments` (incluye `status`). `meta` va
    al historial (`override`, fecha, monto pagado). `warnings` no bloquean.

    Tabla (la misma de BUDGET_MODULE.md / el plan WP3):

      new → in_process        nominación `generated` y no `declined`. Sin W-8
                              vigente avisa (`tax_form_missing|expired`), no
                              bloquea: todavía hay tiempo de pedirlo.
      in_process → completed  `payments_approve` (o superadmin); no lo completa
                              quien lo creó ni quien editó sus montos
                              (superadmin sí, con `reason` → meta.override);
                              `payment_date`; no declinada; CM aprobó; W-8
                              `ok` o `exempt`; datos bancarios. `paid_amount`
                              = total siempre (otro valor → 400).
      in_process → new        sin plata pagada (paid_amount 0/NULL).

    El pago parcial no es una transición: es check_partial_payment().
      new|in_process → cancelled   `reason`; sin plata pagada.
      cancelled → new         limpia los sellos de cancelación.
      completed → in_process  solo superadmin, con `reason`; limpia completed_*.
    """
    payload = payload or {}
    nomination = nomination or {}
    current = payment.get("status")

    if target not in PAYMENT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status: {target}")
    if target == current:
        raise HTTPException(status_code=409, detail=f"Payment is already {current}")
    if (current, target) not in _TRANSITIONS:
        raise HTTPException(status_code=409, detail=f"Cannot move a payment from {current} to {target}")

    reason = (payload.get("reason") or "").strip() or None
    stamp = (now or datetime.now(timezone.utc)).isoformat()
    tf_status = tax_form_status(banking, today)
    paid_so_far = _num(payment.get("paid_amount"))
    updates: dict = {"status": target}
    warnings: list = []
    meta: dict = {}

    if current == "new" and target == "in_process":
        if nomination.get("status") != "generated":
            raise HTTPException(
                status_code=409,
                detail="The nomination letter has not been generated yet",
            )
        if nomination.get("confirmation_status") == "declined":
            raise HTTPException(status_code=409, detail="The nominee declined this nomination")
        if tf_status in ("missing", "expired"):
            warnings.append(f"tax_form_{tf_status}")

    elif target == "completed":
        # 1-2. Permiso y separación de funciones (compartido con el parcial).
        override = _release_override(payment, user_id=user_id, has_approve=has_approve,
                                     is_superadmin=is_superadmin, reason=reason)
        if override:
            meta["override"] = override
        # 3. Datos.
        payment_date = _date_or_400(payload.get("payment_date"), "payment_date")
        if not payment_date:
            try:
                existing = _parse_date(payment.get("payment_date"))
            except ValueError:
                existing = None
            payment_date = existing.isoformat() if existing else None
        if not payment_date:
            raise HTTPException(status_code=400, detail="payment_date is required to complete a payment")
        # Invariante: completed ⇒ paid_amount == total. Un completado "parcial"
        # contaba entero como ejecutado en budget y escondía lo que faltaba.
        total = payment_total(payment)
        sent = payload.get("paid_amount")
        if sent is not None and abs(round(_num(sent), 2) - total) > 0.005:
            raise HTTPException(
                status_code=400,
                detail=f"A completed payment is paid in full ({total:.2f}): if less was paid, "
                       "adjust amount/extra while in process before completing it",
            )
        paid = total
        # 4. Reglas de negocio.
        _assert_payable(nomination, banking, tf_status)
        updates.update({
            "payment_date": payment_date,
            "paid_amount": paid,
            "completed_by": user_id,
            "completed_at": stamp,
        })
        if payload.get("bank_confirmation") is not None:
            updates["bank_confirmation"] = str(payload["bank_confirmation"]).strip() or None
        meta.update({"payment_date": payment_date, "paid_amount": paid})

    elif current == "in_process" and target == "new":
        # Volver a `new` con plata ya pagada la haría desaparecer del ejecutado
        # (budget solo lee paid_amount en in_process). Con plata pagada la
        # salida es ajustar amount/extra a lo pagado y completar.
        if paid_so_far > 0:
            raise HTTPException(
                status_code=409,
                detail="This payment is partially paid: it can't move back to new "
                       "(adjust amount/extra to what was paid and complete it)",
            )

    elif target == "cancelled":
        if not reason:
            raise HTTPException(status_code=400, detail="reason is required to cancel a payment")
        # Mismo motivo que arriba: un cancelado no cuenta en budget, y si ya
        # salió plata eso escondería un gasto real.
        if paid_so_far > 0:
            raise HTTPException(
                status_code=409,
                detail="This payment is partially paid: it can't be cancelled "
                       "(adjust amount/extra to what was paid and complete it)",
            )
        updates.update({"cancelled_by": user_id, "cancelled_at": stamp, "cancel_reason": reason})

    elif current == "cancelled" and target == "new":
        updates.update({"cancelled_by": None, "cancelled_at": None, "cancel_reason": None})

    elif current == "completed" and target == "in_process":
        if not is_superadmin:
            raise HTTPException(status_code=403, detail="Only a superadmin can reopen a completed payment")
        if not reason:
            raise HTTPException(status_code=400, detail="reason is required to reopen a completed payment")
        # payment_date y paid_amount quedan: la plata salió y, como in_process
        # con paid_amount, budget la sigue contando como ejecutada mientras se
        # corrige lo que haya que corregir.
        updates.update({"completed_by": None, "completed_at": None})

    return {"updates": updates, "warnings": warnings, "meta": meta, "tax_form_status": tf_status}


def _release_override(payment: dict, *, user_id: Optional[str], has_approve: bool,
                      is_superadmin: bool, reason: Optional[str]) -> Optional[str]:
    """Permiso + separación de funciones para soltar plata. Pura.

    Lo comparten completar y registrar un parcial: los dos mueven plata real.
    Devuelve el `meta.override` a dejar en el historial (o None) y levanta:
      - 403 sin `payments_approve` (ni superadmin);
      - 403 si el caller creó el pago (`self_completion`) o fue el último en
        cambiar sus montos (`edited_then_approved`, migración 050) — si no,
        bastaba con editar el pago de otro y completarlo;
      - 400 si es superadmin en ese caso y no mandó `reason`.
    """
    # El require_edit("payments") del endpoint ya pasó; esto es el segundo
    # sello: soltar la plata es de otro rol.
    if not (has_approve or is_superadmin):
        raise HTTPException(status_code=403, detail=f"Missing {APPROVE_MODULE} permission")
    override = None
    if _same_user(payment.get("created_by"), user_id):
        override = "self_completion"
    elif _same_user(payment.get("last_financial_edit_by"), user_id):
        override = "edited_then_approved"
    if not override:
        return None
    # En la práctica Finance es una persona, así que el superadmin puede
    # saltearla, pero con motivo y queda marcado: el control es la traza.
    if not is_superadmin:
        raise HTTPException(
            status_code=403,
            detail=("You created this payment: someone else has to release it"
                    if override == "self_completion" else
                    "You changed the amounts of this payment: someone else has to release it"),
        )
    if not reason:
        raise HTTPException(
            status_code=400,
            detail="reason is required to release a payment you created or edited",
        )
    return override


def _assert_payable(nomination: dict, banking: Optional[dict], tf_status: str) -> None:
    """Reglas de negocio para que salga plata (completo o parcial). 409."""
    if nomination.get("confirmation_status") == "declined":
        raise HTTPException(status_code=409, detail="The nominee declined this nomination")
    if not nomination.get("cm_approved"):
        raise HTTPException(
            status_code=409,
            detail="The Competition Manager has not approved this nomination",
        )
    if tf_status not in ("ok", "exempt"):
        raise HTTPException(
            status_code=409,
            detail=f"Tax form {tf_status}: upload a valid W-8/W-9 before paying",
        )
    if not has_bank_info(banking):
        raise HTTPException(
            status_code=409,
            detail="No bank account on file (account number or IBAN): there is nowhere to transfer to",
        )


def check_partial_payment(
    payment: dict,
    nomination: Optional[dict],
    banking: Optional[dict],
    paid_amount,
    payload: Optional[dict] = None,
    *,
    user_id: Optional[str],
    has_approve: bool,
    is_superadmin: bool,
    today: Optional[date] = None,
) -> dict:
    """Valida registrar un pago parcial (POST /{id}/record-partial). Pura.

    `paid_amount` es el TOTAL pagado a la fecha (absoluto: reemplaza al
    anterior, no se suma). Exige lo mismo que completar —`payments_approve`,
    separación de funciones, CM, W-8, datos bancarios, no declinada— porque
    también es plata que sale; y `0 <= paid_amount < total`: el total entero es
    completar (/transition). Cero solo con `reason`: es la forma de deshacer un
    parcial cargado por error (no hay otra, PUT ya no acepta paid_amount).

    Devuelve `{"updates": {"paid_amount": x}, "meta": {"paid_amount": x,
    "previous": y[, "override": …]}, "warnings": [], "tax_form_status": …}` o
    levanta 400 / 403 / 409 con el mismo criterio que check_payment_transition.
    """
    payload = payload or {}
    nomination = nomination or {}
    if payment.get("status") != "in_process":
        raise HTTPException(
            status_code=409,
            detail="A partial payment can only be recorded on a payment in process",
        )
    reason = (payload.get("reason") or "").strip() or None
    override = _release_override(payment, user_id=user_id, has_approve=has_approve,
                                 is_superadmin=is_superadmin, reason=reason)
    if paid_amount is None:
        raise HTTPException(status_code=400, detail="paid_amount is required")
    total = payment_total(payment)
    paid = round(_num(paid_amount), 2)
    if abs(paid - total) <= 0.005:
        raise HTTPException(
            status_code=400,
            detail="paid_amount equals the payment total: use the completed transition instead",
        )
    if paid < 0 or paid > total:
        raise HTTPException(
            status_code=400,
            detail=f"paid_amount must be between 0 and the payment total ({total:.2f})",
        )
    if paid == 0 and not reason:
        # Volver a cero deshace un parcial: queda en el historial con el porqué.
        raise HTTPException(status_code=400, detail="reason is required to reset paid_amount to 0")
    tf_status = tax_form_status(banking, today)
    _assert_payable(nomination, banking, tf_status)
    meta: dict = {"paid_amount": paid, "previous": round(_num(payment.get("paid_amount")), 2)}
    if override:
        meta["override"] = override
    return {"updates": {"paid_amount": paid}, "meta": meta, "warnings": [], "tax_form_status": tf_status}


# ─── Lecturas compartidas ────────────────────────────────────────────────────
def _load_payments(ids: list) -> dict:
    """{id: fila con el embed completo} para una lista de ids (en lotes)."""
    ids = [i for i in dict.fromkeys(ids) if _is_uuid(i)]
    out: dict = {}
    for chunk in _chunks(ids):
        rows = supabase.table("payments").select(_PAYMENT_SELECT).in_("id", chunk).execute().data or []
        out.update({r["id"]: r for r in rows})
    return out


def _load_payment(payment_id: str) -> dict:
    if not _is_uuid(payment_id):
        raise HTTPException(status_code=404, detail="Payment not found")
    rows = supabase.table("payments").select(_PAYMENT_SELECT).eq("id", payment_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Payment not found")
    return rows[0]


def _banking_map(personnel_ids) -> dict:
    """{personnel_id: fila de personnel_banking}. Un `in_` por lote, sin N+1."""
    pids = sorted({p for p in personnel_ids if p})
    out: dict = {}
    for chunk in _chunks(pids):
        rows = (
            supabase.table("personnel_banking").select("*").in_("personnel_id", chunk).execute().data
        ) or []
        out.update({r["personnel_id"]: r for r in rows})
    return out


def _banking_row(personnel_id: Optional[str]) -> Optional[dict]:
    if not personnel_id:
        return None
    rows = supabase.table("personnel_banking").select("*").eq("personnel_id", personnel_id).execute().data
    return rows[0] if rows else None


def _personnel_id_of(row: dict) -> Optional[str]:
    return (row.get("nominations") or {}).get("personnel_id")


# ─── Serialization ───────────────────────────────────────────────────────────
def _shape_payment(row: dict) -> dict:
    """Flatten the nested nomination → personnel/competition into flat fields."""
    nom = row.pop("nominations", None) or {}
    person = nom.get("personnel") or {}
    comp = nom.get("competitions") or {}
    row["nominee_name"] = person.get("name")
    row["nominee_role"] = person.get("role")
    row["nominee_country"] = person.get("country")
    row["personnel_id"] = nom.get("personnel_id")
    row["competition_id"] = nom.get("competition_id")
    row["competition_name"] = comp.get("name")
    row["competition_year"] = comp.get("year")
    row["competition_start_date"] = comp.get("start_date")
    row["nomination_total"] = nom.get("total")
    row["nomination_status"] = nom.get("status")
    row["confirmation_status"] = nom.get("confirmation_status")
    row["cm_approved"] = nom.get("cm_approved")
    return row


def _queue_item(row: dict, banking: Optional[dict], today: date) -> dict:
    """Un pago tal como lo consume la cola y el drawer: plano y con badges."""
    # El año sale ANTES de aplanar (lee el embed) y con el mismo criterio que
    # `by_status` del dashboard (api/_lib/finance_years.py): filtrar la cola por
    # 2027 lista exactamente los pagos que el desglose cuenta en 2027.
    fiscal_year = payment_status_year(row)
    item = _shape_payment(row)
    status = item.get("status")
    nom_total = item.get("nomination_total")
    item["fiscal_year"] = fiscal_year
    # Drift monto ↔ nominación: se MUESTRA, no se sincroniza solo (la
    # nominación puede cambiar después de cargado el pago). Solo importa
    # mientras el pago está abierto: en un completado es historia.
    item["stale_amount"] = bool(
        status in OPEN_STATUSES and nom_total is not None
        and abs(_num(item.get("amount")) - _num(nom_total)) > 0.005
    )
    item["is_partial"] = status == "in_process" and _num(item.get("paid_amount")) > 0
    item["tax_form_status"] = tax_form_status(banking, today)
    item["has_bank_info"] = has_bank_info(banking)
    return item


def _fold(text) -> str:
    """Minúsculas sin acentos, para que 'Pérez' matchee 'perez'."""
    text = unicodedata.normalize("NFKD", str(text or "")).lower()
    return "".join(c for c in text if not unicodedata.combining(c))


def _queue(
    *,
    status: Optional[str],
    budget: Optional[str],
    year: Optional[int],
    competition_id: Optional[str],
    missing_docs: bool,
    stale: bool,
    search: Optional[str],
    cm_pending: bool = False,
) -> list:
    """Cola filtrada y ordenada, sin paginar. La comparten /queue y el export.

    `status` y `budget` van a la base — un filtro por columna: el query builder
    guarda un valor por clave y encadenar dos sobre la misma pisa el primero en
    silencio. Lo demás depende del embed o de `personnel_banking` y se filtra en
    Python.
    """
    q = supabase.table("payments").select(_PAYMENT_SELECT).order("record_no", desc=True)
    if status:
        wanted = [s.strip() for s in status.split(",") if s.strip()]
        bad = [s for s in wanted if s not in PAYMENT_STATUSES]
        if bad or not wanted:
            raise HTTPException(status_code=400, detail=f"Invalid status: {', '.join(bad) or status}")
        q = q.eq("status", wanted[0]) if len(wanted) == 1 else q.in_("status", wanted)
    if budget:
        q = q.eq("budget_code", budget)
    rows = q.execute().data or []

    if competition_id:
        rows = [r for r in rows if (r.get("nominations") or {}).get("competition_id") == competition_id]

    banking = _banking_map(_personnel_id_of(r) for r in rows)
    today = date.today()
    items = [_queue_item(r, banking.get(_personnel_id_of(r)), today) for r in rows]

    if year:
        items = [i for i in items if i["fiscal_year"] == year]
    if missing_docs:
        # "Faltan docs" = no se va a poder completar por papeles: formulario
        # fiscal no vigente o sin a dónde transferir.
        items = [i for i in items
                 if i["tax_form_status"] not in ("ok", "exempt") or not i["has_bank_info"]]
    if stale:
        items = [i for i in items if i["stale_amount"]]
    if cm_pending:
        # Mismo criterio que el contador `payments_awaiting_cm` de la campana
        # (notifications.py): la nominación dice explícitamente que el CM no
        # aprobó. `cm_approved` es NOT NULL (027); un None es un pago sin
        # nominación embebida y no se cuenta.
        items = [i for i in items if i.get("cm_approved") is False]
    needle = _fold(search).strip() if search else ""
    if needle:
        def _hay(i: dict) -> str:
            return _fold(" ".join(str(i.get(k) or "") for k in (
                "record_no", "nominee_name", "competition_name", "budget_code",
                "bank_confirmation", "comments", "nominee_country",
            )))
        items = [i for i in items if needle in _hay(i)]
    return items


def _queue_totals(items: list) -> dict:
    by_status: dict = {}
    for i in items:
        entry = by_status.setdefault(i.get("status"), {"count": 0, "total": 0.0})
        entry["count"] += 1
        entry["total"] += _num(i.get("total"))
    for entry in by_status.values():
        entry["total"] = round(entry["total"], 2)
    return {
        "count": len(items),
        "amount": round(sum(_num(i.get("amount")) for i in items), 2),
        "extra": round(sum(_num(i.get("extra")) for i in items), 2),
        "total": round(sum(_num(i.get("total")) for i in items), 2),
        "airfare": round(sum(_num(i.get("airfare")) for i in items), 2),
        "paid_amount": round(sum(_num(i.get("paid_amount")) for i in items), 2),
        "by_status": by_status,
    }


# ─── Budgets catalogue ───────────────────────────────────────────────────────
@router.get("/budgets")
def list_budgets():
    return (
        supabase.table("payment_budgets")
        .select("*")
        .eq("active", True)
        .order("sort")
        .execute()
        .data
    ) or []


# ─── Nominees for an event (main view: event → nominated people → payment) ───
@router.get("/nominees")
def list_nominees(competition_id: str = Query(...)):
    noms = (
        supabase.table("nominations")
        .select("id, competition_id, personnel_id, total, window_fee, incidentals, status, "
                "confirmation_status, cm_approved, personnel(name, role, country)")
        .eq("competition_id", competition_id)
        .execute()
        .data
    ) or []

    pays = (
        supabase.table("payments")
        .select("*")
        .in_("nomination_id", [n["id"] for n in noms] or ["-"])
        .execute()
        .data
    ) or []
    by_nom = {p["nomination_id"]: p for p in pays}

    out = []
    for n in noms:
        person = n.get("personnel") or {}
        out.append({
            "nomination_id": n["id"],
            "personnel_id": n.get("personnel_id"),
            "nominee_name": person.get("name"),
            "nominee_role": person.get("role"),
            "nominee_country": person.get("country"),
            "nomination_total": n.get("total"),
            "nomination_status": n.get("status"),
            "confirmation_status": n.get("confirmation_status"),
            "cm_approved": n.get("cm_approved"),
            "payment": by_nom.get(n["id"]),
        })
    out.sort(key=lambda r: (r["nominee_name"] or "").lower())
    return out


# ─── Payments list ───────────────────────────────────────────────────────────
def _fetch_payments(
    competition_id: Optional[str] = None,
    budget: Optional[str] = None,
    status: Optional[str] = None,
) -> list:
    # Shared by the endpoints below. Endpoints must not call each other as plain
    # functions: FastAPI Query() defaults leak through as truthy objects and
    # become bogus filters (that bug kept /summary at $0.00).
    q = supabase.table("payments").select(_PAYMENT_SELECT).order("record_no")
    if budget:
        q = q.eq("budget_code", budget)
    if status:
        q = q.eq("status", status)
    rows = q.execute().data or []
    rows = [_shape_payment(r) for r in rows]
    if competition_id:
        rows = [r for r in rows if r.get("competition_id") == competition_id]
    return rows


@router.get("")
def list_payments(
    competition_id: Optional[str] = Query(None),
    budget: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
):
    return _fetch_payments(competition_id, budget, status)


# ─── Totals for the footer ───────────────────────────────────────────────────
@router.get("/summary")
def payments_summary(
    competition_id: Optional[str] = Query(None),
    budget: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
):
    # Mismos filtros que la lista: si no, el pie de la tabla filtrada por
    # estado sumaba todos los estados y no coincidía con las filas de arriba.
    rows = _fetch_payments(competition_id=competition_id, budget=budget, status=status)
    return {
        "count": len(rows),
        "amount": round(sum(float(r.get("amount") or 0) for r in rows), 2),
        "extra": round(sum(float(r.get("extra") or 0) for r in rows), 2),
        "airfare": round(sum(float(r.get("airfare") or 0) for r in rows), 2),
        "total": round(sum(float(r.get("total") or 0) for r in rows), 2),
    }


# ─── Cola de pagos (cross-evento) ────────────────────────────────────────────
@router.get("/queue")
def payments_queue(
    status: Optional[str] = Query(None, description="uno o varios separados por coma"),
    year: Optional[int] = Query(None),
    budget: Optional[str] = Query(None),
    competition_id: Optional[str] = Query(None),
    missing_docs: bool = Query(False),
    stale: bool = Query(False),
    cm_pending: bool = Query(False, description="solo pagos cuya nominación no aprobó el CM"),
    search: Optional[str] = Query(None, max_length=200),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """La cola de Finance: todos los pagos de todos los eventos, con badges.

    Pagina en Python sobre la lista ya filtrada: `total` y `totals` son de la
    lista entera (lo que la barra de acciones y el pie necesitan), `items` es
    solo la página.
    """
    items = _queue(status=status, budget=budget, year=year, competition_id=competition_id,
                   missing_docs=missing_docs, stale=stale, search=search, cm_pending=cm_pending)
    return {
        "items": items[offset:offset + limit],
        "total": len(items),
        "limit": limit,
        "offset": offset,
        "totals": _queue_totals(items),
    }


# ─── Export Excel ────────────────────────────────────────────────────────────
_EXPORT_HEADERS = {
    "es": ["Registro", "Estado", "Persona", "Rol", "País", "Competencia", "Año",
           "Budget", "Departamento", "Cuenta", "Monto", "Extra", "Total", "Pasaje",
           "Pagado", "Total nominación", "Monto desactualizado", "CM aprobó",
           "Formulario fiscal", "Datos bancarios", "Fecha de pago",
           "Confirmación bancaria", "Comentarios"],
    "en": ["Record", "Status", "Nominee", "Role", "Country", "Competition", "Year",
           "Budget", "Department", "Account", "Amount", "Extra", "Total", "Airfare",
           "Paid", "Nomination total", "Stale amount", "CM approved",
           "Tax form", "Bank info", "Payment date",
           "Bank confirmation", "Comments"],
}
_MONEY_COLUMNS = (11, 12, 13, 14, 15, 16)


@router.get("/export.xlsx")
def export_payments(
    status: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    budget: Optional[str] = Query(None),
    competition_id: Optional[str] = Query(None),
    missing_docs: bool = Query(False),
    stale: bool = Query(False),
    cm_pending: bool = Query(False),
    search: Optional[str] = Query(None, max_length=200),
    lang: str = Query("es"),
):
    """La cola con los mismos filtros, en Excel. Sin datos bancarios: los
    números de cuenta no salen de `/reveal`, que es lo único auditado."""
    from openpyxl import Workbook
    from api._lib.services.xlsx_utils import (
        autosize, money_format, safe_text, style_header, workbook_bytes, xlsx_response,
    )

    items = _queue(status=status, budget=budget, year=year, competition_id=competition_id,
                   missing_docs=missing_docs, stale=stale, search=search, cm_pending=cm_pending)
    en = lang == "en"
    yes, no = ("Yes", "No") if en else ("Sí", "No")

    wb = Workbook()
    ws = wb.active
    ws.title = "Payments" if en else "Pagos"
    ws.append(_EXPORT_HEADERS["en" if en else "es"])
    style_header(ws)
    for i in items:
        ws.append([
            safe_text(i.get("record_no")),
            safe_text(i.get("status")),
            safe_text(i.get("nominee_name")),
            safe_text(i.get("nominee_role")),
            safe_text(i.get("nominee_country")),
            safe_text(i.get("competition_name")),
            i.get("fiscal_year"),
            safe_text(i.get("budget_code")),
            safe_text(i.get("department_code")),
            safe_text(i.get("account_code")),
            _num(i.get("amount")),
            _num(i.get("extra")),
            _num(i.get("total")),
            _num(i.get("airfare")),
            _num(i.get("paid_amount")) if i.get("paid_amount") is not None else None,
            _num(i.get("nomination_total")) if i.get("nomination_total") is not None else None,
            yes if i.get("stale_amount") else no,
            yes if i.get("cm_approved") else no,
            i.get("tax_form_status"),
            yes if i.get("has_bank_info") else no,
            i.get("payment_date"),
            safe_text(i.get("bank_confirmation")),
            safe_text(i.get("comments")),
        ])
    money_format(ws, _MONEY_COLUMNS)
    autosize(ws)

    suffix = str(year) if year else date.today().isoformat()
    return xlsx_response(workbook_bytes(wb), f"{'payments' if en else 'pagos'}-{suffix}.xlsx")


# ─── Create ──────────────────────────────────────────────────────────────────
@router.post("", status_code=201, dependencies=[Depends(require_edit("payments"))])
def create_payment(data: PaymentCreate, request: Request):
    nom = (
        supabase.table("nominations")
        .select("id, total, personnel(role)")
        .eq("id", data.nomination_id)
        .execute()
        .data
    )
    if not nom:
        raise HTTPException(status_code=404, detail="Nomination not found")
    budget = _budget_row(data.budget_code)
    if budget is None:
        raise HTTPException(status_code=400, detail="Unknown budget")
    # Un pago nace `new`: cualquier otro estado tiene requisitos (fecha, W-8,
    # aprobador) que solo valida /transition.
    if data.status and data.status != "new":
        raise HTTPException(
            status_code=400,
            detail="Payments are created as new; use POST /payments/{id}/transition to change the status",
        )

    existing = supabase.table("payments").select("id").eq("nomination_id", data.nomination_id).execute().data
    if existing:
        raise HTTPException(status_code=409, detail="A payment already exists for this nomination")

    amount = data.amount if data.amount is not None else (nom[0].get("total") or 0)
    record = {
        "nomination_id": data.nomination_id,
        "budget_code": data.budget_code,
        "amount": amount,
        "extra": data.extra or 0,
        "airfare": data.airfare or 0,
        "comments": data.comments,
        "status": "new",
        "payment_date": _date_or_400(data.payment_date, "payment_date"),
        "bank_confirmation": data.bank_confirmation,
        "created_by": _user_id(request),
        # Imputación al presupuesto: derivada, no pedida al usuario. El
        # formulario ya eligió el budget y la nominación ya dice el rol.
        **_budget_dimensions(budget, (nom[0].get("personnel") or {}).get("role")),
    }
    record = {k: v for k, v in record.items() if v is not None}
    row = supabase.table("payments").insert(record).execute().data[0]
    record_transition("payment", row["id"], None, "new", request)
    return row


# ─── Alta masiva desde un evento ─────────────────────────────────────────────
@router.post("/bulk", dependencies=[Depends(require_edit("payments"))])
def bulk_create_payments(data: PaymentBulkCreate, request: Request):
    """Un pago `new` por cada nominación elegible del evento.

    Elegible = carta generada, no declinada y sin pago. `amount` sale de
    `nominations.total`. Lo que no entra vuelve en `skipped` con el motivo —
    nunca se adivina: una nominación sin total no se paga en cero.
    """
    comp = supabase.table("competitions").select("id").eq("id", data.competition_id).execute().data
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")
    budget = _budget_row(data.budget_code)
    if budget is None:
        raise HTTPException(status_code=400, detail="Unknown budget")

    noms = (
        supabase.table("nominations")
        .select("id, total, status, confirmation_status, personnel(name, role)")
        .eq("competition_id", data.competition_id)
        .execute()
        .data
    ) or []
    by_id = {n["id"]: n for n in noms}
    skipped: list = []

    if data.nomination_ids is not None:
        wanted = list(dict.fromkeys(data.nomination_ids))
        for nid in wanted:
            if nid not in by_id:
                skipped.append({"nomination_id": nid, "name": None, "reason": "not_in_competition"})
        noms = [by_id[nid] for nid in wanted if nid in by_id]

    paid_noms: set = set()
    for chunk in _chunks([n["id"] for n in noms]):
        rows = supabase.table("payments").select("nomination_id").in_("nomination_id", chunk).execute().data or []
        paid_noms |= {r["nomination_id"] for r in rows}

    uid = _user_id(request)
    records: list = []
    names: dict = {}
    for n in noms:
        person = n.get("personnel") or {}
        name = person.get("name")
        reason = None
        if n["id"] in paid_noms:
            reason = "has_payment"
        elif n.get("status") != "generated":
            reason = "not_generated"
        elif n.get("confirmation_status") == "declined":
            reason = "declined"
        elif n.get("total") is None:
            reason = "no_total"
        if reason:
            skipped.append({"nomination_id": n["id"], "name": name, "reason": reason})
            continue
        names[n["id"]] = name
        # Mismas claves en todas las filas (PostgREST exige un array uniforme
        # en el insert en lote): las dimensiones en None se escriben como NULL.
        records.append({
            "nomination_id": n["id"],
            "budget_code": data.budget_code,
            "amount": n.get("total"),
            "extra": 0,
            "airfare": 0,
            "status": "new",
            "created_by": uid,
            **_budget_dimensions(budget, person.get("role")),
        })

    created: list = []
    if records:
        try:
            created = supabase.table("payments").insert(records).execute().data or []
        except Exception as exc:
            # Un alta concurrente (UNIQUE nomination_id) tira el lote entero.
            # Se reintenta de a uno para crear lo que sí se puede.
            logger.warning("[payments] bulk insert failed, retrying one by one: %s", exc)
            for rec in records:
                try:
                    created.extend(supabase.table("payments").insert(rec).execute().data or [])
                except Exception as one_exc:
                    logger.warning("[payments] bulk insert of %s failed: %s", rec["nomination_id"], one_exc)
                    skipped.append({"nomination_id": rec["nomination_id"],
                                    "name": names.get(rec["nomination_id"]), "reason": "has_payment"})

    for row in created:
        record_transition("payment", row["id"], None, "new", request, meta={"bulk": True})
        row["nominee_name"] = names.get(row.get("nomination_id"))

    created.sort(key=lambda r: (r.get("nominee_name") or "").lower())
    skipped.sort(key=lambda r: (r.get("name") or "").lower())
    return {"created": created, "skipped": skipped}


# ─── Transiciones de estado ──────────────────────────────────────────────────
def _label(row: dict) -> str:
    nom = row.get("nominations") or {}
    parts = (
        row.get("record_no"),
        (nom.get("personnel") or {}).get("name"),
        (nom.get("competitions") or {}).get("name"),
    )
    return " · ".join(p for p in parts if p)


def _notify_transition(row: dict, from_status: str, to_status: str, warnings: list,
                       reason: Optional[str], actor: Optional[str], ctx: dict) -> None:
    """Novedades en la campana. Best-effort (notify() nunca levanta).

    El título es neutro (`record_no · persona · evento`): qué pasó lo dice el
    `kind`, que la campana traduce. Nada de texto fijo en un idioma acá.
    """
    label = _label(row)
    common = {
        "entity_type": "payment",
        "entity_id": row["id"],
        "link": f"/payments?tab=queue&open={row['id']}",
        "exclude": actor,   # el que hizo el cambio ya lo vio en pantalla
    }
    if from_status == "new" and to_status == "in_process" and any(w.startswith("tax_form_") for w in warnings):
        if "editors" not in ctx:   # un solo lookup por lote
            ctx["editors"] = module_editors("payments")
        notify(ctx["editors"], "payment_tax_form_missing", label,
               body=", ".join(w for w in warnings if w.startswith("tax_form_")), **common)
    elif to_status == "completed":
        notify(row.get("created_by"), "payment_completed", label,
               body=row.get("payment_date"), **common)
    elif to_status == "cancelled":
        notify(row.get("created_by"), "payment_cancelled", label,
               body=reason, **common)


def _apply_transition(payment: dict, banking: Optional[dict], body: dict, request: Request,
                      ctx: dict, *, bulk: bool = False) -> dict:
    """Valida, escribe, deja historial y notifica. Levanta HTTPException."""
    from_status = payment.get("status")
    target = body["status"]
    result = check_payment_transition(
        payment, payment.get("nominations"), banking, target, body,
        user_id=ctx["user_id"], has_approve=ctx["has_approve"], is_superadmin=ctx["is_superadmin"],
    )
    updates = {**result["updates"], "updated_at": _now_iso()}
    # El .eq("status", from_status) es un lock optimista: si otro usuario lo
    # movió entre la lectura y la escritura, no se pisa — 409 y se recarga.
    rows = (
        supabase.table("payments").update(updates)
        .eq("id", payment["id"]).eq("status", from_status)
        .execute().data
    )
    if not rows:
        raise HTTPException(status_code=409, detail="The payment changed meanwhile; reload and try again")

    meta = dict(result["meta"])
    if bulk:
        meta["bulk"] = True
    reason = (body.get("reason") or "").strip() or None
    record_transition("payment", payment["id"], from_status, target, request,
                      reason=reason, meta=meta or None)

    merged = {**rows[0], "nominations": payment.get("nominations")}
    _notify_transition(merged, from_status, target, result["warnings"], reason, ctx["user_id"], ctx)
    item = _queue_item(merged, banking, date.today())
    return {"payment": item, "warnings": result["warnings"]}


def _transition_ctx(request: Request) -> dict:
    superadmin = is_superadmin_request(request)
    return {
        "user_id": _user_id(request),
        "is_superadmin": superadmin,
        # payments_approve es solo-view (como comp_days); has_view ya deja
        # pasar al superadmin, el `or` es por claridad.
        "has_approve": superadmin or has_view(request, APPROVE_MODULE),
    }


@router.post("/bulk-status", dependencies=[Depends(require_edit("payments"))])
def bulk_status(data: PaymentBulkStatus, request: Request):
    """La misma transición sobre varios pagos. Ítem por ítem: un fallo no
    aborta el lote, vuelve en `failed` con el motivo."""
    ids = list(dict.fromkeys(data.ids))
    payments = _load_payments(ids)
    banking = _banking_map(_personnel_id_of(p) for p in payments.values())
    ctx = _transition_ctx(request)
    body = data.model_dump()

    ok: list = []
    failed: list = []
    for pid in ids:
        p = payments.get(pid)
        if not p:
            failed.append({"id": pid, "record_no": None, "error": "Payment not found", "status_code": 404})
            continue
        try:
            res = _apply_transition(p, banking.get(_personnel_id_of(p)), body, request, ctx, bulk=True)
            ok.append({"id": pid, "record_no": p.get("record_no"),
                       "status": res["payment"]["status"], "warnings": res["warnings"]})
        except HTTPException as exc:
            failed.append({"id": pid, "record_no": p.get("record_no"),
                           "error": exc.detail, "status_code": exc.status_code})
        except Exception as exc:
            logger.warning("[payments] bulk-status %s failed: %s", pid, exc)
            failed.append({"id": pid, "record_no": p.get("record_no"),
                           "error": "Unexpected error", "status_code": 500})
    return {"ok": ok, "failed": failed}


# ─── Sincronizar monto con la nominación ─────────────────────────────────────
@router.post("/sync-amount", dependencies=[Depends(require_edit("payments"))])
def sync_amount(data: PaymentSyncAmount, request: Request):
    """`amount = nominations.total` para los pagos abiertos que lo pidan.

    Es explícito a propósito: nominations.py y games.py no tocan pagos; el
    drift se muestra en la cola (`stale_amount`) y lo resuelve una persona.
    Esa persona queda sellada como `last_financial_edit_by` (no completa esos
    pagos) y cada cambio va al historial con `meta.edit`.
    """
    ids = list(dict.fromkeys(data.ids))
    uid, email = _user_id(request), _user_email(request)
    payments = _load_payments(ids)
    updated: list = []
    skipped: list = []
    for pid in ids:
        p = payments.get(pid)
        if not p:
            skipped.append({"id": pid, "record_no": None, "reason": "not_found"})
            continue
        rec = p.get("record_no")
        nom_total = (p.get("nominations") or {}).get("total")
        if p.get("status") not in OPEN_STATUSES:
            skipped.append({"id": pid, "record_no": rec, "reason": "closed"})
            continue
        if nom_total is None:
            skipped.append({"id": pid, "record_no": rec, "reason": "no_nomination_total"})
            continue
        old = round(_num(p.get("amount")), 2)
        new = round(_num(nom_total), 2)
        if abs(old - new) <= 0.005:
            skipped.append({"id": pid, "record_no": rec, "reason": "in_sync"})
            continue
        if _num(p.get("paid_amount")) > new + _num(p.get("extra")) + 0.005:
            # Bajar el monto por debajo de lo ya pagado violaría el CHECK de la
            # 047 (y no tendría sentido): eso lo decide una persona.
            skipped.append({"id": pid, "record_no": rec, "reason": "paid_exceeds_total"})
            continue
        now = _now_iso()
        rows = (
            supabase.table("payments").update({
                "amount": new, "updated_at": now,
                "last_financial_edit_by": uid, "last_financial_edit_by_email": email,
                "last_financial_edit_at": now,
            })
            .eq("id", pid).eq("status", p["status"]).execute().data
        )
        if not rows:
            skipped.append({"id": pid, "record_no": rec, "reason": "changed"})
            continue
        record_transition("payment", pid, p["status"], p["status"], request, meta={
            "edit": {"amount": {"from": old, "to": new}}, "sync_amount": True,
        })
        updated.append({"id": pid, "record_no": rec, "old_amount": old, "new_amount": new})
    return {"updated": updated, "skipped": skipped}


# ─── Ficha bancaria y fiscal por persona ─────────────────────────────────────
#
# Declarado ANTES de las rutas /{payment_id}. Vive en este router y no en
# personnel.py a propósito: hereda el require_view("payments") del router, así
# que quien tiene `personnel` sin `payments` no llega ni al GET enmascarado.
def _person_or_404(personnel_id: str) -> dict:
    if not _is_uuid(personnel_id):
        raise HTTPException(status_code=404, detail="Person not found")
    rows = supabase.table("personnel").select("id, name").eq("id", personnel_id).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Person not found")
    return rows[0]


def _banking_view(person: dict, row: Optional[dict], *, reveal: bool = False) -> dict:
    """La ficha como la ve el frontend. Nunca incluye `tax_form_path`: el PDF
    se baja por /tax-form/download, no por una key del bucket."""
    row = row or {}
    out = {
        "personnel_id": person["id"],
        "personnel_name": person.get("name"),
        "exists": bool(row),
        "masked": not reveal,
    }
    for field in _BANKING_FIELDS:
        value = row.get(field)
        if not reveal and field in _MASKED_FIELDS:
            value = mask_value(value)
        out[field] = value
    expiry = tax_form_expiry(row) if row else None
    out.update({
        "tax_form_file_name": row.get("tax_form_file_name"),
        "has_tax_form_file": bool(row.get("tax_form_path")),
        "tax_form_effective_expires_at": expiry.isoformat() if expiry else None,
        "tax_form_status": tax_form_status(row or None),
        "has_bank_info": has_bank_info(row or None),
        "updated_by": row.get("updated_by"),
        "updated_at": row.get("updated_at"),
    })
    return out


def _derived_expiry(kind: Optional[str], signed: Optional[str], expires: Optional[str]) -> Optional[str]:
    """Vencimiento a guardar: el cargado, o el derivado de la firma si es W-8."""
    if expires:
        return expires
    if kind and kind.startswith("W-8") and signed:
        return date(int(signed[:4]) + 3, 12, 31).isoformat()
    return None


def _write_banking(personnel_id: str, existing: Optional[dict], updates: dict) -> dict:
    if existing:
        rows = supabase.table("personnel_banking").update(updates).eq("personnel_id", personnel_id).execute().data
    else:
        rows = supabase.table("personnel_banking").insert({"personnel_id": personnel_id, **updates}).execute().data
    return rows[0] if rows else {**(existing or {}), **updates}


@router.get("/personnel/{personnel_id}/banking")
def get_banking(personnel_id: str):
    person = _person_or_404(personnel_id)
    return _banking_view(person, _banking_row(personnel_id))


@router.post("/personnel/{personnel_id}/banking/reveal", dependencies=[Depends(require_edit("payments"))])
def reveal_banking(personnel_id: str, request: Request):
    """Números completos. POST (no GET) para que el middleware de activity_log
    deje constancia de quién los miró — los GET no se auditan."""
    person = _person_or_404(personnel_id)
    row = _banking_row(personnel_id)
    logger.info("[payments] banking reveal personnel=%s by user=%s", personnel_id, _user_id(request))
    return _banking_view(person, row, reveal=True)


@router.put("/personnel/{personnel_id}/banking", dependencies=[Depends(require_edit("payments"))])
def put_banking(personnel_id: str, data: PersonnelBankingPut, request: Request):
    person = _person_or_404(personnel_id)
    updates = data.model_dump(exclude_unset=True)
    for field in _MASKED_FIELDS:
        # El formulario puede reenviar lo que mostró el GET: una máscara no es
        # un número nuevo, es "no lo toqué".
        value = updates.get(field)
        if isinstance(value, str) and value.startswith("****"):
            updates.pop(field)
    for field, value in list(updates.items()):
        if isinstance(value, str):
            updates[field] = value.strip() or None
    for field in ("tax_form_signed_at", "tax_form_expires_at"):
        if field in updates:
            updates[field] = _date_or_400(updates[field], field)
    if "currency" in updates:
        updates["currency"] = (updates["currency"] or "USD").upper()
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")

    existing = _banking_row(personnel_id)
    # Vencimiento del W-8 derivado de la firma, solo si quien edita cambió la
    # firma o el tipo y no mandó un vencimiento propio (mandarlo en null es
    # decisión explícita: no se pisa).
    merged = {**(existing or {}), **updates}
    if ("tax_form_expires_at" not in updates and not merged.get("tax_form_expires_at")
            and ("tax_form_signed_at" in updates or "tax_form_kind" in updates)):
        derived = _derived_expiry(merged.get("tax_form_kind"), merged.get("tax_form_signed_at"), None)
        if derived:
            updates["tax_form_expires_at"] = derived
    old_kind = (existing or {}).get("tax_form_kind")
    if "tax_form_kind" in updates and updates["tax_form_kind"] != old_kind:
        # No va a finance_status_history (no hay un pago al que colgarlo); el
        # activity_log ya registra el PUT, esto deja el de→a en el log.
        logger.info("[payments] tax_form_kind personnel=%s %s -> %s by user=%s",
                    personnel_id, old_kind, updates["tax_form_kind"], _user_id(request))
    updates["updated_by"] = _user_id(request)
    updates["updated_at"] = _now_iso()
    row = _write_banking(personnel_id, existing, updates)
    return _banking_view(person, row)


@router.post("/personnel/{personnel_id}/banking/tax-form", status_code=201,
             dependencies=[Depends(require_edit("payments"))])
async def upload_tax_form(
    personnel_id: str,
    request: Request,
    file: UploadFile = File(...),
    kind: Optional[str] = Form(None),
    signed_at: Optional[str] = Form(None),
    expires_at: Optional[str] = Form(None),
):
    """Sube (o reemplaza) el W-8/W-9 firmado. Solo PDF, ≤ 10 MB, al bucket
    privado bajo banking/<personnel_id>/<uuid>.pdf. El anterior se borra
    después de guardar el nuevo, no antes: si algo falla en el medio, queda el
    viejo y no ninguno."""
    person = _person_or_404(personnel_id)
    existing = _banking_row(personnel_id)

    kind = (kind or "").strip() or (existing or {}).get("tax_form_kind")
    if kind not in TAX_FORM_KINDS or kind == "exempt":
        raise HTTPException(status_code=400, detail="kind must be W-8BEN, W-8BEN-E or W-9")
    signed = _date_or_400(signed_at, "signed_at")
    expires = _date_or_400(expires_at, "expires_at")

    content = await file.read()
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB)")
    content_type = (file.content_type or "").lower()
    is_pdf_name = (file.filename or "").lower().endswith(".pdf")
    if not content.startswith(b"%PDF") or not (content_type == "application/pdf" or is_pdf_name):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    key = f"{_BANKING_PREFIX}/{personnel_id}/{uuid.uuid4().hex}.pdf"
    try:
        supabase.storage.from_(_BUCKET).upload(
            path=key, file=content,
            file_options={"content-type": "application/pdf", "upsert": "false"},
        )
    except Exception as e:
        logger.warning("[payments] tax form upload failed for %s: %s", personnel_id, e)
        raise HTTPException(status_code=502, detail="Upload failed")

    new_path = f"storage://{_BUCKET}/{key}"
    file_name = _SAFE_FILENAME_RE.sub("", file.filename or "").strip() or "tax-form.pdf"
    updates = {
        "tax_form_kind": kind,
        "tax_form_path": new_path,
        "tax_form_file_name": file_name,
        # Un documento nuevo trae sus propias fechas: las del anterior no le
        # aplican. Sin firma ni vencimiento, queda "ok" sin vencer hasta que
        # alguien las cargue.
        "tax_form_signed_at": signed,
        "tax_form_expires_at": _derived_expiry(kind, signed, expires),
        "updated_by": _user_id(request),
        "updated_at": _now_iso(),
    }
    try:
        row = _write_banking(personnel_id, existing, updates)
    except Exception:
        _delete_from_storage(new_path)   # no dejar huérfano el PDF recién subido
        raise
    old_path = (existing or {}).get("tax_form_path")
    if old_path and old_path != new_path:
        _delete_from_storage(old_path)
    return _banking_view(person, row)


@router.post("/personnel/{personnel_id}/banking/tax-form/download",
             dependencies=[Depends(require_edit("payments"))])
def download_tax_form(personnel_id: str, request: Request):
    """El W-8/W-9 firmado (número fiscal, dirección, firma). POST y
    require_edit, mismo criterio que /reveal: queda en activity_log quién lo
    bajó — los GET no se auditan."""
    person = _person_or_404(personnel_id)
    logger.info("[payments] tax form download personnel=%s by user=%s", personnel_id, _user_id(request))
    row = _banking_row(personnel_id)
    if not row or not row.get("tax_form_path"):
        raise HTTPException(status_code=404, detail="No tax form on file")
    filename = row.get("tax_form_file_name") or f"{row.get('tax_form_kind') or 'tax-form'} {person.get('name') or ''}.pdf"
    return _stream_private(row["tax_form_path"], filename)


@router.delete("/personnel/{personnel_id}/banking/tax-form", dependencies=[Depends(require_edit("payments"))])
def delete_tax_form(personnel_id: str, request: Request):
    person = _person_or_404(personnel_id)
    row = _banking_row(personnel_id)
    if not row or not row.get("tax_form_path"):
        raise HTTPException(status_code=404, detail="No tax form on file")
    # El tipo queda (sigue siendo lo que corresponde pedirle); sin archivo el
    # estado pasa a `missing`. Las fechas eran del documento borrado.
    updated = _write_banking(personnel_id, row, {
        "tax_form_path": None,
        "tax_form_file_name": None,
        "tax_form_signed_at": None,
        "tax_form_expires_at": None,
        "updated_by": _user_id(request),
        "updated_at": _now_iso(),
    })
    _delete_from_storage(row["tax_form_path"])
    return _banking_view(person, updated)


# ─── Delete attachment (declared before /{payment_id} to avoid route clash) ──
@router.delete("/attachments/{attachment_id}", dependencies=[Depends(require_edit("payments"))])
def delete_attachment(attachment_id: str):
    row = supabase.table("payment_attachments").select("storage_path").eq("id", attachment_id).execute().data
    if not row:
        raise HTTPException(status_code=404, detail="Attachment not found")
    supabase.table("payment_attachments").delete().eq("id", attachment_id).execute()
    _delete_from_storage(row[0].get("storage_path"))
    return {"ok": True}


# ─── Download attachment (authenticated blob; bucket is private) ─────────────
@router.get("/attachments/{attachment_id}/download")
def download_attachment(attachment_id: str, filename: Optional[str] = None):
    row = supabase.table("payment_attachments").select("storage_path, file_name").eq("id", attachment_id).execute().data
    if not row:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return _stream_private(row[0].get("storage_path"), filename or row[0].get("file_name") or "attachment")


# ─── Transition (única forma de cambiar el status) ───────────────────────────
@router.post("/{payment_id}/transition", dependencies=[Depends(require_edit("payments"))])
def transition_payment(payment_id: str, data: PaymentTransition, request: Request):
    payment = _load_payment(payment_id)
    banking = _banking_row(_personnel_id_of(payment))
    return _apply_transition(payment, banking, data.model_dump(), request, _transition_ctx(request))


@router.post("/{payment_id}/record-partial", dependencies=[Depends(require_edit("payments"))])
def record_partial_payment(payment_id: str, data: PaymentRecordPartial, request: Request):
    """Cuánto se lleva pagado de un pago `in_process` (total a la fecha, no un
    incremento). Reglas en check_partial_payment(). Responde como /transition:
    `{payment: <ítem de la cola>, warnings: []}`."""
    payment = _load_payment(payment_id)
    banking = _banking_row(_personnel_id_of(payment))
    ctx = _transition_ctx(request)
    body = data.model_dump()
    result = check_partial_payment(
        payment, payment.get("nominations"), banking, data.paid_amount, body,
        user_id=ctx["user_id"], has_approve=ctx["has_approve"], is_superadmin=ctx["is_superadmin"],
    )
    # Lock optimista sobre estado Y monto pagado previo: dos parciales
    # simultáneos no se pisan, el segundo recibe 409 y recarga.
    q = (
        supabase.table("payments").update({**result["updates"], "updated_at": _now_iso()})
        .eq("id", payment["id"]).eq("status", "in_process")
    )
    previous = payment.get("paid_amount")
    q = q.is_("paid_amount", "null") if previous is None else q.eq("paid_amount", previous)
    rows = q.execute().data
    if not rows:
        raise HTTPException(status_code=409, detail="The payment changed meanwhile; reload and try again")
    reason = (data.reason or "").strip() or None
    record_transition("payment", payment["id"], "in_process", "in_process", request,
                      reason=reason, meta=result["meta"])
    merged = {**rows[0], "nominations": payment.get("nominations")}
    return {"payment": _queue_item(merged, banking, date.today()), "warnings": result["warnings"]}


@router.get("/{payment_id}/history")
def payment_history(payment_id: str):
    # Sin 404 si el pago no existe: el historial sobrevive al borrado a
    # propósito (migración 046) y sigue siendo legible.
    if not _is_uuid(payment_id):
        raise HTTPException(status_code=404, detail="Payment not found")
    return history_for("payment", payment_id)


# ─── Upload attachment ───────────────────────────────────────────────────────
@router.post("/{payment_id}/attachments", status_code=201, dependencies=[Depends(require_edit("payments"))])
async def upload_attachment(payment_id: str, file: UploadFile = File(...), kind: Optional[str] = Form(None)):
    pay = supabase.table("payments").select("id").eq("id", payment_id).execute().data
    if not pay:
        raise HTTPException(status_code=404, detail="Payment not found")

    content_type = (file.content_type or "application/octet-stream").lower()
    # SVG es "image/" pero lleva scripts: servido desde el bucket sería XSS.
    if content_type.startswith("image/svg") or not any(content_type.startswith(a) for a in _ALLOWED_CONTENT):
        raise HTTPException(status_code=400, detail="Only PDF or image files are allowed (no SVG)")

    content = await file.read()
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB)")

    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "bin"
    ext = re.sub(r"[^a-z0-9]", "", ext)[:8] or "bin"
    if ext in ("svg", "svgz"):
        raise HTTPException(status_code=400, detail="Only PDF or image files are allowed (no SVG)")
    key = f"{_ATTACH_PREFIX}/{payment_id}/{uuid.uuid4().hex}.{ext}"
    try:
        supabase.storage.from_(_BUCKET).upload(
            path=key,
            file=content,
            file_options={"content-type": content_type, "upsert": "true"},
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upload failed: {e}")

    record = {
        "payment_id": payment_id,
        "storage_path": f"storage://{_BUCKET}/{key}",
        "file_name": file.filename or f"attachment.{ext}",
        "kind": _normalize_attachment_kind(kind),
    }
    result = supabase.table("payment_attachments").insert(record).execute()
    return result.data[0]


# ─── List a payment's attachments ────────────────────────────────────────────
@router.get("/{payment_id}/attachments")
def list_attachments(payment_id: str):
    return (
        supabase.table("payment_attachments")
        .select("id, file_name, kind, uploaded_at")
        .eq("payment_id", payment_id)
        .order("uploaded_at")
        .execute()
        .data
    ) or []


# ─── One payment (drawer abierto desde un link `?open=<id>`) ─────────────────
@router.get("/{payment_id}")
def get_payment(payment_id: str):
    payment = _load_payment(payment_id)
    banking = _banking_row(_personnel_id_of(payment))
    return _queue_item(payment, banking, date.today())


# ─── Update ──────────────────────────────────────────────────────────────────
@router.put("/{payment_id}", dependencies=[Depends(require_edit("payments"))])
def update_payment(payment_id: str, data: PaymentUpdate, request: Request):
    # exclude_unset y no `if v is not None`: hay que distinguir "no lo mandé" de
    # "ponelo en null". Con el filtro viejo no había forma de borrar un
    # comentario, una fecha de pago o una confirmación bancaria mal cargados.
    updates = data.model_dump(exclude_unset=True)
    if "status" in updates:
        raise HTTPException(
            status_code=400,
            detail="status can't be changed here; use POST /payments/{id}/transition",
        )
    # Registrar plata pagada pide payments_approve, CM, W-8 y separación de
    # funciones: por PUT bastaba con require_edit. En ningún estado.
    if "paid_amount" in updates:
        raise HTTPException(
            status_code=400,
            detail="paid_amount can't be changed here; use POST /payments/{id}/record-partial "
                   "(or the completed transition)",
        )
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    for field in _PAYMENT_NOT_NULL & updates.keys():
        if updates[field] is None:
            raise HTTPException(status_code=400, detail=f"{field} cannot be null")
    if "payment_date" in updates:
        updates["payment_date"] = _date_or_400(updates["payment_date"], "payment_date")

    if not _is_uuid(payment_id):
        raise HTTPException(status_code=404, detail="Payment not found")
    row = (
        supabase.table("payments")
        .select("status, budget_code, nomination_id, amount, extra, airfare, paid_amount")
        .eq("id", payment_id)
        .execute()
        .data
    )
    if not row:
        raise HTTPException(status_code=404, detail="Payment not found")
    current = row[0]
    status = current.get("status")

    # Qué se puede editar depende del estado: lo que ya se pagó no se reescribe.
    if status == "cancelled":
        raise HTTPException(status_code=409, detail="A cancelled payment is read-only; move it back to new first")
    if status == "completed":
        frozen = sorted(set(updates) - _COMPLETED_EDITABLE)
        if frozen:
            raise HTTPException(
                status_code=409,
                detail=f"A completed payment only accepts comments and bank_confirmation "
                       f"(got {', '.join(frozen)}); reopen it first",
            )

    # Lo ya pagado ≤ amount + extra con los valores que van a quedar (el CHECK
    # de la 047 lo haría igual, pero con un 400 genérico).
    amount = updates.get("amount", current.get("amount"))
    extra = updates.get("extra", current.get("extra"))
    paid = current.get("paid_amount")
    if paid is not None and _num(paid) > _num(amount) + _num(extra) + 0.005:
        raise HTTPException(
            status_code=400,
            detail="amount + extra can't be lower than what was already paid (paid_amount)",
        )

    if "budget_code" in updates:
        if updates["budget_code"] != current.get("budget_code"):
            # Elegir un budget nuevo: solo los activos.
            budget = _budget_row(updates["budget_code"])
            if budget is None:
                raise HTTPException(status_code=400, detail="Unknown budget")
        else:
            # El formulario reenvía el budget que ya tenía. No se revalida: si
            # el budget se desactivó después, el pago tiene que poder seguir
            # editándose (antes devolvía "Unknown budget" y quedaba trabado).
            budget = _budget_row(updates["budget_code"], include_inactive=True)
        # Se reimputa acá y no en el frontend. Puede escribir NULL (ver
        # _budget_dimensions). Re-derivar también cuando el budget no cambió es
        # a propósito: corrige pagos imputados antes de que existiera el mapeo
        # de su rol (p.ej. VIDEO_OPERATOR, migración 045).
        updates.update(_budget_dimensions(budget, _nomination_role(current["nomination_id"])))

    now = _now_iso()
    updates["updated_at"] = now
    # Cambio de plata: queda sellado quién lo hizo (no completa el pago ni
    # registra un parcial, ver _release_override) y el de→a va al historial.
    edit = {}
    for field in _FINANCIAL_FIELDS:
        if field not in updates:
            continue
        old, new = current.get(field), updates[field]
        same = (old == new) if field == "budget_code" else abs(_num(old) - _num(new)) <= 0.005
        if not same:
            edit[field] = {"from": old, "to": new}
    if edit:
        updates["last_financial_edit_by"] = _user_id(request)
        updates["last_financial_edit_by_email"] = _user_email(request)
        updates["last_financial_edit_at"] = now
    # Lock optimista sobre el estado: las reglas de arriba se evaluaron contra
    # `status`; si una transición se coló en el medio, no se aplican a ciegas.
    result = supabase.table("payments").update(updates).eq("id", payment_id).eq("status", status).execute()
    if not result.data:
        raise HTTPException(status_code=409, detail="The payment changed meanwhile; reload and try again")
    if edit:
        record_transition("payment", payment_id, status, status, request, meta={"edit": edit})
    return result.data[0]


# ─── Delete payment (cleans attachments in Storage first) ───────────────────
@router.delete("/{payment_id}", dependencies=[Depends(require_edit("payments"))])
def delete_payment(payment_id: str, request: Request):
    if not _is_uuid(payment_id):
        raise HTTPException(status_code=404, detail="Payment not found")
    current = (
        supabase.table("payments")
        .select("status, record_no, nomination_id, amount, extra, airfare, budget_code")
        .eq("id", payment_id).execute().data
    )
    if not current:
        raise HTTPException(status_code=404, detail="Payment not found")
    # Solo lo que nunca movió plata. Un pago en curso o completado se cancela
    # (con motivo) o se reabre; borrarlo se llevaría su historia.
    if current[0].get("status") not in ("new", "cancelled"):
        raise HTTPException(
            status_code=409,
            detail="Only new or cancelled payments can be deleted; cancel it first",
        )
    atts = (
        supabase.table("payment_attachments")
        .select("storage_path")
        .eq("payment_id", payment_id)
        .execute()
        .data
    ) or []
    result = (
        supabase.table("payments").delete()
        .eq("id", payment_id).eq("status", current[0]["status"])
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=409, detail="The payment changed meanwhile; reload and try again")
    # El historial no tiene FK (046): sobrevive y deja la foto de qué se borró.
    # Después del DELETE, para no registrar un borrado que el lock rechazó.
    gone = current[0]
    record_transition("payment", payment_id, gone.get("status"), "deleted", request, meta={
        k: gone.get(k) for k in ("record_no", "nomination_id", "amount", "extra", "airfare", "budget_code")
    })
    for a in atts:
        _delete_from_storage(a.get("storage_path"))
    return {"ok": True}
