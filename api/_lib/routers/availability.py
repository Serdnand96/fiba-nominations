import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional

from api._lib.database import supabase
from api._lib.auth import require_view, require_edit
from api._lib.roles import VALID_ROLES

router = APIRouter(prefix="/availability", tags=["availability"], dependencies=[Depends(require_view("availability"))])


class AvailabilityCreate(BaseModel):
    personnel_id: str
    type: str  # 'event_specific' or 'date_range'
    competition_id: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: str  # 'available', 'unavailable', 'restricted'
    notes: Optional[str] = None


class AvailabilityUpdate(BaseModel):
    type: Optional[str] = None
    competition_id: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# GET /availability/personnel/{personnel_id}
# ---------------------------------------------------------------------------
@router.get("/personnel/{personnel_id}")
def get_personnel_availability(personnel_id: str):
    """All availability records for a TD, with competition name joined."""
    records = (
        supabase.table("td_availability")
        .select("*")
        .eq("personnel_id", personnel_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )

    # Enrich event_specific records with competition name
    comp_ids = list({r["competition_id"] for r in records if r.get("competition_id")})
    comp_map = {}
    for cid in comp_ids:
        c = supabase.table("competitions").select("id,name,short_name,start_date,end_date").eq("id", cid).execute().data
        if c:
            comp_map[cid] = c[0]

    for r in records:
        if r.get("competition_id") and r["competition_id"] in comp_map:
            r["competition"] = comp_map[r["competition_id"]]

    return records


# ---------------------------------------------------------------------------
# GET /availability/competition/{competition_id}
# ---------------------------------------------------------------------------
@router.get("/competition/{competition_id}")
def get_competition_availability(competition_id: str, role: str = "TD"):
    """All officials of `role` with their availability status for a competition."""
    if role.upper() not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Role must be one of {', '.join(VALID_ROLES)}")

    # Get competition details (for date overlap checks)
    comp = supabase.table("competitions").select("*").eq("id", competition_id).execute().data
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")
    comp = comp[0]

    # Get all officials of the requested role
    tds = supabase.table("personnel").select("id,name,email,country").eq("role", role.upper()).order("name").execute().data

    # Get all availability records for this competition (event_specific)
    event_records = (
        supabase.table("td_availability")
        .select("*")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    event_map = {r["personnel_id"]: r for r in event_records}

    # Get all date_range records for TDs
    date_records = supabase.table("td_availability").select("*").eq("type", "date_range").execute().data

    # Get all nominations for this competition (TD × competition workflow state)
    noms = (
        supabase.table("nominations")
        .select("id,personnel_id,confirmation_status,confirmation_notes,confirmation_updated_at,status")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    # Map TD → most recent nomination (in case of accidental duplicates)
    nom_map = {}
    for n in noms:
        existing = nom_map.get(n["personnel_id"])
        if not existing or (n.get("confirmation_updated_at") or "") > (existing.get("confirmation_updated_at") or ""):
            nom_map[n["personnel_id"]] = n

    # Build date overlap map: personnel_id -> list of overlapping date_range records
    overlap_map = {}
    comp_start = comp.get("start_date")
    comp_end = comp.get("end_date")
    if comp_start and comp_end:
        for dr in date_records:
            if dr.get("start_date") and dr.get("end_date"):
                if dr["start_date"] <= comp_end and dr["end_date"] >= comp_start:
                    overlap_map.setdefault(dr["personnel_id"], []).append(dr)

    # Build result
    result = []
    for td in tds:
        entry = {
            "personnel_id": td["id"],
            "name": td["name"],
            "email": td["email"],
            "country": td.get("country", ""),
        }

        # Priority: event_specific > date_range overlap > no_data
        if td["id"] in event_map:
            rec = event_map[td["id"]]
            entry["status"] = rec["status"]
            entry["notes"] = rec.get("notes", "")
            entry["availability_id"] = rec["id"]
            entry["source"] = "event_specific"
        elif td["id"] in overlap_map:
            # Use the most restrictive overlapping record
            overlaps = overlap_map[td["id"]]
            worst = _most_restrictive(overlaps)
            entry["status"] = worst["status"]
            entry["notes"] = worst.get("notes", "")
            entry["availability_id"] = worst["id"]
            entry["source"] = "date_range"
        else:
            entry["status"] = "no_data"
            entry["notes"] = ""
            entry["availability_id"] = None
            entry["source"] = None

        # Attach nomination workflow state for this TD × competition (if any)
        nom = nom_map.get(td["id"])
        if nom:
            entry["nomination_id"] = nom["id"]
            entry["confirmation_status"] = nom.get("confirmation_status")
            entry["confirmation_updated_at"] = nom.get("confirmation_updated_at")
        else:
            entry["nomination_id"] = None
            entry["confirmation_status"] = None
            entry["confirmation_updated_at"] = None

        result.append(entry)

    return result


def _most_restrictive(records):
    """Return the most restrictive availability record."""
    priority = {"unavailable": 0, "restricted": 1, "available": 2}
    return min(records, key=lambda r: priority.get(r["status"], 3))


# ---------------------------------------------------------------------------
# POST /availability
# ---------------------------------------------------------------------------
@router.post("", dependencies=[Depends(require_edit("availability"))])
def create_availability(data: AvailabilityCreate):
    # Validate constraints
    if data.type == "event_specific":
        if not data.competition_id:
            raise HTTPException(status_code=400, detail="competition_id is required for event_specific type")
    elif data.type == "date_range":
        if not data.start_date or not data.end_date:
            raise HTTPException(status_code=400, detail="start_date and end_date are required for date_range type")
    else:
        raise HTTPException(status_code=400, detail="type must be 'event_specific' or 'date_range'")

    if data.status not in ("available", "unavailable", "restricted"):
        raise HTTPException(status_code=400, detail="status must be 'available', 'unavailable', or 'restricted'")

    record = data.model_dump()
    record["updated_by"] = "admin"
    # Clear irrelevant fields
    if data.type == "event_specific":
        record["start_date"] = None
        record["end_date"] = None
    else:
        record["competition_id"] = None

    result = supabase.table("td_availability").insert(record).execute()
    return result.data[0]


# ---------------------------------------------------------------------------
# PUT /availability/{id}
# ---------------------------------------------------------------------------
@router.put("/{availability_id}", dependencies=[Depends(require_edit("availability"))])
def update_availability(availability_id: str, data: AvailabilityUpdate):
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    # If type is being changed, validate constraints
    if "type" in updates:
        if updates["type"] == "event_specific" and not updates.get("competition_id"):
            # Check if existing record has competition_id
            existing = supabase.table("td_availability").select("competition_id").eq("id", availability_id).execute().data
            if existing and not existing[0].get("competition_id") and "competition_id" not in updates:
                raise HTTPException(status_code=400, detail="competition_id required for event_specific")
        elif updates["type"] == "date_range":
            existing = supabase.table("td_availability").select("start_date,end_date").eq("id", availability_id).execute().data
            if existing:
                if not (updates.get("start_date") or existing[0].get("start_date")):
                    raise HTTPException(status_code=400, detail="start_date required for date_range")
                if not (updates.get("end_date") or existing[0].get("end_date")):
                    raise HTTPException(status_code=400, detail="end_date required for date_range")

    updates["updated_by"] = "admin"
    result = supabase.table("td_availability").update(updates).eq("id", availability_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Availability record not found")
    return result.data[0]


# ---------------------------------------------------------------------------
# DELETE /availability/{id}
# ---------------------------------------------------------------------------
@router.delete("/{availability_id}", dependencies=[Depends(require_edit("availability"))])
def delete_availability(availability_id: str):
    result = supabase.table("td_availability").delete().eq("id", availability_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Availability record not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Self-service links — one shared secret link per personnel role. The token
# is the whole credential for the public form (see public_availability.py),
# so only availability editors may read or rotate them.
# ---------------------------------------------------------------------------
@router.get("/links", dependencies=[Depends(require_edit("availability"))])
def get_links():
    """One link per role, lazily created on first read."""
    rows = supabase.table("availability_links").select("*").execute().data
    by_role = {r["role"]: r for r in rows}
    for role in VALID_ROLES:
        if role not in by_role:
            created = supabase.table("availability_links").insert({
                "role": role,
                "token": secrets.token_urlsafe(32),
            }).execute().data
            by_role[role] = created[0]
    return [by_role[role] for role in VALID_ROLES]


@router.post("/links/{role}/rotate", dependencies=[Depends(require_edit("availability"))])
def rotate_link(role: str):
    """Replace the role's token — the previously shared link stops working."""
    role = role.upper()
    if role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Role must be one of {', '.join(VALID_ROLES)}")
    updated = supabase.table("availability_links").update({
        "token": secrets.token_urlsafe(32),
        "rotated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("role", role).execute().data
    if not updated:
        raise HTTPException(status_code=404, detail="Link not found — open the links panel first")
    return updated[0]
