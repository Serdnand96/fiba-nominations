"""Letter templates: catalog + on-the-fly sample preview.

The catalog used to live hardcoded in src/pages/Templates.jsx and had drifted
from reality (it listed .docx filenames that no longer exist). It now lives
here, next to the generator that is the actual source of truth.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from api._lib.auth import require_view
from api._lib.services.document_generator import (
    SIGNATORIES,
    TEMPLATES_DIR,
    generate_preview,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/templates", tags=["templates"])

# Template keys offered in the UI. BCLA auto-detects its F4/RS variant from the
# game labels, so BCLA_F4 / BCLA_RS are not listed separately.
TEMPLATES = [
    {"key": "WCQ", "base_file": "WCQ_TEMPLATE.docx", "type": "nomination"},
    {"key": "BCLA", "base_file": "BCLA_TEMPLATE.docx", "type": "confirmation"},
    {"key": "LSB", "base_file": None, "type": "confirmation"},
    {"key": "GENERIC", "base_file": "GENERIC_TEMPLATE.docx", "type": "nomination"},
]


@router.get("", dependencies=[Depends(require_view("templates"))])
def list_templates():
    """Catalog of letter templates, with the signatory each one is signed by."""
    out = []
    for tmpl in TEMPLATES:
        name, title, org = SIGNATORIES.get(tmpl["key"], ("", "", ""))
        base_file = tmpl["base_file"]
        out.append({
            **tmpl,
            # LSB is built entirely in code — there is no base .docx on disk.
            "built_from_code": base_file is None,
            "base_file_present": bool(base_file) and (TEMPLATES_DIR / base_file).exists(),
            "signatory": ", ".join(p for p in (name, title, org) if p),
        })
    return out


@router.get("/{template_key}/preview", dependencies=[Depends(require_view("templates"))])
def preview_template(template_key: str):
    """Render a sample letter for this template and serve it inline.

    Generated on every request with fictional data — nothing is persisted and
    no nomination is touched.
    """
    if not any(t["key"] == template_key for t in TEMPLATES):
        raise HTTPException(status_code=404, detail="Unknown template")

    try:
        path, conversion_error = generate_preview(template_key)
    except Exception:
        # Log the cause server-side; the client only gets a generic message.
        logger.exception("Template preview failed for %s", template_key)
        raise HTTPException(status_code=500, detail="Preview generation failed. Please try again.")

    is_pdf = path.endswith(".pdf")
    if conversion_error and not is_pdf:
        # LibreOffice is unavailable — fall back to the .docx so the user still
        # gets something, but flag it so the client can explain the download.
        return FileResponse(
            path,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename=f"{template_key}_preview.docx",
            headers={"X-Conversion-Error": conversion_error[:200]},
        )

    return FileResponse(
        path,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{template_key}_preview.pdf"'},
    )
