"""Tablero "En vivo" de Partidos (`services/live_board.py`, `GET /games/live`).

Fija tres cosas que se rompen sin hacer ruido: que una fila clavada en `live`
no aparezca en juego meses después, que a FIBA solo se le pregunte cuando hay
algo que puede estar en juego, y que el tablero no escriba nada.
"""
from datetime import datetime, timezone

import pytest

from api._lib.routers import games as games_router
from api._lib.services import fiba_sync, live_board

# Jueves 26 de noviembre de 2026, 16:32 en Miami (UTC-5). El día del war room
# va de las 05:00Z del 26 a las 05:00Z del 27.
NOW = datetime(2026, 11, 26, 21, 32, tzinfo=timezone.utc)

COMPS = [
    {"id": "pq-b", "name": "FIBA AmeriCup 2029 – Pre-Qualifiers (2nd Round) Group B",
     "short_name": "AmeriCup PQ R2 (Venezuela)", "template_key": "GENERIC",
     "fiba_competition_id": 209058, "fiba_games_url": None},
    {"id": "pq-a", "name": "FIBA AmeriCup 2029 – Pre-Qualifiers (2nd Round) Group A",
     "short_name": None, "template_key": "GENERIC", "fiba_competition_id": 209058, "fiba_games_url": None},
    {"id": "wcq-w5", "name": "WCQ Window 5", "short_name": "WCQ W5", "template_key": "WCQ",
     "fiba_competition_id": 208945, "fiba_games_url": None},
    {"id": "manual", "name": "Torneo cargado a mano", "short_name": None, "template_key": "GENERIC",
     "fiba_competition_id": None, "fiba_games_url": None},
]


def game(gid, utc, status="scheduled", comp="pq-b", fiba_game_id=None, **kw):
    """Fila de game_schedule. `utc` es 'YYYY-MM-DDTHH:MM' o None."""
    return {
        "id": gid, "competition_id": comp, "fiba_game_id": fiba_game_id, "game_number": gid,
        "date": (utc or "2026-11-26")[:10], "time": "17:00",
        "datetime_utc": f"{utc}:00+00:00" if utc else None, "venue_timezone": "America/Caracas",
        "team_a": "Cuba", "team_a_code": "CUB", "team_b": "Barbados", "team_b_code": "BAR",
        "score_a": 0, "score_b": 0, "venue": "Gimnasio", "city": "La Asunción", "country": "Venezuela",
        "phase": "Group Phase", "group_label": "B", "status": status, **kw,
    }


def fiba_game(gid, live=False, code="INIT", a=0, b=0, period="", chrono=None):
    return {
        "gameId": gid, "gameName": f"x-{gid}", "isLive": live, "statusCode": code,
        "teamAScore": a, "teamBScore": b, "currentPeriod": period, "chrono": chrono,
        "gameDateTime": "2026-11-26T17:00:00", "gameDateTimeUTC": "2026-11-26T21:00:00",
        "teamA": {"officialName": "Cuba", "code": "CUB"}, "teamB": {"officialName": "Barbados", "code": "BAR"},
    }


class Feed:
    """Lo que devolvería FIBA por ID de competencia; None = no respondió."""

    def __init__(self, by_id=None):
        self.by_id = by_id or {}
        self.calls = []

    def __call__(self, fiba_id):
        self.calls.append(fiba_id)
        return self.by_id.get(fiba_id, [])


@pytest.fixture(autouse=True)
def _no_shared_cache():
    live_board.clear_feed_cache()
    yield
    live_board.clear_feed_cache()


@pytest.fixture
def db(fake_db):
    fake_db.seed("competitions", [dict(c) for c in COMPS])
    return fake_db


def ids(board, bucket=None):
    return [g["id"] for g in board["games"] if bucket is None or g["bucket"] == bucket]


# ── Qué entra y en qué orden ─────────────────────────────────────────────────

def test_board_groups_live_then_upcoming_then_finished(db):
    db.seed("game_schedule", [
        game("tarde", "2026-11-27T01:40", comp="wcq-w5"),
        game("final-1", "2026-11-26T15:00", status="completed", score_a=80, score_b=70),
        game("en-juego", "2026-11-26T21:00", status="live", score_a=28, score_b=22),
        game("pronto", "2026-11-26T23:30"),
        game("final-2", "2026-11-26T18:00", status="completed", score_a=90, score_b=60),
    ])
    board = live_board.build_board(NOW, Feed())
    assert ids(board, "live") == ["en-juego"]
    assert ids(board, "upcoming") == ["pronto", "tarde"]
    # El que terminó más recién va primero.
    assert ids(board, "finished") == ["final-2", "final-1"]
    assert ids(board) == ["en-juego", "pronto", "tarde", "final-2", "final-1"]
    assert board["day"] == "2026-11-26" and board["timezone"] == "America/New_York"
    assert board["next_game"] is None


def test_board_names_the_competition(db):
    db.seed("game_schedule", [game("b", "2026-11-26T23:30"), game("a", "2026-11-26T23:40", comp="pq-a")])
    board = live_board.build_board(NOW, Feed())
    by_id = {g["id"]: g for g in board["games"]}
    assert by_id["b"]["competition_name"] == "AmeriCup PQ R2 (Venezuela)"
    # Sin nombre corto, el nombre completo.
    assert by_id["a"]["competition_name"].endswith("Group A")
    assert by_id["b"]["competition_id"] == "pq-b"


def test_a_row_stuck_on_live_since_august_is_not_on_the_board(db):
    """El caso real: tres partidos del 27 de agosto quedaron en `live`."""
    db.seed("game_schedule", [
        game("clavado", "2026-08-27T23:10", status="live", comp="wcq-w5", score_a=85, score_b=85),
        game("hoy", "2026-11-26T23:30"),
    ])
    feed = Feed()
    board = live_board.build_board(NOW, feed)
    assert ids(board) == ["hoy"]
    assert feed.calls == []


def test_game_that_started_before_midnight_stays_after_midnight(db):
    """23:30 de ayer en Miami, todavía en juego a las 00:30 de hoy."""
    after_midnight = datetime(2026, 11, 27, 5, 30, tzinfo=timezone.utc)   # 00:30 del 27 en Miami
    db.seed("game_schedule", [
        game("trasnoche", "2026-11-27T04:30", status="live"),              # 23:30 del 26 en Miami
        game("ayer-temprano", "2026-11-26T21:00", status="completed", score_a=70, score_b=60),
    ])
    board = live_board.build_board(after_midnight, Feed())
    assert board["day"] == "2026-11-27"
    assert ids(board) == ["trasnoche"]


def test_game_without_instant_goes_by_its_date(db):
    db.seed("game_schedule", [
        game("a-mano-hoy", None, comp="manual", time=None),
        game("a-mano-mañana", None, comp="manual", date="2026-11-27"),
    ])
    board = live_board.build_board(NOW, Feed())
    assert ids(board, "upcoming") == ["a-mano-hoy"]


def test_next_game_when_nothing_is_left_today(db):
    db.seed("game_schedule", [
        game("final", "2026-11-26T15:00", status="completed", score_a=80, score_b=70),
        game("en-diez-dias", "2026-12-06T22:00", comp="wcq-w5"),
        game("mañana", "2026-11-27T22:30", comp="pq-a"),
    ])
    board = live_board.build_board(NOW, Feed())
    assert ids(board) == ["final"]
    assert board["next_game"]["id"] == "mañana"
    assert board["next_game"]["competition_name"].endswith("Group A")


def test_no_games_at_all(db):
    board = live_board.build_board(NOW, Feed())
    assert board["games"] == [] and board["next_game"] is None
    assert board["fiba_checked"] is False and board["fiba_error"] is False


# ── FIBA en directo ──────────────────────────────────────────────────────────

def test_fiba_turns_a_scheduled_game_live_with_period_and_clock(db):
    """El cron todavía no pasó: en la base sigue programado y 0-0."""
    db.seed("game_schedule", [game("cub-bar", "2026-11-26T21:00", fiba_game_id=137107)])
    feed = Feed({209058: [fiba_game(137107, live=True, a=28, b=22, period="Q2", chrono="06:24")]})
    board = live_board.build_board(NOW, feed)
    g = board["games"][0]
    assert g["bucket"] == "live" and g["status"] == "live"
    assert (g["score_a"], g["score_b"], g["period"], g["clock"]) == (28, 22, "Q2", "06:24")
    assert board["fiba_checked"] is True and board["fiba_error"] is False


def test_fiba_closes_a_game_the_database_still_has_live(db):
    db.seed("game_schedule", [game("cub-bar", "2026-11-26T19:00", status="live", fiba_game_id=137107,
                                   score_a=70, score_b=66)])
    feed = Feed({209058: [fiba_game(137107, code="VALID", a=81, b=77)]})
    g = live_board.build_board(NOW, feed)["games"][0]
    assert g["bucket"] == "finished" and (g["score_a"], g["score_b"]) == (81, 77)
    assert g["period"] is None and g["clock"] is None


def test_ended_but_not_yet_official_is_not_upcoming(db):
    """Terminó y FIBA no validó el resultado: ni en juego ni por jugar."""
    db.seed("game_schedule", [game("cub-bar", "2026-11-26T19:00", status="live", fiba_game_id=137107)])
    feed = Feed({209058: [fiba_game(137107, code="INIT", a=81, b=77)]})
    assert live_board.build_board(NOW, feed)["games"][0]["bucket"] == "finished"


def test_fiba_is_asked_only_for_what_may_be_live(db):
    db.seed("game_schedule", [
        game("terminado", "2026-11-26T15:00", status="completed", fiba_game_id=1, score_a=80, score_b=70),
        game("en-dos-horas", "2026-11-26T23:30", fiba_game_id=2),
        game("a-mano", None, comp="manual"),
        game("wcq-noche", "2026-11-27T01:40", comp="wcq-w5", fiba_game_id=3),
    ])
    feed = Feed()
    board = live_board.build_board(NOW, feed)
    assert feed.calls == []
    assert board["fiba_checked"] is False


def test_one_call_per_fiba_competition_even_if_ours_are_several(db):
    """Group A y Group B son la misma competencia de FIBA."""
    db.seed("game_schedule", [
        game("b", "2026-11-26T21:00", comp="pq-b", fiba_game_id=137107),
        game("a", "2026-11-26T21:30", comp="pq-a", fiba_game_id=137101),
        game("wcq", "2026-11-26T21:25", comp="wcq-w5", fiba_game_id=127279),
    ])
    feed = Feed({209058: [fiba_game(137107, live=True, a=10, b=8, period="Q1", chrono="03:00")]})
    live_board.build_board(NOW, feed)
    assert sorted(feed.calls) == [208945, 209058]


def test_game_about_to_start_is_checked(db):
    db.seed("game_schedule", [game("ya-casi", "2026-11-26T21:40", fiba_game_id=137108)])
    feed = Feed()
    live_board.build_board(NOW, feed)
    assert feed.calls == [209058]


def test_fiba_down_shows_the_database_and_says_so(db):
    db.seed("game_schedule", [game("cub-bar", "2026-11-26T21:00", status="live", fiba_game_id=137107,
                                   score_a=20, score_b=18)])
    board = live_board.build_board(NOW, Feed({209058: None}))
    g = board["games"][0]
    assert g["bucket"] == "live" and (g["score_a"], g["score_b"]) == (20, 18) and g["clock"] is None
    assert board["fiba_checked"] is True and board["fiba_error"] is True


def test_game_missing_from_the_feed_keeps_the_database_values(db):
    db.seed("game_schedule", [game("cub-bar", "2026-11-26T21:00", status="live", fiba_game_id=999,
                                   score_a=20, score_b=18)])
    g = live_board.build_board(NOW, Feed({209058: [fiba_game(137107, live=True)]}))["games"][0]
    assert g["bucket"] == "live" and (g["score_a"], g["score_b"]) == (20, 18)


def test_board_never_writes(db):
    db.seed("game_schedule", [game("cub-bar", "2026-11-26T21:00", fiba_game_id=137107)])
    feed = Feed({209058: [fiba_game(137107, live=True, a=28, b=22, period="Q2", chrono="06:24")]})
    live_board.build_board(NOW, feed)
    assert {c.method for c in db.calls} == {"GET"}
    row = db.tables["game_schedule"][0]
    assert row["status"] == "scheduled" and row["score_a"] == 0


# ── Cache del feed ───────────────────────────────────────────────────────────

class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_feed_is_cached_for_thirty_seconds():
    calls, clock = [], Clock()

    def fetch(fiba_id):
        calls.append(fiba_id)
        return [{"gameId": 1}]

    assert live_board.cached_feed(209058, fetch, clock) == [{"gameId": 1}]
    clock.t += live_board.FEED_TTL_SECONDS - 1
    live_board.cached_feed(209058, fetch, clock)
    assert calls == [209058]
    clock.t += 2
    live_board.cached_feed(209058, fetch, clock)
    assert calls == [209058, 209058]
    # Otro ID es otra entrada.
    live_board.cached_feed(208945, fetch, clock)
    assert calls == [209058, 209058, 208945]


def test_a_failed_fetch_is_cached_too():
    """Con FIBA caída no se vuelve a esperar el timeout en cada refresco."""
    calls, clock = [], Clock()

    def fetch(fiba_id):
        calls.append(fiba_id)
        raise fiba_sync.FibaSyncError("FIBA API HTTP 503")

    assert live_board.cached_feed(209058, fetch, clock) is None
    assert live_board.cached_feed(209058, fetch, clock) is None
    assert calls == [209058]


# ── Endpoint ─────────────────────────────────────────────────────────────────

def test_live_route_is_declared_before_the_game_id_route():
    paths = [r.path for r in games_router.router.routes]
    assert paths.index("/games/live") < paths.index("/games/{game_id}")


def test_live_route_is_a_read_under_the_games_view_permission():
    route = next(r for r in games_router.router.routes if r.path == "/games/live")
    assert route.methods == {"GET"}
    # Solo el require_view("games") del router: no escribe, no lleva edit.
    assert len(route.dependencies) == len(games_router.router.dependencies) == 1


def test_endpoint_returns_the_board(db, monkeypatch):
    db.seed("game_schedule", [game("hoy", "2099-01-01T00:00", status="completed")])
    board = games_router.list_live_games()
    assert set(board) == {"now", "day", "timezone", "fiba_checked", "fiba_error", "games", "next_game"}
