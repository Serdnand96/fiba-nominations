"""Cronogramas de logística, audiencias y traslados contra la base en memoria.

Lo que el parser no cubre: que el commit reemplace sin dejar el documento
vacío, que el Excel viejo salga del bucket, que la audiencia recorte de verdad
y que un traslado no se genere dos veces.
"""
import asyncio

import pytest
from fastapi import HTTPException

from api._lib.routers import logistics, logistics_schedules, public_logistics, transport
from tests.test_logistics_schedule_import import _bytes, staff_workbook, team_workbook

COMP = "comp-1"


class FakeUpload:
    def __init__(self, content: bytes, filename: str = "Schedule Horario (2).xlsx"):
        self._content = content
        self.filename = filename

    async def read(self) -> bytes:
        return self._content


class FakeStorage:
    """Bucket en memoria: qué claves hay, y cuáles se borraron."""

    def __init__(self):
        self.objects = {}
        self.removed = []
        self.fail_upload = False

    def from_(self, bucket):
        return self

    def upload(self, path, file, file_options=None):
        if self.fail_upload:
            raise RuntimeError("storage down")
        self.objects[path] = file
        return {"Key": path}

    def remove(self, paths):
        for path in paths:
            self.removed.append(path)
            self.objects.pop(path, None)


@pytest.fixture
def db(fake_db, make_request):
    fake_db.storage = FakeStorage()
    fake_db.seed("competitions", [
        {"id": COMP, "name": "LSB Grupo F", "start_date": "2026-11-13", "end_date": "2026-11-15"},
    ])
    return fake_db


def commit(make_request, workbook, section="transport", audience="delegation"):
    return asyncio.run(logistics_schedules.commit_schedule_import(
        make_request(), competition_id=COMP, section=section, audience=audience,
        file=FakeUpload(_bytes(workbook)),
    ))


def preview(workbook, section="transport", audience="delegation"):
    return asyncio.run(logistics_schedules.preview_schedule_import(
        competition_id=COMP, section=section, audience=audience, file=FakeUpload(_bytes(workbook)),
    ))


# ── Import ───────────────────────────────────────────────────────────────────

def test_preview_writes_nothing(db):
    result = preview(team_workbook("transport"))
    assert (result["total"], result["trainings"], result["games"], result["replaces"]) == (4, 2, 2, 0)
    assert [s["label"] for s in result["skipped"]] == ["Paisas"]
    assert db.tables.get("logistics_schedules", []) == []
    assert db.storage.objects == {}


def test_commit_stores_rows_header_and_original_file(db, make_request):
    result = commit(make_request, team_workbook("transport"))
    schedule = db.tables["logistics_schedules"][0]
    assert (schedule["section"], schedule["audience"], schedule["title"]) == ("transport", "delegation", "GRUPO F (QF)")
    assert schedule["uploaded_by"] == "user-1"
    assert schedule["file_path"].startswith(f"storage://nominations/logistics/schedules/{COMP}/transport-delegation-")
    assert len(db.storage.objects) == 1
    assert len(db.tables["logistics_schedule_rows"]) == 4
    assert "source_row" not in db.tables["logistics_schedule_rows"][0]
    # La respuesta no filtra la ruta de Storage.
    assert "file_path" not in result["schedule"] and result["schedule"]["has_file"] is True


def test_reimport_replaces_rows_and_drops_the_old_file(db, make_request):
    commit(make_request, team_workbook("transport"))
    old_key = next(iter(db.storage.objects))
    assert preview(staff_workbook())["replaces"] == 4

    result = commit(make_request, staff_workbook())
    assert (result["rows"], result["replaced"]) == (3, 4)
    assert len(db.tables["logistics_schedules"]) == 1            # mismo documento
    rows = db.tables["logistics_schedule_rows"]
    assert len(rows) == 3 and {r["kind"] for r in rows} == {"game"}
    assert old_key in db.storage.removed and len(db.storage.objects) == 1


def test_each_section_and_audience_is_its_own_document(db, make_request):
    commit(make_request, team_workbook("transport"), "transport", "delegation")
    commit(make_request, team_workbook("meals"), "meals", "delegation")
    commit(make_request, staff_workbook(), "transport", "staff")
    listed = logistics_schedules.load_schedules(COMP)
    assert [(s["section"], s["audience"]) for s in listed] == [
        ("transport", "staff"), ("transport", "delegation"), ("meals", "delegation"),
    ]
    assert [len(s["rows"]) for s in listed] == [3, 4, 4]
    assert [s["audience"] for s in logistics_schedules.load_schedules(COMP, "transport")] == ["staff", "delegation"]


def test_failed_row_insert_keeps_the_previous_document(db, make_request):
    commit(make_request, team_workbook("transport"))
    before = [dict(r) for r in db.tables["logistics_schedule_rows"]]
    old_path = db.tables["logistics_schedules"][0]["file_path"]

    db.fail_tables.add("logistics_schedule_rows")
    with pytest.raises(Exception):
        commit(make_request, staff_workbook())
    db.fail_tables.clear()

    assert db.tables["logistics_schedule_rows"] == before
    assert db.tables["logistics_schedules"][0]["file_path"] == old_path
    # El Excel nuevo no queda huérfano; el viejo sigue ahí.
    assert len(db.storage.objects) == 1 and old_path.endswith(next(iter(db.storage.objects)))


def test_wrong_section_and_storage_failure_write_nothing(db, make_request):
    with pytest.raises(HTTPException) as wrong:
        commit(make_request, team_workbook("meals"), "transport")
    assert wrong.value.status_code == 400

    db.storage.fail_upload = True
    with pytest.raises(HTTPException) as down:
        commit(make_request, team_workbook("transport"))
    assert down.value.status_code == 502
    assert db.tables.get("logistics_schedules", []) == []


def test_unknown_scope_is_rejected(db):
    for section, audience in (("flights", "staff"), ("transport", "referees")):
        with pytest.raises(HTTPException) as raised:
            preview(team_workbook("transport"), section, audience)
        assert raised.value.status_code == 400


# ── Documento y filas a mano ─────────────────────────────────────────────────

def test_manual_document_rows_and_delete(db, make_request):
    created = logistics_schedules.create_schedule(logistics_schedules.ScheduleCreate(
        competition_id=COMP, section="meals", audience="vip"))
    with pytest.raises(HTTPException) as dup:
        logistics_schedules.create_schedule(logistics_schedules.ScheduleCreate(
            competition_id=COMP, section="meals", audience="vip"))
    assert dup.value.status_code == 409

    first = logistics_schedules.create_row(created["id"], logistics_schedules.RowCreate(
        date="2026-11-13", team="Autoridades", lunch="13:00"))
    second = logistics_schedules.create_row(created["id"], logistics_schedules.RowCreate(
        date="2026-11-13", team="Invitados", lunch="TAKE AWAY"))
    assert (first["position"], second["position"]) == (0, 1)

    updated = logistics_schedules.update_row(second["id"], logistics_schedules.RowUpdate(dinner="21:00"))
    assert (updated["lunch"], updated["dinner"]) == ("TAKE AWAY", "21:00")   # lo no enviado no se pisa

    view = logistics_schedules.update_schedule(created["id"], logistics_schedules.ScheduleUpdate(
        title=" Cena de gala ", days=[logistics_schedules.DayMeta(date="2026-11-13", label="DÍA 1", notes="")]))
    assert view["title"] == "Cena de gala"
    assert view["days"] == [{"date": "2026-11-13", "label": "DÍA 1", "notes": None}]

    logistics_schedules.delete_schedule(created["id"])
    assert db.tables["logistics_schedules"] == []


def test_public_view_publishes_the_table_not_the_file(db, make_request):
    commit(make_request, team_workbook("transport"))
    db.seed("logistics_public_links", [{"token": "tok", "competition_id": COMP, "enabled": True}])
    published = public_logistics.get_schedules("tok")
    assert len(published) == 1 and len(published[0]["rows"]) == 4
    for hidden in ("file_path", "file_name", "has_file", "uploaded_by", "uploaded_at", "competition_id"):
        assert hidden not in published[0]

    db.tables["logistics_public_links"][0]["enabled"] = False
    with pytest.raises(HTTPException) as off:
        public_logistics.get_schedules("tok")
    assert off.value.status_code == 404


# ── Audiencias sobre el padrón ───────────────────────────────────────────────

@pytest.fixture
def roster(db):
    db.seed("logistics_participants", [
        {"id": "p-td", "competition_id": COMP, "first_name": "Ana", "last_name": "Diaz", "category": "official", "pax": 1},
        {"id": "p-team", "competition_id": COMP, "first_name": "Flamengo", "last_name": None, "category": "team", "pax": 17},
        {"id": "p-vip", "competition_id": COMP, "first_name": "Luis", "last_name": "Mora", "category": "vip", "pax": 1},
    ])
    db.seed("logistics_travel_legs", [
        {"id": "l-td", "participant_id": "p-td", "direction": "arrival", "date": "2026-11-11", "airport": "MDE", "time": "10:00:00", "trip_id": None},
        {"id": "l-team", "participant_id": "p-team", "direction": "arrival", "date": "2026-11-11", "airport": "MDE", "time": "09:00:00", "trip_id": None},
        {"id": "l-vip", "participant_id": "p-vip", "direction": "arrival", "date": "2026-11-12", "airport": "MDE", "time": "15:00:00", "trip_id": None},
    ])
    db.seed("logistics_stays", [
        {"id": "s-td", "participant_id": "p-td", "check_in": "2026-11-11", "check_out": "2026-11-16", "share_with_id": None},
        {"id": "s-team", "participant_id": "p-team", "check_in": "2026-11-11", "check_out": "2026-11-13", "share_with_id": None},
    ])
    db.seed("logistics_hotels", [])
    return db


def test_audience_cuts_participants_movements_and_rooming(roster):
    assert len(logistics.list_participants(COMP, None)) == 3
    assert [p["id"] for p in logistics.list_participants(COMP, "delegation")] == ["p-team"]

    everyone = logistics.build_movement_groups(COMP, "arrival")
    assert [(g["date"], g["pax"]) for g in everyone] == [("2026-11-11", 18), ("2026-11-12", 1)]
    staff = logistics.build_movement_groups(COMP, "arrival", "staff")
    assert [(g["date"], g["pax"], g["covered"]) for g in staff] == [("2026-11-11", 1, False)]

    assert logistics.build_rooming(COMP)["total_nights"] == 7
    assert logistics.build_rooming(COMP, "delegation")["total_nights"] == 2
    assert logistics.build_rooming(COMP, "vip")["rows"] == []

    with pytest.raises(HTTPException) as raised:
        logistics.list_participants(COMP, "referees")
    assert raised.value.status_code == 400


# ── Traslados desde el manifiesto ────────────────────────────────────────────

def test_trips_from_movements_cover_their_legs_once(roster):
    roster.seed("transport_events", [{"id": "ev-1", "competition_id": COMP}])
    roster.seed("transport_vehicles", [{"id": "van-1", "event_id": "ev-1", "name": "Van 1"}])
    roster.seed("transport_trips", [{"id": "t-old", "vehicle_id": "van-1", "date": "2026-11-11", "trip_number": 2}])

    request = transport.TripsFromMovements(competition_id=COMP, trips=[transport.MovementTrip(
        direction="arrival", date="2026-11-11", airport="MDE", vehicle_id="van-1",
        departure_time="9:00", origin="MDE", destination="Hotel Dann")])
    result = transport.create_trips_from_movements(request)

    trip = result["created"][0]
    assert (trip["trip_number"], trip["trip_type"], trip["departure_time"], trip["legs"]) == (3, "transfer", "09:00", 2)
    covered = {l["id"]: l["trip_id"] for l in roster.tables["logistics_travel_legs"]}
    assert covered["l-td"] == covered["l-team"] == trip["id"] and covered["l-vip"] is None
    assert logistics.build_movement_groups(COMP, "arrival")[0]["covered"] is True

    # Pedirlo de nuevo no duplica: el grupo ya está cubierto.
    again = transport.create_trips_from_movements(request)
    assert again["created"] == [] and len(again["skipped"]) == 1
    assert len(roster.tables["transport_trips"]) == 2


def test_trips_from_movements_need_an_event_and_its_own_vehicle(roster):
    request = transport.TripsFromMovements(competition_id=COMP, trips=[transport.MovementTrip(
        direction="arrival", date="2026-11-11", airport="MDE", vehicle_id="van-x",
        departure_time="09:00", origin="MDE", destination="Hotel")])
    with pytest.raises(HTTPException) as no_event:
        transport.create_trips_from_movements(request)
    assert no_event.value.status_code == 404

    roster.seed("transport_events", [{"id": "ev-1", "competition_id": COMP}])
    roster.seed("transport_vehicles", [{"id": "van-1", "event_id": "ev-1", "name": "Van 1"}])
    with pytest.raises(HTTPException) as foreign:
        transport.create_trips_from_movements(request)
    assert foreign.value.status_code == 400
    assert roster.tables.get("transport_trips", []) == []


# ── Casos que marcó la revisión ──────────────────────────────────────────────

def test_failed_first_import_leaves_no_document_behind(db, make_request):
    """Sin documento previo: si las filas no entran, no queda un cronograma
    vacío apuntando a un Excel que ya se borró."""
    db.fail_tables.add("logistics_schedule_rows")
    with pytest.raises(Exception):
        commit(make_request, team_workbook("transport"))
    db.fail_tables.clear()

    assert db.tables.get("logistics_schedules", []) == []
    assert db.storage.objects == {}
    # Y el siguiente intento funciona como un primer import normal.
    assert commit(make_request, team_workbook("transport"))["replaced"] == 0


def test_xlsm_keeps_its_extension(db, make_request):
    asyncio.run(logistics_schedules.commit_schedule_import(
        make_request(), competition_id=COMP, section="transport", audience="staff",
        file=FakeUpload(_bytes(staff_workbook()), "Schedule Arbitros.XLSM"),
    ))
    assert next(iter(db.storage.objects)).endswith(".xlsm")
    assert db.tables["logistics_schedules"][0]["file_path"].endswith(".xlsm")


def test_room_shared_across_audiences_still_counts_once_per_view(roster):
    # La delegación (p-team) comparte cuarto con un VIP (p-vip, id mayor).
    roster.tables["logistics_stays"][1]["share_with_id"] = "p-vip"
    roster.tables["logistics_stays"].append(
        {"id": "s-vip", "participant_id": "p-vip", "check_in": "2026-11-11", "check_out": "2026-11-13",
         "share_with_id": "p-team"})
    assert logistics.build_rooming(COMP)["total_nights"] == 7           # td 5 + la habitación compartida 2
    assert logistics.build_rooming(COMP, "delegation")["total_nights"] == 2
    # En la vista VIP el compañero no está: la fila del VIP es la que suma.
    assert logistics.build_rooming(COMP, "vip")["total_nights"] == 2


def _fleet(roster):
    roster.seed("transport_events", [{"id": "ev-1", "competition_id": COMP}])
    roster.seed("transport_vehicles", [{"id": "van-1", "event_id": "ev-1", "name": "Van 1"}])
    roster.seed("transport_trips", [])


def _arrival(**overrides):
    base = dict(direction="arrival", date="2026-11-11", airport="MDE", vehicle_id="van-1",
                departure_time="09:00", origin="MDE", destination="Hotel Dann")
    return transport.MovementTrip(**{**base, **overrides})


def test_same_group_twice_in_one_request_is_rejected(roster):
    _fleet(roster)
    with pytest.raises(HTTPException) as raised:
        transport.create_trips_from_movements(
            transport.TripsFromMovements(competition_id=COMP, trips=[_arrival(), _arrival(airport=" MDE ")]))
    assert raised.value.status_code == 400
    assert roster.tables["transport_trips"] == []


def test_legs_taken_by_another_request_are_not_overwritten(roster, monkeypatch):
    """Otro request cubrió los tramos entre la lectura y el UPDATE: el viaje
    que quedó sin tramos se borra y el grupo se informa como salteado."""
    _fleet(roster)
    stale = logistics.build_movement_groups(COMP, "arrival")          # leído "antes"
    for leg in roster.tables["logistics_travel_legs"]:
        leg["trip_id"] = "t-other"                                    # el otro request ganó
    monkeypatch.setattr(logistics, "build_movement_groups",
                        lambda comp, direction, audience=None: stale if direction == "arrival" else [])

    result = transport.create_trips_from_movements(
        transport.TripsFromMovements(competition_id=COMP, trips=[_arrival()]))
    assert result["created"] == [] and len(result["skipped"]) == 1
    assert roster.tables["transport_trips"] == []
    assert {l["trip_id"] for l in roster.tables["logistics_travel_legs"]} == {"t-other"}


def test_group_airport_with_stray_spaces_still_matches(roster):
    _fleet(roster)
    for leg in roster.tables["logistics_travel_legs"]:
        leg["airport"] = " MDE"
    result = transport.create_trips_from_movements(
        transport.TripsFromMovements(competition_id=COMP, trips=[_arrival()]))
    assert result["created"][0]["legs"] == 2
