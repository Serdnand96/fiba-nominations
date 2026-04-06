from fastapi import APIRouter, HTTPException
from api._lib.database import supabase
from api._lib.schemas import CompetitionCreate

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
