from fastapi import APIRouter, HTTPException, UploadFile, File
from api._lib.database import supabase
from api._lib.schemas import PersonnelCreate, PersonnelUpdate
from api._lib.services.bulk_import import process_bulk_import

router = APIRouter(prefix="/personnel", tags=["personnel"])


@router.get("")
def list_personnel(role: str = None, search: str = None):
    query = supabase.table("personnel").select("*")
    if role:
        query = query.eq("role", role.upper())
    if search:
        query = query.or_(f"name.ilike.%{search}%,email.ilike.%{search}%")
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
def delete_personnel(person_id: str):
    # Check if person has nominations
    noms = supabase.table("nominations").select("id").eq("personnel_id", person_id).execute()
    if noms.data:
        raise HTTPException(
            status_code=409,
            detail=f"No se puede eliminar: tiene {len(noms.data)} nominación(es) asociada(s). Elimínelas primero."
        )
    result = supabase.table("personnel").delete().eq("id", person_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Person not found")
    return {"ok": True}


@router.post("/import")
async def import_personnel(file: UploadFile = File(...)):
    contents = await file.read()
    result = process_bulk_import(contents, file.filename)
    return result
