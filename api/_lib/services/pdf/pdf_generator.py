# DEPLOYMENT NOTES — WeasyPrint on Vercel
# 1. System packages required in vercel.json:
#      libpango-1.0-0, libpangoft2-1.0-0, libpangocairo-1.0-0,
#      libgdk-pixbuf2.0-0, libffi-dev, shared-mime-info, fonts-liberation
# 2. All fonts and logos must be embedded as base64 — no external HTTP requests
# 3. Vercel function memory: set to 1024MB in vercel.json for complex documents
# 4. CLOUDCONVERT_API_KEY is no longer needed — remove from Vercel dashboard and .env
# 5. Timeout: set maxDuration to 30s for bulk PDF generation in vercel.json

from __future__ import annotations

import base64
import logging
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

from jinja2 import Environment, FileSystemLoader, select_autoescape
from weasyprint import HTML
from weasyprint.text.fonts import FontConfiguration

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# ── Paths ────────────────────────────────────────────────────────────────────
# From api/_lib/services/pdf/ -> api/templates/pdf/
_TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent.parent / "templates" / "pdf"
_ASSETS_DIR    = Path(__file__).resolve().parent.parent.parent.parent / "assets"

_VALID_NOMINATION_TYPES = {"WCQ", "BCLA_F4", "BCLA_RS", "LSB", "GENERIC"}


def _css_string_escape(value: Any) -> str:
    """
    Sanitize a value for inclusion inside a CSS string literal (e.g. the
    content property of an @page rule). Removes characters that would break
    out of the quoted string or inject new declarations.
    """
    if value is None:
        return ""
    s = str(value)
    for ch in ('"', "\\", "\n", "\r"):
        s = s.replace(ch, "")
    return s


# ── Jinja2 environment ────────────────────────────────────────────────────────
from .pdf_translations import t as _translate  # noqa: E402

_jinja_env = Environment(
    loader=FileSystemLoader(str(_TEMPLATES_DIR)),
    autoescape=select_autoescape(["html"]),
)
_jinja_env.filters["css_str"] = _css_string_escape
_jinja_env.globals["t"] = _translate


# ── Logo loader ───────────────────────────────────────────────────────────────
def _load_logo_base64() -> str | None:
    """
    Looks for the FIBA Americas logo in common locations within the project.
    Returns base64-encoded string or None if not found.
    Embed as base64 to avoid external HTTP requests in serverless environment.
    """
    candidates = [
        _ASSETS_DIR / "fiba_americas_logo.png",
        _ASSETS_DIR / "logo.png",
        Path(__file__).parent.parent.parent / "public" / "logo.png",
        Path(__file__).parent.parent.parent / "public" / "fiba_americas_logo.png",
        Path(__file__).parent.parent.parent / "src" / "assets" / "logo.png",
    ]
    for path in candidates:
        if path.exists():
            with open(path, "rb") as f:
                return base64.b64encode(f.read()).decode("utf-8")
    logger.warning("PDFGenerator: logo file not found in any candidate path.")
    return None


# ── Helpers ───────────────────────────────────────────────────────────────────
def _format_generated_at(language: str) -> str:
    now = datetime.now(timezone.utc)
    if language == "es":
        return now.strftime("Generado el %d/%m/%Y a las %H:%M UTC")
    return now.strftime("Generated on %Y-%m-%d at %H:%M UTC")


# ── Main class ────────────────────────────────────────────────────────────────
class PDFGenerator:
    """
    Drop-in replacement for the CloudConvert-based PDF generation pipeline.

    Usage:
        gen = PDFGenerator()

        # Generate bytes only
        pdf_bytes = gen.generate("nomination_letter", context, language="en")

        # Generate + upload to Supabase Storage (returns public URL)
        url = await gen.generate_and_upload(
            template_name="nomination_letter",
            context=context,
            filename="NOM_001.pdf",
            bucket="nominations",
            language="en"
        )
    """

    def __init__(self, logo_base64: str | None = None) -> None:
        self._font_config = FontConfiguration()
        # Prefer explicit logo from caller; otherwise try filesystem once.
        self._logo_base64 = logo_base64 if logo_base64 is not None else _load_logo_base64()

    def _base_context(self, language: str, competition_name: str = "") -> dict:
        return {
            "language": language,
            "logo_base64": self._logo_base64,
            "generated_at": _format_generated_at(language),
            "competition_name": competition_name,
        }

    # ── Core render ───────────────────────────────────────────────────────────
    def generate(
        self,
        template_name: str,
        context: dict[str, Any],
        language: str = "en",
    ) -> bytes:
        """
        Renders template_name.html with context and returns raw PDF bytes.
        Raises ValueError on unknown template, RuntimeError on render failure.
        """
        template_file = f"{template_name}.html"
        try:
            template = _jinja_env.get_template(template_file)
        except Exception as exc:
            raise ValueError(
                f"PDFGenerator: template '{template_file}' not found "
                f"in {_TEMPLATES_DIR}"
            ) from exc

        # Caller context first, then base context on top, so caller cannot
        # override logo_base64, generated_at, or language.
        full_context = {
            **context,
            **self._base_context(language, context.get("competition_name", "")),
        }

        try:
            html_string = template.render(**full_context)
        except Exception as exc:
            raise RuntimeError(
                f"PDFGenerator: Jinja2 render failed for '{template_name}': {exc}"
            ) from exc

        try:
            pdf_bytes = (
                HTML(string=html_string, base_url=str(_TEMPLATES_DIR))
                .write_pdf(font_config=self._font_config)
            )
        except Exception as exc:
            raise RuntimeError(
                f"PDFGenerator: WeasyPrint failed for '{template_name}': {exc}"
            ) from exc

        return pdf_bytes

    # ── Convenience factories per document type ───────────────────────────────
    def nomination_letter(
        self,
        *,
        competition_name: str,
        competition_dates: str,
        competition_location: str,
        personnel_name: str,
        personnel_role: str,
        personnel_email: str,
        personnel_country: str,
        signatory_name: str,
        signatory_title: str,
        nomination_date: str,
        template_type: str = "GENERIC",
        language: str = "en",
    ) -> bytes:
        normalized_type = (template_type or "").upper()
        if normalized_type not in _VALID_NOMINATION_TYPES:
            logger.warning(
                "PDFGenerator: unknown template_type %r, falling back to GENERIC. "
                "Expected one of %s.",
                template_type, sorted(_VALID_NOMINATION_TYPES),
            )
            normalized_type = "GENERIC"

        context = {
            "competition_name": competition_name,
            "competition_dates": competition_dates,
            "competition_location": competition_location,
            "personnel_name": personnel_name,
            "personnel_role": personnel_role,
            "personnel_email": personnel_email,
            "personnel_country": personnel_country,
            "signatory_name": signatory_name,
            "signatory_title": signatory_title,
            "nomination_date": nomination_date,
            "template_type": normalized_type,
        }
        return self.generate("nomination_letter", context, language)

    def training_schedule(
        self,
        *,
        competition_name: str,
        export_type: str,
        filter_label: str,
        slots: list[dict],
        language: str = "en",
    ) -> bytes:
        # Sort so that the "competition" view's date grouping produces one
        # group-header per date, even if callers pass slots unsorted.
        sorted_slots = sorted(
            slots,
            key=lambda s: (s.get("date", ""), s.get("start_time", "")),
        )
        context = {
            "competition_name": competition_name,
            "export_type": export_type,
            "filter_label": filter_label,
            "slots": sorted_slots,
        }
        return self.generate("training_schedule", context, language)

    def availability_report(
        self,
        *,
        competition_name: str,
        rows: list[dict],
        language: str = "en",
    ) -> bytes:
        context = {
            "competition_name": competition_name,
            "rows": rows,
        }
        return self.generate("availability_report", context, language)

    def generic_table(
        self,
        *,
        title: str,
        columns: list[str],
        rows: list[list],
        subtitle: str = "",
        competition_name: str = "",
        language: str = "en",
    ) -> bytes:
        context = {
            "title": title,
            "subtitle": subtitle,
            "columns": columns,
            "rows": rows,
            "competition_name": competition_name,
        }
        return self.generate("generic_table", context, language)


# ── Module-level singleton ────────────────────────────────────────────────────
pdf_generator = PDFGenerator()
