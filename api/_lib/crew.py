"""Tournament crew — competition-level personnel assignments.

`competition_assignments` holds the people assigned to a whole competition.
On competitions with `fee_type = 'tournament'` that roster IS the assignment:
the crew covers every game and every training slot, so there is nothing to
pick game by game. Per-game rows (`game_assignments`) stay available as an
optional override — who actually sat at the table for a given game.

On `fee_type = 'per_game'` competitions the crew is only informative; the
per-game workflow in the Games page remains the source of truth.

Shared by the games, training and calendar routers so all three read the
roster the same way.
"""
from api._lib.database import supabase

# fee_type values (competitions.fee_type)
TOURNAMENT_FEE = "tournament"
PER_GAME_FEE = "per_game"


def is_tournament_mode(competition: dict | None) -> bool:
    """True when the competition pays a single tournament fee, i.e. its crew
    covers the whole event instead of being nominated game by game."""
    if not competition:
        return False
    return (competition.get("fee_type") or PER_GAME_FEE) == TOURNAMENT_FEE


def get_competition(competition_id: str) -> dict | None:
    result = (
        supabase.table("competitions")
        .select("*")
        .eq("id", competition_id)
        .execute()
        .data
    )
    return result[0] if result else None


def list_crew(competition_id: str) -> list[dict]:
    """Crew rows for a competition, each enriched with its `personnel` object.

    Rows whose personnel record is gone are dropped (the FK cascades, so this
    is only a guard against a partially-applied delete).
    """
    assignments = (
        supabase.table("competition_assignments")
        .select("*")
        .eq("competition_id", competition_id)
        .execute()
        .data
    ) or []
    if not assignments:
        return []

    pids = list({a["personnel_id"] for a in assignments})
    people = (
        supabase.table("personnel")
        .select("id, name, role, email, country, country_code, nationalities")
        .in_("id", pids)
        .execute()
        .data
    ) or []
    person_by_id = {p["id"]: p for p in people}

    crew = []
    for a in assignments:
        person = person_by_id.get(a["personnel_id"])
        if not person:
            continue
        crew.append({**a, "personnel": person})
    crew.sort(key=lambda a: ((a.get("personnel") or {}).get("name") or ""))
    return crew
