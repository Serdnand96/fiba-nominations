"""Letter templates: catalog + on-the-fly sample preview.

The catalog used to live hardcoded in src/pages/Templates.jsx and had drifted
from reality (it listed .docx filenames that no longer exist). It now lives
here, next to the generator that is the actual source of truth.
"""
import logging
import shutil

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from api._lib.auth import require_edit, require_view
from api._lib.services import template_store
from api._lib.services.document_generator import (
    SIGNATORIES,
    TEMPLATES_DIR,
    generate_preview,
    generate_preview_from_bytes,
    validate_template,
)

DOCX_MIME = ("application/vnd.openxmlformats-officedocument"
             ".wordprocessingml.document")
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/templates", tags=["templates"])

# Template keys offered in the UI. BCLA auto-detects its F4/RS variant from the
# game labels, so BCLA_F4 / BCLA_RS are not listed separately.
#
# base_file is the *_TPL.docx that actually drives generation — the placeholder
# template, not the original positional skeleton it was derived from. That is
# the file a future upload would replace.
TEMPLATES = [
    {"key": "WCQ", "base_file": "WCQ_TEMPLATE_TPL.docx", "type": "nomination"},
    {"key": "BCLA", "base_file": "BCLA_TEMPLATE_TPL.docx", "type": "confirmation"},
    {"key": "LSB", "base_file": "LSB_TEMPLATE_TPL.docx", "type": "confirmation"},
    {"key": "GENERIC", "base_file": "GENERIC_TEMPLATE_TPL.docx", "type": "nomination"},
]


@router.get("", dependencies=[Depends(require_view("templates"))])
def list_templates():
    """Catalog of letter templates, with the signatory each one is signed by."""
    out = []
    for tmpl in TEMPLATES:
        key = tmpl["key"]
        name, title, org = SIGNATORIES.get(key, ("", "", ""))
        base_file = tmpl["base_file"]
        out.append({
            **tmpl,
            "base_file_present": bool(base_file) and (TEMPLATES_DIR / base_file).exists(),
            # Whether this key is currently served by an uploaded file rather
            # than the one shipped in the repo, and whether an upload is
            # waiting for the user to confirm its preview.
            "custom": template_store.has_custom(key),
            "staged": template_store.has_staged(key),
            "signatory": ", ".join(p for p in (name, title, org) if p),
        })
    return out


def _known_key(template_key: str) -> None:
    if not any(t["key"] == template_key for t in TEMPLATES):
        raise HTTPException(status_code=404, detail="Unknown template")


@router.post("/{template_key}/upload", dependencies=[Depends(require_edit("templates"))])
async def upload_template(template_key: str, file: UploadFile = File(...)):
    """Accept a candidate .docx, validate it, and stage it for confirmation.

    Staging rather than activating is the point: the file is only usable once
    the user has looked at the preview it produces. Nothing here touches the
    template that is currently generating letters.
    """
    _known_key(template_key)

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")
    if not (file.filename or "").lower().endswith(".docx"):
        raise HTTPException(status_code=400, detail="Only .docx files are accepted")

    result = validate_template(template_key, data)
    if not result["ok"]:
        raise HTTPException(status_code=400, detail=result["error"])

    try:
        template_store.stage(template_key, data)
    except Exception:
        logger.exception("Staging upload failed for %s", template_key)
        raise HTTPException(status_code=500, detail="Could not store the upload.")

    return {
        "staged": True,
        "filename": file.filename,
        # Placeholders the letter data can't fill: they render empty rather
        # than failing, so they are a warning, not a rejection.
        "unknown_placeholders": result["unknown"],
        # Values available to the template that it doesn't use — usually means
        # the author dropped a field by accident.
        "unused_placeholders": result["unused"],
    }


@router.post("/{template_key}/activate", dependencies=[Depends(require_edit("templates"))])
def activate_template(template_key: str):
    """Promote the staged upload so it starts generating real letters."""
    _known_key(template_key)
    if not template_store.activate(template_key):
        raise HTTPException(status_code=404, detail="Nothing staged for this template")
    return {"active": True, "custom": True}


@router.delete("/{template_key}/staged", dependencies=[Depends(require_edit("templates"))])
def discard_staged_template(template_key: str):
    """Throw away a staged upload without activating it."""
    _known_key(template_key)
    template_store.discard_staged(template_key)
    return {"staged": False}


@router.delete("/{template_key}/custom", dependencies=[Depends(require_edit("templates"))])
def revert_template(template_key: str):
    """Drop the uploaded template and go back to the one shipped in the repo."""
    _known_key(template_key)
    template_store.remove_custom(template_key)
    return {"custom": False}


@router.get("/{template_key}/preview", dependencies=[Depends(require_view("templates"))])
def preview_template(template_key: str, staged: bool = False):
    """Render a sample letter for this template and serve it inline.

    Generated on every request with fictional data — nothing is persisted and
    no nomination is touched. With `staged=true` it renders the pending upload
    instead of the active template, which is what the user confirms before
    activating.
    """
    _known_key(template_key)

    try:
        if staged:
            data = template_store.staged_bytes(template_key)
            if data is None:
                raise HTTPException(status_code=404, detail="Nothing staged for this template")
            path, temp_dir, conversion_error = generate_preview_from_bytes(template_key, data)
        else:
            path, temp_dir, conversion_error = generate_preview(template_key)
    except HTTPException:
        raise
    except Exception:
        # Log the cause server-side; the client only gets a generic message.
        logger.exception("Template preview failed for %s (staged=%s)", template_key, staged)
        raise HTTPException(status_code=500, detail="Preview generation failed. Please try again.")

    # Drop the temp dir once the file has been streamed out.
    cleanup = BackgroundTask(shutil.rmtree, temp_dir, ignore_errors=True)

    is_pdf = path.endswith(".pdf")
    if conversion_error and not is_pdf:
        # LibreOffice is unavailable — fall back to the .docx so the user still
        # gets something, but flag it so the client can explain the download.
        return FileResponse(
            path,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename=f"{template_key}_preview.docx",
            headers={"X-Conversion-Error": conversion_error[:200]},
            background=cleanup,
        )

    return FileResponse(
        path,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{template_key}_preview.pdf"'},
        background=cleanup,
    )
