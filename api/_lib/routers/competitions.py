from datetime import date

from fastapi import APIRouter, HTTPException, Depends, Query
from api._lib.database import supabase
from api._lib.auth import require_view, require_edit
from api._lib.schemas import CompetitionCreate, CompetitionUpdate
from api._lib.services import fiba_sync

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


def _link_fiba_id(raw: dict, out: dict, previous_url: str | None = None) -> None:
    """El ID de FIBA sigue al campo "URL o ID" del formulario.

    Un ID pelado se guarda directo; una URL deja el ID en NULL para que el
    próximo sync lo resuelva desde la URL nueva. Sin esto, cambiar la URL de una
    competencia la dejaba sincronizando contra la competencia de FIBA anterior.
    Si el formulario manda un fiba_competition_id explícito, ese gana.
    """
    if "fiba_games_url" not in raw or raw.get("fiba_games_url") is None:
        return
    if raw.get("fiba_competition_id"):
        return
    url = (raw.get("fiba_games_url") or "").strip()
    # Guardar el formulario sin tocar el campo no desvincula nada.
    if url == (previous_url or "").strip():
        return
    out["fiba_competition_id"] = int(url) if fiba_sync.is_fiba_id(url) else None


@router.get("/fiba/discover", dependencies=[Depends(require_edit("competitions"))])
def discover_fiba_competitions(
    from_season: int | None = Query(None, ge=2000, le=2100),
    to_season: int | None = Query(None, ge=2000, le=2100),
):
    """Competencias de FIBA Americas que todavía no están vinculadas a ninguna nuestra.

    Solo lista: el alta la hace una persona desde el formulario, que decide
    nombre, plantilla y si la competencia se divide en ventanas o grupos. Lleva
    `edit` porque existe para dar de alta, y cada llamada gasta cuota de GDAP.
    """
    this_year = date.today().year
    from_season = from_season or this_year
    to_season = to_season or this_year + 1
    if to_season < from_season:
        raise HTTPException(400, "to_season must be >= from_season")
    try:
        return fiba_sync.discover(fiba_sync.GdapClient(), from_season, to_season)
    except fiba_sync.FibaSyncError as e:
        raise HTTPException(502, str(e))


@router.post("", dependencies=[Depends(require_edit("competitions"))])
def create_competition(data: CompetitionCreate):
    record = data.model_dump()
    # Un campo del formulario que quedó en blanco es NULL, no "": un
    # fiba_group_codes "" se leería como "filtrar por ningún grupo".
    for k in ("fiba_games_url", "fiba_window_code", "fiba_group_codes", "start_date", "end_date", "location"):
        if isinstance(record.get(k), str) and not record[k].strip():
            record[k] = None
    _link_fiba_id(record, record)
    # Not sent explicitly → national-team flag follows the template (WCQ).
    if record.get("is_national_team") is None:
        record["is_national_team"] = (record.get("template_key") or "").upper() == "WCQ"
    result = supabase.table("competitions").insert(record).execute()
    return result.data[0]


_CLEARABLE_DATE_FIELDS = {
    "default_letter_date", "default_arrival_date", "default_departure_date",
    "default_confirmation_deadline",
}
_CLEARABLE_TEXT_FIELDS = {
    "fiba_games_url", "fiba_window_code", "fiba_group_codes", "default_location", "default_venue",
}


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
    # 0 = desvincular de FIBA (un int no puede llegar como "").
    if raw.get("fiba_competition_id") == 0:
        updates["fiba_competition_id"] = None
    if raw.get("fiba_games_url") is not None:
        prev = supabase.table("competitions").select("fiba_games_url").eq("id", competition_id).execute().data
        _link_fiba_id(raw, updates, (prev[0].get("fiba_games_url") if prev else None))
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
                f"nominaciones de esta competencia. Eliminá el/los pago(s) primero "
                f"en el módulo Pagos."
            ),
        )

    if noms and not force:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Tiene {len(noms)} nominación(es) asociada(s). Confirmá para "
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
