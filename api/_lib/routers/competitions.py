from fastapi import APIRouter, HTTPException
from api._lib.database import supabase
from api._lib.schemas import CompetitionCreate, CompetitionUpdate

router = APIRouter(prefix="/competitions", tags=["competitions"])


@router.get("")
def list_competitions():
    result = supabase.table("competitions").select("*").order("created_at", desc=True).execute()
    return result.data


@router.post("")
def create_competition(data: CompetitionCreate):
    record = data.model_dump()
    result = supabase.table("competitions").insert(record).execute()
    return result.data[0]


@router.put("/{competition_id}")
def update_competition(competition_id: str, data: CompetitionUpdate):
    # Allow empty strings (e.g. clearing fiba_games_url) but skip None
    updates = {k: v for k, v in data.model_dump().items() if v is not None or k == "fiba_games_url"}
    # Convert empty fiba_games_url to None for clean DB storage
    if "fiba_games_url" in updates and updates["fiba_games_url"] == "":
        updates["fiba_games_url"] = None
    result = supabase.table("competitions").update(updates).eq("id", competition_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Competition not found")
    return result.data[0]


@router.delete("/{competition_id}")
def delete_competition(competition_id: str, force: bool = False):
    noms = supabase.table("nominations").select("id").eq("competition_id", competition_id).execute()
    if noms.data:
        if not force:
            raise HTTPException(
                status_code=409,
                detail=f"Tiene {len(noms.data)} nominación(es) asociada(s)."
            )
        for n in noms.data:
            supabase.table("nominations").delete().eq("id", n["id"]).execute()
    result = supabase.table("competitions").delete().eq("id", competition_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Competition not found")
    return {"ok": True, "nominations_deleted": len(noms.data) if noms.data else 0}
