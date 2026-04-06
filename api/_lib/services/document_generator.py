import os
import re
import tempfile
from pathlib import Path
from docx import Document
from docx.shared import Pt, Inches, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT

OUTPUT_DIR = Path(tempfile.gettempdir()) / "fiba_generated"

SIGNATORIES = {
    "WCQ": ("Carlos Alves", "Executive Director", "FIBA Americas"),
    "GENERIC": ("Carlos Alves", "Executive Director", "FIBA Americas"),
    "BCLA": ("Gino Rullo", "Head of Operations", "Basketball Champions League Americas"),
    "LSB": ("Gino Rullo", "Head of Operations", "Club Competitions – FIBA Americas"),
}


def generate_nomination(nomination_data: dict) -> tuple[str, str | None]:
    """
    Generate a nomination/confirmation letter as .docx.
    Returns (local_path, storage_url).
    """
    template_key = nomination_data["template_key"]

    if template_key in ("WCQ", "GENERIC"):
        doc = _build_nomination_letter(nomination_data)
    elif template_key in ("BCLA", "LSB"):
        doc = _build_confirmation_letter(nomination_data)
    else:
        raise ValueError(f"Unknown template_key: {template_key}")

    # Build output filename
    name_clean = re.sub(r"[^\w\s-]", "", nomination_data["nominee_name"]).replace(" ", "_")
    comp_clean = re.sub(r"[^\w\s-]", "", nomination_data["competition_name"]).replace(" ", "_")
    role = nomination_data.get("role", "VGO")
    base_name = f"Nomination_{role}_{name_clean}_{comp_clean}"

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    docx_path = OUTPUT_DIR / f"{base_name}.docx"
    doc.save(str(docx_path))

    # Upload to Supabase Storage if configured
    storage_url = _upload_to_storage(str(docx_path), base_name)

    return str(docx_path), storage_url


# ─── NOMINATION LETTER (WCQ / GENERIC) ───────────────────────────────────────

def _build_nomination_letter(data: dict) -> Document:
    doc = Document()
    _set_default_font(doc)
    _set_margins(doc)

    # Header
    _add_header(doc, "FIBA Americas")

    # Date
    _add_paragraph(doc, data.get("letter_date", ""), bold=False, size=11)
    _add_empty_line(doc)

    # Recipient
    _add_paragraph(doc, f"Dear {data.get('nominee_name', '')},", bold=False, size=11)
    _add_empty_line(doc)

    # Subject
    role_label = "Video Graphic Operator (VGO)" if data.get("role") == "VGO" else "Technical Delegate (TD)"
    comp_name = data.get("competition_name", "")
    _add_paragraph(
        doc,
        f"Re: Nomination as {role_label} – {comp_name}",
        bold=True, size=11,
    )
    _add_empty_line(doc)

    # Body
    _add_paragraph(
        doc,
        f"We are pleased to inform you that you have been nominated as {role_label} "
        f"for the {comp_name}.",
        bold=False, size=11,
    )
    _add_empty_line(doc)

    # Game dates
    game_dates = data.get("game_dates", [])
    if game_dates:
        _add_paragraph(doc, "Game Schedule:", bold=True, size=11)
        for gd in game_dates:
            label = gd.get("label", "")
            date = gd.get("date", "")
            text = f"  •  {label}: {date}" if label else f"  •  {date}"
            _add_paragraph(doc, text, bold=False, size=10)
        _add_empty_line(doc)

    # Compensation table
    _add_paragraph(doc, "Compensation:", bold=True, size=11)
    _add_compensation_table(doc, data, fee_label="Per Game Fee")
    _add_empty_line(doc)

    # Confirmation deadline
    deadline = data.get("confirmation_deadline", "")
    if deadline:
        _add_paragraph(
            doc,
            f"Please confirm your acceptance by {deadline}.",
            bold=False, size=11,
        )
        _add_empty_line(doc)

    # Closing
    _add_paragraph(doc, "We look forward to your confirmation.", bold=False, size=11)
    _add_empty_line(doc)
    _add_paragraph(doc, "Kind regards,", bold=False, size=11)
    _add_empty_line(doc)

    # Signatory
    tk = data.get("template_key", "GENERIC")
    sig_name, sig_title, sig_org = SIGNATORIES.get(tk, SIGNATORIES["GENERIC"])
    _add_paragraph(doc, sig_name, bold=True, size=11)
    _add_paragraph(doc, f"{sig_title}", bold=False, size=10, color=RGBColor(100, 100, 100))
    _add_paragraph(doc, sig_org, bold=False, size=10, color=RGBColor(100, 100, 100))

    return doc


# ─── CONFIRMATION LETTER (BCLA / LSB) ────────────────────────────────────────

def _build_confirmation_letter(data: dict) -> Document:
    doc = Document()
    _set_default_font(doc)
    _set_margins(doc)

    tk = data.get("template_key", "BCLA")

    # Header
    org_name = "Basketball Champions League Americas" if tk == "BCLA" else "Liga Sudamericana de Básquetbol"
    _add_header(doc, org_name)

    # Date
    _add_paragraph(doc, data.get("letter_date", ""), bold=False, size=11)
    _add_empty_line(doc)

    # Recipient
    _add_paragraph(doc, f"Dear {data.get('nominee_name', '')},", bold=False, size=11)
    _add_empty_line(doc)

    # Subject
    role_label = "Video Graphic Operator (VGO)" if data.get("role") == "VGO" else "Technical Delegate (TD)"
    comp_name = data.get("competition_name", "")
    comp_year = data.get("competition_year", "")

    if tk == "BCLA":
        subject = f"Re: Confirmation as {role_label} – {comp_name}"
    else:
        subject = f"Re: Confirmation as {role_label} – {comp_name} {comp_year}"

    _add_paragraph(doc, subject, bold=True, size=11)
    _add_empty_line(doc)

    # Body
    _add_paragraph(
        doc,
        f"This letter confirms your assignment as {role_label} for the {comp_name}.",
        bold=False, size=11,
    )
    _add_empty_line(doc)

    # Event details
    _add_paragraph(doc, "Event Details:", bold=True, size=11)

    details = []
    if data.get("location"):
        details.append(("Location", data["location"]))
    if data.get("venue"):
        details.append(("Venue", data["venue"]))
    if data.get("arrival_date"):
        details.append(("Arrival Date", data["arrival_date"]))
    if data.get("departure_date"):
        details.append(("Departure Date", data["departure_date"]))

    for label, value in details:
        _add_paragraph(doc, f"  •  {label}: {value}", bold=False, size=10)
    _add_empty_line(doc)

    # Game dates
    game_dates = data.get("game_dates", [])
    if game_dates:
        _add_paragraph(doc, "Game Schedule:", bold=True, size=11)
        for gd in game_dates:
            label = gd.get("label", "")
            date = gd.get("date", "")
            text = f"  •  {label}: {date}" if label else f"  •  {date}"
            _add_paragraph(doc, text, bold=False, size=10)
        _add_empty_line(doc)

    # Compensation table
    _add_paragraph(doc, "Compensation:", bold=True, size=11)
    _add_compensation_table(doc, data, fee_label="Window Fee")
    _add_empty_line(doc)

    # Closing
    _add_paragraph(doc, "Thank you for your commitment and professionalism.", bold=False, size=11)
    _add_empty_line(doc)
    _add_paragraph(doc, "Kind regards,", bold=False, size=11)
    _add_empty_line(doc)

    # Signatory
    sig_name, sig_title, sig_org = SIGNATORIES.get(tk, SIGNATORIES["BCLA"])
    _add_paragraph(doc, sig_name, bold=True, size=11)
    _add_paragraph(doc, sig_title, bold=False, size=10, color=RGBColor(100, 100, 100))
    _add_paragraph(doc, sig_org, bold=False, size=10, color=RGBColor(100, 100, 100))

    return doc


# ─── HELPERS ──────────────────────────────────────────────────────────────────

def _set_default_font(doc: Document):
    style = doc.styles["Normal"]
    font = style.font
    font.name = "Calibri"
    font.size = Pt(11)
    font.color.rgb = RGBColor(33, 33, 33)


def _set_margins(doc: Document):
    for section in doc.sections:
        section.top_margin = Inches(1)
        section.bottom_margin = Inches(1)
        section.left_margin = Inches(1.2)
        section.right_margin = Inches(1.2)


def _add_header(doc: Document, org_name: str):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    run = p.add_run(org_name)
    run.bold = True
    run.font.size = Pt(16)
    run.font.color.rgb = RGBColor(0, 51, 153)  # FIBA blue

    # Separator line
    p2 = doc.add_paragraph()
    p2.paragraph_format.space_after = Pt(6)
    run2 = p2.add_run("─" * 60)
    run2.font.size = Pt(8)
    run2.font.color.rgb = RGBColor(0, 51, 153)


def _add_paragraph(
    doc: Document,
    text: str,
    bold: bool = False,
    size: int = 11,
    color: RGBColor = None,
    align=WD_ALIGN_PARAGRAPH.LEFT,
):
    p = doc.add_paragraph()
    p.alignment = align
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.space_before = Pt(0)
    run = p.add_run(text)
    run.bold = bold
    run.font.size = Pt(size)
    if color:
        run.font.color.rgb = color
    return p


def _add_empty_line(doc: Document):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.space_before = Pt(0)


def _add_compensation_table(doc: Document, data: dict, fee_label: str = "Fee"):
    table = doc.add_table(rows=3, cols=2, style="Table Grid")
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    table.autofit = True

    rows_data = [
        (fee_label, _fmt_currency(data.get("window_fee"))),
        ("Incidentals", _fmt_currency(data.get("incidentals"))),
        ("Total", _fmt_currency(data.get("total"))),
    ]

    for i, (label, value) in enumerate(rows_data):
        cell_label = table.rows[i].cells[0]
        cell_value = table.rows[i].cells[1]

        cell_label.text = ""
        cell_value.text = ""

        run_l = cell_label.paragraphs[0].add_run(label)
        run_l.font.size = Pt(10)
        run_l.bold = i == 2  # Bold for Total row

        run_v = cell_value.paragraphs[0].add_run(value)
        run_v.font.size = Pt(10)
        run_v.bold = i == 2

    # Set column widths
    for row in table.rows:
        row.cells[0].width = Inches(2.5)
        row.cells[1].width = Inches(2.5)


def _fmt_currency(val) -> str:
    if val is None:
        return ""
    try:
        return f"USD {float(val):,.2f}"
    except (ValueError, TypeError):
        return str(val)


def _upload_to_storage(file_path: str, base_name: str) -> str | None:
    """Upload generated file to Supabase Storage bucket 'nominations'."""
    try:
        from api._lib.database import supabase

        bucket_name = "nominations"
        ext = Path(file_path).suffix
        storage_path = f"{base_name}{ext}"

        with open(file_path, "rb") as f:
            file_bytes = f.read()

        content_type = (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )

        supabase.storage.from_(bucket_name).upload(
            storage_path, file_bytes,
            file_options={"content-type": content_type, "upsert": "true"},
        )

        public_url = supabase.storage.from_(bucket_name).get_public_url(storage_path)
        return public_url

    except Exception:
        # Storage not configured or bucket doesn't exist
        return None
