"""
Game Schedule router — CRUD for competition game schedules,
FIBA website scraping for auto-import, and results sync.
"""
import io
import re
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

from api._lib.database import supabase

router = APIRouter(prefix="/games", tags=["games"])

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
    except Exception:
        raise HTTPException(500, "Failed to fetch games from FIBA website")

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


# ── FIBA scraping ────────────────────────────────────────────────────────────

def _scrape_fiba_games(fiba_url: str) -> list:
    """Scrape game data from a FIBA event games page."""
    import httpx

    # Fetch the page HTML
    resp = httpx.get(fiba_url, timeout=30.0, follow_redirects=True, headers={
        "User-Agent": "Mozilla/5.0 (compatible; FIBAAmericas/1.0)",
    })
    if resp.status_code != 200:
        raise Exception(f"HTTP {resp.status_code}")

    html = resp.text
    games = []

    # Parse games from the embedded Next.js data
    # FIBA pages embed game data as JSON in the page source
    # Look for game objects with gameId, teamA, teamB patterns

    import json

    # Strategy 1: Find JSON-like game objects in the HTML
    # The page embeds data in RSC format — extract game blocks
    game_pattern = re.compile(
        r'"gameId"\s*:\s*(\d+).*?'
        r'"gameName"\s*:\s*"([^"]*)".*?'
        r'"teamA"\s*:\s*\{[^}]*"officialName"\s*:\s*"([^"]*)".*?'
        r'"code"\s*:\s*"([^"]*)".*?\}.*?'
        r'"teamB"\s*:\s*\{[^}]*"officialName"\s*:\s*"([^"]*)".*?'
        r'"code"\s*:\s*"([^"]*)".*?\}.*?'
        r'"teamAScore"\s*:\s*(\d+|null).*?'
        r'"teamBScore"\s*:\s*(\d+|null).*?'
        r'"gameDateTime"\s*:\s*"([^"]*)".*?'
        r'"venueName"\s*:\s*"([^"]*)".*?'
        r'"hostCity"\s*:\s*"([^"]*)".*?'
        r'"groupPairingCode"\s*:\s*"?([^",}]*)"?',
        re.DOTALL
    )

    for m in game_pattern.finditer(html):
        game_id = int(m.group(1))
        game_name = m.group(2)
        team_a = m.group(3)
        team_a_code = m.group(4)
        team_b = m.group(5)
        team_b_code = m.group(6)
        score_a_raw = m.group(7)
        score_b_raw = m.group(8)
        game_dt = m.group(9)
        venue = m.group(10)
        city = m.group(11)
        group = m.group(12).strip('"')

        # Parse datetime
        date_str = ""
        time_str = ""
        if game_dt:
            try:
                dt = datetime.fromisoformat(game_dt.replace("Z", "+00:00"))
                date_str = dt.strftime("%Y-%m-%d")
                time_str = dt.strftime("%H:%M")
            except Exception:
                date_str = game_dt[:10] if len(game_dt) >= 10 else game_dt
                time_str = game_dt[11:16] if len(game_dt) >= 16 else ""

        score_a = int(score_a_raw) if score_a_raw and score_a_raw != "null" else None
        score_b = int(score_b_raw) if score_b_raw and score_b_raw != "null" else None

        status = "completed" if score_a is not None and score_b is not None else "scheduled"

        games.append({
            "fiba_game_id": game_id,
            "game_number": game_name,
            "date": date_str,
            "time": time_str,
            "team_a": team_a,
            "team_a_code": team_a_code,
            "team_b": team_b,
            "team_b_code": team_b_code,
            "score_a": score_a,
            "score_b": score_b,
            "venue": venue,
            "city": city,
            "phase": "Group Phase",
            "group_label": group if group else None,
            "status": status,
            "sport": "Basketball",
        })

    # Strategy 2: If regex didn't work, try finding JSON arrays
    if not games:
        # Look for inline JSON data with game arrays
        json_pattern = re.compile(r'\[(\{"gameId".*?\})\]', re.DOTALL)
        for block in json_pattern.finditer(html):
            try:
                arr = json.loads(f"[{block.group(1)}]")
                for g in arr:
                    games.append(_fiba_json_to_game(g))
            except json.JSONDecodeError:
                continue

    return games


def _fiba_json_to_game(g: dict) -> dict:
    """Convert a FIBA API game object to our schema."""
    game_dt = g.get("gameDateTime", "")
    date_str = game_dt[:10] if game_dt else ""
    time_str = game_dt[11:16] if len(game_dt) >= 16 else ""

    score_a = g.get("teamAScore")
    score_b = g.get("teamBScore")
    status = "completed" if score_a is not None and score_b is not None else "scheduled"

    team_a = g.get("teamA", {})
    team_b = g.get("teamB", {})

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
