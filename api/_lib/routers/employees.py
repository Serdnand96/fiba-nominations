"""Internal staff (employees) — separate from TDs/VGOs in `personnel`."""
from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Depends

from api._lib.database import supabase
from api._lib.auth import require_view, require_edit
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


def _trip_days(start: Optional[str], end: Optional[str]) -> int:
    """Días del viaje, inclusive. 0 cuando no hay fechas — no se inventa 1."""
    if not start or not end:
        return 0
    try:
        d0 = date.fromisoformat(str(start)[:10])
        d1 = date.fromisoformat(str(end)[:10])
    except ValueError:
        return 0
    return max((d1 - d0).days + 1, 0)


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
            "source": "staffing",
        }

    return trips


@router.get("/trip-counts")
def employee_trip_counts(year: Optional[int] = Query(None)):
    """Viajes por empleado, para la columna de la tabla.

    Declarado ANTES de `/{employee_id}`: FastAPI resuelve por orden y si no
    "trip-counts" se leería como un id de empleado.
    """
    all_trips = _collect_trips(None)
    years = sorted({t["year"] for t in all_trips.values() if t.get("year")}, reverse=True)

    counts: dict = {}
    for trip in all_trips.values():
        if year is not None and trip.get("year") != year:
            continue
        counts[trip["employee_id"]] = counts.get(trip["employee_id"], 0) + 1
    return {"year": year, "counts": counts, "years": years}


@router.get("/{employee_id}/trips")
def employee_trips(employee_id: str, year: Optional[int] = Query(None)):
    """Detalle de los viajes de un empleado: qué eventos y cuántos días."""
    employee = supabase.table("employees").select("id, name").eq("id", employee_id).execute()
    if not employee.data:
        raise HTTPException(status_code=404, detail="Employee not found")

    rows = [
        t for (emp_id, _comp_id), t in _collect_trips(year).items()
        if emp_id == employee_id
    ]
    rows.sort(key=lambda t: (t.get("start_date") or "", t.get("competition_name") or ""), reverse=True)
    return {
        "year": year,
        "totals": {"trips": len(rows), "days": sum(t["days"] for t in rows)},
        "trips": rows,
    }


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
