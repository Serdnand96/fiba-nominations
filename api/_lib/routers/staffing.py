"""Staffing Plan — empleados FIBA designados a una competencia.

Es el equivalente del crew (`competition_assignments`) para el staff interno:
quién de FIBA está en el evento y en qué función. Deliberadamente separado —
esta gente NO se nomina, no genera cartas ni pagos, así que no puede vivir en
la tabla que alimenta `sync-nominations` (ver migración 029).

Permiso: `games`, el mismo del crew. El picker de empleados sale de acá y no de
`/employees` a propósito: quien planifica una competencia no necesariamente
tiene el permiso `employees`, y lo único que necesita del legajo es el nombre.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request, Depends
from pydantic import BaseModel

from api._lib.database import supabase
from api._lib.auth import require_view, require_edit

router = APIRouter(
    prefix="/staffing",
    tags=["staffing"],
    dependencies=[Depends(require_view("games"))],
)

STATUSES = ("planned", "confirmed", "cancelled")


def _user_id(request: Request) -> Optional[str]:
    user = getattr(request.state, "user", None)
    if isinstance(user, dict):
        return user.get("id")
    return None


class StaffingCreate(BaseModel):
    competition_id: str
    employee_id: Optional[str] = None
    external_name: Optional[str] = None
    event_role: str
    status: Optional[str] = "planned"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    notes: Optional[str] = None


class StaffingUpdate(BaseModel):
    event_role: Optional[str] = None
    status: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    notes: Optional[str] = None


def _with_employee(rows: list[dict]) -> list[dict]:
    """Adjunta el legajo (nombre, cargo, área) a cada designación.

    Join a mano y no PostgREST embebido para no arrastrar el legajo completo:
    de `employees` solo salen los campos que la UI muestra.
    """
    if not rows:
        return []
    ids = list({r["employee_id"] for r in rows if r.get("employee_id")})
    by_id = {}
    if ids:
        people = (
            supabase.table("employees")
            .select("id, name, email, position, department, active")
            .in_("id", ids)
            .execute()
            .data
        ) or []
        by_id = {p["id"]: p for p in people}
    out = []
    for r in rows:
        employee = by_id.get(r.get("employee_id"))
        out.append({
            **r,
            "employee": employee,
            # Nombre a mostrar, ya resuelto: el externo no tiene legajo, y un
            # empleado borrado deja la fila con external_name como respaldo.
            "display_name": (employee or {}).get("name") or r.get("external_name") or "",
        })
    out.sort(key=lambda r: (r.get("event_role") or "", r.get("display_name") or ""))
    return out


@router.get("/by-competition")
def list_staffing(competition_id: str = Query(...)):
    rows = (
        supabase.table("competition_staffing")
        .select("*")
        .eq("competition_id", competition_id)
        .execute()
        .data
    ) or []
    return _with_employee(rows)


@router.get("/candidates")
def list_candidates(search: Optional[str] = Query(None)):
    """Empleados activos elegibles para el staffing plan.

    Endpoint propio bajo permiso `games` — ver el docstring del módulo.
    """
    rows = (
        supabase.table("employees")
        .select("id, name, email, position, department")
        .eq("active", True)
        .order("name", desc=False)
        .execute()
        .data
    ) or []
    if search:
        s = search.strip().lower()
        rows = [
            r for r in rows
            if s in (r.get("name") or "").lower()
            or s in (r.get("position") or "").lower()
            or s in (r.get("department") or "").lower()
        ]
    return rows[:50]


@router.post("", status_code=201, dependencies=[Depends(require_edit("games"))])
def create_staffing(data: StaffingCreate, request: Request):
    event_role = (data.event_role or "").strip()
    if not event_role:
        raise HTTPException(400, "event_role is required")

    status = (data.status or "planned").strip().lower()
    if status not in STATUSES:
        raise HTTPException(400, f"status must be one of {', '.join(STATUSES)}")

    external_name = (data.external_name or "").strip() or None
    if not data.employee_id and not external_name:
        raise HTTPException(400, "Either employee_id or external_name is required")

    competition = (
        supabase.table("competitions")
        .select("id")
        .eq("id", data.competition_id)
        .execute()
        .data
    )
    if not competition:
        raise HTTPException(404, "Competition not found")

    if data.employee_id:
        employee = (
            supabase.table("employees")
            .select("id")
            .eq("id", data.employee_id)
            .execute()
            .data
        )
        if not employee:
            raise HTTPException(404, "Employee not found")
        # El índice único lo garantiza igual; acá se devuelve un 409 legible en
        # vez de dejar que reviente el insert.
        existing = (
            supabase.table("competition_staffing")
            .select("id")
            .eq("competition_id", data.competition_id)
            .eq("employee_id", data.employee_id)
            .eq("event_role", event_role)
            .execute()
            .data
        )
        if existing:
            raise HTTPException(409, "This person already has that role on this competition")

    record = {
        "competition_id": data.competition_id,
        "employee_id": data.employee_id,
        "external_name": external_name,
        "event_role": event_role,
        "status": status,
        "start_date": data.start_date or None,
        "end_date": data.end_date or None,
        "notes": (data.notes or "").strip() or None,
        "created_by": _user_id(request),
    }
    created = supabase.table("competition_staffing").insert(record).execute().data[0]
    return _with_employee([created])[0]


@router.put("/{staffing_id}", dependencies=[Depends(require_edit("games"))])
def update_staffing(staffing_id: str, data: StaffingUpdate):
    updates = {}
    if data.event_role is not None:
        event_role = data.event_role.strip()
        if not event_role:
            raise HTTPException(400, "event_role cannot be empty")
        updates["event_role"] = event_role
    if data.status is not None:
        status = data.status.strip().lower()
        if status not in STATUSES:
            raise HTTPException(400, f"status must be one of {', '.join(STATUSES)}")
        updates["status"] = status
    # Las fechas y las notas se limpian con "" — por eso no se filtran los
    # vacíos como en event_role/status.
    if data.start_date is not None:
        updates["start_date"] = data.start_date or None
    if data.end_date is not None:
        updates["end_date"] = data.end_date or None
    if data.notes is not None:
        updates["notes"] = data.notes.strip() or None

    if not updates:
        raise HTTPException(400, "No fields to update")

    result = (
        supabase.table("competition_staffing")
        .update(updates)
        .eq("id", staffing_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Staffing entry not found")
    return _with_employee([result.data[0]])[0]


@router.delete("/{staffing_id}", dependencies=[Depends(require_edit("games"))])
def delete_staffing(staffing_id: str):
    result = (
        supabase.table("competition_staffing")
        .delete()
        .eq("id", staffing_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Staffing entry not found")
    return {"ok": True}
