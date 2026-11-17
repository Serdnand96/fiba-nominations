"""PDF operativo para delegaciones: un solo documento por competencia.

Logística se lo manda a TODOS los equipos participantes, así que no puede
llevar nada de una persona ni nada de otra audiencia. Por eso `briefing_data`
solo toca estas tablas: competitions, logistics_hotels, logistics_schedules (+
sus filas), logistics_rooms y logistics_contacts. **Nunca** logistics_participants,
estadías, tramos de viaje, choferes, cargos ni documentos (pasaportes): un test
afirma que ni siquiera se consultan.

Tres capas, como el resto de los generadores:

    briefing_data(competition_id)   → dict, lee la base y recorta por audiencia
    build_briefing_docx(data)       → python-docx desde cero, sin plantilla
    render_briefing(competition_id) → archivo en un directorio temporal

La conversión a PDF es `document_generator._convert_to_pdf` (LibreOffice local
con `fonts/fonts.conf`). Si no hay conversión se sirve el .docx.

Las audiencias se filtran en Python: el fake de Supabase de los tests no
soporta `.or_`, y NULL ("compartido") no se expresa con un `.eq`.
"""
from __future__ import annotations

import logging
import re
import shutil
import tempfile
import unicodedata
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Optional

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.opc.constants import RELATIONSHIP_TYPE as RT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from fastapi import HTTPException

from api._lib.database import supabase
from api._lib.routers.logistics_schedules import load_schedules
from api._lib.services import document_generator

logger = logging.getLogger(__name__)

DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
PDF_MEDIA_TYPE = "application/pdf"

# Audiencias que ve una delegación: la propia y lo compartido (NULL).
_VISIBLE_AUDIENCES = (None, "delegation")
# Tipos de contacto que se publican. 'vip' y 'other' quedan afuera a propósito.
CONTACT_KINDS = ("transport", "hotel", "ice", "laundry", "hydration")
# Un salón de PIC es una reunión interna de staff.
_HIDDEN_ROOM_PURPOSES = ("pic",)

CONTACT_KIND_LABELS = {
    "transport": "Transporte",
    "hotel": "Hoteles",
    "ice": "Hielo",
    "laundry": "Lavandería",
    "hydration": "Hidratación",
}
ROOM_PURPOSE_LABELS = {
    "media_day": "Media Day",
    "technical_meeting": "Reunión técnica",
    "meeting": "Reunión",
    "other": "Otro",
}

# ── Formato ──────────────────────────────────────────────────────────────────
# IBM Plex Sans es la del design system y está en fonts/: fontconfig la
# encuentra directo (no hace falta alias), así que el PDF sale con ella y no
# con DejaVu. Quien abre el .docx en Word sin la fuente instalada ve la suya.
FONT = "IBM Plex Sans"
NAVY = "0C2340"
ORANGE = "F57C2A"
GRID = "BFC5CF"
ZEBRA = "F4F6FA"
GAMES_BAND = "FFE9B8"
MUTED = RGBColor(0x5F, 0x68, 0x75)
BODY_PT = 9
# A4 apaisada, márgenes de 1,5 cm → 26,7 cm útiles.
PAGE_W_CM, PAGE_H_CM, MARGIN_CM = 29.7, 21.0, 1.5
USABLE_CM = PAGE_W_CM - 2 * MARGIN_CM
LOGO_PATH = Path(__file__).resolve().parents[3] / "public" / "fiba-logo.png"

_MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
           "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
_WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]


# ═════════════════════════════════════════════════════════════════════════════
# 1. Datos
# ═════════════════════════════════════════════════════════════════════════════

def _visible(row: dict) -> bool:
    return (row.get("audience") or None) in _VISIBLE_AUDIENCES


def _pick(row: dict, fields: tuple) -> dict:
    return {f: row.get(f) for f in fields}


def _section_schedule(schedules: list, section: str) -> Optional[dict]:
    """El cronograma general (label vacío) de delegaciones para una sección.

    `label` puede no venir (el router lo agrega junto con la migración 055):
    ausente es lo mismo que vacío.
    """
    for schedule in schedules:
        if (schedule.get("section") == section
                and schedule.get("audience") == "delegation"
                and not (schedule.get("label") or "").strip()):
            return {
                "title": schedule.get("title"),
                "subtitle": schedule.get("subtitle"),
                "days": [_pick(d, ("date", "label", "notes")) for d in (schedule.get("days") or [])],
                "rows": [
                    _pick(r, ("date", "kind", "position", "start_time", "end_time", "team", "team_b",
                              "pickup_time", "return_time", "lunch", "snack", "dinner", "notes"))
                    for r in (schedule.get("rows") or [])
                ],
            }
    return None


def briefing_data(competition_id: str) -> dict:
    """Todo lo que lleva el documento, ya recortado para una delegación."""
    competitions = (
        supabase.table("competitions")
        .select("id,name,short_name,location,start_date,end_date")
        .eq("id", competition_id)
        .execute()
        .data
    )
    if not competitions:
        raise HTTPException(404, "Competition not found")
    competition = _pick(competitions[0], ("name", "short_name", "location", "start_date", "end_date"))

    all_hotels = (
        supabase.table("logistics_hotels")
        .select("id,name,address,phone,email,contact_name,check_in_time,check_out_time,map_url,notes,audience")
        .eq("competition_id", competition_id)
        .execute()
        .data
    ) or []
    hotels = sorted(
        (h for h in all_hotels if _visible(h)),
        key=lambda h: (h.get("name") or "").lower(),
    )
    # El nombre del hotel de un salón sale de TODOS los hoteles: un salón que
    # logística marcó para delegaciones puede estar en otro hotel, y el equipo
    # tiene que saber a dónde ir. De ese hotel solo sale el nombre.
    hotel_names = {h["id"]: h.get("name") for h in all_hotels}

    schedules = load_schedules(competition_id)

    rooms_raw = (
        supabase.table("logistics_rooms")
        .select("id,hotel_id,name,purpose,audience,date,start_time,end_time,location,capacity,notes")
        .eq("competition_id", competition_id)
        .execute()
        .data
    ) or []
    rooms = [
        {**_pick(r, ("name", "purpose", "date", "start_time", "end_time", "location", "capacity", "notes")),
         "hotel_name": hotel_names.get(r.get("hotel_id")) if r.get("hotel_id") else None}
        for r in sorted(
            (r for r in rooms_raw if _visible(r) and r.get("purpose") not in _HIDDEN_ROOM_PURPOSES),
            key=lambda r: (r.get("date") or "9999-99-99", r.get("start_time") or "99:99", r.get("name") or ""),
        )
    ]

    contacts_raw = (
        supabase.table("logistics_contacts")
        # Sin `notes`: las notas de un contacto son internas de logística
        # ("pedir factura a nombre de…") y este documento va a todos los equipos.
        .select("id,kind,audience,name,company,role,phone,email,pickup_hours,delivery_hours")
        .eq("competition_id", competition_id)
        .execute()
        .data
    ) or []
    kind_order = {k: i for i, k in enumerate(CONTACT_KINDS)}
    contacts = [
        _pick(c, ("kind", "name", "company", "role", "phone", "email", "pickup_hours", "delivery_hours"))
        for c in sorted(
            (c for c in contacts_raw if _visible(c) and c.get("kind") in CONTACT_KINDS),
            key=lambda c: (kind_order[c["kind"]], (c.get("name") or "").lower()),
        )
    ]

    return {
        "competition": competition,
        "hotels": [
            _pick(h, ("name", "address", "phone", "email", "contact_name", "check_in_time",
                      "check_out_time", "map_url", "notes"))
            for h in hotels
        ],
        "transport": _section_schedule(schedules, "transport"),
        "meals": _section_schedule(schedules, "meals"),
        "rooms": rooms,
        "contacts": contacts,
    }


# ═════════════════════════════════════════════════════════════════════════════
# 2. Documento
# ═════════════════════════════════════════════════════════════════════════════

def _parse_date(value) -> Optional[date]:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _long_date(value, weekday: bool = True) -> str:
    d = _parse_date(value)
    if not d:
        return str(value or "")
    text = f"{d.day} de {_MONTHS[d.month - 1]} de {d.year}"
    return f"{_WEEKDAYS[d.weekday()].capitalize()} {text}" if weekday else text


def _date_range(start, end) -> str:
    s, e = _parse_date(start), _parse_date(end)
    if not s and not e:
        return ""
    if not s or not e or s == e:
        return _long_date(s or e, weekday=False)
    if (s.year, s.month) == (e.year, e.month):
        return f"{s.day} al {e.day} de {_MONTHS[s.month - 1]} de {s.year}"
    if s.year == e.year:
        return f"{s.day} de {_MONTHS[s.month - 1]} al {e.day} de {_MONTHS[e.month - 1]} de {s.year}"
    return f"{_long_date(s, False)} al {_long_date(e, False)}"


_TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})(:\d{2})?$")


def _hhmm(value) -> str:
    """'15:30:00' → '15:30'. Un texto que no es hora ('TAKE AWAY') queda igual."""
    text = str(value).strip() if value not in (None, "") else ""
    match = _TIME_RE.match(text)
    return f"{int(match.group(1)):02d}:{match.group(2)}" if match else text


def _dash(value) -> str:
    return value if value else "—"


# ── Estilos y bajo nivel ─────────────────────────────────────────────────────

def _set_style_font(style, size_pt: float, bold: Optional[bool] = None, color: Optional[str] = None) -> None:
    """Fuente de un estilo, quitando las referencias al tema de Word.

    Los estilos de encabezado de la plantilla de python-docx traen `asciiTheme`,
    que en Word gana sobre `ascii`: sin sacarlo el título sale en Calibri Light.
    """
    rpr = style.element.get_or_add_rPr()
    fonts = rpr.get_or_add_rFonts()
    for attr in ("asciiTheme", "hAnsiTheme", "eastAsiaTheme", "cstheme"):
        key = qn(f"w:{attr}")
        if key in fonts.attrib:
            del fonts.attrib[key]
    for attr in ("ascii", "hAnsi", "eastAsia", "cs"):
        fonts.set(qn(f"w:{attr}"), FONT)
    style.font.size = Pt(size_pt)
    if bold is not None:
        style.font.bold = bold
    if color:
        style.font.color.rgb = RGBColor.from_string(color)


def _border_bottom(paragraph, color: str, size: int = 8) -> None:
    ppr = paragraph._p.get_or_add_pPr()
    borders = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    for key, val in (("val", "single"), ("sz", str(size)), ("space", "2"), ("color", color)):
        bottom.set(qn(f"w:{key}"), val)
    borders.append(bottom)
    ppr.append(borders)


def _setup_document() -> Document:
    doc = Document()
    section = doc.sections[0]
    section.orientation = WD_ORIENT.LANDSCAPE
    section.page_width, section.page_height = Cm(PAGE_W_CM), Cm(PAGE_H_CM)
    section.left_margin = section.right_margin = Cm(MARGIN_CM)
    section.top_margin = section.bottom_margin = Cm(MARGIN_CM)
    section.footer_distance = Cm(0.7)

    normal = doc.styles["Normal"]
    _set_style_font(normal, BODY_PT)
    normal.paragraph_format.space_after = Pt(0)
    normal.paragraph_format.space_before = Pt(0)

    h1 = doc.styles["Heading 1"]
    _set_style_font(h1, 14, bold=True, color=NAVY)
    h1.paragraph_format.space_before = Pt(16)
    h1.paragraph_format.space_after = Pt(4)
    h1.paragraph_format.keep_with_next = True
    h2 = doc.styles["Heading 2"]
    _set_style_font(h2, 10.5, bold=True, color=NAVY)
    h2.paragraph_format.space_before = Pt(10)
    h2.paragraph_format.space_after = Pt(2)
    h2.paragraph_format.keep_with_next = True
    return doc


def _add_field(paragraph, instruction: str) -> None:
    field = OxmlElement("w:fldSimple")
    field.set(qn("w:instr"), instruction)
    run = OxmlElement("w:r")
    text = OxmlElement("w:t")
    text.text = "1"
    run.append(text)
    field.append(run)
    paragraph._p.append(field)


def _add_footer(doc: Document, competition_name: str) -> None:
    footer = doc.sections[0].footer
    p = footer.paragraphs[0]
    p.paragraph_format.tab_stops.add_tab_stop(Cm(USABLE_CM), WD_TAB_ALIGNMENT.RIGHT)
    run = p.add_run(f"FIBA Americas · Información operativa{' · ' + competition_name if competition_name else ''}\tPágina ")
    run.font.size = Pt(8)
    run.font.color.rgb = MUTED
    _add_field(p, "PAGE")
    tail = p.add_run(" de ")
    tail.font.size = Pt(8)
    tail.font.color.rgb = MUTED
    _add_field(p, "NUMPAGES")
    for r in p.runs:
        r.font.size = Pt(8)
        r.font.color.rgb = MUTED
    # Los fldSimple no son `runs` de python-docx: su tamaño sale del estilo del
    # párrafo. Se fija ahí para que el número no salga a 9 pt.
    p.style.font.size = Pt(8)


def _add_hyperlink(paragraph, url: str, text: str, size: float = BODY_PT) -> None:
    r_id = paragraph.part.relate_to(url, RT.HYPERLINK, is_external=True)
    link = OxmlElement("w:hyperlink")
    link.set(qn("r:id"), r_id)
    run = OxmlElement("w:r")
    rpr = OxmlElement("w:rPr")
    color = OxmlElement("w:color")
    color.set(qn("w:val"), "1F5FBF")
    underline = OxmlElement("w:u")
    underline.set(qn("w:val"), "single")
    sz = OxmlElement("w:sz")
    sz.set(qn("w:val"), str(int(size * 2)))
    for el in (color, sz, underline):
        rpr.append(el)
    run.append(rpr)
    t = OxmlElement("w:t")
    t.text = text
    run.append(t)
    link.append(run)
    paragraph._p.append(link)


def _shade(cell, fill: str) -> None:
    tcpr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    tcpr.append(shd)


def _row_flag(row, tag: str) -> None:
    trpr = row._tr.get_or_add_trPr()
    trpr.append(OxmlElement(tag))


def _safe_url(url) -> Optional[str]:
    url = (url or "").strip() if isinstance(url, str) else ""
    return url if url.lower().startswith(("http://", "https://")) else None


# ── Celdas y tablas ──────────────────────────────────────────────────────────
# Un valor de celda es un str (las líneas con \n son párrafos) o una lista de
# líneas; cada línea es un str, `(texto, 'bold'|'muted')` o `(texto, 'link', url)`.

@dataclass
class _Band:
    """Fila divisoria que cruza toda la tabla (el 'PARTIDOS' del cronograma)."""
    text: str


def _lines(value) -> list:
    if value is None or value == "":
        return []
    if isinstance(value, str):
        return [ln for ln in value.split("\n")]
    return list(value)


def _line_text(line) -> str:
    return line if isinstance(line, str) else (line[0] or "")


def _is_empty(value) -> bool:
    return not any(_line_text(ln).strip() for ln in _lines(value))


def _write_cell(cell, value, *, bold: bool = False, color: Optional[RGBColor] = None,
                keep_next: bool = False) -> None:
    lines = _lines(value) or [""]
    for i, line in enumerate(lines):
        p = cell.paragraphs[0] if i == 0 else cell.add_paragraph()
        p.paragraph_format.keep_with_next = keep_next
        if isinstance(line, str):
            kind, text, url = "main", line, None
        else:
            kind, text, url = line[1], line[0], (line[2] if len(line) > 2 else None)
        if kind == "link" and _safe_url(url):
            _add_hyperlink(p, url, text)
            continue
        run = p.add_run(text)
        run.font.size = Pt(BODY_PT - 1 if kind == "muted" else BODY_PT)
        if bold or kind == "bold":
            run.bold = True
        if color is not None:
            run.font.color.rgb = color
        elif kind == "muted":
            run.font.color.rgb = MUTED
            run.italic = True


def _table_borders(table, total_cm: float) -> None:
    tbl_pr = table._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        for key, val in (("val", "single"), ("sz", "4"), ("space", "0"), ("color", GRID)):
            el.set(qn(f"w:{key}"), val)
        borders.append(el)
    tbl_pr.append(borders)
    margins = OxmlElement("w:tblCellMar")
    for edge, twips in (("top", 40), ("left", 80), ("bottom", 40), ("right", 80)):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:w"), str(twips))
        el.set(qn("w:type"), "dxa")
        margins.append(el)
    tbl_pr.append(margins)
    width = OxmlElement("w:tblW")
    width.set(qn("w:w"), str(int(total_cm / 2.54 * 1440)))
    width.set(qn("w:type"), "dxa")
    for old in tbl_pr.findall(qn("w:tblW")):
        tbl_pr.remove(old)
    tbl_pr.append(width)
    # Word es estricto con el orden de los hijos de tblPr (CT_TblPr): los que
    # se agregaron al final tienen que volver a su lugar.
    order = ["tblStyle", "tblpPr", "tblOverlap", "bidiVisual", "tblStyleRowBandSize",
             "tblStyleColBandSize", "tblW", "jc", "tblCellSpacing", "tblInd", "tblBorders",
             "shd", "tblLayout", "tblCellMar", "tblLook"]
    children = sorted(list(tbl_pr), key=lambda el: order.index(el.tag.split("}")[1])
                      if el.tag.split("}")[1] in order else len(order))
    for child in children:
        tbl_pr.remove(child)
    for child in children:
        tbl_pr.append(child)


def _add_table(doc: Document, headers: list, widths: list, rows: list, *, drop_empty: bool = False) -> None:
    """Tabla con encabezado navy repetido en cada página.

    `rows` son listas de celdas (una por columna) o `_Band`. Con `drop_empty`
    se quitan las columnas sin ningún dato y el ancho se reparte entre las que
    quedan: un proveedor de hielo no necesita la columna 'Cargo' vacía.
    """
    data_rows = [r for r in rows if not isinstance(r, _Band)]
    keep = [i for i in range(len(headers))
            if not drop_empty or any(not _is_empty(r[i]) for r in data_rows)] or list(range(len(headers)))
    total = sum(widths)
    kept_total = sum(widths[i] for i in keep)
    cols = [widths[i] * total / kept_total for i in keep]

    table = doc.add_table(rows=1, cols=len(keep))
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = False

    def size_row(row):
        for cell, w in zip(row.cells, cols):
            cell.width = Cm(w)

    head = table.rows[0]
    _row_flag(head, "w:tblHeader")
    _row_flag(head, "w:cantSplit")
    size_row(head)
    for cell, i in zip(head.cells, keep):
        _shade(cell, NAVY)
        _write_cell(cell, headers[i], bold=True, color=RGBColor(0xFF, 0xFF, 0xFF), keep_next=True)

    body_index = 0
    for row in rows:
        tr = table.add_row()
        _row_flag(tr, "w:cantSplit")
        if isinstance(row, _Band):
            merged = tr.cells[0].merge(tr.cells[-1])
            merged.width = Cm(total)
            _shade(merged, GAMES_BAND)
            _write_cell(merged, row.text.upper(), bold=True, keep_next=True)
            continue
        size_row(tr)
        for cell, i in zip(tr.cells, keep):
            if body_index % 2:
                _shade(cell, ZEBRA)
            _write_cell(cell, row[i])
        body_index += 1

    _table_borders(table, total)  # al final: reordena tblPr con todo ya puesto
    # El gridCol manda en LibreOffice; el ancho de celda, en Word.
    for gridcol, w in zip(table._tbl.tblGrid.findall(qn("w:gridCol")), cols):
        gridcol.set(qn("w:w"), str(int(w / 2.54 * 1440)))


def _heading(doc: Document, text: str, level: int = 1):
    p = doc.add_heading(text, level=level)
    if level == 1:
        _border_bottom(p, ORANGE)
    return p


def _muted_paragraph(doc: Document, text: str, *, keep_next: bool = False, italic: bool = False):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.keep_with_next = keep_next
    run = p.add_run(text)
    run.font.size = Pt(BODY_PT)
    run.font.color.rgb = MUTED
    run.italic = italic
    return p


# ── Cabecera ─────────────────────────────────────────────────────────────────

def _add_header_block(doc: Document, competition: dict) -> None:
    if LOGO_PATH.exists():
        try:
            doc.add_paragraph().add_run().add_picture(str(LOGO_PATH), height=Cm(1.5))
        except Exception as e:  # imagen ilegible: el documento sale igual, sin logo
            logger.warning("[briefing] logo not added: %s", e)

    title = doc.add_paragraph()
    title.paragraph_format.space_before = Pt(8)
    run = title.add_run((competition.get("name") or "").strip() or "Competencia")
    run.bold = True
    run.font.size = Pt(22)
    run.font.color.rgb = RGBColor.from_string(NAVY)

    sub = doc.add_paragraph()
    sub.paragraph_format.space_before = Pt(2)
    r = sub.add_run("Información operativa para delegaciones")
    r.font.size = Pt(12)
    r.font.color.rgb = RGBColor.from_string(ORANGE)
    r.bold = True

    detail = " · ".join(
        part for part in (
            (competition.get("location") or "").strip(),
            _date_range(competition.get("start_date"), competition.get("end_date")),
        ) if part
    )
    if detail:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(2)
        run = p.add_run(detail)
        run.font.size = Pt(11)
    _muted_paragraph(doc, f"Generado el {_long_date(date.today(), weekday=False)}")


# ── Secciones ────────────────────────────────────────────────────────────────

def _hotels_section(doc: Document, hotels: list) -> None:
    _heading(doc, "Hotel" if len(hotels) == 1 else "Hoteles")
    rows = []
    for h in hotels:
        name_cell: list = [((h.get("name") or "").strip() or "—", "bold")]
        if _safe_url(h.get("map_url")):
            name_cell.append(("Ver mapa", "link", h["map_url"].strip()))
        contact = [ln for ln in (h.get("contact_name"), h.get("phone"), h.get("email")) if ln]
        times = [f"Check-in: {_hhmm(h['check_in_time'])}" if h.get("check_in_time") else "",
                 f"Check-out: {_hhmm(h['check_out_time'])}" if h.get("check_out_time") else ""]
        rows.append([name_cell, h.get("address") or "", contact, [t for t in times if t],
                     h.get("notes") or ""])
    _add_table(doc, ["Hotel", "Dirección", "Contacto", "Horarios", "Notas"],
               [5.2, 6.0, 6.2, 3.6, 5.7], rows, drop_empty=True)


def _day_groups(schedule: dict) -> list:
    """Lo mismo que `groupByDay` del frontend: rótulo y notas del día más sus filas."""
    meta = {d["date"]: d for d in schedule.get("days") or [] if d.get("date")}
    rows = schedule.get("rows") or []
    dates = sorted({*meta.keys(), *[r["date"] for r in rows if r.get("date")]})

    def order(r):
        return (r.get("position") or 0, r.get("start_time") or "")

    groups = []
    for d in dates:
        day_rows = sorted((r for r in rows if r.get("date") == d), key=order)
        if not day_rows:
            continue  # un día sin filas no le dice nada a un equipo
        groups.append({
            "date": d,
            "label": (meta.get(d, {}).get("label") or "").strip(),
            "notes": (meta.get(d, {}).get("notes") or "").strip(),
            "rows": day_rows,
            "trainings": [r for r in day_rows if r.get("kind") != "game"],
            "games": [r for r in day_rows if r.get("kind") == "game"],
        })
    return groups


def _day_title(doc: Document, day: dict) -> None:
    text = _long_date(day["date"]) + (f" · {day['label']}" if day["label"] else "")
    _heading(doc, text, level=2)
    if day["notes"]:
        _muted_paragraph(doc, day["notes"], keep_next=True, italic=True)


def _schedule_intro(doc: Document, schedule: dict) -> None:
    text = " · ".join(p.strip() for p in (schedule.get("title"), schedule.get("subtitle")) if p and p.strip())
    if text:
        _muted_paragraph(doc, text, keep_next=True)


def _team_cell(row: dict, versus: bool) -> list:
    if versus:
        text = f"{row.get('team') or '?'} vs {row.get('team_b') or '?'}"
    else:
        text = row.get("team") or "—"
    cell: list = [(text, "bold" if versus else "main")]
    if row.get("notes"):
        cell.append((row["notes"], "muted"))
    return cell


def _transport_section(doc: Document, schedule: dict) -> None:
    days = _day_groups(schedule)
    if not days:
        return
    _heading(doc, "Transporte")
    _schedule_intro(doc, schedule)
    for day in days:
        _day_title(doc, day)
        both = day["trainings"] and day["games"]
        if day["trainings"]:
            if both:
                _muted_paragraph(doc, "Entrenamientos", keep_next=True)
            _add_table(
                doc, ["Pick up hotel", "Regreso hotel", "Comienzo", "Final", "Equipo"],
                [3.4, 3.4, 3.0, 3.0, 13.9],
                [[_dash(_hhmm(r.get("pickup_time"))), _dash(_hhmm(r.get("return_time"))),
                  _dash(_hhmm(r.get("start_time"))), _dash(_hhmm(r.get("end_time"))),
                  _team_cell(r, versus=False)] for r in day["trainings"]],
            )
        if day["games"]:
            if both:
                _muted_paragraph(doc, "Partidos", keep_next=True)
            _add_table(
                doc, ["Pick up hotel", "Regreso hotel", "Hora", "Equipos"],
                [3.4, 3.4, 3.0, 16.9],
                [[_dash(_hhmm(r.get("pickup_time"))), _dash(_hhmm(r.get("return_time"))),
                  _dash(_hhmm(r.get("start_time"))), _team_cell(r, versus=True)] for r in day["games"]],
            )


def _meals_section(doc: Document, schedule: dict) -> None:
    days = _day_groups(schedule)
    if not days:
        return
    _heading(doc, "Comidas")
    _schedule_intro(doc, schedule)
    for day in days:
        _day_title(doc, day)
        # Las comidas son texto ("TAKE AWAY", "15:30 al IN"): se copian tal cual.
        _add_table(
            doc, ["Equipo", "Almuerzo", "Merienda", "Cena"],
            [8.7, 6.0, 6.0, 6.0],
            [[_team_cell(r, versus=r.get("kind") == "game"),
              _dash(r.get("lunch")), _dash(r.get("snack")), _dash(r.get("dinner"))] for r in day["rows"]],
        )


def _rooms_section(doc: Document, rooms: list) -> None:
    _heading(doc, "Salones")
    rows = []
    for r in rooms:
        start, end = _hhmm(r.get("start_time")), _hhmm(r.get("end_time"))
        schedule = f"{start} a {end}" if start and end else start or end
        place = " · ".join(p for p in (r.get("hotel_name"), r.get("location")) if p)
        rows.append([
            [((r.get("name") or "").strip() or "—", "bold")],
            ROOM_PURPOSE_LABELS.get(r.get("purpose"), ""),
            _long_date(r["date"]) if r.get("date") else "",
            schedule,
            place,
            str(r["capacity"]) if r.get("capacity") not in (None, "") else "",
            r.get("notes") or "",
        ])
    _add_table(doc, ["Salón", "Actividad", "Fecha", "Horario", "Lugar", "Capacidad", "Notas"],
               [4.6, 3.4, 4.6, 2.8, 5.0, 1.8, 4.5], rows, drop_empty=True)


def _contacts_section(doc: Document, contacts: list) -> None:
    _heading(doc, "Proveedores y contactos")
    for kind in CONTACT_KINDS:
        group = [c for c in contacts if c.get("kind") == kind]
        if not group:
            continue
        _heading(doc, CONTACT_KIND_LABELS[kind], level=2)
        _add_table(
            doc,
            ["Nombre", "Empresa", "Cargo", "Teléfono", "Email", "Horario de retiro", "Horario de entrega"],
            [4.3, 4.0, 3.2, 3.2, 5.0, 3.5, 3.5],
            [[[((c.get("name") or "").strip() or "—", "bold")], c.get("company") or "", c.get("role") or "",
              c.get("phone") or "", c.get("email") or "", c.get("pickup_hours") or "",
              c.get("delivery_hours") or ""] for c in group],
            drop_empty=True,
        )


def build_briefing_docx(data: dict) -> Document:
    """Arma el documento. Tolera un dict vacío o con secciones en None."""
    data = data or {}
    competition = data.get("competition") or {}
    doc = _setup_document()
    _add_footer(doc, (competition.get("name") or "").strip())
    _add_header_block(doc, competition)

    wrote = False
    if data.get("hotels"):
        _hotels_section(doc, data["hotels"])
        wrote = True
    if data.get("transport") and _day_groups(data["transport"]):
        _transport_section(doc, data["transport"])
        wrote = True
    if data.get("meals") and _day_groups(data["meals"]):
        _meals_section(doc, data["meals"])
        wrote = True
    if data.get("rooms"):
        _rooms_section(doc, data["rooms"])
        wrote = True
    if data.get("contacts"):
        _contacts_section(doc, data["contacts"])
        wrote = True
    if not wrote:
        _muted_paragraph(doc, "Todavía no hay información operativa cargada para esta competencia.")
    return doc


# ═════════════════════════════════════════════════════════════════════════════
# 3. Render
# ═════════════════════════════════════════════════════════════════════════════

def _ascii_slug(text: str) -> str:
    plain = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^A-Za-z0-9]+", "-", plain).strip("-")


def render_briefing_detailed(competition_id: str) -> tuple[str, str, str, str, Optional[str]]:
    """Como `render_briefing`, más el error de conversión (None si salió PDF).

    El llamador es dueño de `temp_dir`: tiene que borrarlo cuando termine de
    mandar la respuesta. Si algo falla antes de devolver, se borra acá.
    """
    # `_convert_to_pdf` arma la ruta del PDF con `replace(".docx", ".pdf")`: el
    # único ".docx" del camino tiene que ser el del nombre del archivo.
    temp_dir = tempfile.mkdtemp(prefix="fiba_briefing_")
    try:
        data = briefing_data(competition_id)
        docx_path = Path(temp_dir) / "briefing.docx"
        build_briefing_docx(data).save(str(docx_path))
        pdf_path, conversion_error = document_generator._convert_to_pdf(str(docx_path))
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise

    competition = data["competition"]
    base = _ascii_slug(competition.get("short_name") or competition.get("name") or "") or "competencia"
    if pdf_path and Path(pdf_path).exists():
        return pdf_path, PDF_MEDIA_TYPE, f"Informacion-operativa-{base}.pdf", temp_dir, None

    # Sin LibreOffice (o la conversión falló): se sirve el .docx. No se calla.
    logger.warning("[briefing] PDF conversion failed for %s, serving .docx: %s",
                   competition_id, conversion_error)
    return str(docx_path), DOCX_MEDIA_TYPE, f"Informacion-operativa-{base}.docx", temp_dir, conversion_error


def render_briefing(competition_id: str) -> tuple[str, str, str, str]:
    """`(file_path, media_type, download_filename, temp_dir)`.

    PDF si la conversión salió; si no, el .docx con su media type.
    """
    path, media_type, filename, temp_dir, _error = render_briefing_detailed(competition_id)
    return path, media_type, filename, temp_dir
