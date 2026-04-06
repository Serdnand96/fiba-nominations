import os
import re
import subprocess
import tempfile
from pathlib import Path
from docx import Document

# In Vercel serverless, templates are bundled with the deployment.
# Locally they live in the project's templates/ dir.
# On Vercel, only /tmp is writable.
TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent.parent / "templates"
OUTPUT_DIR = Path(tempfile.gettempdir()) / "fiba_generated"

TEMPLATE_FILES = {
    "WCQ": "WCQ_TEMPLATE_fixed.docx",
    "BCLA": "BCL_Americas_VGO_Final4.docx",
    "LSB": "LSB_2024_VGO_Nomination.docx",
    "GENERIC": "GENERIC_TEMPLATE.docx",
}


def generate_nomination(nomination_data: dict) -> tuple[str, str | None]:
    """
    Generate a nomination document.
    Returns (local_path, storage_url).
    storage_url is None if Supabase Storage is not configured.
    """
    template_key = nomination_data["template_key"]
    template_file = TEMPLATE_FILES.get(template_key)
    if not template_file:
        raise ValueError(f"Unknown template_key: {template_key}")

    template_path = TEMPLATES_DIR / template_file
    if not template_path.exists():
        raise FileNotFoundError(
            f"Template not found: {template_path}. "
            f"Place your .docx templates in the templates/ directory."
        )

    doc = Document(str(template_path))
    replacements = _build_replacements(template_key, nomination_data)

    # Replace in paragraphs
    for paragraph in doc.paragraphs:
        _replace_in_paragraph(paragraph, replacements)

    # Replace in tables
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for paragraph in cell.paragraphs:
                    _replace_in_paragraph(paragraph, replacements)

    # Replace in headers/footers
    for section in doc.sections:
        for header_footer in [section.header, section.footer]:
            for paragraph in header_footer.paragraphs:
                _replace_in_paragraph(paragraph, replacements)

    # Build output filename
    name_clean = re.sub(r"[^\w\s-]", "", nomination_data["nominee_name"]).replace(" ", "_")
    comp_clean = re.sub(r"[^\w\s-]", "", nomination_data["competition_name"]).replace(" ", "_")
    role = nomination_data.get("role", "VGO")
    base_name = f"Nomination_{role}_{name_clean}_{comp_clean}"

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    docx_path = OUTPUT_DIR / f"{base_name}.docx"
    doc.save(str(docx_path))

    # Try PDF conversion via LibreOffice (available locally, not on Vercel)
    pdf_path = OUTPUT_DIR / f"{base_name}.pdf"
    try:
        subprocess.run(
            ["libreoffice", "--headless", "--convert-to", "pdf",
             "--outdir", str(OUTPUT_DIR), str(docx_path)],
            check=True, timeout=60,
        )
        output_path = str(pdf_path)
    except (FileNotFoundError, subprocess.CalledProcessError):
        # LibreOffice not available — return .docx
        output_path = str(docx_path)

    # Upload to Supabase Storage if configured
    storage_url = _upload_to_storage(output_path, base_name)

    return output_path, storage_url


def _upload_to_storage(file_path: str, base_name: str) -> str | None:
    """Upload generated file to Supabase Storage bucket 'nominations'."""
    try:
        from api._lib.database import supabase

        bucket_name = "nominations"
        ext = Path(file_path).suffix
        storage_path = f"{base_name}{ext}"

        with open(file_path, "rb") as f:
            file_bytes = f.read()

        content_type = "application/pdf" if ext == ".pdf" else \
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

        # Upload (upsert to overwrite if exists)
        supabase.storage.from_(bucket_name).upload(
            storage_path, file_bytes,
            file_options={"content-type": content_type, "upsert": "true"},
        )

        # Get public URL
        public_url = supabase.storage.from_(bucket_name).get_public_url(storage_path)
        return public_url

    except Exception:
        # Storage not configured or bucket doesn't exist — that's OK
        return None


def _build_replacements(template_key: str, data: dict) -> dict:
    game_dates_str = _format_game_dates(data.get("game_dates", []))

    if template_key in ("WCQ", "GENERIC"):
        return {
            "{{NOMINEE_NAME}}": data.get("nominee_name", ""),
            "{{LETTER_DATE}}": data.get("letter_date", ""),
            "{{GAME_DATES}}": game_dates_str,
            "{{CONFIRMATION_DEADLINE}}": data.get("confirmation_deadline", ""),
            "{{PER_GAME_FEE}}": _fmt_currency(data.get("window_fee")),
            "{{INCIDENTALS}}": _fmt_currency(data.get("incidentals")),
            "{{TOTAL}}": _fmt_currency(data.get("total")),
        }
    elif template_key == "BCLA":
        return {
            "{{NOMINEE_NAME}}": data.get("nominee_name", ""),
            "{{LETTER_DATE}}": data.get("letter_date", ""),
            "{{COMPETITION_NAME}}": data.get("competition_name", ""),
            "{{LOCATION}}": data.get("location", ""),
            "{{VENUE}}": data.get("venue", ""),
            "{{ARRIVAL_DATE}}": data.get("arrival_date", ""),
            "{{GAME_DATES}}": game_dates_str,
            "{{DEPARTURE_DATE}}": data.get("departure_date", ""),
            "{{WINDOW_FEE}}": _fmt_currency(data.get("window_fee")),
            "{{INCIDENTALS}}": _fmt_currency(data.get("incidentals")),
            "{{TOTAL}}": _fmt_currency(data.get("total")),
        }
    elif template_key == "LSB":
        return {
            "{{NOMINEE_NAME}}": data.get("nominee_name", ""),
            "{{LETTER_DATE}}": data.get("letter_date", ""),
            "{{COMPETITION_YEAR}}": str(data.get("competition_year", "")),
            "{{LOCATION}}": data.get("location", ""),
            "{{VENUE}}": data.get("venue", ""),
            "{{ARRIVAL_DATE}}": data.get("arrival_date", ""),
            "{{GAME_DATES}}": game_dates_str,
            "{{DEPARTURE_DATE}}": data.get("departure_date", ""),
            "{{WINDOW_FEE}}": _fmt_currency(data.get("window_fee")),
            "{{INCIDENTALS}}": _fmt_currency(data.get("incidentals")),
            "{{TOTAL}}": _fmt_currency(data.get("total")),
        }
    return {}


def _format_game_dates(game_dates: list) -> str:
    if not game_dates:
        return ""
    lines = []
    for gd in game_dates:
        label = gd.get("label", "")
        date = gd.get("date", "")
        lines.append(f"{label}: {date}" if label else date)
    return "\n".join(lines)


def _fmt_currency(val) -> str:
    if val is None:
        return ""
    try:
        return f"USD {float(val):,.2f}"
    except (ValueError, TypeError):
        return str(val)


def _replace_in_paragraph(paragraph, replacements: dict):
    full_text = "".join(run.text for run in paragraph.runs)
    if not any(key in full_text for key in replacements):
        return

    for key, value in replacements.items():
        if key in full_text:
            full_text = full_text.replace(key, str(value))

    if paragraph.runs:
        paragraph.runs[0].text = full_text
        for run in paragraph.runs[1:]:
            run.text = ""
