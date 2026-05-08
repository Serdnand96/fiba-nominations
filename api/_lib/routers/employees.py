"""Internal staff (employees) — separate from TDs/VGOs in `personnel`."""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from api._lib.database import supabase
from api._lib.schemas import EmployeeCreate, EmployeeUpdate

router = APIRouter(prefix="/employees", tags=["employees"])


@router.get("")
def list_employees(
    search: Optional[str] = Query(None),
    active: Optional[bool] = Query(None),
    department: Optional[str] = Query(None),
):
    q = supabase.table("employees").select("*").order("name", desc=False)
    if active is not None:
        q = q.eq("active", active)
    if department:
        q = q.eq("department", department)
    rows = q.execute().data or []
    if search:
        s = search.lower()
        rows = [
            r for r in rows
            if s in (r.get("name") or "").lower()
            or s in (r.get("email") or "").lower()
            or s in (r.get("position") or "").lower()
            or s in (r.get("department") or "").lower()
        ]
    return rows


@router.get("/{employee_id}")
def get_employee(employee_id: str):
    res = supabase.table("employees").select("*").eq("id", employee_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Employee not found")
    return res.data[0]


@router.post("", status_code=201)
def create_employee(data: EmployeeCreate):
    record = data.model_dump(exclude_none=True)
    result = supabase.table("employees").insert(record).execute()
    return result.data[0]


@router.put("/{employee_id}")
def update_employee(employee_id: str, data: EmployeeUpdate):
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = (
        supabase.table("employees")
        .update(updates)
        .eq("id", employee_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Employee not found")
    return result.data[0]


@router.delete("/{employee_id}")
def delete_employee(employee_id: str):
    # Soft-delete: just mark inactive (loans referencing this stay valid)
    result = (
        supabase.table("employees")
        .update({"active": False})
        .eq("id", employee_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"ok": True, "message": "Employee deactivated"}
