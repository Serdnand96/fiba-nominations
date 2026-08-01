"""
Game Schedule router — CRUD for competition game schedules,
FIBA website scraping for auto-import, results sync, and per-game
TD/VGO assignments (WCQ, BCLA, LSB).
"""
import io
import os
import re
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta, timezone

from api._lib.database import supabase
from api._lib.auth import require_view, require_edit
from api._lib.crew import get_competition, is_tournament_mode, list_crew
from api._lib.net import safe_get
from api._lib.roles import VALID_ROLES
from api._lib.travel import sede_pairs, format_sedes

router = APIRouter(prefix="/games", tags=["games"], dependencies=[Depends(require_view("games"))])

# Templates that support per-game TD/VGO assignment from the Games page.
# Tournament-fee competitions get the assignment workflow too, whatever their
# template: there the crew is competition-level (see api/_lib/crew.py).
ASSIGNMENT_TEMPLATES = {"WCQ", "BCLA", "LSB"}

_MAX_UPLOAD_BYTES = 5 * 1024 * 1024


# ── Schemas ──────────────────────────────────────────────────────────────────

class GameCreate(BaseModel):
    competition_id: str
    game_number: Optional[str] = None
    date: str
    time: Optional[str] = None
    team_a: str
    team_a_code: Optional[str] = None
    team_a_country: Optional[str] = None  # club's country (FIBA code) — club comps
    team_b: str
    team_b_code: Optional[str] = None
    team_b_country: Optional[str] = None
    score_a: Optional[int] = None
    score_b: Optional[int] = None
    venue: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    phase: str = "Group Phase"
    group_label: Optional[str] = None
    status: str = "scheduled"
    sport: str = "Basketball"
    fiba_game_id: Optional[int] = None


class GameUpdate(BaseModel):
    date: Optional[str] = None
    time: Optional[str] = None
    team_a: Optional[str] = None
    team_a_code: Optional[str] = None
    team_a_country: Optional[str] = None
    team_b: Optional[str] = None
    team_b_code: Optional[str] = None
    team_b_country: Optional[str] = None
    score_a: Optional[int] = None
    score_b: Optional[int] = None
    venue: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    phase: Optional[str] = None
    group_label: Optional[str] = None
    status: Optional[str] = None


class BulkGameCreate(BaseModel):
    competition_id: str
    games: List[GameCreate]


# ── List / Detail ────────────────────────────────────────────────────────────

@router.get("")
def list_games(competition_id: str = Query(...)):
    """List all games for a competition, ordered by date+time."""
    games = (
        supabase.table("game_schedule")
        .select("*")
        .eq("competition_id", competition_id)
        .order("date")
        .execute()
        .data
    )
    games.sort(key=lambda g: (g["date"], g.get("time") or ""))
    return games


@router.get("/by-date")
def list_games_by_date(competition_id: str = Query(...), date: str = Query(...)):
    """List games for a specific date."""
    games = (
        supabase.table("game_schedule")
        .select("*")
        .eq("competition_id", competition_id)
        .eq("date", date)
        .order("date")
        .execute()
        .data
    )
    games.sort(key=lambda g: g.get("time") or "")
    return games


@router.get("/teams")
def list_teams(competition_id: str = Query(...)):
    """Extract unique team names from game schedule."""
    games = (
        supabase.table("game_schedule")
        .select("team_a,team_a_code,team_b,team_b_code")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    teams = {}
    for g in games:
        if g["team_a"] and g["team_a"] not in teams:
            teams[g["team_a"]] = g.get("team_a_code") or ""
        if g["team_b"] and g["team_b"] not in teams:
            teams[g["team_b"]] = g.get("team_b_code") or ""

    return [{"name": name, "code": code} for name, code in sorted(teams.items())]


@router.get("/dates")
def list_game_dates(competition_id: str = Query(...)):
    """List unique dates that have games."""
    games = (
        supabase.table("game_schedule")
        .select("date")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    dates = sorted(set(g["date"] for g in games))
    return dates


@router.get("/{game_id}")
def get_game(game_id: str):
    r = supabase.table("game_schedule").select("*").eq("id", game_id).execute()
    if not r.data:
        raise HTTPException(404, "Game not found")
    return r.data[0]


# ── CRUD ─────────────────────────────────────────────────────────────────────

@router.post("", dependencies=[Depends(require_edit("games"))])
def create_game(data: GameCreate):
    record = data.model_dump()
    result = supabase.table("game_schedule").insert(record).execute()
    return result.data[0]


@router.post("/bulk", dependencies=[Depends(require_edit("games"))])
def bulk_create_games(data: BulkGameCreate):
    """Bulk create games with dedup by (competition_id, date, time, team_a, team_b)."""
    if len(data.games) > 200:
        raise HTTPException(400, "Maximum 200 games per request")

    created = 0
    updated = 0
    errors = []

    for game in data.games:
        try:
            record = game.model_dump()
            record["competition_id"] = data.competition_id

            # Check existing
            q = (
                supabase.table("game_schedule")
                .select("id")
                .eq("competition_id", data.competition_id)
                .eq("date", record["date"])
                .eq("team_a", record["team_a"])
                .eq("team_b", record["team_b"])
            )
            existing = q.execute().data

            if existing:
                supabase.table("game_schedule").update({
                    "time": record.get("time"),
                    "score_a": record.get("score_a"),
                    "score_b": record.get("score_b"),
                    "venue": record.get("venue"),
                    "status": record.get("status", "scheduled"),
                    "updated_at": datetime.utcnow().isoformat(),
                }).eq("id", existing[0]["id"]).execute()
                updated += 1
            else:
                supabase.table("game_schedule").insert(record).execute()
                created += 1
        except Exception as e:
            errors.append({"game": f"{game.team_a} vs {game.team_b}", "error": str(e)})

    return {"created": created, "updated": updated, "errors": errors}


@router.put("/{game_id}", dependencies=[Depends(require_edit("games"))])
def update_game(game_id: str, data: GameUpdate):
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    updates["updated_at"] = datetime.utcnow().isoformat()
    r = supabase.table("game_schedule").update(updates).eq("id", game_id).execute()
    if not r.data:
        raise HTTPException(404, "Game not found")
    return r.data[0]


@router.delete("/{game_id}", dependencies=[Depends(require_edit("games"))])
def delete_game(game_id: str):
    supabase.table("game_schedule").delete().eq("id", game_id).execute()
    return {"ok": True}


# ── Sync results (update scores from FIBA) ───────────────────────────────────

@router.post("/sync-results", dependencies=[Depends(require_edit("games"))])
def sync_results(competition_id: str = Query(...)):
    """Fetch latest results from FIBA website and update scores."""
    # Get competition to find the FIBA URL
    comp = supabase.table("competitions").select("fiba_games_url").eq("id", competition_id).execute().data
    if not comp or not comp[0].get("fiba_games_url"):
        raise HTTPException(400, "Competition has no FIBA games URL configured")

    fiba_url = comp[0]["fiba_games_url"]

    try:
        games_data = _scrape_fiba_games(fiba_url)
    except Exception as e:
        raise HTTPException(500, f"Failed to fetch games from FIBA: {str(e)}")

    if not games_data:
        return {"synced": 0, "message": "No games found on FIBA page"}

    # Get existing games
    existing = supabase.table("game_schedule").select("*").eq("competition_id", competition_id).execute().data

    synced = 0
    created = 0

    for fiba_game in games_data:
        # Try to match by fiba_game_id first
        match = None
        if fiba_game.get("fiba_game_id"):
            match = next((e for e in existing if e.get("fiba_game_id") == fiba_game["fiba_game_id"]), None)

        # Fallback: match by date + teams
        if not match:
            match = next(
                (e for e in existing
                 if e["date"] == fiba_game["date"]
                 and e["team_a"] == fiba_game["team_a"]
                 and e["team_b"] == fiba_game["team_b"]),
                None,
            )

        if match:
            # Update scores and status
            update_data = {"updated_at": datetime.utcnow().isoformat()}
            if fiba_game.get("score_a") is not None:
                update_data["score_a"] = fiba_game["score_a"]
            if fiba_game.get("score_b") is not None:
                update_data["score_b"] = fiba_game["score_b"]
            if fiba_game.get("status"):
                update_data["status"] = fiba_game["status"]

            supabase.table("game_schedule").update(update_data).eq("id", match["id"]).execute()
            synced += 1
        else:
            # Create new game
            record = {
                "competition_id": competition_id,
                **fiba_game,
            }
            try:
                supabase.table("game_schedule").insert(record).execute()
                created += 1
            except Exception:
                pass

    return {"synced": synced, "created": created, "total_from_fiba": len(games_data)}


# ── FIBA API integration ────────────────────────────────────────────────────

_FIBA_API_BASE = "https://digital-api.fiba.basketball/hapi"
# Subscription key for FIBA's GDAP API. Read from the environment — never
# hardcode it (the previous literal was committed and must be rotated).
_FIBA_API_KEY = os.environ.get("FIBA_API_KEY", "")


def _scrape_fiba_games(fiba_url: str) -> list:
    """Fetch game data from FIBA's API. Accepts either:
    - A FIBA event page URL (extracts competitionId from the page)
    - A direct GDAP competition ID (numeric string)
    """
    import httpx

    competition_id = _extract_fiba_competition_id(fiba_url)
    if not competition_id:
        raise Exception(f"Could not extract FIBA competition ID from: {fiba_url[:100]}")

    # Call the FIBA GDAP API directly
    api_url = f"{_FIBA_API_BASE}/getgdapgamesbycompetitionid"
    with httpx.Client(timeout=30.0) as client:
        resp = client.get(
            api_url,
            params={"gdapCompetitionId": competition_id},
            headers={
                "Ocp-Apim-Subscription-Key": _FIBA_API_KEY,
                "Accept": "application/json",
                "Accept-Encoding": "gzip, deflate",
            },
        )
    if resp.status_code != 200:
        raise Exception(f"FIBA API HTTP {resp.status_code}: {resp.text[:200]}")

    data = resp.json()

    # The API returns an array of game objects
    games_list = data if isinstance(data, list) else data.get("games", data.get("data", []))
    if not isinstance(games_list, list):
        raise Exception(f"Unexpected FIBA API format: {type(data).__name__}")

    return [_fiba_json_to_game(g) for g in games_list if g.get("gameId")]


def _extract_fiba_competition_id(fiba_url: str) -> str | None:
    """Extract the GDAP competitionId from a FIBA URL or RSC payload."""
    # If it's already a numeric ID, return it
    stripped = fiba_url.strip()
    if stripped.isdigit():
        return stripped

    # Fetch the page and look for competitionId in the RSC payload.
    # safe_get is an SSRF guard: it rejects non-http(s) URLs and any host that
    # resolves to a private/internal address, re-checking each redirect hop.
    try:
        resp = safe_get(stripped, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept-Encoding": "gzip, deflate",
        })
        if resp.status_code != 200:
            return None

        html = resp.text

        # The RSC payload contains escaped JSON like:
        # \"competitionId\":209032  or  "competitionId":209032
        all_patterns = [
            re.compile(r'\\?"gdapCompetitionId\\?"\s*:\s*\\?"?(\d+)\\?"?'),
            re.compile(r'\\?"competitionId\\?"\s*:\s*\\?"?(\d+)\\?"?'),
            re.compile(r'"gdapCompetitionId"\s*:\s*"?(\d+)"?'),
            re.compile(r'"competitionId"\s*:\s*"?(\d+)"?'),
            re.compile(r'competitionId[=:](\d+)'),
        ]
        for pattern in all_patterns:
            m = pattern.search(html)
            if m:
                return m.group(1)
    except Exception:
        pass

    return None


def _fiba_json_to_game(g: dict) -> dict:
    """Convert a FIBA API game object to our schema."""
    game_dt = g.get("gameDateTime", "") or ""
    date_str = game_dt[:10] if game_dt else ""
    time_str = game_dt[11:16] if len(game_dt) >= 16 else ""

    score_a = g.get("teamAScore")
    score_b = g.get("teamBScore")

    if g.get("isLive", False):
        status = "live"
    elif score_a is not None and score_b is not None:
        status = "completed"
    else:
        status = "scheduled"

    team_a = g.get("teamA") or {}
    team_b = g.get("teamB") or {}

    return {
        "fiba_game_id": g.get("gameId"),
        "game_number": g.get("gameName"),
        "date": date_str,
        "time": time_str,
        "team_a": team_a.get("officialName") or team_a.get("shortName", ""),
        "team_a_code": team_a.get("code", ""),
        "team_b": team_b.get("officialName") or team_b.get("shortName", ""),
        "team_b_code": team_b.get("code", ""),
        "score_a": score_a,
        "score_b": score_b,
        "venue": g.get("venueName", ""),
        "city": g.get("hostCity", ""),
        "country": g.get("hostCountry", "") or g.get("country", ""),
        "phase": _detect_phase(g),
        "group_label": g.get("groupPairingCode"),
        "status": status,
        "sport": "Basketball",
    }


def _detect_phase(g: dict) -> str:
    """Detect game phase from the FIBA game name / pairing code."""
    name = (g.get("gameName") or "").lower()
    pairing = (g.get("groupPairingCode") or "").lower()

    if "final" in name or "final" in pairing:
        return "Finals"
    if "semi" in name or "semi" in pairing:
        return "Semifinals"
    if "quarter" in name or "qf" in pairing:
        return "Quarterfinals"
    if "class" in name or "class" in pairing:
        return "Classification"
    return "Group Phase"


# ── Excel import ─────────────────────────────────────────────────────────────

@router.post("/import/excel", dependencies=[Depends(require_edit("games"))])
async def import_games_excel(
    file: UploadFile = File(...),
    competition_id: str = Form(...),
):
    """Import games from an Excel file."""
    fname = (file.filename or "").lower()
    if not fname.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only Excel files accepted")

    content = await file.read()
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large (max 5 MB)")

    try:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
        ws = wb.active
    except Exception:
        raise HTTPException(400, "Unable to parse Excel file")

    games = []
    rows = list(ws.iter_rows(min_row=2, values_only=True))  # Skip header

    for row in rows:
        if len(row) < 4:
            continue
        date_val = row[0]
        time_val = row[1] if len(row) > 1 else None
        team_a = row[2] if len(row) > 2 else None
        team_b = row[3] if len(row) > 3 else None

        if not date_val or not team_a or not team_b:
            continue

        # Parse date
        if isinstance(date_val, datetime):
            date_str = date_val.strftime("%Y-%m-%d")
        else:
            date_str = str(date_val).strip()

        # Parse time
        time_str = ""
        if time_val:
            if isinstance(time_val, datetime):
                time_str = time_val.strftime("%H:%M")
            else:
                time_str = str(time_val).strip()[:5]

        venue = str(row[4]).strip() if len(row) > 4 and row[4] else ""
        phase = str(row[5]).strip() if len(row) > 5 and row[5] else "Group Phase"
        group = str(row[6]).strip() if len(row) > 6 and row[6] else ""

        games.append({
            "competition_id": competition_id,
            "date": date_str,
            "time": time_str,
            "team_a": str(team_a).strip(),
            "team_b": str(team_b).strip(),
            "venue": venue,
            "phase": phase,
            "group_label": group,
            "status": "scheduled",
            "sport": "Basketball",
        })

    if not games:
        return {"imported": 0, "errors": []}

    created = 0
    errors = []
    for g in games:
        try:
            supabase.table("game_schedule").insert(g).execute()
            created += 1
        except Exception as e:
            errors.append({"game": f"{g['team_a']} vs {g['team_b']}", "error": str(e)})

    return {"imported": created, "errors": errors}


# ── Per-game TD/VGO/referee assignments (WCQ / BCLA / LSB) ──────────────────

# Referee crew slots (neutrality-checked): Crew Chief + Umpire 1 + Umpire 2.
REF_SLOTS = ("CC", "U1", "U2")
# personnel.role expected for each assignment slot. INSTR (Referee
# Instructor) and VO (Video Operator) are nominated per game like TD/VGO but
# are NOT subject to the neutrality restriction.
_SLOT_EXPECTED_ROLE = {
    "TD": "TD",
    "VGO": "VGO",
    "CC": "REF",
    "U1": "REF",
    "U2": "REF",
    "INSTR": "REF_INSTRUCTOR",
    "VO": "VIDEO_OPERATOR",
}
# Optional extra official (one per game): venues that carry an additional
# table official. Accepts TD or VGO people; fees/letters use the person's
# real role, not the slot.
_EXTRA_SLOT = "EXTRA"
_EXTRA_ALLOWED_ROLES = ("TD", "VGO")


class AssignmentCreate(BaseModel):
    game_id: str
    personnel_id: str
    role: str  # 'TD' | 'VGO' | 'CC' | 'U1' | 'U2' | 'INSTR' | 'VO' | 'EXTRA'


def _competition_supports_assignments(competition_id: str) -> bool:
    comp = (
        supabase.table("competitions")
        .select("template_key, fee_type")
        .eq("id", competition_id)
        .execute()
        .data
    )
    if not comp:
        return False
    if is_tournament_mode(comp[0]):
        return True
    return (comp[0].get("template_key") or "").upper() in ASSIGNMENT_TEMPLATES


def _referee_conflict(game: dict, person: dict) -> dict | None:
    """Neutrality check (see migrations 014/015).

    - National-team competitions (is_national_team): a referee cannot work a
      game their own country plays, nor any game of the group their country
      plays in.
    - Club competitions: a referee only cannot work games where a club from
      their country plays (team_a_country / team_b_country). No group rule.

    Returns a conflict payload, or None when the assignment is allowed.
    People whose country we cannot resolve to a FIBA code are never blocked,
    and neither are club games whose team countries haven't been filled in.
    """
    from api._lib.countries import (
        person_country_codes, special_blocked_codes, game_country_codes,
        country_display_name, SPECIAL_DIRECT_BLOCKS,
    )

    person_codes = person_country_codes(person)
    if not person_codes:
        return None
    # Game-level-only extra blocks (e.g. PUR referees cannot work USA games,
    # though USA's group stays allowed).
    special_codes = special_blocked_codes(person_codes)

    comp = (
        supabase.table("competitions")
        .select("is_national_team")
        .eq("id", game["competition_id"])
        .execute()
        .data
    )
    if not comp:
        return None
    is_national_team = bool(comp[0].get("is_national_team"))

    def _base(matched: str) -> dict:
        return {
            "code": "referee_neutrality",
            "country_code": matched,
            "country": country_display_name(matched),
            "person_name": person.get("name") or "",
        }

    def _special_payload(matched: str, **extra) -> dict:
        origin = next(
            (o for o in person_codes if matched in SPECIAL_DIRECT_BLOCKS.get(o, ())),
            "",
        )
        return {
            **_base(matched),
            "reason": "special_pair",
            "origin": origin,
            "origin_country": country_display_name(origin),
            **extra,
        }

    if not is_national_team:
        # Club rule: blocks only the games where a club from one of the
        # referee's countries (or a special-pair country) plays.
        for side in ("a", "b"):
            club_country = (game.get(f"team_{side}_country") or "").strip().upper()
            if not club_country:
                continue
            team_name = game.get(f"team_{side}") or ""
            if club_country in person_codes:
                return {**_base(club_country), "reason": "own_club", "team": team_name}
            if club_country in special_codes:
                return _special_payload(club_country, team=team_name)
        return None

    game_codes = game_country_codes(game)
    own_direct = game_codes & person_codes
    if own_direct:
        return {**_base(sorted(own_direct)[0]), "reason": "own_country"}
    special_direct = game_codes & special_codes
    if special_direct:
        return _special_payload(sorted(special_direct)[0])

    group = game.get("group_label")
    if group:
        group_games = (
            supabase.table("game_schedule")
            .select("team_a, team_a_code, team_b, team_b_code")
            .eq("competition_id", game["competition_id"])
            .eq("group_label", group)
            .execute()
            .data
        )
        for g in group_games:
            matched = game_country_codes(g) & person_codes
            if matched:
                return {**_base(sorted(matched)[0]), "reason": "own_group", "group": group}
    return None


# ── Tournament crew (competition-level roster) ──────────────────────────────
# On fee_type = 'tournament' competitions the crew covers every game and every
# training slot; per-game rows are only an optional override. Editable from
# here and from the Calendar panel — same table, same data.

class CrewCreate(BaseModel):
    competition_id: str
    personnel_id: str
    role: Optional[str] = None  # defaults to the person's own role


@router.get("/crew/by-competition")
def list_crew_by_competition(competition_id: str = Query(...)):
    """Competition-level crew, with personnel joined. Includes the fee mode so
    the client knows whether this roster covers every game (tournament) or is
    just informative (per-game)."""
    competition = get_competition(competition_id)
    if not competition:
        raise HTTPException(404, "Competition not found")
    return {
        "fee_type": competition.get("fee_type") or "per_game",
        "covers_all_games": is_tournament_mode(competition),
        "crew": list_crew(competition_id),
    }


@router.post("/crew", dependencies=[Depends(require_edit("games"))])
def add_crew_member(data: CrewCreate):
    competition = get_competition(data.competition_id)
    if not competition:
        raise HTTPException(404, "Competition not found")

    person = (
        supabase.table("personnel")
        .select("id, name, role, country, country_code, nationalities")
        .eq("id", data.personnel_id)
        .execute()
        .data
    )
    if not person:
        raise HTTPException(404, "Personnel not found")
    person = person[0]

    role = (data.role or person.get("role") or "").strip().upper()
    if role not in VALID_ROLES:
        raise HTTPException(400, f"role must be one of {', '.join(VALID_ROLES)}")

    # One row per person per competition (DB unique) — surface it as a 409
    # instead of letting the insert blow up.
    existing = (
        supabase.table("competition_assignments")
        .select("id, role")
        .eq("competition_id", data.competition_id)
        .eq("personnel_id", data.personnel_id)
        .execute()
        .data
    )
    if existing:
        raise HTTPException(409, "This person is already in the crew")

    record = {
        "competition_id": data.competition_id,
        "personnel_id": data.personnel_id,
        "role": role,
    }
    created = supabase.table("competition_assignments").insert(record).execute().data[0]

    # Referee neutrality at tournament level is informative, not a block: a
    # referee can be part of the crew and simply not work the games of their
    # own country (those are blocked per game, in create_assignment).
    warnings = []
    if role == "REF":
        games = (
            supabase.table("game_schedule")
            .select("id, team_a, team_a_code, team_a_country, team_b, team_b_code, "
                    "team_b_country, group_label, competition_id")
            .eq("competition_id", data.competition_id)
            .execute()
            .data
        ) or []
        for g in games:
            if _referee_conflict(g, person):
                warnings.append(f"{g.get('team_a') or ''} vs {g.get('team_b') or ''}")
    return {**created, "personnel": person, "neutrality_warnings": warnings}


@router.delete("/crew/{assignment_id}", dependencies=[Depends(require_edit("games"))])
def remove_crew_member(assignment_id: str):
    result = (
        supabase.table("competition_assignments")
        .delete()
        .eq("id", assignment_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Crew assignment not found")
    return {"ok": True}


@router.get("/assignments/by-competition")
def list_assignments_by_competition(competition_id: str = Query(...)):
    """All assignments for a competition's games, with personnel name/role joined."""
    games = (
        supabase.table("game_schedule")
        .select("id")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    if not games:
        return []
    game_ids = [g["id"] for g in games]
    # country_code / nationalities travel with the row so the card can flag an
    # already-assigned referee who became non-neutral (teams changed after the
    # assignment, or the row predates the neutrality check).
    result = (
        supabase.table("game_assignments")
        .select("*, personnel(id, name, role, email, country, country_code, nationalities)")
        .in_("game_id", game_ids)
        .execute()
    )
    return result.data


@router.post("/assignments", dependencies=[Depends(require_edit("games"))])
def create_assignment(data: AssignmentCreate):
    role = (data.role or "").upper()
    if role not in _SLOT_EXPECTED_ROLE and role != _EXTRA_SLOT:
        raise HTTPException(
            400, f"Role must be one of {', '.join([*_SLOT_EXPECTED_ROLE, _EXTRA_SLOT])}")

    # Verify the game exists and its competition supports assignments
    game = (
        supabase.table("game_schedule")
        .select("id, competition_id, team_a, team_a_code, team_a_country, "
                "team_b, team_b_code, team_b_country, group_label")
        .eq("id", data.game_id)
        .execute()
        .data
    )
    if not game:
        raise HTTPException(404, "Game not found")
    competition = get_competition(game[0]["competition_id"])
    tournament = is_tournament_mode(competition)
    if not competition or not (
        tournament or (competition.get("template_key") or "").upper() in ASSIGNMENT_TEMPLATES
    ):
        raise HTTPException(400, "This competition does not support per-game assignments")

    # Verify personnel role matches the slot (CC/U1/U2 → REF)
    person = (
        supabase.table("personnel")
        .select("id, name, role, country, country_code, nationalities")
        .eq("id", data.personnel_id)
        .execute()
        .data
    )
    if not person:
        raise HTTPException(404, "Personnel not found")
    person_role = (person[0].get("role") or "").upper()
    if role == _EXTRA_SLOT:
        if person_role not in _EXTRA_ALLOWED_ROLES:
            raise HTTPException(
                400, f"Extra slot takes {' or '.join(_EXTRA_ALLOWED_ROLES)} personnel")
    else:
        expected_role = _SLOT_EXPECTED_ROLE[role]
        if person_role != expected_role:
            raise HTTPException(400, f"Personnel role does not match (expected {expected_role})")

    # Referee neutrality — hard block, mirrored client-side as a pop-up.
    if role in REF_SLOTS:
        conflict = _referee_conflict(game[0], person[0])
        if conflict:
            raise HTTPException(status_code=409, detail=conflict)

    # Per-game competitions: one person per (game_id, role) — assigning again
    # replaces whoever was there. Tournament competitions: the crew already
    # covers every game, so a per-game row is an override that records who was
    # actually at the table; several people may share a slot role (two TDs),
    # and we only dedupe the exact same person.
    existing_q = (
        supabase.table("game_assignments")
        .select("*")
        .eq("game_id", data.game_id)
        .eq("role", role)
    )
    if tournament:
        existing_q = existing_q.eq("personnel_id", data.personnel_id)
    existing = existing_q.execute().data
    record = {"game_id": data.game_id, "personnel_id": data.personnel_id, "role": role}
    if existing and tournament:
        return existing[0]
    if existing:
        result = (
            supabase.table("game_assignments")
            .update({"personnel_id": data.personnel_id})
            .eq("id", existing[0]["id"])
            .execute()
        )
        return result.data[0]
    result = supabase.table("game_assignments").insert(record).execute()
    return result.data[0]


# ── Flight-purchase check (per person per competition) ───────────────────────
# The flight is to the competition venue, so the check is competition-scoped,
# not per game: ticking it for a person covers every game they're assigned to.

class FlightUpdate(BaseModel):
    competition_id: str
    personnel_id: str
    flight_booked: bool


@router.get("/flights/by-competition")
def list_flights_by_competition(competition_id: str = Query(...)):
    result = (
        supabase.table("competition_flights")
        .select("personnel_id, flight_booked, updated_at")
        .eq("competition_id", competition_id)
        .execute()
    )
    return result.data


# POST (not PUT): a PUT /flights would be captured by the earlier PUT /{game_id}
# route. Matches the POST /assignments and POST /team-countries upsert style.
@router.post("/flights", dependencies=[Depends(require_edit("games"))])
def set_flight_booked(data: FlightUpdate):
    person = (
        supabase.table("personnel")
        .select("id")
        .eq("id", data.personnel_id)
        .execute()
        .data
    )
    if not person:
        raise HTTPException(404, "Personnel not found")
    competition = (
        supabase.table("competitions")
        .select("id")
        .eq("id", data.competition_id)
        .execute()
        .data
    )
    if not competition:
        raise HTTPException(404, "Competition not found")

    existing = (
        supabase.table("competition_flights")
        .select("id")
        .eq("competition_id", data.competition_id)
        .eq("personnel_id", data.personnel_id)
        .execute()
        .data
    )
    now = datetime.now(timezone.utc).isoformat()
    if existing:
        result = (
            supabase.table("competition_flights")
            .update({"flight_booked": data.flight_booked, "updated_at": now})
            .eq("id", existing[0]["id"])
            .execute()
        )
        return result.data[0]
    result = supabase.table("competition_flights").insert({
        "competition_id": data.competition_id,
        "personnel_id": data.personnel_id,
        "flight_booked": data.flight_booked,
    }).execute()
    return result.data[0]


class TeamCountriesUpdate(BaseModel):
    competition_id: str
    # team name → FIBA country code ('' or null clears it)
    countries: dict[str, Optional[str]]


@router.post("/team-countries", dependencies=[Depends(require_edit("games"))])
def set_team_countries(data: TeamCountriesUpdate):
    """Set the club country for every game of a competition, keyed by team
    name. Used by the Games page panel so the mapping is done once per
    competition instead of game by game."""
    from api._lib.countries import COUNTRIES

    if len(data.countries) > 200:
        raise HTTPException(400, "Too many teams")

    cleaned: dict[str, str | None] = {}
    for team, code in data.countries.items():
        code = (code or "").strip().upper()
        if code and code not in COUNTRIES:
            raise HTTPException(400, f"Unknown country code '{code}' for team '{team}'")
        cleaned[team] = code or None

    updated = 0
    for team, code in cleaned.items():
        for side in ("a", "b"):
            r = (
                supabase.table("game_schedule")
                .update({f"team_{side}_country": code})
                .eq("competition_id", data.competition_id)
                .eq(f"team_{side}", team)
                .execute()
            )
            updated += len(r.data or [])
    return {"updated_sides": updated, "teams": len(cleaned)}


@router.delete("/assignments/{assignment_id}", dependencies=[Depends(require_edit("games"))])
def delete_assignment(assignment_id: str):
    result = supabase.table("game_assignments").delete().eq("id", assignment_id).execute()
    if not result.data:
        raise HTTPException(404, "Assignment not found")
    return {"ok": True}


# Assignment slot role → competition fee-column prefix
_FEE_PREFIX_BY_SLOT = {
    "TD": "td",
    "VGO": "vgo",
    "CC": "ref",
    "U1": "ref",
    "U2": "ref",
    "INSTR": "ref_instructor",
    "VO": "video_operator",
}

# Personnel role → competition fee-column prefix. Used by the tournament crew,
# which is keyed by the person's own role instead of a per-game slot.
_FEE_PREFIX_BY_PERSONNEL_ROLE = {
    "TD": "td",
    "VGO": "vgo",
    "REF": "ref",
    "REF_INSTRUCTOR": "ref_instructor",
    "VIDEO_OPERATOR": "video_operator",
}

# Arrival/departure are NOT here: travel is per person (derived from each
# person's assigned games + the competition's offset days). Location/venue
# are also derived per person; the competition values act only as fallback
# for games without venue data.
_SHARED_DEFAULT_FIELDS = (
    ("default_letter_date",           "letter_date"),
    ("default_location",              "location"),
    ("default_venue",                 "venue"),
    ("default_confirmation_deadline", "confirmation_deadline"),
)


def _derive_travel(person_games: list[dict], competition: dict) -> tuple[dict, bool]:
    """Per-person travel fields from the games the person is assigned to:
    venue/location from the games' venue data (distinct sedes in itinerary
    order — a person can cover two hosts back to back), arrival/departure
    from their first/last game date ± the competition's offset days.

    Returns (derived, multi_sede): `derived` only holds keys it could
    actually derive, so callers can layer it over the competition-level
    fallbacks; `multi_sede` flags people covering more than one sede.
    """
    derived: dict = {}
    ordered = sorted(person_games, key=lambda g: g.get("date") or "")

    venues: list[str] = []
    seen_venues: set[str] = set()
    for g in ordered:
        v = (g.get("venue") or "").strip()
        if v and v.lower() not in seen_venues:
            seen_venues.add(v.lower())
            venues.append(v)
    if venues:
        derived["venue"] = " / ".join(venues)

    pairs = sede_pairs(ordered, use_team_a=bool(competition.get("is_national_team")))
    location = format_sedes(pairs)
    if location:
        derived["location"] = location
    multi_sede = len(pairs) > 1 or len(venues) > 1

    dates = []
    for g in person_games:
        try:
            dates.append(datetime.strptime(g["date"], "%Y-%m-%d").date())
        except (KeyError, TypeError, ValueError):
            continue
    if dates:
        arr_off = competition.get("default_arrival_offset_days")
        dep_off = competition.get("default_departure_offset_days")
        arr_off = int(arr_off) if arr_off is not None else 1
        dep_off = int(dep_off) if dep_off is not None else 1
        derived["arrival_date"] = (min(dates) - timedelta(days=arr_off)).isoformat()
        derived["departure_date"] = (max(dates) + timedelta(days=dep_off)).isoformat()
    return derived, multi_sede


def _derive_travel_from_training(competition_id: str, competition: dict) -> dict:
    """Travel fallback for tournament competitions whose game schedule hasn't
    been loaded yet: the training schedule already spans the whole event, so
    its first/last day ± the competition's offsets bound the stay, and its
    distinct venues stand in for the sede.
    """
    slots = (
        supabase.table("training_slots")
        .select("date, venue")
        .eq("competition_id", competition_id)
        .execute()
        .data
    ) or []
    if not slots:
        return {}

    derived: dict = {}
    venues: list[str] = []
    seen: set[str] = set()
    for s in sorted(slots, key=lambda s: s.get("date") or ""):
        v = (s.get("venue") or "").strip()
        if v and v.lower() not in seen:
            seen.add(v.lower())
            venues.append(v)
    if venues:
        derived["venue"] = " / ".join(venues)

    dates = []
    for s in slots:
        try:
            dates.append(datetime.strptime(s["date"], "%Y-%m-%d").date())
        except (KeyError, TypeError, ValueError):
            continue
    if dates:
        arr_off = competition.get("default_arrival_offset_days")
        dep_off = competition.get("default_departure_offset_days")
        arr_off = int(arr_off) if arr_off is not None else 1
        dep_off = int(dep_off) if dep_off is not None else 1
        derived["arrival_date"] = (min(dates) - timedelta(days=arr_off)).isoformat()
        derived["departure_date"] = (max(dates) + timedelta(days=dep_off)).isoformat()
    return derived


# Travel fields the explicit "recalculate travel" action may overwrite.
_TRAVEL_FIELDS = ("arrival_date", "departure_date", "venue", "location")


def _build_default_overrides(competition: dict, role: str) -> dict:
    """Return the subset of competition-level defaults that should be copied to
    a nomination for a person of the given role. Only writes values that are
    explicitly set on the competition — never clobbers existing nomination
    data with NULLs.
    """
    overrides: dict = {}
    for src, dst in _SHARED_DEFAULT_FIELDS:
        v = competition.get(src)
        if v is not None and v != "":
            overrides[dst] = v
    # Role-aware fees. `role` is either a per-game assignment slot (referee
    # crew slots share the REF defaults) or, on the tournament crew, the
    # person's own personnel role.
    prefix = _FEE_PREFIX_BY_SLOT.get(role) or _FEE_PREFIX_BY_PERSONNEL_ROLE.get(role)
    fee = competition.get(f"{prefix}_window_fee") if prefix else None
    inc = competition.get(f"{prefix}_incidentals") if prefix else None
    if fee is not None:
        overrides["window_fee"] = fee
    if inc is not None:
        overrides["incidentals"] = inc
    return overrides


@router.post("/assignments/sync-nominations", dependencies=[Depends(require_edit("nominations"))])
def sync_assignments_to_nominations(
    competition_id: str = Query(...),
    overwrite_travel: bool = Query(False),
    role: Optional[str] = Query(None),
):
    """Roll up per-game assignments into competition-level nomination drafts.

    For each personnel_id assigned to one or more games in this competition:
      - collect distinct game dates,
      - derive their travel per person: venue/location from THEIR games (the
        competition defaults are only fallback), arrival/departure from their
        first/last game ± the competition's offset days,
      - apply the truly shared defaults (letter_date, deadline) and the
        role-aware fee defaults (TD vs VGO),
      - if a nomination already exists → update game_dates + any default that
        the nomination doesn't already have set,
      - else create a draft nomination with everything filled in.

    `overwrite_travel=true` (the "recalculate travel" button) additionally
    overwrites arrival/departure/venue/location on EXISTING nominations with
    the freshly derived values — including manual edits of those 4 fields.
    Everything else keeps the fill-empty-only rule.

    `role` filters by PERSONNEL role (TD, VGO, REF, …): only those people's
    nominations are created/updated. Referees in CC/U1/U2 slots and TD/VGO
    people in the EXTRA slot are matched by their real role.

    On tournament-fee competitions the source is the competition crew instead:
    every crew member covers every game (per-game rows are only an override of
    who was at the table), so they all get the full schedule. Competitions with
    no games loaded yet fall back to the training schedule for travel dates.
    """
    role_filter = (role or "").strip().upper() or None
    if role_filter and role_filter not in VALID_ROLES:
        raise HTTPException(400, f"role must be one of {', '.join(VALID_ROLES)}")

    competition = get_competition(competition_id)
    if not competition:
        raise HTTPException(404, "Competition not found")
    tournament = is_tournament_mode(competition)
    if not (
        tournament or (competition.get("template_key") or "").upper() in ASSIGNMENT_TEMPLATES
    ):
        raise HTTPException(400, "This competition does not support per-game assignments")

    empty = {"created": 0, "updated": 0, "people": 0, "multi_sede": 0,
             "multi_sede_names": [], "source": "crew" if tournament else "games"}

    games = (
        supabase.table("game_schedule")
        .select("id, date, venue, city, country, team_a")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    # Without games there is nothing to roll up on a per-game competition. A
    # tournament crew still gets its letters — the travel comes from the
    # training schedule.
    if not games and not tournament:
        return empty
    game_by_id = {g["id"]: g for g in games}
    game_id_to_date = {g["id"]: g["date"] for g in games}

    assignments = (
        supabase.table("game_assignments")
        .select("personnel_id, game_id, role")
        .in_("game_id", list(game_id_to_date.keys()))
        .execute()
        .data
    ) if games else []

    crew = list_crew(competition_id) if tournament else []
    if not assignments and not crew:
        return empty

    # Personnel name + role for everyone involved: resolves EXTRA slots to
    # the person's real role, powers the per-role filter, and names the
    # multi-sede people in the response.
    person_by_id = {m["personnel_id"]: m["personnel"] for m in crew}
    pids = [pid for pid in {a["personnel_id"] for a in assignments} if pid not in person_by_id]
    if pids:
        for p in (
            supabase.table("personnel")
            .select("id, name, role")
            .in_("id", pids)
            .execute()
            .data
        ):
            person_by_id[p["id"]] = p
    role_by_pid = {pid: (p.get("role") or "").upper() for pid, p in person_by_id.items()}

    by_person: dict[str, dict] = {}

    # Tournament crew → the whole schedule, every member.
    all_dates = {g["date"] for g in games if g.get("date")}
    all_game_ids = set(game_by_id)
    for member in crew:
        pid = member["personnel_id"]
        by_person[pid] = {
            "role": role_by_pid.get(pid) or (member.get("role") or "").upper(),
            "dates": set(all_dates),
            "game_ids": set(all_game_ids),
        }

    # Per-game rows. On per-game competitions this is the only source; on
    # tournament competitions it only adds people who are not in the crew
    # (the crew already covers every game).
    crew_pids = set(by_person)
    for a in assignments:
        if a["personnel_id"] in crew_pids:
            continue
        d = game_id_to_date.get(a["game_id"])
        if not d:
            continue
        slot_role = a["role"]
        if slot_role == _EXTRA_SLOT:
            slot_role = role_by_pid.get(a["personnel_id"], "VGO")
        entry = by_person.setdefault(
            a["personnel_id"], {"role": slot_role, "dates": set(), "game_ids": set()})
        entry["dates"].add(d)
        entry["game_ids"].add(a["game_id"])
        # If the same person has both roles across games (rare), prefer TD for
        # fee defaults since TDs are senior. Deterministic enough.
        if entry["role"] != "TD" and slot_role == "TD":
            entry["role"] = "TD"

    # Per-role sync: keep only people whose PERSONNEL role matches
    if role_filter:
        by_person = {
            pid: info for pid, info in by_person.items()
            if role_by_pid.get(pid) == role_filter
        }
        if not by_person:
            return empty

    # Existing nominations for this competition
    existing = (
        supabase.table("nominations")
        .select("*")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    existing_by_pid = {n["personnel_id"]: n for n in existing}

    created = 0
    updated = 0
    multi_sede_pids: list[str] = []
    # Tournament with no games loaded: the training schedule bounds the stay.
    training_travel = (
        _derive_travel_from_training(competition_id, competition)
        if tournament and not games else {}
    )
    now_iso = datetime.now(timezone.utc).isoformat()
    for pid, info in by_person.items():
        sorted_dates = sorted(info["dates"])
        person_games = [game_by_id[gid] for gid in info["game_ids"] if gid in game_by_id]
        derived, multi_sede = _derive_travel(person_games, competition)
        if not derived:
            derived = dict(training_travel)
        if multi_sede:
            multi_sede_pids.append(pid)

        # Multi-sede itinerary → tag each game date with its city so the
        # letter reads as an itinerary ("Game 1 – Managua: Fri, Aug 28").
        city_by_date: dict[str, str] = {}
        if multi_sede:
            for g in sorted(person_games, key=lambda g: g.get("date") or ""):
                d, c = g.get("date"), (g.get("city") or "").strip()
                if d and c and d not in city_by_date:
                    city_by_date[d] = c
        game_dates = [
            {
                "label": f"Game {i + 1} – {city_by_date[d]}" if city_by_date.get(d) else f"Game {i + 1}",
                "date": d,
            }
            for i, d in enumerate(sorted_dates)
        ]

        # Derived per-person travel wins over the competition-level fallbacks
        defaults = {
            **_build_default_overrides(competition, info["role"]),
            **derived,
        }

        if pid in existing_by_pid:
            existing_nom = existing_by_pid[pid]
            # No games loaded → nothing to roll up; never blank out dates that
            # were filled in by hand from Nominations.
            update_record = {"game_dates": game_dates} if game_dates else {}
            # Only fill defaults where the nomination doesn't already have a value,
            # so manual edits made in Nominations are preserved.
            for k, v in defaults.items():
                if existing_nom.get(k) in (None, ""):
                    update_record[k] = v
            if overwrite_travel:
                # Explicit recalc: refresh travel fields from the current
                # schedule. Fields we couldn't derive (nor fall back for)
                # keep their current value rather than being blanked.
                for k in _TRAVEL_FIELDS:
                    if k in defaults:
                        update_record[k] = defaults[k]
            if update_record:
                supabase.table("nominations").update(update_record).eq("id", existing_nom["id"]).execute()
                updated += 1
        else:
            insert_record = {
                "personnel_id": pid,
                "competition_id": competition_id,
                "game_dates": game_dates,
                "confirmation_status": "nominated",
                "confirmation_updated_at": now_iso,
                **defaults,
            }
            supabase.table("nominations").insert(insert_record).execute()
            created += 1

    # Names of multi-sede people, so the UI can point at who to double-check
    multi_names = sorted(
        (person_by_id.get(pid, {}).get("name") or "") for pid in multi_sede_pids)

    return {
        "created": created,
        "updated": updated,
        "people": len(by_person),
        "multi_sede": len(multi_sede_pids),
        "multi_sede_names": multi_names,
        "source": "crew" if tournament else "games",
    }


@router.post("/assignments/generate-pdfs", dependencies=[Depends(require_edit("nominations"))])
def generate_assignment_pdfs(competition_id: str = Query(...)):
    """Bulk-generate nomination PDFs for everyone with a nomination on this
    competition. Uses the template_key already on the competition (WCQ/BCLA/LSB).
    Intended to be called after `/sync-nominations` from the Games page.
    """
    from api._lib.services.document_generator import generate_nomination
    from api._lib.routers.nominations import _host_location_for_nomination

    if not _competition_supports_assignments(competition_id):
        raise HTTPException(400, "This competition does not support per-game assignments")

    nominations = (
        supabase.table("nominations")
        .select("*, personnel(name, role, email), competitions(name, template_key, year, fee_type)")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    if not nominations:
        return {"generated": 0, "errors": [], "total": 0}

    generated = 0
    errors = []
    for nom in nominations:
        try:
            personnel = nom.get("personnel") or {}
            competition = nom.get("competitions") or {}
            host_city, host_country = _host_location_for_nomination(
                nom["competition_id"],
                nom.get("personnel_id"),
                nom.get("game_dates"),
                competition.get("template_key"),
            )
            nom_data = {
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
            local_path, storage_url, _ = generate_nomination(nom_data)
            saved_path = storage_url if storage_url else local_path
            supabase.table("nominations").update({
                "status": "generated",
                "pdf_path": saved_path,
            }).eq("id", nom["id"]).execute()
            generated += 1
        except Exception as e:
            errors.append({"id": nom["id"], "name": (nom.get("personnel") or {}).get("name"), "error": str(e)})

    return {"generated": generated, "errors": errors, "total": len(nominations)}
