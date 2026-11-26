"""Crew del torneo por sede (migración 059, CLAUDE.md punto 9).

Una ventana de la BCLA se juega en varias ciudades a la vez y cada TD trabaja
una. Estos tests fijan la regla (`covers_game`) y que la usan los que antes
daban por hecho que el crew cubría todos los partidos: la sincronización de
nominaciones, el prellenado, el anfitrión de la carta y Google Calendar.
"""
from datetime import date

import pytest
from fastapi import HTTPException

from api._lib import crew
from api._lib.routers import games as games_router
from api._lib.routers import nominations as nominations_router
from api._lib.services import google_calendar as gcal

COMP = {
    "id": "w1", "name": "BCLA Season 8 – Window 1", "template_key": "BCLA_RS",
    "fee_type": "tournament", "start_date": "2026-12-09", "end_date": "2026-12-14",
    "td_window_fee": 900, "td_incidentals": 100,
}


def game(gid, day, city, country, venue, group, a="AAA", b="BBB"):
    return {
        "id": gid, "competition_id": "w1", "date": day, "time": "20:00",
        "city": city, "country": country, "venue": venue, "group_label": group,
        "team_a": a, "team_a_code": a, "team_b": b, "team_b_code": b,
    }


# Buenos Aires y Paysandú juegan a la vez; La Asunción, un mes después.
GAMES = [
    game("ba1", "2026-12-09", "Buenos Aires", "Argentina", "Gimnasio Hector Etchart", "B"),
    game("ba2", "2026-12-10", "Buenos Aires", "Argentina", "Gimnasio Hector Etchart", "B"),
    game("ba3", "2026-12-11", "Buenos Aires", "Argentina", "Gimnasio Hector Etchart", "B"),
    game("pa1", "2026-12-09", "Paysandú", "Uruguay", "Estadio 8 de Junio", "C"),
    game("pa2", "2026-12-10", "Paysandú", "Uruguay", "Estadio 8 de Junio", "C"),
    game("pa3", "2026-12-11", "Paysandú", "Uruguay", "Estadio 8 de Junio", "C"),
    game("as1", "2027-01-23", "La Asunción", "Venezuela", "Gimnasio Ciudad de la Asunción", "A"),
    game("as2", "2027-01-24", "La Asunción", "Venezuela", "Gimnasio Ciudad de la Asunción", "A"),
    game("as3", "2027-01-25", "La Asunción", "Venezuela", "Gimnasio Ciudad de la Asunción", "A"),
]

PEOPLE = [
    {"id": "p-ba", "name": "Ana Baires", "role": "TD"},
    {"id": "p-pa", "name": "Pablo Paysandú", "role": "TD"},
    {"id": "p-as", "name": "Asun Margarita", "role": "TD"},
    {"id": "p-all", "name": "Vera Global", "role": "VGO"},
]


def member(mid, pid, role="TD", cities=None):
    row = {"id": mid, "competition_id": "w1", "personnel_id": pid, "role": role}
    if cities is not None:
        row["cities"] = cities
    return row


@pytest.fixture
def window(fake_db):
    fake_db.seed("competitions", [COMP])
    fake_db.seed("game_schedule", GAMES)
    fake_db.seed("personnel", PEOPLE)
    fake_db.seed("game_assignments", [])
    fake_db.seed("nominations", [])
    fake_db.seed("competition_assignments", [
        member("m-ba", "p-ba", cities=["Buenos Aires"]),
        member("m-pa", "p-pa", cities=["Paysandú"]),
        member("m-as", "p-as", cities=["La Asunción"]),
        member("m-all", "p-all", role="VGO"),
    ])
    return fake_db


def nomination_of(fake_db, pid):
    return next(n for n in fake_db.tables["nominations"] if n["personnel_id"] == pid)


# ─── La regla ────────────────────────────────────────────────────────────────

class TestCoversGame:
    def test_member_without_sede_covers_the_whole_competition(self):
        for cities in (None, [], ["", "  "]):
            assert all(crew.covers_game({"cities": cities}, g) for g in GAMES)
        assert all(crew.covers_game({}, g) for g in GAMES)

    def test_member_with_sede_covers_only_its_city(self):
        covered = crew.games_for_member({"cities": ["Paysandú"]}, GAMES)
        assert [g["id"] for g in covered] == ["pa1", "pa2", "pa3"]

    def test_city_match_ignores_case_accents_and_spacing(self):
        for spelled in ("paysandu", "PAYSANDÚ", "  Paysandu  ", "La  Asuncion"):
            assert crew.games_for_member({"cities": [spelled]}, GAMES)
        assert crew.city_key("São  Paulo") == crew.city_key("sao paulo")

    def test_two_sedes_back_to_back(self):
        covered = crew.games_for_member({"cities": ["Buenos Aires", "La Asunción"]}, GAMES)
        assert len(covered) == 6

    def test_a_game_without_city_is_only_covered_by_the_whole_competition_crew(self):
        bare = {"id": "x", "city": None}
        assert crew.covers_game({"cities": None}, bare)
        assert not crew.covers_game({"cities": ["Paysandú"]}, bare)

    def test_crew_for_game_keeps_the_sede_and_the_global_members(self):
        rows = [member("m-ba", "p-ba", cities=["Buenos Aires"]),
                member("m-pa", "p-pa", cities=["Paysandú"]),
                member("m-all", "p-all", role="VGO")]
        here = crew.crew_for_game(rows, GAMES[3])  # Paysandú
        assert [m["id"] for m in here] == ["m-pa", "m-all"]


class TestSedes:
    def test_sedes_in_order_of_first_game_with_counts_and_dates(self):
        sedes = crew.competition_sedes(GAMES)
        assert [s["city"] for s in sedes] == ["Buenos Aires", "Paysandú", "La Asunción"]
        assert sedes[2] == {"city": "La Asunción", "country": "Venezuela", "games": 3,
                            "first_date": "2027-01-23", "last_date": "2027-01-25"}

    def test_two_groups_in_the_same_city_are_one_sede(self):
        montevideo = [
            game("b1", "2027-02-12", "Montevideo", "Uruguay", "Palacio Peñarol", "B"),
            game("d1", "2027-02-13", "Montevideo", "Uruguay", "Palacio Peñarol", "D"),
        ]
        assert [(s["city"], s["games"]) for s in crew.competition_sedes(montevideo)] == [("Montevideo", 2)]

    def test_resolve_spells_the_city_as_the_schedule_does(self):
        assert crew.resolve_cities(["paysandu", "PAYSANDÚ"], GAMES) == ["Paysandú"]
        assert crew.resolve_cities([], GAMES) is None
        assert crew.resolve_cities(None, GAMES) is None

    def test_resolve_rejects_a_city_that_is_not_a_sede(self):
        with pytest.raises(ValueError, match="Managua"):
            crew.resolve_cities(["Managua"], GAMES)


# ─── Endpoints del crew ──────────────────────────────────────────────────────

class TestCrewEndpoints:
    def test_list_returns_sedes_and_what_each_member_covers(self, window):
        out = games_router.list_crew_by_competition("w1")
        assert [s["city"] for s in out["sedes"]] == ["Buenos Aires", "Paysandú", "La Asunción"]
        by_pid = {m["personnel_id"]: m for m in out["crew"]}
        assert by_pid["p-pa"]["cities"] == ["Paysandú"]
        assert by_pid["p-pa"]["games_covered"] == 3
        assert by_pid["p-all"]["cities"] is None
        assert by_pid["p-all"]["games_covered"] == 9

    def test_add_with_sede_saves_it_as_the_schedule_spells_it(self, window):
        window.tables["personnel"].append({"id": "p-new", "name": "Nora Nueva", "role": "VGO"})
        out = games_router.add_crew_member(games_router.CrewCreate(
            competition_id="w1", personnel_id="p-new", cities=["paysandu"]))
        assert out["cities"] == ["Paysandú"]
        assert out["games_covered"] == 3
        saved = next(r for r in window.tables["competition_assignments"] if r["personnel_id"] == "p-new")
        assert saved["cities"] == ["Paysandú"]

    def test_add_without_sede_does_not_write_the_column(self, window):
        window.tables["personnel"].append({"id": "p-new", "name": "Nora Nueva", "role": "VGO"})
        games_router.add_crew_member(games_router.CrewCreate(competition_id="w1", personnel_id="p-new"))
        saved = next(r for r in window.tables["competition_assignments"] if r["personnel_id"] == "p-new")
        assert "cities" not in saved

    def test_add_with_unknown_sede_is_400_and_saves_nothing(self, window):
        window.tables["personnel"].append({"id": "p-new", "name": "Nora Nueva", "role": "VGO"})
        with pytest.raises(HTTPException) as exc:
            games_router.add_crew_member(games_router.CrewCreate(
                competition_id="w1", personnel_id="p-new", cities=["Managua"]))
        assert exc.value.status_code == 400
        assert not [r for r in window.tables["competition_assignments"] if r["personnel_id"] == "p-new"]

    def test_referee_neutrality_only_looks_at_the_games_of_the_sede(self, window):
        window.tables["personnel"].append(
            {"id": "p-ref", "name": "Rita Ref", "role": "REF", "country_code": "ARG", "nationalities": []})
        window.tables["game_schedule"][0].update(team_a_country="ARG")   # un partido en Buenos Aires
        out = games_router.add_crew_member(games_router.CrewCreate(
            competition_id="w1", personnel_id="p-ref", cities=["Paysandú"]))
        assert out["neutrality_warnings"] == []

    def test_update_changes_and_clears_the_sede(self, window):
        out = games_router.update_crew_member("m-ba", games_router.CrewUpdate(cities=["La Asunción", "buenos aires"]))
        assert out["cities"] == ["La Asunción", "Buenos Aires"]
        assert out["games_covered"] == 6
        assert out["personnel"]["name"] == "Ana Baires"

        out = games_router.update_crew_member("m-ba", games_router.CrewUpdate(cities=[]))
        assert out["cities"] is None
        assert out["games_covered"] == 9
        saved = next(r for r in window.tables["competition_assignments"] if r["id"] == "m-ba")
        assert saved["cities"] is None

    def test_update_without_the_field_is_400_and_does_not_clear_the_sede(self, window):
        with pytest.raises(HTTPException) as exc:
            games_router.update_crew_member("m-ba", games_router.CrewUpdate())
        assert exc.value.status_code == 400
        saved = next(r for r in window.tables["competition_assignments"] if r["id"] == "m-ba")
        assert saved["cities"] == ["Buenos Aires"]

    def test_a_sede_that_stopped_existing_can_be_kept_or_removed(self, window):
        # FIBA renombró la ciudad: la fila quedó con una sede que ya no hay.
        row = next(r for r in window.tables["competition_assignments"] if r["id"] == "m-pa")
        row["cities"] = ["Salto"]
        listed = next(m for m in games_router.list_crew_by_competition("w1")["crew"] if m["id"] == "m-pa")
        assert listed["cities"] == ["Salto"] and listed["games_covered"] == 0

        # el cliente manda la lista entera para sumar una: la vieja no la traba
        out = games_router.update_crew_member("m-pa", games_router.CrewUpdate(cities=["Salto", "paysandu"]))
        assert out["cities"] == ["Salto", "Paysandú"] and out["games_covered"] == 3
        out = games_router.update_crew_member("m-pa", games_router.CrewUpdate(cities=["Paysandú"]))
        assert out["cities"] == ["Paysandú"]
        # pero una vez quitada no se puede volver a poner
        with pytest.raises(HTTPException) as exc:
            games_router.update_crew_member("m-pa", games_router.CrewUpdate(cities=["Salto"]))
        assert exc.value.status_code == 400

    def test_moving_a_referee_to_a_sede_warns_about_neutrality(self, window):
        window.tables["personnel"].append(
            {"id": "p-ref", "name": "Rita Ref", "role": "REF", "country_code": "ARG", "nationalities": []})
        window.tables["competition_assignments"].append(member("m-ref", "p-ref", role="REF", cities=["Paysandú"]))
        window.tables["game_schedule"][0].update(team_a_country="ARG")   # un partido en Buenos Aires
        out = games_router.update_crew_member("m-ref", games_router.CrewUpdate(cities=["Buenos Aires"]))
        assert len(out["neutrality_warnings"]) == 1

    def test_update_unknown_row_is_404_and_unknown_sede_is_400(self, window):
        with pytest.raises(HTTPException) as exc:
            games_router.update_crew_member("nope", games_router.CrewUpdate(cities=["Paysandú"]))
        assert exc.value.status_code == 404
        with pytest.raises(HTTPException) as exc:
            games_router.update_crew_member("m-ba", games_router.CrewUpdate(cities=["Managua"]))
        assert exc.value.status_code == 400
        saved = next(r for r in window.tables["competition_assignments"] if r["id"] == "m-ba")
        assert saved["cities"] == ["Buenos Aires"]


# ─── Sincronizar nominaciones ────────────────────────────────────────────────

class TestSyncNominations:
    def sync(self, **kwargs):
        return games_router.sync_assignments_to_nominations(
            competition_id="w1", overwrite_travel=kwargs.get("overwrite_travel", False),
            role=kwargs.get("role"))

    def test_each_td_gets_only_the_dates_and_travel_of_their_sede(self, window):
        out = self.sync()
        assert out["created"] == 4 and out["multi_sede"] == 1   # solo quien cubre todo

        pa = nomination_of(window, "p-pa")
        assert [d["date"] for d in pa["game_dates"]] == ["2026-12-09", "2026-12-10", "2026-12-11"]
        assert pa["location"] == "Paysandú, Uruguay"
        assert pa["venue"] == "Estadio 8 de Junio"
        assert (pa["arrival_date"], pa["departure_date"]) == ("2026-12-08", "2026-12-12")
        assert pa["window_fee"] == 900

        asu = nomination_of(window, "p-as")
        assert [d["date"] for d in asu["game_dates"]] == ["2027-01-23", "2027-01-24", "2027-01-25"]
        assert asu["location"] == "La Asunción, Venezuela"
        assert (asu["arrival_date"], asu["departure_date"]) == ("2027-01-22", "2027-01-26")

    def test_member_without_sede_still_gets_the_whole_window(self, window):
        out = self.sync()
        vera = nomination_of(window, "p-all")
        assert len(vera["game_dates"]) == 6
        assert out["multi_sede_names"] == ["Vera Global"]

    def test_existing_nomination_drops_the_dates_of_other_sedes(self, window):
        window.seed("nominations", [{
            "id": "n-as", "competition_id": "w1", "personnel_id": "p-as",
            "game_dates": [{"label": f"Game {i}", "date": d} for i, d in enumerate(
                sorted({g["date"] for g in GAMES}), 1)],
            "location": "La Asuncion, Venezuela", "venue": "Gimnasio Ciudad de la Asunción",
            "arrival_date": "2027-01-19", "departure_date": "2027-01-26",
        }])
        self.sync(role="TD")
        asu = nomination_of(window, "p-as")
        assert [d["date"] for d in asu["game_dates"]] == ["2027-01-23", "2027-01-24", "2027-01-25"]
        # lo cargado a mano no se toca sin "Recalcular viajes"
        assert asu["arrival_date"] == "2027-01-19"
        assert asu["location"] == "La Asuncion, Venezuela"

    def test_recalculate_travel_now_uses_the_sede(self, window):
        window.seed("nominations", [{
            "id": "n-pa", "competition_id": "w1", "personnel_id": "p-pa", "game_dates": [],
            "location": "viejo", "venue": "viejo", "arrival_date": "2026-01-01", "departure_date": "2026-01-02",
        }])
        self.sync(overwrite_travel=True)
        pa = nomination_of(window, "p-pa")
        assert pa["location"] == "Paysandú, Uruguay"
        assert pa["venue"] == "Estadio 8 de Junio"
        assert (pa["arrival_date"], pa["departure_date"]) == ("2026-12-08", "2026-12-12")

    def test_sede_without_games_is_reported_and_keeps_what_the_nomination_had(self, window):
        # FIBA renombró la ciudad: la fila del crew ya no encuentra partidos.
        next(r for r in window.tables["competition_assignments"] if r["id"] == "m-pa")["cities"] = ["Salto"]
        window.seed("nominations", [{
            "id": "n-pa", "competition_id": "w1", "personnel_id": "p-pa",
            "game_dates": [{"label": "Game 1", "date": "2026-12-09"}],
            "location": "Paysandú", "venue": "Estadio 8 de Junio",
            "arrival_date": "2026-12-08", "departure_date": "2026-12-12",
        }])
        # con defaults de competencia, que es lo que un recálculo le habría pisado
        window.tables["competitions"][0].update(default_location="Toda la ventana", default_venue="Varios")
        before = dict(nomination_of(window, "p-pa"))
        out = self.sync(overwrite_travel=True)
        assert out["no_games"] == 1 and out["no_games_names"] == ["Pablo Paysandú"]
        assert out["people"] == 3
        assert nomination_of(window, "p-pa") == before

    def test_sede_without_games_does_not_create_a_nomination(self, window):
        next(r for r in window.tables["competition_assignments"] if r["id"] == "m-pa")["cities"] = ["Salto"]
        out = self.sync()
        assert out["created"] == 3 and out["no_games_names"] == ["Pablo Paysandú"]
        assert not [n for n in window.tables["nominations"] if n["personnel_id"] == "p-pa"]

    def test_role_filter_still_reports_the_people_without_games(self, window):
        for row in window.tables["competition_assignments"]:
            if row["role"] == "TD":
                row["cities"] = ["Salto"]
        out = self.sync(role="TD")
        assert out["people"] == 0 and out["created"] == 0
        assert out["no_games"] == 3
        assert self.sync(role="VGO")["no_games"] == 0

    def test_competition_without_games_keeps_the_training_fallback(self, window):
        window.seed("game_schedule", [])
        window.seed("training_slots", [])
        out = self.sync()
        assert out["created"] == 4 and out["no_games"] == 0


# ─── Prellenado y carta ──────────────────────────────────────────────────────

class TestNominationReaders:
    def test_prefill_scopes_a_crew_member_to_their_sede(self, window):
        out = nominations_router.prefill_nomination(competition_id="w1", personnel_ids="p-as,p-all")
        asu = out["people"]["p-as"]
        assert [d["date"] for d in asu["game_dates"]] == ["2027-01-23", "2027-01-24", "2027-01-25"]
        assert asu["location"] == "La Asunción, Venezuela"
        everything = out["people"]["p-all"]
        assert len(everything["game_dates"]) == 6

    def test_letter_host_is_the_sede_even_when_another_city_plays_the_same_dates(self, window):
        dates = [{"label": "Game 1", "date": "2026-12-09"}, {"label": "Game 2", "date": "2026-12-10"}]
        assert nominations_router._host_location_for_nomination(
            "w1", "p-pa", dates, "BCLA_RS") == ("Paysandú", "Uruguay")
        assert nominations_router._host_location_for_nomination(
            "w1", "p-ba", dates, "BCLA_RS") == ("Buenos Aires", "Argentina")

    def test_letter_host_is_empty_when_the_sede_has_no_games(self, window):
        next(r for r in window.tables["competition_assignments"] if r["id"] == "m-pa")["cities"] = ["Salto"]
        dates = [{"label": "Game 1", "date": "2026-12-09"}]
        assert nominations_router._host_location_for_nomination("w1", "p-pa", dates, "BCLA_RS") == ("", "")


# ─── Google Calendar ─────────────────────────────────────────────────────────

class TestGoogleCalendar:
    def test_each_game_lists_only_the_crew_of_its_sede(self, window):
        window.tables["game_assignments"] = []
        desired = gcal.desired_events(date(2026, 12, 1))
        by_game = {b["extendedProperties"]["private"]["game_id"]: b["description"] for b in desired.values()}
        assert "TD: Pablo Paysandú" in by_game["pa1"]
        assert "Ana Baires" not in by_game["pa1"] and "Asun Margarita" not in by_game["pa1"]
        assert "VGO: Vera Global" in by_game["pa1"]            # sin sede: toda la competencia
        assert "TD: Asun Margarita" in by_game["as2"]
        assert "Pablo Paysandú" not in by_game["as2"]

    def test_per_game_override_replaces_the_td_of_that_sede_only(self, window):
        window.tables["game_assignments"] = [
            {"game_id": "pa1", "role": "TD", "personnel": {"name": "Suplente Real"}}]
        desired = gcal.desired_events(date(2026, 12, 1))
        by_game = {b["extendedProperties"]["private"]["game_id"]: b["description"] for b in desired.values()}
        assert "TD: Suplente Real" in by_game["pa1"] and "Pablo Paysandú" not in by_game["pa1"]
        assert "VGO: Vera Global" in by_game["pa1"]
        assert "TD: Pablo Paysandú" in by_game["pa2"]


# ─── Permisos ────────────────────────────────────────────────────────────────

class TestCrewPermissions:
    @pytest.fixture
    def http(self, window):
        from fastapi import FastAPI, Request
        from starlette.testclient import TestClient

        app = FastAPI()

        @app.middleware("http")
        async def fake_auth(request: Request, call_next):
            if request.headers.get("x-user"):
                request.state.user = {"id": request.headers["x-user"], "email": "u@example.test"}
            return await call_next(request)

        app.include_router(games_router.router, prefix="/api")
        window.seed("user_profiles", [])
        window.seed("user_permissions", [
            {"user_id": "viewer", "module": "games", "can_view": True, "can_edit": False},
            {"user_id": "editor", "module": "games", "can_view": True, "can_edit": True},
            {"user_id": "payer", "module": "payments", "can_view": True, "can_edit": True},
        ])
        return TestClient(app)

    def test_changing_a_sede_needs_games_edit(self, http, window):
        url, body = "/api/games/crew/m-ba", {"cities": ["Paysandú"]}
        assert http.patch(url, json=body).status_code == 401
        assert http.patch(url, json=body, headers={"x-user": "payer"}).status_code == 403
        assert http.patch(url, json=body, headers={"x-user": "viewer"}).status_code == 403
        saved = next(r for r in window.tables["competition_assignments"] if r["id"] == "m-ba")
        assert saved["cities"] == ["Buenos Aires"]

        ok = http.patch(url, json=body, headers={"x-user": "editor"})
        assert ok.status_code == 200 and ok.json()["cities"] == ["Paysandú"]
        # un body vacío no es "toda la competencia"
        assert http.patch(url, json={}, headers={"x-user": "editor"}).status_code == 400
