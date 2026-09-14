import io
import logging
import os
import re
import shutil
import zipfile
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends, Request, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from starlette.background import BackgroundTask
from typing import Optional
from api._lib.database import supabase
from api._lib.auth import require_view, require_edit
from api._lib.schemas import NominationCreate, BulkNominationCreate, NominationUpdate
from api._lib.services.document_generator import (
    generate_nomination, _build_doc, _convert_to_pdf, custom_type,
)
from api._lib.travel import sede_pairs, format_sedes
from api._lib.crew import get_competition, is_tournament_mode, list_crew
# Reused rather than re-derived — see letter_data_for()/prefill_nomination()
# docstrings. games.py does not import this module at module scope, so this
# stays a plain top-level import (no cycle).
from api._lib.routers.games import (
    _build_default_overrides, _derive_travel, _derive_travel_from_training,
    _FEE_PREFIX_BY_PERSONNEL_ROLE,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/nominations", tags=["nominations"], dependencies=[Depends(require_view("nominations"))])

_MAX_BULK = 100
_SAFE_FILENAME_RE = re.compile(r'[^\w\s\-\.\(\)]')
_VALID_CONFIRMATION_STATUSES = {"pending", "nominated", "confirmed", "declined"}

# Roles a competition can set fees for (competition.<prefix>_window_fee/_incidentals).
_FEE_ROLES = ("TD", "VGO", "REF", "REF_INSTRUCTOR", "VIDEO_OPERATOR")

# Template keys the generator dispatches on directly for "nomination" vs
# "confirmation" letters — see letter_kind().
_NOMINATION_KEYS = {"WCQ", "GENERIC"}
_CONFIRMATION_KEYS = {"BCLA", "BCLA_F4", "BCLA_RS", "LSB"}


def _user_id(request: Request) -> Optional[str]:
    user = getattr(request.state, "user", None)
    if isinstance(user, dict):
        return user.get("id")
    return None


def _host_location_for_nomination(
    competition_id: str,
    personnel_id: str | None,
    game_dates: list | None,
    template_key: str | None = None,
) -> tuple[str, str]:
    """Look up host city + country for a nomination from game_schedule.

    Preference order for picking which games to look at:
      1. games where this personnel has a game_assignments row (most precise —
         disambiguates multi-host days like a WCQ window with 3 countries on
         the same date),
      2. games whose date matches the nomination's `game_dates`,
      3. all games for the competition.

    For WCQ (national-team competitions) the home team (`team_a`) IS the host
    country, so we fall back to team_a when country is empty.

    Picks the most common non-empty value across the relevant games.
    """
    try:
        games = (
            supabase.table("game_schedule")
            .select("id, date, city, country, team_a")
            .eq("competition_id", competition_id)
            .execute()
            .data
        ) or []
    except Exception:
        return "", ""

    if not games:
        return "", ""

    relevant: list[dict] = []
    person_scoped = False  # games narrowed to this person (vs whole schedule)

    if personnel_id:
        try:
            assignments = (
                supabase.table("game_assignments")
                .select("game_id")
                .eq("personnel_id", personnel_id)
                .in_("game_id", [g["id"] for g in games])
                .execute()
                .data
            ) or []
            assigned_ids = {a["game_id"] for a in assignments}
            relevant = [g for g in games if g["id"] in assigned_ids]
            person_scoped = bool(relevant)
        except Exception:
            relevant = []

    if not relevant:
        dates = {gd.get("date") for gd in (game_dates or []) if isinstance(gd, dict) and gd.get("date")}
        if dates:
            relevant = [g for g in games if g.get("date") in dates]
            person_scoped = bool(relevant)

    if not relevant:
        relevant = games

    is_wcq = (template_key or "").upper() == "WCQ"

    # Person-scoped games → itinerary order, keeping EVERY sede the person
    # visits (a VGO can cover two hosts back to back). Falling back to the
    # whole schedule (no assignments, no matching dates) keeps the old
    # most-common pick — joining every host of a WCQ window would be noise.
    if person_scoped:
        pairs = sede_pairs(relevant, use_team_a=is_wcq)
        if len(pairs) == 1:
            return pairs[0]
        if 1 < len(pairs) <= 3:
            return format_sedes(pairs), ""

    def _most_common(values: list[str]) -> str:
        counts: dict[str, int] = {}
        for v in values:
            v = (v or "").strip()
            if v:
                counts[v] = counts.get(v, 0) + 1
        return max(counts, key=counts.get) if counts else ""

    city = _most_common([g.get("city") for g in relevant])
    country = _most_common([g.get("country") for g in relevant])
    if not country and is_wcq:
        country = _most_common([g.get("team_a") for g in relevant])

    return city, country


def letter_data_for(nom: dict) -> dict:
    """The dict `generate_nomination()`/`_build_doc()` expect, built from a
    `nominations` row that already carries its `personnel` and `competitions`
    joins (the `select()`s in this router and in games.py all embed them the
    same way: `personnel(name, role, email), competitions(name, template_key,
    year, fee_type)`).

    Single source of truth for this shape — it used to be copy-pasted in
    `generate_nomination_doc`, `bulk_generate_nominations` and games.py's
    `generate_assignment_pdfs`, and in the preview endpoints below. Also
    imported by the Templates preview-with-real-data flow.
    """
    personnel = nom.get("personnel") or {}
    competition = nom.get("competitions") or {}

    host_city, host_country = _host_location_for_nomination(
        nom["competition_id"],
        nom.get("personnel_id"),
        nom.get("game_dates"),
        competition.get("template_key"),
    )

    return {
        "template_key": competition.get("template_key"),
        "nominee_name": personnel.get("name", ""),
        "role": personnel.get("role", ""),
        "letter_date": nom.get("letter_date", ""),
        "competition_name": competition.get("name", ""),
        "competition_year": competition.get("year", ""),
        "location": nom.get("location", ""),
        "venue": nom.get("venue", ""),
        "arrival_date": nom.get("arrival_date", ""),
        "departure_date": nom.get("departure_date", ""),
        "game_dates": nom.get("game_dates", []),
        "window_fee": nom.get("window_fee"),
        "incidentals": nom.get("incidentals"),
        "total": nom.get("total"),
        "confirmation_deadline": nom.get("confirmation_deadline", ""),
        "fee_type": competition.get("fee_type", "per_game"),
        "host_city": host_city,
        "host_country": host_country,
    }


def letter_kind(template_key: str | None) -> str:
    """'nomination' or 'confirmation' — governs which fields a letter needs
    (required_fields_for) and what its body reads like (document_generator).

    WCQ/GENERIC are nomination letters; BCLA (and its F4/RS variants) and LSB
    are confirmation letters. A type created from the UI carries its own
    `kind` on `letter_templates`; unknown keys default to 'nomination'.
    """
    key = (template_key or "").upper()
    if key in _CONFIRMATION_KEYS:
        return "confirmation"
    if key in _NOMINATION_KEYS or not key:
        return "nomination"
    row = custom_type(key)
    if row and row.get("kind") in ("nomination", "confirmation"):
        return row["kind"]
    return "nomination"


def required_fields_for(competition: dict) -> list[str]:
    """Fields a nomination needs before its letter can be generated for real.

    Always the letter date and the fee. Nomination letters (not confirmation)
    also need a confirmation deadline. Per-game competitions also need at
    least one game date — a tournament-fee letter doesn't list games, so it
    doesn't need one.
    """
    fields = ["letter_date", "window_fee"]
    if letter_kind(competition.get("template_key")) == "nomination":
        fields.append("confirmation_deadline")
    if (competition.get("fee_type") or "per_game") == "per_game":
        fields.append("game_dates")
    return fields


def missing_fields(nom: dict, competition: dict) -> list[str]:
    """Which of required_fields_for(competition) are blank on this nomination.

    `window_fee = 0` is a real (if unusual) value, not a missing one — only
    None/"" count. `game_dates` is missing when it's None or an empty list.
    """
    missing = []
    for field in required_fields_for(competition):
        value = nom.get(field)
        if field == "game_dates":
            if not value:
                missing.append(field)
        elif value is None or value == "":
            missing.append(field)
    return missing


class ConfirmationUpdate(BaseModel):
    status: str
    notes: Optional[str] = None


class ApprovalUpdate(BaseModel):
    approved: bool


@router.get("")
def list_nominations():
    # payments(record_no) lets the UI warn about the attached payment before a
    # delete is even attempted (deletes are refused while a payment exists).
    result = supabase.table("nominations").select(
        "*, personnel(name, role, email), competitions(name, template_key, year, fee_type), payments(record_no)"
    ).order("created_at", desc=True).execute()
    return result.data


def _fill_role_fee_defaults(record: dict) -> None:
    """Fill window_fee/incidentals from the competition's rate for the
    person's role when the caller left them blank (window_fee is None).

    Never overwrites a value the caller actually sent — an explicit 0 is a
    real fee, not "unset". Best-effort: a competition or personnel row that
    can't be read just leaves the fields as the caller sent them.
    """
    if record.get("window_fee") is not None:
        return
    competition = get_competition(record.get("competition_id"))
    if not competition:
        return
    person = (
        supabase.table("personnel")
        .select("role")
        .eq("id", record.get("personnel_id"))
        .execute()
        .data
    )
    role = ((person[0].get("role") if person else None) or "").upper()
    overrides = _build_default_overrides(competition, role)
    for key in ("window_fee", "incidentals"):
        if record.get(key) is None and key in overrides:
            record[key] = overrides[key]


@router.post("", dependencies=[Depends(require_edit("nominations"))])
def create_nomination(data: NominationCreate):
    """Create a nomination. window_fee/incidentals left blank (None) are
    filled from the competition's rate for the person's role."""
    record = data.model_dump()
    if record.get("game_dates"):
        record["game_dates"] = [
            gd if isinstance(gd, dict) else gd.model_dump()
            for gd in record["game_dates"]
        ]
    _fill_role_fee_defaults(record)
    # Creating a nomination implies the TD was selected → start at 'nominated'
    record.setdefault("confirmation_status", "nominated")
    record.setdefault("confirmation_updated_at", datetime.now(timezone.utc).isoformat())
    result = supabase.table("nominations").insert(record).execute()
    return result.data[0]


@router.post("/bulk", dependencies=[Depends(require_edit("nominations"))])
def create_bulk_nominations(data: BulkNominationCreate):
    """Create nominations for multiple people with the same competition/settings.

    window_fee/incidentals left blank (None) are filled per person from the
    competition's rate for THEIR role — TD and VGO on the same bulk request
    each get their own fee.
    """
    if len(data.personnel_ids) > _MAX_BULK:
        raise HTTPException(status_code=400, detail=f"Maximum {_MAX_BULK} items per request")
    created = []
    errors = []

    for pid in data.personnel_ids:
        try:
            record = {
                "personnel_id": pid,
                "competition_id": data.competition_id,
                "letter_date": data.letter_date,
                "location": data.location,
                "venue": data.venue,
                "arrival_date": data.arrival_date,
                "departure_date": data.departure_date,
                "game_dates": [gd.model_dump() for gd in data.game_dates] if data.game_dates else None,
                "window_fee": data.window_fee,
                "incidentals": data.incidentals,
                "confirmation_deadline": data.confirmation_deadline,
                "confirmation_status": "nominated",
                "confirmation_updated_at": datetime.now(timezone.utc).isoformat(),
            }
            _fill_role_fee_defaults(record)
            result = supabase.table("nominations").insert(record).execute()
            created.append(result.data[0])
        except Exception as e:
            errors.append({"personnel_id": pid, "error": str(e)})

    return {"created": len(created), "errors": errors, "nominations": created}


@router.post("/bulk-generate", dependencies=[Depends(require_edit("nominations"))])
def bulk_generate_nominations(nomination_ids: list[str]):
    """Generate PDF documents for multiple nominations."""
    if len(nomination_ids) > _MAX_BULK:
        raise HTTPException(status_code=400, detail=f"Maximum {_MAX_BULK} items per request")
    results = []

    for nid in nomination_ids:
        try:
            result = supabase.table("nominations").select(
                "*, personnel(name, role, email), competitions(name, template_key, year, fee_type)"
            ).eq("id", nid).execute()

            if not result.data:
                results.append({"id": nid, "status": "error", "error": "Not found"})
                continue

            nom = result.data[0]
            personnel = nom["personnel"]
            competition = nom["competitions"]

            missing = missing_fields(nom, competition)
            if missing:
                results.append({
                    "id": nid,
                    "name": personnel.get("name"),
                    "status": "error",
                    "code": "missing_fields",
                    "missing": missing,
                    "error": f"Missing: {', '.join(missing)}",
                })
                continue

            nom_data = letter_data_for(nom)

            local_path, storage_url, conversion_error = generate_nomination(nom_data)
            saved_path = storage_url if storage_url else local_path

            supabase.table("nominations").update({
                "status": "generated",
                "pdf_path": saved_path,
            }).eq("id", nid).execute()

            ext = "docx" if conversion_error else "pdf"
            filename = f"{personnel['name']} {competition['name']} Nomination.{ext}"
            results.append({
                "id": nid,
                "name": personnel["name"],
                "status": "generated",
                "pdf_path": saved_path,
                "filename": filename,
                "format": ext,
                "conversion_error": conversion_error,
            })
        except Exception as e:
            results.append({"id": nid, "status": "error", "error": str(e)})

    return {"results": results, "total": len(results), "success": sum(1 for r in results if r["status"] == "generated")}


@router.patch("/{nomination_id}/confirmation", dependencies=[Depends(require_edit("nominations"))])
def update_confirmation(nomination_id: str, payload: ConfirmationUpdate):
    """Update the confirmation workflow state for a nomination."""
    if payload.status not in _VALID_CONFIRMATION_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"status must be one of {sorted(_VALID_CONFIRMATION_STATUSES)}"
        )
    updates = {
        "confirmation_status": payload.status,
        "confirmation_updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if payload.notes is not None:
        updates["confirmation_notes"] = payload.notes
    result = (
        supabase.table("nominations")
        .update(updates)
        .eq("id", nomination_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Nomination not found")
    return result.data[0]


@router.patch("/{nomination_id}/approval", dependencies=[Depends(require_edit("nominations"))])
def update_approval(nomination_id: str, payload: ApprovalUpdate, request: Request):
    """Update the Competition Manager approval state for a nomination."""
    if payload.approved:
        updates = {
            "cm_approved": True,
            "cm_approved_at": datetime.now(timezone.utc).isoformat(),
            "cm_approved_by": _user_id(request),
        }
    else:
        updates = {
            "cm_approved": False,
            "cm_approved_at": None,
            "cm_approved_by": None,
        }
    result = (
        supabase.table("nominations")
        .update(updates)
        .eq("id", nomination_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Nomination not found")
    return result.data[0]


def _extract_storage_key(pdf_path: str | None) -> str | None:
    """Extract the Storage object key from a pdf_path (any supported format)."""
    if not pdf_path:
        return None
    if pdf_path.startswith("storage://nominations/"):
        return pdf_path[len("storage://nominations/"):]
    if "/storage/v1/object/public/nominations/" in pdf_path:
        return pdf_path.split("/storage/v1/object/public/nominations/", 1)[1]
    if "/storage/v1/object/nominations/" in pdf_path:
        return pdf_path.split("/storage/v1/object/nominations/", 1)[1]
    return None


def _delete_pdf_from_storage(pdf_path: str | None) -> None:
    """Best-effort cleanup of a nomination's PDF in Storage."""
    key = _extract_storage_key(pdf_path)
    if not key:
        return
    try:
        supabase.storage.from_("nominations").remove([key])
    except Exception as e:
        logger.warning(f"[storage cleanup] could not remove {key}: {e}")


def _payment_records_for(nomination_ids: list[str]) -> dict:
    """record_no of the payment attached to each nomination, if any.

    Deleting a nomination cascades to its payment (and the payment's
    financial-control files), so deletes must refuse while a payment exists —
    losing EP records silently is how EP-00001..5 vanished on 2026-07-30.
    """
    if not nomination_ids:
        return {}
    rows = (
        supabase.table("payments")
        .select("nomination_id, record_no")
        .in_("nomination_id", nomination_ids)
        .execute()
        .data
    ) or []
    return {r["nomination_id"]: r["record_no"] for r in rows}


@router.delete("/{nomination_id}", dependencies=[Depends(require_edit("nominations"))])
def delete_nomination(nomination_id: str):
    record_no = _payment_records_for([nomination_id]).get(nomination_id)
    if record_no:
        raise HTTPException(
            status_code=409,
            detail=f"This nomination has payment {record_no} attached — delete the payment first in the Payments module",
        )

    # Pen-test N2: also clean up the PDF in Storage so a stale UUID can't be
    # used to download a deleted nomination's file.
    row = supabase.table("nominations").select("pdf_path").eq("id", nomination_id).execute().data
    pdf_path = row[0].get("pdf_path") if row else None

    result = supabase.table("nominations").delete().eq("id", nomination_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Nomination not found")

    _delete_pdf_from_storage(pdf_path)
    return {"ok": True}


@router.delete("/bulk/delete", dependencies=[Depends(require_edit("nominations"))])
def bulk_delete_nominations(nomination_ids: list[str]):
    if len(nomination_ids) > _MAX_BULK:
        raise HTTPException(status_code=400, detail=f"Maximum {_MAX_BULK} items per request")
    with_payment = _payment_records_for(nomination_ids)
    deleted = 0
    errors = []
    blocked = []
    for nid in nomination_ids:
        if nid in with_payment:
            blocked.append({"id": nid, "record_no": with_payment[nid]})
            continue
        try:
            row = supabase.table("nominations").select("pdf_path").eq("id", nid).execute().data
            pdf_path = row[0].get("pdf_path") if row else None
            supabase.table("nominations").delete().eq("id", nid).execute()
            _delete_pdf_from_storage(pdf_path)
            deleted += 1
        except Exception as e:
            errors.append({"id": nid, "error": str(e)})
    return {"deleted": deleted, "blocked": blocked, "errors": errors}


@router.get("/prefill")
def prefill_nomination(
    competition_id: str = Query(...),
    personnel_ids: Optional[str] = Query(None, description="Comma-separated personnel ids"),
):
    """What the "New nomination" form needs to prefill itself: the
    competition's defaults, its role fee schedule, its distinct game dates,
    who's already assigned (crew in tournament mode, game_assignments in
    per-game mode), and — for the requested `personnel_ids` — the same
    per-person travel/fee derivation `sync-nominations` uses.

    Read-only: require_view (already on the router) is enough.
    """
    competition = get_competition(competition_id)
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")

    tournament = is_tournament_mode(competition)
    kind = letter_kind(competition.get("template_key"))

    defaults = {
        "letter_date": competition.get("default_letter_date"),
        "location": competition.get("default_location"),
        "venue": competition.get("default_venue"),
        "arrival_date": competition.get("default_arrival_date"),
        "departure_date": competition.get("default_departure_date"),
        "confirmation_deadline": competition.get("default_confirmation_deadline"),
    }

    fees_by_role = {}
    for role in _FEE_ROLES:
        prefix = _FEE_PREFIX_BY_PERSONNEL_ROLE[role]
        fee = competition.get(f"{prefix}_window_fee")
        inc = competition.get(f"{prefix}_incidentals")
        if fee is not None or inc is not None:
            fees_by_role[role] = {"window_fee": fee, "incidentals": inc}

    games = (
        supabase.table("game_schedule")
        .select("id, date, venue, city, country, team_a")
        .eq("competition_id", competition_id)
        .execute()
        .data
    ) or []
    game_by_id = {g["id"]: g for g in games}
    dates = sorted({g["date"] for g in games if g.get("date")})
    label_prefix = "Gameday" if (competition.get("template_key") or "").upper() == "LSB" else "Game"
    game_dates = [{"label": f"{label_prefix} {i + 1}", "date": d} for i, d in enumerate(dates)]

    if tournament:
        assigned_personnel_ids = sorted({m["personnel_id"] for m in list_crew(competition_id)})
    else:
        assigned_personnel_ids = []
        if game_by_id:
            assignments = (
                supabase.table("game_assignments")
                .select("personnel_id")
                .in_("game_id", list(game_by_id.keys()))
                .execute()
                .data
            ) or []
            assigned_personnel_ids = sorted({a["personnel_id"] for a in assignments})

    requested_pids = [pid.strip() for pid in (personnel_ids or "").split(",") if pid.strip()]
    people: dict = {}
    if requested_pids:
        person_rows = (
            supabase.table("personnel")
            .select("id, name, role")
            .in_("id", requested_pids)
            .execute()
            .data
        ) or []
        role_by_pid = {p["id"]: (p.get("role") or "").upper() for p in person_rows}

        crew_pids = (
            {m["personnel_id"] for m in list_crew(competition_id)} if tournament else set()
        )
        person_game_ids: dict[str, set] = {pid: set() for pid in requested_pids}
        for pid in requested_pids:
            if pid in crew_pids:
                person_game_ids[pid] = set(game_by_id.keys())
        if game_by_id:
            assignments = (
                supabase.table("game_assignments")
                .select("personnel_id, game_id")
                .in_("game_id", list(game_by_id.keys()))
                .in_("personnel_id", requested_pids)
                .execute()
                .data
            ) or []
            for a in assignments:
                pid = a["personnel_id"]
                if pid in person_game_ids:
                    person_game_ids[pid].add(a["game_id"])

        # Same fallback sync-nominations uses: a tournament competition whose
        # game schedule hasn't been loaded yet bounds the stay by the training
        # schedule instead.
        training_travel = (
            _derive_travel_from_training(competition_id, competition)
            if tournament and not games else {}
        )

        for pid in requested_pids:
            role = role_by_pid.get(pid)
            if not role:
                continue  # unknown personnel id — nothing to derive
            person_games = [game_by_id[gid] for gid in person_game_ids.get(pid, set())
                             if gid in game_by_id]
            sorted_dates = sorted({g["date"] for g in person_games if g.get("date")})
            derived, _multi_sede = (
                _derive_travel(person_games, competition) if person_games else ({}, False)
            )
            if not derived:
                derived = dict(training_travel)

            entry: dict = {"role": role}
            if sorted_dates:
                entry["game_dates"] = [
                    {"label": f"{label_prefix} {i + 1}", "date": d}
                    for i, d in enumerate(sorted_dates)
                ]
            for field in ("arrival_date", "departure_date", "venue", "location"):
                if field in derived:
                    entry[field] = derived[field]

            fee_overrides = _build_default_overrides(competition, role)
            if "window_fee" in fee_overrides:
                entry["window_fee"] = fee_overrides["window_fee"]
            if "incidentals" in fee_overrides:
                entry["incidentals"] = fee_overrides["incidentals"]

            people[pid] = entry

    return {
        "competition": {
            "id": competition["id"],
            "name": competition.get("name"),
            "template_key": competition.get("template_key"),
            "fee_type": competition.get("fee_type") or "per_game",
            "kind": kind,
            "is_tournament": tournament,
        },
        "defaults": defaults,
        "fees_by_role": fees_by_role,
        "game_dates": game_dates,
        "assigned_personnel_ids": assigned_personnel_ids,
        "people": people,
        "required_fields": required_fields_for(competition),
    }


@router.get("/{nomination_id}")
def get_nomination(nomination_id: str):
    result = supabase.table("nominations").select(
        "*, personnel(name, role, email), competitions(name, template_key, year, fee_type)"
    ).eq("id", nomination_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Nomination not found")
    return result.data[0]


@router.patch("/{nomination_id}", dependencies=[Depends(require_edit("nominations"))])
def update_nomination(nomination_id: str, data: NominationUpdate):
    """Edit an existing nomination. Only the fields present in the body are
    written (blank/unset fields are left alone) — this is the endpoint the
    "New nomination" form's edit mode uses once prefill data has been
    reviewed and tweaked.
    """
    record = data.model_dump(exclude_unset=True)
    if "game_dates" in record and record["game_dates"] is not None:
        record["game_dates"] = [
            gd if isinstance(gd, dict) else gd.model_dump()
            for gd in record["game_dates"]
        ]
    if not record:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = supabase.table("nominations").update(record).eq("id", nomination_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Nomination not found")
    return get_nomination(nomination_id)


@router.post("/{nomination_id}/generate", dependencies=[Depends(require_edit("nominations"))])
def generate_nomination_doc(nomination_id: str):
    result = supabase.table("nominations").select(
        "*, personnel(name, role, email), competitions(name, template_key, year, fee_type)"
    ).eq("id", nomination_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Nomination not found")

    nom = result.data[0]
    personnel = nom["personnel"]
    competition = nom["competitions"]

    missing = missing_fields(nom, competition)
    if missing:
        raise HTTPException(status_code=422, detail={
            "code": "missing_fields",
            "missing": missing,
            "message": f"Missing: {', '.join(missing)}",
        })

    nom_data = letter_data_for(nom)

    try:
        local_path, storage_url, conversion_error = generate_nomination(nom_data)
    except Exception:
        # Loguear el traceback real: sin esto, un fallo de LibreOffice/docxtpl
        # no deja ningún rastro server-side y journalctl no ayuda a debuggear.
        logger.exception("generate_nomination_doc failed for nomination %s", nomination_id)
        raise HTTPException(status_code=500, detail="Document generation failed. Please try again.")

    # Save the best available path
    saved_path = storage_url if storage_url else local_path

    update_data = {
        "status": "generated",
        "pdf_path": saved_path,
    }

    supabase.table("nominations").update(update_data).eq("id", nomination_id).execute()

    ext = "docx" if conversion_error else "pdf"
    filename = f"{personnel['name']} {competition['name']} Nomination.{ext}"

    response = {
        "pdf_path": saved_path,
        "status": "generated",
        "filename": filename,
        "format": ext,
    }
    if conversion_error:
        response["conversion_error"] = conversion_error

    return response


# ─── Preview (real data, nothing persisted) ─────────────────────────────────

def _render_preview(nom_data: dict) -> tuple[str, str, str | None]:
    """Render a letter from real nomination data without touching the DB or
    Storage. Same shape as templates.generate_preview: a fresh temp dir per
    call (two concurrent previews must not fight over one path), .docx built
    then converted to PDF. Returns (local_path, temp_dir, conversion_error) —
    the caller owns temp_dir and must remove it once the response is sent.
    """
    import tempfile
    from pathlib import Path

    temp_dir = tempfile.mkdtemp(prefix="fiba_nom_preview_")
    try:
        doc = _build_doc(nom_data)
        docx_path = Path(temp_dir) / "preview.docx"
        doc.save(str(docx_path))
        pdf_path, conversion_error = _convert_to_pdf(str(docx_path))
    except Exception:
        # Nobody will ever own this dir if we raise — clean it up ourselves
        # instead of leaking one per failed preview.
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    return (pdf_path if pdf_path else str(docx_path)), temp_dir, conversion_error


def _serve_preview(nom_data: dict, missing: list[str]):
    """Render nom_data and stream it back inline, same response shape as
    templates.preview_template (PDF inline, .docx fallback with
    X-Conversion-Error when LibreOffice is unavailable). Adds X-Missing-Fields
    when the source nomination is incomplete — the preview still renders so
    the user can see exactly what's blank.
    """
    try:
        path, temp_dir, conversion_error = _render_preview(nom_data)
    except Exception:
        logger.exception("Nomination preview failed")
        raise HTTPException(status_code=500, detail="Preview generation failed. Please try again.")

    cleanup = BackgroundTask(shutil.rmtree, temp_dir, ignore_errors=True)

    headers = {}
    if missing:
        headers["X-Missing-Fields"] = ",".join(missing)

    is_pdf = path.endswith(".pdf")
    if conversion_error and not is_pdf:
        headers["X-Conversion-Error"] = conversion_error[:200]
        return FileResponse(
            path,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename="Nomination_preview.docx",
            headers=headers,
            background=cleanup,
        )

    headers["Content-Disposition"] = 'inline; filename="Nomination_preview.pdf"'
    return FileResponse(
        path,
        media_type="application/pdf",
        headers=headers,
        background=cleanup,
    )


@router.post("/{nomination_id}/preview")
def preview_nomination(nomination_id: str):
    """Render this nomination's letter with its real, currently-saved data
    and serve it inline. Read-only: doesn't touch status/pdf_path and never
    uploads to Storage — that's what /generate is for.
    """
    result = supabase.table("nominations").select(
        "*, personnel(name, role, email), competitions(name, template_key, year, fee_type)"
    ).eq("id", nomination_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Nomination not found")

    nom = result.data[0]
    competition = nom["competitions"]
    missing = missing_fields(nom, competition)
    return _serve_preview(letter_data_for(nom), missing)


@router.post("/preview")
def preview_nomination_from_data(data: NominationCreate):
    """Render a letter preview for a nomination that hasn't been created yet,
    from the form's current values — used by "New nomination" before the user
    saves anything. Same rendering path as /{id}/preview.
    """
    competition = get_competition(data.competition_id)
    if not competition:
        raise HTTPException(status_code=404, detail="Competition not found")
    person = (
        supabase.table("personnel")
        .select("name, role, email")
        .eq("id", data.personnel_id)
        .execute()
        .data
    )
    if not person:
        raise HTTPException(status_code=404, detail="Personnel not found")

    nom = data.model_dump()
    if nom.get("game_dates"):
        nom["game_dates"] = [
            gd if isinstance(gd, dict) else gd.model_dump()
            for gd in nom["game_dates"]
        ]
    nom["personnel"] = person[0]
    nom["competitions"] = competition

    missing = missing_fields(nom, competition)
    return _serve_preview(letter_data_for(nom), missing)


# ─── Download ────────────────────────────────────────────────────────────────

def _fetch_stored_document(pdf_path: str | None) -> tuple[bytes, str] | None:
    """Fetch a nomination's generated file (bytes, ext) from Storage — or from
    local disk in dev mode. Returns None when there's nothing to serve, so
    callers decide the right status code (404 for a single download, "skip
    and count" for a zip of several).

    Shared by download_nomination and download_nominations_zip so the
    storage-path handling (storage:// / legacy public URL / local file) lives
    in exactly one place.
    """
    import httpx

    if not pdf_path:
        return None

    ext = "pdf" if pdf_path.endswith(".pdf") or "pdf" in pdf_path.lower() else "docx"

    SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
    SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or os.environ.get("SUPABASE_KEY", "")
    storage_object_url = None

    if pdf_path.startswith("storage://"):
        # storage://<bucket>/<path>. Nomination docs always live in the
        # private `nominations` bucket; pin it here so a stray bucket name in
        # the stored path can never redirect the authenticated fetch elsewhere.
        rest = pdf_path[len("storage://"):]
        bucket, _, key = rest.partition("/")
        if bucket != "nominations":
            return None
        storage_object_url = f"{SUPABASE_URL}/storage/v1/object/nominations/{key}"
    elif pdf_path.startswith("http") and "/storage/v1/object/public/nominations/" in pdf_path:
        # Legacy public URL: same key, bucket is now private.
        key = pdf_path.split("/storage/v1/object/public/nominations/", 1)[1]
        storage_object_url = f"{SUPABASE_URL}/storage/v1/object/nominations/{key}"
    # No generic http passthrough: never forward the service_role key to an
    # arbitrary URL (SSRF + credential leak). Anything else falls through to
    # "not available" below.

    if storage_object_url:
        try:
            headers = {"Authorization": f"Bearer {SUPABASE_KEY}", "apikey": SUPABASE_KEY}
            resp = httpx.get(storage_object_url, headers=headers, timeout=30.0, follow_redirects=True)
            if resp.status_code != 200:
                return None
            return resp.content, ext
        except Exception:
            logger.warning("[storage fetch] could not fetch %s", storage_object_url)
            return None

    # Local file (dev mode only)
    if os.path.exists(pdf_path):
        with open(pdf_path, "rb") as f:
            return f.read(), ext
    return None


@router.get("/{nomination_id}/download")
def download_nomination(nomination_id: str, filename: str = None):
    result = supabase.table("nominations").select(
        "pdf_path, personnel(name), competitions(name)"
    ).eq("id", nomination_id).execute()

    if not result.data or not result.data[0].get("pdf_path"):
        raise HTTPException(status_code=404, detail="Document not generated yet")

    nom = result.data[0]
    doc_path = nom["pdf_path"]

    fetched = _fetch_stored_document(doc_path)
    if not fetched:
        raise HTTPException(status_code=404, detail="Document not available. Try regenerating.")
    content, ext = fetched

    # Build filename if not provided
    if not filename:
        p_name = nom.get("personnel", {}).get("name", "Nomination")
        c_name = nom.get("competitions", {}).get("name", "")
        filename = f"{p_name} {c_name} Nomination.{ext}"

    # Sanitize filename to prevent header injection
    filename = _SAFE_FILENAME_RE.sub('', filename).strip()
    if not filename:
        filename = f"Nomination.{ext}"

    media_type = (
        "application/pdf" if ext == "pdf"
        else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "private, no-store",
        },
    )


class DownloadZipRequest(BaseModel):
    nomination_ids: list[str]


@router.post("/download-zip")
def download_nominations_zip(data: DownloadZipRequest):
    """Download the generated documents of several nominations as one zip.
    Nominations without a saved document are skipped (counted in
    X-Skipped), not treated as an error — a mixed selection of generated and
    not-yet-generated nominations is the normal case from a list view.
    """
    if not data.nomination_ids:
        raise HTTPException(status_code=400, detail="No nominations selected")
    if len(data.nomination_ids) > _MAX_BULK:
        raise HTTPException(status_code=400, detail=f"Maximum {_MAX_BULK} items per request")

    rows = (
        supabase.table("nominations")
        .select("id, pdf_path, personnel(name), competitions(id, name)")
        .in_("id", data.nomination_ids)
        .execute()
        .data
    ) or []

    buffer = io.BytesIO()
    name_counts: dict[str, int] = {}  # "base.ext" -> how many entries share it
    written = 0
    skipped = 0
    comp_ids: set = set()
    comp_names: set = set()

    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for row in rows:
            fetched = _fetch_stored_document(row.get("pdf_path"))
            if not fetched:
                skipped += 1
                continue
            content, ext = fetched

            personnel = row.get("personnel") or {}
            competition = row.get("competitions") or {}
            comp_ids.add(competition.get("id"))
            if competition.get("name"):
                comp_names.add(competition["name"])

            base = f"{personnel.get('name') or 'Nomination'} {competition.get('name') or ''} Nomination".strip()
            base = _SAFE_FILENAME_RE.sub('', base).strip() or "Nomination"
            key = f"{base}.{ext}"
            count = name_counts.get(key, 0) + 1
            name_counts[key] = count
            entry_name = key if count == 1 else f"{base} ({count}).{ext}"
            zf.writestr(entry_name, content)
            written += 1

    if written == 0:
        raise HTTPException(status_code=404, detail="No generated documents in the selection")

    buffer.seek(0)
    zip_name = "Nominations.zip"
    if len(comp_ids) == 1 and len(comp_names) == 1:
        clean = _SAFE_FILENAME_RE.sub('', next(iter(comp_names))).strip()
        if clean:
            zip_name = f"Nominations {clean}.zip"

    return Response(
        content=buffer.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{zip_name}"',
            "X-Skipped": str(skipped),
            "Cache-Control": "private, no-store",
        },
    )
