"""Letter templates: catalog + on-the-fly sample preview.

The catalog used to live hardcoded in src/pages/Templates.jsx and had drifted
from reality (it listed .docx filenames that no longer exist). It now lives
here, next to the generator that is the actual source of truth.
"""
import logging
import re
import shutil

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask

from api._lib.auth import has_view, require_edit, require_view
from api._lib.database import supabase
from api._lib.schemas import LetterTemplateCreate
from api._lib.services import template_store
from api._lib.services.document_generator import (
    SIGNATORIES,
    TEMPLATES_DIR,
    custom_type,
    fonts_report,
    generate_preview,
    generate_preview_for_data,
    placeholders_for,
    template_path,
    generate_preview_from_bytes,
    validate_template,
)

# Keys the generator dispatches on directly, beyond the four listed below.
RESERVED_KEYS = {"BCLA_F4", "BCLA_RS"}

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

# Human labels for the catalog — "WCQ" alone means nothing to someone who
# didn't build this module.
TEMPLATE_LABELS = {
    "WCQ": "WCQ — World Cup Qualifiers",
    "BCLA": "BCLA — Basketball Champions League Americas",
    "LSB": "LSB — Liga Sudamericana",
    "GENERIC": "GENERIC — FIBA Americas",
}

# A competition picks "BCLA Final 4" or "BCLA Regular Season" in the
# Competencias form (src/pages/Competitions.jsx), which sets
# competitions.template_key to BCLA_F4 or BCLA_RS directly — but both render
# from the same file, BCLA_TEMPLATE_TPL.docx (TEMPLATE_SPECS["BCLA"] in
# document_generator.py; BCLA_F4/BCLA_RS aren't separate entries there).
# Listed here so the catalog is honest that uploading/editing "BCLA" changes
# the letter both variants produce.
BCLA_VARIANTS = ["BCLA_F4", "BCLA_RS"]


@router.get("", dependencies=[Depends(require_view("templates"))])
def list_templates():
    """Catalog of letter templates, with the signatory each one is signed by."""
    out = []
    for tmpl in TEMPLATES:
        key = tmpl["key"]
        name, title, org = SIGNATORIES.get(key, ("", "", ""))
        base_file = tmpl["base_file"]
        active_path = template_path(key)
        entry = {
            **tmpl,
            "label": TEMPLATE_LABELS.get(key, key),
            "built_in": True,
            "base_file_present": bool(base_file) and (TEMPLATES_DIR / base_file).exists(),
            # Whether this key is currently served by an uploaded file rather
            # than the one shipped in the repo, and whether an upload is
            # waiting for the user to confirm its preview.
            "custom": template_store.has_custom(key),
            "staged": template_store.has_staged(key),
            "signatory": ", ".join(p for p in (name, title, org) if p),
            "placeholders": placeholders_for(key),
            # What the letter will actually print as once LibreOffice
            # converts it on the droplet — see fonts_report()'s docstring.
            "fonts": fonts_report(active_path) if active_path else [],
        }
        if key == "BCLA":
            entry["variants"] = BCLA_VARIANTS
        out.append(entry)

    # Types created from the UI. They have no file in the repo, so until one is
    # uploaded and activated they can't generate anything — base_file_present
    # is False and the page shows that.
    try:
        rows = supabase.table("letter_templates").select("*").execute().data or []
    except Exception:
        logger.exception("Could not list letter_templates")
        rows = []

    for row in sorted(rows, key=lambda r: r["key"]):
        key = row["key"]
        # A custom type with nothing uploaded yet has no file to check —
        # fonts_report() would otherwise have to special-case "no path".
        active_path = template_path(key)
        out.append({
            "key": key,
            "label": row.get("label") or key,
            "base_file": None,
            "type": "nomination" if row["kind"] == "nomination" else "confirmation",
            "kind": row["kind"],
            "built_in": False,
            "base_file_present": False,
            "custom": template_store.has_custom(key),
            "staged": template_store.has_staged(key),
            "signatory": ", ".join(p for p in (
                row.get("signatory_name") or "",
                row.get("signatory_title") or "",
                row.get("signatory_org") or "") if p),
            "placeholders": placeholders_for(key),
            "fonts": fonts_report(active_path) if active_path else [],
        })
    return out


def _known_key(template_key: str) -> None:
    """Built-in keys and types created from the UI are both valid."""
    if any(t["key"] == template_key for t in TEMPLATES):
        return
    if custom_type(template_key):
        return
    raise HTTPException(status_code=404, detail="Unknown template")


@router.post("", dependencies=[Depends(require_edit("templates"))])
def create_template_type(payload: LetterTemplateCreate):
    """Register a template type for an event the built-ins don't cover.

    This only creates the entry — the .docx still has to be uploaded and
    activated before the type can generate anything.
    """
    key = payload.key.strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,31}", key):
        raise HTTPException(
            status_code=400,
            detail="Key must be 2-32 chars: A-Z, 0-9 and _, starting with a letter")
    if any(t["key"] == key for t in TEMPLATES) or key in RESERVED_KEYS:
        raise HTTPException(status_code=400, detail=f"{key} is a built-in template")
    if custom_type(key):
        raise HTTPException(status_code=400, detail=f"{key} already exists")
    if payload.kind not in ("nomination", "confirmation"):
        # The DB has the same CHECK; catching it here gives a usable message
        # instead of a 500 from the constraint violation.
        raise HTTPException(status_code=400,
                            detail="kind must be 'nomination' or 'confirmation'")

    row = {
        "key": key,
        "label": payload.label.strip() or key,
        "kind": payload.kind,
        "signatory_name": (payload.signatory_name or "").strip(),
        "signatory_title": (payload.signatory_title or "").strip(),
        "signatory_org": (payload.signatory_org or "").strip(),
    }
    supabase.table("letter_templates").insert(row).execute()
    return row


class DuplicateTemplateRequest(BaseModel):
    """Not in schemas.py: this is templates.py's own request shape, not a
    persisted row — LetterTemplateCreate in schemas.py is close but requires
    `kind`, which duplication takes from the origin instead of the caller."""
    key: str
    label: str
    signatory_name: str | None = None
    signatory_title: str | None = None
    signatory_org: str | None = None


@router.post("/{template_key}/duplicate", dependencies=[Depends(require_edit("templates"))])
def duplicate_template(template_key: str, payload: DuplicateTemplateRequest):
    """Create a new template type by copying an existing one's active .docx.

    The problem this solves: designing a template from nothing means writing
    Jinja tags in Word by hand, and the starter STARTER_FOR_KIND hands a
    brand-new type is blank (or generic FIBA Americas letterhead) — not a
    real letter. "I need this exact letter for a different signatory" (a
    second WCQ-shaped nomination, a BCLA-shaped confirmation for another
    league) is common enough that copying beats re-authoring: the new type's
    starting file is the origin's real, working, already-placeholder-tagged
    `.docx`, active immediately, no staging step required.

    `kind` isn't in the request body: it comes from the origin (a built-in's
    fixed `type`, a custom type's stored `kind`) since the new type has to
    render through the same context shape (see spec_for()) as whatever it
    was copied from. The signatory is the body's if given, the origin's
    otherwise — either as a whole, not merged field by field.
    """
    _known_key(template_key)

    new_key = payload.key.strip().upper()
    if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,31}", new_key):
        raise HTTPException(
            status_code=400,
            detail="Key must be 2-32 chars: A-Z, 0-9 and _, starting with a letter")
    if any(t["key"] == new_key for t in TEMPLATES) or new_key in RESERVED_KEYS:
        raise HTTPException(status_code=400, detail=f"{new_key} is a built-in template")
    if custom_type(new_key):
        raise HTTPException(status_code=400, detail=f"{new_key} already exists")

    origin_docx = template_path(template_key)
    if not origin_docx:
        raise HTTPException(
            status_code=400,
            detail="Origin template has no active file to copy")

    built_in = next((t for t in TEMPLATES if t["key"] == template_key), None)
    origin_row = None if built_in else custom_type(template_key)
    kind = built_in["type"] if built_in else origin_row["kind"]

    if payload.signatory_name is None and payload.signatory_title is None \
            and payload.signatory_org is None:
        if built_in:
            sig_name, sig_title, sig_org = SIGNATORIES.get(template_key, ("", "", ""))
        else:
            sig_name = origin_row.get("signatory_name") or ""
            sig_title = origin_row.get("signatory_title") or ""
            sig_org = origin_row.get("signatory_org") or ""
    else:
        sig_name = payload.signatory_name or ""
        sig_title = payload.signatory_title or ""
        sig_org = payload.signatory_org or ""

    row = {
        "key": new_key,
        "label": payload.label.strip() or new_key,
        "kind": kind,
        "signatory_name": sig_name.strip(),
        "signatory_title": sig_title.strip(),
        "signatory_org": sig_org.strip(),
    }
    supabase.table("letter_templates").insert(row).execute()

    # Straight to active, not staged: the copied file already renders (it's
    # the origin's real, currently-serving template), so there is nothing for
    # a staged-preview confirmation step to catch that a fresh upload's
    # validate_template() doesn't already guarantee for the original.
    data = origin_docx.read_bytes()
    template_store.stage(new_key, data)
    template_store.activate(new_key)

    return row


@router.delete("/{template_key}", dependencies=[Depends(require_edit("templates"))])
def delete_template_type(template_key: str):
    """Remove a UI-created type and the files it had in Storage."""
    if any(t["key"] == template_key for t in TEMPLATES):
        raise HTTPException(status_code=400, detail="Built-in templates cannot be deleted")
    if not custom_type(template_key):
        raise HTTPException(status_code=404, detail="Unknown template")

    in_use = (supabase.table("competitions")
              .select("id, name").eq("template_key", template_key).execute().data)
    if in_use:
        names = ", ".join(c["name"] for c in in_use[:3])
        raise HTTPException(
            status_code=400,
            detail=f"In use by {len(in_use)} competition(s): {names}")

    template_store.discard_staged(template_key)
    template_store.remove_custom(template_key)
    supabase.table("letter_templates").delete().eq("key", template_key).execute()
    return {"deleted": True}


# A brand-new type has no file of its own, so its starting point is a built-in
# template of the same shape, already carrying the placeholders: the user
# restyles it in Word instead of authoring the tags from scratch.
#
# The two starters differ on purpose. The nomination one is the FIBA Americas
# letterhead, which is the right paper for a type that has none of its own.
# The confirmation one is deliberately BLANK PAPER: it used to be
# LSB_TEMPLATE_TPL.docx, and now that LSB prints on the Liga Sudamericana
# letterhead, handing it over would stamp that logo — and Gino Rullo's signature
# block — on somebody else's competition. GENERIC_CONFIRMATION_TPL.docx is the
# same shape with nothing on the page but the tags.
STARTER_FOR_KIND = {
    "nomination": "GENERIC_TEMPLATE_TPL.docx",
    "confirmation": "GENERIC_CONFIRMATION_TPL.docx",
}


@router.get("/{template_key}/file", dependencies=[Depends(require_view("templates"))])
def download_template_file(template_key: str):
    """Download the .docx to edit in Word.

    For a template that has a file (built-in or uploaded) this is that file.
    For a type created from the UI that hasn't been given one yet, it's the
    starter for its shape — otherwise there is no way to learn what
    placeholders the letter needs.
    """
    _known_key(template_key)

    path = template_path(template_key)
    name = f"{template_key}.docx"

    if path is None:
        row = custom_type(template_key)
        starter = STARTER_FOR_KIND.get((row or {}).get("kind", "nomination"))
        candidate = TEMPLATES_DIR / starter if starter else None
        if not candidate or not candidate.exists():
            raise HTTPException(status_code=404, detail="No file available for this template")
        path = candidate
        name = f"{template_key}_starter.docx"

    return FileResponse(path, media_type=DOCX_MIME, filename=name)


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
        # Checked against the candidate bytes, not the (still active) file on
        # disk — this is what the letter would print as if activated.
        "fonts": fonts_report(data),
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
def preview_template(template_key: str, request: Request, staged: bool = False,
                     nomination_id: str | None = None):
    """Render a letter for this template and serve it inline.

    By default, and with `staged=true`, this is fictional PREVIEW_SAMPLE data
    — nothing is persisted and no nomination is touched. With
    `nomination_id`, it renders that REAL nomination's data through this
    template instead — "what would this person's letter look like on a
    different template" — which needs an extra permission check below, since
    unlike the sample letter it reads someone's actual assignment. Still
    nothing is persisted: no Storage upload, no write to the nomination row,
    same as the sample-data path.
    """
    _known_key(template_key)

    if nomination_id is not None and not has_view(request, "nominations"):
        # templates:view alone (the router-level dependency) isn't enough
        # once real nomination data is involved — same reasoning as any other
        # cross-module read. has_view(), not require_view(), because this
        # only has to gate the nomination_id branch, not the whole endpoint.
        raise HTTPException(status_code=403, detail="Missing nominations:view permission")

    try:
        if nomination_id is not None:
            from api._lib.routers.nominations import letter_data_for

            rows = (supabase.table("nominations")
                    .select("*, personnel(name, role, email), "
                            "competitions(name, template_key, year, fee_type)")
                    .eq("id", nomination_id).execute().data)
            if not rows:
                raise HTTPException(status_code=404, detail="Nomination not found")
            data = letter_data_for(rows[0])
            data["template_key"] = template_key
            path, temp_dir, conversion_error = generate_preview_for_data(data)
        elif staged:
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
        logger.exception("Template preview failed for %s (staged=%s, nomination_id=%s)",
                         template_key, staged, nomination_id)
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
