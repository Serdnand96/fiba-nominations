"""
FIBA Sync Service — standalone FastAPI server for FIBA API calls.
Runs on port 3002. Handles game sync, scraping, and Excel import
that can't run in Vercel serverless due to external API restrictions.

Usage:
  uvicorn services.fiba_sync:app --port 3002 --reload
"""
import os
import re
import io
import httpx
from datetime import datetime
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load .env from project root
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

# ── Supabase client (reuse the lightweight client) ──────────────────────────

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or os.environ.get("SUPABASE_KEY", "")


class _SupabaseResult:
    def __init__(self, data: list):
        self.data = data


class _QueryBuilder:
    def __init__(self, url: str, headers: dict, table: str):
        self._url = f"{url}/rest/v1/{table}"
        self._headers = {**headers, "Content-Type": "application/json", "Prefer": "return=representation"}
        self._params: dict = {}
        self._method = "GET"
        self._body = None

    def select(self, columns: str = "*"):
        self._method = "GET"
        self._params["select"] = columns
        return self

    def insert(self, data):
        self._method = "POST"
        self._body = data
        return self

    def update(self, data: dict):
        self._method = "PATCH"
        self._body = data
        return self

    def delete(self):
        self._method = "DELETE"
        return self

    def eq(self, column: str, value):
        self._params[column] = f"eq.{value}"
        return self

    def order(self, column: str, desc: bool = False):
        direction = "desc" if desc else "asc"
        self._params["order"] = f"{column}.{direction}"
        return self

    def execute(self) -> _SupabaseResult:
        with httpx.Client(timeout=30.0) as client:
            if self._method == "GET":
                resp = client.get(self._url, headers=self._headers, params=self._params)
            elif self._method == "POST":
                resp = client.post(self._url, headers=self._headers, params=self._params, json=self._body)
            elif self._method == "PATCH":
                resp = client.patch(self._url, headers=self._headers, params=self._params, json=self._body)
            elif self._method == "DELETE":
                resp = client.delete(self._url, headers=self._headers, params=self._params)
            else:
                raise ValueError(f"Unknown method: {self._method}")
        if resp.status_code >= 400:
            raise Exception(f"Supabase error {resp.status_code}: {resp.text}")
        data = resp.json() if resp.text else []
        if isinstance(data, dict):
            data = [data]
        return _SupabaseResult(data)


class _SupabaseClient:
    def __init__(self):
        self._headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
        }

    def table(self, name: str) -> _QueryBuilder:
        return _QueryBuilder(SUPABASE_URL, self._headers, name)


supabase = _SupabaseClient()


# ── FastAPI app ─────────────────────────────────────────────────────────────

app = FastAPI(title="FIBA Sync Service", docs_url="/docs")

# CORS — allow frontend origins
_allowed_origins = [
    o.strip()
    for o in os.environ.get("CORS_ORIGINS", "").split(",")
    if o.strip()
] or ["http://localhost:5173", "http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/")
def health():
    return {"service": "fiba-sync", "status": "ok"}


# ── FIBA API config ────────────────────────────────────────────────────────

_FIBA_API_BASE = "https://digital-api.fiba.basketball/hapi"
_FIBA_API_KEY = "898cd5e7389140028ecb42943c47eb74"


# ── Sync endpoint ──────────────────────────────────────────────────────────

@app.post("/sync-results")
def sync_results(competition_id: str = Query(...)):
    """Fetch latest results from FIBA API and upsert into game_schedule."""
    comp = supabase.table("competitions").select("fiba_games_url").eq("id", competition_id).execute().data
    if not comp or not comp[0].get("fiba_games_url"):
        raise HTTPException(400, "Competition has no FIBA games URL configured")

    fiba_url = comp[0]["fiba_games_url"]

    try:
        games_data = _fetch_fiba_games(fiba_url)
    except Exception as e:
        raise HTTPException(500, f"FIBA sync failed: {str(e)}")

    if not games_data:
        return {"synced": 0, "created": 0, "total_from_fiba": 0, "message": "No games found"}

    # Get existing games
    existing = supabase.table("game_schedule").select("*").eq("competition_id", competition_id).execute().data

    synced = 0
    created = 0

    for fiba_game in games_data:
        # Match by fiba_game_id first
        match = None
        if fiba_game.get("fiba_game_id"):
            match = next((e for e in existing if e.get("fiba_game_id") == fiba_game["fiba_game_id"]), None)

        # Fallback: match by date + teams
        if not match and fiba_game.get("team_a") and fiba_game.get("team_b"):
            match = next(
                (e for e in existing
                 if e.get("date") == fiba_game.get("date")
                 and e.get("team_a") == fiba_game.get("team_a")
                 and e.get("team_b") == fiba_game.get("team_b")),
                None,
            )

        if match:
            update_data = {"updated_at": datetime.utcnow().isoformat()}
            if fiba_game.get("score_a") is not None:
                update_data["score_a"] = fiba_game["score_a"]
            if fiba_game.get("score_b") is not None:
                update_data["score_b"] = fiba_game["score_b"]
            if fiba_game.get("status"):
                update_data["status"] = fiba_game["status"]
            if fiba_game.get("venue"):
                update_data["venue"] = fiba_game["venue"]

            supabase.table("game_schedule").update(update_data).eq("id", match["id"]).execute()
            synced += 1
        else:
            # Skip games with no teams (TBD finals, etc.)
            if not fiba_game.get("team_a") and not fiba_game.get("team_b"):
                continue
            record = {"competition_id": competition_id, **fiba_game}
            try:
                supabase.table("game_schedule").insert(record).execute()
                created += 1
            except Exception:
                pass

    return {"synced": synced, "created": created, "total_from_fiba": len(games_data)}


# ── Extract competition ID ─────────────────────────────────────────────────

@app.get("/extract-competition-id")
def extract_competition_id(url: str = Query(...)):
    """Extract FIBA competition ID from a URL (useful for debugging)."""
    comp_id = _extract_fiba_competition_id(url)
    if not comp_id:
        raise HTTPException(400, f"Could not extract competition ID from: {url[:100]}")
    return {"competition_id": comp_id, "source": url}


# ── Preview games from FIBA (without saving) ──────────────────────────────

@app.get("/preview")
def preview_fiba_games(url: str = Query(...)):
    """Preview games from a FIBA URL without saving to DB."""
    try:
        games = _fetch_fiba_games(url)
    except Exception as e:
        raise HTTPException(500, f"Failed: {str(e)}")
    return {"total": len(games), "games": games}


# ── FIBA API logic ─────────────────────────────────────────────────────────

def _fetch_fiba_games(fiba_url: str) -> list:
    """Fetch game data from FIBA's GDAP API."""
    competition_id = _extract_fiba_competition_id(fiba_url)
    if not competition_id:
        raise Exception(f"Could not extract FIBA competition ID from: {fiba_url[:100]}")

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
        raise Exception(f"FIBA API HTTP {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    games_list = data if isinstance(data, list) else data.get("games", data.get("data", []))
    if not isinstance(games_list, list):
        raise Exception(f"Unexpected FIBA API response: {type(data).__name__}")

    return [_fiba_json_to_game(g) for g in games_list if g.get("gameId")]


def _extract_fiba_competition_id(fiba_url: str) -> Optional[str]:
    """Extract GDAP competitionId. Accepts numeric ID or FIBA page URL."""
    stripped = fiba_url.strip()
    if stripped.isdigit():
        return stripped

    try:
        with httpx.Client(timeout=20.0, follow_redirects=True) as client:
            resp = client.get(stripped, headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                "Accept-Encoding": "gzip, deflate",
            })
        if resp.status_code != 200:
            return None

        html = resp.text
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
    """Convert a FIBA GDAP game object to our DB schema."""
    game_dt = g.get("gameDateTime", "") or ""
    date_str = game_dt[:10] if game_dt else ""
    time_str = game_dt[11:16] if len(game_dt) >= 16 else ""

    score_a = g.get("teamAScore")
    score_b = g.get("teamBScore")

    # Determine status
    status_code = g.get("statusCode", "")
    is_live = g.get("isLive", False)
    if is_live:
        status = "live"
    elif status_code == "VALID" and score_a is not None and score_b is not None:
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
        "team_a": team_a.get("officialName") or team_a.get("shortName", "TBD"),
        "team_a_code": team_a.get("code", ""),
        "team_b": team_b.get("officialName") or team_b.get("shortName", "TBD"),
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
    """Detect game phase from FIBA game data."""
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


# ── Excel import ────────────────────────────────────────────────────────────

@app.post("/import/excel")
async def import_games_excel(
    file: UploadFile = File(...),
    competition_id: str = Form(...),
):
    """Import games from an Excel file."""
    fname = (file.filename or "").lower()
    if not fname.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Only Excel files accepted")

    content = await file.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 5 MB)")

    try:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
        ws = wb.active
    except Exception:
        raise HTTPException(400, "Unable to parse Excel file")

    games = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if len(row) < 4:
            continue
        date_val, time_val = row[0], row[1] if len(row) > 1 else None
        team_a, team_b = row[2] if len(row) > 2 else None, row[3] if len(row) > 3 else None
        if not date_val or not team_a or not team_b:
            continue

        date_str = date_val.strftime("%Y-%m-%d") if isinstance(date_val, datetime) else str(date_val).strip()
        time_str = ""
        if time_val:
            time_str = time_val.strftime("%H:%M") if isinstance(time_val, datetime) else str(time_val).strip()[:5]

        games.append({
            "competition_id": competition_id,
            "date": date_str,
            "time": time_str,
            "team_a": str(team_a).strip(),
            "team_b": str(team_b).strip(),
            "venue": str(row[4]).strip() if len(row) > 4 and row[4] else "",
            "phase": str(row[5]).strip() if len(row) > 5 and row[5] else "Group Phase",
            "group_label": str(row[6]).strip() if len(row) > 6 and row[6] else "",
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


# ── Run with: uvicorn services.fiba_sync:app --port 3002 --reload ───────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=3002)
