import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from api._lib.database import supabase
from api._lib.schemas import NominationCreate, BulkNominationCreate
from api._lib.services.document_generator import generate_nomination

router = APIRouter(prefix="/nominations", tags=["nominations"])


@router.get("")
def list_nominations():
    result = supabase.table("nominations").select(
        "*, personnel(name, role, email), competitions(name, template_key, year)"
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
    result = supabase.table("nominations").insert(record).execute()
    return result.data[0]


@router.post("/bulk")
def create_bulk_nominations(data: BulkNominationCreate):
    """Create nominations for multiple people with the same competition/settings."""
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
            }
            result = supabase.table("nominations").insert(record).execute()
            created.append(result.data[0])
        except Exception as e:
            errors.append({"personnel_id": pid, "error": str(e)})

    return {"created": len(created), "errors": errors, "nominations": created}


@router.post("/bulk-generate")
def bulk_generate_nominations(nomination_ids: list[str]):
    """Generate PDF documents for multiple nominations."""
    results = []

    for nid in nomination_ids:
        try:
            result = supabase.table("nominations").select(
                "*, personnel(name, role, email), competitions(name, template_key, year)"
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


@router.get("/{nomination_id}")
def get_nomination(nomination_id: str):
    result = supabase.table("nominations").select(
        "*, personnel(name, role, email), competitions(name, template_key, year)"
    ).eq("id", nomination_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Nomination not found")
    return result.data[0]


@router.post("/{nomination_id}/generate")
def generate_nomination_doc(nomination_id: str):
    result = supabase.table("nominations").select(
        "*, personnel(name, role, email), competitions(name, template_key, year)"
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
    }

    try:
        local_path, storage_url, conversion_error = generate_nomination(nom_data)
    except Exception as e:
        import traceback
        return {
            "status": "error",
            "error": f"{type(e).__name__}: {e}",
            "traceback": traceback.format_exc(),
        }

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

    # If it's a URL (Supabase Storage), fetch and serve with proper filename
    if doc_path.startswith("http"):
        try:
            resp = httpx.get(doc_path, timeout=30.0, follow_redirects=True)
            if resp.status_code != 200:
                return RedirectResponse(url=doc_path)

            content_type = resp.headers.get("content-type", "application/octet-stream")
            from fastapi.responses import Response
            return Response(
                content=resp.content,
                media_type=content_type,
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"',
                },
            )
        except Exception:
            return RedirectResponse(url=doc_path)

    # Local file (dev mode only)
    if not os.path.exists(doc_path):
        raise HTTPException(status_code=404, detail="File not found. Try regenerating.")

    if doc_path.endswith(".pdf"):
        media_type = "application/pdf"
    else:
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    return FileResponse(doc_path, media_type=media_type, filename=filename)
