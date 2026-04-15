import re
from fastapi import APIRouter, HTTPException, UploadFile, File
from api._lib.database import supabase
from api._lib.schemas import PersonnelCreate, PersonnelUpdate
from api._lib.services.bulk_import import process_bulk_import

router = APIRouter(prefix="/personnel", tags=["personnel"])

# Max upload size: 5 MB
_MAX_UPLOAD_BYTES = 5 * 1024 * 1024
_SAFE_SEARCH_RE = re.compile(r"^[\w\s\-\.@áéíóúñüÁÉÍÓÚÑÜ]+$")


@router.get("")
def list_personnel(role: str = None, search: str = None):
    query = supabase.table("personnel").select("*")
    if role:
        if role.upper() not in ("VGO", "TD"):
            raise HTTPException(status_code=400, detail="Role must be VGO or TD")
        query = query.eq("role", role.upper())
    if search:
        # Sanitize search to prevent PostgREST filter injection
        sanitized = search.strip()[:100]
        if not _SAFE_SEARCH_RE.match(sanitized):
            raise HTTPException(status_code=400, detail="Invalid search characters")
        query = query.or_(f"name.ilike.%{sanitized}%,email.ilike.%{sanitized}%")
    result = query.order("name").execute()
    return result.data


@router.post("")
def create_personnel(data: PersonnelCreate):
    record = data.model_dump()
    record["role"] = record["role"].upper()
    result = supabase.table("personnel").insert(record).execute()
    return result.data[0]


@router.get("/{person_id}")
def get_personnel(person_id: str):
    result = supabase.table("personnel").select("*").eq("id", person_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Person not found")
    return result.data[0]


@router.put("/{person_id}")
def update_personnel(person_id: str, data: PersonnelUpdate):
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if "role" in updates:
        updates["role"] = updates["role"].upper()
    result = supabase.table("personnel").update(updates).eq("id", person_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Person not found")
    return result.data[0]


@router.delete("/{person_id}")
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


@router.post("/import")
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
