"""Página pública de logística (sin auth) — el personal abre un link compartido
por competencia y ve traslados, hospedaje y manifiesto.

El token de la URL es el único credencial: resuelve a una fila de
`logistics_public_links` y todo queda acotado a esa competencia. Token
inválido, inexistente o con el link apagado contestan siempre el mismo 404,
así el endpoint no revela qué tokens existen. El bypass de auth y el rate
limit de /api/public/* viven en api/index.py.

Sobre el contenido: por decisión del cliente la página replica la planilla
completa, número de pasaporte incluido. Si alguna vez hay que ocultarlo, el
único lugar a tocar es _redact().
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from api._lib.database import supabase
from api._lib.routers.logistics import (
    PARTICIPANT_FIELDS,
    build_movement_groups,
    build_rooming,
    full_name,
)

router = APIRouter(prefix="/public/logistics", tags=["public"])


def _resolve_link(token: str) -> dict:
    """Token → fila de logistics_public_links, o un 404 uniforme."""
    # Acotar el token antes de que se vuelva un query param; los reales son de
    # 43 caracteres urlsafe base64.
    if not token or len(token) > 128:
        raise HTTPException(status_code=404, detail="Not found")
    rows = (
        supabase.table("logistics_public_links")
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
        .select("id,name,short_name,start_date,end_date,location,competition_type")
        .eq("id", competition_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Not found")
    return rows[0]


def _redact(row: dict) -> dict:
    """Punto único de recorte de la vista pública.

    Hoy no recorta nada: el cliente eligió publicar la planilla tal cual. Está
    acá para que ocultar el pasaporte sea un cambio de una línea y no una
    cacería por cuatro endpoints.
    """
    return row


# ---------------------------------------------------------------------------
# GET /public/logistics/{token} — cabecera, hoteles y comidas
# ---------------------------------------------------------------------------
@router.get("/{token}")
def get_overview(token: str):
    link = _resolve_link(token)
    competition_id = link["competition_id"]
    hotels = (
        supabase.table("logistics_hotels")
        .select("*")
        .eq("competition_id", competition_id)
        .order("name")
        .execute()
        .data
    )
    meals = (
        supabase.table("logistics_meals")
        .select("*")
        .eq("competition_id", competition_id)
        .order("date")
        .execute()
        .data
    )
    participants = (
        supabase.table("logistics_participants")
        .select("id")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    return {
        "competition": _competition(competition_id),
        "hotels": hotels,
        "meals": meals,
        "participant_count": len(participants),
    }


# ---------------------------------------------------------------------------
# GET /public/logistics/{token}/transport — cronograma de traslados
# ---------------------------------------------------------------------------
@router.get("/{token}/transport")
def get_transport(token: str, date: Optional[str] = Query(None)):
    link = _resolve_link(token)
    competition_id = link["competition_id"]

    events = (
        supabase.table("transport_events")
        .select("id")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    if not events:
        return {"dates": [], "trips": [], "date": date}

    vehicles = (
        supabase.table("transport_vehicles")
        .select("id,name,vehicle_type")
        .eq("event_id", events[0]["id"])
        .order("name")
        .execute()
        .data
    )
    if not vehicles:
        return {"dates": [], "trips": [], "date": date}
    vehicle_by_id = {v["id"]: v for v in vehicles}

    all_trips = (
        supabase.table("transport_trips")
        .select("*")
        .order("departure_time")
        .execute()
        .data
    )
    trips = [t for t in all_trips if t["vehicle_id"] in vehicle_by_id]

    # Las fechas con traslados van completas, así el visitante puede navegar
    # sin adivinar qué días tienen algo cargado.
    dates = sorted({t["date"] for t in trips if t.get("date")})
    if date:
        trips = [t for t in trips if t.get("date") == date]

    games = (
        supabase.table("game_schedule")
        .select("id,game_number,date,time,team_a,team_b,phase,group_label,venue")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    game_by_id = {g["id"]: g for g in games}

    drivers = (
        supabase.table("transport_drivers")
        .select("id,name,phone")
        .eq("event_id", events[0]["id"])
        .execute()
        .data
    )
    driver_by_id = {d["id"]: d for d in drivers}
    assignments = (
        supabase.table("transport_vehicle_drivers")
        .select("*")
        .execute()
        .data
    )
    driver_for = {
        (a["vehicle_id"], a["date"]): driver_by_id.get(a["driver_id"])
        for a in assignments
        if a["vehicle_id"] in vehicle_by_id
    }

    out = []
    for t in sorted(trips, key=lambda t: (t.get("date") or "", t.get("departure_time") or "")):
        out.append({
            **t,
            "vehicle": vehicle_by_id.get(t["vehicle_id"]),
            "driver": driver_for.get((t["vehicle_id"], t.get("date"))),
            "game": game_by_id.get(t.get("game_id")),
        })
    return {"dates": dates, "trips": out, "date": date}


# ---------------------------------------------------------------------------
# GET /public/logistics/{token}/manifest — llegadas y salidas
# ---------------------------------------------------------------------------
@router.get("/{token}/manifest")
def get_manifest(token: str):
    link = _resolve_link(token)
    competition_id = link["competition_id"]

    people = (
        supabase.table("logistics_participants")
        .select(PARTICIPANT_FIELDS)
        .eq("competition_id", competition_id)
        .order("last_name")
        .execute()
        .data
    )
    if not people:
        return {"rows": [], "arrival_groups": [], "departure_groups": []}

    by_id = {p["id"]: p for p in people}
    legs = (
        supabase.table("logistics_travel_legs")
        .select("*")
        .in_("participant_id", list(by_id))
        .execute()
        .data
    )
    legs_by_person: dict = {}
    for leg in legs:
        legs_by_person.setdefault(leg["participant_id"], []).append(leg)

    rows = []
    for p in people:
        person_legs = legs_by_person.get(p["id"], [])
        rows.append(_redact({
            "participant_id": p["id"],
            "name": full_name(p),
            "first_name": p.get("first_name"),
            "last_name": p.get("last_name"),
            "role": p.get("role"),
            "category": p.get("category"),
            "passport": p.get("passport"),
            "pax": p.get("pax"),
            "arrival": next((l for l in person_legs if l["direction"] == "arrival"), None),
            "departure": next((l for l in person_legs if l["direction"] == "departure"), None),
        }))

    return {
        "rows": rows,
        "arrival_groups": build_movement_groups(competition_id, "arrival"),
        "departure_groups": build_movement_groups(competition_id, "departure"),
    }


# ---------------------------------------------------------------------------
# GET /public/logistics/{token}/rooming — rooming list con la grilla de noches
# ---------------------------------------------------------------------------
@router.get("/{token}/rooming")
def get_rooming(token: str):
    link = _resolve_link(token)
    data = build_rooming(link["competition_id"])
    data["rows"] = [_redact(r) for r in data["rows"]]
    return data
