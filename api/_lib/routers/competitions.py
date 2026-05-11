from fastapi import APIRouter, HTTPException, Depends
from api._lib.database import supabase
from api._lib.auth import require_view, require_edit
from api._lib.schemas import CompetitionCreate, CompetitionUpdate

router = APIRouter(prefix="/competitions", tags=["competitions"], dependencies=[Depends(require_view("competitions"))])


@router.get("")
def list_competitions():
    result = supabase.table("competitions").select("*").order("created_at", desc=True).execute()
    return result.data


@router.post("")
def create_competition(data: CompetitionCreate):
    record = data.model_dump()
    result = supabase.table("competitions").insert(record).execute()
    return result.data[0]


_CLEARABLE_DATE_FIELDS = {
    "default_letter_date", "default_arrival_date", "default_departure_date",
    "default_confirmation_deadline",
}
_CLEARABLE_TEXT_FIELDS = {"fiba_games_url", "default_location", "default_venue"}


@router.put("/{competition_id}")
def update_competition(competition_id: str, data: CompetitionUpdate):
    raw = data.model_dump()
    updates = {}
    for k, v in raw.items():
        if v is None:
            continue
        # Empty string on a clearable field → store as NULL
        if v == "" and (k in _CLEARABLE_TEXT_FIELDS or k in _CLEARABLE_DATE_FIELDS):
            updates[k] = None
        else:
            updates[k] = v
    # Preserve the previous behavior of allowing the client to clear fiba_games_url
    # by sending an empty string in the payload.
    if "fiba_games_url" in raw and raw["fiba_games_url"] == "":
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
