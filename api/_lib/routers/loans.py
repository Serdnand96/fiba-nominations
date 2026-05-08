"""Inventory: loans router."""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request

from api._lib.database import supabase
from api._lib.schemas import LoanCreate

router = APIRouter(prefix="/loans", tags=["loans"])


def _user_id(request: Request) -> Optional[str]:
    user = getattr(request.state, "user", None)
    if user and isinstance(user, dict):
        return user.get("id")
    return None


# ─── GET /loans ─────────────────────────────────────────────────────────────
@router.get("")
def list_loans(
    asset_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
):
    q = (
        supabase.table("loans")
        .select("*, assets(name, serial_number)")
        .order("loan_date", desc=True)
    )
    if asset_id:
        q = q.eq("asset_id", asset_id)
    if status:
        q = q.eq("status", status)
    rows = q.execute().data or []
    # Flatten the nested asset fields for client convenience
    for r in rows:
        a = r.pop("assets", None) or {}
        r["asset_name"] = a.get("name")
        r["asset_serial_number"] = a.get("serial_number")
    return rows


# ─── POST /loans ────────────────────────────────────────────────────────────
@router.post("", status_code=201)
def create_loan(data: LoanCreate, request: Request):
    # Verify asset exists and is loanable
    asset = (
        supabase.table("assets")
        .select("id,status")
        .eq("id", data.asset_id)
        .execute()
        .data
    )
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    if asset[0]["status"] in ("retired",):
        raise HTTPException(status_code=400, detail="Cannot loan a retired asset")
    # Block double-active loans
    active = (
        supabase.table("loans")
        .select("id")
        .eq("asset_id", data.asset_id)
        .eq("status", "active")
        .execute()
        .data
    )
    if active:
        raise HTTPException(status_code=409, detail="Asset already has an active loan")

    record = data.model_dump(exclude_none=True)
    record["assigned_by"] = _user_id(request)
    inserted = supabase.table("loans").insert(record).execute()
    loan = inserted.data[0]

    # Update asset status to in_use
    supabase.table("assets").update({"status": "in_use"}).eq("id", data.asset_id).execute()

    return loan


# ─── PUT /loans/{id}/return ─────────────────────────────────────────────────
@router.put("/{loan_id}/return")
def return_loan(loan_id: str):
    loan = (
        supabase.table("loans")
        .select("*")
        .eq("id", loan_id)
        .execute()
        .data
    )
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    loan = loan[0]
    if loan["status"] != "active":
        raise HTTPException(status_code=400, detail="Loan is not active")

    now = datetime.now(timezone.utc).isoformat()
    updated = (
        supabase.table("loans")
        .update({"status": "returned", "actual_return": now})
        .eq("id", loan_id)
        .execute()
    )

    # Mark asset back as available
    supabase.table("assets").update({"status": "available"}).eq("id", loan["asset_id"]).execute()

    return updated.data[0]


# ─── DELETE /loans/{id} (cancel a loan record) ──────────────────────────────
@router.delete("/{loan_id}")
def delete_loan(loan_id: str):
    loan = supabase.table("loans").select("asset_id,status").eq("id", loan_id).execute().data
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    asset_id = loan[0]["asset_id"]
    was_active = loan[0]["status"] == "active"
    supabase.table("loans").delete().eq("id", loan_id).execute()
    if was_active:
        supabase.table("assets").update({"status": "available"}).eq("id", asset_id).execute()
    return {"ok": True}
