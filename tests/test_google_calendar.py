"""Sync de partidos con Google Calendar: `services/google_calendar.py` y el
router `/api/me/google-calendar`.

Sin red: Google es un `httpx.MockTransport` con un calendario en memoria
(`FakeGoogle`) y Supabase el falso de conftest.py (`fake_db`).
"""
import json
import re
from datetime import date, datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi import BackgroundTasks, HTTPException

from api._lib.auth import require_user
from api._lib.routers import google_calendar as router_mod
from api._lib.services import google_calendar as gcal

TODAY = date(2026, 7, 1)
COMP = {"id": "comp-1", "name": "FIBA World Cup 2027 Americas Qualifiers W3", "short_name": "WCQ W3",
        "end_date": "2026-07-08", "fee_type": "per_game"}
TOURNEY = {"id": "comp-2", "name": "AmeriCup 2026", "short_name": "AmeriCup",
           "end_date": "2026-07-10", "fee_type": "tournament"}
FINISHED = {"id": "comp-old", "name": "LSB 2026", "short_name": "LSB", "end_date": "2026-05-01",
            "fee_type": "per_game"}

G1 = "11111111-1111-1111-1111-111111111111"
G2 = "22222222-2222-2222-2222-222222222222"
G3 = "33333333-3333-3333-3333-333333333333"
G_OLD = "44444444-4444-4444-4444-444444444444"


def game(gid, comp_id="comp-1", **kw):
    row = {
        "id": gid, "competition_id": comp_id, "game_number": "Game 12", "date": "2026-07-03",
        "time": "20:10", "datetime_utc": "2026-07-04T02:10:00+00:00",
        "venue_timezone": "America/Mexico_City", "team_a": "Mexico", "team_a_code": "MEX",
        "team_b": "Argentina", "team_b_code": "ARG", "score_a": 0, "score_b": 0,
        "venue": "Arena CDMX", "city": "Ciudad de México", "country": "Mexico",
        "phase": "Group Phase", "status": "scheduled",
    }
    row.update(kw)
    return row


@pytest.fixture(autouse=True)
def google_env(monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "client-id.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_SECRET", "client-secret")
    monkeypatch.setenv("GOOGLE_TOKEN_KEY", Fernet.generate_key().decode())
    monkeypatch.delenv("GOOGLE_OAUTH_REDIRECT_URI", raising=False)


# ─── Google falso ────────────────────────────────────────────────────────────

class FakeGoogle:
    """Token endpoint + Calendar API con un calendario en memoria."""

    def __init__(self):
        self.calendars: dict[str, dict] = {}     # cal_id → {event_id: event}
        self.cancelled: dict[str, dict] = {}     # cal_id → {event_id: event}
        self.requests: list[tuple[str, str]] = []
        self.revoked_tokens: set[str] = set()
        self.next_cal = 1

    def writes(self):
        return [r for r in self.requests if r[0] in ("POST", "PUT", "DELETE") and "/events" in r[1]]

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = request.url
        self.requests.append((request.method, url.path))
        if url.host == "oauth2.googleapis.com" and url.path == "/token":
            form = parse_qs(request.content.decode())
            if form.get("refresh_token", [""])[0] in self.revoked_tokens:
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": "access-1", "expires_in": 3599})
        if url.host == "oauth2.googleapis.com" and url.path == "/revoke":
            return httpx.Response(200)

        path = url.path.removeprefix("/calendar/v3")
        if path == "/calendars" and request.method == "POST":
            cid = f"cal{self.next_cal}@group.calendar.google.com"
            self.next_cal += 1
            self.calendars[cid] = {}
            self.cancelled[cid] = {}
            return httpx.Response(200, json={"id": cid})

        m = re.fullmatch(r"/calendars/([^/]+)(/events(?:/([^/]+))?)?", path)
        assert m, f"ruta inesperada {request.method} {path}"
        cid, events, eid = m.group(1), m.group(2), m.group(3)
        if cid not in self.calendars:
            return httpx.Response(404, json={"error": {"code": 404}})
        cal = self.calendars[cid]
        if not events:
            if request.method == "DELETE":
                del self.calendars[cid]
                return httpx.Response(204)
            return httpx.Response(200, json={"id": cid})
        if request.method == "GET":
            assert url.params.get("privateExtendedProperty") == "fiba=1"
            return httpx.Response(200, json={"items": list(cal.values())})
        if request.method == "POST":
            body = json.loads(request.content)
            if body["id"] in cal or body["id"] in self.cancelled[cid]:
                return httpx.Response(409, json={"error": {"code": 409}})
            cal[body["id"]] = body
            return httpx.Response(200, json=body)
        if request.method == "PUT":
            body = json.loads(request.content)
            self.cancelled[cid].pop(eid, None)
            cal[eid] = body
            return httpx.Response(200, json=body)
        if request.method == "DELETE":
            if eid not in cal:
                return httpx.Response(410)
            self.cancelled[cid][eid] = cal.pop(eid)
            return httpx.Response(204)
        raise AssertionError(request.method)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))


@pytest.fixture
def google():
    return FakeGoogle()


def seed_world(fake_db, *, user="user-1", refresh="refresh-1", permission=True, calendar_id=None):
    fake_db.seed("competitions", [COMP, TOURNEY, FINISHED])
    fake_db.seed("game_schedule", [
        game(G1),
        game(G2, datetime_utc=None, time=None, date="2026-07-05"),
        game(G3, comp_id="comp-2", team_a_code="BRA", team_b_code="USA"),
        game(G_OLD, comp_id="comp-old"),
    ])
    fake_db.seed("game_assignments", [
        {"game_id": G1, "role": "TD", "personnel": {"name": "Ana Pérez"}},
        {"game_id": G1, "role": "VGO", "personnel": {"name": "Luis Gómez"}},
    ])
    fake_db.seed("competition_assignments", [
        {"id": "ca-1", "competition_id": "comp-2", "personnel_id": "p-9", "role": "TD"},
    ])
    fake_db.seed("personnel", [{"id": "p-9", "name": "Carla Ruiz"}])
    fake_db.seed("user_profiles", [])
    fake_db.seed("user_permissions", [
        {"user_id": user, "module": "games", "can_view": permission, "can_edit": False},
    ])
    fake_db.seed("google_calendar_links", [{
        "user_id": user, "refresh_token_enc": gcal.encrypt_token(refresh), "calendar_id": calendar_id,
    }])


# ─── event_for_game ──────────────────────────────────────────────────────────

class TestEventForGame:
    def test_event_id_is_valid_base32hex(self):
        eid = gcal.event_id_for(G1)
        assert re.fullmatch(r"[a-v0-9]{5,1024}", eid)
        assert eid == "g" + G1.replace("-", "")

    def test_timed_game_uses_datetime_utc_not_local_date(self):
        # México 20:10 local del 3/7 = 02:10 UTC del 4/7 (punto 12).
        body = gcal.event_for_game(game(G1), COMP, [])
        assert body["start"] == {"dateTime": "2026-07-04T02:10:00+00:00", "timeZone": "America/Mexico_City"}
        assert body["end"] == {"dateTime": "2026-07-04T04:10:00+00:00", "timeZone": "America/Mexico_City"}
        assert "Hora local de la sede: 20:10 (America/Mexico_City)" in body["description"]
        assert body["summary"] == "MEX vs ARG · WCQ W3"
        assert body["location"] == "Arena CDMX, Ciudad de México, Mexico"
        assert body["transparency"] == "transparent"

    @pytest.mark.parametrize("kw", [
        {"datetime_utc": None, "time": None},
        {"time": "00:00"},   # relleno, no medianoche
    ])
    def test_untimed_game_is_all_day(self, kw):
        body = gcal.event_for_game(game(G1, **kw), COMP, [])
        assert body["start"] == {"date": "2026-07-03"}
        assert body["end"] == {"date": "2026-07-04"}
        assert "Horario a confirmar por FIBA" in body["description"]

    def test_completed_game_shows_score(self):
        body = gcal.event_for_game(game(G1, status="completed", score_a=85, score_b=79), COMP, [])
        assert body["summary"] == "MEX 85–79 ARG · WCQ W3"

    def test_scheduled_zero_zero_is_not_a_result(self):
        assert "0–0" not in gcal.event_for_game(game(G1), COMP, [])["summary"]

    def test_crew_in_description(self):
        body = gcal.event_for_game(game(G1), COMP, [("TD", "Ana Pérez"), ("VGO", "Luis Gómez")])
        assert "TD: Ana Pérez\nVGO: Luis Gómez" in body["description"]

    def test_hash_is_stable_and_tracks_changes(self):
        h = lambda g: gcal.event_for_game(g, COMP, [])["extendedProperties"]["private"]["fiba_hash"]  # noqa: E731
        assert h(game(G1)) == h(game(G1))
        assert h(game(G1)) != h(game(G1, datetime_utc="2026-07-04T03:10:00+00:00", time="21:10"))
        private = gcal.event_for_game(game(G1), COMP, [])["extendedProperties"]["private"]
        assert private["fiba"] == "1" and private["game_id"] == G1


# ─── plan_sync ───────────────────────────────────────────────────────────────

class TestPlanSync:
    def body(self, gid, **kw):
        return gcal.event_for_game(game(gid, **kw), COMP, [])

    def test_unchanged_writes_nothing(self):
        b = self.body(G1)
        plan = gcal.plan_sync({b["id"]: b}, [b], set())
        assert plan == {"create": [], "update": [], "delete": []}

    def test_create_update_delete_and_keep_history(self):
        new, changed = self.body(G1), self.body(G2, time="21:00")
        stale = self.body(G2)
        finished = self.body(G_OLD)      # competencia terminada: el partido sigue existiendo
        gone = self.body(G3)             # partido borrado de game_schedule
        plan = gcal.plan_sync({new["id"]: new, changed["id"]: changed},
                              [stale, finished, gone], live_game_ids={G_OLD})
        assert [b["id"] for b in plan["create"]] == [new["id"]]
        assert [b["id"] for b in plan["update"]] == [changed["id"]]
        assert plan["delete"] == [gone["id"]]


# ─── desired_events ──────────────────────────────────────────────────────────

class TestDesiredEvents:
    def test_only_active_competitions_with_crew(self, fake_db):
        seed_world(fake_db)
        desired = gcal.desired_events(TODAY)
        by_game = {b["extendedProperties"]["private"]["game_id"]: b for b in desired.values()}
        assert set(by_game) == {G1, G2, G3}            # sin el de la competencia terminada
        assert "TD: Ana Pérez" in by_game[G1]["description"]          # per_game
        assert "TD: Carla Ruiz" in by_game[G3]["description"]         # crew del torneo
        assert "TD:" not in by_game[G2]["description"]                # per_game sin asignar

    def test_per_game_override_replaces_only_its_role(self, fake_db):
        seed_world(fake_db)
        fake_db.tables["competition_assignments"].append(
            {"id": "ca-2", "competition_id": "comp-2", "personnel_id": "p-8", "role": "VGO"})
        fake_db.tables["personnel"].append({"id": "p-8", "name": "Diego Sosa"})
        fake_db.tables["game_assignments"].append(
            {"game_id": G3, "role": "TD", "personnel": {"name": "Override Real"}})
        body = gcal.desired_events(TODAY)[gcal.event_id_for(G3)]
        assert "TD: Override Real" in body["description"]
        assert "Carla Ruiz" not in body["description"]
        assert "VGO: Diego Sosa" in body["description"]      # el resto del crew sigue

    def test_finished_yesterday_still_active_for_the_last_result(self, fake_db):
        seed_world(fake_db)
        # La competencia 1 terminó ayer: el resultado del último partido tiene
        # que llegar igual (días de gracia).
        desired = gcal.desired_events(date(2026, 7, 9))
        assert gcal.event_id_for(G1) in desired
        assert gcal.event_id_for(G1) not in gcal.desired_events(date(2026, 7, 12))


# ─── sync_user ───────────────────────────────────────────────────────────────

class TestSyncUser:
    def test_first_sync_creates_calendar_and_events(self, fake_db, google):
        seed_world(fake_db)
        desired = gcal.desired_events(TODAY)
        stats = gcal.sync_user("user-1", desired=desired, http=google.client())
        assert stats == {"created": 3, "updated": 0, "deleted": 0, "failed": 0, "total": 3}
        link = gcal.get_link("user-1")
        assert link["calendar_id"] in google.calendars
        assert len(google.calendars[link["calendar_id"]]) == 3
        assert link["events_count"] == 3 and link["last_sync_error"] is None

    def test_second_sync_only_writes_changes(self, fake_db, google):
        seed_world(fake_db)
        http = google.client()
        gcal.sync_user("user-1", desired=gcal.desired_events(TODAY), http=http)
        google.requests.clear()
        assert gcal.sync_user("user-1", desired=gcal.desired_events(TODAY), http=http)["updated"] == 0
        assert google.writes() == []

        fake_db.tables["game_schedule"][0].update(datetime_utc="2026-07-04T03:00:00+00:00", time="21:00")
        stats = gcal.sync_user("user-1", desired=gcal.desired_events(TODAY), http=http)
        assert (stats["created"], stats["updated"], stats["deleted"]) == (0, 1, 0)

    def test_deleted_game_is_removed_finished_competition_kept(self, fake_db, google):
        seed_world(fake_db)
        http = google.client()
        gcal.sync_user("user-1", desired=gcal.desired_events(TODAY), http=http)
        # La competencia 1 "termina" y el partido de la 2 se borra.
        fake_db.tables["competitions"][0]["end_date"] = "2026-06-01"
        fake_db.tables["game_schedule"] = [g for g in fake_db.tables["game_schedule"] if g["id"] != G3]
        stats = gcal.sync_user("user-1", desired=gcal.desired_events(TODAY), http=http)
        assert stats["deleted"] == 1
        cal = google.calendars[gcal.get_link("user-1")["calendar_id"]]
        assert gcal.event_id_for(G1) in cal and gcal.event_id_for(G3) not in cal

    def test_restores_a_cancelled_event_on_409(self, fake_db, google):
        seed_world(fake_db)
        http = google.client()
        gcal.sync_user("user-1", desired=gcal.desired_events(TODAY), http=http)
        cid = gcal.get_link("user-1")["calendar_id"]
        eid = gcal.event_id_for(G1)
        google.cancelled[cid][eid] = google.calendars[cid].pop(eid)   # la persona lo borró
        gcal.sync_user("user-1", desired=gcal.desired_events(TODAY), http=http)
        assert eid in google.calendars[cid]
        assert google.calendars[cid][eid]["status"] == "confirmed"

    def test_recreates_calendar_deleted_by_hand(self, fake_db, google):
        seed_world(fake_db, calendar_id="borrado@group.calendar.google.com")
        gcal.sync_user("user-1", desired=gcal.desired_events(TODAY), http=google.client())
        assert gcal.get_link("user-1")["calendar_id"] != "borrado@group.calendar.google.com"

    def test_revoked_token_disconnects_and_notifies(self, fake_db, google):
        seed_world(fake_db, refresh="dead")
        google.revoked_tokens.add("dead")
        with pytest.raises(gcal.GoogleAuthRevoked):
            gcal.sync_user("user-1", desired={}, http=google.client())
        link = gcal.get_link("user-1")
        assert link["refresh_token_enc"] is None and link["last_sync_error"]
        [n] = fake_db.tables["notifications"]
        assert n["user_id"] == "user-1" and n["kind"] == "google_calendar_revoked"

    def test_lost_permission_pauses_without_calling_google(self, fake_db, google):
        seed_world(fake_db, permission=False)
        with pytest.raises(gcal.SyncPaused):
            gcal.sync_user("user-1", desired={}, http=google.client())
        assert google.requests == []
        assert "permiso" in gcal.get_link("user-1")["last_sync_error"]

    def test_dry_run_writes_nothing(self, fake_db, google):
        seed_world(fake_db)
        stats = gcal.sync_user("user-1", desired=gcal.desired_events(TODAY), http=google.client(), dry_run=True)
        assert stats["created"] == 3
        assert google.calendars == {} and gcal.get_link("user-1").get("events_count") is None
        assert gcal.get_link("user-1").get("sync_started_at") is None

    def test_calendar_id_saved_before_events_so_a_cut_sync_does_not_duplicate(self, fake_db, google):
        seed_world(fake_db)
        original = google.handler

        def failing(request):
            if request.method == "POST" and request.url.path.endswith("/events"):
                return httpx.Response(400, json={"error": {"code": 400}})
            return original(request)

        http = httpx.Client(transport=httpx.MockTransport(failing))
        stats = gcal.sync_user("user-1", desired=gcal.desired_events(TODAY), http=http)
        assert stats["failed"] == 3 and stats["created"] == 0     # un evento malo no corta los demás
        link = gcal.get_link("user-1")
        assert link["calendar_id"] in google.calendars
        assert "3 partidos" in link["last_sync_error"]
        # La siguiente sync usa el mismo calendario.
        gcal.sync_user("user-1", desired=gcal.desired_events(TODAY), http=google.client())
        assert len(google.calendars) == 1

    def test_concurrent_sync_is_refused(self, fake_db, google):
        seed_world(fake_db)
        gcal.save_link("user-1", {"sync_started_at": datetime.now(timezone.utc).isoformat()})
        with pytest.raises(gcal.SyncInProgress):
            gcal.sync_user("user-1", desired={}, http=google.client())
        assert google.requests == []

    def test_stale_claim_is_taken_over(self, fake_db, google):
        seed_world(fake_db)
        old = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
        gcal.save_link("user-1", {"sync_started_at": old})
        gcal.sync_user("user-1", desired=gcal.desired_events(TODAY), http=google.client())
        assert gcal.get_link("user-1")["sync_started_at"] is None

    def test_forget_user_revokes_and_deletes(self, fake_db, google, monkeypatch):
        seed_world(fake_db)
        gcal.forget_user("user-1", http=google.client())
        assert gcal.get_link("user-1") is None
        assert ("POST", "/revoke") in google.requests

    def test_rate_limit_is_retried(self, fake_db):
        calls = []

        def handler(request):
            calls.append(1)
            if len(calls) == 1:
                return httpx.Response(429)
            return httpx.Response(200, json={"id": "cal"})

        client = gcal.CalendarClient("t", httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda s: None)
        assert client.create_calendar() == "cal"
        assert len(calls) == 2


# ─── Cifrado ─────────────────────────────────────────────────────────────────

class TestTokenEncryption:
    def test_roundtrip_and_not_plaintext(self):
        blob = gcal.encrypt_token("refresh-secret")
        assert "refresh-secret" not in blob
        assert gcal.decrypt_token(blob) == "refresh-secret"

    def test_rotated_key_means_reconnect(self, monkeypatch):
        blob = gcal.encrypt_token("refresh-secret")
        monkeypatch.setenv("GOOGLE_TOKEN_KEY", Fernet.generate_key().decode())
        with pytest.raises(gcal.GoogleAuthRevoked):
            gcal.decrypt_token(blob)


# ─── Router ──────────────────────────────────────────────────────────────────

def allow(fake_db, user="user-1", module="calendar"):
    fake_db.tables.setdefault("user_permissions", []).append(
        {"user_id": user, "module": module, "can_view": True, "can_edit": False})


class TestRouter:
    def test_router_requires_user(self, make_request):
        assert any(d.dependency is require_user for d in router_mod.router.dependencies)
        with pytest.raises(HTTPException) as exc:
            require_user(make_request(user_id=None))
        assert exc.value.status_code == 401

    def test_connect_requires_calendar_or_games(self, fake_db, make_request):
        with pytest.raises(HTTPException) as exc:
            router_mod.connect(make_request())
        assert exc.value.status_code == 403

    def test_connect_not_configured_is_503(self, fake_db, make_request, monkeypatch):
        allow(fake_db)
        monkeypatch.delenv("GOOGLE_TOKEN_KEY")
        with pytest.raises(HTTPException) as exc:
            router_mod.connect(make_request())
        assert exc.value.status_code == 503

    def test_connect_builds_url_and_stores_only_the_hash(self, fake_db, make_request):
        allow(fake_db, module="games")
        url = router_mod.connect(make_request())["auth_url"]
        q = parse_qs(urlparse(url).query)
        assert q["access_type"] == ["offline"] and q["prompt"] == ["consent"]
        assert "https://www.googleapis.com/auth/calendar.app.created" in q["scope"][0].split()
        assert q["redirect_uri"] == ["https://www.fibaapp.com/google/callback"]
        link = gcal.get_link("user-1")
        assert link["oauth_state_hash"] == gcal.state_hash(q["state"][0])
        assert q["state"][0] not in json.dumps(link)

    def _start(self, fake_db, make_request, user="user-1"):
        allow(fake_db, user=user)
        url = router_mod.connect(make_request(user))["auth_url"]
        return parse_qs(urlparse(url).query)["state"][0]

    def test_callback_rejects_wrong_or_foreign_state(self, fake_db, make_request, monkeypatch):
        monkeypatch.setattr(gcal, "exchange_code", lambda *a: pytest.fail("no debería canjear"))
        self._start(fake_db, make_request, user="user-1")
        other_state = self._start(fake_db, make_request, user="user-2")
        with pytest.raises(HTTPException) as exc:
            router_mod.callback(router_mod.CallbackBody(code="c", state=other_state),
                                make_request("user-1"), BackgroundTasks())
        assert exc.value.status_code == 400
        # El state se consume aunque falle: no sirve para un segundo intento.
        assert gcal.get_link("user-1")["oauth_state_hash"] is None

    def test_callback_rejects_expired_state(self, fake_db, make_request, monkeypatch):
        monkeypatch.setattr(gcal, "exchange_code", lambda *a: pytest.fail("no debería canjear"))
        state = self._start(fake_db, make_request)
        past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        gcal.save_link("user-1", {"oauth_state_expires_at": past})
        with pytest.raises(HTTPException) as exc:
            router_mod.callback(router_mod.CallbackBody(code="c", state=state), make_request(), BackgroundTasks())
        assert exc.value.status_code == 400

    def test_callback_stores_encrypted_token_and_schedules_sync(self, fake_db, make_request, monkeypatch):
        monkeypatch.setattr(gcal, "exchange_code", lambda code, http: {
            "refresh_token": "refresh-xyz", "access_token": "a", "email": "yo@gmail.com"})
        state = self._start(fake_db, make_request)
        bg = BackgroundTasks()
        out = router_mod.callback(router_mod.CallbackBody(code="c", state=state), make_request(), bg)
        assert out["connected"] is True and out["google_email"] == "yo@gmail.com"
        assert "refresh-xyz" not in json.dumps(out) and "refresh_token_enc" not in out
        link = gcal.get_link("user-1")
        assert gcal.decrypt_token(link["refresh_token_enc"]) == "refresh-xyz"
        assert "refresh-xyz" not in link["refresh_token_enc"]
        assert [t.func for t in bg.tasks] == [router_mod._sync_quietly]

    def test_status_never_leaks_token_or_state(self, fake_db, make_request):
        seed_world(fake_db)
        gcal.save_link("user-1", {"oauth_state_hash": "abc"})
        out = router_mod.get_status(make_request())
        assert out["connected"] is True
        assert not {"refresh_token_enc", "oauth_state_hash"} & set(out)

    def test_status_not_configured_does_not_touch_the_table(self, fake_db, make_request, monkeypatch):
        monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID")
        fake_db.fail_tables.add("google_calendar_links")     # migración no aplicada
        out = router_mod.get_status(make_request())
        assert out["configured"] is False and out["connected"] is False

    def test_reconnect_with_other_account_revokes_old_and_resets_calendar(self, fake_db, make_request,
                                                                         google, monkeypatch):
        seed_world(fake_db, calendar_id="cal-old")
        gcal.save_link("user-1", {"google_email": "vieja@gmail.com"})
        monkeypatch.setattr(router_mod, "_http", google.client)
        monkeypatch.setattr(gcal, "exchange_code", lambda code, http: {
            "refresh_token": "refresh-new", "access_token": "a", "email": "nueva@gmail.com"})
        state = self._start(fake_db, make_request)
        router_mod.callback(router_mod.CallbackBody(code="c", state=state), make_request(), BackgroundTasks())
        link = gcal.get_link("user-1")
        assert link["calendar_id"] is None and link["google_email"] == "nueva@gmail.com"
        assert ("POST", "/revoke") in google.requests

    def test_reconnect_same_account_keeps_calendar_and_does_not_revoke(self, fake_db, make_request,
                                                                       google, monkeypatch):
        seed_world(fake_db, calendar_id="cal-old")
        gcal.save_link("user-1", {"google_email": "yo@gmail.com"})
        monkeypatch.setattr(router_mod, "_http", google.client)
        monkeypatch.setattr(gcal, "exchange_code", lambda code, http: {
            "refresh_token": "refresh-new", "access_token": "a", "email": "yo@gmail.com"})
        state = self._start(fake_db, make_request)
        router_mod.callback(router_mod.CallbackBody(code="c", state=state), make_request(), BackgroundTasks())
        assert gcal.get_link("user-1")["calendar_id"] == "cal-old"
        assert ("POST", "/revoke") not in google.requests

    def test_sync_without_permission_is_403(self, fake_db, make_request, monkeypatch):
        allow(fake_db)
        seed_world(fake_db, permission=False)
        allow(fake_db, module="calendar")
        monkeypatch.setattr(gcal, "user_can_sync", lambda uid: False)
        with pytest.raises(HTTPException) as exc:
            router_mod.sync_now(make_request())
        assert exc.value.status_code == 403

    def test_disconnect_transient_failure_does_not_revoke(self, fake_db, make_request, google, monkeypatch):
        seed_world(fake_db)
        gcal.sync_user("user-1", desired={}, http=google.client())
        original = google.handler

        def flaky(request):
            if request.method == "DELETE":
                return httpx.Response(503)
            return original(request)

        monkeypatch.setattr(router_mod, "_http", lambda: httpx.Client(transport=httpx.MockTransport(flaky)))
        monkeypatch.setattr(gcal.time, "sleep", lambda s: None)
        with pytest.raises(HTTPException) as exc:
            router_mod.disconnect(make_request())
        assert exc.value.status_code == 502
        assert ("POST", "/revoke") not in google.requests
        assert gcal.get_link("user-1")["refresh_token_enc"]

    def test_status_is_per_user(self, fake_db, make_request):
        seed_world(fake_db, user="user-1")
        assert router_mod.get_status(make_request("user-2"))["connected"] is False

    def test_sync_not_connected_is_409(self, fake_db, make_request):
        allow(fake_db)
        with pytest.raises(HTTPException) as exc:
            router_mod.sync_now(make_request())
        assert exc.value.status_code == 409

    def test_disconnect_revokes_deletes_calendar_and_clears(self, fake_db, make_request, google, monkeypatch):
        seed_world(fake_db)
        gcal.sync_user("user-1", desired=gcal.desired_events(TODAY), http=google.client())
        monkeypatch.setattr(router_mod, "_http", google.client)
        # Sin permiso de módulo también se puede desconectar.
        fake_db.tables["user_permissions"] = []
        out = router_mod.disconnect(make_request())
        assert out["connected"] is False and out["calendar_id"] is None
        assert google.calendars == {}
        assert ("POST", "/revoke") in google.requests
        assert gcal.get_link("user-1")["refresh_token_enc"] is None
