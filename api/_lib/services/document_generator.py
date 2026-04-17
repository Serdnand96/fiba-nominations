"""
Document generator adapter.

Wraps the WeasyPrint-based PDFGenerator to maintain the same interface
that the nominations router expects:
    generate_nomination(nom_data) -> (local_path, storage_url, conversion_error)

Replaces the old python-docx + CloudConvert pipeline with local HTML→PDF
rendering via WeasyPrint + Jinja2.
"""
from __future__ import annotations

import logging
import re
import tempfile
from datetime import datetime
from pathlib import Path

from api._lib.services.pdf.pdf_generator import PDFGenerator
from api._lib.services.pdf.pdf_storage import upload_pdf_sync

logger = logging.getLogger(__name__)

OUTPUT_DIR = Path(tempfile.gettempdir()) / "fiba_generated"

# ── Signatories per template ─────────────────────────────────────────────────
SIGNATORIES = {
    "WCQ":     ("Carlos Alves",  "Executive Director"),
    "GENERIC": ("Carlos Alves",  "Executive Director"),
    "BCLA":    ("Gino Rullo",    "Head of Operations"),
    "BCLA_F4": ("Gino Rullo",    "Head of Operations"),
    "BCLA_RS": ("Gino Rullo",    "Head of Operations"),
    "LSB":     ("Gino Rullo",    "Head of Operations"),
}

ROLE_LABELS = {
    "VGO": "Video Graphic Operator",
    "TD":  "Technical Delegate",
}

_pdf_gen = PDFGenerator()


# ── Helpers ──────────────────────────────────────────────────────────────────

def _fmt_date(date_str: str) -> str:
    """Convert ISO date (2026-04-17) to readable format (April 17, 2026)."""
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
    except (ValueError, TypeError):
        return date_str


def _format_competition_dates(game_dates: list[dict]) -> str:
    """Convert list of {label, date} dicts to a readable date range string."""
    if not game_dates:
        return ""
    dates = [gd.get("date", "") for gd in game_dates if gd.get("date")]
    if not dates:
        return ""
    dates.sort()
    if len(dates) == 1:
        return _fmt_date(dates[0])
    return f"{_fmt_date(dates[0])} – {_fmt_date(dates[-1])}"


def _format_location(nom_data: dict) -> str:
    """Build location string from location + venue fields."""
    parts = []
    if nom_data.get("location"):
        parts.append(nom_data["location"])
    if nom_data.get("venue"):
        parts.append(nom_data["venue"])
    return ", ".join(parts) if parts else ""


def _resolve_template_key(template_key: str, game_dates: list[dict]) -> str:
    """Handle bare 'BCLA' auto-detection and normalize."""
    if template_key == "BCLA":
        f4_labels = {"Semifinals", "3rd Place", "Final"}
        has_f4 = any(gd.get("label") in f4_labels for gd in (game_dates or []))
        return "BCLA_F4" if has_f4 else "BCLA_RS"
    return template_key


# ── Main entry point ─────────────────────────────────────────────────────────

def generate_nomination(nomination_data: dict) -> tuple[str, str | None, str | None]:
    """
    Generate a nomination/confirmation PDF letter.
    Returns (local_path, storage_url, conversion_error).
    conversion_error is always None since PDF is generated natively.
    """
    template_key = _resolve_template_key(
        nomination_data["template_key"],
        nomination_data.get("game_dates", []),
    )

    sig_name, sig_title = SIGNATORIES.get(template_key, SIGNATORIES["GENERIC"])
    role_code = nomination_data.get("role", "TD")
    role_label = ROLE_LABELS.get(role_code, role_code)

    # Build the context for PDFGenerator
    pdf_bytes = _pdf_gen.nomination_letter(
        competition_name=nomination_data.get("competition_name", ""),
        competition_dates=_format_competition_dates(nomination_data.get("game_dates", [])),
        competition_location=_format_location(nomination_data),
        personnel_name=nomination_data.get("nominee_name", ""),
        personnel_role=role_label,
        personnel_email=nomination_data.get("personnel_email", ""),
        personnel_country=nomination_data.get("personnel_country", ""),
        signatory_name=sig_name,
        signatory_title=sig_title,
        nomination_date=_fmt_date(nomination_data.get("letter_date", "")),
        template_type=template_key,
        language=nomination_data.get("language", "en"),
    )

    # Write to temp file (dev/local fallback)
    name_clean = re.sub(r"[^\w\s-]", "", nomination_data.get("nominee_name", "")).strip()
    comp_clean = re.sub(r"[^\w\s-]", "", nomination_data.get("competition_name", "")).strip()
    base_name = f"{name_clean} {comp_clean} Nomination"

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    local_path = str(OUTPUT_DIR / f"{base_name}.pdf")
    Path(local_path).write_bytes(pdf_bytes)

    # Upload to Supabase Storage
    storage_url = None
    try:
        storage_url = upload_pdf_sync(
            pdf_bytes,
            filename=f"{base_name}.pdf",
            bucket="nominations",
        )
    except Exception as e:
        logger.error("Storage upload failed: %s", e)
        import traceback
        traceback.print_exc()

    return local_path, storage_url, None
