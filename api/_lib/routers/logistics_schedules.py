"""Cronogramas de logística: transporte (pick-up / return) y comidas.

Son los dos documentos que logística arma en Excel y manda afuera — a los
equipos, a los árbitros, al hotel. Acá se suben, se leen a datos y se guarda el
original. Un documento por (competencia, sección, audiencia); ver la migración
054 para por qué son documentos y no una vista derivada de training / games.

Comparte el permiso `logistics` con el resto del módulo. La lectura del Excel
vive en services/logistics_schedule_import.py y no toca la base.
"""
import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel

from api._lib.auth import require_edit, require_view
from api._lib.database import supabase
from api._lib.logistics_audiences import AUDIENCES
from api._lib.routers.logistics import _read_upload
from api._lib.routers.payments import _delete_from_storage, _stream_private
from api._lib.services.logistics_import import parse_time
from api._lib.services.logistics_schedule_import import (
    SECTIONS, ScheduleFormatError, read_schedule,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/logistics/schedules",
    tags=["logistics"],
    dependencies=[Depends(require_view("logistics"))],
)

_BUCKET = "nominations"
_PREFIX = "logistics/schedules"
# Extensión → content-type. El original se guarda con SU extensión: un .xlsm
# renombrado a .xlsx no abre en Excel.
_EXCEL_TYPES = {
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
}
_SAFE_FILENAME_RE = re.compile(r"[^\w\s\-\.\(\)]")
KINDS = ("training", "game")

# Lo que sale en cada fila, también en la vista pública.
ROW_FIELDS = (
    "id,schedule_id,date,kind,position,start_time,end_time,team,team_b,"
    "pickup_time,return_time,lunch,snack,dinner,notes"
)
_ROW_TIMES = ("start_time", "end_time", "pickup_time", "return_time")
_ROW_TEXTS = ("team", "team_b", "lunch", "snack", "dinner", "notes")


# ── Schemas ──────────────────────────────────────────────────────────────────

class DayMeta(BaseModel):
    date: str
    label: Optional[str] = None
    notes: Optional[str] = None


class ScheduleCreate(BaseModel):
    competition_id: str
    section: str
    audience: str
    title: Optional[str] = None
    subtitle: Optional[str] = None


class ScheduleUpdate(BaseModel):
    title: Optional[str] = None
    subtitle: Optional[str] = None
    days: Optional[List[DayMeta]] = None


class RowCreate(BaseModel):
    date: str
    kind: str = "training"
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    team: Optional[str] = None
    team_b: Optional[str] = None
    pickup_time: Optional[str] = None
    return_time: Optional[str] = None
    lunch: Optional[str] = None
    snack: Optional[str] = None
    dinner: Optional[str] = None
    notes: Optional[str] = None


class RowUpdate(BaseModel):
    date: Optional[str] = None
    kind: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    team: Optional[str] = None
    team_b: Optional[str] = None
    pickup_time: Optional[str] = None
    return_time: Optional[str] = None
    lunch: Optional[str] = None
    snack: Optional[str] = None
    dinner: Optional[str] = None
    notes: Optional[str] = None


# ── Helpers ──────────────────────────────────────────────────────────────────

def _check_scope(section: str, audience: str) -> None:
    if section not in SECTIONS:
        raise HTTPException(400, f"section must be one of {', '.join(SECTIONS)}")
    if audience not in AUDIENCES:
        raise HTTPException(400, f"audience must be one of {', '.join(AUDIENCES)}")


def _competition_or_404(competition_id: str) -> dict:
    rows = (
        supabase.table("competitions")
        .select("id,name,start_date,end_date")
        .eq("id", competition_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(404, "Competition not found")
    return rows[0]


def _schedule_or_404(schedule_id: str) -> dict:
    rows = supabase.table("logistics_schedules").select("*").eq("id", schedule_id).execute().data
    if not rows:
        raise HTTPException(404, "Schedule not found")
    return rows[0]


def _find(competition_id: str, section: str, audience: str) -> Optional[dict]:
    rows = (
        supabase.table("logistics_schedules")
        .select("*")
        .eq("competition_id", competition_id)
        .eq("section", section)
        .eq("audience", audience)
        .execute()
        .data
    )
    return rows[0] if rows else None


def _iso_date(value: str) -> str:
    try:
        return date.fromisoformat((value or "").strip()).isoformat()
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")


def clean_row(data: dict) -> dict:
    """Normaliza lo que manda el formulario: '' → NULL, horas a HH:MM.

    Una hora que no se puede leer es 400 y no un NULL silencioso: quien edita
    una celda tiene que enterarse de que no se guardó lo que escribió.
    """
    out = dict(data)
    if "date" in out:
        out["date"] = _iso_date(out["date"])
    if "kind" in out and out["kind"] not in KINDS:
        raise HTTPException(400, f"kind must be one of {', '.join(KINDS)}")
    for field in _ROW_TIMES:
        if field not in out:
            continue
        raw = (out[field] or "").strip() if isinstance(out[field], str) else out[field]
        if not raw:
            out[field] = None
            continue
        parsed = parse_time(raw)
        if parsed is None:
            raise HTTPException(400, f"{field} must be a time (HH:MM)")
        out[field] = parsed
    for field in _ROW_TEXTS:
        if field in out:
            text = (out[field] or "").strip() if isinstance(out[field], str) else out[field]
            out[field] = text or None
    return out


def sort_rows(rows: list[dict]) -> list[dict]:
    return sorted(rows, key=lambda r: (r.get("date") or "", r.get("position") or 0, r.get("start_time") or ""))


def schedule_view(schedule: dict, rows: list[dict]) -> dict:
    """Lo que ve el cliente: sin la ruta de Storage ni quién lo subió."""
    return {
        "id": schedule["id"],
        "competition_id": schedule["competition_id"],
        "section": schedule["section"],
        "audience": schedule["audience"],
        "title": schedule.get("title"),
        "subtitle": schedule.get("subtitle"),
        "days": schedule.get("days") or [],
        "file_name": schedule.get("file_name"),
        "has_file": bool(schedule.get("file_path")),
        "uploaded_at": schedule.get("uploaded_at"),
        "rows": sort_rows(rows),
    }


def load_schedules(competition_id: str, section: Optional[str] = None,
                   audience: Optional[str] = None) -> list[dict]:
    """Los cronogramas de una competencia con sus filas. Lo usa también la
    vista pública, por eso devuelve ya la forma recortada."""
    query = supabase.table("logistics_schedules").select("*").eq("competition_id", competition_id)
    if section:
        query = query.eq("section", section)
    if audience:
        query = query.eq("audience", audience)
    schedules = query.execute().data or []
    if not schedules:
        return []
    rows = (
        supabase.table("logistics_schedule_rows")
        .select(ROW_FIELDS)
        .in_("schedule_id", [s["id"] for s in schedules])
        .execute()
        .data
    ) or []
    by_schedule: dict = {}
    for row in rows:
        by_schedule.setdefault(row["schedule_id"], []).append(row)
    order = {(s, a): i for i, (s, a) in enumerate((s, a) for s in SECTIONS for a in AUDIENCES)}
    schedules.sort(key=lambda s: order.get((s["section"], s["audience"]), 99))
    return [schedule_view(s, by_schedule.get(s["id"], [])) for s in schedules]


def date_range_warning(competition: dict, days: list[dict]) -> Optional[dict]:
    """Aviso si ningún día del archivo cae cerca de la competencia.

    Es la forma barata de detectar la planilla de otro torneo subida acá. Solo
    avisa: las fechas que carga el equipo incluyen viaje y no son un límite.
    """
    if not days or not competition.get("start_date") or not competition.get("end_date"):
        return None
    try:
        low = date.fromisoformat(competition["start_date"]) - timedelta(days=10)
        high = date.fromisoformat(competition["end_date"]) + timedelta(days=10)
        dates = [date.fromisoformat(d["date"]) for d in days]
    except (ValueError, TypeError):
        return None
    if any(low <= d <= high for d in dates):
        return None
    return {
        "row": 0, "field": "date",
        "message": f"Las fechas del archivo ({min(dates).isoformat()} a {max(dates).isoformat()}) "
                   f"no coinciden con las de la competencia "
                   f"({competition['start_date']} a {competition['end_date']})",
    }


def _parse(content: bytes, section: str, competition: dict) -> dict:
    year = None
    try:
        year = date.fromisoformat(competition.get("start_date") or "").year
    except ValueError:
        pass
    try:
        parsed = read_schedule(content, section, year)
    except ScheduleFormatError as e:
        raise HTTPException(400, str(e))
    warning = date_range_warning(competition, parsed["days"])
    if warning:
        parsed["warnings"].insert(0, warning)
    return parsed


def _delete_rows(ids: list) -> None:
    # De a tandas: los ids van en la URL del DELETE.
    for start in range(0, len(ids), 50):
        supabase.table("logistics_schedule_rows").delete().in_("id", ids[start:start + 50]).execute()


def _user_id(request: Request) -> Optional[str]:
    user = getattr(request.state, "user", None)
    return user.get("id") if isinstance(user, dict) else None


# ── Lectura ──────────────────────────────────────────────────────────────────

@router.get("")
def list_schedules(competition_id: str = Query(...), section: Optional[str] = Query(None),
                   audience: Optional[str] = Query(None)):
    if section and section not in SECTIONS:
        raise HTTPException(400, f"section must be one of {', '.join(SECTIONS)}")
    if audience and audience not in AUDIENCES:
        raise HTTPException(400, f"audience must be one of {', '.join(AUDIENCES)}")
    return load_schedules(competition_id, section, audience)


@router.get("/{schedule_id}/file")
def download_schedule_file(schedule_id: str):
    """El Excel original, tal como se subió. Bucket privado: se sirve como blob
    autenticado, nunca como URL pública."""
    schedule = _schedule_or_404(schedule_id)
    if not schedule.get("file_path"):
        raise HTTPException(404, "No file on record")
    return _stream_private(schedule["file_path"], schedule.get("file_name") or "cronograma.xlsx")


# ── Import (dos pasos, como el resto de logística) ──────────────────────────

@router.post("/import/preview", dependencies=[Depends(require_edit("logistics"))])
async def preview_schedule_import(competition_id: str = Query(...), section: str = Query(...),
                                  audience: str = Query(...), file: UploadFile = File(...)):
    """Lee el archivo y muestra qué se va a guardar. No escribe nada."""
    _check_scope(section, audience)
    competition = _competition_or_404(competition_id)
    parsed = _parse(await _read_upload(file), section, competition)

    existing = _find(competition_id, section, audience)
    existing_rows = 0
    if existing:
        existing_rows = len(
            supabase.table("logistics_schedule_rows").select("id")
            .eq("schedule_id", existing["id"]).execute().data or []
        )
    rows = parsed["rows"]
    return {
        **parsed,
        "total": len(rows),
        "trainings": sum(1 for r in rows if r["kind"] == "training"),
        "games": sum(1 for r in rows if r["kind"] == "game"),
        "replaces": existing_rows,
    }


@router.post("/import/commit", dependencies=[Depends(require_edit("logistics"))])
async def commit_schedule_import(request: Request, competition_id: str = Query(...),
                                 section: str = Query(...), audience: str = Query(...),
                                 file: UploadFile = File(...)):
    """Reemplaza el cronograma por el del archivo y guarda el original.

    El archivo es la autoridad: reimportar pisa las ediciones hechas a mano
    (el preview lo avisa). El orden cuida que un fallo a mitad de camino no
    deje el documento vacío — primero entra lo nuevo, después sale lo viejo.
    """
    _check_scope(section, audience)
    competition = _competition_or_404(competition_id)
    content = await _read_upload(file)
    parsed = _parse(content, section, competition)

    extension = ".xlsm" if (file.filename or "").lower().endswith(".xlsm") else ".xlsx"
    key = f"{_PREFIX}/{competition_id}/{section}-{audience}-{uuid.uuid4().hex}{extension}"
    try:
        supabase.storage.from_(_BUCKET).upload(
            path=key, file=content,
            file_options={"content-type": _EXCEL_TYPES[extension], "upsert": "false"},
        )
    except Exception as e:
        logger.warning("[logistics] schedule upload failed for %s: %s", competition_id, e)
        raise HTTPException(502, "Upload failed")
    new_path = f"storage://{_BUCKET}/{key}"

    existing = _find(competition_id, section, audience)
    header = {
        "title": parsed["title"],
        "subtitle": parsed["subtitle"],
        "days": parsed["days"],
        "file_path": new_path,
        "file_name": _SAFE_FILENAME_RE.sub("", file.filename or "").strip() or "cronograma.xlsx",
        "uploaded_by": _user_id(request),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    new_ids: list = []
    created_id = None
    try:
        if existing:
            old_ids = [
                r["id"] for r in supabase.table("logistics_schedule_rows").select("id")
                .eq("schedule_id", existing["id"]).execute().data or []
            ]
            schedule_id = existing["id"]
        else:
            old_ids = []
            # El documento nace sin encabezado ni archivo: eso se sella al
            # final, cuando las filas ya entraron.
            created_id = schedule_id = supabase.table("logistics_schedules").insert({
                "competition_id": competition_id, "section": section, "audience": audience,
            }).execute().data[0]["id"]

        records = [
            {k: v for k, v in row.items() if k != "source_row"} | {"schedule_id": schedule_id}
            for row in parsed["rows"]
        ]
        inserted = supabase.table("logistics_schedule_rows").insert(records).execute().data or []
        new_ids = [r["id"] for r in inserted]
        supabase.table("logistics_schedules").update(header).eq("id", schedule_id).execute()
    except Exception:
        # Deshacer lo que alcanzó a entrar: ni el Excel recién subido queda
        # huérfano, ni las filas nuevas quedan mezcladas con las viejas, ni
        # queda un documento vacío creado por este intento.
        _delete_from_storage(new_path)
        try:
            _delete_rows(new_ids)
            if created_id:
                supabase.table("logistics_schedules").delete().eq("id", created_id).execute()
        except Exception as e:
            logger.warning("[logistics] could not roll back schedule import for %s: %s", competition_id, e)
        raise

    try:
        _delete_rows(old_ids)
    except Exception as e:
        # Lo nuevo ya está guardado; lo que quedó son filas de la versión
        # anterior mezcladas. Reimportar las saca: toma todo lo que hay como
        # "viejo" y lo reemplaza.
        logger.warning("[logistics] schedule %s kept %d stale rows: %s", schedule_id, len(old_ids), e)
        raise HTTPException(502, "El cronograma nuevo se guardó, pero no se pudieron quitar las filas "
                                 "de la versión anterior. Volvé a importar el archivo para limpiarlo.")
    old_path = (existing or {}).get("file_path")
    if old_path and old_path != new_path:
        _delete_from_storage(old_path)

    return {
        "schedule": load_schedules(competition_id, section, audience)[0],
        "rows": len(records),
        "replaced": len(old_ids),
        "skipped": parsed["skipped"],
        "warnings": parsed["warnings"],
    }


# ── Documento ────────────────────────────────────────────────────────────────

@router.post("", dependencies=[Depends(require_edit("logistics"))])
def create_schedule(data: ScheduleCreate):
    """Documento vacío, para cargar el cronograma a mano sin Excel."""
    _check_scope(data.section, data.audience)
    _competition_or_404(data.competition_id)
    if _find(data.competition_id, data.section, data.audience):
        raise HTTPException(409, "Schedule already exists")
    created = supabase.table("logistics_schedules").insert(data.model_dump()).execute().data[0]
    return schedule_view(created, [])


@router.patch("/{schedule_id}", dependencies=[Depends(require_edit("logistics"))])
def update_schedule(schedule_id: str, data: ScheduleUpdate):
    _schedule_or_404(schedule_id)
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    if updates.get("days") is not None:
        updates["days"] = [
            {"date": _iso_date(d["date"]), "label": (d.get("label") or "").strip() or None,
             "notes": (d.get("notes") or "").strip() or None}
            for d in updates["days"]
        ]
    elif "days" in updates:
        updates["days"] = []
    for field in ("title", "subtitle"):
        if field in updates:
            updates[field] = (updates[field] or "").strip() or None
    schedule = supabase.table("logistics_schedules").update(updates).eq("id", schedule_id).execute().data[0]
    rows = supabase.table("logistics_schedule_rows").select(ROW_FIELDS).eq("schedule_id", schedule_id).execute().data
    return schedule_view(schedule, rows or [])


@router.delete("/{schedule_id}", dependencies=[Depends(require_edit("logistics"))])
def delete_schedule(schedule_id: str):
    schedule = _schedule_or_404(schedule_id)
    # Las filas caen por el ON DELETE CASCADE; el Excel hay que sacarlo aparte.
    supabase.table("logistics_schedules").delete().eq("id", schedule_id).execute()
    _delete_from_storage(schedule.get("file_path"))
    return {"ok": True}


# ── Filas ────────────────────────────────────────────────────────────────────

@router.post("/{schedule_id}/rows", dependencies=[Depends(require_edit("logistics"))])
def create_row(schedule_id: str, data: RowCreate):
    _schedule_or_404(schedule_id)
    record = clean_row(data.model_dump())
    same_day = (
        supabase.table("logistics_schedule_rows").select("position")
        .eq("schedule_id", schedule_id).eq("date", record["date"]).execute().data
    ) or []
    record["position"] = max((r.get("position") or 0 for r in same_day), default=-1) + 1
    record["schedule_id"] = schedule_id
    return supabase.table("logistics_schedule_rows").insert(record).execute().data[0]


@router.put("/rows/{row_id}", dependencies=[Depends(require_edit("logistics"))])
def update_row(row_id: str, data: RowUpdate):
    updates = clean_row(data.model_dump(exclude_unset=True))
    if not updates:
        raise HTTPException(400, "No fields to update")
    result = supabase.table("logistics_schedule_rows").update(updates).eq("id", row_id).execute()
    if not result.data:
        raise HTTPException(404, "Row not found")
    return result.data[0]


@router.delete("/rows/{row_id}", dependencies=[Depends(require_edit("logistics"))])
def delete_row(row_id: str):
    supabase.table("logistics_schedule_rows").delete().eq("id", row_id).execute()
    return {"ok": True}
