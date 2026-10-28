"""Sync con FIBA (services/fiba_sync.py): tramo, partidos sin definir, fechas.

Sin red: un GdapClient falso devuelve el feed y el supabase falso de conftest
hace de base.
"""
import pytest

from api._lib.services import fiba_sync


def game(gid, *, group=None, window=None, date="2026-10-23", time="17:10", a="DSC", b="OTC",
         status="INIT", round_code="GP", score=(0, 0), venue="Maracanazinho"):
    """Un partido con la forma de GET /v1/competitions/{id}/games."""
    team = lambda code: {"code": code, "officialName": f"Team {code}", "shortName": code} if code else None
    return {
        "gameId": gid,
        "gameName": f"G-{gid}",
        "gameDateTime": f"{date}T{time}:00",
        "gameDateTimeUTC": f"{date}T20:10:00",
        "hasTimeGameDateTime": not date.startswith("0001"),
        "ianaTimeZone": "America/Sao_Paulo",
        "teamA": team(a),
        "teamB": team(b),
        "teamAScore": score[0],
        "teamBScore": score[1],
        "statusCode": status,
        "isLive": False,
        "venueName": venue,
        "hostCity": "Rio de Janeiro",
        "hostCountry": "Brazil",
        "groupPairingCode": group,
        "windowCode": window,
        "round": {"roundCode": round_code},
    }


class FakeClient:
    has_gdap = True

    def __init__(self, games, windows=(), competition=None):
        self._games = list(games)
        self._windows = list(windows)
        self._competition = competition
        self.calls = []

    def games(self, cid):
        self.calls.append(("games", cid))
        return self._games

    def windows(self, cid):
        return self._windows

    def competition(self, cid):
        return self._competition

    def americas_competitions(self, from_season, to_season):
        return self._competition or []


def comp(**kw):
    return {"id": "comp-1", "fiba_competition_id": 209059, "fiba_games_url": None,
            "fiba_window_code": None, "fiba_group_codes": None, "location": None, "default_venue": None, **kw}


# ── Tramo ────────────────────────────────────────────────────────────────────

LSB_FEED = [game(1, group="A"), game(2, group="A"), game(3, group="D"),
            game(4, group="37"), game(5, group="38")]


def test_group_filter_keeps_only_this_competitions_groups():
    kept, info = fiba_sync.filter_segment(LSB_FEED, None, ["37", "38"])
    assert [g["gameId"] for g in kept] == [4, 5]
    assert info["group_applied"] and info["skipped_other_groups"] == 3


def test_group_filter_fails_safe_when_feed_has_no_groups():
    feed = [game(1), game(2)]
    kept, info = fiba_sync.filter_segment(feed, None, ["A"])
    assert len(kept) == 2 and not info["group_applied"]


def test_window_filter_and_fail_safe():
    feed = [game(1, window="W5"), game(2, window="W6")]
    kept, info = fiba_sync.filter_segment(feed, "w5", [])
    assert [g["gameId"] for g in kept] == [1] and info["skipped_other_windows"] == 1

    kept, info = fiba_sync.filter_segment([game(1), game(2)], "W5", [])
    assert len(kept) == 2 and not info["window_applied"]


# La forma de la BCLA S8 (209060): grupos A–D sin windowCode, y B/C/D juegan
# en las tres ventanas. Solo la fecha separa W1 (9), W2 (9) y W3 (18).
BCLA_FEED = (
    [game(100 + i, group=g, date=f"2026-12-{9 + i % 6:02d}") for i, g in enumerate("BBBCCCDDD")]
    + [game(200 + i, group=g, date=f"2027-01-{13 + i % 6:02d}") for i, g in enumerate("BBBCCCDDD")]
    + [game(300 + i, group="A", date=f"2027-01-{23 + i:02d}") for i in range(9)]
    + [game(400 + i, group=g, date=f"2027-02-{10 + i % 6:02d}") for i, g in enumerate("BBBCCCDDD")]
    + [game(500 + i, group=str(37 + i % 4), date="0001-01-01", b=None) for i in range(11)]
)


def test_date_filter_splits_bcla_windows():
    def count(date_from, date_to):
        kept, info = fiba_sync.filter_segment(BCLA_FEED, "W1", [], date_from, date_to)
        assert info["date_applied"] and not info["window_applied"]
        return len(kept)

    assert count("2026-12-09", "2026-12-14") == 9
    assert count("2027-01-13", "2027-01-18") == 9
    assert count("2027-01-23", "2027-02-15") == 18


def test_date_filter_drops_undated_and_keeps_owned_games():
    feed = [game(1, date="2026-12-10"), game(2, date="2026-12-20"), game(3, date="0001-01-01", b=None)]
    kept, info = fiba_sync.filter_segment(feed, None, [], "2026-12-09", "2026-12-14")
    assert [g["gameId"] for g in kept] == [1] and info["skipped_other_dates"] == 2

    # El 2 ya es nuestro: FIBA lo movió fuera del tramo y tiene que seguir llegando.
    kept, _ = fiba_sync.filter_segment(feed, None, [], "2026-12-09", "2026-12-14", frozenset({"2"}))
    assert [g["gameId"] for g in kept] == [1, 2]


def test_without_segment_dates_nothing_changes():
    kept, info = fiba_sync.filter_segment(BCLA_FEED, None, [])
    assert len(kept) == len(BCLA_FEED) and not info["date_applied"]


def test_parse_codes_accepts_commas_and_spaces():
    assert fiba_sync.parse_codes(" 37, 38,39 40 ") == ["37", "38", "39", "40"]
    assert fiba_sync.parse_codes("a") == ["A"]
    assert fiba_sync.parse_codes(None) == []


# ── Mapeo ────────────────────────────────────────────────────────────────────

def test_undefined_fixtures_are_not_games():
    assert not fiba_sync.is_defined(game(1, date="0001-01-01"))
    assert not fiba_sync.is_defined(game(1, b=None))
    assert fiba_sync.is_defined(game(1))


def test_mapping_marks_utc_and_respects_missing_time():
    row = fiba_sync.fiba_json_to_game(game(1, status="VALID", score=(80, 89)))
    assert row["datetime_utc"] == "2026-10-23T20:10:00Z"
    assert row["time"] == "17:10" and row["status"] == "completed"

    g = game(2)
    g["hasTimeGameDateTime"] = False
    row = fiba_sync.fiba_json_to_game(g)
    assert row["time"] is None and row["datetime_utc"] is None


def test_phase_comes_from_round_code():
    assert fiba_sync.detect_phase(game(1, round_code="QF")) == "Quarterfinals"
    assert fiba_sync.detect_phase(game(1, round_code="3PG")) == "Classification"
    # Sin roundCode: la heurística vieja por nombre (no se tocó).
    assert fiba_sync.detect_phase({"gameName": "Final"}) == "Finals"
    assert fiba_sync.detect_phase({"gameName": "30458-A-1"}) == "Group Phase"


def test_team_names_are_trimmed():
    g = game(1)
    g["teamA"]["officialName"] = "Club Deportivo Jorge Guzmán "
    assert fiba_sync.fiba_json_to_game(g)["team_a"] == "Club Deportivo Jorge Guzmán"


# ── sync_competition ─────────────────────────────────────────────────────────

def test_sync_creates_segment_games_and_skips_pending(fake_db):
    fake_db.seed("competitions", [comp(fiba_group_codes="F")])
    feed = [game(1, group="F", date="2026-11-13"), game(2, group="F", date="0001-01-01", b=None),
            game(3, group="E")]

    report = fiba_sync.sync_competition(comp(fiba_group_codes="F"), FakeClient(feed))

    rows = fake_db.tables["game_schedule"]
    assert [r["fiba_game_id"] for r in rows] == [1]
    assert report["created"] == 1 and report["pending_in_fiba"] == ["G-2"]
    assert report["imported_from_window"] == 1 and report["skipped_other_groups"] == 1
    saved = fake_db.tables["competitions"][0]
    assert saved["fiba_start_date"] == "2026-11-13" and saved["fiba_end_date"] == "2026-11-13"
    assert saved["fiba_sync_error"] is None and saved["fiba_synced_at"]
    # Sede única del tramo → se completa lo que estaba vacío.
    assert saved["default_venue"] == "Maracanazinho"
    assert saved["location"] == "Rio de Janeiro, Brazil"


def test_sync_updates_results_and_reports_reschedule(fake_db):
    fake_db.seed("competitions", [comp(fiba_group_codes="D", location="Río de Janeiro, Brasil")])
    fake_db.seed("game_schedule", [{
        "id": "g-1", "competition_id": "comp-1", "fiba_game_id": 3, "game_number": "G-3",
        "date": "2026-10-23", "time": "16:10", "team_a": "Team DSC", "team_a_code": "DSC",
        "team_b": "Team OTC", "team_b_code": "OTC", "venue": "Maracanazinho",
        "city": "Rio de Janeiro", "country": "Brazil", "group_label": "D", "phase": "Group Phase",
    }])
    feed = [game(3, group="D", status="VALID", score=(70, 65))]

    report = fiba_sync.sync_competition(comp(fiba_group_codes="D", location="Río de Janeiro, Brasil"),
                                        FakeClient(feed))

    row = fake_db.tables["game_schedule"][0]
    assert (row["score_a"], row["score_b"], row["status"]) == (70, 65, "completed")
    assert report["rescheduled"][0]["changes"] == {"time": {"before": "16:10", "after": "17:10"}}
    # Lo cargado a mano gana.
    assert fake_db.tables["competitions"][0]["location"] == "Río de Janeiro, Brasil"


def test_dry_run_writes_nothing(fake_db):
    fake_db.seed("competitions", [comp(fiba_group_codes="A")])
    report = fiba_sync.sync_competition(comp(fiba_group_codes="A"), FakeClient(LSB_FEED), dry_run=True)
    assert report["created"] == 2 and report["dry_run"]
    assert "game_schedule" not in fake_db.tables or fake_db.tables["game_schedule"] == []
    assert not [c for c in fake_db.calls if c.method in ("POST", "PATCH", "DELETE")]


def test_window_dates_come_from_fiba_windows(fake_db):
    fake_db.seed("competitions", [comp(fiba_window_code="W3")])
    client = FakeClient([game(1, window="W3", date="2026-07-02"), game(2, window="W4", date="2026-08-27")],
                        windows=[{"code": "W3", "startDate": "2026-06-29T00:00:00", "endDate": "2026-07-07T00:00:00"}])
    report = fiba_sync.sync_competition(comp(fiba_window_code="W3"), client)
    assert (report["fiba_start_date"], report["fiba_end_date"]) == ("2026-06-29", "2026-07-07")


def test_whole_competition_dates_come_from_competition(fake_db):
    fake_db.seed("competitions", [comp()])
    client = FakeClient([game(1)], competition={"start": "2026-10-02", "end": "2026-12-07"})
    report = fiba_sync.sync_competition(comp(), client)
    assert (report["fiba_start_date"], report["fiba_end_date"]) == ("2026-10-02", "2026-12-07")


def test_date_segment_follows_a_game_fiba_moved_out_of_it(fake_db):
    seg = dict(fiba_segment_from="2027-01-23", fiba_segment_to="2027-02-15")
    fake_db.seed("competitions", [comp(**seg)])
    fake_db.seed("game_schedule", [{
        "id": "g-1", "competition_id": "comp-1", "fiba_game_id": 9, "game_number": "G-9",
        "date": "2027-02-15", "time": "17:10", "team_a": "Team DSC", "team_a_code": "DSC",
        "team_b": "Team OTC", "team_b_code": "OTC", "venue": "Maracanazinho",
        "city": "Rio de Janeiro", "country": "Brazil",
    }])
    report = fiba_sync.sync_competition(comp(**seg), FakeClient([game(9, date="2027-02-16")]))
    assert fake_db.tables["game_schedule"][0]["date"] == "2027-02-16"
    assert report["rescheduled"][0]["changes"]["date"] == {"before": "2027-02-15", "after": "2027-02-16"}


def test_date_segment_does_not_duplicate_another_competitions_game(fake_db):
    seg = dict(fiba_segment_from="2027-01-23", fiba_segment_to="2027-02-15")
    fake_db.seed("competitions", [comp(**seg), comp(id="w2")])
    # FIBA pasó el 7 de W2 a la semana de W3: sigue siendo de W2.
    fake_db.seed("game_schedule", [{"id": "g-7", "competition_id": "w2", "fiba_game_id": 7,
                                    "date": "2027-01-15", "team_a": "Team DSC", "team_b": "Team OTC"}])
    feed = [game(7, date="2027-01-25"), game(8, date="2027-01-26")]
    report = fiba_sync.sync_competition(comp(**seg), FakeClient(feed))
    mine = [r["fiba_game_id"] for r in fake_db.tables["game_schedule"] if r["competition_id"] == "comp-1"]
    assert mine == [8]
    assert report["created"] == 1 and report["claimed_elsewhere"] == ["G-7"]
    # Parcial: se avisa en el reporte, pero no es un error de sync.
    assert "G-7" in report["message"] and fake_db.tables["competitions"][0]["fiba_sync_error"] is None


def test_date_segment_fully_claimed_elsewhere_flags_error(fake_db):
    seg = dict(fiba_segment_from="2027-01-23", fiba_segment_to="2027-02-15")
    fake_db.seed("competitions", [comp(**seg), comp(id="w2")])
    fake_db.seed("game_schedule", [{"id": "g-7", "competition_id": "w2", "fiba_game_id": 7,
                                    "date": "2027-01-15", "team_a": "Team DSC", "team_b": "Team OTC"}])
    fiba_sync.sync_competition(comp(**seg), FakeClient([game(7, date="2027-01-25")]))
    assert "ya están en otra competencia" in fake_db.tables["competitions"][0]["fiba_sync_error"]


def test_empty_date_segment_flags_error(fake_db):
    seg = dict(fiba_segment_from="2027-03-01", fiba_segment_to="2027-03-02")
    fake_db.seed("competitions", [comp(**seg)])
    report = fiba_sync.sync_competition(comp(**seg), FakeClient([game(1, date="2026-12-10")]))
    assert fake_db.tables["competitions"][0]["fiba_sync_error"]
    assert "fechas 2027-03-01..2027-03-02" in report["message"]


def test_unlinked_competition_raises():
    with pytest.raises(fiba_sync.FibaSyncError):
        fiba_sync.sync_competition(comp(fiba_competition_id=None), FakeClient([]))


# ── discover ─────────────────────────────────────────────────────────────────

def test_discover_hides_linked_competitions(fake_db):
    fake_db.seed("competitions", [{"id": "c", "fiba_competition_id": 209059}])
    client = FakeClient([], competition=[
        {"competitionId": 209059, "officialName": "LSB", "start": "2026-10-02"},
        {"competitionId": 209049, "officialName": "U16 AmeriCup Q#2", "start": "2026-10-21",
         "end": "2026-10-25", "hosts": [{"countryName": "Chile", "cities": ["Castro"]}],
         "zoneInformation": {"zoneOfficialName": "Americas - South America"}},
    ])
    out = fiba_sync.discover(client, 2026, 2027)
    assert [x["fiba_competition_id"] for x in out] == [209049]
    assert out[0]["host_city"] == "Castro" and out[0]["host_country"] == "Chile"


# ── Endpoints ────────────────────────────────────────────────────────────────

def test_competition_form_links_numeric_id(fake_db):
    from api._lib.routers.competitions import create_competition
    from api._lib.schemas import CompetitionCreate

    row = create_competition(CompetitionCreate(name="X", template_key="GENERIC", fiba_games_url=" 209049 ",
                                               fiba_group_codes=""))
    assert row["fiba_competition_id"] == 209049 and row["fiba_group_codes"] is None


def test_competition_segment_needs_both_dates_in_order(fake_db):
    from fastapi import HTTPException
    from api._lib.routers.competitions import create_competition, update_competition
    from api._lib.schemas import CompetitionCreate, CompetitionUpdate

    for bad in ({"fiba_segment_from": "2026-12-09"},
                {"fiba_segment_from": "2026-12-14", "fiba_segment_to": "2026-12-09"},
                {"fiba_segment_from": "09/12/2026", "fiba_segment_to": "2026-12-14"},
                {"fiba_segment_from": "2026-W50-3", "fiba_segment_to": "2026-12-14"}):
        with pytest.raises(HTTPException) as e:
            create_competition(CompetitionCreate(name="X", template_key="BCLA_RS", **bad))
        assert e.value.status_code == 400

    row = create_competition(CompetitionCreate(name="X", template_key="BCLA_RS",
                                               fiba_segment_from="", fiba_segment_to=""))
    assert row["fiba_segment_from"] is None and row["fiba_segment_to"] is None

    fake_db.seed("competitions", [{"id": "w1", "fiba_segment_from": "2026-12-09", "fiba_segment_to": "2026-12-14"}])
    # Solo "hasta" sobre una fila que ya tiene "desde": se valida lo que queda guardado.
    assert update_competition("w1", CompetitionUpdate(fiba_segment_to="2026-12-15"))["fiba_segment_to"] == "2026-12-15"
    with pytest.raises(HTTPException):
        update_competition("w1", CompetitionUpdate(fiba_segment_to="2026-12-01"))
    with pytest.raises(HTTPException):
        update_competition("w1", CompetitionUpdate(fiba_segment_from=""))
    cleared = update_competition("w1", CompetitionUpdate(fiba_segment_from="", fiba_segment_to=""))
    assert cleared["fiba_segment_from"] is None and cleared["fiba_segment_to"] is None


def test_apply_fiba_dates(fake_db):
    from fastapi import HTTPException
    from api._lib.routers.calendar import apply_fiba_dates

    fake_db.seed("competitions", [
        {"id": "a", "start_date": "2026-12-05", "end_date": "2026-12-06",
         "fiba_start_date": "2026-12-05", "fiba_end_date": "2026-12-07"},
        {"id": "b", "fiba_start_date": None, "fiba_end_date": None},
    ])
    row = apply_fiba_dates("a")
    assert (row["start_date"], row["end_date"], row["month"]) == ("2026-12-05", "2026-12-07", 12)
    with pytest.raises(HTTPException) as e:
        apply_fiba_dates("b")
    assert e.value.status_code == 400


# ── Lo que encontró la revisión ──────────────────────────────────────────────

def test_empty_segment_keeps_dates_and_flags_error(fake_db):
    fake_db.seed("competitions", [comp(fiba_window_code="W9", fiba_start_date="2026-11-23",
                                       fiba_end_date="2026-12-01")])
    feed = [game(1, window="W5"), game(2, window="W6")]
    report = fiba_sync.sync_competition(comp(fiba_window_code="W9"), FakeClient(feed))
    saved = fake_db.tables["competitions"][0]
    assert (saved["fiba_start_date"], saved["fiba_end_date"]) == ("2026-11-23", "2026-12-01")
    assert saved["fiba_sync_error"] and "ninguno de este tramo" in report["message"]


def test_pending_segment_is_not_an_error(fake_db):
    fake_db.seed("competitions", [comp(fiba_group_codes="F")])
    feed = [game(1, group="F", date="0001-01-01", b=None), game(2, group="E")]
    report = fiba_sync.sync_competition(comp(fiba_group_codes="F"), FakeClient(feed))
    assert fake_db.tables["competitions"][0]["fiba_sync_error"] is None
    assert "message" not in report and report["pending_in_fiba"] == ["G-1"]


def test_unchanged_game_is_not_rewritten(fake_db):
    row = fiba_sync.fiba_json_to_game(game(3, group="D"))
    row["datetime_utc"] = "2026-10-23T20:10:00+00:00"   # como vuelve de Postgres
    fake_db.seed("competitions", [comp(fiba_group_codes="D")])
    fake_db.seed("game_schedule", [{"id": "g-1", "competition_id": "comp-1", **row}])
    fiba_sync.sync_competition(comp(fiba_group_codes="D"), FakeClient([game(3, group="D")]))
    assert not [c for c in fake_db.calls_to("game_schedule") if c.method == "PATCH"]


def test_fiba_id_rejects_unicode_digits_and_overflow():
    assert fiba_sync.is_fiba_id("209059")
    assert not fiba_sync.is_fiba_id("²")
    assert not fiba_sync.is_fiba_id("12345678901")
    assert not fiba_sync.is_fiba_id("")


def test_unresolvable_url_says_so(monkeypatch):
    monkeypatch.setattr(fiba_sync, "extract_fiba_competition_id", lambda url: None)
    with pytest.raises(fiba_sync.FibaSyncError, match="Could not extract"):
        fiba_sync.sync_competition(comp(fiba_competition_id=None, fiba_games_url="https://x.test/e"),
                                   FakeClient([]))


def test_filling_an_empty_field_is_not_a_reschedule(fake_db):
    fake_db.seed("competitions", [comp(fiba_window_code="W5")])
    fake_db.seed("game_schedule", [{
        "id": "g-1", "competition_id": "comp-1", "fiba_game_id": 7, "game_number": "G-7",
        "date": "2026-11-27", "time": None, "team_a": "Team BRA", "team_a_code": "BRA",
        "team_b": "Team USA", "team_b_code": "USA", "venue": None, "city": None, "country": "",
        "group_label": None,
    }])
    feed = [game(7, window="W5", date="2026-11-27", a="BRA", b="USA")]
    report = fiba_sync.sync_competition(comp(fiba_window_code="W5"), FakeClient(feed))
    row = fake_db.tables["game_schedule"][0]
    assert (row["time"], row["venue"], row["country"]) == ("17:10", "Maracanazinho", "Brazil")
    assert report["rescheduled"] == []
