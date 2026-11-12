"""Parser de los cronogramas de logística (transporte y comidas).

Las planillas se arman en memoria con openpyxl copiando las tres formas reales
(equipos-transporte, equipos-comidas, árbitros), incluidas las dos trampas que
no se ven en el PDF: columnas ocultas con datos viejos y filas tachadas en negro.
"""
import io
import unittest
from datetime import datetime, time

from openpyxl import Workbook
from openpyxl.styles import PatternFill
from openpyxl.styles.colors import Color

from api._lib.services.logistics_schedule_import import ScheduleFormatError, read_schedule

BLACK = PatternFill(fill_type="solid", fgColor=Color(theme=1))
WHITE = PatternFill(fill_type="solid", fgColor=Color(theme=0))


def _bytes(wb) -> bytes:
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def team_workbook(extra: str = "transport"):
    """Planilla de equipos: un día con tres entrenamientos y dos partidos.

    `extra` elige las columnas propias: pick-up/return o las tres comidas.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "Practices"
    own = ["PICK UP HOTEL", "RETURN HOTEL"] if extra == "transport" else ["ALMUERZO", "MERIENDA", "CENA"]
    first = 4                        # D
    start = first + len(own)         # Comienzo
    team = start + 2                 # Estadio
    notes = team + 4

    ws.cell(row=1, column=start, value="GRUPO F (QF)")
    ws.cell(row=1, column=notes, value="Medellin, COL\n13 - 15 de noviembre")

    ws.cell(row=3, column=1, value="FECHA")
    ws.cell(row=3, column=2, value="PICK UP HOTEL")       # ocultas, con datos viejos
    ws.cell(row=3, column=3, value="DEPARTURE TO HOTL")
    ws.cell(row=3, column=start, value="DÍA DE PARTIDO 1")
    ws.cell(row=3, column=notes, value="Comentarios/Notas")
    ws.column_dimensions.group("B", "C", hidden=True)

    ws.cell(row=4, column=1, value=datetime(2026, 11, 13))
    for i, label in enumerate(own):
        ws.cell(row=4, column=first + i, value=label)
    ws.cell(row=4, column=start, value="Comienzo")
    ws.cell(row=4, column=start + 1, value="Final")
    ws.cell(row=4, column=team, value="Estadio")
    ws.cell(row=4, column=notes, value="  \nCongresillo Técnico durante el entrenamiento.")

    def training(row, values, begin, finish, name, black=False):
        ws.cell(row=row, column=2, value=time(8, 30))       # basura de la columna oculta
        ws.cell(row=row, column=3, value=time(10, 0))
        for i, value in enumerate(values):
            ws.cell(row=row, column=first + i, value=value)
        ws.cell(row=row, column=start, value=begin)
        ws.cell(row=row, column=start + 1, value=finish)
        ws.cell(row=row, column=team, value=name)
        if black:
            for col in (first, start, start + 1, team):
                ws.cell(row=row, column=col).fill = BLACK
        else:
            ws.cell(row=row, column=first).fill = WHITE

    if extra == "transport":
        training(5, [time(8, 10), time(10, 0)], time(9, 0), time(9, 50), "Boca Juniors")
        training(6, [time(9, 10), time(11, 0)], time(10, 0), time(10, 50), "Brasilia Basquete")
        training(7, [time(11, 10), time(13, 0)], time(12, 0), time(12, 50), "Paisas", black=True)
    else:
        training(5, [time(12, 0), "TAKE AWAY", time(20, 0)], time(9, 0), time(9, 50), "Boca Juniors")
        training(6, ["15:30 al IN", time(17, 0), time(23, 0)], time(10, 0), time(10, 50), "Brasilia Basquete")
        training(7, [None, None, None], time(12, 0), time(12, 50), "Paisas", black=True)

    ws.cell(row=8, column=start, value="PARTIDOS")
    ws.merge_cells(start_row=8, start_column=start, end_row=8, end_column=team + 3)

    def game(row, values, tip, home, away):
        for i, value in enumerate(values):
            ws.cell(row=row, column=first + i, value=value)
        ws.cell(row=row, column=start, value=tip)
        ws.merge_cells(start_row=row, start_column=start, end_row=row, end_column=start + 1)
        ws.cell(row=row, column=team, value=home)
        ws.cell(row=row, column=team + 2, value=away)

    pick = [time(15, 10), time(19, 20)] if extra == "transport" else []
    game(9, pick, time(17, 10), "Brasilia Basquete", "Boca Juniors")
    game(10, [time(18, 40), time(22, 40)] if extra == "transport" else [], time(20, 40), "Paisas", "Flamengo")
    return wb


def staff_workbook():
    """Planilla de árbitros: solo partidos, rótulos en la fila FECHA."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Hoja1"
    ws["F1"] = "GRUPO F (QF)"
    ws["L1"] = "Medellin, COL\n13 - 15 de noviembre"
    row = 3
    days = [
        (datetime(2026, 11, 13), "DÍA DE PARTIDO 1", [
            (time(15, 30), time(19, 20), time(17, 10), "Brasilia Basquete", "Boca Juniors"),
            (time(19, 0), time(22, 40), time(20, 40), "Paisas", "Flamengo"),
        ]),
        (datetime(2026, 11, 14), "DÍA DE PARTIDO 2", [
            (time(14, 30), time(18, 10), time(16, 10), "Flamengo", "Brasilia Basquete"),
        ]),
    ]
    for day, label, games in days:
        ws.cell(row=row, column=1, value="FECHA")
        ws.cell(row=row, column=2, value="PICK UP HOTEL")
        ws.cell(row=row, column=3, value="DEPARTURE TO HOTL")
        ws.cell(row=row, column=6, value=label)
        ws.cell(row=row, column=12, value="Comentarios/Notas")
        if row == 3:
            ws.cell(row=row, column=4, value="PARTIDO")
        row += 1
        ws.cell(row=row, column=1, value=day)
        for pickup, back, tip, home, away in games:
            ws.cell(row=row, column=2, value=pickup)
            ws.cell(row=row, column=3, value=back)
            ws.cell(row=row, column=4, value=tip)
            ws.cell(row=row, column=6, value=home)
            ws.cell(row=row, column=8, value=away)
            row += 1
    return wb


class TeamTransportTest(unittest.TestCase):
    def setUp(self):
        self.result = read_schedule(_bytes(team_workbook("transport")), "transport")

    def test_heading_and_day(self):
        self.assertEqual("GRUPO F (QF)", self.result["title"])
        self.assertEqual("Medellin, COL · 13 - 15 de noviembre", self.result["subtitle"])
        self.assertEqual(
            [{"date": "2026-11-13", "label": "DÍA DE PARTIDO 1",
              "notes": "Congresillo Técnico durante el entrenamiento."}],
            self.result["days"],
        )

    def test_hidden_columns_are_not_read(self):
        # Las columnas B:C ocultas dicen 8:30 / 10:00 en todas las filas.
        boca = self.result["rows"][0]
        self.assertEqual("Boca Juniors", boca["team"])
        self.assertEqual(("08:10", "10:00"), (boca["pickup_time"], boca["return_time"]))
        self.assertEqual(("09:00", "09:50"), (boca["start_time"], boca["end_time"]))
        self.assertEqual("training", boca["kind"])

    def test_blacked_out_row_is_skipped_and_reported(self):
        teams = [r["team"] for r in self.result["rows"] if r["kind"] == "training"]
        self.assertEqual(["Boca Juniors", "Brasilia Basquete"], teams)
        self.assertEqual(
            [{"row": 7, "date": "2026-11-13", "label": "Paisas", "reason": "blacked_out"}],
            self.result["skipped"],
        )

    def test_games_carry_both_teams_and_their_own_pickup(self):
        games = [r for r in self.result["rows"] if r["kind"] == "game"]
        self.assertEqual(2, len(games))
        self.assertEqual(("Brasilia Basquete", "Boca Juniors"), (games[0]["team"], games[0]["team_b"]))
        self.assertEqual(("17:10", "15:10", "19:20"),
                         (games[0]["start_time"], games[0]["pickup_time"], games[0]["return_time"]))
        self.assertEqual([0, 1, 2, 3], [r["position"] for r in self.result["rows"]])

    def test_no_warnings_on_a_clean_sheet(self):
        self.assertEqual([], self.result["warnings"])
        self.assertEqual(["pickup_time", "return_time"], self.result["columns"])


class TeamMealsTest(unittest.TestCase):
    def setUp(self):
        self.result = read_schedule(_bytes(team_workbook("meals")), "meals")

    def test_meals_keep_their_text(self):
        boca, brasilia = self.result["rows"][0], self.result["rows"][1]
        self.assertEqual(("12:00", "TAKE AWAY", "20:00"), (boca["lunch"], boca["snack"], boca["dinner"]))
        self.assertEqual("15:30 al IN", brasilia["lunch"])
        self.assertIsNone(boca["pickup_time"])

    def test_games_have_no_meals(self):
        game = next(r for r in self.result["rows"] if r["kind"] == "game")
        self.assertEqual((None, None, None), (game["lunch"], game["snack"], game["dinner"]))
        self.assertEqual("17:10", game["start_time"])


class StaffTest(unittest.TestCase):
    def setUp(self):
        self.result = read_schedule(_bytes(staff_workbook()), "transport")

    def test_only_games_with_pickup_and_return(self):
        rows = self.result["rows"]
        self.assertEqual(["game"] * 3, [r["kind"] for r in rows])
        self.assertEqual(("15:30", "19:20", "17:10"),
                         (rows[0]["pickup_time"], rows[0]["return_time"], rows[0]["start_time"]))
        self.assertEqual(("Paisas", "Flamengo"), (rows[1]["team"], rows[1]["team_b"]))

    def test_one_day_per_block(self):
        self.assertEqual(["2026-11-13", "2026-11-14"], [d["date"] for d in self.result["days"]])
        self.assertEqual("2026-11-14", self.result["rows"][2]["date"])
        self.assertEqual(0, self.result["rows"][2]["position"])


class WrongFileTest(unittest.TestCase):
    def test_meals_file_uploaded_as_transport(self):
        with self.assertRaises(ScheduleFormatError) as raised:
            read_schedule(_bytes(team_workbook("meals")), "transport")
        self.assertIn("comidas", str(raised.exception))

    def test_transport_file_uploaded_as_meals(self):
        with self.assertRaises(ScheduleFormatError) as raised:
            read_schedule(_bytes(team_workbook("transport")), "meals")
        self.assertIn("transporte", str(raised.exception))

    def test_sheet_without_fecha(self):
        wb = Workbook()
        wb.active["A1"] = "Nombre"
        with self.assertRaises(ScheduleFormatError):
            read_schedule(_bytes(wb), "transport")

    def test_not_an_excel_file(self):
        with self.assertRaises(ScheduleFormatError):
            read_schedule(b"not a workbook", "transport")

    def test_unreadable_time_is_a_warning_not_a_guess(self):
        wb = team_workbook("transport")
        wb.active.cell(row=5, column=4, value="después del almuerzo")
        result = read_schedule(_bytes(wb), "transport")
        self.assertIsNone(result["rows"][0]["pickup_time"])
        self.assertEqual(["pickup_time"], [w["field"] for w in result["warnings"]])


if __name__ == "__main__":
    unittest.main()


class ReviewCasesTest(unittest.TestCase):
    """Bordes que marcó la revisión de código."""

    def test_block_without_a_time_column_warns_instead_of_dropping_games(self):
        wb = staff_workbook()
        ws = wb.active
        ws["D3"] = None            # el primer bloque no rotula PARTIDO…
        ws["D6"] = "PARTIDO"       # …el segundo sí
        result = read_schedule(_bytes(wb), "transport")
        self.assertEqual(["2026-11-14"], [r["date"] for r in result["rows"]])
        self.assertEqual(["start_time"], [w["field"] for w in result["warnings"]])
        self.assertIn("DÍA DE PARTIDO 1", result["warnings"][0]["message"])

    def test_loose_text_under_the_table_is_not_a_game(self):
        wb = staff_workbook()
        wb.active.cell(row=9, column=6, value="Horarios sujetos a cambios.")
        result = read_schedule(_bytes(wb), "transport")
        self.assertEqual(3, len(result["rows"]))
        self.assertIn("Horarios sujetos", result["warnings"][0]["message"])

    def test_vs_separator_cell_is_not_a_team(self):
        wb = staff_workbook()
        ws = wb.active
        ws.cell(row=4, column=7, value="vs")
        result = read_schedule(_bytes(wb), "transport")
        self.assertEqual(("Brasilia Basquete", "Boca Juniors"),
                         (result["rows"][0]["team"], result["rows"][0]["team_b"]))

    def test_empty_block_is_reported(self):
        wb = staff_workbook()
        ws = wb.active
        row = ws.max_row + 1
        ws.cell(row=row, column=1, value="FECHA")
        ws.cell(row=row, column=6, value="DÍA DE PARTIDO 3")
        ws.cell(row=row + 1, column=1, value=datetime(2026, 11, 15))
        result = read_schedule(_bytes(wb), "transport")
        self.assertEqual(3, len(result["days"]))
        self.assertEqual(["rows"], [w["field"] for w in result["warnings"]])

    def test_positions_continue_across_blocks_of_the_same_date(self):
        wb = staff_workbook()
        wb.active["A7"] = datetime(2026, 11, 13)     # el segundo bloque repite la fecha del primero
        result = read_schedule(_bytes(wb), "transport")
        self.assertEqual([0, 1, 2], [r["position"] for r in result["rows"]])

    def test_far_away_cell_does_not_stretch_the_scan(self):
        wb = team_workbook("transport")
        wb.active.cell(row=150000, column=1, value="x")
        result = read_schedule(_bytes(wb), "transport")
        self.assertEqual(4, len(result["rows"]))
