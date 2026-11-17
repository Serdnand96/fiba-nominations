"""PDF operativo para delegaciones: qué entra, qué NO entra, y que el documento se arma.

Lo importante de este módulo es lo que no dice. El documento le llega a todos
los equipos, así que un pasaporte, un contacto VIP o el cronograma de los
árbitros filtrados acá son una fuga. La base se siembra con esas trampas a
propósito.
"""
import os
from pathlib import Path

import pytest
from docx import Document
from fastapi import HTTPException

from api._lib.services import document_generator, logistics_briefing as briefing

COMP = "comp-1"


@pytest.fixture
def db(fake_db):
    fake_db.seed("competitions", [{
        "id": COMP, "name": "LSB Grupo F 2026", "short_name": "LSB F", "location": "Bogotá, Colombia",
        "start_date": "2026-11-13", "end_date": "2026-11-15",
    }])
    fake_db.seed("logistics_hotels", [
        {"id": "h-del", "competition_id": COMP, "name": "Hotel Equipos", "address": "Calle 1 # 2-3",
         "phone": "+57 1 555", "email": "equipos@hotel.test", "contact_name": "Marta Gil",
         "check_in_time": "15:00:00", "check_out_time": "12:00:00",
         "map_url": "https://maps.example/equipos", "notes": None, "audience": "delegation"},
        {"id": "h-shared", "competition_id": COMP, "name": "Hotel Compartido", "audience": None},
        {"id": "h-staff", "competition_id": COMP, "name": "Hotel Oficiales SECRETO", "audience": "staff"},
        {"id": "h-vip", "competition_id": COMP, "name": "Hotel VIP SECRETO", "audience": "vip"},
    ])
    fake_db.seed("logistics_schedules", [
        {"id": "s-tr", "competition_id": COMP, "section": "transport", "audience": "delegation",
         "label": "", "title": "Transport Group F", "subtitle": None,
         "days": [{"date": "2026-11-13", "label": "DÍA DE PARTIDO", "notes": "Llevar acreditación"}]},
        {"id": "s-meals", "competition_id": COMP, "section": "meals", "audience": "delegation",
         "label": "", "title": None, "subtitle": None, "days": []},
        # Sin la clave `label`: el router puede no devolverla todavía.
        {"id": "s-staff", "competition_id": COMP, "section": "transport", "audience": "staff",
         "label": "", "title": "Transporte STAFF SECRETO", "days": []},
        {"id": "s-refs", "competition_id": COMP, "section": "transport", "audience": "delegation",
         "label": "Árbitros", "title": "Transporte ÁRBITROS SECRETO", "days": []},
    ])
    fake_db.seed("logistics_schedule_rows", [
        {"id": "r1", "schedule_id": "s-tr", "date": "2026-11-13", "kind": "training", "position": 0,
         "start_time": "10:00:00", "end_time": "11:30:00", "team": "Barbados",
         "pickup_time": "09:15:00", "return_time": "12:00:00", "notes": "Cancha auxiliar"},
        {"id": "r2", "schedule_id": "s-tr", "date": "2026-11-13", "kind": "game", "position": 1,
         "start_time": "19:00:00", "team": "Colombia", "team_b": "Panamá",
         "pickup_time": "17:30:00", "return_time": "21:45:00"},
        {"id": "m1", "schedule_id": "s-meals", "date": "2026-11-13", "kind": "training", "position": 0,
         "team": "Barbados", "lunch": "TAKE AWAY", "snack": "15:30 al IN", "dinner": "20:00"},
        {"id": "x1", "schedule_id": "s-staff", "date": "2026-11-13", "kind": "training", "position": 0,
         "team": "EquipoStaffSecreto"},
        {"id": "x2", "schedule_id": "s-refs", "date": "2026-11-13", "kind": "game", "position": 0,
         "team": "ArbitroSecreto"},
    ])
    fake_db.seed("logistics_rooms", [
        {"id": "ro1", "competition_id": COMP, "hotel_id": "h-del", "name": "Salón Andes", "purpose": "technical_meeting",
         "audience": "delegation", "date": "2026-11-13", "start_time": "09:00:00", "end_time": "10:00:00",
         "capacity": 80},
        {"id": "ro2", "competition_id": COMP, "name": "Sala Prensa", "purpose": "media_day", "audience": None,
         "date": "2026-11-12", "start_time": "16:00:00", "location": "Coliseo"},
        {"id": "ro3", "competition_id": COMP, "name": "Salón PIC SECRETO", "purpose": "pic", "audience": None,
         "date": "2026-11-12"},
        {"id": "ro4", "competition_id": COMP, "name": "Salón Staff SECRETO", "purpose": "meeting", "audience": "staff"},
    ])
    fake_db.seed("logistics_contacts", [
        {"id": "c1", "competition_id": COMP, "kind": "ice", "audience": None, "name": "Hielos del Norte",
         "company": "Frío SA", "phone": "+57 300 111", "pickup_hours": "lun a vie 8-10",
         "delivery_hours": "después de cada partido",
         # Las notas de un contacto son internas: no van al documento de los equipos.
         "notes": "NotaInternaSecreta: facturar a nombre de FIBA"},
        {"id": "c2", "competition_id": COMP, "kind": "transport", "audience": "delegation", "name": "Pedro Ruiz",
         "role": "Responsable de transporte", "phone": "+57 300 222"},
        {"id": "c3", "competition_id": COMP, "kind": "vip", "audience": None, "name": "ContactoVipSecreto"},
        {"id": "c4", "competition_id": COMP, "kind": "laundry", "audience": "staff", "name": "LavanderiaStaffSecreta"},
        {"id": "c5", "competition_id": COMP, "kind": "other", "audience": None, "name": "ContactoOtroSecreto"},
    ])
    fake_db.seed("logistics_participants", [
        {"id": "p1", "competition_id": COMP, "name": "Persona Con Pasaporte", "passport_number": "AB123456"},
    ])
    fake_db.seed("logistics_documents", [
        {"id": "d1", "competition_id": COMP, "kind": "passport", "file_name": "pasaporte-secreto.pdf"},
    ])
    return fake_db


def doc_text(doc) -> str:
    """Todo el texto del documento: párrafos, tablas y pie."""
    parts = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                parts.extend(p.text for p in cell.paragraphs)
    for section in doc.sections:
        parts.extend(p.text for p in section.footer.paragraphs)
    return "\n".join(parts)


# ── briefing_data ────────────────────────────────────────────────────────────

def test_data_has_delegation_and_shared_only(db):
    data = briefing.briefing_data(COMP)

    assert [h["name"] for h in data["hotels"]] == ["Hotel Compartido", "Hotel Equipos"]
    assert data["hotels"][1]["contact_name"] == "Marta Gil"
    assert [r["name"] for r in data["rooms"]] == ["Sala Prensa", "Salón Andes"]  # por fecha
    assert data["rooms"][1]["hotel_name"] == "Hotel Equipos"
    assert [c["name"] for c in data["contacts"]] == ["Pedro Ruiz", "Hielos del Norte"]  # transport antes que ice
    assert data["contacts"][1]["pickup_hours"] == "lun a vie 8-10"
    assert data["transport"]["title"] == "Transport Group F"
    assert [r["team"] for r in data["transport"]["rows"]] == ["Barbados", "Colombia"]
    assert data["meals"]["rows"][0]["lunch"] == "TAKE AWAY"
    assert data["competition"]["short_name"] == "LSB F"


def test_data_leaks_nothing_private(db):
    data = briefing.briefing_data(COMP)
    blob = repr(data)

    for secret in ("SECRETO", "Secreto", "Secreta", "AB123456", "Persona Con Pasaporte",
                   "pasaporte-secreto", "ÁRBITROS", "Árbitros"):
        assert secret not in blob, secret
    assert all(c["kind"] in briefing.CONTACT_KINDS for c in data["contacts"])
    assert "pic" not in [r["purpose"] for r in data["rooms"]]

    # No se consultó nada de personas ni de documentos.
    touched = {c.table for c in db.calls}
    assert "logistics_participants" not in touched
    assert "logistics_documents" not in touched
    assert db.calls_to("logistics_participants") == []
    assert touched <= {"competitions", "logistics_hotels", "logistics_schedules",
                       "logistics_schedule_rows", "logistics_rooms", "logistics_contacts"}


def test_data_without_schedules_gives_none(db):
    db.seed("logistics_schedules", [])
    data = briefing.briefing_data(COMP)
    assert data["transport"] is None and data["meals"] is None


def test_data_unknown_competition_is_404(db):
    with pytest.raises(HTTPException) as e:
        briefing.briefing_data("nope")
    assert e.value.status_code == 404


# ── build_briefing_docx ──────────────────────────────────────────────────────

def test_docx_with_full_data(db):
    doc = briefing.build_briefing_docx(briefing.briefing_data(COMP))
    text = doc_text(doc)

    for expected in ("LSB Grupo F 2026", "Información operativa para delegaciones", "Bogotá, Colombia",
                     "13 al 15 de noviembre de 2026", "Hotel Equipos", "Marta Gil", "Check-in: 15:00",
                     "Transporte", "Viernes 13 de noviembre de 2026 · DÍA DE PARTIDO", "Llevar acreditación",
                     "Barbados", "Cancha auxiliar", "Colombia vs Panamá", "09:15",
                     "Comidas", "TAKE AWAY", "15:30 al IN",
                     "Salón Andes", "Reunión técnica", "Hotel Equipos", "Media Day",
                     "Proveedores y contactos", "Hielos del Norte", "lun a vie 8-10", "Pedro Ruiz"):
        assert expected in text, expected
    assert "SECRETO" not in text and "Secreto" not in text

    section = doc.sections[0]
    assert section.page_width > section.page_height  # apaisada
    # Cada tabla repite su fila de títulos.
    for table in doc.tables:
        assert table.rows[0]._tr.trPr.find(
            "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}tblHeader") is not None


def test_docx_with_empty_data_does_not_break():
    for empty in ({}, {"competition": {}}, {"competition": {"name": "X"}, "hotels": [], "transport": None,
                                             "meals": None, "rooms": [], "contacts": []},
                  {"transport": {"days": [], "rows": []}}):
        text = doc_text(briefing.build_briefing_docx(empty))
        assert "Todavía no hay información operativa" in text
    # Una sección sin datos no deja su título.
    text = doc_text(briefing.build_briefing_docx({"competition": {"name": "X"}, "hotels": [], "rooms": []}))
    assert "Hotel" not in text.replace("Información", "") and "Salones" not in text


def test_docx_drops_empty_columns(db):
    doc = briefing.build_briefing_docx(briefing.briefing_data(COMP))
    # Transporte de contactos: sin horarios, no hay columna de retiro/entrega.
    transport_contacts = next(
        t for t in doc.tables if t.rows[0].cells[0].text == "Nombre" and "Pedro Ruiz" in t.rows[1].cells[0].text)
    headers = [c.text for c in transport_contacts.rows[0].cells]
    assert "Horario de retiro" not in headers and "Teléfono" in headers


def test_docx_survives_hostile_values():
    data = {"competition": {"name": "A" * 300, "start_date": "no-es-fecha", "end_date": None},
            "hotels": [{"name": None, "map_url": "javascript:alert(1)", "check_in_time": "después de las 3"}],
            "rooms": [{"name": "S", "purpose": "desconocido", "date": "basura", "capacity": 0}]}
    text = doc_text(briefing.build_briefing_docx(data))
    assert "después de las 3" in text and "javascript" not in text


# ── render_briefing ──────────────────────────────────────────────────────────

def _cleanup(temp_dir):
    import shutil
    shutil.rmtree(temp_dir, ignore_errors=True)


def test_render_returns_pdf_when_conversion_works(db, monkeypatch):
    def fake_convert(docx_path):
        pdf = docx_path.replace(".docx", ".pdf")
        Path(pdf).write_bytes(b"%PDF-1.4 fake")
        return pdf, None

    monkeypatch.setattr(document_generator, "_convert_to_pdf", fake_convert)
    path, media_type, filename, temp_dir = briefing.render_briefing(COMP)
    try:
        assert media_type == "application/pdf"
        assert path.endswith(".pdf") and Path(path).exists()
        assert Path(path).parent == Path(temp_dir)
        assert filename == "Informacion-operativa-LSB-F.pdf"
    finally:
        _cleanup(temp_dir)


def test_render_falls_back_to_docx_and_does_not_hide_the_error(db, monkeypatch, caplog):
    monkeypatch.setattr(document_generator, "_convert_to_pdf", lambda p: (None, "LibreOffice not installed"))
    with caplog.at_level("WARNING"):
        path, media_type, filename, temp_dir, error = briefing.render_briefing_detailed(COMP)
    try:
        assert media_type == briefing.DOCX_MEDIA_TYPE
        assert path.endswith(".docx") and filename.endswith(".docx") and Path(path).exists()
        assert Path(path).parent == Path(temp_dir)
        assert error == "LibreOffice not installed"
        assert "LibreOffice not installed" in caplog.text
        # El archivo es un docx válido.
        assert "LSB Grupo F 2026" in doc_text(Document(path))
    finally:
        _cleanup(temp_dir)


def test_render_four_tuple_and_ascii_filename(db, monkeypatch):
    db.tables["competitions"][0]["short_name"] = "Liga Sudamericana ñandú/2026"
    monkeypatch.setattr(document_generator, "_convert_to_pdf", lambda p: (None, "x"))
    path, _media, filename, temp_dir = briefing.render_briefing(COMP)
    try:
        assert filename.isascii() and "/" not in filename and " " not in filename
        assert filename == "Informacion-operativa-Liga-Sudamericana-nandu-2026.docx"
    finally:
        _cleanup(temp_dir)


def test_render_cleans_up_when_it_fails(db, monkeypatch):
    created = []
    real_mkdtemp = briefing.tempfile.mkdtemp

    def tracking(*a, **kw):
        d = real_mkdtemp(*a, **kw)
        created.append(d)
        return d

    monkeypatch.setattr(briefing.tempfile, "mkdtemp", tracking)
    with pytest.raises(HTTPException):
        briefing.render_briefing("nope")
    assert created and not os.path.exists(created[0])


def test_hhmm_pads_and_leaves_free_text_alone():
    assert briefing._hhmm("09:15:00") == "09:15"
    assert briefing._hhmm("9:15:00") == "09:15"
    assert briefing._hhmm("15:30") == "15:30"
    assert briefing._hhmm("TAKE AWAY") == "TAKE AWAY"
    assert briefing._hhmm("15:30 al IN") == "15:30 al IN"
    assert briefing._hhmm(None) == ""


def test_table_properties_follow_schema_order(db):
    from docx.oxml.ns import qn
    doc = briefing.build_briefing_docx(briefing.briefing_data(COMP))
    order = ["tblStyle", "tblW", "jc", "tblBorders", "tblLayout", "tblCellMar", "tblLook"]
    for table in doc.tables:
        tags = [el.tag.split("}")[1] for el in table._tbl.tblPr]
        assert tags == sorted(tags, key=order.index), tags
        assert table._tbl.tblPr.find(qn("w:tblLayout")).get(qn("w:type")) == "fixed"
