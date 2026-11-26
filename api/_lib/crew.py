"""Tournament crew — competition-level personnel assignments.

`competition_assignments` holds the people assigned to a whole competition.
On competitions with `fee_type = 'tournament'` that roster IS the assignment:
the crew covers the games and training slots, so there is nothing to pick game
by game. Per-game rows (`game_assignments`) stay available as an optional
override — who actually sat at the table for a given game.

A crew member covers the whole competition unless the row names its sedes
(`cities`, migration 059). A BCLA window is played in three or four host
cities at once and each TD/VGO works one of them: with `cities` set, the
member covers only the games played there. `covers_game()` is the one rule
every reader uses (nominations sync, prefill, letters, Google Calendar).

On `fee_type = 'per_game'` competitions the crew is only informative; the
per-game workflow in the Games page remains the source of truth.

Shared by the games, training and calendar routers so all three read the
roster the same way.
"""
import unicodedata

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


# ── Sedes ────────────────────────────────────────────────────────────────────
# The sede is the host CITY, not the group: Montevideo can host two groups in
# the same arena with one TD. It is matched by name because that is all a game
# carries, so the comparison ignores case, accents and spacing ("Paysandú" ==
# "paysandu"). If FIBA renames a city the member stops matching and shows up
# with zero games — reported, never guessed.

def city_key(value) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return " ".join(text.casefold().split())


def member_cities(member: dict | None) -> list[str]:
    """The sedes a crew row names, cleaned. Empty = the whole competition."""
    out, seen = [], set()
    for city in ((member or {}).get("cities") or []):
        key = city_key(city)
        if key and key not in seen:
            seen.add(key)
            out.append(str(city).strip())
    return out


def covers_game(member: dict | None, game: dict | None) -> bool:
    cities = member_cities(member)
    if not cities:
        return True
    return city_key((game or {}).get("city")) in {city_key(c) for c in cities}


def games_for_member(member: dict | None, games: list[dict]) -> list[dict]:
    return [g for g in games if covers_game(member, g)]


def crew_for_game(crew: list[dict], game: dict | None) -> list[dict]:
    return [m for m in crew if covers_game(m, game)]


def competition_sedes(games: list[dict]) -> list[dict]:
    """Distinct host cities of a schedule, in order of first game:
    [{city, country, games, first_date, last_date}]."""
    by_key: dict[str, dict] = {}
    for g in sorted(games, key=lambda g: g.get("date") or ""):
        key = city_key(g.get("city"))
        if not key:
            continue
        sede = by_key.setdefault(key, {
            "city": str(g.get("city")).strip(),
            "country": (g.get("country") or "").strip(),
            "games": 0,
            "first_date": g.get("date"),
            "last_date": g.get("date"),
        })
        sede["games"] += 1
        if not sede["country"]:
            sede["country"] = (g.get("country") or "").strip()
        if g.get("date"):
            sede["first_date"] = sede["first_date"] or g["date"]
            sede["last_date"] = g["date"]
    return list(by_key.values())


def resolve_cities(values, games: list[dict], stored=None) -> list[str] | None:
    """Validate the sedes a caller sent against the competition's schedule and
    return them spelled as the games spell them (None = whole competition).

    `stored` are the sedes the row already has. One of those that stopped
    being a sede (FIBA renamed the city) is let through as it was: otherwise
    the row could not be edited at all, since the client sends the whole list
    back to add or remove a single city.

    Raises ValueError naming the city that is not a sede of this competition.
    """
    known = {city_key(s["city"]): s["city"] for s in competition_sedes(games)}
    kept = {city_key(c): str(c).strip() for c in (stored or [])}
    out, seen = [], set()
    for value in (values or []):
        key = city_key(value)
        if not key or key in seen:
            continue
        if key in known:
            out.append(known[key])
        elif key in kept:
            out.append(kept[key])
        else:
            raise ValueError(str(value).strip())
        seen.add(key)
    return out or None
