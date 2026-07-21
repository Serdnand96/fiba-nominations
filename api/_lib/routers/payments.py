"""Payments module — payments to event personnel, anchored to nominations.

Each payment hangs off a nomination (the person nominated to a competition),
picks the budget it comes out of, adds an optional extra + comments, carries a
status the finance team advances, and can have financial-control files
attached (EXPENSES / W8 / BANK INFO).

Sensitive data (amounts, bank confirmations, W8 docs) lives here, so the
tables are backend-only (RLS on, no policies) and this router is gated by the
`payments` module permission — view separate from edit.
"""
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
        print(f"[storage cleanup] could not remove {key}: {e}")


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
@router.get("")
def list_payments(
    competition_id: Optional[str] = Query(None),
    budget: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
):
    q = supabase.table("payments").select(
        "*, nominations(competition_id, total, personnel(name, role, country), competitions(name))"
    ).order("record_no")
    if budget:
        q = q.eq("budget_code", budget)
    if status:
        q = q.eq("status", status)
    rows = q.execute().data or []
    rows = [_shape_payment(r) for r in rows]
    if competition_id:
        rows = [r for r in rows if r.get("competition_id") == competition_id]
    return rows


# ─── Totals for the footer ───────────────────────────────────────────────────
@router.get("/summary")
def payments_summary(competition_id: Optional[str] = Query(None)):
    rows = list_payments(competition_id=competition_id)
    return {
        "count": len(rows),
        "amount": round(sum(float(r.get("amount") or 0) for r in rows), 2),
        "extra": round(sum(float(r.get("extra") or 0) for r in rows), 2),
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
    if not _valid_budget(data.budget_code):
        raise HTTPException(status_code=400, detail="Unknown budget")
    if data.status and data.status not in _VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")

    existing = supabase.table("payments").select("id").eq("nomination_id", data.nomination_id).execute().data
    if existing:
        raise HTTPException(status_code=409, detail="A payment already exists for this nomination")

    amount = data.amount if data.amount is not None else (nom[0].get("total") or 0)
    record = {
        "nomination_id": data.nomination_id,
        "budget_code": data.budget_code,
        "amount": amount,
        "extra": data.extra or 0,
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
