"""Payments module — payments to event personnel, anchored to nominations.

Each payment hangs off a nomination (the person nominated to a competition),
adds an optional extra + comments, carries a status the finance team advances,
and can have financial-control files attached (EXPENSES / W8 / BANK INFO).

A payment also **imputes to the budget**: `department_code` + `account_code`
say whose money it is and which line it consumes, and `airfare_account_code`
does the same for the flight, which is a different budget line than the fee
(a TD's fee is COMP-11, their flight COMP-12). Both are required on create —
see `_resolve_imputation`. The old `budget_code` / `payment_budgets` catalogue
mixed department and line in one column and is no longer written; it stays
readable on historical rows (migrations 036 and 038).

Sensitive data (amounts, bank confirmations, W8 docs) lives here, so the
tables are backend-only (RLS on, no policies) and this router is gated by the
`payments` module permission — view separate from edit.
"""
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, Request, Depends, UploadFile, File, Form
from fastapi.responses import Response

from api._lib.database import supabase
from api._lib.auth import require_view, require_edit
from api._lib.routers import budget as budget_router
from api._lib.schemas import ExpenseCreate, ExpenseUpdate, PaymentCreate, PaymentUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payments", tags=["payments"], dependencies=[Depends(require_view("payments"))])

_BUCKET = "nominations"
_ATTACH_PREFIX = "payments"
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
_ALLOWED_CONTENT = ("application/pdf", "image/")
_SAFE_FILENAME_RE = re.compile(r"[^\w\s\-\.\(\)]")
_VALID_STATUSES = {"new", "in_process", "split", "completed"}


def _user_id(request: Request) -> Optional[str]:
    user = getattr(request.state, "user", None)
    if isinstance(user, dict):
        return user.get("id")
    return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _payment_date_for(status: str, payment_date: Optional[str]) -> Optional[str]:
    """La fecha de pago que corresponde al estado, estampándola si falta.

    ⚠️ ESTO ARREGLA UN AGUJERO QUE SE TRAGABA PLATA. `/budget/summary` imputa un
    pago `completed` al año de su `payment_date`, pero la columna es nullable,
    no tiene el CHECK que sí tiene `expenses` (migración 034) y **el formulario
    de Payments nunca tuvo un campo de fecha**. O sea: al marcar un pago como
    pagado, la fila se quedaba sin año y desaparecía del ejecutado, del
    comprometido, de los tres rollups y hasta de `unallocated_payments`. Pagar
    hacía subir el disponible del presupuesto.

    Se resuelve como ya lo hace el módulo de gastos: pasar a `completed` estampa
    hoy si nadie puso una fecha, y salir de `completed` la limpia — un pago que
    no está pagado no puede tener fecha de pago.
    """
    if status == "completed":
        return payment_date or datetime.now(timezone.utc).date().isoformat()
    return None


# ─── Budget imputation ───────────────────────────────────────────────────────
#
# Which budget line a person's fee and their flight consume, by role. Same
# mapping as the backfill in migration 038 — if one changes, both change.
# `VIDEO_OPERATOR` is deliberately absent: the Fees Breakdown sheet doesn't
# have it and migration 036 gave it no fee account either, so those payments
# need the account picked by hand until FIBA decides its line
# (BUDGET_MODULE.md §14.13). Falling back to the VGO line would be a guess that
# lands real money on the wrong account.
_ROLE_ACCOUNTS = {
    "TD":             {"fee": "COMP-11", "airfare": "COMP-12"},
    "VGO":            {"fee": "COMP-13", "airfare": "COMP-14"},
    "REF":            {"fee": "COMP-10", "airfare": "COMP-07"},
    "REF_INSTRUCTOR": {"fee": "COMP-08", "airfare": "COMP-09"},
}


def _departments(only_active: bool = True) -> list:
    rows = supabase.table("departments").select("code, label, active").order("sort").execute().data or []
    return [r for r in rows if r.get("active")] if only_active else rows


def _expense_accounts(only_active: bool = True) -> list:
    rows = (
        supabase.table("accounts")
        .select("code, label, pending_mapping, active")
        .eq("kind", "expense").order("sort").execute().data
    ) or []
    return [r for r in rows if r.get("active")] if only_active else rows


def _assert_can_spend(request: Request, department_code: str) -> None:
    """El caller puede imputar plata a ese departamento.

    ⚠️ MISMO `budget_access` QUE BUDGET, y por la misma razón. Sin esto,
    cualquiera con `payments.can_edit` puede cargar $50.000 contra el
    presupuesto de IT: aparecen en el ejecutado de IT en `/budget/summary` y el
    responsable de IT no los puede corregir, porque su acceso no alcanza a
    Payments. No es un problema de confidencialidad sino de integridad, y nació
    en el momento en que la fase 6 conectó las dos mitades.

    ⚠️ REQUISITO DE DEPLOY: `budget_access` falla cerrado. Un usuario no
    superadmin sin filas ahí no puede cargar pagos. Hay que sembrarlo ANTES de
    que salga esta versión (ver BUDGET_MODULE.md §14.10).
    """
    budget_router._assert_can_edit(request, department_code)


def _nomination_role(nomination_id: str) -> Optional[str]:
    row = (
        supabase.table("nominations")
        .select("personnel(role)")
        .eq("id", nomination_id).execute().data
    )
    if not row:
        return None
    return ((row[0].get("personnel") or {}).get("role"))


def _resolve_imputation(
    department_code: Optional[str],
    account_code: Optional[str],
    airfare_account_code: Optional[str],
    airfare: float,
    role: Optional[str],
    changed: Optional[set] = None,
) -> dict:
    """Validate the budget imputation of a payment, filling in the role defaults.

    The department can't be derived — the same role is paid by Competitions at
    one event and by Club Competitions at another — so it's always required.
    The accounts default from the role, which is what makes the form a
    one-click affair for the four roles that have a line. A role without a
    mapping gets a 400 instead of a silent NULL: an unimputed payment is money
    that disappears from every departmental total, which is the bug this whole
    phase exists to fix.

    `changed` names the fields the request actually sent. Only those are held to
    "must be active"; a code inherited from the stored row is checked for
    existence alone. Without that split, the day Finance deactivates the
    provisional COMP-13 (which is exactly what `PATCH /budget/accounts` is for),
    every historical payment on that account becomes uneditable — including
    advancing its status — with a 400 naming a code the form no longer offers.
    """
    changed = changed if changed is not None else {"department_code", "account_code", "airfare_account_code"}

    if not department_code:
        raise HTTPException(status_code=400, detail="A department is required to impute the payment")
    departments = _departments(only_active=False)
    dept_pool = {d["code"] for d in departments
                 if d.get("active") or "department_code" not in changed}
    if department_code not in dept_pool:
        raise HTTPException(status_code=400, detail="Unknown or inactive department")

    defaults = _ROLE_ACCOUNTS.get(role or "", {})
    account_code = account_code or defaults.get("fee")
    if not account_code:
        raise HTTPException(
            status_code=400,
            detail=f"No default budget account for role {role or '—'}; pick one explicitly",
        )

    if float(airfare or 0) > 0:
        airfare_account_code = airfare_account_code or defaults.get("airfare")
        if not airfare_account_code:
            raise HTTPException(
                status_code=400,
                detail=f"No default travel account for role {role or '—'}; pick one explicitly",
            )
    else:
        # No flight, no travel line. Clearing it keeps the reports from finding
        # an account with a zero attached to it.
        airfare_account_code = None

    accounts = _expense_accounts(only_active=False)
    for field, code in (("account_code", account_code), ("airfare_account_code", airfare_account_code)):
        if not code:
            continue
        pool = {a["code"] for a in accounts if a.get("active") or field not in changed}
        if code not in pool:
            raise HTTPException(status_code=400, detail=f"Unknown or inactive expense account: {code}")

    return {
        "department_code": department_code,
        "account_code": account_code,
        "airfare_account_code": airfare_account_code,
    }


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


# ─── Serialization ───────────────────────────────────────────────────────────
def _shape_payment(row: dict) -> dict:
    """Flatten the nested nomination → personnel/competition into flat fields."""
    nom = row.pop("nominations", None) or {}
    person = nom.get("personnel") or {}
    comp = nom.get("competitions") or {}
    row["nominee_name"] = person.get("name")
    row["nominee_role"] = person.get("role")
    row["nominee_country"] = person.get("country")
    row["competition_id"] = nom.get("competition_id")
    row["competition_name"] = comp.get("name")
    row["nomination_total"] = nom.get("total")
    return row


# ─── Imputation catalogue: what the payment form offers ──────────────────────
@router.get("/imputation")
def imputation_options(request: Request):
    """Departments, expense accounts and the per-role account defaults.

    Served from the payments router — and therefore behind `require_view
    ("payments")` — so that paying someone doesn't require the `budget`
    permission on top. These are catalogues: names of departments and account
    lines, no amounts.
    """
    accounts = _expense_accounts()

    # `used_by`: qué departamentos ya gastaron contra cada cuenta. No es una
    # columna — la cuenta NO pertenece a un departamento (son dimensiones
    # separadas) — pero es lo que deja poner arriba del desplegable las 2-4
    # cuentas del área en la que estás parado en vez de las 34 del plan entero.
    # Mismo cálculo que `/budget/accounts`, sin el recorte por scope: acá no se
    # devuelven montos, y Payments todavía no respeta `budget_access` (fase 9).
    used: dict = {}
    for table in ("budget_lines", "expenses"):
        rows = supabase.table(table).select("account_code, department_code").execute().data or []
        for row in rows:
            if row.get("account_code"):
                used.setdefault(row["account_code"], set()).add(row["department_code"])
    for row in (supabase.table("payments").select("account_code, department_code").execute().data or []):
        if row.get("account_code"):
            used.setdefault(row["account_code"], set()).add(row["department_code"])
    for account in accounts:
        account["used_by"] = sorted(c for c in used.get(account["code"], set()) if c)

    # Qué departamentos puede efectivamente imputar el caller (fase 9). La lista
    # completa se devuelve igual porque la bandeja muestra el evento entero; sin
    # esta marca el formulario ofrecería departamentos que el backend después
    # rechaza con un 403, que es la peor forma de enterarse.
    editable = budget_router._departments_for(request, "edit")
    departments = _departments()
    for d in departments:
        d["can_edit"] = editable is None or d["code"] in editable

    return {
        "departments": departments,
        "accounts": accounts,
        "role_accounts": _ROLE_ACCOUNTS,
        "editable_all": editable is None,
    }


# ─── Bandeja única del evento (fase 9) ──────────────────────────────────────
#
# Payments deja de ser "la pantalla de los nominados" y pasa a mostrar TODO el
# gasto de una competencia: las personas nominadas (`payments`) y el gasto
# operativo sin persona (`expenses` — shipping, branding, seguros). Antes eso
# vivía en otra pantalla y detrás de otro permiso, así que quien opera un evento
# necesitaba `budget` para ver la mitad de lo que gasta.
#
# EL RECORTE. La bandeja se abre con `payments`, pero las FILAS se recortan con
# el mismo `budget_access` que Budget: se ve el evento entero —una competencia
# cruza departamentos— y se carga y edita solo en los propios. Es la regla que
# `competition_cost` ya aplicaba; acá deja de ser una excepción.
#
# POR QUÉ SE LLAMA AL ROUTER DE BUDGET EN VEZ DE REIMPLEMENTAR. Las escrituras
# delegan en `budget.create_expense` / `update_expense` / `delete_expense`, que
# ya validan cuenta, destinatario, coherencia de pagado y —lo que importa acá—
# el departamento contra `budget_access`. Duplicarlas era garantizar que en tres
# meses las dos pantallas validaran distinto sobre la misma tabla.
#
# ⚠️ Se pueden llamar como funciones porque NO tienen defaults de `Query()`: el
# repo ya se quemó con eso (un `Query()` sin resolver llega como objeto truthy y
# se convierte en un filtro fantasma — el bug que dejó `/summary` en $0.00). Si
# alguna vez le agregás un `Query()` a esas tres, este atajo deja de servir.
def _event_expense_target(competition_id, budget_event_id) -> None:
    """Un gasto cargado desde la bandeja pertenece al evento, siempre.

    Sin esto, `payments` se convertiría en una puerta lateral para cargar el
    overhead anual de un departamento sin tener el permiso `budget`.
    """
    if not competition_id and not budget_event_id:
        raise HTTPException(
            status_code=400,
            detail="An expense created from the event tray must belong to a competition or budget event",
        )


@router.get("/event")
def event_tray(request: Request, competition_id: str = Query(...)):
    """Todo el gasto de una competencia, en una sola respuesta.

    `people` son los nominados con su pago (o sin él); `expenses`, el gasto
    operativo del evento recortado a los departamentos que el caller puede ver.
    Los totales vienen separados porque son plata de naturaleza distinta y la
    pantalla los muestra como cards independientes.
    """
    people = list_nominees(competition_id=competition_id)

    expenses = budget_router._fetch_expenses(request, competition_id=competition_id)

    def _sum(rows, field="amount", predicate=lambda r: True) -> float:
        return round(sum(float(r.get(field) or 0) for r in rows if predicate(r)), 2)

    payments = [p["payment"] for p in people if p.get("payment")]
    live_expenses = [e for e in expenses if e.get("status") not in ("rejected", "cancelled")]

    return {
        "people": people,
        "expenses": expenses,
        "totals": {
            "nominated": len(people),
            "with_payment": len(payments),
            "person_fees": _sum(payments, "total"),
            "airfare": _sum(payments, "airfare"),
            "event_expenses": _sum(live_expenses),
            "expenses_paid": _sum(expenses, predicate=lambda r: r.get("status") == "paid"),
            "grand_total": round(_sum(payments, "total") + _sum(payments, "airfare")
                                 + _sum(live_expenses), 2),
        },
    }


@router.post("/event-expenses", status_code=201, dependencies=[Depends(require_edit("payments"))])
def create_event_expense(data: ExpenseCreate, request: Request):
    _event_expense_target(data.competition_id, data.budget_event_id)
    return budget_router.create_expense(data, request)


@router.patch("/event-expenses/{expense_id}", dependencies=[Depends(require_edit("payments"))])
def update_event_expense(expense_id: str, data: ExpenseUpdate, request: Request):
    updated = budget_router.update_expense(expense_id, data, request)
    # Se valida DESPUÉS: `update_expense` ya resolvió el merge con la fila
    # existente y verificó el acceso al departamento. Mirar el resultado evita
    # tener que replicar acá ese merge, y un PATCH que dejaría el gasto sin
    # evento se rechaza igual — solo que con el trabajo ya hecho.
    _event_expense_target(updated.get("competition_id"), updated.get("budget_event_id"))
    return updated


@router.delete("/event-expenses/{expense_id}", dependencies=[Depends(require_edit("payments"))])
def delete_event_expense(expense_id: str, request: Request):
    return budget_router.delete_expense(expense_id, request)


# ─── Nominees for an event (main view: event → nominated people → payment) ───
@router.get("/nominees")
def list_nominees(competition_id: str = Query(...)):
    noms = (
        supabase.table("nominations")
        .select("id, competition_id, total, window_fee, incidentals, status, personnel(name, role, country)")
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
            "nominee_name": person.get("name"),
            "nominee_role": person.get("role"),
            "nominee_country": person.get("country"),
            "nomination_total": n.get("total"),
            "nomination_status": n.get("status"),
            "payment": by_nom.get(n["id"]),
        })
    out.sort(key=lambda r: (r["nominee_name"] or "").lower())
    return out


# ─── Payments list ───────────────────────────────────────────────────────────
def _fetch_payments(
    competition_id: Optional[str] = None,
    status: Optional[str] = None,
    department: Optional[str] = None,
) -> list:
    # Shared by the endpoints below. Endpoints must not call each other as plain
    # functions: FastAPI Query() defaults leak through as truthy objects and
    # become bogus filters (that bug kept /summary at $0.00).
    q = supabase.table("payments").select(
        "*, nominations(competition_id, total, personnel(name, role, country), competitions(name))"
    ).order("record_no")
    if department:
        q = q.eq("department_code", department)
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
    status: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
):
    return _fetch_payments(competition_id, status, department)


# ─── Totals for the footer ───────────────────────────────────────────────────
@router.get("/summary")
def payments_summary(
    competition_id: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
):
    rows = _fetch_payments(competition_id=competition_id, department=department)
    return {
        "count": len(rows),
        "amount": round(sum(float(r.get("amount") or 0) for r in rows), 2),
        "extra": round(sum(float(r.get("extra") or 0) for r in rows), 2),
        "airfare": round(sum(float(r.get("airfare") or 0) for r in rows), 2),
        "total": round(sum(float(r.get("total") or 0) for r in rows), 2),
    }


# ─── Create ──────────────────────────────────────────────────────────────────
@router.post("", status_code=201, dependencies=[Depends(require_edit("payments"))])
def create_payment(data: PaymentCreate, request: Request):
    nom = (
        supabase.table("nominations")
        .select("id, total")
        .eq("id", data.nomination_id)
        .execute()
        .data
    )
    if not nom:
        raise HTTPException(status_code=404, detail="Nomination not found")
    if data.status and data.status not in _VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    # Un pago nace sin aprobar, así que no puede nacer pagado: si no, crear con
    # status 'completed' sería la puerta de atrás del circuito de la fase 10.
    if data.status == "completed":
        raise HTTPException(status_code=400, detail="A new payment cannot start as completed; approve it first")

    existing = supabase.table("payments").select("id").eq("nomination_id", data.nomination_id).execute().data
    if existing:
        raise HTTPException(status_code=409, detail="A payment already exists for this nomination")

    imputation = _resolve_imputation(
        data.department_code, data.account_code, data.airfare_account_code,
        data.airfare or 0, _nomination_role(data.nomination_id),
    )
    _assert_can_spend(request, imputation["department_code"])

    amount = data.amount if data.amount is not None else (nom[0].get("total") or 0)
    record = {
        "nomination_id": data.nomination_id,
        **imputation,
        "amount": amount,
        "extra": data.extra or 0,
        "airfare": data.airfare or 0,
        "comments": data.comments,
        "status": data.status or "new",
        "payment_date": _payment_date_for(data.status or "new", data.payment_date),
        "bank_confirmation": data.bank_confirmation,
        "created_by": _user_id(request),
    }
    record = {k: v for k, v in record.items() if v is not None}
    result = supabase.table("payments").insert(record).execute()
    return result.data[0]


# ─── Update ──────────────────────────────────────────────────────────────────
@router.put("/{payment_id}", dependencies=[Depends(require_edit("payments"))])
def update_payment(payment_id: str, data: PaymentUpdate, request: Request):
    # exclude_unset y NO `if v is not None`: hay que poder distinguir "no mandé
    # el campo" de "vacialo". Con el filtro de None, borrar el texto de un
    # comentario y guardar no borraba nada — el comentario viejo sobrevivía.
    updates = data.model_dump(exclude_unset=True)
    if "status" in updates and updates["status"] not in _VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")

    current = (
        supabase.table("payments")
        .select("nomination_id, status, payment_date, department_code, "
                "account_code, airfare_account_code, airfare")
        .eq("id", payment_id).execute().data
    )
    if not current:
        raise HTTPException(status_code=404, detail="Payment not found")
    current = current[0]

    # The imputation is re-resolved on every edit, merging the update onto what
    # the row already has. Two reasons it isn't skipped when the update leaves
    # it alone: dropping the airfare to 0 has to clear the travel account (a
    # zero parked on COMP-12 reads as a consumed line), and a legacy row with no
    # department gets classified the first time somebody touches it instead of
    # staying invisible to every departmental total forever.
    imputation_fields = {"department_code", "account_code", "airfare_account_code"}
    updates.update(_resolve_imputation(
        updates.get("department_code") or current.get("department_code"),
        updates.get("account_code") or current.get("account_code"),
        updates.get("airfare_account_code") or current.get("airfare_account_code"),
        updates.get("airfare", current.get("airfare")) or 0,
        _nomination_role(current["nomination_id"]),
        changed=imputation_fields & updates.keys(),
    ))
    # Sobre el destino Y sobre el origen: mover un pago a otro departamento sin
    # poder editar el de llegada sería empujarle gasto a un área ajena, y sin
    # poder editar el de salida sería sacárselo de encima.
    _assert_can_spend(request, updates["department_code"])
    if current.get("department_code") and current["department_code"] != updates["department_code"]:
        _assert_can_spend(request, current["department_code"])

    status = updates.get("status", current.get("status"))
    # Un pago sin aprobar no puede darse por pagado (fase 10). Es donde la
    # aprobación tiene dientes: `completed` es lo que consume presupuesto en
    # `/budget/summary`, así que sin esta guarda aprobar sería decorativo.
    if status == "completed" and not current.get("approved_at"):
        raise HTTPException(status_code=400, detail="Approve the payment before marking it completed")
    updates["payment_date"] = _payment_date_for(
        status, updates.get("payment_date", current.get("payment_date")))
    updates["updated_at"] = _now_iso()
    result = supabase.table("payments").update(updates).eq("id", payment_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Payment not found")
    return result.data[0]


# ─── Aprobación (fase 10) ────────────────────────────────────────────────────
#
# Un nivel y sin umbral: el designado con `can_edit` sobre el departamento del
# pago aprueba cualquier monto de su área. El control lo da el recorte por
# departamento, no un escalamiento por plata.
#
# Eje separado del status, igual que en `expenses`: `new/in_process/split/
# completed` describen el trámite bancario y `approved_at` dice quién dio el OK.
@router.get("/pending-approval")
def pending_approval(request: Request, competition_id: Optional[str] = Query(None)):
    """Los pagos que esperan aprobación, recortados a lo que el caller aprueba.

    A diferencia del resto de las lecturas de Payments —que muestran el evento
    entero— esta sí filtra por departamento: es una bandeja de trabajo, y ver en
    ella lo que no podés aprobar es solo ruido.
    """
    rows = [p for p in _fetch_payments(competition_id=competition_id) if not p.get("approved_at")]
    editable = budget_router._departments_for(request, "edit")
    if editable is not None:
        rows = [p for p in rows if p.get("department_code") in editable]
    return {
        "count": len(rows),
        "total": round(sum(float(p.get("total") or 0) + float(p.get("airfare") or 0) for p in rows), 2),
        "payments": rows,
    }


@router.post("/{payment_id}/approve", dependencies=[Depends(require_edit("payments"))])
def approve_payment(payment_id: str, request: Request):
    rows = (
        supabase.table("payments")
        .select("id, department_code, approved_at")
        .eq("id", payment_id).execute().data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Payment not found")
    row = rows[0]
    if not row.get("department_code"):
        raise HTTPException(
            status_code=400,
            detail="Impute the payment to a department before approving it",
        )
    _assert_can_spend(request, row["department_code"])
    if row.get("approved_at"):
        return row   # idempotente: reaprobar no re-estampa ni cambia el autor

    result = supabase.table("payments").update({
        "approved_by": _user_id(request),
        "approved_at": _now_iso(),
        "updated_at": _now_iso(),
    }).eq("id", payment_id).execute()
    return result.data[0]


@router.post("/{payment_id}/unapprove", dependencies=[Depends(require_edit("payments"))])
def unapprove_payment(payment_id: str, request: Request):
    """Vuelve atrás una aprobación, salvo que el pago ya esté pagado.

    Desaprobar un pago `completed` dejaría plata ya ejecutada colgando de una
    aprobación que no existe; para revertir eso hay que sacarlo de `completed`
    primero, que es una decisión distinta y visible.
    """
    rows = (
        supabase.table("payments")
        .select("id, department_code, status")
        .eq("id", payment_id).execute().data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Payment not found")
    row = rows[0]
    _assert_can_spend(request, row.get("department_code"))
    if row.get("status") == "completed":
        raise HTTPException(status_code=400, detail="Move the payment out of 'completed' before unapproving it")

    result = supabase.table("payments").update({
        "approved_by": None, "approved_at": None, "updated_at": _now_iso(),
    }).eq("id", payment_id).execute()
    return result.data[0]


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

    key = _extract_storage_key(row[0].get("storage_path"))
    if not key:
        raise HTTPException(status_code=404, detail="File not available")

    filename = filename or row[0].get("file_name") or "attachment"
    filename = _SAFE_FILENAME_RE.sub("", filename).strip() or "attachment"

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


# ─── Upload attachment ───────────────────────────────────────────────────────
@router.post("/{payment_id}/attachments", status_code=201, dependencies=[Depends(require_edit("payments"))])
async def upload_attachment(payment_id: str, file: UploadFile = File(...), kind: Optional[str] = Form(None)):
    pay = supabase.table("payments").select("id").eq("id", payment_id).execute().data
    if not pay:
        raise HTTPException(status_code=404, detail="Payment not found")

    content_type = file.content_type or "application/octet-stream"
    if not any(content_type.startswith(a) for a in _ALLOWED_CONTENT):
        raise HTTPException(status_code=400, detail="Only PDF or image files are allowed")

    content = await file.read()
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")

    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "bin"
    ext = re.sub(r"[^a-z0-9]", "", ext)[:8] or "bin"
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
        "kind": (kind or None),
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


# ─── Delete payment (cleans attachments in Storage first) ───────────────────
@router.delete("/{payment_id}", dependencies=[Depends(require_edit("payments"))])
def delete_payment(payment_id: str):
    atts = (
        supabase.table("payment_attachments")
        .select("storage_path")
        .eq("payment_id", payment_id)
        .execute()
        .data
    ) or []
    result = supabase.table("payments").delete().eq("id", payment_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Payment not found")
    for a in atts:
        _delete_from_storage(a.get("storage_path"))
    return {"ok": True}
