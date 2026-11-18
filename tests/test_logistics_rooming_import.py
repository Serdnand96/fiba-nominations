"""Rooming list de equipo (segundo layout de `read_rooming`).

La planilla se arma en memoria con openpyxl copiando la forma real —`Club`
arriba, `Hab` solo en la primera fila de cada habitación (celda combinada),
una cama libre y el pie con alergias, firma y WhatsApp—. Los nombres son
inventados: los Excel de la gerente de eventos no se commitean.
"""
from datetime import datetime

import pytest
from openpyxl import Workbook

from api._lib.services import logistics_import
from api._lib.services.logistics_import import (
    commit_rooming, preview_rooming, read_rooming, split_full_name,
)
from tests.test_logistics_schedule_import import _bytes

COMP = "comp-1"
IN, OUT = datetime(2026, 11, 10), datetime(2026, 11, 16)

# (Hab, Tipo, Nombre): Hab solo en la primera fila de la habitación.
ROOMS = [
    (1, "Doble", "Ana Lima Costa"), (None, "Doble", "Bia Souza"),
    (2, "Doble", "Caio Rocha Neto"), (None, "Doble", "Davi de Paula Reis"),
    (3, "Doble", "Enzo Alves"), (None, "Doble", "cama libre (fisioterapia)"),
    (4, "Single", "Fabio Duarte Moreira"),
    (5, "Single", "Gael Pinto"),
]


def team_workbook(club="CLUB DEMO BASQUETE", rooms=ROOMS, title="Team Rooming List", allergies=None):
    wb = Workbook()
    ws = wb.active
    ws.title = title
    ws["A1"] = "LISTADO DE HABITACIONES"
    ws.merge_cells("A1:F2")
    ws["A3"] = "Club"
    ws.merge_cells("A3:B4")
    ws["C3"] = club
    ws.merge_cells("C3:F4")
    for col, label in ((1, "Hab"), (2, "Tipo"), (3, "Nombre"), (5, "Check-in"), (6, "Check-out")):
        ws.cell(row=6, column=col, value=label)
    ws.merge_cells("C6:D6")

    row = 7
    first_of_room = None
    for hab, kind, name in rooms:
        if hab is not None:
            ws.cell(row=row, column=1, value=hab)
        ws.cell(row=row, column=2, value=kind)
        ws.cell(row=row, column=3, value=name)
        ws.merge_cells(start_row=row, start_column=3, end_row=row, end_column=4)
        ws.cell(row=row, column=5, value=IN)
        ws.cell(row=row, column=6, value=OUT)
        row += 1
    row += 1                                                   # fila en blanco
    ws.cell(row=row, column=1, value="Requisitos Alimenticios (Alergias):")
    if allergies:
        ws.cell(row=row, column=3, value=allergies)
    row += 2
    ws.cell(row=row, column=1, value="Nombre")
    ws.cell(row=row, column=3, value="Ana Lima Costa")
    row += 1
    ws.cell(row=row, column=1, value="Firma")
    row += 1
    ws.cell(row=row, column=1, value="Whatsapp")
    ws.cell(row=row, column=3, value="+55 11 90000 0000")
    return wb


@pytest.fixture
def seeded(fake_db):
    fake_db.seed("competitions", [{"id": COMP, "start_date": "2026-11-13"}])
    return fake_db


def people(db):
    return {f"{p['first_name']} {p.get('last_name') or ''}".strip(): p
            for p in db.tables.get("logistics_participants", [])}


# ── Lectura ──────────────────────────────────────────────────────────────────

def test_rows_carry_club_room_type_and_dates(seeded):
    parsed = read_rooming(_bytes(team_workbook()), COMP)
    assert parsed["layout"] == "team"
    assert len(parsed["rows"]) == 7
    ana = parsed["rows"][0]
    assert (ana["first_name"], ana["last_name"]) == ("Ana", "Lima Costa")
    assert ana["team"] == "CLUB DEMO BASQUETE" and ana["category"] == "team"
    assert ana["stay"] == {"room_type": "Doble", "room_number": "1", "check_in": "2026-11-10",
                           "check_out": "2026-11-16", "comments": None, "share_with_row": None}
    assert ana["nights"] == 6 and ana["is_room_holder"] is True


def test_following_rows_without_number_share_the_room(seeded):
    rows = read_rooming(_bytes(team_workbook()), COMP)["rows"]
    ana, bia = rows[0], rows[1]
    assert bia["stay"]["room_number"] == "1"
    assert bia["is_room_holder"] is False
    assert bia["stay"]["share_with_row"] == ana["source_row"]
    assert (bia["stay"]["check_in"], bia["stay"]["room_type"]) == ("2026-11-10", "Doble")


def test_single_rooms_are_their_own_holder(seeded):
    rows = {r["first_name"]: r for r in read_rooming(_bytes(team_workbook()), COMP)["rows"]}
    for name in ("Fabio", "Gael"):
        assert rows[name]["stay"]["room_type"] == "Single"
        assert rows[name]["is_room_holder"] is True and rows[name]["stay"]["share_with_row"] is None


def test_free_bed_is_not_imported_and_is_reported(seeded):
    parsed = read_rooming(_bytes(team_workbook()), COMP)
    assert "cama libre" not in " ".join(r["first_name"].lower() for r in parsed["rows"])
    assert [(s["row"], s["reason"]) for s in parsed["skipped"]] == [(12, "not_a_person")]
    assert any("cama libre (fisioterapia)" in w["message"] and w["row"] == 12 for w in parsed["warnings"])
    # Enzo duerme solo en una doble, pero la habitación sigue siendo suya.
    enzo = next(r for r in parsed["rows"] if r["first_name"] == "Enzo")
    assert enzo["is_room_holder"] is True


def test_room_nights_count_each_room_once(seeded):
    # 5 habitaciones (3 dobles, 2 singles) x 6 noches.
    assert read_rooming(_bytes(team_workbook()), COMP)["total_nights"] == 30


def test_footer_is_not_a_person_and_is_reported(seeded):
    parsed = read_rooming(_bytes(team_workbook(allergies="Gael: sin gluten")), COMP)
    assert [r["first_name"] for r in parsed["rows"]].count("Ana") == 1      # el "Nombre" del pie no se duplica
    assert not any(r["first_name"] in ("Firma", "Whatsapp") for r in parsed["rows"])
    team = parsed["teams"][0]
    assert (team["team"], team["people"], team["rooms"]) == ("CLUB DEMO BASQUETE", 7, 5)
    assert (team["contact_name"], team["contact_phone"]) == ("Ana Lima Costa", "+55 11 90000 0000")
    assert team["dietary_note"] == "Gael: sin gluten"
    alert = [w for w in parsed["warnings"] if w["field"] == "dietary"]
    assert len(alert) == 1 and "sin gluten" in alert[0]["message"]
    assert all(r["dietary_restrictions"] is None for r in parsed["rows"])    # no se le asigna a nadie


def test_name_split_is_reported(seeded):
    parsed = read_rooming(_bytes(team_workbook()), COMP)
    assert [w["field"] for w in parsed["warnings"] if w["field"] == "name_split"] == ["name_split"]


def test_split_full_name():
    assert split_full_name("Matheus de Carvalho Gueiros") == ("Matheus", "de Carvalho Gueiros")
    assert split_full_name("Marcos") == ("Marcos", None)
    assert split_full_name("Silva Souza, João Pedro") == ("João Pedro", "Silva Souza")
    assert split_full_name("  Ana   Lima ") == ("Ana", "Lima")


def test_dates_are_read_tolerantly_and_bad_ones_warn(seeded):
    wb = team_workbook()
    ws = wb.active
    ws["E7"] = "10/11/2026"
    ws["F8"] = "pronto"
    parsed = read_rooming(_bytes(wb), COMP)
    assert parsed["rows"][0]["stay"]["check_in"] == "2026-11-10"
    # La compañera hereda el check-out de la titular cuando el suyo es ilegible.
    assert parsed["rows"][1]["stay"]["check_out"] == "2026-11-16"
    assert any(w["field"] == "check_out" and w["row"] == 8 for w in parsed["warnings"])


def assert_no_inverted_stays(db):
    """El CHECK de logistics_stays (check_out >= check_in) lo hace cumplir la base
    real; el fake no, así que se afirma acá."""
    for stay in db.tables.get("logistics_stays", []):
        if stay.get("check_in") and stay.get("check_out"):
            assert stay["check_out"] >= stay["check_in"], stay


def test_checkout_before_checkin_warns_and_drops_the_dates(seeded):
    wb = team_workbook()
    wb.active["F13"] = datetime(2026, 11, 9)           # Fabio (habitación 4): check-out antes del check-in
    parsed = read_rooming(_bytes(wb), COMP)
    fabio = next(r for r in parsed["rows"] if r["source_row"] == 13)
    assert any(w["field"] == "dates" and w["row"] == 13 and "sin fechas" in w["message"]
               for w in parsed["warnings"])
    assert (fabio["stay"]["check_in"], fabio["stay"]["check_out"], fabio["nights"]) == (None, None, 0)
    assert fabio["stay"]["room_number"] == "4"          # la habitación se conserva

    # El commit no revienta ni inserta una estadía invertida.
    result = commit_rooming(_bytes(wb), COMP)
    assert result["stays"] == 7
    assert_no_inverted_stays(seeded)
    saved = people(seeded)["Fabio Duarte Moreira"]
    stay = next(s for s in seeded.tables["logistics_stays"] if s["participant_id"] == saved["id"])
    assert (stay["room_number"], stay["check_in"], stay["check_out"]) == ("4", None, None)


def test_follower_with_a_later_checkin_than_the_inherited_checkout(seeded):
    # Bia solo trae check-in (13/11); el check-out lo hereda de Ana (16/11 → ok).
    # Con un check-in posterior al check-out heredado quedaría invertida.
    wb = team_workbook()
    ws = wb.active
    ws["E8"] = datetime(2026, 11, 20)
    ws["F8"].value = None
    parsed = read_rooming(_bytes(wb), COMP)
    bia = parsed["rows"][1]
    assert (bia["stay"]["check_in"], bia["stay"]["check_out"]) == (None, None)
    assert any(w["row"] == 8 and w["field"] == "dates" for w in parsed["warnings"])
    commit_rooming(_bytes(wb), COMP)
    assert_no_inverted_stays(seeded)


def test_single_or_unreadable_dates_still_commit(seeded):
    wb = team_workbook()
    ws = wb.active
    ws["F7"].value = None                              # Ana: solo check-in
    ws["F9"] = "pronto"                                # Caio: check-out ilegible
    result = commit_rooming(_bytes(wb), COMP)
    assert result["stays"] == 7
    assert_no_inverted_stays(seeded)
    stays = {s["participant_id"]: s for s in seeded.tables["logistics_stays"]}
    ana = stays[people(seeded)["Ana Lima Costa"]["id"]]
    assert (ana["check_in"], ana["check_out"]) == ("2026-11-10", None)
    assert any(w["field"] == "dates" and w["row"] == 7 for w in result["warnings"])
    assert any(w["field"] == "check_out" and w["row"] == 9 for w in result["warnings"])


def test_staff_grid_with_out_before_the_first_night_does_not_break_the_commit(seeded):
    wb = Workbook()
    ws = wb.active
    ws.append([])
    ws.append(["#", "Name", "Last Name", "Role", "Room", datetime(2026, 11, 13), datetime(2026, 11, 14)])
    ws.append([1, "Ana", "Lima", "TD", "Single", "OUT", 1])
    result = commit_rooming(_bytes(wb), COMP)
    assert result["stays"] == 1
    assert_no_inverted_stays(seeded)
    assert seeded.tables["logistics_stays"][0]["check_in"] is None
    assert any(w["field"] == "dates" for w in result["warnings"])


def test_free_bed_first_in_the_room_leaves_the_next_person_as_holder(seeded):
    rooms = [(1, "Doble", "cama libre"), (None, "Doble", "Hugo Faria")]
    parsed = read_rooming(_bytes(team_workbook(rooms=rooms)), COMP)
    assert len(parsed["rows"]) == 1
    assert parsed["rows"][0]["is_room_holder"] is True
    assert parsed["rows"][0]["stay"]["room_number"] == "1"


def test_every_club_sheet_is_read_and_rows_do_not_collide(seeded):
    wb = team_workbook("CLUB UNO")
    other = team_workbook("CLUB DOS", rooms=[(1, "Doble", "Iris Melo"), (None, "Doble", "Joana Reis")],
                          title="Club 2").active
    target = wb.create_sheet("Club 2")
    for row in other.iter_rows():
        for cell in row:
            target.cell(row=cell.row, column=cell.column, value=cell.value)
    parsed = read_rooming(_bytes(wb), COMP)
    assert [t["team"] for t in parsed["teams"]] == ["CLUB UNO", "CLUB DOS"]
    assert {r["team"] for r in parsed["rows"]} == {"CLUB UNO", "CLUB DOS"}
    assert len(parsed["rows"]) == 9
    assert {w["sheet"] for w in parsed["warnings"]} == {"Team Rooming List", "Club 2"}
    assert all(w["message"].startswith(f"[{w['sheet']}]") for w in parsed["warnings"] if "sheet" in w)


def test_staff_grid_workbook_is_not_taken_for_a_team_sheet(seeded):
    wb = Workbook()
    ws = wb.active
    ws.append([])
    ws.append(["#", "Name", "Last Name", "Role", "Room", datetime(2026, 11, 13), datetime(2026, 11, 14)])
    ws.append([1, "Ana", "Lima", "TD", "Single", 1, "OUT"])
    parsed = read_rooming(_bytes(wb), COMP)
    assert parsed.get("layout") is None
    assert parsed["rows"][0]["stay"]["check_out"] == "2026-11-14"


# ── Preview ──────────────────────────────────────────────────────────────────

def test_preview_summarizes_without_writing(seeded):
    result = preview_rooming(_bytes(team_workbook()), COMP)
    assert (result["total"], result["new"], result["matched"], result["review"]) == (7, 7, 0, 0)
    assert result["layout"] == "team" and result["total_nights"] == 30
    assert [s["label"] for s in result["skipped"]] == ["cama libre (fisioterapia)"]
    assert seeded.tables.get("logistics_participants", []) == []
    assert seeded.tables.get("logistics_stays", []) == []


def test_audience_does_not_override_the_team_category(seeded):
    for audience in ("staff", "delegation", "vip"):
        rows = preview_rooming(_bytes(team_workbook()), COMP, audience)["rows"]
        assert {r["category"] for r in rows} == {"team"}


# ── Commit ───────────────────────────────────────────────────────────────────

def test_commit_saves_team_category_and_stays(seeded):
    seeded.seed("logistics_hotels", [{"id": "h-main", "competition_id": COMP, "is_primary": True}])
    result = commit_rooming(_bytes(team_workbook()), COMP)
    assert (result["participants_total"], result["participants_created"], result["stays"]) == (7, 7, 7)
    assert result["total_nights"] == 30

    saved = people(seeded)
    assert {p["team"] for p in saved.values()} == {"CLUB DEMO BASQUETE"}
    assert {p["category"] for p in saved.values()} == {"team"}

    stays = {s["participant_id"]: s for s in seeded.tables["logistics_stays"]}
    ana, bia = stays[saved["Ana Lima Costa"]["id"]], stays[saved["Bia Souza"]["id"]]
    assert (ana["room_number"], ana["room_type"], ana["check_in"], ana["check_out"]) == \
        ("1", "Doble", "2026-11-10", "2026-11-16")
    assert ana["hotel_id"] == "h-main"
    assert ana["share_with_id"] == saved["Bia Souza"]["id"]
    assert bia["share_with_id"] == saved["Ana Lima Costa"]["id"]
    assert stays[saved["Gael Pinto"]["id"]].get("share_with_id") is None
    assert not any(w["field"] == "share_with" for w in result["warnings"])


def hotels(*rows):
    return [{"competition_id": COMP, **r} for r in rows]


def stay_hotels(db):
    return {s["hotel_id"] for s in db.tables["logistics_stays"]}


def hotel_warnings(result):
    return [w for w in result["warnings"] if w["field"] == "hotel"]


def staff_workbook_one_person():
    wb = Workbook()
    ws = wb.active
    ws.append([])
    ws.append(["#", "Name", "Last Name", "Role", "Room", datetime(2026, 11, 13), datetime(2026, 11, 14)])
    ws.append([1, "Ana", "Lima", "TD", "Single", 1, "OUT"])
    return wb


def test_hotel_is_the_single_delegation_one(seeded):
    seeded.seed("logistics_hotels", hotels(
        {"id": "h-staff", "name": "A Staff", "is_primary": True, "audience": "staff"},
        {"id": "h-team", "name": "B Team", "is_primary": False, "audience": "delegation"},
    ))
    result = commit_rooming(_bytes(team_workbook()), COMP)
    assert stay_hotels(seeded) == {"h-team"}
    assert hotel_warnings(result) == []


def test_two_delegation_hotels_pick_the_primary_and_warn(seeded):
    seeded.seed("logistics_hotels", hotels(
        {"id": "h-a", "name": "Alfa", "is_primary": False, "audience": "delegation"},
        {"id": "h-b", "name": "Beta", "is_primary": True, "audience": "delegation"},
    ))
    result = commit_rooming(_bytes(team_workbook()), COMP)
    assert stay_hotels(seeded) == {"h-b"}
    (warning,) = hotel_warnings(result)
    assert "Beta" in warning["message"] and "más de un hotel de delegación" in warning["message"]


def test_team_sheet_never_falls_back_to_the_staff_hotel(seeded):
    seeded.seed("logistics_hotels", hotels({"id": "h-staff", "name": "Solo Staff", "is_primary": True, "audience": "staff"}))
    result = commit_rooming(_bytes(team_workbook()), COMP)
    assert stay_hotels(seeded) == {None}
    (warning,) = hotel_warnings(result)
    assert "sin hotel" in warning["message"]
    assert_no_inverted_stays(seeded)


def test_team_sheet_uses_a_single_shared_hotel_without_warning(seeded):
    seeded.seed("logistics_hotels", hotels(
        {"id": "h-all", "name": "Compartido", "is_primary": True, "audience": None},
        {"id": "h-staff", "name": "Staff", "is_primary": False, "audience": "staff"},
    ))
    result = commit_rooming(_bytes(team_workbook()), COMP)
    assert stay_hotels(seeded) == {"h-all"}
    assert hotel_warnings(result) == []


def test_hotels_without_audience_column_still_work(seeded):
    seeded.seed("logistics_hotels", hotels({"id": "h-1", "is_primary": True}))     # fila sin `audience` ni `name`
    result = commit_rooming(_bytes(team_workbook()), COMP)
    assert stay_hotels(seeded) == {"h-1"}
    assert hotel_warnings(result) == []


def test_no_hotel_at_all_writes_stays_without_one_and_says_so(seeded):
    result = commit_rooming(_bytes(team_workbook()), COMP)
    assert stay_hotels(seeded) == {None}
    assert len(hotel_warnings(result)) == 1


def test_several_primaries_are_resolved_by_name_not_by_row_order(seeded):
    rows = hotels(
        {"id": "h-z", "name": "Zeta", "is_primary": True, "audience": "delegation"},
        {"id": "h-a", "name": "Alfa", "is_primary": True, "audience": "delegation"},
        {"id": "h-m", "name": "Mu", "is_primary": True, "audience": "delegation"},
    )
    for order in (rows, list(reversed(rows))):
        seeded.seed("logistics_hotels", order)
        seeded.seed("logistics_participants", [])
        seeded.seed("logistics_stays", [])
        result = commit_rooming(_bytes(team_workbook()), COMP)
        assert stay_hotels(seeded) == {"h-a"}
        assert "Alfa" in hotel_warnings(result)[0]["message"]


def test_staff_layout_does_not_prefer_the_delegation_hotel(seeded):
    seeded.seed("logistics_hotels", hotels(
        {"id": "h-staff", "name": "Staff", "is_primary": True, "audience": "staff"},
        {"id": "h-team", "name": "Team", "is_primary": False, "audience": "delegation"},
    ))
    result = commit_rooming(_bytes(staff_workbook_one_person()), COMP)
    assert stay_hotels(seeded) == {"h-staff"}
    assert hotel_warnings(result) == []
    assert "team" not in seeded.tables["logistics_participants"][0]


def test_staff_layout_skips_a_primary_that_is_a_delegation_hotel(seeded):
    seeded.seed("logistics_hotels", hotels(
        {"id": "h-team", "name": "Team", "is_primary": True, "audience": "delegation"},
        {"id": "h-staff", "name": "Staff", "is_primary": False, "audience": "staff"},
    ))
    result = commit_rooming(_bytes(staff_workbook_one_person()), COMP)
    assert stay_hotels(seeded) == {"h-staff"}
    assert hotel_warnings(result) == []


def test_staff_layout_with_only_a_delegation_hotel_goes_without_hotel(seeded):
    seeded.seed("logistics_hotels", hotels({"id": "h-team", "name": "Team", "is_primary": True, "audience": "delegation"}))
    result = commit_rooming(_bytes(staff_workbook_one_person()), COMP)
    assert stay_hotels(seeded) == {None}
    assert "sin hotel" in hotel_warnings(result)[0]["message"]


def test_preview_reports_the_hotel_it_would_use(seeded):
    seeded.seed("logistics_hotels", hotels(
        {"id": "h-a", "name": "Alfa", "is_primary": False, "audience": "delegation"},
        {"id": "h-b", "name": "Beta", "is_primary": False, "audience": "delegation"},
    ))
    result = preview_rooming(_bytes(team_workbook()), COMP)
    assert result["hotel"] == {"id": "h-a", "name": "Alfa"}
    assert any(w["field"] == "hotel" and "Alfa" in w["message"] for w in result["warnings"])
    assert seeded.tables.get("logistics_stays", []) == []

    seeded.seed("logistics_hotels", hotels({"id": "h-1", "name": "Unico", "is_primary": True, "audience": "delegation"}))
    clean = preview_rooming(_bytes(team_workbook()), COMP)
    assert clean["hotel"] == {"id": "h-1", "name": "Unico"}
    assert not any(w["field"] == "hotel" for w in clean["warnings"])


def test_existing_participant_without_team_gets_the_club(seeded):
    seeded.seed("logistics_participants", [
        {"id": "p-ana", "competition_id": COMP, "first_name": "Ana", "last_name": "Lima Costa",
         "category": "team", "team": None},
        {"id": "p-bia", "competition_id": COMP, "first_name": "Bia", "last_name": "Souza",
         "category": "team", "team": "OTRO CLUB"},
    ])
    result = commit_rooming(_bytes(team_workbook()), COMP)
    assert result["participants_created"] == 5                      # Ana y Bia ya estaban
    by_id = {p["id"]: p for p in seeded.tables["logistics_participants"]}
    assert by_id["p-ana"]["team"] == "CLUB DEMO BASQUETE"
    assert by_id["p-bia"]["team"] == "OTRO CLUB"                    # nunca se pisa un equipo
    assert {s["participant_id"] for s in seeded.tables["logistics_stays"]} >= {"p-ana", "p-bia"}


def test_doubtful_name_is_imported_unlinked_and_reported(seeded):
    seeded.seed("personnel", [{"id": "per-1", "name": "Ana Lemos Costa", "role": "TD"}])
    seeded.seed("employees", [])
    preview = preview_rooming(_bytes(team_workbook()), COMP)
    assert (preview["review"], preview["matched"]) == (1, 0)
    assert any("sin vincular" in w["message"] for w in preview["warnings"])

    result = commit_rooming(_bytes(team_workbook()), COMP)
    saved = people(seeded)["Ana Lima Costa"]
    assert saved.get("personnel_id") is None and saved["team"] == "CLUB DEMO BASQUETE"
    assert any("Ana Lima Costa" in w["message"] and "sin vincular" in w["message"]
               for w in result["warnings"])


def test_clear_match_links_the_person(seeded):
    seeded.seed("personnel", [{"id": "per-1", "name": "Ana Lima Costa", "role": "TD"}])
    seeded.seed("employees", [])
    commit_rooming(_bytes(team_workbook()), COMP)
    assert people(seeded)["Ana Lima Costa"]["personnel_id"] == "per-1"


def test_three_in_a_room_keeps_the_pairwise_warning(seeded):
    rooms = [(1, "Triple", "Ana Lima"), (None, "Triple", "Bia Souza"), (None, "Triple", "Caio Rocha")]
    result = commit_rooming(_bytes(team_workbook(rooms=rooms)), COMP)
    warning = next(w for w in result["warnings"] if w["field"] == "share_with")
    assert "3 personas" in warning["message"]


def test_rows_from_different_sheets_pair_with_their_own_partner(seeded):
    wb = team_workbook("CLUB UNO", rooms=[(1, "Doble", "Ana Lima"), (None, "Doble", "Bia Souza")])
    other = team_workbook("CLUB DOS", rooms=[(1, "Doble", "Iris Melo"), (None, "Doble", "Joana Reis")]).active
    target = wb.create_sheet("Club 2")
    for row in other.iter_rows():
        for cell in row:
            target.cell(row=cell.row, column=cell.column, value=cell.value)
    commit_rooming(_bytes(wb), COMP)
    saved = people(seeded)
    stays = {s["participant_id"]: s for s in seeded.tables["logistics_stays"]}
    assert stays[saved["Iris Melo"]["id"]]["share_with_id"] == saved["Joana Reis"]["id"]
    assert stays[saved["Ana Lima"]["id"]]["share_with_id"] == saved["Bia Souza"]["id"]
    assert (saved["Iris Melo"]["team"], saved["Ana Lima"]["team"]) == ("CLUB DOS", "CLUB UNO")


def test_reimport_does_not_duplicate_people_or_stays(seeded):
    commit_rooming(_bytes(team_workbook()), COMP)
    again = commit_rooming(_bytes(team_workbook()), COMP)
    assert again["participants_created"] == 0
    assert len(seeded.tables["logistics_participants"]) == 7
    assert len(seeded.tables["logistics_stays"]) == 7
