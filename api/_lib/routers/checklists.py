"""Control de operación por partido — checklists técnicos de sede.

El VGO llega a la sede y prueba reloj, fill & key, software, GFX y stats. Esto
registra esa corrida contra el partido: qué se probó, con qué resultado, quién
lo firmó y a qué hora.

Tres cosas que no son obvias leyendo el código:

* Las plantillas son datos (`checklist_templates`). Agregar un checklist de TD
  o de médico no toca este archivo.
* Crear una corrida COPIA los ítems de la plantilla. Editarla después no
  reescribe lo ya firmado — ver migración 038.
* El estado (pending / in_progress / submitted / failed) se deriva de los ítems
  en `_run_state()`, no se guarda. Una columna de estado se desincroniza el día
  que alguien toca un ítem por SQL.

Permiso: `games`, el mismo del crew y del staffing plan.
"""
import io
import logging
import os
import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

import qrcode

from api._lib.auth import require_edit, require_view
from api._lib.database import supabase
from api._lib.roles import VALID_ROLES

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/checklists",
    tags=["checklists"],
    dependencies=[Depends(require_view("games"))],
)

_PUBLIC_BASE = (os.environ.get("PUBLIC_APP_URL") or "https://www.fibaapp.com").rstrip("/")

ITEM_STATUSES = ("pending", "ok", "fail", "na")
# Techos para que un payload malicioso no arme una plantilla de 10k ítems.
_MAX_ITEMS = 60
_MAX_LABEL = 200
_MAX_NOTES = 1000


# ── Schemas ──────────────────────────────────────────────────────────────────

class TemplateItemIn(BaseModel):
    label: str = Field(min_length=1, max_length=_MAX_LABEL)
    hint: Optional[str] = Field(default=None, max_length=_MAX_LABEL)
    required: bool = True


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=_MAX_LABEL)
    role: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=_MAX_NOTES)
    active: bool = True
    sort_order: int = 0
    items: list[TemplateItemIn] = []


class TemplateUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=_MAX_LABEL)
    role: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=_MAX_NOTES)
    active: Optional[bool] = None
    sort_order: Optional[int] = None
    # Si viene, reemplaza los ítems completos. Omitirlo los deja como están.
    items: Optional[list[TemplateItemIn]] = None


class RunCreate(BaseModel):
    template_id: str


class ItemUpdate(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=_MAX_NOTES)


class RunSubmit(BaseModel):
    personnel_id: Optional[str] = None
    signed_name: Optional[str] = Field(default=None, max_length=_MAX_LABEL)
    notes: Optional[str] = Field(default=None, max_length=_MAX_NOTES)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _actor(request: Request) -> str:
    """Nombre legible del usuario logueado, para congelar en checked_by."""
    user = getattr(request.state, "user", None) or {}
    return user.get("email") or user.get("id") or "admin"


def _actor_id(request: Request) -> Optional[str]:
    user = getattr(request.state, "user", None) or {}
    return user.get("id")


def _validate_role(role: Optional[str]) -> Optional[str]:
    if role in (None, ""):
        return None
    if role not in VALID_ROLES:
        raise HTTPException(400, f"Unknown role '{role}'")
    return role


def run_state(items: list[dict]) -> dict:
    """Estado derivado de una corrida. Ver el docstring del módulo.

    `done` cuenta los ítems resueltos (ok/fail/na). `pending_required` es lo que
    falta para poder cerrar: un ítem opcional sin marcar no bloquea.
    """
    total = len(items)
    done = sum(1 for i in items if i.get("status") in ("ok", "fail", "na"))
    failed = sum(1 for i in items if i.get("status") == "fail")
    pending_required = sum(
        1 for i in items if i.get("required") and i.get("status") == "pending"
    )
    return {
        "total": total,
        "done": done,
        "failed": failed,
        "pending_required": pending_required,
    }


def load_runs(game_ids: list[str]) -> dict[str, list[dict]]:
    """game_id → corridas con sus ítems y su estado. Dos queries, sin N+1."""
    if not game_ids:
        return {}
    runs = (
        supabase.table("game_checklists")
        .select("*")
        .in_("game_id", game_ids)
        .execute()
        .data
    ) or []
    if not runs:
        return {}

    items = (
        supabase.table("game_checklist_items")
        .select("*")
        .in_("checklist_id", [r["id"] for r in runs])
        .execute()
        .data
    ) or []
    items.sort(key=lambda i: (i.get("sort_order") or 0, i.get("label") or ""))

    by_run: dict[str, list[dict]] = {}
    for it in items:
        by_run.setdefault(it["checklist_id"], []).append(it)

    by_game: dict[str, list[dict]] = {}
    for r in runs:
        run_items = by_run.get(r["id"], [])
        by_game.setdefault(r["game_id"], []).append(
            {**r, "items": run_items, **run_state(run_items)}
        )
    for rows in by_game.values():
        rows.sort(key=lambda r: (r.get("template_name") or ""))
    return by_game


def _load_template(template_id: str) -> dict:
    rows = (
        supabase.table("checklist_templates")
        .select("*")
        .eq("id", template_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(404, "Template not found")
    return rows[0]


def _template_items(template_id: str) -> list[dict]:
    rows = (
        supabase.table("checklist_template_items")
        .select("*")
        .eq("template_id", template_id)
        .execute()
        .data
    ) or []
    rows.sort(key=lambda i: (i.get("sort_order") or 0, i.get("label") or ""))
    return rows


def create_run(game_id: str, template_id: str, created_by: Optional[str] = None) -> dict:
    """Crea la corrida copiando los ítems de la plantilla.

    Compartida con el router público: es el mismo acto, cambia quién lo dispara.
    """
    template = _load_template(template_id)
    if not template.get("active"):
        raise HTTPException(400, "Template is not active")

    existing = (
        supabase.table("game_checklists")
        .select("id")
        .eq("game_id", game_id)
        .eq("template_id", template_id)
        .execute()
        .data
    )
    if existing:
        raise HTTPException(409, "This checklist is already open on the game")

    created = supabase.table("game_checklists").insert({
        "game_id": game_id,
        "template_id": template_id,
        "template_name": template["name"],
        "role": template.get("role"),
        "created_by": created_by,
    }).execute().data[0]

    src = _template_items(template_id)
    if src:
        supabase.table("game_checklist_items").insert([
            {
                "checklist_id": created["id"],
                "template_item_id": i["id"],
                "label": i["label"],
                "hint": i.get("hint"),
                "required": i.get("required", True),
                "sort_order": i.get("sort_order") or 0,
            }
            for i in src
        ]).execute()

    items = load_runs([game_id]).get(game_id, [])
    for r in items:
        if r["id"] == created["id"]:
            return r
    return {**created, "items": [], **run_state([])}


def apply_item_update(item_id: str, patch: ItemUpdate, actor: str, source: str) -> dict:
    """Marca un ítem. Devuelve la fila actualizada.

    `source` es 'admin' o 'self' — de dónde vino la marca (ver migración 038).
    """
    rows = (
        supabase.table("game_checklist_items")
        .select("*")
        .eq("id", item_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(404, "Checklist item not found")

    update: dict = {}
    if patch.status is not None:
        if patch.status not in ITEM_STATUSES:
            raise HTTPException(400, f"status must be one of {ITEM_STATUSES}")
        update["status"] = patch.status
        # 'pending' es "todavía no lo probé": limpia la firma para que no quede
        # un checked_by de una marca que ya no existe.
        if patch.status == "pending":
            update["checked_at"] = None
            update["checked_by"] = None
            update["checked_source"] = None
        else:
            update["checked_at"] = datetime.now(timezone.utc).isoformat()
            update["checked_by"] = actor
            update["checked_source"] = source
    if patch.notes is not None:
        update["notes"] = patch.notes or None
    if not update:
        return rows[0]

    return (
        supabase.table("game_checklist_items")
        .update(update)
        .eq("id", item_id)
        .execute()
        .data[0]
    )


def load_run(run_id: str) -> dict:
    rows = (
        supabase.table("game_checklists")
        .select("*")
        .eq("id", run_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(404, "Checklist not found")
    run = rows[0]
    for r in load_runs([run["game_id"]]).get(run["game_id"], []):
        if r["id"] == run_id:
            return r
    return {**run, "items": [], **run_state([])}


def submit_run(run_id: str, data: RunSubmit, fallback_name: str) -> dict:
    """Cierra la corrida. Falla si queda algún ítem requerido sin marcar."""
    run = load_run(run_id)
    if run["pending_required"] > 0:
        raise HTTPException(
            400,
            f"{run['pending_required']} required item(s) still unchecked",
        )
    update = {
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "signed_name": data.signed_name or run.get("signed_name") or fallback_name,
    }
    if data.personnel_id:
        update["personnel_id"] = data.personnel_id
    if data.notes is not None:
        update["notes"] = data.notes or None
    supabase.table("game_checklists").update(update).eq("id", run_id).execute()
    return load_run(run_id)


# ── Plantillas ───────────────────────────────────────────────────────────────

@router.get("/templates")
def list_templates(include_inactive: bool = Query(False)):
    """Plantillas con sus ítems. Las inactivas quedan fuera salvo pedido."""
    q = supabase.table("checklist_templates").select("*")
    if not include_inactive:
        q = q.eq("active", True)
    templates = q.execute().data or []
    if not templates:
        return []

    items = (
        supabase.table("checklist_template_items")
        .select("*")
        .in_("template_id", [t["id"] for t in templates])
        .execute()
        .data
    ) or []
    items.sort(key=lambda i: (i.get("sort_order") or 0, i.get("label") or ""))
    by_tpl: dict[str, list[dict]] = {}
    for i in items:
        by_tpl.setdefault(i["template_id"], []).append(i)

    templates.sort(key=lambda t: (t.get("sort_order") or 0, t.get("name") or ""))
    return [{**t, "items": by_tpl.get(t["id"], [])} for t in templates]


def _replace_template_items(template_id: str, items: list[TemplateItemIn]):
    if len(items) > _MAX_ITEMS:
        raise HTTPException(400, f"A template takes at most {_MAX_ITEMS} items")
    supabase.table("checklist_template_items").delete().eq("template_id", template_id).execute()
    if items:
        supabase.table("checklist_template_items").insert([
            {
                "template_id": template_id,
                "label": i.label.strip(),
                "hint": (i.hint or "").strip() or None,
                "required": i.required,
                "sort_order": (n + 1) * 10,
            }
            for n, i in enumerate(items)
        ]).execute()


@router.post("/templates", dependencies=[Depends(require_edit("games"))])
def create_template(data: TemplateIn, request: Request):
    created = supabase.table("checklist_templates").insert({
        "name": data.name.strip(),
        "role": _validate_role(data.role),
        "description": (data.description or "").strip() or None,
        "active": data.active,
        "sort_order": data.sort_order,
        "created_by": _actor_id(request),
    }).execute().data[0]
    _replace_template_items(created["id"], data.items)
    return {**created, "items": _template_items(created["id"])}


@router.put("/templates/{template_id}", dependencies=[Depends(require_edit("games"))])
def update_template(template_id: str, data: TemplateUpdate):
    _load_template(template_id)
    update: dict = {}
    if data.name is not None:
        update["name"] = data.name.strip()
    if data.role is not None:
        update["role"] = _validate_role(data.role)
    if data.description is not None:
        update["description"] = data.description.strip() or None
    if data.active is not None:
        update["active"] = data.active
    if data.sort_order is not None:
        update["sort_order"] = data.sort_order
    if update:
        supabase.table("checklist_templates").update(update).eq("id", template_id).execute()
    if data.items is not None:
        # Solo toca la plantilla: las corridas ya creadas tienen los ítems
        # copiados y no se enteran (migración 038, decisión 3).
        _replace_template_items(template_id, data.items)
    return {**_load_template(template_id), "items": _template_items(template_id)}


@router.delete("/templates/{template_id}", dependencies=[Depends(require_edit("games"))])
def delete_template(template_id: str):
    """Borra la plantilla. Las corridas hechas sobreviven con el nombre y los
    ítems congelados (FKs en SET NULL — ver migración 038)."""
    _load_template(template_id)
    supabase.table("checklist_templates").delete().eq("id", template_id).execute()
    return {"ok": True}


# ── Corridas ─────────────────────────────────────────────────────────────────

@router.get("/games/{game_id}")
def list_game_checklists(game_id: str):
    return load_runs([game_id]).get(game_id, [])


@router.get("/summary")
def competition_summary(competition_id: str = Query(...)):
    """Resumen por partido, para los badges del calendario de juegos.

    Una sola llamada para toda la competencia: la página pinta N cards y no
    puede pedir una corrida por card.
    """
    games = (
        supabase.table("game_schedule")
        .select("id")
        .eq("competition_id", competition_id)
        .execute()
        .data
    ) or []
    by_game = load_runs([g["id"] for g in games])

    summary = {}
    for game_id, runs in by_game.items():
        summary[game_id] = {
            "runs": len(runs),
            "total": sum(r["total"] for r in runs),
            "done": sum(r["done"] for r in runs),
            "failed": sum(r["failed"] for r in runs),
            "submitted": sum(1 for r in runs if r.get("submitted_at")),
        }
    return summary


@router.post("/games/{game_id}", dependencies=[Depends(require_edit("games"))])
def start_checklist(game_id: str, data: RunCreate, request: Request):
    game = supabase.table("game_schedule").select("id").eq("id", game_id).execute().data
    if not game:
        raise HTTPException(404, "Game not found")
    return create_run(game_id, data.template_id, created_by=_actor_id(request))


@router.delete("/runs/{run_id}", dependencies=[Depends(require_edit("games"))])
def delete_checklist(run_id: str):
    supabase.table("game_checklists").delete().eq("id", run_id).execute()
    return {"ok": True}


@router.patch("/items/{item_id}", dependencies=[Depends(require_edit("games"))])
def update_item(item_id: str, data: ItemUpdate, request: Request):
    return apply_item_update(item_id, data, _actor(request), "admin")


@router.post("/runs/{run_id}/submit", dependencies=[Depends(require_edit("games"))])
def submit_checklist(run_id: str, data: RunSubmit, request: Request):
    return submit_run(run_id, data, _actor(request))


@router.post("/runs/{run_id}/reopen", dependencies=[Depends(require_edit("games"))])
def reopen_checklist(run_id: str):
    """Vuelve a abrir una corrida cerrada, sin tocar lo ya marcado."""
    load_run(run_id)
    supabase.table("game_checklists").update({"submitted_at": None}).eq("id", run_id).execute()
    return load_run(run_id)


# ── Link público ─────────────────────────────────────────────────────────────
# Un link por competencia. La lectura pide require_edit igual que en logística:
# el token es un secreto que además ESCRIBE, así que quien solo puede mirar no
# debería poder llevárselo.

def _link_row(competition_id: str) -> Optional[dict]:
    rows = (
        supabase.table("checklist_public_links")
        .select("*")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    return rows[0] if rows else None


def _with_url(link: dict) -> dict:
    return {**link, "url": f"{_PUBLIC_BASE}/checklist/{link['token']}"}


@router.get("/link/{competition_id}", dependencies=[Depends(require_edit("games"))])
def get_public_link(competition_id: str):
    """Link de la competencia; se crea la primera vez que se lo pide."""
    link = _link_row(competition_id)
    if not link:
        link = supabase.table("checklist_public_links").insert({
            "competition_id": competition_id,
            "token": secrets.token_urlsafe(32),
        }).execute().data[0]
    return _with_url(link)


@router.post("/link/{competition_id}/rotate", dependencies=[Depends(require_edit("games"))])
def rotate_public_link(competition_id: str):
    """Cambia el token — el link que ya se compartió deja de funcionar."""
    if not _link_row(competition_id):
        raise HTTPException(404, "Link not found — open the share panel first")
    updated = supabase.table("checklist_public_links").update({
        "token": secrets.token_urlsafe(32),
        "rotated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("competition_id", competition_id).execute()
    return _with_url(updated.data[0])


@router.put("/link/{competition_id}/toggle", dependencies=[Depends(require_edit("games"))])
def toggle_public_link(competition_id: str, enabled: bool = Query(...)):
    """Apaga o prende el link sin cambiar el token."""
    if not _link_row(competition_id):
        raise HTTPException(404, "Link not found — open the share panel first")
    updated = supabase.table("checklist_public_links").update(
        {"enabled": enabled}
    ).eq("competition_id", competition_id).execute()
    return _with_url(updated.data[0])


@router.get("/link/{competition_id}/qr.png", dependencies=[Depends(require_edit("games"))])
def public_link_qr(competition_id: str):
    """QR para pegar en la mesa de control o mandarlo al grupo de oficiales."""
    link = _link_row(competition_id)
    if not link:
        raise HTTPException(404, "Link not found — open the share panel first")
    img = qrcode.make(f"{_PUBLIC_BASE}/checklist/{link['token']}")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")
