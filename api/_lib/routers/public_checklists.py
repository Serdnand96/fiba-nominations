"""Checklist operativo en la sede, sin auth — el oficial lo carga del celular.

El token de la URL es el único credencial: resuelve a una fila de
`checklist_public_links` (una por competencia) y acota todo a los partidos de
esa competencia. Un token inválido, desconocido o apagado devuelve siempre el
mismo 404, así el endpoint no revela qué tokens existen. El bypass de auth y el
rate limit de /api/public/* viven en api/index.py.

A diferencia de las otras dos vistas públicas del sistema (availability,
logística), esta ESCRIBE. Por eso:

* Cada escritura re-verifica la cadena ítem → corrida → partido → competencia
  contra el token. No alcanza con conocer un item_id.
* Una corrida cerrada (`submitted_at`) es de solo lectura desde acá: reabrirla
  exige entrar al sistema con permiso `games`.
* Lo que publica es acotado a propósito — partidos, sedes y los ítems del
  checklist. Nada de pasaportes, vuelos ni pagos. Si se agregan campos al
  payload, revisar `_public_game()` y `_public_person()`.
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from api._lib.database import supabase
from api._lib.routers.checklists import (
    ItemUpdate,
    RunSubmit,
    apply_item_update,
    create_run,
    load_run,
    submit_run,
    load_runs,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/public/checklists", tags=["public"])

_MAX_NOTES = 1000


class PublicRunCreate(BaseModel):
    template_id: str
    personnel_id: Optional[str] = None
    signed_name: Optional[str] = Field(default=None, max_length=200)


class PublicItemUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=_MAX_NOTES)


class PublicSubmit(BaseModel):
    notes: Optional[str] = Field(default=None, max_length=_MAX_NOTES)


def _resolve_link(token: str) -> dict:
    """Token → fila de checklist_public_links, o un 404 uniforme."""
    # Acotar el token antes de que se vuelva un query param; los reales son de
    # 43 caracteres urlsafe base64.
    if not token or len(token) > 128:
        raise HTTPException(status_code=404, detail="Not found")
    rows = (
        supabase.table("checklist_public_links")
        .select("*")
        .eq("token", token)
        .execute()
        .data
    )
    if not rows or not rows[0].get("enabled"):
        raise HTTPException(status_code=404, detail="Not found")
    return rows[0]


def _competition(competition_id: str) -> dict:
    rows = (
        supabase.table("competitions")
        .select("id,name,short_name,start_date,end_date,location")
        .eq("id", competition_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Not found")
    return rows[0]


def _public_game(g: dict) -> dict:
    """Punto único de recorte del partido. Ver el docstring del módulo."""
    return {
        "id": g["id"],
        "game_number": g.get("game_number"),
        "date": g.get("date"),
        "time": g.get("time"),
        "team_a": g.get("team_a"),
        "team_a_code": g.get("team_a_code"),
        "team_b": g.get("team_b"),
        "team_b_code": g.get("team_b_code"),
        "venue": g.get("venue"),
        "city": g.get("city"),
        "phase": g.get("phase"),
        "group_label": g.get("group_label"),
    }


def _public_person(p: dict) -> dict:
    return {"id": p["id"], "name": p.get("name"), "role": p.get("role")}


def _games_of(competition_id: str) -> list[dict]:
    rows = (
        supabase.table("game_schedule")
        .select("*")
        .eq("competition_id", competition_id)
        .execute()
        .data
    ) or []
    rows.sort(key=lambda g: (g.get("date") or "", g.get("time") or "", g.get("game_number") or ""))
    return rows


def _game_of_link(link: dict, game_id: str) -> dict:
    """Partido, solo si pertenece a la competencia del token."""
    rows = (
        supabase.table("game_schedule")
        .select("*")
        .eq("id", game_id)
        .eq("competition_id", link["competition_id"])
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Not found")
    return rows[0]


def _run_of_link(link: dict, run_id: str) -> dict:
    """Corrida, solo si su partido es de la competencia del token."""
    rows = (
        supabase.table("game_checklists")
        .select("id,game_id,submitted_at,signed_name")
        .eq("id", run_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Not found")
    _game_of_link(link, rows[0]["game_id"])
    return rows[0]


def _open_run_of_item(link: dict, item_id: str) -> dict:
    """Ítem → corrida, verificando el token y que la corrida siga abierta."""
    rows = (
        supabase.table("game_checklist_items")
        .select("id,checklist_id")
        .eq("id", item_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Not found")
    run = _run_of_link(link, rows[0]["checklist_id"])
    if run.get("submitted_at"):
        raise HTTPException(status_code=409, detail="This checklist is already closed")
    return run


def _roster(competition_id: str, role: Optional[str]) -> list[dict]:
    """Oficiales vinculados a la competencia, para que la persona se elija.

    Sale del crew del torneo y de las asignaciones por partido: las dos formas
    que tiene el sistema de decir "esta persona trabaja este evento".
    """
    pids: set[str] = set()
    crew = (
        supabase.table("competition_assignments")
        .select("personnel_id")
        .eq("competition_id", competition_id)
        .execute()
        .data
    ) or []
    pids.update(a["personnel_id"] for a in crew if a.get("personnel_id"))

    game_ids = [g["id"] for g in _games_of(competition_id)]
    if game_ids:
        per_game = (
            supabase.table("game_assignments")
            .select("personnel_id")
            .in_("game_id", game_ids)
            .execute()
            .data
        ) or []
        pids.update(a["personnel_id"] for a in per_game if a.get("personnel_id"))

    if not pids:
        return []
    q = supabase.table("personnel").select("id,name,role").in_("id", list(pids))
    if role:
        q = q.eq("role", role)
    people = q.execute().data or []
    people.sort(key=lambda p: (p.get("name") or ""))
    return [_public_person(p) for p in people]


# ---------------------------------------------------------------------------
# GET /public/checklists/{token} — cabecera, plantillas y partidos
# ---------------------------------------------------------------------------
@router.get("/{token}")
def get_overview(token: str, date: Optional[str] = Query(None)):
    link = _resolve_link(token)
    competition = _competition(link["competition_id"])

    all_games = _games_of(link["competition_id"])
    dates = sorted({(g.get("date") or "")[:10] for g in all_games if g.get("date")})
    games = [g for g in all_games if (g.get("date") or "")[:10] == date[:10]] if date else all_games
    by_game = load_runs([g["id"] for g in games])

    templates = (
        supabase.table("checklist_templates")
        .select("id,name,role,description,sort_order")
        .eq("active", True)
        .execute()
        .data
    ) or []
    templates.sort(key=lambda t: (t.get("sort_order") or 0, t.get("name") or ""))

    return {
        "competition": competition,
        "templates": templates,
        "dates": dates,
        "games": [
            {
                **_public_game(g),
                "checklists": [
                    {
                        "id": r["id"],
                        "template_id": r.get("template_id"),
                        "template_name": r.get("template_name"),
                        "signed_name": r.get("signed_name"),
                        "submitted_at": r.get("submitted_at"),
                        "total": r["total"],
                        "done": r["done"],
                        "failed": r["failed"],
                        "pending_required": r["pending_required"],
                    }
                    for r in by_game.get(g["id"], [])
                ],
            }
            for g in games
        ],
    }


# ---------------------------------------------------------------------------
# GET /public/checklists/{token}/games/{game_id} — el detalle que se completa
# ---------------------------------------------------------------------------
@router.get("/{token}/games/{game_id}")
def get_game(token: str, game_id: str, role: Optional[str] = Query(None)):
    link = _resolve_link(token)
    game = _game_of_link(link, game_id)
    return {
        "game": _public_game(game),
        "checklists": load_runs([game_id]).get(game_id, []),
        "roster": _roster(link["competition_id"], role),
    }


# ---------------------------------------------------------------------------
# POST /public/checklists/{token}/games/{game_id} — abrir una corrida
# ---------------------------------------------------------------------------
@router.post("/{token}/games/{game_id}")
def start(token: str, game_id: str, data: PublicRunCreate):
    link = _resolve_link(token)
    _game_of_link(link, game_id)

    # La persona se identifica al abrir la corrida, no ítem por ítem: así la
    # firma es una sola y no depende de que el cliente la mande en cada PATCH.
    signed_name = (data.signed_name or "").strip() or None
    personnel_id = None
    if data.personnel_id:
        # Solo alguien del padrón de la competencia. Mismo criterio que
        # _person_in_role en public_availability: el link no puede usarse para
        # firmar un control a nombre de cualquier persona del sistema.
        person = next(
            (p for p in _roster(link["competition_id"], None) if p["id"] == data.personnel_id),
            None,
        )
        if not person:
            raise HTTPException(status_code=404, detail="Not found")
        personnel_id = person["id"]
        signed_name = signed_name or person.get("name")
    if not signed_name:
        raise HTTPException(status_code=400, detail="Who is running this checklist?")

    run = create_run(game_id, data.template_id)
    supabase.table("game_checklists").update({
        "personnel_id": personnel_id,
        "signed_name": signed_name,
    }).eq("id", run["id"]).execute()
    return load_run(run["id"])


# ---------------------------------------------------------------------------
# PATCH /public/checklists/{token}/items/{item_id} — marcar un ítem
# ---------------------------------------------------------------------------
@router.patch("/{token}/items/{item_id}")
def update_item(token: str, item_id: str, data: PublicItemUpdate):
    link = _resolve_link(token)
    run = _open_run_of_item(link, item_id)
    actor = run.get("signed_name") or "self"
    return apply_item_update(item_id, ItemUpdate(status=data.status, notes=data.notes), actor, "self")


# ---------------------------------------------------------------------------
# POST /public/checklists/{token}/runs/{run_id}/submit — cerrar la corrida
# ---------------------------------------------------------------------------
@router.post("/{token}/runs/{run_id}/submit")
def submit(token: str, run_id: str, data: PublicSubmit):
    link = _resolve_link(token)
    run = _run_of_link(link, run_id)
    if run.get("submitted_at"):
        raise HTTPException(status_code=409, detail="This checklist is already closed")
    return submit_run(run_id, RunSubmit(notes=data.notes), run.get("signed_name") or "self")
