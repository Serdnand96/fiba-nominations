"""Operación de logística (migración 055/056) contra la base en memoria.

Contactos, salones, adicionales y documentos de logistics_ops.py; los pagos por
hotel que se leen de Budget; y los cambios que esa tanda le hizo a hoteles,
participantes, gastos, descargas privadas y la vista pública.
"""
import asyncio
import uuid

import pytest
from fastapi import FastAPI, HTTPException, Request
from starlette.testclient import TestClient

from api._lib.routers import budget, logistics, logistics_ops, payments, public_logistics, transport
from api._lib.schemas import ExpenseCreate, ExpenseUpdate
from tests.test_logistics_schedules_router import FakeStorage, FakeUpload

COMP = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"
H_STAFF = "aaaaaaaa-0000-0000-0000-000000000001"
H_TEAMS = "aaaaaaaa-0000-0000-0000-000000000002"
H_SHARED = "aaaaaaaa-0000-0000-0000-000000000003"
H_FOREIGN = "aaaaaaaa-0000-0000-0000-000000000009"
PERSON = "bbbbbbbb-0000-0000-0000-000000000001"
PERSON_FOREIGN = "bbbbbbbb-0000-0000-0000-000000000009"

PDF = b"%PDF-1.4\n" + b"x" * 100
PNG = b"\x89PNG\r\n\x1a\n" + b"x" * 100
JPEG = b"\xff\xd8\xff\xe0" + b"x" * 100


@pytest.fixture
def db(fake_db):
    fake_db.storage = FakeStorage()
    fake_db.seed("competitions", [{"id": COMP, "name": "LSB"}, {"id": OTHER, "name": "BCLA"}])
    fake_db.seed("logistics_hotels", [
        {"id": H_STAFF, "competition_id": COMP, "name": "Dann", "audience": "staff"},
        {"id": H_TEAMS, "competition_id": COMP, "name": "Poblado", "audience": "delegation"},
        {"id": H_SHARED, "competition_id": COMP, "name": "Intercontinental", "audience": None},
        {"id": H_FOREIGN, "competition_id": OTHER, "name": "Hilton", "audience": None},
    ])
    fake_db.seed("logistics_participants", [
        {"id": PERSON, "competition_id": COMP, "first_name": "Ana", "category": "team"},
        {"id": PERSON_FOREIGN, "competition_id": OTHER, "first_name": "Luis", "category": "team"},
    ])
    return fake_db


def upload(make_request, content=PDF, filename="menu.pdf", **query):
    params = {"competition_id": COMP, "kind": "menu", "hotel_id": H_STAFF,
              "participant_id": None, "charge_id": None, **query}
    return asyncio.run(logistics_ops.upload_document(
        make_request(), file=FakeUpload(content, filename), **params))


def status_of(fn, *args, **kwargs) -> int:
    with pytest.raises(HTTPException) as raised:
        fn(*args, **kwargs)
    return raised.value.status_code


# ── Audiencia: la propia más las compartidas (NULL) ─────────────────────────

def test_contacts_by_audience_include_the_shared_ones(db):
    db.seed("logistics_contacts", [
        {"id": "c1", "competition_id": COMP, "kind": "transport", "audience": "staff", "name": "Ruta Staff"},
        {"id": "c2", "competition_id": COMP, "kind": "ice", "audience": "delegation", "name": "Hielos del Valle"},
        {"id": "c3", "competition_id": COMP, "kind": "transport", "audience": None, "name": "Coordinador"},
        {"id": "c4", "competition_id": OTHER, "kind": "ice", "audience": None, "name": "De otra competencia"},
    ])
    names = lambda rows: [r["name"] for r in rows]
    assert names(logistics_ops.list_contacts(COMP)) == ["Hielos del Valle", "Coordinador", "Ruta Staff"]
    assert names(logistics_ops.list_contacts(COMP, "delegation")) == ["Hielos del Valle", "Coordinador"]
    assert names(logistics_ops.list_contacts(COMP, "vip")) == ["Coordinador"]
    assert names(logistics_ops.list_contacts(COMP, "staff", "ice")) == []
    assert names(logistics_ops.list_contacts(COMP, None, "transport")) == ["Coordinador", "Ruta Staff"]
    assert status_of(logistics_ops.list_contacts, COMP, "referees") == 400
    assert status_of(logistics_ops.list_contacts, COMP, None, "pizza") == 400


def test_hotels_and_rooming_by_audience_include_the_shared_ones(db):
    names = lambda rows: [h["name"] for h in rows]
    assert names(logistics.list_hotels(COMP)) == ["Dann", "Intercontinental", "Poblado"]
    assert names(logistics.list_hotels(COMP, "delegation")) == ["Intercontinental", "Poblado"]
    assert names(logistics.list_hotels(COMP, "staff")) == ["Dann", "Intercontinental"]
    assert status_of(logistics.list_hotels, COMP, "referees") == 400

    db.seed("logistics_stays", [{"id": "s1", "participant_id": PERSON, "hotel_id": H_TEAMS,
                                 "check_in": "2026-11-11", "check_out": "2026-11-13"}])
    assert sorted(names(logistics.build_rooming(COMP, "delegation")["hotels"])) == ["Intercontinental", "Poblado"]
    assert len(logistics.build_rooming(COMP)["hotels"]) == 3
    # La fila sigue resolviendo el nombre del hotel aunque el filtro lo recorte.
    assert logistics.build_rooming(COMP, "delegation")["rows"][0]["hotel"] == "Poblado"


def test_hotel_and_participant_new_fields(db):
    hotel = logistics.create_hotel(logistics.HotelCreate(
        competition_id=COMP, name="Nuevo", audience="vip", contact_name="  Marta  "))
    assert (hotel["audience"], hotel["contact_name"]) == ("vip", "Marta")
    assert status_of(logistics.create_hotel, logistics.HotelCreate(
        competition_id=COMP, name="X", audience="referees")) == 400

    updated = logistics.update_hotel(hotel["id"], logistics.HotelUpdate(audience=None, contact_name=""))
    assert (updated["audience"], updated["contact_name"]) == (None, None)    # null = compartido
    assert status_of(logistics.update_hotel, hotel["id"], logistics.HotelUpdate(audience="x")) == 400

    person = logistics.create_participant(logistics.ParticipantCreate(
        competition_id=COMP, first_name="Flamengo", category="team", team=" Flamengo "))
    assert person["team"] == "Flamengo"
    assert logistics.update_participant(person["id"], logistics.ParticipantUpdate(team="")) ["team"] is None


def test_driver_assigned_to_can_be_set_and_cleared(db):
    driver = transport.create_driver(transport.DriverCreate(event_id="ev", name="Juan", assigned_to=" TD "))
    assert driver["assigned_to"] == "TD"
    assert transport.update_driver(driver["id"], transport.DriverUpdate(phone="1"))["assigned_to"] == "TD"
    assert transport.update_driver(driver["id"], transport.DriverUpdate(assigned_to=None))["assigned_to"] is None


# ── Contactos y salones ──────────────────────────────────────────────────────

def test_contact_crud_validates_and_cleans(db):
    row = logistics_ops.create_contact(logistics_ops.ContactCreate(
        competition_id=COMP, kind="laundry", audience="delegation", hotel_id=H_TEAMS,
        name=" Lavandería Sol ", phone="", pickup_hours="lun a vie 8-10"))
    assert (row["name"], row["phone"], row["audience"]) == ("Lavandería Sol", None, "delegation")

    # Parcial: lo que no se manda no se pisa; null explícito limpia lo que admite NULL.
    updated = logistics_ops.update_contact(row["id"], logistics_ops.ContactUpdate(audience=None, notes="ok"))
    assert (updated["audience"], updated["notes"], updated["pickup_hours"]) == (None, "ok", "lun a vie 8-10")
    assert logistics_ops.update_contact(row["id"], logistics_ops.ContactUpdate(name=None, phone="1"))["name"] == "Lavandería Sol"

    assert status_of(logistics_ops.update_contact, row["id"], logistics_ops.ContactUpdate(name="  ")) == 400
    assert status_of(logistics_ops.update_contact, row["id"], logistics_ops.ContactUpdate(kind="pizza")) == 400
    assert status_of(logistics_ops.update_contact, row["id"], logistics_ops.ContactUpdate()) == 400
    assert status_of(logistics_ops.update_contact, str(uuid.uuid4()), logistics_ops.ContactUpdate(notes="x")) == 404
    assert status_of(logistics_ops.create_contact, logistics_ops.ContactCreate(
        competition_id=COMP, kind="pizza", name="x")) == 400
    assert status_of(logistics_ops.create_contact, logistics_ops.ContactCreate(
        competition_id=COMP, name="x", audience="referees")) == 400
    assert status_of(logistics_ops.create_contact, logistics_ops.ContactCreate(
        competition_id=str(uuid.uuid4()), name="x")) == 404

    logistics_ops.delete_contact(row["id"])
    assert db.tables["logistics_contacts"] == []
    assert status_of(logistics_ops.delete_contact, row["id"]) == 404


def test_hotel_must_belong_to_the_competition(db):
    assert status_of(logistics_ops.create_contact, logistics_ops.ContactCreate(
        competition_id=COMP, name="x", hotel_id=H_FOREIGN)) == 400
    assert status_of(logistics_ops.create_room, logistics_ops.RoomCreate(
        competition_id=COMP, name="Sala", hotel_id=H_FOREIGN)) == 400
    assert status_of(logistics_ops.create_hotel_charge, logistics_ops.ChargeCreate(
        competition_id=COMP, hotel_id=H_FOREIGN, concept="Noche extra"), _request()) == 400
    contact = logistics_ops.create_contact(logistics_ops.ContactCreate(competition_id=COMP, name="ok", hotel_id=H_STAFF))
    assert status_of(logistics_ops.update_contact, contact["id"], logistics_ops.ContactUpdate(hotel_id=H_FOREIGN)) == 400
    assert db.tables.get("logistics_rooms", []) == [] and db.tables.get("logistics_hotel_charges", []) == []


def test_rooms_normalize_times_and_sort_by_date(db):
    late = logistics_ops.create_room(logistics_ops.RoomCreate(
        competition_id=COMP, name="Media Day", purpose="media_day", audience="delegation",
        date="2026-11-14", start_time="9:00", end_time="10:30", capacity=40))
    assert (late["start_time"], late["end_time"], late["capacity"]) == ("09:00", "10:30", 40)
    logistics_ops.create_room(logistics_ops.RoomCreate(competition_id=COMP, name="Sin día"))
    logistics_ops.create_room(logistics_ops.RoomCreate(
        competition_id=COMP, name="Charla", purpose="technical_meeting", audience=None, date="2026-11-12"))
    logistics_ops.create_room(logistics_ops.RoomCreate(
        competition_id=COMP, name="PIC", purpose="pic", audience="vip", date="2026-11-13"))

    assert [r["name"] for r in logistics_ops.list_rooms(COMP)] == ["Charla", "PIC", "Media Day", "Sin día"]
    assert [r["name"] for r in logistics_ops.list_rooms(COMP, "delegation")] == ["Charla", "Media Day", "Sin día"]

    assert status_of(logistics_ops.create_room, logistics_ops.RoomCreate(
        competition_id=COMP, name="x", purpose="party")) == 400
    assert status_of(logistics_ops.create_room, logistics_ops.RoomCreate(
        competition_id=COMP, name="x", start_time="tarde")) == 400
    assert status_of(logistics_ops.create_room, logistics_ops.RoomCreate(
        competition_id=COMP, name="x", date="14/11")) == 400
    cleared = logistics_ops.update_room(late["id"], logistics_ops.RoomUpdate(capacity=None, end_time=""))
    assert (cleared["capacity"], cleared["end_time"], cleared["start_time"]) == (None, None, "09:00")


def _request(user_id="user-1"):
    from tests.conftest import FakeRequest
    return FakeRequest(user_id)


def test_charges_record_who_and_clean_money(db):
    charge = logistics_ops.create_hotel_charge(logistics_ops.ChargeCreate(
        competition_id=COMP, hotel_id=H_STAFF, kind="quote", concept=" Salón extra ",
        amount=1234.567, currency=" usd "), _request("user-7"))
    assert (charge["concept"], charge["amount"], charge["currency"], charge["created_by"]) == (
        "Salón extra", 1234.57, "USD", "user-7")
    assert status_of(logistics_ops.create_hotel_charge, logistics_ops.ChargeCreate(
        competition_id=COMP, hotel_id=H_STAFF, kind="loan", concept="x"), _request()) == 400
    assert [c["id"] for c in logistics_ops.list_hotel_charges(COMP, H_STAFF)] == [charge["id"]]
    assert logistics_ops.list_hotel_charges(COMP, H_TEAMS) == []
    assert status_of(logistics_ops.list_hotel_charges) == 400
    # Es informativo: no toca ninguna tabla de Budget.
    assert db.tables.get("expenses", []) == []


def test_deleting_a_charge_removes_its_quote_objects(db, make_request):
    charge = logistics_ops.create_hotel_charge(logistics_ops.ChargeCreate(
        competition_id=COMP, hotel_id=H_STAFF, kind="quote", concept="Cotización"), _request())
    doc = upload(make_request, kind="quote", hotel_id=None, charge_id=charge["id"])
    other = upload(make_request)      # un menú del mismo hotel: no cuelga del cargo
    assert len(db.storage.objects) == 2

    logistics_ops.delete_hotel_charge(charge["id"])
    assert db.tables["logistics_hotel_charges"] == []
    assert len(db.storage.removed) == 1 and len(db.storage.objects) == 1
    assert doc["id"] != other["id"]


def test_deleting_a_hotel_or_participant_removes_their_objects(db, make_request):
    charge = logistics_ops.create_hotel_charge(logistics_ops.ChargeCreate(
        competition_id=COMP, hotel_id=H_STAFF, kind="quote", concept="Cot"), _request())
    upload(make_request)                                                          # menú del hotel
    upload(make_request, kind="quote", hotel_id=None, charge_id=charge["id"])     # PDF de la cotización
    upload(make_request, kind="passport", hotel_id=None, participant_id=PERSON)   # pasaporte
    assert len(db.storage.objects) == 3

    # Simula el ON DELETE CASCADE de Postgres sobre los registros del hotel.
    logistics.delete_participant(PERSON)
    assert len(db.storage.objects) == 2
    logistics.delete_hotel(H_STAFF)
    assert db.storage.objects == {} and len(db.storage.removed) == 3


# ── Documentos ───────────────────────────────────────────────────────────────

def test_upload_stores_privately_and_never_returns_the_path(db, make_request):
    meta = upload(make_request, filename="Menú Dann (1).pdf")
    row = db.tables["logistics_documents"][0]
    key = row["file_path"].removeprefix("storage://nominations/")
    assert key.startswith(f"logistics/docs/{COMP}/menu-") and key.endswith(".pdf")
    assert key in db.storage.objects
    assert (row["content_type"], row["size_bytes"], row["uploaded_by"]) == ("application/pdf", len(PDF), "user-1")
    assert set(meta) == set(logistics_ops.DOCUMENT_FIELDS) and "file_path" not in meta
    assert meta["file_name"] == "Menú Dann (1).pdf"


def test_upload_accepts_pdf_jpeg_png_and_fixes_the_extension(db, make_request):
    for content, content_type, ext in ((JPEG, "image/jpeg", ".jpg"), (PNG, "image/png", ".png")):
        meta = upload(make_request, content, "escaneo")
        assert meta["content_type"] == content_type and meta["file_name"] == "escaneo" + ext
    assert upload(make_request, JPEG, "foto.JPEG")["file_name"] == "foto.JPEG"
    assert upload(make_request, PDF, "")["file_name"] == "menu.pdf"


@pytest.mark.parametrize("content, filename", [
    (b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>", "logo.png"),
    (b"MZ\x90\x00 executable", "menu.pdf"),
    (b"GIF89a....", "menu.gif"),
    (b"PK\x03\x04 zip", "menu.pdf"),
])
def test_upload_rejects_other_types_by_content(db, make_request, content, filename):
    assert status_of(upload, make_request, content, filename) == 400
    assert db.storage.objects == {} and db.tables.get("logistics_documents", []) == []


def test_upload_rejects_empty_and_oversized_files(db, make_request):
    assert status_of(upload, make_request, b"") == 400
    assert status_of(upload, make_request, b"%PDF" + b"0" * (10 * 1024 * 1024)) == 413
    assert upload(make_request, b"%PDF" + b"0" * (10 * 1024 * 1024 - 4))["size_bytes"] == 10 * 1024 * 1024
    assert len(db.storage.objects) == 1


def test_upload_requires_the_owner_the_check_constraint_wants(db, make_request):
    assert status_of(upload, make_request, kind="menu", hotel_id=None) == 400
    assert status_of(upload, make_request, kind="passport", hotel_id=None) == 400
    assert status_of(upload, make_request, kind="quote", hotel_id=None) == 400
    assert status_of(upload, make_request, kind="receipt") == 400
    # `other` no exige dueño.
    assert upload(make_request, kind="other", hotel_id=None)["kind"] == "other"
    assert len(db.storage.objects) == 1


def test_upload_owner_must_belong_to_that_competition(db, make_request):
    assert status_of(upload, make_request, hotel_id=H_FOREIGN) == 400
    assert status_of(upload, make_request, kind="passport", hotel_id=None, participant_id=PERSON_FOREIGN) == 400
    assert status_of(upload, make_request, kind="quote", hotel_id=None, charge_id=str(uuid.uuid4())) == 400
    assert status_of(upload, make_request, competition_id=str(uuid.uuid4())) == 404
    assert db.storage.objects == {} and db.tables.get("logistics_documents", []) == []


def test_failed_insert_removes_the_uploaded_object(db, make_request):
    db.fail_tables.add("logistics_documents")
    with pytest.raises(Exception):
        upload(make_request)
    db.fail_tables.clear()
    assert db.storage.objects == {} and len(db.storage.removed) == 1
    assert db.storage.removed[0].startswith(f"logistics/docs/{COMP}/menu-")


def test_storage_failure_is_a_502_and_writes_no_row(db, make_request):
    db.storage.fail_upload = True
    assert status_of(upload, make_request) == 502
    assert db.tables.get("logistics_documents", []) == []


def test_listing_documents_never_includes_the_storage_path(db, make_request):
    upload(make_request)
    upload(make_request, kind="passport", hotel_id=None, participant_id=PERSON)
    everything = logistics_ops.list_documents(COMP)
    assert len(everything) == 2
    for doc in everything:
        assert set(doc) == set(logistics_ops.DOCUMENT_FIELDS)
        assert "file_path" not in doc and "uploaded_by" not in doc
    assert [d["kind"] for d in logistics_ops.list_documents(COMP, "passport")] == ["passport"]
    assert [d["kind"] for d in logistics_ops.list_documents(None, None, H_STAFF)] == ["menu"]
    assert logistics_ops.list_documents(OTHER) == []
    assert status_of(logistics_ops.list_documents) == 400
    assert status_of(logistics_ops.list_documents, COMP, "receipt") == 400


def test_download_streams_the_documents_own_object(db, make_request, monkeypatch):
    first = upload(make_request, filename="uno.pdf")
    second = upload(make_request, PNG, "dos.png")
    key = {d["id"]: d["file_path"] for d in db.tables["logistics_documents"]}[second["id"]]
    seen = {}

    class Reply:
        status_code = 200
        content = b"bytes"
        headers = {"content-type": "image/png"}

    def fake_get(url, **kwargs):
        seen["url"] = url
        return Reply()

    monkeypatch.setattr(payments.httpx, "get", fake_get)
    response = logistics_ops.download_document(second["id"], make_request())
    assert seen["url"].endswith("/storage/v1/object/nominations/" + key.removeprefix("storage://nominations/"))
    assert response.body == b"bytes" and response.headers["cache-control"] == "private, no-store"
    assert 'filename="dos.png"' in response.headers["content-disposition"]
    assert status_of(logistics_ops.download_document, str(uuid.uuid4()), make_request()) == 404
    assert first["id"] != second["id"]


def test_delete_document_removes_row_and_object(db, make_request):
    doc = upload(make_request)
    logistics_ops.delete_document(doc["id"])
    assert db.tables["logistics_documents"] == [] and db.storage.objects == {}
    assert status_of(logistics_ops.delete_document, doc["id"]) == 404


# ── Pagos de FIBA por hotel (lectura de Budget) ──────────────────────────────

def test_hotel_payments_only_approved_and_paid_with_a_narrow_projection(db):
    def expense(n, status, amount, hotel=H_STAFF, vendor="v1", **extra):
        return {"id": f"e{n}", "record_no": f"GA-0000{n}", "description": f"Gasto {n}", "amount": amount,
                "status": status, "expense_date": f"2026-11-0{n}", "payment_date": None, "invoice_no": f"F-{n}",
                "hotel_id": hotel, "vendor_id": vendor, "department_code": "competitions",
                "bank_confirmation": "SECRETO", "payment_method": "wire", "comments": "interno",
                "created_by": "user-9", "payee_name": "x", "competition_id": COMP, **extra}

    db.seed("expenses", [
        expense(1, "paid", 100, payment_date="2026-11-05"),
        expense(2, "approved", 40.5),
        expense(3, "draft", 999),
        expense(4, "rejected", 999),
        expense(5, "cancelled", 999),
        expense(6, "paid", 7, hotel=H_TEAMS),            # de otro hotel
        expense(7, "paid", 11.25, vendor=None),
    ])
    db.seed("vendors", [{"id": "v1", "name": "Hotel Dann SA", "bank_info": "CBU", "tax_id": "30-1"}])

    out = logistics_ops.hotel_payments(H_STAFF)
    assert {r["record_no"] for r in out["rows"]} == {"GA-00001", "GA-00002", "GA-00007"}
    assert (out["total_paid"], out["total_approved"]) == (111.25, 40.5)
    allowed = {"record_no", "description", "amount", "status", "expense_date", "payment_date",
               "invoice_no", "vendor_name"}
    for row in out["rows"]:
        assert set(row) == allowed
    by_no = {r["record_no"]: r for r in out["rows"]}
    assert by_no["GA-00001"]["vendor_name"] == "Hotel Dann SA" and by_no["GA-00007"]["vendor_name"] is None
    # Un solo SELECT a vendors para todos los ids.
    assert len(db.calls_to("vendors")) == 1
    assert "bank_info" not in str(out) and "SECRETO" not in str(out)

    assert logistics_ops.hotel_payments(H_SHARED) == {"rows": [], "total_paid": 0, "total_approved": 0}
    assert status_of(logistics_ops.hotel_payments, str(uuid.uuid4())) == 404


# ── Permisos de los endpoints nuevos ─────────────────────────────────────────

@pytest.fixture
def client(db):
    """El router real montado en una app mínima, con el usuario que diga el header."""
    app = FastAPI()

    @app.middleware("http")
    async def fake_auth(request: Request, call_next):
        if request.headers.get("x-user"):
            request.state.user = {"id": request.headers["x-user"], "email": "u@example.test"}
        return await call_next(request)

    app.include_router(logistics_ops.router, prefix="/api")
    db.seed("user_permissions", [
        {"user_id": "viewer", "module": "logistics", "can_view": True, "can_edit": False},
        {"user_id": "editor", "module": "logistics", "can_view": True, "can_edit": True},
        {"user_id": "other", "module": "payments", "can_view": True, "can_edit": True},
    ])
    return TestClient(app)


WRITES = [
    ("post", "/api/logistics/contacts", {"json": {"competition_id": COMP, "name": "x"}}),
    ("put", "/api/logistics/contacts/x", {"json": {"notes": "x"}}),
    ("delete", "/api/logistics/contacts/x", {}),
    ("post", "/api/logistics/rooms", {"json": {"competition_id": COMP, "name": "x"}}),
    ("put", "/api/logistics/rooms/x", {"json": {"notes": "x"}}),
    ("delete", "/api/logistics/rooms/x", {}),
    ("post", "/api/logistics/hotel-charges", {"json": {"competition_id": COMP, "hotel_id": H_STAFF, "concept": "x"}}),
    ("put", "/api/logistics/hotel-charges/x", {"json": {"notes": "x"}}),
    ("delete", "/api/logistics/hotel-charges/x", {}),
    ("post", f"/api/logistics/documents?competition_id={COMP}&kind=other",
     {"files": {"file": ("a.pdf", PDF, "application/pdf")}}),
    ("delete", "/api/logistics/documents/x", {}),
]
READS = [
    ("get", f"/api/logistics/contacts?competition_id={COMP}"),
    ("get", f"/api/logistics/rooms?competition_id={COMP}"),
    ("get", f"/api/logistics/hotel-charges?competition_id={COMP}"),
    ("get", f"/api/logistics/documents?competition_id={COMP}"),
    ("get", f"/api/logistics/hotels/{H_STAFF}/payments"),
    ("post", "/api/logistics/documents/x/download"),
    ("get", f"/api/logistics/export/delegation-briefing?competition_id={COMP}"),
]


def test_every_route_needs_logistics_view(client):
    for method, url in [(m, u) for m, u in READS] + [(m, u) for m, u, _ in WRITES]:
        assert getattr(client, method)(url).status_code == 401, (method, url)
        denied = getattr(client, method)(url, headers={"x-user": "other"})
        assert denied.status_code == 403, (method, url)


def test_writes_need_logistics_edit_but_downloads_only_view(client):
    for method, url, kwargs in WRITES:
        denied = getattr(client, method)(url, headers={"x-user": "viewer"}, **kwargs)
        assert denied.status_code == 403, (method, url)
    # Con solo view se lee y se baja (el POST de download queda en el activity log)...
    assert client.get(f"/api/logistics/contacts?competition_id={COMP}", headers={"x-user": "viewer"}).status_code == 200
    assert client.post("/api/logistics/documents/x/download", headers={"x-user": "viewer"}).status_code == 404
    # ... y con edit, se escribe.
    created = client.post("/api/logistics/contacts", headers={"x-user": "editor"},
                          json={"competition_id": COMP, "name": "Coordinador"})
    assert created.status_code == 200 and created.json()["name"] == "Coordinador"


def test_documents_endpoint_over_http_never_leaks_file_path(client, db):
    up = client.post(f"/api/logistics/documents?competition_id={COMP}&kind=menu&hotel_id={H_STAFF}",
                     headers={"x-user": "editor"}, files={"file": ("menu.pdf", PDF, "application/pdf")})
    assert up.status_code == 200 and "file_path" not in up.json()
    listed = client.get(f"/api/logistics/documents?competition_id={COMP}", headers={"x-user": "viewer"})
    assert listed.status_code == 200 and "file_path" not in listed.text and "storage://" not in listed.text
    big = client.post(f"/api/logistics/documents?competition_id={COMP}&kind=other", headers={"x-user": "editor"},
                      files={"file": ("a.pdf", b"%PDF" + b"0" * (10 * 1024 * 1024), "application/pdf")})
    assert big.status_code == 413


# ── Gastos con hotel (migración 056) ─────────────────────────────────────────

def _expense_body(**overrides):
    base = dict(department_code="competitions", account_code="x", description="Noche extra", amount=100,
                expense_date="2026-11-10", payee_type="other", payee_name="Hotel")
    return ExpenseCreate(**{**base, **overrides})


@pytest.fixture
def budget_db(db):
    db.seed("departments", [{"code": "competitions", "label": "Competitions", "active": True}])
    db.seed("accounts", [{"code": "x", "label": "Hotel", "kind": "expense", "active": True}])
    return db


def test_expense_hotel_must_be_of_the_expenses_competition(budget_db, make_request):
    req = make_request("editor", superadmin=True)
    ok = budget.create_expense(_expense_body(competition_id=COMP, hotel_id=H_STAFF), req)
    assert ok["hotel_id"] == H_STAFF

    assert status_of(budget.create_expense, _expense_body(competition_id=COMP, hotel_id=H_FOREIGN), req) == 400
    assert status_of(budget.create_expense, _expense_body(hotel_id=H_STAFF), req) == 400      # sin competencia
    assert status_of(budget.create_expense, _expense_body(competition_id=COMP, hotel_id="nope"), req) == 400
    # Sin hotel nada cambia: la columna ni se manda.
    plain = budget.create_expense(_expense_body(competition_id=COMP), req)
    assert "hotel_id" not in plain
    assert len(budget_db.tables["expenses"]) == 2


def test_expense_patch_revalidates_the_hotel(budget_db, make_request):
    req = make_request("editor", superadmin=True)
    row = budget.create_expense(_expense_body(competition_id=COMP, hotel_id=H_STAFF), req)

    assert status_of(budget.update_expense, row["id"], ExpenseUpdate(hotel_id=H_FOREIGN), req) == 400
    # Cambiar la competencia deja al hotel viejo fuera de lugar.
    assert status_of(budget.update_expense, row["id"], ExpenseUpdate(competition_id=OTHER), req) == 400
    # Sacar la competencia con hotel puesto también.
    assert status_of(budget.update_expense, row["id"], ExpenseUpdate(competition_id=None), req) == 400
    assert budget_db.tables["expenses"][0]["hotel_id"] == H_STAFF
    assert budget_db.tables["expenses"][0]["competition_id"] == COMP

    # Cambiar de competencia Y de hotel a la vez, sí.
    moved = budget.update_expense(row["id"], ExpenseUpdate(competition_id=OTHER, hotel_id=H_FOREIGN), req)
    assert (moved["competition_id"], moved["hotel_id"]) == (OTHER, H_FOREIGN)
    # '' y null desvinculan.
    assert budget.update_expense(row["id"], ExpenseUpdate(hotel_id=""), req)["hotel_id"] is None


def test_changing_the_hotel_is_not_a_financial_edit(budget_db, make_request):
    req = make_request("editor", superadmin=True)
    row = budget.create_expense(_expense_body(competition_id=COMP), req)
    budget_db.seed("finance_status_history", [])

    updated = budget.update_expense(row["id"], ExpenseUpdate(hotel_id=H_STAFF), req)
    assert updated["hotel_id"] == H_STAFF
    assert "last_financial_edit_by" not in updated and "last_financial_edit_at" not in updated
    assert budget_db.tables["finance_status_history"] == []

    # Se puede vincular aunque el gasto ya esté aprobado o pagado (no es plata).
    for status in ("approved", "paid"):
        budget_db.tables["expenses"][0]["status"] = status
        assert budget.update_expense(row["id"], ExpenseUpdate(hotel_id=H_SHARED), req)["hotel_id"] == H_SHARED
    # La plata de un gasto pagado sigue bloqueada.
    assert status_of(budget.update_expense, row["id"], ExpenseUpdate(amount=1), req) == 409


def test_budget_hotel_picker_gives_only_id_and_name(budget_db):
    assert budget.competition_hotels(COMP) == [
        {"id": H_STAFF, "name": "Dann"}, {"id": H_SHARED, "name": "Intercontinental"},
        {"id": H_TEAMS, "name": "Poblado"},
    ]
    assert budget.competition_hotels("no-es-uuid") == []
    assert budget.competition_hotels(str(uuid.uuid4())) == []


def test_budget_hotel_picker_needs_budget_view_not_logistics(budget_db):
    app = FastAPI()

    @app.middleware("http")
    async def fake_auth(request: Request, call_next):
        request.state.user = {"id": request.headers.get("x-user", "nobody"), "email": "u@example.test"}
        return await call_next(request)

    app.include_router(budget.router, prefix="/api")
    budget_db.seed("user_permissions", [
        {"user_id": "accountant", "module": "budget", "can_view": True, "can_edit": False},
        {"user_id": "logistician", "module": "logistics", "can_view": True, "can_edit": True},
    ])
    http = TestClient(app)
    url = f"/api/budget/competitions/{COMP}/hotels"
    assert http.get(url, headers={"x-user": "accountant"}).status_code == 200
    assert http.get(url, headers={"x-user": "logistician"}).status_code == 403


# ── Descargas con nombre no Latin-1 y vista pública ──────────────────────────

class _Reply:
    status_code = 200
    content = b"%PDF"
    headers = {"content-type": "application/pdf"}


@pytest.mark.parametrize("name", ["Łukasz.pdf", "Пасспорт Иван.pdf", "护照.pdf", "a\r\nX-Evil: 1.pdf"])
def test_stream_private_survives_non_latin1_names(monkeypatch, name):
    monkeypatch.setattr(payments.httpx, "get", lambda url, **kw: _Reply())
    response = payments._stream_private("storage://nominations/logistics/docs/c/x.pdf", name)
    assert response.status_code == 200
    header = response.headers["content-disposition"]
    header.encode("latin-1")                                   # un header HTTP viaja en Latin-1
    assert header.startswith('attachment; filename="') and "\n" not in header and "\r" not in header


def test_stream_private_keeps_ascii_names_and_adds_the_utf8_form(monkeypatch):
    monkeypatch.setattr(payments.httpx, "get", lambda url, **kw: _Reply())
    ascii_name = payments._stream_private("storage://nominations/x.pdf", "W-8 Ana.pdf")
    assert ascii_name.headers["content-disposition"] == 'attachment; filename="W-8 Ana.pdf"'
    utf8 = payments._stream_private("storage://nominations/x.pdf", "Łukasz Kowalski.pdf")
    assert utf8.headers["content-disposition"] == (
        "attachment; filename=\"ukasz Kowalski.pdf\"; filename*=UTF-8''%C5%81ukasz%20Kowalski.pdf")
    only_symbols = payments._stream_private("storage://nominations/x.pdf", "护照.pdf")
    assert only_symbols.headers["content-disposition"].startswith('attachment; filename="attachment.pdf"')


def test_public_rooming_hides_hotel_email_and_contact(db):
    db.seed("logistics_hotels", [
        {"id": H_STAFF, "competition_id": COMP, "name": "Dann", "phone": "555", "email": "reservas@dann.test",
         "contact_name": "Marta", "audience": "staff", "notes": "desayuno 6am"},
    ])
    db.seed("logistics_public_links", [{"token": "tok", "competition_id": COMP, "enabled": True}])
    db.seed("logistics_stays", [{"id": "s1", "participant_id": PERSON, "hotel_id": H_STAFF,
                                 "check_in": "2026-11-11", "check_out": "2026-11-13"}])

    for payload in (public_logistics.get_rooming("tok", None), public_logistics.get_overview("tok")):
        (hotel,) = payload["hotels"]
        assert "email" not in hotel and "contact_name" not in hotel and "competition_id" not in hotel
        assert (hotel["name"], hotel["phone"], hotel["notes"]) == ("Dann", "555", "desayuno 6am")
    assert "reservas@dann.test" not in str(public_logistics.get_rooming("tok", None))


def test_no_new_public_endpoint_exposes_ops_data():
    paths = {route.path for route in public_logistics.router.routes}
    assert not any(word in path for path in paths for word in ("contacts", "rooms", "charges", "documents"))


# ── PDF operativo para delegaciones ──────────────────────────────────────────

def test_briefing_endpoint_serves_the_file_and_cleans_the_temp_dir(db, monkeypatch, tmp_path):
    import os
    import tempfile

    from api._lib.services import logistics_briefing

    temp_dir = tempfile.mkdtemp(prefix="briefing_test_", dir=tmp_path)
    path = os.path.join(temp_dir, "briefing.pdf")
    with open(path, "wb") as f:
        f.write(b"%PDF-briefing")
    seen = {}

    def fake_render(competition_id):
        seen["competition_id"] = competition_id
        return path, "application/pdf", "Informacion-operativa-LSB.pdf", temp_dir

    monkeypatch.setattr(logistics_briefing, "render_briefing", fake_render)

    app = FastAPI()

    @app.middleware("http")
    async def fake_auth(request: Request, call_next):
        request.state.user = {"id": "viewer", "email": "u@example.test"}
        return await call_next(request)

    app.include_router(logistics_ops.router, prefix="/api")
    db.seed("user_permissions", [{"user_id": "viewer", "module": "logistics", "can_view": True, "can_edit": False}])
    http = TestClient(app)

    reply = http.get(f"/api/logistics/export/delegation-briefing?competition_id={COMP}")
    assert reply.status_code == 200 and reply.content == b"%PDF-briefing"
    assert reply.headers["cache-control"] == "private, no-store"
    assert "Informacion-operativa-LSB.pdf" in reply.headers["content-disposition"]
    assert seen["competition_id"] == COMP
    assert not os.path.exists(temp_dir)                     # el BackgroundTask lo borró

    missing = http.get(f"/api/logistics/export/delegation-briefing?competition_id={uuid.uuid4()}")
    assert missing.status_code == 404


# ── Correcciones de la revisión ──────────────────────────────────────────────

@pytest.mark.parametrize("blank", ["", "   ", None])
def test_charge_hotel_is_required_blank_is_400_not_a_postgres_500(db, blank):
    assert status_of(logistics_ops.create_hotel_charge, logistics_ops.ChargeCreate(
        competition_id=COMP, hotel_id=blank, concept="Noche extra"), _request()) == 400
    assert db.tables.get("logistics_hotel_charges", []) == []
    charge = logistics_ops.create_hotel_charge(logistics_ops.ChargeCreate(
        competition_id=COMP, hotel_id=H_STAFF, concept="Noche extra"), _request())
    assert status_of(logistics_ops.update_hotel_charge, charge["id"], logistics_ops.ChargeUpdate(hotel_id=blank)) == 400
    assert db.tables["logistics_hotel_charges"][0]["hotel_id"] == H_STAFF
    # Omitirlo en el PUT sí es válido: no se toca.
    assert logistics_ops.update_hotel_charge(charge["id"], logistics_ops.ChargeUpdate(notes="ok"))["hotel_id"] == H_STAFF


def test_contacts_and_rooms_still_normalize_blank_hotel_to_null(db):
    contact = logistics_ops.create_contact(logistics_ops.ContactCreate(competition_id=COMP, name="x", hotel_id=" "))
    room = logistics_ops.create_room(logistics_ops.RoomCreate(competition_id=COMP, name="Sala", hotel_id=""))
    assert contact["hotel_id"] is None and room["hotel_id"] is None
    assert logistics_ops.update_contact(contact["id"], logistics_ops.ContactUpdate(hotel_id=H_STAFF))["hotel_id"] == H_STAFF
    assert logistics_ops.update_contact(contact["id"], logistics_ops.ContactUpdate(hotel_id=""))["hotel_id"] is None
    assert logistics_ops.update_room(room["id"], logistics_ops.RoomUpdate(hotel_id=""))["hotel_id"] is None


def test_quote_document_takes_the_hotel_of_its_charge(db, make_request):
    charge = logistics_ops.create_hotel_charge(logistics_ops.ChargeCreate(
        competition_id=COMP, hotel_id=H_STAFF, kind="quote", concept="Cot"), _request())
    # El cliente manda OTRO hotel (válido, de la misma competencia): se ignora.
    meta = upload(make_request, kind="quote", hotel_id=H_TEAMS, charge_id=charge["id"])
    assert meta["hotel_id"] == H_STAFF and meta["charge_id"] == charge["id"]
    assert upload(make_request, kind="quote", hotel_id=None, charge_id=charge["id"])["hotel_id"] == H_STAFF


def test_moving_a_charge_moves_its_documents_with_it(db, make_request):
    charge = logistics_ops.create_hotel_charge(logistics_ops.ChargeCreate(
        competition_id=COMP, hotel_id=H_STAFF, kind="quote", concept="Cot"), _request())
    quote = upload(make_request, kind="quote", hotel_id=None, charge_id=charge["id"])
    menu = upload(make_request, hotel_id=H_STAFF)                       # menú del hotel viejo: no es del cargo

    logistics_ops.update_hotel_charge(charge["id"], logistics_ops.ChargeUpdate(hotel_id=H_TEAMS))
    by_id = {d["id"]: d for d in db.tables["logistics_documents"]}
    assert by_id[quote["id"]]["hotel_id"] == H_TEAMS and by_id[menu["id"]]["hotel_id"] == H_STAFF
    assert [d["id"] for d in logistics_ops.list_documents(None, "quote", H_TEAMS)] == [quote["id"]]
    assert logistics_ops.list_documents(None, "quote", H_STAFF) == []

    # Borrar el hotel viejo solo se lleva su menú: la cotización ya cuelga del hotel nuevo.
    quote_key = {d["id"]: d["file_path"] for d in db.tables["logistics_documents"]}[quote["id"]]
    logistics.delete_hotel(H_STAFF)
    assert len(db.storage.removed) == 1
    assert quote_key.removeprefix("storage://nominations/") in db.storage.objects


def test_public_overview_and_rooming_hide_the_hotel_audience(db):
    db.seed("logistics_hotels", [{"id": H_STAFF, "competition_id": COMP, "name": "Dann", "audience": "staff"}])
    db.seed("logistics_public_links", [{"token": "tok", "competition_id": COMP, "enabled": True}])
    db.seed("logistics_stays", [{"id": "s1", "participant_id": PERSON, "hotel_id": H_STAFF,
                                 "check_in": "2026-11-11", "check_out": "2026-11-13"}])
    for payload in (public_logistics.get_overview("tok"), public_logistics.get_rooming("tok", None)):
        assert "audience" not in payload["hotels"][0]


def test_public_responses_carry_no_new_columns(db):
    """`team` (participantes) y `assigned_to` (choferes) son internos; `label` es la única que sale."""
    db.seed("logistics_public_links", [{"token": "tok", "competition_id": COMP, "enabled": True}])
    db.seed("logistics_participants", [{"id": PERSON, "competition_id": COMP, "first_name": "Ana",
                                        "category": "team", "team": "Flamengo", "pax": 1}])
    db.seed("logistics_stays", [{"id": "s1", "participant_id": PERSON, "check_in": "2026-11-11",
                                 "check_out": "2026-11-13"}])
    db.seed("transport_events", [{"id": "ev", "competition_id": COMP}])
    db.seed("transport_vehicles", [{"id": "van", "event_id": "ev", "name": "Van"}])
    db.seed("transport_drivers", [{"id": "d1", "event_id": "ev", "name": "Juan", "phone": "1", "assigned_to": "TD"}])
    db.seed("transport_vehicle_drivers", [{"vehicle_id": "van", "driver_id": "d1", "date": "2026-11-11"}])
    db.seed("transport_trips", [{"id": "t1", "vehicle_id": "van", "date": "2026-11-11", "departure_time": "09:00"}])
    everything = [public_logistics.get_overview("tok"), public_logistics.get_transport("tok", None),
                  public_logistics.get_manifest("tok", None), public_logistics.get_rooming("tok", None)]
    assert "Flamengo" not in str(everything)
    # El fake devuelve todas las columnas aunque el select las acote: lo que
    # importa es que el endpoint de choferes pida SOLO id, name y phone.
    (drivers_call,) = db.calls_to("transport_drivers")
    assert drivers_call.params["select"] == "id,name,phone"
