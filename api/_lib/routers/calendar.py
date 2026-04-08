from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from collections import Counter

from api._lib.database import supabase

router = APIRouter(prefix="/calendar", tags=["calendar"])


class AssignmentCreate(BaseModel):
    personnel_id: str
    role: str


# ---------------------------------------------------------------------------
# GET /calendar/competitions — list all competitions with assignment counts
# ---------------------------------------------------------------------------
@router.get("/competitions")
def list_competitions(
    month: Optional[int] = Query(None, ge=1, le=12),
    year: Optional[int] = Query(None),
    type: Optional[str] = Query(None),
):
    # Fetch competitions
    q = supabase.table("competitions").select("*").order("start_date", desc=True)
    if type:
        q = q.eq("type", type)
    if month:
        q = q.eq("month", month)
    if year:
        q = q.eq("year", year)
    competitions = q.execute().data

    if not competitions:
        return []

    # Fetch all assignments and count per competition_id
    assignments = supabase.table("assignments").select("competition_id").execute().data
    counts: Counter = Counter(a["competition_id"] for a in assignments)

    # Merge counts into each competition
    for comp in competitions:
        comp["assignment_count"] = counts.get(comp["id"], 0)

    return competitions


# ---------------------------------------------------------------------------
# GET /calendar/competitions/{id} — detail + assigned staff list
# ---------------------------------------------------------------------------
@router.get("/competitions/{competition_id}")
def get_competition_detail(competition_id: str):
    comp = (
        supabase.table("competitions")
        .select("*")
        .eq("id", competition_id)
        .execute()
    )
    if not comp.data:
        raise HTTPException(status_code=404, detail="Competition not found")

    # Fetch assignments for this competition
    assignments = (
        supabase.table("assignments")
        .select("*")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )

    # Enrich assignments with personnel info
    personnel_ids = list({a["personnel_id"] for a in assignments})
    personnel_map = {}
    if personnel_ids:
        for pid in personnel_ids:
            p = supabase.table("personnel").select("*").eq("id", pid).execute().data
            if p:
                personnel_map[pid] = p[0]

    staff = []
    for a in assignments:
        entry = {**a}
        if a["personnel_id"] in personnel_map:
            entry["personnel"] = personnel_map[a["personnel_id"]]
        staff.append(entry)

    result = comp.data[0]
    result["assignments"] = staff
    return result


# ---------------------------------------------------------------------------
# POST /calendar/competitions/{id}/assign — assign staff to competition
# ---------------------------------------------------------------------------
@router.post("/competitions/{competition_id}/assign")
def assign_staff(competition_id: str, data: AssignmentCreate):
    # Verify competition exists
    comp = (
        supabase.table("competitions")
        .select("id")
        .eq("id", competition_id)
        .execute()
    )
    if not comp.data:
        raise HTTPException(status_code=404, detail="Competition not found")

    # Check for duplicate assignment
    existing = (
        supabase.table("assignments")
        .select("id")
        .eq("competition_id", competition_id)
        .eq("personnel_id", data.personnel_id)
        .eq("role", data.role)
        .execute()
    )
    if existing.data:
        raise HTTPException(
            status_code=409,
            detail="This person is already assigned with that role",
        )

    record = {
        "competition_id": competition_id,
        "personnel_id": data.personnel_id,
        "role": data.role,
    }
    result = supabase.table("assignments").insert(record).execute()
    return result.data[0]


# ---------------------------------------------------------------------------
# DELETE /calendar/assignments/{assignment_id} — remove assignment
# ---------------------------------------------------------------------------
@router.delete("/assignments/{assignment_id}")
def remove_assignment(assignment_id: str):
    result = (
        supabase.table("assignments")
        .delete()
        .eq("id", assignment_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Assignment not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# GET /calendar/assignments?competition_id=X — list assignments
# ---------------------------------------------------------------------------
@router.get("/assignments")
def list_assignments(competition_id: str = Query(...)):
    result = (
        supabase.table("assignments")
        .select("*")
        .eq("competition_id", competition_id)
        .order("created_at", desc=True)
        .execute()
    )
    return result.data
