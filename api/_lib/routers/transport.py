from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from typing import Optional

from api._lib.database import supabase
from api._lib.auth import require_view, require_edit

# Transporte es una sección del módulo Logística, no un módulo propio: comparte
# el permiso 'logistics' con el resto (padrón, manifest, hospedaje), que vive en
# routers/logistics.py. El prefijo de la URL sigue siendo /transport porque es
# interno y renombrarlo no cambia nada para el usuario.
router = APIRouter(prefix="/transport", tags=["logistics"], dependencies=[Depends(require_view("logistics"))])


# ── Schemas ──────────────────────────────────────────────────────────────────

class EventCreate(BaseModel):
    name: str
    competition_id: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None

class VehicleCreate(BaseModel):
    event_id: str
    name: str
    vehicle_type: Optional[str] = None

class DriverCreate(BaseModel):
    event_id: str
    name: str
    phone: Optional[str] = None

class VehicleUpdate(BaseModel):
    name: Optional[str] = None
    vehicle_type: Optional[str] = None

class DriverUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None

class VehicleDriverAssign(BaseModel):
    vehicle_id: str
    driver_id: str
    date: str  # YYYY-MM-DD

TRIP_TYPES = ("pickup", "return", "transfer")

class TripCreate(BaseModel):
    vehicle_id: str
    date: str
    trip_number: int
    departure_time: str  # HH:MM
    arrival_time: Optional[str] = None
    origin: str
    destination: str
    equipment: Optional[str] = None
    contact: Optional[str] = None
    notes: Optional[str] = None
    game_id: Optional[str] = None
    trip_type: str = "transfer"

class TripUpdate(BaseModel):
    trip_number: Optional[int] = None
    departure_time: Optional[str] = None
    arrival_time: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    equipment: Optional[str] = None
    contact: Optional[str] = None
    notes: Optional[str] = None
    game_id: Optional[str] = None
    trip_type: Optional[str] = None

class VenueCreate(BaseModel):
    event_id: str
    name: str
    type: str = "venue"


# ── Events ───────────────────────────────────────────────────────────────────

@router.get("/events")
def list_events():
    return supabase.table("transport_events").select("*").order("created_at").execute().data

@router.post("/events", dependencies=[Depends(require_edit("logistics"))])
def create_event(data: EventCreate):
    result = supabase.table("transport_events").insert(data.model_dump()).execute()
    return result.data[0]

@router.get("/events/by-competition/{competition_id}")
def get_event_by_competition(competition_id: str):
    """Find existing transport event for a competition, or return null."""
    r = supabase.table("transport_events").select("*").eq("competition_id", competition_id).execute()
    if r.data:
        return r.data[0]
    return None

@router.get("/events/{event_id}")
def get_event(event_id: str):
    r = supabase.table("transport_events").select("*").eq("id", event_id).execute()
    if not r.data:
        raise HTTPException(404, "Event not found")
    return r.data[0]


# ── Vehicles ─────────────────────────────────────────────────────────────────

@router.get("/vehicles")
def list_vehicles(event_id: str = Query(...)):
    return supabase.table("transport_vehicles").select("*").eq("event_id", event_id).order("name").execute().data

@router.post("/vehicles", dependencies=[Depends(require_edit("logistics"))])
def create_vehicle(data: VehicleCreate):
    result = supabase.table("transport_vehicles").insert(data.model_dump()).execute()
    return result.data[0]

@router.put("/vehicles/{vehicle_id}", dependencies=[Depends(require_edit("logistics"))])
def update_vehicle(vehicle_id: str, data: VehicleUpdate):
    updates = data.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    r = supabase.table("transport_vehicles").update(updates).eq("id", vehicle_id).execute()
    if not r.data:
        raise HTTPException(404, "Vehicle not found")
    return r.data[0]

@router.delete("/vehicles/{vehicle_id}", dependencies=[Depends(require_edit("logistics"))])
def delete_vehicle(vehicle_id: str):
    supabase.table("transport_vehicles").delete().eq("id", vehicle_id).execute()
    return {"ok": True}


# ── Drivers ──────────────────────────────────────────────────────────────────

@router.get("/drivers")
def list_drivers(event_id: str = Query(...)):
    return supabase.table("transport_drivers").select("*").eq("event_id", event_id).order("name").execute().data

@router.post("/drivers", dependencies=[Depends(require_edit("logistics"))])
def create_driver(data: DriverCreate):
    result = supabase.table("transport_drivers").insert(data.model_dump()).execute()
    return result.data[0]

@router.put("/drivers/{driver_id}", dependencies=[Depends(require_edit("logistics"))])
def update_driver(driver_id: str, data: DriverUpdate):
    updates = data.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    r = supabase.table("transport_drivers").update(updates).eq("id", driver_id).execute()
    if not r.data:
        raise HTTPException(404, "Driver not found")
    return r.data[0]

@router.delete("/drivers/{driver_id}", dependencies=[Depends(require_edit("logistics"))])
def delete_driver(driver_id: str):
    supabase.table("transport_drivers").delete().eq("id", driver_id).execute()
    return {"ok": True}


# ── Vehicle-Driver assignments ───────────────────────────────────────────────

@router.get("/vehicle-drivers")
def list_vehicle_drivers(event_id: str = Query(...), date: Optional[str] = Query(None)):
    # Get all vehicles for event, then find assignments
    vehicles = supabase.table("transport_vehicles").select("id").eq("event_id", event_id).execute().data
    if not vehicles:
        return []
    vids = [v["id"] for v in vehicles]

    q = supabase.table("transport_vehicle_drivers").select("*")
    if date:
        q = q.eq("date", date)
    assignments = q.execute().data
    # Filter to only vehicles in this event
    return [a for a in assignments if a["vehicle_id"] in vids]

@router.post("/vehicle-drivers", dependencies=[Depends(require_edit("logistics"))])
def assign_vehicle_driver(data: VehicleDriverAssign):
    record = data.model_dump()
    # Upsert: remove existing assignment for vehicle+date, then insert
    supabase.table("transport_vehicle_drivers").delete().eq("vehicle_id", data.vehicle_id).eq("date", data.date).execute()
    result = supabase.table("transport_vehicle_drivers").insert(record).execute()
    return result.data[0]


# ── Trips ────────────────────────────────────────────────────────────────────

GAME_FIELDS = "id,game_number,date,time,team_a,team_b,phase,group_label,venue"


def _games_for_event(event_id: str, date: Optional[str] = None) -> list:
    """Games of the competition this transport event belongs to."""
    evt = supabase.table("transport_events").select("competition_id").eq("id", event_id).execute().data
    competition_id = evt[0]["competition_id"] if evt else None
    if not competition_id:
        return []
    q = supabase.table("game_schedule").select(GAME_FIELDS).eq("competition_id", competition_id)
    if date:
        q = q.eq("date", date)
    return q.order("date").execute().data


def _validate_game(game_id: Optional[str], vehicle_id: str):
    """A trip may only point to a game of its own competition."""
    if not game_id:
        return
    veh = supabase.table("transport_vehicles").select("event_id").eq("id", vehicle_id).execute().data
    if not veh:
        raise HTTPException(404, "Vehicle not found")
    valid = {g["id"] for g in _games_for_event(veh[0]["event_id"])}
    if game_id not in valid:
        raise HTTPException(400, "Game does not belong to this competition")


@router.get("/trips")
def list_trips(event_id: str = Query(...), date: Optional[str] = Query(None)):
    # Games of the date, so the UI can show/pick the game behind each trip
    games = _games_for_event(event_id, date)
    games.sort(key=lambda g: (g.get("time") or ""))
    game_map = {g["id"]: g for g in games}

    # Get vehicles for the event
    vehicles = supabase.table("transport_vehicles").select("id,name,vehicle_type").eq("event_id", event_id).order("name").execute().data
    if not vehicles:
        return {"vehicles": [], "trips": [], "vehicle_drivers": [], "games": games}

    vids = [v["id"] for v in vehicles]

    # Get trips
    q = supabase.table("transport_trips").select("*")
    if date:
        q = q.eq("date", date)
    q = q.order("departure_time")
    all_trips = q.execute().data
    trips = [t for t in all_trips if t["vehicle_id"] in vids]

    # Get driver assignments
    dq = supabase.table("transport_vehicle_drivers").select("*")
    if date:
        dq = dq.eq("date", date)
    all_vd = dq.execute().data
    vd = [a for a in all_vd if a["vehicle_id"] in vids]

    # Get drivers
    drivers = supabase.table("transport_drivers").select("*").eq("event_id", event_id).execute().data
    driver_map = {d["id"]: d for d in drivers}

    # Enrich vehicle_drivers with driver info
    for a in vd:
        a["driver"] = driver_map.get(a["driver_id"])

    # Enrich trips with the game they serve, so team names and phase stay live
    # instead of being copied into free text.
    for t in trips:
        t["game"] = game_map.get(t.get("game_id"))

    return {"vehicles": vehicles, "trips": trips, "vehicle_drivers": vd, "games": games}

@router.get("/trip-dates")
def list_trip_dates(event_id: str = Query(...)):
    """Dates that actually have trips, so the UI can land on one of them.

    Without this the page opens on the competition's start_date, which is
    often a travel/arrival day with no trips yet — it reads as "nothing was
    loaded" even when the whole schedule is there.
    """
    vehicles = supabase.table("transport_vehicles").select("id").eq("event_id", event_id).execute().data
    if not vehicles:
        return []
    vids = {v["id"] for v in vehicles}
    trips = supabase.table("transport_trips").select("date,vehicle_id").order("date").execute().data
    counts = {}
    for t in trips:
        if t["vehicle_id"] in vids:
            counts[t["date"]] = counts.get(t["date"], 0) + 1
    return [{"date": d, "count": c} for d, c in sorted(counts.items())]


@router.post("/trips", dependencies=[Depends(require_edit("logistics"))])
def create_trip(data: TripCreate):
    if data.trip_type not in TRIP_TYPES:
        raise HTTPException(400, f"trip_type must be one of {', '.join(TRIP_TYPES)}")
    _validate_game(data.game_id, data.vehicle_id)
    record = data.model_dump()
    result = supabase.table("transport_trips").insert(record).execute()
    return result.data[0]

@router.put("/trips/{trip_id}", dependencies=[Depends(require_edit("logistics"))])
def update_trip(trip_id: str, data: TripUpdate):
    # exclude_unset (not "is not None") so the client can explicitly clear
    # game_id by sending null — omitted fields are still left untouched.
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    if updates.get("trip_type") is None:
        updates.pop("trip_type", None)  # column is NOT NULL; nothing to clear
    elif updates["trip_type"] not in TRIP_TYPES:
        raise HTTPException(400, f"trip_type must be one of {', '.join(TRIP_TYPES)}")
    existing = supabase.table("transport_trips").select("vehicle_id").eq("id", trip_id).execute().data
    if not existing:
        raise HTTPException(404, "Trip not found")
    if "game_id" in updates:
        _validate_game(updates["game_id"], existing[0]["vehicle_id"])
    r = supabase.table("transport_trips").update(updates).eq("id", trip_id).execute()
    if not r.data:
        raise HTTPException(404, "Trip not found")
    return r.data[0]

@router.delete("/trips/{trip_id}", dependencies=[Depends(require_edit("logistics"))])
def delete_trip(trip_id: str):
    supabase.table("transport_trips").delete().eq("id", trip_id).execute()
    return {"ok": True}


# ── Conflict detection ───────────────────────────────────────────────────────

@router.get("/conflicts")
def check_conflicts(event_id: str = Query(...), date: str = Query(...)):
    """Check for driver schedule conflicts on a given date."""
    vehicles = supabase.table("transport_vehicles").select("id").eq("event_id", event_id).execute().data
    vids = [v["id"] for v in vehicles]

    # Get all driver assignments for the date
    vd = supabase.table("transport_vehicle_drivers").select("*").eq("date", date).execute().data
    vd = [a for a in vd if a["vehicle_id"] in vids]

    # Map driver_id -> list of vehicle_ids
    driver_vehicles = {}
    for a in vd:
        driver_vehicles.setdefault(a["driver_id"], []).append(a["vehicle_id"])

    # Get all trips for the date
    all_trips = supabase.table("transport_trips").select("*").eq("date", date).order("departure_time").execute().data
    trips = [t for t in all_trips if t["vehicle_id"] in vids]

    # Build trip list per vehicle
    vehicle_trips = {}
    for t in trips:
        vehicle_trips.setdefault(t["vehicle_id"], []).append(t)

    # Check conflicts
    conflicts = []

    # 1) Within-vehicle conflicts: overlapping trips on the same vehicle
    for vid, vtrips in vehicle_trips.items():
        if len(vtrips) < 2:
            continue
        trip_items = []
        for t in vtrips:
            trip_items.append({
                "trip_id": t["id"],
                "vehicle_id": vid,
                "departure": t["departure_time"],
                "arrival": t.get("arrival_time"),
            })
        for i in range(len(trip_items)):
            for j in range(i + 1, len(trip_items)):
                if _trips_overlap(trip_items[i], trip_items[j]):
                    # Find which driver is assigned to this vehicle
                    driver_id = None
                    for a in vd:
                        if a["vehicle_id"] == vid:
                            driver_id = a["driver_id"]
                            break
                    conflicts.append({
                        "driver_id": driver_id,
                        "vehicle_id": vid,
                        "trip_a": trip_items[i]["trip_id"],
                        "trip_b": trip_items[j]["trip_id"],
                        "type": "vehicle_overlap",
                    })

    # 2) Cross-vehicle conflicts: driver assigned to multiple vehicles with overlapping trips
    for driver_id, assigned_vids in driver_vehicles.items():
        if len(assigned_vids) < 2:
            continue
        driver_trips = []
        for vid in assigned_vids:
            for t in vehicle_trips.get(vid, []):
                driver_trips.append({
                    "trip_id": t["id"],
                    "vehicle_id": vid,
                    "departure": t["departure_time"],
                    "arrival": t.get("arrival_time"),
                })
        for i in range(len(driver_trips)):
            for j in range(i + 1, len(driver_trips)):
                a = driver_trips[i]
                b = driver_trips[j]
                if a["vehicle_id"] == b["vehicle_id"]:
                    continue  # Already caught above
                if _trips_overlap(a, b):
                    conflicts.append({
                        "driver_id": driver_id,
                        "trip_a": a["trip_id"],
                        "trip_b": b["trip_id"],
                        "type": "driver_overlap",
                    })

    return conflicts


def _trips_overlap(a, b):
    """Check if two trips overlap. Default duration is 60 minutes."""
    def parse_time(t):
        if not t:
            return None
        # Handle "HH:MM:SS" or "HH:MM"
        parts = t.split(":")
        return int(parts[0]) * 60 + int(parts[1])

    def end_time(trip):
        arr = parse_time(trip["arrival"])
        if arr is not None:
            return arr
        dep = parse_time(trip["departure"])
        return dep + 60 if dep is not None else None

    a_start = parse_time(a["departure"])
    a_end = end_time(a)
    b_start = parse_time(b["departure"])
    b_end = end_time(b)

    if any(v is None for v in [a_start, a_end, b_start, b_end]):
        return False

    return a_start < b_end and b_start < a_end


# ── Venues ───────────────────────────────────────────────────────────────────

@router.get("/venues")
def list_venues(event_id: str = Query(...)):
    return supabase.table("transport_venues").select("*").eq("event_id", event_id).order("type", desc=True).execute().data

@router.post("/venues", dependencies=[Depends(require_edit("logistics"))])
def create_venue(data: VenueCreate):
    result = supabase.table("transport_venues").insert(data.model_dump()).execute()
    return result.data[0]

@router.delete("/venues/{venue_id}", dependencies=[Depends(require_edit("logistics"))])
def delete_venue(venue_id: str):
    supabase.table("transport_venues").delete().eq("id", venue_id).execute()
    return {"ok": True}


# Los pasajeros ya no viven acá: el padrón de la competencia es
# logistics_participants (routers/logistics.py), que además es de donde salen
# el manifest y la rooming list. La migración 025 copió las filas viejas.
