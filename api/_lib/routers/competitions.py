from fastapi import APIRouter, HTTPException, Depends
from api._lib.database import supabase
from api._lib.auth import require_view, require_edit
from api._lib.schemas import CompetitionCreate, CompetitionUpdate

router = APIRouter(prefix="/competitions", tags=["competitions"], dependencies=[Depends(require_view("competitions"))])


@router.get("")
def list_competitions():
    # Cronológico, no alfabético. Ordenar por `name` apilaba juntas las 13 LSB
    # mezclando 2026 con 2027, y además rompía el orden dentro de una misma
    # temporada: "BCLA Season 7 – Final 4" caía antes que "– QFs" y que
    # "– Window 1", o sea al revés de como pasan.
    result = (
        supabase.table("competitions")
        .select("*")
        .order("year")
        .order("month")
        .order("start_date", nulls_last=True)
        .order("name")
        .execute()
    )
    return result.data


@router.post("", dependencies=[Depends(require_edit("competitions"))])
def create_competition(data: CompetitionCreate):
    record = data.model_dump()
    # Not sent explicitly → national-team flag follows the template (WCQ).
    if record.get("is_national_team") is None:
        record["is_national_team"] = (record.get("template_key") or "").upper() == "WCQ"
    result = supabase.table("competitions").insert(record).execute()
    return result.data[0]


_CLEARABLE_DATE_FIELDS = {
    "default_letter_date", "default_arrival_date", "default_departure_date",
    "default_confirmation_deadline",
}
_CLEARABLE_TEXT_FIELDS = {"fiba_games_url", "fiba_window_code", "default_location", "default_venue"}


@router.put("/{competition_id}", dependencies=[Depends(require_edit("competitions"))])
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


@router.delete("/{competition_id}", dependencies=[Depends(require_edit("competitions"))])
def delete_competition(competition_id: str, force: bool = False):
    # Reuse el chequeo de pagos y la limpieza de Storage de nominations: borrar
    # una nominación a mano (raw DELETE) se saltaba ambos, perdía EP records por
    # la cascada y dejaba PDFs huérfanos en el bucket privado.
    from api._lib.routers.nominations import _payment_records_for, _delete_pdf_from_storage

    noms = (
        supabase.table("nominations")
        .select("id, pdf_path")
        .eq("competition_id", competition_id)
        .execute()
        .data
    ) or []
    nom_ids = [n["id"] for n in noms]

    # Un pago atado a CUALQUIER nominación bloquea todo el borrado, con o sin
    # force: la cascada lo destruiría en silencio (así desaparecieron EP-00001..5).
    with_payment = _payment_records_for(nom_ids)
    if with_payment:
        records = ", ".join(sorted(with_payment.values()))
        raise HTTPException(
            status_code=409,
            detail=(
                f"No se puede eliminar: hay pago(s) {records} asociado(s) a "
                f"nominaciones de esta competencia. Elimina el/los pago(s) primero "
                f"en el módulo Pagos."
            ),
        )

    if noms and not force:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Tiene {len(noms)} nominación(es) asociada(s). Confirma para "
                f"eliminarla: también se borrarán reportes, evaluaciones y "
                f"logística de esta competencia."
            ),
        )

    for n in noms:
        supabase.table("nominations").delete().eq("id", n["id"]).execute()
        _delete_pdf_from_storage(n.get("pdf_path"))

    result = supabase.table("competitions").delete().eq("id", competition_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Competition not found")
    return {"ok": True, "nominations_deleted": len(noms)}
