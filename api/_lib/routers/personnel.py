import re
import uuid
from datetime import date, timedelta
from fastapi import APIRouter, HTTPException, UploadFile, File, Depends
from api._lib.database import supabase
from api._lib.auth import require_view, require_edit
from api._lib.schemas import PersonnelCreate, PersonnelUpdate
from api._lib.services.bulk_import import process_bulk_import
from api._lib.countries import name_to_code

router = APIRouter(prefix="/personnel", tags=["personnel"], dependencies=[Depends(require_view("personnel"))])

# Max upload size: 5 MB
_MAX_UPLOAD_BYTES = 5 * 1024 * 1024
_SAFE_SEARCH_RE = re.compile(r"^[\w\s\-\.@áéíóúñüÁÉÍÓÚÑÜ]+$")
_PHOTO_BUCKET = "inventory"
# Valid personnel roles (matches the CHECK constraint in migration 011).
_VALID_ROLES = ("VGO", "TD", "REF", "REF_INSTRUCTOR")


def _normalize_country(record: dict) -> None:
    """Keep country_code consistent: uppercase it, or derive it from the
    free-text country when the client didn't send a code. Empty string → None
    (clears the code)."""
    if "country_code" in record:
        code = (record.get("country_code") or "").strip().upper()
        record["country_code"] = code or None
    elif record.get("country"):
        derived = name_to_code(record["country"])
        if derived:
            record["country_code"] = derived


def _upload_photo_to_storage(path: str, content: bytes, content_type: str) -> str:
    """Upload bytes to Supabase Storage and return the public URL (upsert)."""
    try:
        supabase.storage.from_(_PHOTO_BUCKET).remove([path])
    except Exception:
        pass
    supabase.storage.from_(_PHOTO_BUCKET).upload(
        path=path,
        file=content,
        file_options={"content-type": content_type, "upsert": "true"},
    )
    return supabase.storage.from_(_PHOTO_BUCKET).get_public_url(path)


@router.get("")
def list_personnel(role: str = None, search: str = None):
    query = supabase.table("personnel").select("*")
    if role:
        if role.upper() not in _VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"Role must be one of {', '.join(_VALID_ROLES)}")
        query = query.eq("role", role.upper())
    if search:
        # Sanitize search to prevent PostgREST filter injection
        sanitized = search.strip()[:100]
        if not _SAFE_SEARCH_RE.match(sanitized):
            raise HTTPException(status_code=400, detail="Invalid search characters")
        query = query.or_(f"name.ilike.%{sanitized}%,email.ilike.%{sanitized}%")
    result = query.order("name").execute()
    return result.data


@router.post("", dependencies=[Depends(require_edit("personnel"))])
def create_personnel(data: PersonnelCreate):
    # Drop unset optional fields so column defaults (languages '{}', visas '[]') apply
    record = {k: v for k, v in data.model_dump().items() if v is not None}
    record["role"] = record["role"].upper()
    if record["role"] not in _VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Role must be one of {', '.join(_VALID_ROLES)}")
    _normalize_country(record)
    result = supabase.table("personnel").insert(record).execute()
    return result.data[0]


@router.get("/{person_id}")
def get_personnel(person_id: str):
    result = supabase.table("personnel").select("*").eq("id", person_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Person not found")
    return result.data[0]


@router.get("/{person_id}/workload")
def get_personnel_workload(person_id: str, months: int = 12):
    """Rolling N-month workload for a TD/VGO: competitions worked + game days.

    "Game days" = distinct dates in each nomination's `game_dates` that fall
    inside the window. Declined nominations are excluded. Nominations without
    game dates are still listed (windowed by the competition/nomination date)
    but contribute 0 game days, shown as unknown on the UI.
    """
    if months < 1 or months > 60:
        raise HTTPException(status_code=400, detail="months must be between 1 and 60")

    person = supabase.table("personnel").select("*").eq("id", person_id).execute()
    if not person.data:
        raise HTTPException(status_code=404, detail="Person not found")
    person = person.data[0]

    today = date.today()
    from_str = (today - timedelta(days=round(months * 30.44))).isoformat()
    to_str = today.isoformat()

    noms = supabase.table("nominations").select(
        "id, competition_id, game_dates, arrival_date, departure_date, letter_date, "
        "confirmation_status, competitions(name, year, template_key, start_date, end_date)"
    ).eq("personnel_id", person_id).execute().data or []

    competitions = []
    total_game_days = 0
    for n in noms:
        if (n.get("confirmation_status") or "") == "declined":
            continue
        comp = n.get("competitions") or {}
        game_dates = sorted({
            gd.get("date") for gd in (n.get("game_dates") or [])
            if isinstance(gd, dict) and gd.get("date")
        })
        in_window = [d for d in game_dates if from_str <= d <= to_str]

        if game_dates:
            if not in_window:
                continue  # this competition's games fall outside the window
            game_days = len(in_window)
            first_date, last_date = in_window[0], in_window[-1]
        else:
            # No game dates recorded — window by competition/nomination date.
            ref = comp.get("start_date") or n.get("arrival_date") or n.get("letter_date")
            if not ref or not (from_str <= ref <= to_str):
                continue
            game_days = 0
            first_date = comp.get("start_date") or ref
            last_date = comp.get("end_date") or ref

        total_game_days += game_days
        competitions.append({
            "nomination_id": n["id"],
            "competition_id": n["competition_id"],
            "competition_name": comp.get("name"),
            "year": comp.get("year"),
            "template_key": comp.get("template_key"),
            "confirmation_status": n.get("confirmation_status"),
            "game_days": game_days,
            "dates": in_window,
            "first_date": first_date,
            "last_date": last_date,
        })

    competitions.sort(key=lambda c: (c.get("last_date") or c.get("first_date") or ""), reverse=True)

    return {
        "person": person,
        "window": {"from": from_str, "to": to_str, "months": months},
        "totals": {"competitions": len(competitions), "game_days": total_game_days},
        "competitions": competitions,
    }


@router.put("/{person_id}", dependencies=[Depends(require_edit("personnel"))])
def update_personnel(person_id: str, data: PersonnelUpdate):
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if "role" in updates:
        updates["role"] = updates["role"].upper()
        if updates["role"] not in _VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"Role must be one of {', '.join(_VALID_ROLES)}")
    _normalize_country(updates)
    result = supabase.table("personnel").update(updates).eq("id", person_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Person not found")
    return result.data[0]


@router.delete("/{person_id}", dependencies=[Depends(require_edit("personnel"))])
def delete_personnel(person_id: str, force: bool = False):
    # Check if person has nominations
    noms = supabase.table("nominations").select("id").eq("personnel_id", person_id).execute()
    if noms.data:
        if not force:
            raise HTTPException(
                status_code=409,
                detail=f"Tiene {len(noms.data)} nominación(es) asociada(s)."
            )
        # Delete associated nominations first
        for n in noms.data:
            supabase.table("nominations").delete().eq("id", n["id"]).execute()
    result = supabase.table("personnel").delete().eq("id", person_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Person not found")
    return {"ok": True, "nominations_deleted": len(noms.data) if noms.data else 0}


@router.post("/{person_id}/photo", dependencies=[Depends(require_edit("personnel"))])
async def upload_personnel_photo(person_id: str, photo: UploadFile = File(...)):
    try:
        uuid.UUID(person_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid person id")
    if not (photo.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")
    content = await photo.read()
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Photo too large (max 5 MB)")

    ext = (photo.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp"):
        ext = "jpg"

    photo_url = _upload_photo_to_storage(f"personnel/{person_id}.{ext}", content, photo.content_type)

    result = (
        supabase.table("personnel")
        .update({"photo_url": photo_url})
        .eq("id", person_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Person not found")
    return result.data[0]


@router.post("/import", dependencies=[Depends(require_edit("personnel"))])
async def import_personnel(file: UploadFile = File(...)):
    # Validate file type
    fname = (file.filename or "").lower()
    if not fname.endswith((".csv", ".xlsx", ".xls")):
        raise HTTPException(status_code=400, detail="Only CSV and Excel files are accepted")
    # Validate file size
    contents = await file.read()
    if len(contents) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 5 MB)")
    result = process_bulk_import(contents, file.filename)
    return result
