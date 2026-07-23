"""Public self-service availability form (no auth) — officials open a shared
per-role link, pick their name and submit their availability.

The token in the URL is the only credential: it resolves to a row in
`availability_links` (one per personnel role) and scopes every endpoint to
personnel of that role. Invalid tokens always answer a uniform 404 so the
endpoint leaks nothing about which tokens exist. Auth bypass + rate limiting
for /api/public/* live in api/index.py.
"""
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from api._lib.database import supabase

router = APIRouter(prefix="/public/availability", tags=["public"])

_STATUSES = ("available", "unavailable", "restricted")
_MAX_RANGES = 24
_MAX_NOTE_LEN = 500
_UPCOMING_MONTHS = 12


class EventAnswer(BaseModel):
    competition_id: str
    status: str
    notes: Optional[str] = None


class RangeAnswer(BaseModel):
    start_date: str
    end_date: str
    status: str = "unavailable"
    notes: Optional[str] = None


class AvailabilitySubmission(BaseModel):
    events: list[EventAnswer] = []
    ranges: list[RangeAnswer] = []


def _resolve_link(token: str) -> dict:
    """Token → availability_links row, or a uniform 404."""
    # Sanity-bound the token before it becomes a query param; real tokens are
    # 43-char urlsafe base64.
    if not token or len(token) > 128:
        raise HTTPException(status_code=404, detail="Not found")
    rows = supabase.table("availability_links").select("*").eq("token", token).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Not found")
    return rows[0]


def _person_in_role(personnel_id: str, role: str) -> dict:
    """personnel row if it belongs to the link's role, else the same 404."""
    rows = (
        supabase.table("personnel")
        .select("id,name,country,role,availability_confirmed_at")
        .eq("id", personnel_id)
        .eq("role", role)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Not found")
    return rows[0]


def _upcoming_competitions() -> list[dict]:
    """Competitions the form asks about: dated, not finished, within the next
    N months. Matches the admin matrix window (12 months ahead)."""
    today = date.today()
    cutoff = today + timedelta(days=_UPCOMING_MONTHS * 31)
    comps = (
        supabase.table("competitions")
        .select("id,name,short_name,competition_type,start_date,end_date,location,is_tbd")
        .order("start_date")
        .execute()
        .data
    )
    out = []
    for c in comps:
        if not c.get("start_date") or c.get("is_tbd"):
            continue
        last_day = c.get("end_date") or c["start_date"]
        if last_day < today.isoformat():
            continue
        if c["start_date"] > cutoff.isoformat():
            continue
        out.append(c)
    return out


# ---------------------------------------------------------------------------
# GET /public/availability/{token} — role roster + upcoming competitions
# ---------------------------------------------------------------------------
@router.get("/{token}")
def get_form(token: str):
    link = _resolve_link(token)
    people = (
        supabase.table("personnel")
        .select("id,name,country")  # deliberately no email/phone/passport
        .eq("role", link["role"])
        .order("name")
        .execute()
        .data
    )
    return {
        "role": link["role"],
        "personnel": people,
        "competitions": _upcoming_competitions(),
    }


# ---------------------------------------------------------------------------
# GET /public/availability/{token}/personnel/{personnel_id} — current answers
# ---------------------------------------------------------------------------
@router.get("/{token}/personnel/{personnel_id}")
def get_person(token: str, personnel_id: str):
    link = _resolve_link(token)
    person = _person_in_role(personnel_id, link["role"])
    records = (
        supabase.table("td_availability")
        .select("id,type,competition_id,start_date,end_date,status,notes")
        .eq("personnel_id", personnel_id)
        .execute()
        .data
    )
    return {
        "name": person["name"],
        "availability_confirmed_at": person.get("availability_confirmed_at"),
        "events": [r for r in records if r["type"] == "event_specific"],
        "ranges": sorted(
            (r for r in records if r["type"] == "date_range"),
            key=lambda r: r.get("start_date") or "",
        ),
    }


# ---------------------------------------------------------------------------
# PUT /public/availability/{token}/personnel/{personnel_id} — submit
# ---------------------------------------------------------------------------
@router.put("/{token}/personnel/{personnel_id}")
def submit(token: str, personnel_id: str, data: AvailabilitySubmission):
    link = _resolve_link(token)
    _person_in_role(personnel_id, link["role"])

    # ── Validate everything before writing anything ──
    if len(data.ranges) > _MAX_RANGES:
        raise HTTPException(status_code=400, detail=f"Too many ranges (max {_MAX_RANGES})")
    for ev in data.events:
        if ev.status not in _STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        if ev.notes and len(ev.notes) > _MAX_NOTE_LEN:
            raise HTTPException(status_code=400, detail="Note too long")
    for rg in data.ranges:
        if rg.status not in _STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        if rg.notes and len(rg.notes) > _MAX_NOTE_LEN:
            raise HTTPException(status_code=400, detail="Note too long")
        try:
            start = date.fromisoformat(rg.start_date)
            end = date.fromisoformat(rg.end_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date")
        if end < start:
            raise HTTPException(status_code=400, detail="end_date before start_date")

    # Answered competitions must actually exist (also blocks writing rows
    # against arbitrary ids).
    comp_ids = list({ev.competition_id for ev in data.events})
    if comp_ids:
        found = (
            supabase.table("competitions").select("id").in_("id", comp_ids).execute().data
        )
        if len(found) != len(comp_ids):
            raise HTTPException(status_code=400, detail="Unknown competition")

    # ── Events: upsert one record per (person, competition) ──
    existing = (
        supabase.table("td_availability")
        .select("id,competition_id")
        .eq("personnel_id", personnel_id)
        .eq("type", "event_specific")
        .execute()
        .data
    )
    existing_by_comp = {r["competition_id"]: r["id"] for r in existing}
    for ev in data.events:
        payload = {"status": ev.status, "notes": ev.notes or None, "updated_by": "self"}
        if ev.competition_id in existing_by_comp:
            supabase.table("td_availability").update(payload).eq(
                "id", existing_by_comp[ev.competition_id]
            ).execute()
        else:
            supabase.table("td_availability").insert({
                "personnel_id": personnel_id,
                "type": "event_specific",
                "competition_id": ev.competition_id,
                **payload,
            }).execute()

    # ── Ranges: full replace — the official is the authority on their own
    # calendar, so the submitted set IS their current blocked periods ──
    supabase.table("td_availability").delete().eq("personnel_id", personnel_id).eq(
        "type", "date_range"
    ).execute()
    if data.ranges:
        supabase.table("td_availability").insert([
            {
                "personnel_id": personnel_id,
                "type": "date_range",
                "start_date": rg.start_date,
                "end_date": rg.end_date,
                "status": rg.status,
                "notes": rg.notes or None,
                "updated_by": "self",
            }
            for rg in data.ranges
        ]).execute()

    # ── Freshness stamp — even a no-change submit means "reviewed today" ──
    confirmed_at = datetime.now(timezone.utc).isoformat()
    supabase.table("personnel").update(
        {"availability_confirmed_at": confirmed_at}
    ).eq("id", personnel_id).execute()
    return {"ok": True, "availability_confirmed_at": confirmed_at}
