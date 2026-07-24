"""Per-person sede (host venue/city) helpers.

Shared by the Games → nominations sync (games.py) and the letter host line
(nominations.py). A person can work games at more than one sede in the same
competition (e.g. a VGO covering two WCQ hosts back to back), so sedes are
kept in chronological order of first visit instead of collapsing to the most
frequent one.
"""


def sede_pairs(games: list[dict], use_team_a: bool = False) -> list[tuple[str, str]]:
    """Distinct (city, country) pairs in chronological order of first visit.

    `use_team_a`: on national-team competitions the home team IS the host
    country, so it fills in when the game has no explicit country.
    Games without any location data are skipped.
    """
    ordered = sorted(games, key=lambda g: g.get("date") or "")
    pairs: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for g in ordered:
        city = (g.get("city") or "").strip()
        country = (g.get("country") or "").strip()
        if not country and use_team_a:
            country = (g.get("team_a") or "").strip()
        if not city and not country:
            continue
        key = (city.lower(), country.lower())
        if key in seen:
            continue
        seen.add(key)
        pairs.append((city, country))
    return pairs


def format_sedes(pairs: list[tuple[str, str]]) -> str:
    """Human line for one or more sedes, itinerary order.

    One sede → "Managua, Nicaragua". Several in the same country →
    "Managua / León, Nicaragua". Different countries →
    "Managua, Nicaragua / San Salvador, El Salvador".
    """
    if not pairs:
        return ""
    if len(pairs) == 1:
        city, country = pairs[0]
        return ", ".join(p for p in (city, country) if p)
    countries = {co for _, co in pairs if co}
    if len(countries) <= 1:
        cities = " / ".join(c for c, _ in pairs if c)
        shared = next(iter(countries), "")
        return ", ".join(p for p in (cities, shared) if p)
    return " / ".join(", ".join(p for p in pair if p) for pair in pairs)
