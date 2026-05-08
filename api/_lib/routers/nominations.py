import os
import re
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel
from typing import Optional
from api._lib.database import supabase
from api._lib.auth import require_view, require_edit
from api._lib.schemas import NominationCreate, BulkNominationCreate
from api._lib.services.document_generator import generate_nomination

router = APIRouter(prefix="/nominations", tags=["nominations"], dependencies=[Depends(require_view("nominations"))])

_MAX_BULK = 100
_SAFE_FILENAME_RE = re.compile(r'[^\w\s\-\.\(\)]')
_VALID_CONFIRMATION_STATUSES = {"pending", "nominated", "confirmed", "declined"}


class ConfirmationUpdate(BaseModel):
    status: str
    notes: Optional[str] = None


@router.get("")
def list_nominations():
    result = supabase.table("nominations").select(
        "*, personnel(name, role, email), competitions(name, template_key, year, fee_type)"
    ).order("created_at", desc=True).execute()
    return result.data


@router.post("")
def create_nomination(data: NominationCreate):
    record = data.model_dump()
    if record.get("game_dates"):
        record["game_dates"] = [
            gd if isinstance(gd, dict) else gd.model_dump()
            for gd in record["game_dates"]
        ]
    # Creating a nomination implies the TD was selected → start at 'nominated'
    record.setdefault("confirmation_status", "nominated")
    record.setdefault("confirmation_updated_at", datetime.now(timezone.utc).isoformat())
    result = supabase.table("nominations").insert(record).execute()
    return result.data[0]


@router.post("/bulk")
def create_bulk_nominations(data: BulkNominationCreate):
    """Create nominations for multiple people with the same competition/settings."""
    if len(data.personnel_ids) > _MAX_BULK:
        raise HTTPException(status_code=400, detail=f"Maximum {_MAX_BULK} items per request")
    created = []
    errors = []

    for pid in data.personnel_ids:
        try:
            record = {
                "personnel_id": pid,
                "competition_id": data.competition_id,
                "letter_date": data.letter_date,
                "location": data.location,
                "venue": data.venue,
                "arrival_date": data.arrival_date,
                "departure_date": data.departure_date,
                "game_dates": [gd.model_dump() for gd in data.game_dates] if data.game_dates else None,
                "window_fee": data.window_fee,
                "incidentals": data.incidentals,
                "confirmation_deadline": data.confirmation_deadline,
                "confirmation_status": "nominated",
                "confirmation_updated_at": datetime.now(timezone.utc).isoformat(),
            }
            result = supabase.table("nominations").insert(record).execute()
            created.append(result.data[0])
        except Exception as e:
            errors.append({"personnel_id": pid, "error": str(e)})

    return {"created": len(created), "errors": errors, "nominations": created}


@router.post("/bulk-generate")
def bulk_generate_nominations(nomination_ids: list[str]):
    """Generate PDF documents for multiple nominations."""
    if len(nomination_ids) > _MAX_BULK:
        raise HTTPException(status_code=400, detail=f"Maximum {_MAX_BULK} items per request")
    results = []

    for nid in nomination_ids:
        try:
            result = supabase.table("nominations").select(
                "*, personnel(name, role, email), competitions(name, template_key, year, fee_type)"
            ).eq("id", nid).execute()

            if not result.data:
                results.append({"id": nid, "status": "error", "error": "Not found"})
                continue

            nom = result.data[0]
            personnel = nom["personnel"]
            competition = nom["competitions"]

            nom_data = {
                "template_key": competition["template_key"],
                "nominee_name": personnel["name"],
                "role": personnel["role"],
                "letter_date": nom.get("letter_date", ""),
                "competition_name": competition["name"],
                "competition_year": competition.get("year", ""),
                "location": nom.get("location", ""),
                "venue": nom.get("venue", ""),
                "arrival_date": nom.get("arrival_date", ""),
                "departure_date": nom.get("departure_date", ""),
                "game_dates": nom.get("game_dates", []),
                "window_fee": nom.get("window_fee"),
                "incidentals": nom.get("incidentals"),
                "total": nom.get("total"),
                "confirmation_deadline": nom.get("confirmation_deadline", ""),
                "fee_type": competition.get("fee_type", "per_game"),
            }

            local_path, storage_url, conversion_error = generate_nomination(nom_data)
            saved_path = storage_url if storage_url else local_path

            supabase.table("nominations").update({
                "status": "generated",
                "pdf_path": saved_path,
            }).eq("id", nid).execute()

            ext = "docx" if conversion_error else "pdf"
            filename = f"{personnel['name']} {competition['name']} Nomination.{ext}"
            results.append({
                "id": nid,
                "name": personnel["name"],
                "status": "generated",
                "pdf_path": saved_path,
                "filename": filename,
                "format": ext,
                "conversion_error": conversion_error,
            })
        except Exception as e:
            results.append({"id": nid, "status": "error", "error": str(e)})

    return {"results": results, "total": len(results), "success": sum(1 for r in results if r["status"] == "generated")}


@router.patch("/{nomination_id}/confirmation")
def update_confirmation(nomination_id: str, payload: ConfirmationUpdate):
    """Update the confirmation workflow state for a nomination."""
    if payload.status not in _VALID_CONFIRMATION_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"status must be one of {sorted(_VALID_CONFIRMATION_STATUSES)}"
        )
    updates = {
        "confirmation_status": payload.status,
        "confirmation_updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if payload.notes is not None:
        updates["confirmation_notes"] = payload.notes
    result = (
        supabase.table("nominations")
        .update(updates)
        .eq("id", nomination_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Nomination not found")
    return result.data[0]


def _extract_storage_key(pdf_path: str | None) -> str | None:
    """Extract the Storage object key from a pdf_path (any supported format)."""
    if not pdf_path:
        return None
    if pdf_path.startswith("storage://nominations/"):
        return pdf_path[len("storage://nominations/"):]
    if "/storage/v1/object/public/nominations/" in pdf_path:
        return pdf_path.split("/storage/v1/object/public/nominations/", 1)[1]
    if "/storage/v1/object/nominations/" in pdf_path:
        return pdf_path.split("/storage/v1/object/nominations/", 1)[1]
    return None


def _delete_pdf_from_storage(pdf_path: str | None) -> None:
    """Best-effort cleanup of a nomination's PDF in Storage."""
    key = _extract_storage_key(pdf_path)
    if not key:
        return
    try:
        supabase.storage.from_("nominations").remove([key])
    except Exception as e:
        print(f"[storage cleanup] could not remove {key}: {e}")


@router.delete("/{nomination_id}", dependencies=[Depends(require_edit("nominations"))])
def delete_nomination(nomination_id: str):
    # Pen-test N2: also clean up the PDF in Storage so a stale UUID can't be
    # used to download a deleted nomination's file.
    row = supabase.table("nominations").select("pdf_path").eq("id", nomination_id).execute().data
    pdf_path = row[0].get("pdf_path") if row else None

    result = supabase.table("nominations").delete().eq("id", nomination_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Nomination not found")

    _delete_pdf_from_storage(pdf_path)
    return {"ok": True}


@router.delete("/bulk/delete", dependencies=[Depends(require_edit("nominations"))])
def bulk_delete_nominations(nomination_ids: list[str]):
    if len(nomination_ids) > _MAX_BULK:
        raise HTTPException(status_code=400, detail=f"Maximum {_MAX_BULK} items per request")
    deleted = 0
    errors = []
    for nid in nomination_ids:
        try:
            row = supabase.table("nominations").select("pdf_path").eq("id", nid).execute().data
            pdf_path = row[0].get("pdf_path") if row else None
            supabase.table("nominations").delete().eq("id", nid).execute()
            _delete_pdf_from_storage(pdf_path)
            deleted += 1
        except Exception as e:
            errors.append({"id": nid, "error": str(e)})
    return {"deleted": deleted, "errors": errors}


@router.get("/{nomination_id}")
def get_nomination(nomination_id: str):
    result = supabase.table("nominations").select(
        "*, personnel(name, role, email), competitions(name, template_key, year, fee_type)"
    ).eq("id", nomination_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Nomination not found")
    return result.data[0]


@router.post("/{nomination_id}/generate")
def generate_nomination_doc(nomination_id: str):
    result = supabase.table("nominations").select(
        "*, personnel(name, role, email), competitions(name, template_key, year, fee_type)"
    ).eq("id", nomination_id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Nomination not found")

    nom = result.data[0]
    personnel = nom["personnel"]
    competition = nom["competitions"]

    nom_data = {
        "template_key": competition["template_key"],
        "nominee_name": personnel["name"],
        "role": personnel["role"],
        "letter_date": nom.get("letter_date", ""),
        "competition_name": competition["name"],
        "competition_year": competition.get("year", ""),
        "location": nom.get("location", ""),
        "venue": nom.get("venue", ""),
        "arrival_date": nom.get("arrival_date", ""),
        "departure_date": nom.get("departure_date", ""),
        "game_dates": nom.get("game_dates", []),
        "window_fee": nom.get("window_fee"),
        "incidentals": nom.get("incidentals"),
        "total": nom.get("total"),
        "confirmation_deadline": nom.get("confirmation_deadline", ""),
        "fee_type": competition.get("fee_type", "per_game"),
    }

    try:
        local_path, storage_url, conversion_error = generate_nomination(nom_data)
    except Exception:
        raise HTTPException(status_code=500, detail="Document generation failed. Please try again.")

    # Save the best available path
    saved_path = storage_url if storage_url else local_path

    update_data = {
        "status": "generated",
        "pdf_path": saved_path,
    }

    supabase.table("nominations").update(update_data).eq("id", nomination_id).execute()

    ext = "docx" if conversion_error else "pdf"
    filename = f"{personnel['name']} {competition['name']} Nomination.{ext}"

    response = {
        "pdf_path": saved_path,
        "status": "generated",
        "filename": filename,
        "format": ext,
    }
    if conversion_error:
        response["conversion_error"] = conversion_error

    return response


@router.get("/{nomination_id}/download")
def download_nomination(nomination_id: str, filename: str = None):
    import httpx

    result = supabase.table("nominations").select(
        "pdf_path, personnel(name), competitions(name)"
    ).eq("id", nomination_id).execute()

    if not result.data or not result.data[0].get("pdf_path"):
        raise HTTPException(status_code=404, detail="Document not generated yet")

    nom = result.data[0]
    doc_path = nom["pdf_path"]

    # Build filename if not provided
    if not filename:
        p_name = nom.get("personnel", {}).get("name", "Nomination")
        c_name = nom.get("competitions", {}).get("name", "")
        ext = "pdf" if doc_path.endswith(".pdf") or "pdf" in doc_path.lower() else "docx"
        filename = f"{p_name} {c_name} Nomination.{ext}"

    # Sanitize filename to prevent header injection
    filename = _SAFE_FILENAME_RE.sub('', filename).strip()
    if not filename:
        filename = "Nomination.pdf"

    # Resolve the doc_path into a Supabase Storage object URL we can fetch
    # with service_role credentials (bucket is now PRIVATE).
    SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
    SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or os.environ.get("SUPABASE_KEY", "")
    storage_object_url = None

    if doc_path.startswith("storage://"):
        # New format: storage://<bucket>/<path>
        rest = doc_path[len("storage://"):]
        bucket, _, key = rest.partition("/")
        storage_object_url = f"{SUPABASE_URL}/storage/v1/object/{bucket}/{key}"
    elif doc_path.startswith("http") and "/storage/v1/object/public/nominations/" in doc_path:
        # Legacy format: rewrite the public URL to the authenticated path.
        # Same key, but the bucket is now private — use /object/{bucket}/{path}
        # with service_role.
        key = doc_path.split("/storage/v1/object/public/nominations/", 1)[1]
        storage_object_url = f"{SUPABASE_URL}/storage/v1/object/nominations/{key}"
    elif doc_path.startswith("http"):
        # Some other http URL (shouldn't happen). Fall back to passthrough fetch.
        storage_object_url = doc_path

    if storage_object_url:
        try:
            headers = {"Authorization": f"Bearer {SUPABASE_KEY}", "apikey": SUPABASE_KEY}
            resp = httpx.get(storage_object_url, headers=headers, timeout=30.0, follow_redirects=True)
            if resp.status_code != 200:
                raise HTTPException(status_code=404, detail="Document not available")
            content_type = resp.headers.get("content-type", "application/octet-stream")
            from fastapi.responses import Response
            return Response(
                content=resp.content,
                media_type=content_type,
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                    "Cache-Control": "private, no-store",
                },
            )
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=502, detail="Storage fetch failed")

    # Local file (dev mode only)
    if not os.path.exists(doc_path):
        raise HTTPException(status_code=404, detail="Document not available. Try regenerating.")

    if doc_path.endswith(".pdf"):
        media_type = "application/pdf"
    else:
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    return FileResponse(doc_path, media_type=media_type, filename=filename)
