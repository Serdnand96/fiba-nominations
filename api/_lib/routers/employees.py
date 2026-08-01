"""Internal staff (employees) — separate from TDs/VGOs in `personnel`."""
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request, Depends

from api._lib.database import supabase
from api._lib.auth import require_view, require_edit, has_view
from api._lib.schemas import EmployeeCreate, EmployeeUpdate

router = APIRouter(prefix="/employees", tags=["employees"], dependencies=[Depends(require_view("employees"))])


@router.get("")
def list_employees(
    search: Optional[str] = Query(None),
    active: Optional[bool] = Query(None),
    department: Optional[str] = Query(None),
):
    q = supabase.table("employees").select("*").order("name", desc=False)
    if active is not None:
        q = q.eq("active", active)
    if department:
        q = q.eq("department", department)
    rows = q.execute().data or []
    if search:
        s = search.lower()
        rows = [
            r for r in rows
            if s in (r.get("name") or "").lower()
            or s in (r.get("email") or "").lower()
            or s in (r.get("position") or "").lower()
            or s in (r.get("department") or "").lower()
        ]
    return rows


# ── Viajes por año ──────────────────────────────────────────────────────────
#
# No hay contador guardado en `employees` a propósito: el dato ya vive en las
# filas de `competition_staffing` (a quién designamos) y de
# `logistics_participants` (a quién efectivamente subimos al manifiesto). Una
# columna `trips_2026` habría que recalcularla en cada alta, baja y cambio de
# año, y se desincroniza el día que alguien toque la tabla por fuera. Se cuenta
# al leer.
#
# Un "viaje" es una COMPETENCIA, no una fila: si la misma persona cubre dos
# funciones en el mismo evento viajó una sola vez.


def _competition_of(row: dict) -> dict:
    return row.get("competitions") or {}


def _trip_dates(row: dict, comp: dict) -> tuple[Optional[str], Optional[str]]:
    """Fechas del viaje: las de la designación si están, si no las del evento."""
    start = row.get("start_date") or comp.get("start_date")
    end = row.get("end_date") or comp.get("end_date") or start
    return start, end


def _trip_year(start: Optional[str], comp: dict) -> Optional[int]:
    if start and len(str(start)) >= 4 and str(start)[:4].isdigit():
        return int(str(start)[:4])
    return comp.get("year")


def _span(start: Optional[str], end: Optional[str]) -> Optional[tuple[date, date]]:
    """Tramo del viaje como fechas, o None si falta alguna o están al revés."""
    if not start or not end:
        return None
    try:
        d0 = date.fromisoformat(str(start)[:10])
        d1 = date.fromisoformat(str(end)[:10])
    except ValueError:
        return None
    return (d0, d1) if d1 >= d0 else None


def _trip_days(start: Optional[str], end: Optional[str]) -> int:
    """Días del viaje, inclusive. 0 cuando no hay fechas — no se inventa 1."""
    span = _span(start, end)
    return (span[1] - span[0]).days + 1 if span else 0


def _weekend_days(start: Optional[str], end: Optional[str]) -> int:
    """Sábados y domingos dentro del viaje → base de los compensation days.

    Se cuenta el fin de semana que cae DENTRO del tramo, esté la persona
    trabajando o viajando: para el cómputo de compensatorios el criterio es
    haber estado fuera de casa. Feriados no entran — no hay calendario de
    feriados en el sistema y varía por país de la persona.
    """
    span = _span(start, end)
    if not span:
        return 0
    d0, d1 = span
    total = (d1 - d0).days + 1
    # Cada semana completa aporta exactamente 2; solo el resto hay que mirarlo
    # día por día.
    full_weeks, rest = divmod(total, 7)
    count = full_weeks * 2
    for i in range(rest):
        if (d0 + timedelta(days=full_weeks * 7 + i)).weekday() >= 5:  # sáb=5, dom=6
            count += 1
    return count


_TRIP_COMP = "competitions(name, year, start_date, end_date)"


def _collect_trips(year: Optional[int] = None) -> dict:
    """(employee_id, competition_id) → viaje, de las dos fuentes.

    El staffing plan manda porque trae función y estado; logística entra para
    los eventos en los que la persona figura en el manifiesto sin que nadie
    haya cargado el staffing plan (si no, el contador diría 0 y sería mentira).
    Las designaciones canceladas no cuentan, pero una fila de logística de esa
    misma competencia sí: si está en el manifiesto, viajó.
    """
    trips: dict = {}

    logistics = (
        supabase.table("logistics_participants")
        .select(f"employee_id, competition_id, role, {_TRIP_COMP}")
        .execute()
        .data
    ) or []
    for row in logistics:
        emp_id = row.get("employee_id")
        if not emp_id:
            continue
        comp = _competition_of(row)
        start, end = _trip_dates({}, comp)
        y = _trip_year(start, comp)
        if year is not None and y != year:
            continue
        trips[(emp_id, row.get("competition_id"))] = {
            "employee_id": emp_id,
            "competition_id": row.get("competition_id"),
            "competition_name": comp.get("name"),
            "year": y,
            "event_role": row.get("role"),
            "status": None,
            "start_date": start,
            "end_date": end,
            "days": _trip_days(start, end),
            "weekend_days": _weekend_days(start, end),
            "source": "logistics",
        }

    staffing = (
        supabase.table("competition_staffing")
        .select(f"employee_id, competition_id, event_role, status, start_date, end_date, {_TRIP_COMP}")
        .execute()
        .data
    ) or []
    for row in staffing:
        emp_id = row.get("employee_id")
        if not emp_id or (row.get("status") or "") == "cancelled":
            continue
        comp = _competition_of(row)
        start, end = _trip_dates(row, comp)
        y = _trip_year(start, comp)
        if year is not None and y != year:
            continue
        key = (emp_id, row.get("competition_id"))
        previous = trips.get(key)
        # Dos funciones en el mismo evento siguen siendo UN viaje: se listan
        # las dos y el tramo se estira para cubrir ambas (rol A del 1 al 5 y
        # rol B del 3 al 9 son 9 días, no 7).
        if previous and previous.get("source") == "staffing":
            roles = [previous.get("event_role"), row.get("event_role")]
            start = min(filter(None, [previous.get("start_date"), start]), default=start)
            end = max(filter(None, [previous.get("end_date"), end]), default=end)
        else:
            roles = [row.get("event_role")]
        trips[key] = {
            "employee_id": emp_id,
            "competition_id": row.get("competition_id"),
            "competition_name": comp.get("name"),
            "year": y,
            "event_role": " · ".join(dict.fromkeys(filter(None, roles))),
            "status": row.get("status"),
            "start_date": start,
            "end_date": end,
            "days": _trip_days(start, end),
            "weekend_days": _weekend_days(start, end),
            "source": "staffing",
        }

    return trips


# Los días compensatorios llevan su propio permiso (`comp_days`, migración
# 030): son insumo de RRHH y no todo el que administra empleados tiene por qué
# verlos. Se recortan de la respuesta, no se esconden solo en el front — un
# guard de UI es UX, no control de acceso.
_COMP_DAYS_MODULE = "comp_days"


@router.get("/trip-counts")
def employee_trip_counts(request: Request, year: Optional[int] = Query(None)):
    """Viajes por empleado, para la columna de la tabla.

    Declarado ANTES de `/{employee_id}`: FastAPI resuelve por orden y si no
    "trip-counts" se leería como un id de empleado.
    """
    all_trips = _collect_trips(None)
    years = sorted({t["year"] for t in all_trips.values() if t.get("year")}, reverse=True)

    counts: dict = {}
    weekend_days: dict = {}
    for trip in all_trips.values():
        if year is not None and trip.get("year") != year:
            continue
        emp_id = trip["employee_id"]
        counts[emp_id] = counts.get(emp_id, 0) + 1
        weekend_days[emp_id] = weekend_days.get(emp_id, 0) + trip.get("weekend_days", 0)

    payload = {"year": year, "counts": counts, "years": years}
    if has_view(request, _COMP_DAYS_MODULE):
        payload["weekend_days"] = weekend_days
    return payload


@router.get("/{employee_id}/trips")
def employee_trips(employee_id: str, request: Request, year: Optional[int] = Query(None)):
    """Detalle de los viajes de un empleado: qué eventos y cuántos días."""
    employee = supabase.table("employees").select("id, name").eq("id", employee_id).execute()
    if not employee.data:
        raise HTTPException(status_code=404, detail="Employee not found")

    rows = [
        t for (emp_id, _comp_id), t in _collect_trips(year).items()
        if emp_id == employee_id
    ]
    rows.sort(key=lambda t: (t.get("start_date") or "", t.get("competition_name") or ""), reverse=True)

    totals = {"trips": len(rows), "days": sum(t["days"] for t in rows)}
    if has_view(request, _COMP_DAYS_MODULE):
        totals["weekend_days"] = sum(t["weekend_days"] for t in rows)
    else:
        rows = [{k: v for k, v in t.items() if k != "weekend_days"} for t in rows]
    return {"year": year, "totals": totals, "trips": rows}


@router.get("/{employee_id}")
def get_employee(employee_id: str):
    res = supabase.table("employees").select("*").eq("id", employee_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Employee not found")
    return res.data[0]


@router.post("", status_code=201, dependencies=[Depends(require_edit("employees"))])
def create_employee(data: EmployeeCreate):
    record = data.model_dump(exclude_none=True)
    result = supabase.table("employees").insert(record).execute()
    return result.data[0]


@router.put("/{employee_id}", dependencies=[Depends(require_edit("employees"))])
def update_employee(employee_id: str, data: EmployeeUpdate):
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = (
        supabase.table("employees")
        .update(updates)
        .eq("id", employee_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Employee not found")
    return result.data[0]


@router.delete("/{employee_id}", dependencies=[Depends(require_edit("employees"))])
def delete_employee(employee_id: str):
    # Soft-delete: just mark inactive (loans referencing this stay valid)
    result = (
        supabase.table("employees")
        .update({"active": False})
        .eq("id", employee_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"ok": True, "message": "Employee deactivated"}
