"""Lectura de los cronogramas de logística (transporte y comidas).

Tres planillas reales, las tres con el mismo esqueleto de bloques por día
(fila `FECHA` + título del día + `Comentarios/Notas`):

* **Equipos, transporte** — `PICK UP HOTEL` / `RETURN HOTEL` + `Comienzo` /
  `Final` / `Estadio`, con los rótulos en la fila siguiente a `FECHA`. Debajo de
  los entrenamientos, una franja `PARTIDOS` con la hora y los dos equipos.
* **Equipos, comidas** — igual, con `ALMUERZO` / `MERIENDA` / `CENA` en lugar
  del pick-up.
* **Staff (árbitros)** — solo partidos, con `PICK UP HOTEL` / `DEPARTURE TO
  HOTL` / `PARTIDO` rotulados en la misma fila `FECHA`.

Lo que no se ve en el PDF y este parser tiene que saber:

* Las planillas de equipos traen las **columnas B:C ocultas** con los mismos
  rótulos (`PICK UP HOTEL`, `DEPARTURE TO HOTL`) y horarios viejos. Una columna
  oculta no existe: ni se lee ni cuenta para detectar encabezados.
* Las filas **tachadas en negro** son del equipo local, que no usa transporte
  ni hotel. Tienen datos debajo del relleno; no se importan y se reportan.
* La columna `Estadio` trae el **nombre del equipo**.
* Las comidas no siempre son una hora: `TAKE AWAY`, `15:30 al IN`.

Como el resto de los importadores de logística, este no adivina: una sección
que no encuentra sus columnas es un error, y lo que no se puede interpretar va
como warning al preview.
"""
import io
import re
import xml.etree.ElementTree as ET
from datetime import date, datetime, time
from typing import Optional

from openpyxl import load_workbook
from openpyxl.utils import column_index_from_string

from api._lib.services.logistics_import import norm, parse_date, parse_time

SECTIONS = ("transport", "meals")

# Tope de lo que se recorre. Un cronograma real tiene decenas de filas; una
# hoja con una celda perdida en la fila 200.000 no debe tener al servidor
# iterando celdas vacías.
_MAX_ROWS = 2000
_MAX_COLS = 60

# Lo que separa a los dos equipos de un partido cuando viene en su propia celda.
_SEPARATORS = {"vs", "vs.", "v", "v.", "-", "x"}

# Rótulo normalizado → campo. `departure to hotl` es el typo real de la
# planilla de árbitros ("DEPARTURE TO HOTL").
_LABELS = {
    "pick up hotel": "pickup_time",
    "pick up": "pickup_time",
    "pickup hotel": "pickup_time",
    "return hotel": "return_time",
    "departure to hotl": "return_time",
    "departure to hotel": "return_time",
    "return to hotel": "return_time",
    "almuerzo": "lunch",
    "lunch": "lunch",
    "merienda": "snack",
    "snack": "snack",
    "cena": "dinner",
    "dinner": "dinner",
    "comienzo": "start_time",
    "inicio": "start_time",
    "start": "start_time",
    "final": "end_time",
    "fin": "end_time",
    "end": "end_time",
    "estadio": "team",
    "equipo": "team",
    "team": "team",
    "partido": "game_time",
    "game": "game_time",
}

# Qué columnas hacen a cada sección. Sin al menos una, el archivo no es de esa
# sección (o las tiene ocultas) y se rechaza.
SECTION_FIELDS = {
    "transport": ("pickup_time", "return_time"),
    "meals": ("lunch", "snack", "dinner"),
}

_TIME_FIELDS = ("pickup_time", "return_time")
_TEXT_FIELDS = ("lunch", "snack", "dinner")

_NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}


class ScheduleFormatError(ValueError):
    """El archivo no tiene la forma de un cronograma de esta sección."""


# ── Colores: detectar el relleno negro ───────────────────────────────────────

def _theme_dark1(wb) -> str:
    """Color `dk1` del tema del libro, en hex. Negro si no se puede leer.

    El relleno de las filas tachadas no es un RGB sino "tema 1", que en el
    tema de Office es negro pero que un libro puede redefinir.
    """
    xml = getattr(wb, "loaded_theme", None)
    if not xml:
        return "000000"
    try:
        root = ET.fromstring(xml)
        node = root.find(".//a:clrScheme/a:dk1", _NS)
        if node is None:
            return "000000"
        sys_clr = node.find("a:sysClr", _NS)
        if sys_clr is not None:
            return (sys_clr.get("lastClr") or "000000").upper()
        srgb = node.find("a:srgbClr", _NS)
        if srgb is not None:
            return (srgb.get("val") or "000000").upper()
    except ET.ParseError:
        pass
    return "000000"


def _is_black_fill(cell, dark1: str) -> bool:
    fill = cell.fill
    if fill is None or fill.fill_type != "solid":
        return False
    color = fill.fgColor
    if color is None:
        return False
    if color.type == "rgb":
        rgb = color.rgb if isinstance(color.rgb, str) else ""
        return rgb[-6:].upper() == "000000" and rgb[:2].upper() != "00"
    if color.type == "theme":
        # Índice 1 del tema = dk1 (los dos primeros pares van cruzados: 0 es
        # lt1). Con tinte ya no es negro sino un gris.
        return color.theme == 1 and not color.tint and dark1 == "000000"
    if color.type == "indexed":
        return color.indexed in (0, 8)
    return False


# ── Estructura de la hoja ────────────────────────────────────────────────────

def _hidden_columns(ws) -> set[int]:
    hidden: set[int] = set()
    for key, dim in ws.column_dimensions.items():
        if not dim.hidden:
            continue
        try:
            first = dim.min or column_index_from_string(key)
            last = dim.max or first
        except ValueError:
            continue
        hidden.update(range(first, last + 1))
    return hidden


def _is_time_value(value) -> bool:
    if isinstance(value, (time, datetime)):
        return True
    return isinstance(value, str) and parse_time(value) is not None


def _text(value) -> Optional[str]:
    """Texto de una celda, con los saltos de línea aplanados."""
    if value is None:
        return None
    if isinstance(value, time):
        return value.strftime("%H:%M")
    if isinstance(value, datetime):
        return value.strftime("%H:%M") if value.time() != time(0, 0) else value.date().isoformat()
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text or None


def _pick_sheet(wb):
    """Primera hoja visible que tenga una celda `FECHA`."""
    for ws in wb.worksheets:
        if ws.sheet_state != "visible":
            continue
        for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 60)):
            if any(norm(c.value) == "fecha" for c in row):
                return ws
    return None


def read_schedule(content: bytes, section: str, default_year: Optional[int] = None) -> dict:
    """Interpreta la planilla. No toca la base.

    Devuelve `title`, `subtitle`, `days` (`[{date, label, notes}]`), `rows`,
    `skipped` (filas que la planilla tacha u oculta) y `warnings`.
    """
    if section not in SECTIONS:
        raise ScheduleFormatError(f"section must be one of {', '.join(SECTIONS)}")
    try:
        wb = load_workbook(io.BytesIO(content))
    except Exception:
        raise ScheduleFormatError("No se pudo abrir el archivo como Excel (.xlsx)")

    ws = _pick_sheet(wb)
    if ws is None:
        raise ScheduleFormatError(
            "No encontré ninguna fila FECHA: el archivo no tiene la forma de un cronograma")

    hidden = _hidden_columns(ws)
    dark1 = _theme_dark1(wb)
    max_col = min(ws.max_column, _MAX_COLS)
    max_row = min(ws.max_row, _MAX_ROWS)

    def visible(row: int):
        """(columna, celda) de las celdas visibles de una fila."""
        for col in range(1, max_col + 1):
            if col not in hidden:
                yield col, ws.cell(row=row, column=col)

    def labels_in(row: int) -> dict:
        found = {}
        for col, cell in visible(row):
            field = _LABELS.get(norm(cell.value))
            if field and field not in found:
                found[field] = col
        return found

    header_rows = [
        r for r in range(1, max_row + 1)
        if any(norm(cell.value) == "fecha" for _, cell in visible(r))
    ]

    # Título y subtítulo: los dos primeros textos por encima del primer bloque.
    heading = []
    for r in range(1, header_rows[0]):
        for _, cell in visible(r):
            text = _text(cell.value)
            if text and not isinstance(cell.value, (datetime, time)):
                heading.append(" · ".join(p.strip() for p in str(cell.value).splitlines() if p.strip()))
    title = heading[0] if heading else None
    subtitle = heading[1] if len(heading) > 1 else None

    days: list[dict] = []
    rows: list[dict] = []
    skipped: list[dict] = []
    warnings: list[dict] = []
    fields_seen: set[str] = set()
    inherited: dict = {}

    for index, r0 in enumerate(header_rows):
        end = header_rows[index + 1] - 1 if index + 1 < len(header_rows) else max_row

        date_col = notes_col = None
        label = None
        for col, cell in visible(r0):
            key = norm(cell.value)
            if key == "fecha":
                date_col = col
            elif key.startswith("comentarios") or key.startswith("notas") or key.startswith("comments"):
                notes_col = col
            elif key and key not in _LABELS and label is None:
                label = _text(cell.value)

        columns = labels_in(r0)
        first_data = r0 + 1
        sub = labels_in(r0 + 1) if r0 + 1 <= end else {}
        if sub:
            # Los rótulos de la fila de abajo son los de las columnas reales
            # (los de la fila FECHA quedan sobre las columnas ocultas).
            columns = {**columns, **sub}
            first_data = r0 + 2
        # La planilla de árbitros rotula PARTIDO solo en el primer bloque: lo
        # que un bloque no rotula lo hereda del anterior, que es la misma hoja
        # con las mismas columnas.
        columns = {**inherited, **columns}
        inherited = columns
        fields_seen.update(columns)

        day_date = None
        notes = None
        for r in range(r0 + 1, end + 1):
            if day_date is None and date_col:
                day_date = parse_date(ws.cell(row=r, column=date_col).value, default_year)
            if notes is None and notes_col:
                notes = _text(ws.cell(row=r, column=notes_col).value)
        if day_date is None:
            warnings.append({"row": r0, "field": "date",
                             "message": f"El bloque '{label or 'sin título'}' no tiene fecha — no se importa"})
            continue
        days.append({"date": day_date, "label": label, "notes": notes})

        # Sin columna Comienzo el bloque es solo de partidos (planilla de staff).
        time_col = columns.get("start_time") or columns.get("game_time")
        mode = "training" if "start_time" in columns else "game"
        # La posición sigue a través de bloques con la misma fecha.
        position = sum(1 for row in rows if row["date"] == day_date)
        rows_before = len(rows) + len(skipped)
        if time_col is None:
            warnings.append({"row": r0, "field": "start_time",
                             "message": f"El bloque '{label or day_date}' no tiene columna de hora "
                                        f"(Comienzo / PARTIDO) — no se importó ninguna fila de ese día"})

        for r in range(first_data, end + 1):
            cells = dict(visible(r))
            if any(norm(c.value) == "partidos" for c in cells.values()):
                mode = "game"
                continue

            if mode == "training":
                team = _text(cells[columns["team"]].value) if columns.get("team") in cells else None
            else:
                team = None
            start_value = cells[time_col].value if time_col in cells else None

            teams: list[str] = []
            if mode == "game" and time_col:
                for col in sorted(cells):
                    if col <= time_col or col == notes_col:
                        continue
                    value = cells[col].value
                    if value is None or _is_time_value(value):
                        continue
                    text = _text(value)
                    if text and norm(text) not in _SEPARATORS:
                        teams.append(text)

            if mode == "training" and not team and start_value is None:
                continue
            if mode == "game" and start_value is None and not teams:
                continue
            if mode == "game" and start_value is None and len(teams) < 2:
                # Un texto suelto sin hora no es un partido: es un pie de
                # página, una firma, una aclaración. Se avisa y no se importa.
                warnings.append({"row": r, "field": "team",
                                 "message": f"Texto fuera de la tabla, no se importa: '{teams[0][:60]}'"})
                continue

            who = team or " vs ".join(teams) or ""
            probe = [c for c in (cells.get(columns.get("team")), cells.get(time_col)) if c is not None]
            if ws.row_dimensions[r].hidden or any(_is_black_fill(c, dark1) for c in probe):
                skipped.append({
                    "row": r, "date": day_date, "label": who,
                    "reason": "hidden" if ws.row_dimensions[r].hidden else "blacked_out",
                })
                continue

            entry = {
                "date": day_date, "kind": mode, "position": position, "source_row": r,
                "start_time": None, "end_time": None, "team": None, "team_b": None,
                "pickup_time": None, "return_time": None,
                "lunch": None, "snack": None, "dinner": None, "notes": None,
            }
            position += 1

            entry["start_time"] = parse_time(start_value)
            if start_value is not None and entry["start_time"] is None:
                warnings.append({"row": r, "field": "start_time",
                                 "message": f"No pude leer la hora '{_text(start_value)}' de {who or 'la fila'}"})
            if mode == "training":
                entry["team"] = team
                end_col = columns.get("end_time")
                if end_col in cells:
                    entry["end_time"] = parse_time(cells[end_col].value)
                if not team:
                    warnings.append({"row": r, "field": "team", "message": "Entrenamiento sin equipo"})
            else:
                entry["team"] = teams[0] if teams else None
                entry["team_b"] = teams[1] if len(teams) > 1 else None
                if len(teams) < 2:
                    warnings.append({"row": r, "field": "team",
                                     "message": f"El partido de las {entry['start_time'] or '?'} no trae los dos equipos"})

            for field in _TIME_FIELDS:
                col = columns.get(field)
                if col not in cells or cells[col].value is None:
                    continue
                raw = cells[col].value
                entry[field] = parse_time(raw)
                if entry[field] is None and _text(raw):
                    warnings.append({"row": r, "field": field,
                                     "message": f"No pude leer la hora '{_text(raw)}' de {who or 'la fila'}"})
            for field in _TEXT_FIELDS:
                col = columns.get(field)
                if col in cells:
                    entry[field] = _text(cells[col].value)

            rows.append(entry)

        if time_col is not None and len(rows) + len(skipped) == rows_before:
            warnings.append({"row": r0, "field": "rows",
                             "message": f"El bloque '{label or day_date}' no trae ninguna fila"})

    wanted = SECTION_FIELDS[section]
    if not any(f in fields_seen for f in wanted):
        other = next((s for s in SECTIONS if s != section
                      and any(f in fields_seen for f in SECTION_FIELDS[s])), None)
        if section == "transport":
            message = "No encontré columnas visibles PICK UP HOTEL / RETURN HOTEL"
        else:
            message = "No encontré columnas visibles ALMUERZO / MERIENDA / CENA"
        if other == "meals":
            message += ": este archivo parece el cronograma de comidas"
        elif other == "transport":
            message += ": este archivo parece el cronograma de transporte"
        raise ScheduleFormatError(message)
    if not rows:
        raise ScheduleFormatError("El archivo no trae ninguna fila de entrenamiento ni de partido")

    return {
        "title": title,
        "subtitle": subtitle,
        "days": days,
        "rows": rows,
        "skipped": skipped,
        "warnings": warnings,
        "columns": sorted(f for f in fields_seen if f in wanted),
    }
