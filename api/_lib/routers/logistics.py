"""Logística: padrón de participantes, travel manifest, hospedaje y comidas.

Transporte (vehículos, choferes, viajes) sigue viviendo en transport.py; las
dos mitades comparten el permiso 'logistics'. Acá está todo lo que cuelga del
padrón de participantes de una competencia, más el link público que se comparte
con el personal.
"""
import io
import os
import secrets
from datetime import date, datetime, timezone
from typing import Optional

import qrcode
from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile, File
from pydantic import BaseModel

from api._lib.auth import require_edit, require_view
from api._lib.database import supabase

router = APIRouter(
    prefix="/logistics",
    tags=["logistics"],
    dependencies=[Depends(require_view("logistics"))],
)

_PUBLIC_BASE = (os.environ.get("PUBLIC_APP_URL") or "https://www.fibaapp.com").rstrip("/")

CATEGORIES = ("official", "fiba_staff", "vip", "team", "guest")
DIRECTIONS = ("arrival", "departure")
TRANSPORT_MODES = ("flight", "bus", "ferry", "car", "other")
MEALS = ("breakfast", "lunch", "dinner", "snack")

# Tope de subida para los imports de Excel (5 MB, igual que personnel).
_MAX_UPLOAD = 5 * 1024 * 1024


# ── Schemas ──────────────────────────────────────────────────────────────────

class ParticipantCreate(BaseModel):
    competition_id: str
    first_name: str
    last_name: Optional[str] = None
    role: Optional[str] = None
    category: str = "official"
    personnel_id: Optional[str] = None
    employee_id: Optional[str] = None
    passport: Optional[str] = None
    nationality: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    dietary_restrictions: Optional[str] = None
    pax: int = 1
    notes: Optional[str] = None


class ParticipantUpdate(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: Optional[str] = None
    category: Optional[str] = None
    personnel_id: Optional[str] = None
    employee_id: Optional[str] = None
    passport: Optional[str] = None
    nationality: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    dietary_restrictions: Optional[str] = None
    pax: Optional[int] = None
    notes: Optional[str] = None


class TravelLegCreate(BaseModel):
    participant_id: str
    direction: str
    date: Optional[str] = None
    time: Optional[str] = None
    pickup_time: Optional[str] = None
    flight_number: Optional[str] = None
    carrier: Optional[str] = None
    airport: Optional[str] = None
    transport_mode: str = "flight"
    comments: Optional[str] = None
    trip_id: Optional[str] = None


class TravelLegUpdate(BaseModel):
    direction: Optional[str] = None
    date: Optional[str] = None
    time: Optional[str] = None
    pickup_time: Optional[str] = None
    flight_number: Optional[str] = None
    carrier: Optional[str] = None
    airport: Optional[str] = None
    transport_mode: Optional[str] = None
    comments: Optional[str] = None
    trip_id: Optional[str] = None


class HotelCreate(BaseModel):
    competition_id: str
    name: str
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    check_in_time: Optional[str] = None
    check_out_time: Optional[str] = None
    map_url: Optional[str] = None
    notes: Optional[str] = None
    is_primary: bool = False


class HotelUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    check_in_time: Optional[str] = None
    check_out_time: Optional[str] = None
    map_url: Optional[str] = None
    notes: Optional[str] = None
    is_primary: Optional[bool] = None


class StayCreate(BaseModel):
    participant_id: str
    hotel_id: Optional[str] = None
    room_type: Optional[str] = None
    room_number: Optional[str] = None
    check_in: Optional[str] = None
    check_out: Optional[str] = None
    share_with_id: Optional[str] = None
    comments: Optional[str] = None


class StayUpdate(BaseModel):
    hotel_id: Optional[str] = None
    room_type: Optional[str] = None
    room_number: Optional[str] = None
    check_in: Optional[str] = None
    check_out: Optional[str] = None
    share_with_id: Optional[str] = None
    comments: Optional[str] = None


class MealCreate(BaseModel):
    competition_id: str
    hotel_id: Optional[str] = None
    date: Optional[str] = None
    meal: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None


class MealUpdate(BaseModel):
    hotel_id: Optional[str] = None
    date: Optional[str] = None
    meal: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    notes: Optional[str] = None


# ── Helpers compartidos ──────────────────────────────────────────────────────

PARTICIPANT_FIELDS = (
    "id,competition_id,personnel_id,employee_id,first_name,last_name,role,"
    "category,passport,nationality,phone,email,dietary_restrictions,pax,notes"
)


def participant_ids(competition_id: str) -> list[str]:
    rows = (
        supabase.table("logistics_participants")
        .select("id")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    return [r["id"] for r in rows]


def full_name(p: dict) -> str:
    return " ".join(x for x in (p.get("first_name"), p.get("last_name")) if x).strip()


def _participant_or_404(participant_id: str) -> dict:
    rows = (
        supabase.table("logistics_participants")
        .select(PARTICIPANT_FIELDS)
        .eq("id", participant_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(404, "Participant not found")
    return rows[0]


def nights(stay: dict) -> int:
    """Noches de una estadía. La grilla del Excel se deriva de esto."""
    if not stay.get("check_in") or not stay.get("check_out"):
        return 0
    try:
        start = date.fromisoformat(stay["check_in"])
        end = date.fromisoformat(stay["check_out"])
    except ValueError:
        return 0
    return max((end - start).days, 0)


# ── Participantes ────────────────────────────────────────────────────────────

@router.get("/participants")
def list_participants(competition_id: str = Query(...)):
    """Padrón de la competencia, enriquecido con la estadía y los tramos.

    Devuelve todo junto porque las tres pestañas del módulo arrancan del mismo
    padrón y separarlo obligaría a la UI a hacer tres viajes en cascada.
    """
    people = (
        supabase.table("logistics_participants")
        .select(PARTICIPANT_FIELDS)
        .eq("competition_id", competition_id)
        .order("last_name")
        .execute()
        .data
    )
    if not people:
        return []

    ids = [p["id"] for p in people]
    legs = (
        supabase.table("logistics_travel_legs")
        .select("*")
        .in_("participant_id", ids)
        .execute()
        .data
    )
    stays = (
        supabase.table("logistics_stays")
        .select("*")
        .in_("participant_id", ids)
        .execute()
        .data
    )

    legs_by_person: dict = {}
    for leg in legs:
        legs_by_person.setdefault(leg["participant_id"], []).append(leg)
    stay_by_person = {s["participant_id"]: s for s in stays}

    for p in people:
        person_legs = legs_by_person.get(p["id"], [])
        p["arrival"] = next((l for l in person_legs if l["direction"] == "arrival"), None)
        p["departure"] = next((l for l in person_legs if l["direction"] == "departure"), None)
        p["legs"] = sorted(person_legs, key=lambda l: (l.get("date") or "", l.get("time") or ""))
        stay = stay_by_person.get(p["id"])
        p["stay"] = {**stay, "nights": nights(stay)} if stay else None
    return people


@router.post("/participants", dependencies=[Depends(require_edit("logistics"))])
def create_participant(data: ParticipantCreate):
    if data.category not in CATEGORIES:
        raise HTTPException(400, f"category must be one of {', '.join(CATEGORIES)}")
    result = supabase.table("logistics_participants").insert(data.model_dump()).execute()
    return result.data[0]


@router.put("/participants/{participant_id}", dependencies=[Depends(require_edit("logistics"))])
def update_participant(participant_id: str, data: ParticipantUpdate):
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    if updates.get("category") and updates["category"] not in CATEGORIES:
        raise HTTPException(400, f"category must be one of {', '.join(CATEGORIES)}")
    r = supabase.table("logistics_participants").update(updates).eq("id", participant_id).execute()
    if not r.data:
        raise HTTPException(404, "Participant not found")
    return r.data[0]


@router.delete("/participants/{participant_id}", dependencies=[Depends(require_edit("logistics"))])
def delete_participant(participant_id: str):
    supabase.table("logistics_participants").delete().eq("id", participant_id).execute()
    return {"ok": True}


@router.post("/participants/from-crew", dependencies=[Depends(require_edit("logistics"))])
def import_from_crew(competition_id: str = Query(...)):
    """Sembrar el padrón con los oficiales ya asignados a la competencia.

    Evita tipear de nuevo gente que el sistema ya conoce. No pisa a nadie: si
    la persona ya está en el padrón (por personnel_id) se la saltea.
    """
    crew = (
        supabase.table("competition_assignments")
        .select("personnel_id,role")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    if not crew:
        return {"created": 0, "skipped": 0}

    existing = (
        supabase.table("logistics_participants")
        .select("personnel_id")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    already = {r["personnel_id"] for r in existing if r.get("personnel_id")}

    wanted = [c for c in crew if c.get("personnel_id") and c["personnel_id"] not in already]
    if not wanted:
        return {"created": 0, "skipped": len(crew)}

    people = (
        supabase.table("personnel")
        .select("id,name,country,passport,phone,email")
        .in_("id", [c["personnel_id"] for c in wanted])
        .execute()
        .data
    )
    by_id = {p["id"]: p for p in people}

    records = []
    for c in wanted:
        person = by_id.get(c["personnel_id"])
        if not person:
            continue
        parts = (person.get("name") or "").split()
        records.append({
            "competition_id": competition_id,
            "personnel_id": person["id"],
            "first_name": parts[0] if parts else person.get("name") or "?",
            "last_name": " ".join(parts[1:]) or None,
            "role": c.get("role"),
            "category": "official",
            "passport": person.get("passport"),
            "nationality": person.get("country"),
            "phone": person.get("phone"),
            "email": person.get("email"),
        })
    if not records:
        return {"created": 0, "skipped": len(crew)}
    supabase.table("logistics_participants").insert(records).execute()
    return {"created": len(records), "skipped": len(crew) - len(records)}


# ── Travel manifest ──────────────────────────────────────────────────────────

@router.get("/travel-legs")
def list_travel_legs(competition_id: str = Query(...)):
    ids = participant_ids(competition_id)
    if not ids:
        return []
    return (
        supabase.table("logistics_travel_legs")
        .select("*")
        .in_("participant_id", ids)
        .order("date")
        .execute()
        .data
    )


@router.post("/travel-legs", dependencies=[Depends(require_edit("logistics"))])
def create_travel_leg(data: TravelLegCreate):
    if data.direction not in DIRECTIONS:
        raise HTTPException(400, f"direction must be one of {', '.join(DIRECTIONS)}")
    if data.transport_mode not in TRANSPORT_MODES:
        raise HTTPException(400, f"transport_mode must be one of {', '.join(TRANSPORT_MODES)}")
    _participant_or_404(data.participant_id)
    result = supabase.table("logistics_travel_legs").insert(data.model_dump()).execute()
    return result.data[0]


@router.put("/travel-legs/{leg_id}", dependencies=[Depends(require_edit("logistics"))])
def update_travel_leg(leg_id: str, data: TravelLegUpdate):
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    # Las columnas NOT NULL no se pueden limpiar: omitirlas es distinto de
    # mandarlas en null.
    for col, valid in (("direction", DIRECTIONS), ("transport_mode", TRANSPORT_MODES)):
        if col in updates:
            if updates[col] is None:
                updates.pop(col)
            elif updates[col] not in valid:
                raise HTTPException(400, f"{col} must be one of {', '.join(valid)}")
    r = supabase.table("logistics_travel_legs").update(updates).eq("id", leg_id).execute()
    if not r.data:
        raise HTTPException(404, "Travel leg not found")
    return r.data[0]


@router.delete("/travel-legs/{leg_id}", dependencies=[Depends(require_edit("logistics"))])
def delete_travel_leg(leg_id: str):
    supabase.table("logistics_travel_legs").delete().eq("id", leg_id).execute()
    return {"ok": True}


def build_movement_groups(competition_id: str, direction: str) -> list[dict]:
    """Agrupa tramos por fecha + aeropuerto, que es como se arma un traslado.

    Es la hoja "Hoja1" del manifest: nadie manda una combi por persona, se
    juntan los que caen en el mismo aeropuerto el mismo día.
    """
    people = (
        supabase.table("logistics_participants")
        .select(PARTICIPANT_FIELDS)
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    if not people:
        return []
    by_id = {p["id"]: p for p in people}

    legs = (
        supabase.table("logistics_travel_legs")
        .select("*")
        .in_("participant_id", list(by_id))
        .eq("direction", direction)
        .execute()
        .data
    )

    groups: dict = {}
    for leg in legs:
        key = (leg.get("date") or "", leg.get("airport") or "")
        person = by_id.get(leg["participant_id"])
        groups.setdefault(key, []).append({
            **leg,
            "participant_name": full_name(person) if person else "",
            "participant_role": (person or {}).get("role"),
            "pax": (person or {}).get("pax", 1),
        })

    out = []
    for (day, airport), items in sorted(groups.items()):
        items.sort(key=lambda l: (l.get("time") or "99:99", l.get("participant_name") or ""))
        out.append({
            "date": day or None,
            "airport": airport or None,
            "pax": sum(i.get("pax") or 1 for i in items),
            "legs": items,
        })
    return out


@router.get("/movements")
def list_movements(competition_id: str = Query(...)):
    """Llegadas y salidas agrupadas, listas para convertir en traslados."""
    return {
        "arrivals": build_movement_groups(competition_id, "arrival"),
        "departures": build_movement_groups(competition_id, "departure"),
    }


# ── Hoteles ──────────────────────────────────────────────────────────────────

@router.get("/hotels")
def list_hotels(competition_id: str = Query(...)):
    return (
        supabase.table("logistics_hotels")
        .select("*")
        .eq("competition_id", competition_id)
        .order("name")
        .execute()
        .data
    )


@router.post("/hotels", dependencies=[Depends(require_edit("logistics"))])
def create_hotel(data: HotelCreate):
    result = supabase.table("logistics_hotels").insert(data.model_dump()).execute()
    return result.data[0]


@router.put("/hotels/{hotel_id}", dependencies=[Depends(require_edit("logistics"))])
def update_hotel(hotel_id: str, data: HotelUpdate):
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    r = supabase.table("logistics_hotels").update(updates).eq("id", hotel_id).execute()
    if not r.data:
        raise HTTPException(404, "Hotel not found")
    return r.data[0]


@router.delete("/hotels/{hotel_id}", dependencies=[Depends(require_edit("logistics"))])
def delete_hotel(hotel_id: str):
    supabase.table("logistics_hotels").delete().eq("id", hotel_id).execute()
    return {"ok": True}


# ── Rooming list ─────────────────────────────────────────────────────────────

def build_rooming(competition_id: str) -> dict:
    """Rooming list con la grilla de noches que espera el hotel.

    `dates` son las columnas (una por noche) y cada fila trae en qué noches
    está esa persona. La grilla no se guarda: sale de check_in/check_out.
    """
    people = (
        supabase.table("logistics_participants")
        .select(PARTICIPANT_FIELDS)
        .eq("competition_id", competition_id)
        .order("last_name")
        .execute()
        .data
    )
    if not people:
        return {"dates": [], "rows": [], "total_nights": 0, "hotels": []}

    by_id = {p["id"]: p for p in people}
    stays = (
        supabase.table("logistics_stays")
        .select("*")
        .in_("participant_id", list(by_id))
        .execute()
        .data
    )
    hotels = (
        supabase.table("logistics_hotels")
        .select("*")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    hotel_by_id = {h["id"]: h for h in hotels}

    # Columnas: cada noche entre el primer check-in y el último check-out.
    bounds = [s for s in stays if s.get("check_in") and s.get("check_out")]
    dates: list[str] = []
    if bounds:
        first = min(date.fromisoformat(s["check_in"]) for s in bounds)
        last = max(date.fromisoformat(s["check_out"]) for s in bounds)
        cursor = first
        while cursor <= last:
            dates.append(cursor.isoformat())
            cursor = date.fromordinal(cursor.toordinal() + 1)

    stay_by_person = {s["participant_id"]: s for s in stays}
    rows = []
    for p in people:
        stay = stay_by_person.get(p["id"])
        if not stay:
            continue
        n = nights(stay)
        grid = {}
        if stay.get("check_in") and stay.get("check_out"):
            start = date.fromisoformat(stay["check_in"])
            end = date.fromisoformat(stay["check_out"])
            for d in dates:
                current = date.fromisoformat(d)
                if start <= current < end:
                    grid[d] = "1"
                elif current == end:
                    grid[d] = "OUT"
        share = by_id.get(stay.get("share_with_id")) if stay.get("share_with_id") else None
        # Al hotel se le factura la habitación, no la cama: de una pareja que
        # comparte cuarto, las noches las cuenta una sola de las dos filas. El
        # criterio es el id más chico — arbitrario, pero estable entre lecturas.
        is_room_holder = not stay.get("share_with_id") or p["id"] < stay["share_with_id"]
        rows.append({
            "is_room_holder": is_room_holder,
            "participant_id": p["id"],
            "name": full_name(p),
            "first_name": p.get("first_name"),
            "last_name": p.get("last_name"),
            "role": p.get("role"),
            "category": p.get("category"),
            "passport": p.get("passport"),
            "dietary_restrictions": p.get("dietary_restrictions"),
            "hotel": (hotel_by_id.get(stay.get("hotel_id")) or {}).get("name"),
            "hotel_id": stay.get("hotel_id"),
            "room_type": stay.get("room_type"),
            "room_number": stay.get("room_number"),
            "check_in": stay.get("check_in"),
            "check_out": stay.get("check_out"),
            "share_with": full_name(share) if share else None,
            "share_with_id": stay.get("share_with_id"),
            "comments": stay.get("comments"),
            "nights": n,
            "grid": grid,
            "stay_id": stay["id"],
        })

    return {
        "dates": dates,
        "rows": rows,
        "total_nights": sum(r["nights"] for r in rows if r["is_room_holder"]),
        "person_nights": sum(r["nights"] for r in rows),
        "hotels": hotels,
    }


@router.get("/rooming")
def get_rooming(competition_id: str = Query(...)):
    return build_rooming(competition_id)


@router.post("/stays", dependencies=[Depends(require_edit("logistics"))])
def create_stay(data: StayCreate):
    _participant_or_404(data.participant_id)
    result = supabase.table("logistics_stays").insert(data.model_dump()).execute()
    return result.data[0]


@router.put("/stays/{stay_id}", dependencies=[Depends(require_edit("logistics"))])
def update_stay(stay_id: str, data: StayUpdate):
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    r = supabase.table("logistics_stays").update(updates).eq("id", stay_id).execute()
    if not r.data:
        raise HTTPException(404, "Stay not found")
    return r.data[0]


@router.delete("/stays/{stay_id}", dependencies=[Depends(require_edit("logistics"))])
def delete_stay(stay_id: str):
    supabase.table("logistics_stays").delete().eq("id", stay_id).execute()
    return {"ok": True}


# ── Alimentación ─────────────────────────────────────────────────────────────

@router.get("/meals")
def list_meals(competition_id: str = Query(...)):
    return (
        supabase.table("logistics_meals")
        .select("*")
        .eq("competition_id", competition_id)
        .order("date")
        .execute()
        .data
    )


@router.post("/meals", dependencies=[Depends(require_edit("logistics"))])
def create_meal(data: MealCreate):
    if data.meal not in MEALS:
        raise HTTPException(400, f"meal must be one of {', '.join(MEALS)}")
    result = supabase.table("logistics_meals").insert(data.model_dump()).execute()
    return result.data[0]


@router.put("/meals/{meal_id}", dependencies=[Depends(require_edit("logistics"))])
def update_meal(meal_id: str, data: MealUpdate):
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    if "meal" in updates:
        if updates["meal"] is None:
            updates.pop("meal")
        elif updates["meal"] not in MEALS:
            raise HTTPException(400, f"meal must be one of {', '.join(MEALS)}")
    r = supabase.table("logistics_meals").update(updates).eq("id", meal_id).execute()
    if not r.data:
        raise HTTPException(404, "Meal not found")
    return r.data[0]


@router.delete("/meals/{meal_id}", dependencies=[Depends(require_edit("logistics"))])
def delete_meal(meal_id: str):
    supabase.table("logistics_meals").delete().eq("id", meal_id).execute()
    return {"ok": True}


# ── Link público ─────────────────────────────────────────────────────────────
# Un link por competencia. El token es el único credencial, así que la lectura
# también pide require_edit: quien solo puede mirar no debería poder llevarse
# el secreto que abre la información de toda la competencia.

def _link_row(competition_id: str) -> Optional[dict]:
    rows = (
        supabase.table("logistics_public_links")
        .select("*")
        .eq("competition_id", competition_id)
        .execute()
        .data
    )
    return rows[0] if rows else None


def _with_url(link: dict) -> dict:
    return {**link, "url": f"{_PUBLIC_BASE}/logistica/{link['token']}"}


@router.get("/link/{competition_id}", dependencies=[Depends(require_edit("logistics"))])
def get_public_link(competition_id: str):
    """Link de la competencia; se crea la primera vez que se lo pide."""
    link = _link_row(competition_id)
    if not link:
        created = supabase.table("logistics_public_links").insert({
            "competition_id": competition_id,
            "token": secrets.token_urlsafe(32),
        }).execute()
        link = created.data[0]
    return _with_url(link)


@router.post("/link/{competition_id}/rotate", dependencies=[Depends(require_edit("logistics"))])
def rotate_public_link(competition_id: str):
    """Cambia el token — el link que ya se compartió deja de funcionar."""
    if not _link_row(competition_id):
        raise HTTPException(404, "Link not found — open the share panel first")
    updated = supabase.table("logistics_public_links").update({
        "token": secrets.token_urlsafe(32),
        "rotated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("competition_id", competition_id).execute()
    return _with_url(updated.data[0])


@router.put("/link/{competition_id}/toggle", dependencies=[Depends(require_edit("logistics"))])
def toggle_public_link(competition_id: str, enabled: bool = Query(...)):
    """Apaga o prende el link sin cambiar el token."""
    if not _link_row(competition_id):
        raise HTTPException(404, "Link not found — open the share panel first")
    updated = supabase.table("logistics_public_links").update(
        {"enabled": enabled}
    ).eq("competition_id", competition_id).execute()
    return _with_url(updated.data[0])


@router.get("/link/{competition_id}/qr.png", dependencies=[Depends(require_edit("logistics"))])
def public_link_qr(competition_id: str):
    """QR del link, para imprimirlo en el hotel o en la sala de árbitros."""
    link = _link_row(competition_id)
    if not link:
        raise HTTPException(404, "Link not found — open the share panel first")
    img = qrcode.make(f"{_PUBLIC_BASE}/logistica/{link['token']}")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


# ── Import / export de planillas ─────────────────────────────────────────────
# Dos pasos: el preview no escribe nada y muestra qué se va a crear y qué no se
# pudo interpretar; recién /commit toca la base.

async def _read_upload(file: UploadFile) -> bytes:
    content = await file.read()
    if len(content) > _MAX_UPLOAD:
        raise HTTPException(400, "File too large (max 5 MB)")
    if not (file.filename or "").lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(400, "Only .xlsx files are supported")
    return content


@router.post("/import/manifest/preview", dependencies=[Depends(require_edit("logistics"))])
async def preview_manifest_import(competition_id: str = Query(...), file: UploadFile = File(...)):
    from api._lib.services.logistics_import import preview_manifest
    return preview_manifest(await _read_upload(file), competition_id)


@router.post("/import/manifest/commit", dependencies=[Depends(require_edit("logistics"))])
async def commit_manifest_import(competition_id: str = Query(...), file: UploadFile = File(...)):
    from api._lib.services.logistics_import import commit_manifest
    return commit_manifest(await _read_upload(file), competition_id)


@router.post("/import/rooming/preview", dependencies=[Depends(require_edit("logistics"))])
async def preview_rooming_import(competition_id: str = Query(...), file: UploadFile = File(...)):
    from api._lib.services.logistics_import import preview_rooming
    return preview_rooming(await _read_upload(file), competition_id)


@router.post("/import/rooming/commit", dependencies=[Depends(require_edit("logistics"))])
async def commit_rooming_import(competition_id: str = Query(...), file: UploadFile = File(...)):
    from api._lib.services.logistics_import import commit_rooming
    return commit_rooming(await _read_upload(file), competition_id)


@router.get("/export/manifest.xlsx")
def export_manifest(competition_id: str = Query(...)):
    from api._lib.services.logistics_import import export_manifest_xlsx
    content = export_manifest_xlsx(competition_id)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="flight-manifest.xlsx"'},
    )


@router.get("/export/rooming.xlsx")
def export_rooming(competition_id: str = Query(...)):
    from api._lib.services.logistics_import import export_rooming_xlsx
    content = export_rooming_xlsx(competition_id)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="rooming-list.xlsx"'},
    )
