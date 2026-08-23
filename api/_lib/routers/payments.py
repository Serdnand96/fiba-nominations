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
from api._lib.schemas import PaymentCreate, PaymentUpdate

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


def _valid_budget(code: str) -> bool:
    row = supabase.table("payment_budgets").select("code").eq("code", code).eq("active", True).execute().data
    return bool(row)


# ─── Budget imputation ───────────────────────────────────────────────────────
#
# Which budget line a person's fee and their flight consume, by role. Same
# mapping as the backfill in migration 038 — if one changes, both change.
# `VIDEO_OPERATOR` is deliberately absent: the Fees Breakdown sheet doesn't
# have it and migration 036 gave it no fee account either, so those payments
# need the account picked by hand until FIBA decides its line
# (BUDGET_MODULE.md §14.7). Falling back to the VGO line would be a guess that
# lands real money on the wrong account.
_ROLE_ACCOUNTS = {
    "TD":             {"fee": "COMP-11", "airfare": "COMP-12"},
    "VGO":            {"fee": "COMP-13", "airfare": "COMP-14"},
    "REF":            {"fee": "COMP-10", "airfare": "COMP-07"},
    "REF_INSTRUCTOR": {"fee": "COMP-08", "airfare": "COMP-09"},
}


def _departments() -> list:
    return (
        supabase.table("departments")
        .select("code, label").eq("active", True)
        .order("sort").execute().data
    ) or []


def _expense_accounts() -> list:
    return (
        supabase.table("accounts")
        .select("code, label, pending_mapping")
        .eq("active", True).eq("kind", "expense")
        .order("sort").execute().data
    ) or []


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
) -> dict:
    """Validate the budget imputation of a payment, filling in the role defaults.

    The department can't be derived — the same role is paid by Competitions at
    one event and by Club Competitions at another — so it's always required.
    The accounts default from the role, which is what makes the form a
    one-click affair for the four roles that have a line. A role without a
    mapping gets a 400 instead of a silent NULL: an unimputed payment is money
    that disappears from every departmental total, which is the bug this whole
    phase exists to fix.
    """
    if not department_code:
        raise HTTPException(status_code=400, detail="A department is required to impute the payment")
    if department_code not in {d["code"] for d in _departments()}:
        raise HTTPException(status_code=400, detail="Unknown department")

    defaults = _ROLE_ACCOUNTS.get(role or "", {})
    account_code = account_code or defaults.get("fee")
    if not account_code:
        raise HTTPException(
            status_code=400,
            detail=f"No default budget account for role {role or '—'}; pick one explicitly",
        )

    needs_airfare_account = float(airfare or 0) > 0
    if needs_airfare_account:
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

    known = {a["code"] for a in _expense_accounts()}
    for code in (account_code, airfare_account_code):
        if code and code not in known:
            raise HTTPException(status_code=400, detail=f"Unknown expense account: {code}")

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


# ─── Budgets catalogue (legacy — historical rows only) ───────────────────────
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


# ─── Imputation catalogue: what the payment form offers ──────────────────────
@router.get("/imputation")
def imputation_options():
    """Departments, expense accounts and the per-role account defaults.

    Served from the payments router — and therefore behind `require_view
    ("payments")` — so that paying someone doesn't require the `budget`
    permission on top. These are catalogues: names of departments and account
    lines, no amounts.
    """
    return {
        "departments": _departments(),
        "accounts": _expense_accounts(),
        "role_accounts": _ROLE_ACCOUNTS,
    }


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
    budget: Optional[str] = None,
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
    # `budget` is the legacy filter on payment_budgets. Kept because a cached
    # SPA still sends it; silently ignoring it would show unfiltered totals to
    # someone who thinks they filtered.
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
    department: Optional[str] = Query(None),
):
    return _fetch_payments(competition_id, budget, status, department)


# ─── Totals for the footer ───────────────────────────────────────────────────
@router.get("/summary")
def payments_summary(
    competition_id: Optional[str] = Query(None),
    budget: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
):
    rows = _fetch_payments(competition_id=competition_id, budget=budget, department=department)
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
    if data.budget_code and not _valid_budget(data.budget_code):
        raise HTTPException(status_code=400, detail="Unknown budget")
    if data.status and data.status not in _VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")

    existing = supabase.table("payments").select("id").eq("nomination_id", data.nomination_id).execute().data
    if existing:
        raise HTTPException(status_code=409, detail="A payment already exists for this nomination")

    imputation = _resolve_imputation(
        data.department_code, data.account_code, data.airfare_account_code,
        data.airfare or 0, _nomination_role(data.nomination_id),
    )

    amount = data.amount if data.amount is not None else (nom[0].get("total") or 0)
    record = {
        "nomination_id": data.nomination_id,
        "budget_code": data.budget_code,
        **imputation,
        "amount": amount,
        "extra": data.extra or 0,
        "airfare": data.airfare or 0,
        "comments": data.comments,
        "status": data.status or "new",
        "payment_date": data.payment_date,
        "bank_confirmation": data.bank_confirmation,
        "created_by": _user_id(request),
    }
    record = {k: v for k, v in record.items() if v is not None}
    result = supabase.table("payments").insert(record).execute()
    return result.data[0]


# ─── Update ──────────────────────────────────────────────────────────────────
@router.put("/{payment_id}", dependencies=[Depends(require_edit("payments"))])
def update_payment(payment_id: str, data: PaymentUpdate):
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if "budget_code" in updates and not _valid_budget(updates["budget_code"]):
        raise HTTPException(status_code=400, detail="Unknown budget")
    if "status" in updates and updates["status"] not in _VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")

    current = (
        supabase.table("payments")
        .select("nomination_id, department_code, account_code, airfare_account_code, airfare")
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
    updates.update(_resolve_imputation(
        updates.get("department_code") or current.get("department_code"),
        updates.get("account_code") or current.get("account_code"),
        updates.get("airfare_account_code") or current.get("airfare_account_code"),
        updates.get("airfare", current.get("airfare")) or 0,
        _nomination_role(current["nomination_id"]),
    ))
    updates["updated_at"] = _now_iso()
    result = supabase.table("payments").update(updates).eq("id", payment_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Payment not found")
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
