"""Sync con FIBA (services/fiba_sync.py): tramo, partidos sin definir, fechas.

Sin red: un GdapClient falso devuelve el feed y el supabase falso de conftest
hace de base.
"""
import pytest

from api._lib.services import fiba_sync


def game(gid, *, group=None, window=None, date="2026-10-23", time="17:10", a="DSC", b="OTC",
         status="INIT", round_code="GP", score=(0, 0), venue="Maracanazinho", number=None):
    """Un partido con la forma de GET /v1/competitions/{id}/games."""
    team = lambda code: {"code": code, "officialName": f"Team {code}", "shortName": code} if code else None
    return {
        "gameId": gid,
        "gameName": f"G-{gid}",
        "gameNumber": str(number) if number is not None else None,
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
        self.calls.append(("americas_competitions", from_season, to_season))
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


# La forma de la BCLA S8 (209060): grupos A–D sin windowCode. Cada grupo juega
# 9 partidos numerados del 1 al 9, en tres sedes de 3: los 1-3 son la Window 1,
# los 4-6 la 2 y los 7-9 la 3 (12 por ventana). B, C y D juegan en diciembre,
# enero y febrero; el grupo A juega sus tres sedes entre fines de enero y
# febrero, así que por fecha el reparto da 9, 9 y 18 y no 12, 12 y 12.
BCLA_FEED = (
    [game(100 + i, group=g, number=1 + i % 3, date=f"2026-12-{9 + i % 6:02d}") for i, g in enumerate("BBBCCCDDD")]
    + [game(200 + i, group=g, number=4 + i % 3, date=f"2027-01-{13 + i % 6:02d}") for i, g in enumerate("BBBCCCDDD")]
    + [game(300 + i, group="A", number=1 + i, date=f"2027-01-{23 + i:02d}") for i in range(9)]
    + [game(400 + i, group=g, number=7 + i % 3, date=f"2027-02-{10 + i % 6:02d}") for i, g in enumerate("BBBCCCDDD")]
    + [game(500 + i, group=str(37 + i % 4), number="ABC"[i % 3], date="0001-01-01", b=None) for i in range(11)]
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


def test_game_number_filter_splits_bcla_windows_twelve_each():
    def window(numbers):
        kept, info = fiba_sync.filter_segment(BCLA_FEED, "W1", [], game_numbers=numbers)
        assert info["game_number_applied"] and not info["window_applied"] and not info["date_applied"]
        return kept

    w1, w2, w3 = window(["1", "2", "3"]), window(["4", "5", "6"]), window(["7", "8", "9"])
    assert (len(w1), len(w2), len(w3)) == (12, 12, 12)
    # Cada ventana lleva los cuatro grupos, el A incluido aunque juegue en enero.
    assert all({g["groupPairingCode"] for g in w} == set("ABCD") for w in (w1, w2, w3))
    assert sorted({g["gameDateTime"][:7] for g in w1}) == ["2026-12", "2027-01"]
    # Los QFs (partidos A, B, C de los grupos 37-40) no son de ninguna ventana.
    assert not any(g["gameId"] >= 500 for g in w1 + w2 + w3)


def test_game_number_filter_fails_safe_when_feed_has_no_numbers():
    feed = [game(1), game(2)]
    kept, info = fiba_sync.filter_segment(feed, None, [], game_numbers=["1", "2", "3"])
    assert len(kept) == 2 and not info["game_number_applied"]


def test_active_range_joins_team_dates_and_fiba_dates():
    from datetime import date

    # Window 1 de la BCLA: el equipo la cierra el 14 de diciembre y FIBA le da
    # partidos hasta el 25 de enero.
    assert fiba_sync.active_range({
        "start_date": "2026-12-09", "end_date": "2026-12-14",
        "fiba_start_date": "2026-12-09", "fiba_end_date": "2027-01-25",
    }) == (date(2026, 12, 9), date(2027, 1, 25))
    # Las del equipo incluyen viaje y pueden ser más anchas: gana la más ancha.
    assert fiba_sync.active_range({
        "start_date": "2026-07-01", "end_date": "2026-07-12",
        "fiba_start_date": "2026-07-03", "fiba_end_date": "2026-07-10",
    }) == (date(2026, 7, 1), date(2026, 7, 12))
    assert fiba_sync.active_range({"start_date": "2026-07-01", "end_date": None}) == (date(2026, 7, 1), None)
    assert fiba_sync.active_range({}) == (None, None)


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


def test_missing_segment_does_not_duplicate_other_windows_games(fake_db):
    # BCLA S8 W1, octubre 2026: se guardó sin tramo de fechas y el cron le cargó
    # los 27 partidos de W2 y W3. Sin tramo el feed entra entero, pero lo que ya
    # es de otra competencia no se crea otra vez y el sync queda en error.
    w1 = comp(fiba_window_code="W1")
    fake_db.seed("competitions", [w1, comp(id="w2"), comp(id="w3")])
    fake_db.seed("game_schedule", (
        [{"id": f"w1-{g['gameId']}", "competition_id": "comp-1", "fiba_game_id": g["gameId"],
          "date": g["gameDateTime"][:10], "team_a": "Team DSC", "team_b": "Team OTC"} for g in BCLA_FEED[:9]]
        + [{"id": f"w2-{g['gameId']}", "competition_id": "w2", "fiba_game_id": g["gameId"],
            "date": g["gameDateTime"][:10], "team_a": "Team DSC", "team_b": "Team OTC"} for g in BCLA_FEED[9:18]]
        + [{"id": f"w3-{g['gameId']}", "competition_id": "w3", "fiba_game_id": g["gameId"],
            "date": g["gameDateTime"][:10], "team_a": "Team DSC", "team_b": "Team OTC"} for g in BCLA_FEED[18:36]]
    ))

    report = fiba_sync.sync_competition(w1, FakeClient(BCLA_FEED))

    mine = [r for r in fake_db.tables["game_schedule"] if r["competition_id"] == "comp-1"]
    assert len(mine) == 9 and len(fake_db.tables["game_schedule"]) == 36
    assert report["created"] == 0 and len(report["claimed_elsewhere"]) == 27
    assert not report["date_applied"] and not report["window_applied"]
    error = fake_db.tables["competitions"][0]["fiba_sync_error"]
    assert "ya están en otra competencia" in error and "tramo" in error


def test_unfiltered_competition_without_overlap_is_not_an_error(fake_db):
    # Una AmeriCup o un CentroBasket: sin filtro y sin compartir partidos con nadie.
    fake_db.seed("competitions", [comp()])
    report = fiba_sync.sync_competition(comp(), FakeClient([game(1), game(2, date="2026-10-24")]))
    assert report["created"] == 2 and report["claimed_elsewhere"] == []
    assert fake_db.tables["competitions"][0]["fiba_sync_error"] is None


def test_window_by_game_numbers_takes_its_twelve_and_their_dates(fake_db):
    w1 = comp(fiba_window_code="W1", fiba_game_numbers="1,2,3")
    fake_db.seed("competitions", [w1])

    report = fiba_sync.sync_competition(w1, FakeClient(BCLA_FEED))

    assert report["created"] == 12 and report["game_number_applied"]
    assert report["skipped_other_game_numbers"] == len(BCLA_FEED) - 12
    saved = fake_db.tables["competitions"][0]
    # Diciembre (B, C y D) más la primera sede del grupo A, a fines de enero.
    assert (saved["fiba_start_date"], saved["fiba_end_date"]) == ("2026-12-09", "2027-01-25")
    assert saved["fiba_sync_error"] is None


def test_window_by_game_numbers_does_not_take_games_still_in_another_window(fake_db):
    # El paso de fechas a números: los 3 primeros del grupo A todavía están en
    # la Window 3. La 1 no los duplica; se mueven a mano y el sync los reporta.
    w1 = comp(fiba_window_code="W1", fiba_game_numbers="1,2,3")
    fake_db.seed("competitions", [w1, comp(id="w3")])
    fake_db.seed("game_schedule", [
        {"id": f"w3-{g['gameId']}", "competition_id": "w3", "fiba_game_id": g["gameId"],
         "date": g["gameDateTime"][:10], "team_a": "Team DSC", "team_b": "Team OTC"} for g in BCLA_FEED[18:21]
    ])

    report = fiba_sync.sync_competition(w1, FakeClient(BCLA_FEED))

    assert report["created"] == 9 and len(report["claimed_elsewhere"]) == 3
    assert len(fake_db.tables["game_schedule"]) == 12
    # Con filtro aplicado y partidos propios no es un error: es un aviso.
    assert fake_db.tables["competitions"][0]["fiba_sync_error"] is None
    assert "del tramo ya están en otra competencia" in report["message"]


def test_empty_game_number_segment_flags_error(fake_db):
    fake_db.seed("competitions", [comp(fiba_game_numbers="10,11")])
    report = fiba_sync.sync_competition(comp(fiba_game_numbers="10,11"), FakeClient(BCLA_FEED))
    assert report["created"] == 0
    assert "partidos 10,11" in fake_db.tables["competitions"][0]["fiba_sync_error"]


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


# Los Pre-Qualifiers de la AmeriCup 2029, como los devuelve GDAP: temporada 2029
# (la del torneo al que clasifican), jugados en noviembre de 2026, en dos sedes.
PREQUALIFIERS = {
    "competitionId": 209058, "officialName": "FIBA AmeriCup 2029 Pre-Qualifiers", "season": 2029,
    "start": "2026-11-26", "end": "2026-11-29", "status": "Initial",
    "hosts": [{"countryName": "Nicaragua", "cities": ["Managua"]},
              {"countryName": "Venezuela", "cities": ["Porlamar - Isla Margarita"]}],
}


def test_discover_lists_a_qualifier_by_the_year_it_is_played(fake_db):
    """Con solo las temporadas 2026-2027, este clasificatorio no aparecía nunca."""
    client = FakeClient([], competition=[
        PREQUALIFIERS,
        {"competitionId": 209143, "officialName": "FIBA U18 AmeriCup", "season": 2028,
         "start": "2028-06-03", "end": "2028-06-11"},
    ])
    out = fiba_sync.discover(client, 2026, 2027)
    assert [x["fiba_competition_id"] for x in out] == [209058]
    # A FIBA se le piden temporadas de más; el recorte por fecha es nuestro.
    assert client.calls == [("americas_competitions", 2026, 2027 + fiba_sync.SEASON_LOOKAHEAD)]


def test_discover_keeps_a_competition_that_spans_the_requested_years(fake_db):
    wcq = {"competitionId": 208945, "officialName": "WCQ 2027", "season": 2027,
           "start": "2025-11-24", "end": "2027-03-02"}
    assert fiba_sync.discover(FakeClient([], competition=[wcq]), 2026, 2026)
    assert fiba_sync.discover(FakeClient([], competition=[wcq]), 2025, 2025)
    assert not fiba_sync.discover(FakeClient([], competition=[wcq]), 2028, 2029)


def test_discover_without_dates_falls_back_to_the_season(fake_db):
    client = FakeClient([], competition=[
        {"competitionId": 1, "officialName": "Sin fecha, de este año", "season": 2027},
        {"competitionId": 2, "officialName": "Sin fecha, de 2029", "season": 2029, "start": "0001-01-01"},
    ])
    out = fiba_sync.discover(client, 2026, 2027)
    assert [x["fiba_competition_id"] for x in out] == [1]
    assert out[0]["start"] is None and out[0]["end"] is None


def test_discover_reports_every_host(fake_db):
    out = fiba_sync.discover(FakeClient([], competition=[PREQUALIFIERS]), 2026, 2027)
    assert out[0]["hosts"] == [
        {"city": "Managua", "country": "Nicaragua"},
        {"city": "Porlamar - Isla Margarita", "country": "Venezuela"},
    ]
    # La primera sede sigue saliendo donde salía.
    assert out[0]["host_city"] == "Managua" and out[0]["host_country"] == "Nicaragua"


def test_discover_without_hosts_has_no_venue(fake_db):
    bare = {"competitionId": 209060, "officialName": "BCLA", "season": 2027, "start": "2026-12-09", "hosts": []}
    out = fiba_sync.discover(FakeClient([], competition=[bare]), 2026, 2027)
    assert out[0]["hosts"] == [] and out[0]["host_city"] is None and out[0]["host_country"] is None


def test_discover_points_at_our_unlinked_competitions_on_the_same_dates(fake_db):
    """El caso real: los dos grupos ya estaban cargados, sin vínculo con FIBA."""
    fake_db.seed("competitions", [
        {"id": "grupo-b", "name": "Pre-Qualifiers Group B", "start_date": "2026-11-24", "end_date": "2026-11-29"},
        {"id": "grupo-a", "name": "Pre-Qualifiers Group A", "start_date": "2026-11-25", "end_date": "2026-11-30"},
        # Mismas fechas, pero ya vinculada a otra competencia de FIBA: no es candidata.
        {"id": "wcq-w5", "name": "WCQ Window 5", "start_date": "2026-11-23", "end_date": "2026-12-01",
         "fiba_competition_id": 208945},
        # Vinculada por URL, todavía sin ID resuelto: tampoco.
        {"id": "por-url", "name": "Con URL", "start_date": "2026-11-26", "end_date": "2026-11-29",
         "fiba_games_url": "https://www.fiba.basketball/en/events/x/games"},
        # Sin vínculo, en otras fechas.
        {"id": "u16", "name": "U16 Qualifiers #1", "start_date": "2026-12-06", "end_date": "2026-12-10"},
        # Sin vínculo y sin fechas: no hay con qué compararla.
        {"id": "sin-fecha", "name": "Por confirmar"},
    ])
    out = fiba_sync.discover(FakeClient([], competition=[PREQUALIFIERS]), 2026, 2027)
    assert out[0]["candidates"] == [
        {"id": "grupo-b", "name": "Pre-Qualifiers Group B", "start_date": "2026-11-24", "end_date": "2026-11-29"},
        {"id": "grupo-a", "name": "Pre-Qualifiers Group A", "start_date": "2026-11-25", "end_date": "2026-11-30"},
    ]


def test_discover_never_links_a_candidate(fake_db):
    """Solo informa: quién es quién lo decide una persona."""
    fake_db.seed("competitions", [
        {"id": "grupo-a", "name": "Pre-Qualifiers Group A", "start_date": "2026-11-25", "end_date": "2026-11-30"},
    ])
    fiba_sync.discover(FakeClient([], competition=[PREQUALIFIERS]), 2026, 2027)
    assert not fake_db.tables["competitions"][0].get("fiba_competition_id")
    assert {c.method for c in fake_db.calls} == {"GET"}


# ── Endpoints ────────────────────────────────────────────────────────────────

def test_competition_form_links_numeric_id(fake_db):
    from api._lib.routers.competitions import create_competition
    from api._lib.schemas import CompetitionCreate

    row = create_competition(CompetitionCreate(name="X", template_key="GENERIC", fiba_games_url=" 209049 ",
                                               fiba_group_codes="", fiba_game_numbers=""))
    assert row["fiba_competition_id"] == 209049 and row["fiba_group_codes"] is None
    assert row["fiba_game_numbers"] is None


def test_competition_game_numbers_are_saved_and_cleared(fake_db):
    from api._lib.routers.competitions import update_competition
    from api._lib.schemas import CompetitionUpdate

    fake_db.seed("competitions", [{"id": "w1", "name": "BCLA W1", "fiba_game_numbers": None}])
    assert update_competition("w1", CompetitionUpdate(fiba_game_numbers="1,2,3"))["fiba_game_numbers"] == "1,2,3"
    # El formulario manda "" cuando el campo queda vacío: es NULL, no "filtrar por nada".
    assert update_competition("w1", CompetitionUpdate(fiba_game_numbers=""))["fiba_game_numbers"] is None


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


# ── Cron: qué competencias se sincronizan ────────────────────────────────────

def test_cron_keeps_syncing_a_window_until_its_last_fiba_game(fake_db, monkeypatch):
    import datetime as dt
    from scripts import fiba_sync as cron

    fake_db.seed("competitions", [
        # Window 1 de la BCLA: cerrada el 14 de diciembre para el equipo, con
        # partidos del grupo A en FIBA hasta el 25 de enero.
        {"id": "w1", "fiba_competition_id": 209060, "start_date": "2026-12-09", "end_date": "2026-12-14",
         "fiba_start_date": "2026-12-09", "fiba_end_date": "2027-01-25"},
        # Terminada de verdad: ni el equipo ni FIBA le dan más partidos.
        {"id": "old", "fiba_competition_id": 209032, "start_date": "2026-04-17", "end_date": "2026-04-18",
         "fiba_start_date": "2026-04-17", "fiba_end_date": "2026-04-18"},
    ])

    def on(day):
        class FakeDate(dt.date):
            @classmethod
            def today(cls):
                return day
        monkeypatch.setattr(cron, "date", FakeDate)
        return ([c["id"] for c in cron.select_competitions("live", None)],
                [c["id"] for c in cron.select_competitions("all", None)])

    assert on(dt.date(2027, 1, 24)) == (["w1"], ["w1"])     # se juega La Asunción
    assert on(dt.date(2027, 1, 27)) == ([], [])              # ya no queda nada
