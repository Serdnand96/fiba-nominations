"""
Game Schedule router — CRUD for competition game schedules,
FIBA website scraping for auto-import, results sync, and per-game
TD/VGO assignments (WCQ, BCLA, LSB).
"""
import io
import re
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form, Depends
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone

from api._lib.database import supabase
from api._lib.auth import require_view, require_edit

router = APIRouter(prefix="/games", tags=["games"], dependencies=[Depends(require_view("games"))])

# Templates that support per-game TD/VGO assignment from the Games page.
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
    team_b: str
    team_b_code: Optional[str] = None
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
    team_b: Optional[str] = None
    team_b_code: Optional[str] = None
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

@router.post("")
def create_game(data: GameCreate):
    record = data.model_dump()
    result = supabase.table("game_schedule").insert(record).execute()
    return result.data[0]


@router.post("/bulk")
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


@router.put("/{game_id}")
def update_game(game_id: str, data: GameUpdate):
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    updates["updated_at"] = datetime.utcnow().isoformat()
    r = supabase.table("game_schedule").update(updates).eq("id", game_id).execute()
    if not r.data:
        raise HTTPException(404, "Game not found")
    return r.data[0]


@router.delete("/{game_id}")
def delete_game(game_id: str):
    supabase.table("game_schedule").delete().eq("id", game_id).execute()
    return {"ok": True}


# ── Sync results (update scores from FIBA) ───────────────────────────────────

@router.post("/sync-results")
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
_FIBA_API_KEY = "898cd5e7389140028ecb42943c47eb74"


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
    import httpx

    # If it's already a numeric ID, return it
    stripped = fiba_url.strip()
    if stripped.isdigit():
        return stripped

    # Fetch the page and look for competitionId in the RSC payload
    try:
        with httpx.Client(timeout=20.0, follow_redirects=True) as client:
            resp = client.get(stripped, headers={
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
    status = "completed" if score_a is not None and score_b is not None else "scheduled"

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
        "phase": "Group Phase",
        "group_label": g.get("groupPairingCode"),
        "status": status,
        "sport": "Basketball",
    }


# ── Excel import ─────────────────────────────────────────────────────────────

@router.post("/import/excel")
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


# ── Per-game TD/VGO assignments (WCQ / BCLA / LSB) ──────────────────────────

class AssignmentCreate(BaseModel):
    game_id: str
    personnel_id: str
    role: str  # 'TD' or 'VGO'


def _competition_supports_assignments(competition_id: str) -> bool:
    comp = (
        supabase.table("competitions")
        .select("template_key")
        .eq("id", competition_id)
        .execute()
        .data
    )
    if not comp:
        return False
    return (comp[0].get("template_key") or "").upper() in ASSIGNMENT_TEMPLATES


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
    result = (
        supabase.table("game_assignments")
        .select("*, personnel(id, name, role, email)")
        .in_("game_id", game_ids)
        .execute()
    )
    return result.data


@router.post("/assignments", dependencies=[Depends(require_edit("games"))])
def create_assignment(data: AssignmentCreate):
    role = (data.role or "").upper()
    if role not in ("TD", "VGO"):
        raise HTTPException(400, "Role must be TD or VGO")

    # Verify the game exists and its competition supports assignments
    game = supabase.table("game_schedule").select("id, competition_id").eq("id", data.game_id).execute().data
    if not game:
        raise HTTPException(404, "Game not found")
    if not _competition_supports_assignments(game[0]["competition_id"]):
        raise HTTPException(400, "This competition does not support per-game assignments")

    # Verify personnel role matches
    person = supabase.table("personnel").select("id, role").eq("id", data.personnel_id).execute().data
    if not person:
        raise HTTPException(404, "Personnel not found")
    if (person[0].get("role") or "").upper() != role:
        raise HTTPException(400, f"Personnel role does not match (expected {role})")

    # Upsert: one slot per (game_id, role)
    existing = (
        supabase.table("game_assignments")
        .select("id")
        .eq("game_id", data.game_id)
        .eq("role", role)
        .execute()
        .data
    )
    record = {"game_id": data.game_id, "personnel_id": data.personnel_id, "role": role}
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


@router.delete("/assignments/{assignment_id}", dependencies=[Depends(require_edit("games"))])
def delete_assignment(assignment_id: str):
    result = supabase.table("game_assignments").delete().eq("id", assignment_id).execute()
    if not result.data:
        raise HTTPException(404, "Assignment not found")
    return {"ok": True}


_SHARED_DEFAULT_FIELDS = (
    ("default_letter_date",           "letter_date"),
    ("default_location",              "location"),
    ("default_venue",                 "venue"),
    ("default_arrival_date",          "arrival_date"),
    ("default_departure_date",        "departure_date"),
    ("default_confirmation_deadline", "confirmation_deadline"),
)


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
    # Role-aware fees
    if role == "TD":
        fee = competition.get("td_window_fee")
        inc = competition.get("td_incidentals")
    else:
        fee = competition.get("vgo_window_fee")
        inc = competition.get("vgo_incidentals")
    if fee is not None:
        overrides["window_fee"] = fee
    if inc is not None:
        overrides["incidentals"] = inc
    return overrides


@router.post("/assignments/sync-nominations", dependencies=[Depends(require_edit("nominations"))])
def sync_assignments_to_nominations(competition_id: str = Query(...)):
    """Roll up per-game assignments into competition-level nomination drafts.

    For each personnel_id assigned to one or more games in this competition:
      - collect distinct game dates,
      - apply the competition's shared defaults (letter_date, venue, etc.) and
        the role-aware fee defaults (TD vs VGO),
      - if a nomination already exists → update game_dates + any default that
        the nomination doesn't already have set,
      - else create a draft nomination with everything filled in.
    """
    if not _competition_supports_assignments(competition_id):
        raise HTTPException(400, "This competition does not support per-game assignments")

    comp = (
        supabase.table("competitions")
        .select("*")
        .eq("id", competition_id)
        .execute()
        .data
    )
    if not comp:
        raise HTTPException(404, "Competition not found")
    competition = comp[0]

    games = (
        supabase.table("game_schedule")
        .select("id, date")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    if not games:
        return {"created": 0, "updated": 0, "people": 0}
    game_id_to_date = {g["id"]: g["date"] for g in games}

    assignments = (
        supabase.table("game_assignments")
        .select("personnel_id, game_id, role")
        .in_("game_id", list(game_id_to_date.keys()))
        .execute()
        .data
    )
    if not assignments:
        return {"created": 0, "updated": 0, "people": 0}

    # Group by personnel → (role from assignments, sorted unique dates)
    by_person: dict[str, dict] = {}
    for a in assignments:
        d = game_id_to_date.get(a["game_id"])
        if not d:
            continue
        entry = by_person.setdefault(a["personnel_id"], {"role": a["role"], "dates": set()})
        entry["dates"].add(d)
        # If the same person has both roles across games (rare), prefer TD for
        # fee defaults since TDs are senior. Deterministic enough.
        if entry["role"] != "TD" and a["role"] == "TD":
            entry["role"] = "TD"

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
    now_iso = datetime.now(timezone.utc).isoformat()
    for pid, info in by_person.items():
        sorted_dates = sorted(info["dates"])
        game_dates = [{"label": f"Game {i + 1}", "date": d} for i, d in enumerate(sorted_dates)]
        defaults = _build_default_overrides(competition, info["role"])

        if pid in existing_by_pid:
            existing_nom = existing_by_pid[pid]
            update_record = {"game_dates": game_dates}
            # Only fill defaults where the nomination doesn't already have a value,
            # so manual edits made in Nominations are preserved.
            for k, v in defaults.items():
                if existing_nom.get(k) in (None, ""):
                    update_record[k] = v
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

    return {"created": created, "updated": updated, "people": len(by_person)}


@router.post("/assignments/generate-pdfs", dependencies=[Depends(require_edit("nominations"))])
def generate_assignment_pdfs(competition_id: str = Query(...)):
    """Bulk-generate nomination PDFs for everyone with a nomination on this
    competition. Uses the template_key already on the competition (WCQ/BCLA/LSB).
    Intended to be called after `/sync-nominations` from the Games page.
    """
    from api._lib.services.document_generator import generate_nomination

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
