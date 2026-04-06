import os
import re
import copy
import tempfile
from pathlib import Path
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

OUTPUT_DIR = Path(tempfile.gettempdir()) / "fiba_generated"
TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent.parent / "templates"

# FIBA brand colors
COLOR_DARK = RGBColor(0x2A, 0x2A, 0x2A)
COLOR_RED = RGBColor(0xED, 0x00, 0x00)

SIGNATORIES = {
    "WCQ": ("Carlos Alves", "Executive Director", "FIBA Americas"),
    "GENERIC": ("Carlos Alves", "Executive Director", "FIBA Americas"),
    "BCLA": ("Gino Rullo", "Head of Operations", "Basketball Champions League Americas"),
    "LSB": ("Gino Rullo", "Head of Operations", "Club Competitions – FIBA Americas"),
}


def generate_nomination(nomination_data: dict) -> tuple[str, str | None]:
    """Generate a nomination/confirmation .docx letter. Returns (local_path, storage_url)."""
    template_key = nomination_data["template_key"]

    if template_key in ("WCQ", "GENERIC"):
        doc = _build_wcq_letter(nomination_data)
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

    storage_url = _upload_to_storage(str(docx_path), base_name)
    return str(docx_path), storage_url


# ─── WCQ / GENERIC  ──────────────────────────────────────────────────────────

def _build_wcq_letter(data: dict) -> Document:
    """
    Uses WCQ_TEMPLATE.docx as base (has logos, margins, styles).
    The template has 47 paragraphs: [0] = heading, [1-45] = empty Body Text, [46] = signatory.
    We fill the empty paragraphs with the letter content matching the Felipe Saldarriaga format.
    """
    template_path = TEMPLATES_DIR / "WCQ_TEMPLATE.docx"
    if not template_path.exists():
        # Fallback: generate from scratch if template missing
        return _build_wcq_from_scratch(data)

    doc = Document(str(template_path))
    paras = doc.paragraphs

    nominee = data.get("nominee_name", "")
    comp_name = data.get("competition_name", "")
    role = data.get("role", "VGO")
    role_label = "Video Graphic Operator" if role == "VGO" else "Technical Delegate"
    game_dates = data.get("game_dates", [])
    deadline = data.get("confirmation_deadline", "")
    fee = data.get("window_fee")
    incidentals = data.get("incidentals")
    total = data.get("total")

    # Para [0] — Title: already set in template, but update if needed
    # Keep as-is (Nomination for the FIBA World Cup 2027 Qualifiers)

    # Para [2] — "Dear [Name],"
    _set_para_mixed(paras[2], [
        ("Dear ", COLOR_DARK, False),
        (nominee, COLOR_RED, False),
        (",", COLOR_DARK, False),
    ])

    # Para [4] — Body intro
    _set_para_text(paras[4],
        f"We would like to inform that you have been nominated for the "
        f"following games of the {comp_name}.",
        COLOR_DARK)

    # Para [6+] — Game dates (centered, bold, red)
    date_start = 6
    for i, gd in enumerate(game_dates):
        idx = date_start + i
        if idx < len(paras) - 1:
            label = gd.get("label", "")
            date_val = gd.get("date", "")
            text = f"{label}: {date_val}" if label else date_val
            _set_para_text(paras[idx], text, COLOR_RED, bold=True, size=Pt(10),
                          align=WD_ALIGN_PARAGRAPH.CENTER)

    # Confirmation paragraph — after game dates
    confirm_idx = date_start + max(len(game_dates), 1) + 2
    if confirm_idx < len(paras) - 1:
        _set_para_mixed(paras[confirm_idx], [
            (f"As per the FIBA Internal Regulations Book 3, please confirm to us "
             f"your availability to fulfil your assignment as {role_label} by ",
             COLOR_DARK, False),
            (deadline, COLOR_RED, False),
            (".", COLOR_DARK, False),
            (" Confirmation shall be sent to ", COLOR_DARK, False),
            ("vgo.americas@fiba.basketball", COLOR_DARK, False),
        ], align=WD_ALIGN_PARAGRAPH.JUSTIFY)

    # Travel arrangements paragraph
    travel_idx = confirm_idx + 2
    if travel_idx < len(paras) - 1:
        _set_para_text(paras[travel_idx],
            "As soon as we receive your confirmation, we will make arrangements "
            "for international flights to the host country and provide you with "
            "relevant information in order for you to prepare the game and "
            "establish contact with the Game Director of the Host National Federation.",
            COLOR_DARK)

    # Payment details paragraph
    payment_idx = travel_idx + 2
    if payment_idx < len(paras) - 1:
        _set_para_text(paras[payment_idx],
            f"Below list the details of payment you will receive as {role_label} "
            f"assigned to the competition listed above:",
            COLOR_DARK)

    # Fee items (List Paragraph style, red)
    fee_idx = payment_idx + 4
    fee_items = [
        ("Per Game Fee:", _fmt_money(fee), False),
        ("Incidentals:", _fmt_money(incidentals), False),
        ("Total:", _fmt_money(total), True),
    ]
    for i, (label, value, bold) in enumerate(fee_items):
        idx = fee_idx + i
        if idx < len(paras) - 1:
            _set_para_text(paras[idx], f"{label} {value}", COLOR_RED,
                          bold=bold, size=Pt(10))
            # Try to apply List Paragraph style
            try:
                paras[idx].style = doc.styles["List Paragraph"]
            except Exception:
                pass

    # Closing paragraph
    closing_idx = fee_idx + len(fee_items) + 10
    if closing_idx >= len(paras) - 1:
        closing_idx = len(paras) - 5
    if 0 < closing_idx < len(paras) - 1:
        _set_para_text(paras[closing_idx],
            "We wish you the best in your preparation and accomplishment of your assignment.",
            COLOR_DARK)

    # Signatory [last paragraph] — already has "Carlos Alves Executive Director FIBA Americas"
    # Keep as-is

    return doc


# ─── CONFIRMATION (BCLA / LSB) ───────────────────────────────────────────────

def _build_confirmation_letter(data: dict) -> Document:
    """Build BCLA/LSB confirmation letter from scratch (no template file yet)."""
    return _build_confirmation_from_scratch(data)


# ─── FALLBACK: BUILD FROM SCRATCH ────────────────────────────────────────────

def _build_wcq_from_scratch(data: dict) -> Document:
    doc = Document()
    _apply_base_style(doc)

    nominee = data.get("nominee_name", "")
    comp_name = data.get("competition_name", "")
    role = data.get("role", "VGO")
    role_label = "Video Graphic Operator" if role == "VGO" else "Technical Delegate"
    game_dates = data.get("game_dates", [])
    deadline = data.get("confirmation_deadline", "")

    _add_heading(doc, f"Nomination for the {comp_name}")
    _add_empty(doc)
    _add_body(doc, [("Dear ", COLOR_DARK), (nominee, COLOR_RED), (",", COLOR_DARK)])
    _add_empty(doc)
    _add_body_text(doc, f"We would like to inform that you have been nominated for the following games of the {comp_name}.")
    _add_empty(doc)

    for gd in game_dates:
        label = gd.get("label", "")
        date_val = gd.get("date", "")
        text = f"{label}: {date_val}" if label else date_val
        _add_centered_red(doc, text)

    _add_empty(doc)
    _add_empty(doc)
    _add_body(doc, [
        (f"As per the FIBA Internal Regulations Book 3, please confirm to us your availability to fulfil your assignment as {role_label} by ", COLOR_DARK),
        (deadline, COLOR_RED),
        (". Confirmation shall be sent to vgo.americas@fiba.basketball", COLOR_DARK),
    ], align=WD_ALIGN_PARAGRAPH.JUSTIFY)
    _add_empty(doc)
    _add_body_text(doc, "As soon as we receive your confirmation, we will make arrangements for international flights to the host country and provide you with relevant information in order for you to prepare the game and establish contact with the Game Director of the Host National Federation.")
    _add_empty(doc)
    _add_body_text(doc, f"Below list the details of payment you will receive as {role_label} assigned to the competition listed above:")
    _add_empty(doc)
    _add_empty(doc)
    _add_empty(doc)

    _add_fee_line(doc, f"Per Game Fee: {_fmt_money(data.get('window_fee'))}", bold=False)
    _add_fee_line(doc, f"Incidentals: {_fmt_money(data.get('incidentals'))}", bold=False)
    _add_fee_line(doc, f"Total: {_fmt_money(data.get('total'))}", bold=True)

    for _ in range(10):
        _add_empty(doc)

    _add_body_text(doc, "We wish you the best in your preparation and accomplishment of your assignment.")
    _add_empty(doc)
    _add_empty(doc)
    _add_empty(doc)

    sig_name, sig_title, sig_org = SIGNATORIES.get(data.get("template_key", "GENERIC"), SIGNATORIES["GENERIC"])
    _add_body_text(doc, f"{sig_name} {sig_title} {sig_org}")

    return doc


def _build_confirmation_from_scratch(data: dict) -> Document:
    doc = Document()
    _apply_base_style(doc)

    nominee = data.get("nominee_name", "")
    comp_name = data.get("competition_name", "")
    role = data.get("role", "VGO")
    role_label = "Video Graphic Operator" if role == "VGO" else "Technical Delegate"
    tk = data.get("template_key", "BCLA")
    game_dates = data.get("game_dates", [])

    title = f"Confirmation – {comp_name}"
    if tk == "LSB":
        title += f" {data.get('competition_year', '')}"

    _add_heading(doc, title)
    _add_empty(doc)
    _add_body(doc, [("Dear ", COLOR_DARK), (nominee, COLOR_RED), (",", COLOR_DARK)])
    _add_empty(doc)
    _add_body_text(doc, f"This letter confirms your assignment as {role_label} for the {comp_name}.")
    _add_empty(doc)

    # Event details
    details = []
    if data.get("location"):
        details.append(f"Location: {data['location']}")
    if data.get("venue"):
        details.append(f"Venue: {data['venue']}")
    if data.get("arrival_date"):
        details.append(f"Arrival Date: {data['arrival_date']}")
    if data.get("departure_date"):
        details.append(f"Departure Date: {data['departure_date']}")
    for d in details:
        _add_body_text(doc, f"  •  {d}")
    _add_empty(doc)

    for gd in game_dates:
        label = gd.get("label", "")
        date_val = gd.get("date", "")
        text = f"{label}: {date_val}" if label else date_val
        _add_centered_red(doc, text)
    _add_empty(doc)

    _add_body_text(doc, f"Below list the details of payment you will receive as {role_label} assigned to the competition listed above:")
    _add_empty(doc)
    _add_fee_line(doc, f"Window Fee: {_fmt_money(data.get('window_fee'))}", bold=False)
    _add_fee_line(doc, f"Incidentals: {_fmt_money(data.get('incidentals'))}", bold=False)
    _add_fee_line(doc, f"Total: {_fmt_money(data.get('total'))}", bold=True)
    _add_empty(doc)

    _add_body_text(doc, "Thank you for your commitment and professionalism.")
    _add_empty(doc)
    _add_empty(doc)

    sig_name, sig_title, sig_org = SIGNATORIES.get(tk, SIGNATORIES["BCLA"])
    _add_body_text(doc, f"{sig_name} {sig_title} {sig_org}")

    return doc


# ─── PARAGRAPH HELPERS ───────────────────────────────────────────────────────

def _set_para_text(para, text, color, bold=False, size=None, align=None):
    """Clear a paragraph and set it to a single run with the given formatting."""
    _clear_para(para)
    if align is not None:
        para.alignment = align
    run = para.add_run(text)
    run.font.color.rgb = color
    run.bold = bold
    if size:
        run.font.size = size


def _set_para_mixed(para, parts, align=None):
    """Clear paragraph and add multiple runs with different colors.
    parts: list of (text, color, bold)
    """
    _clear_para(para)
    if align is not None:
        para.alignment = align
    for text, color, bold in parts:
        run = para.add_run(text)
        run.font.color.rgb = color
        run.bold = bold


def _clear_para(para):
    """Remove all runs from a paragraph."""
    for run in para.runs:
        run._element.getparent().remove(run._element)
    # Also remove any remaining r elements
    for r in para._element.findall(qn('w:r')):
        para._element.remove(r)


def _apply_base_style(doc):
    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(10)
    style.font.color.rgb = COLOR_DARK


def _add_heading(doc, text):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(14)
    run.font.color.rgb = COLOR_DARK


def _add_body_text(doc, text):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(10)
    run.font.color.rgb = COLOR_DARK


def _add_body(doc, parts, align=None):
    p = doc.add_paragraph()
    if align:
        p.alignment = align
    for text, color in parts:
        run = p.add_run(text)
        run.font.size = Pt(10)
        run.font.color.rgb = color


def _add_centered_red(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(10)
    run.font.color.rgb = COLOR_RED


def _add_fee_line(doc, text, bold=False):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.size = Pt(10)
    run.font.color.rgb = COLOR_RED
    run.bold = bold


def _add_empty(doc):
    doc.add_paragraph()


def _fmt_money(val) -> str:
    if val is None:
        return ""
    try:
        v = float(val)
        if v == int(v):
            return f"${int(v)}"
        return f"${v:,.2f}"
    except (ValueError, TypeError):
        return str(val)


# ─── STORAGE ─────────────────────────────────────────────────────────────────

def _upload_to_storage(file_path: str, base_name: str) -> str | None:
    """Upload generated file to Supabase Storage bucket 'nominations'."""
    try:
        from api._lib.database import supabase

        bucket_name = "nominations"
        ext = Path(file_path).suffix
        storage_path = f"{base_name}{ext}"

        with open(file_path, "rb") as f:
            file_bytes = f.read()

        content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

        supabase.storage.from_(bucket_name).upload(
            storage_path, file_bytes,
            file_options={"content-type": content_type, "upsert": "true"},
        )

        public_url = supabase.storage.from_(bucket_name).get_public_url(storage_path)
        return public_url

    except Exception:
        return None
