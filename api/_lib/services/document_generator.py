import os
import re
import copy
import tempfile
import httpx
from datetime import datetime
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
    """Generate a nomination/confirmation .docx letter, convert to PDF, upload."""
    template_key = nomination_data["template_key"]

    if template_key in ("WCQ", "GENERIC"):
        doc = _build_wcq_letter(nomination_data)
    elif template_key in ("BCLA", "LSB"):
        doc = _build_confirmation_from_scratch(nomination_data)
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

    # Convert to PDF
    pdf_path = _convert_to_pdf(str(docx_path))
    final_path = pdf_path if pdf_path else str(docx_path)
    final_base = base_name if not pdf_path else base_name

    # Upload to Supabase Storage
    storage_url = _upload_to_storage(final_path, base_name)
    return final_path, storage_url


# ─── DATE FORMATTING ─────────────────────────────────────────────────────────

def _fmt_date(date_str: str) -> str:
    """Convert ISO date (2026-04-17) to readable format (17 April 2026)."""
    if not date_str:
        return ""
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        return dt.strftime("%-d %B %Y")
    except (ValueError, TypeError):
        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            return dt.strftime("%d %B %Y").lstrip("0")
        except Exception:
            return date_str


def _fmt_deadline(date_str: str) -> str:
    """Format deadline: January 18th, 2026."""
    if not date_str:
        return ""
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        day = dt.day
        if 11 <= day <= 13:
            suffix = "th"
        else:
            suffix = {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")
        return dt.strftime(f"%B {day}{suffix}, %Y")
    except Exception:
        return date_str


# ─── WCQ / GENERIC LETTER ────────────────────────────────────────────────────

def _build_wcq_letter(data: dict) -> Document:
    template_path = TEMPLATES_DIR / "WCQ_TEMPLATE.docx"
    if not template_path.exists():
        return _build_wcq_from_scratch(data)

    doc = Document(str(template_path))
    paras = doc.paragraphs

    nominee = data.get("nominee_name", "")
    comp_name = data.get("competition_name", "")
    role = data.get("role", "VGO")
    role_label = "Video Graphic Operator" if role == "VGO" else "Technical Delegate"
    game_dates = data.get("game_dates", [])
    deadline = _fmt_deadline(data.get("confirmation_deadline", ""))
    fee = data.get("window_fee")
    incidentals = data.get("incidentals")
    total = data.get("total")

    # Clear ALL empty paragraphs first (keep [0] title and [46] signature)
    for i in range(1, len(paras) - 1):
        _clear_para(paras[i])

    # [2] — "Dear [Name],"
    _set_para_mixed(paras[2], [
        ("Dear ", COLOR_DARK, False),
        (nominee, COLOR_RED, False),
        (",", COLOR_DARK, False),
    ])

    # [4] — Body intro
    _set_para_text(paras[4],
        f"We would like to inform that you have been nominated for the "
        f"following games of the {comp_name}.",
        COLOR_DARK)

    # [6+] — Game dates (centered, bold, red)
    for i, gd in enumerate(game_dates):
        idx = 6 + i
        if idx < len(paras) - 1:
            label = gd.get("label", "")
            date_val = _fmt_date(gd.get("date", ""))
            text = f"{label}: {date_val}" if label else date_val
            _set_para_text(paras[idx], text, COLOR_RED, bold=True, size=Pt(10),
                          align=WD_ALIGN_PARAGRAPH.CENTER)

    # Confirmation paragraph — 2 lines after last game date
    confirm_idx = 6 + max(len(game_dates), 1) + 2
    if confirm_idx < len(paras) - 1:
        _set_para_mixed(paras[confirm_idx], [
            (f"As per the FIBA Internal Regulations Book 3, please confirm to us "
             f"your availability to fulfil your assignment as {role_label} by ",
             COLOR_DARK, False),
            (f"{deadline}", COLOR_RED, False),
            (".", COLOR_DARK, False),
            (" Confirmation shall be sent to ", COLOR_DARK, False),
            ("vgo.americas@fiba.basketball", COLOR_DARK, False),
        ], align=WD_ALIGN_PARAGRAPH.JUSTIFY)

    # Travel paragraph
    travel_idx = confirm_idx + 2
    if travel_idx < len(paras) - 1:
        _set_para_text(paras[travel_idx],
            "As soon as we receive your confirmation, we will make arrangements "
            "for international flights to the host country and provide you with "
            "relevant information in order for you to prepare the game and "
            "establish contact with the Game Director of the Host National Federation.",
            COLOR_DARK)

    # Payment intro
    payment_idx = travel_idx + 2
    if payment_idx < len(paras) - 1:
        _set_para_text(paras[payment_idx],
            f"Below list the details of payment you will receive as {role_label} "
            f"assigned to the competition listed above:",
            COLOR_DARK)

    # Fee items
    fee_idx = payment_idx + 4
    fee_items = [
        (f"Per Game Fee: {_fmt_money(fee)}", False),
        (f"Incidentals: {_fmt_money(incidentals)}", False),
        (f"Total: {_fmt_money(total)}", True),
    ]
    for i, (text, bold) in enumerate(fee_items):
        idx = fee_idx + i
        if idx < len(paras) - 1:
            _set_para_text(paras[idx], text, COLOR_RED, bold=bold, size=Pt(10))
            try:
                paras[idx].style = doc.styles["List Paragraph"]
            except Exception:
                pass

    # Closing — place right after fees with a couple blank lines
    closing_idx = fee_idx + len(fee_items) + 3
    if closing_idx < len(paras) - 1:
        _set_para_text(paras[closing_idx],
            "We wish you the best in your preparation and accomplishment of your assignment.",
            COLOR_DARK)

    # Remove excess empty paragraphs between closing and signature
    # Signature is always the last paragraph [46]
    # We want: closing → 2 blank → signature
    # So clear everything from closing_idx+1 to the paragraph before last
    # (they're already cleared, just ensure signature is at the right spot)

    return doc


# ─── CONFIRMATION (BCLA / LSB) FROM SCRATCH ──────────────────────────────────

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

    details = []
    if data.get("location"):
        details.append(f"Location: {data['location']}")
    if data.get("venue"):
        details.append(f"Venue: {data['venue']}")
    if data.get("arrival_date"):
        details.append(f"Arrival Date: {_fmt_date(data['arrival_date'])}")
    if data.get("departure_date"):
        details.append(f"Departure Date: {_fmt_date(data['departure_date'])}")
    for d in details:
        _add_body_text(doc, f"  •  {d}")
    _add_empty(doc)

    for gd in game_dates:
        label = gd.get("label", "")
        date_val = _fmt_date(gd.get("date", ""))
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


# ─── WCQ FROM SCRATCH (fallback) ─────────────────────────────────────────────

def _build_wcq_from_scratch(data: dict) -> Document:
    doc = Document()
    _apply_base_style(doc)

    nominee = data.get("nominee_name", "")
    comp_name = data.get("competition_name", "")
    role = data.get("role", "VGO")
    role_label = "Video Graphic Operator" if role == "VGO" else "Technical Delegate"
    game_dates = data.get("game_dates", [])
    deadline = _fmt_deadline(data.get("confirmation_deadline", ""))

    _add_heading(doc, f"Nomination for the {comp_name}")
    _add_empty(doc)
    _add_body(doc, [("Dear ", COLOR_DARK), (nominee, COLOR_RED), (",", COLOR_DARK)])
    _add_empty(doc)
    _add_body_text(doc, f"We would like to inform that you have been nominated for the following games of the {comp_name}.")
    _add_empty(doc)

    for gd in game_dates:
        label = gd.get("label", "")
        date_val = _fmt_date(gd.get("date", ""))
        text = f"{label}: {date_val}" if label else date_val
        _add_centered_red(doc, text)

    _add_empty(doc)
    _add_empty(doc)

    parts = [
        (f"As per the FIBA Internal Regulations Book 3, please confirm to us your availability to fulfil your assignment as {role_label} by ", COLOR_DARK),
        (deadline, COLOR_RED),
        (". Confirmation shall be sent to vgo.americas@fiba.basketball", COLOR_DARK),
    ]
    _add_body(doc, parts, align=WD_ALIGN_PARAGRAPH.JUSTIFY)
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

    _add_empty(doc)
    _add_empty(doc)
    _add_empty(doc)

    _add_body_text(doc, "We wish you the best in your preparation and accomplishment of your assignment.")
    _add_empty(doc)
    _add_empty(doc)

    sig_name, sig_title, sig_org = SIGNATORIES.get(data.get("template_key", "GENERIC"), SIGNATORIES["GENERIC"])
    _add_body_text(doc, f"{sig_name} {sig_title} {sig_org}")

    return doc


# ─── PDF CONVERSION (Gotenberg) ──────────────────────────────────────────────

def _convert_to_pdf(docx_path: str) -> str | None:
    """
    Convert .docx to .pdf using Gotenberg.
    Set GOTENBERG_URL env var to your Gotenberg instance URL.
    Example: https://gotenberg-xxxx.onrender.com

    Gotenberg API: POST /forms/libreoffice/convert
    - multipart form with field "files"
    - returns PDF bytes directly
    """
    gotenberg_url = os.environ.get("GOTENBERG_URL", "")
    if not gotenberg_url:
        return None

    pdf_path = docx_path.replace(".docx", ".pdf")
    endpoint = f"{gotenberg_url.rstrip('/')}/forms/libreoffice/convert"

    try:
        with open(docx_path, "rb") as f:
            docx_bytes = f.read()

        filename = Path(docx_path).name

        response = httpx.post(
            endpoint,
            files={"files": (filename, docx_bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
            timeout=60.0,
        )

        if response.status_code == 200:
            with open(pdf_path, "wb") as f:
                f.write(response.content)
            return pdf_path
        else:
            print(f"[GOTENBERG] Error {response.status_code}: {response.text[:200]}")
            return None

    except Exception as e:
        print(f"[GOTENBERG] {type(e).__name__}: {e}")
        return None


# ─── PARAGRAPH HELPERS ───────────────────────────────────────────────────────

def _set_para_text(para, text, color, bold=False, size=None, align=None):
    _clear_para(para)
    if align is not None:
        para.alignment = align
    run = para.add_run(text)
    run.font.color.rgb = color
    run.bold = bold
    if size:
        run.font.size = size


def _set_para_mixed(para, parts, align=None):
    _clear_para(para)
    if align is not None:
        para.alignment = align
    for text, color, bold in parts:
        run = para.add_run(text)
        run.font.color.rgb = color
        run.bold = bold


def _clear_para(para):
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
    import traceback
    try:
        from api._lib.database import get_supabase

        client = get_supabase()
        bucket_name = "nominations"
        ext = Path(file_path).suffix
        storage_path = f"{base_name}{ext}"

        with open(file_path, "rb") as f:
            file_bytes = f.read()

        content_type = "application/pdf" if ext == ".pdf" else \
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

        try:
            client.storage.from_(bucket_name).upload(
                path=storage_path,
                file=file_bytes,
                file_options={"content-type": content_type, "upsert": "true"},
            )
        except Exception:
            try:
                client.storage.from_(bucket_name).remove([storage_path])
            except Exception:
                pass
            client.storage.from_(bucket_name).upload(
                path=storage_path,
                file=file_bytes,
                file_options={"content-type": content_type},
            )

        public_url = client.storage.from_(bucket_name).get_public_url(storage_path)
        return public_url

    except Exception as e:
        print(f"[STORAGE ERROR] {type(e).__name__}: {e}")
        traceback.print_exc()
        return None
