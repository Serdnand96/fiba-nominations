from pydantic import BaseModel
from typing import Optional


class PersonnelCreate(BaseModel):
    name: str
    email: str
    country: Optional[str] = None
    phone: Optional[str] = None
    passport: Optional[str] = None
    role: str


class PersonnelUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    country: Optional[str] = None
    phone: Optional[str] = None
    passport: Optional[str] = None
    role: Optional[str] = None


class CompetitionCreate(BaseModel):
    name: str
    template_key: str
    year: Optional[int] = None
    fiba_games_url: Optional[str] = None
    fee_type: Optional[str] = "per_game"  # 'per_game' or 'tournament'


class CompetitionUpdate(BaseModel):
    name: Optional[str] = None
    template_key: Optional[str] = None
    year: Optional[int] = None
    fiba_games_url: Optional[str] = None
    fee_type: Optional[str] = None


class GameDate(BaseModel):
    label: str
    date: str


class NominationCreate(BaseModel):
    personnel_id: str
    competition_id: str
    letter_date: Optional[str] = None
    location: Optional[str] = None
    venue: Optional[str] = None
    arrival_date: Optional[str] = None
    departure_date: Optional[str] = None
    game_dates: Optional[list[GameDate]] = None
    window_fee: Optional[float] = None
    incidentals: Optional[float] = None
    confirmation_deadline: Optional[str] = None


class BulkNominationCreate(BaseModel):
    personnel_ids: list[str]
    competition_id: str
    letter_date: Optional[str] = None
    location: Optional[str] = None
    venue: Optional[str] = None
    arrival_date: Optional[str] = None
    departure_date: Optional[str] = None
    game_dates: Optional[list[GameDate]] = None
    window_fee: Optional[float] = None
    incidentals: Optional[float] = None
    confirmation_deadline: Optional[str] = None


class BulkImportResult(BaseModel):
    total: int
    imported: int
    skipped: int
    errors: list[dict]


# ─── INVENTORY ─────────────────────────────────────────────────────────────

class AssetCreate(BaseModel):
    name: str
    serial_number: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    status: Optional[str] = "available"  # available|in_use|maintenance|retired
    location: Optional[str] = None
    purchase_date: Optional[str] = None
    notes: Optional[str] = None


class AssetUpdate(BaseModel):
    name: Optional[str] = None
    serial_number: Optional[str] = None
    category: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    status: Optional[str] = None
    location: Optional[str] = None
    purchase_date: Optional[str] = None
    notes: Optional[str] = None


class LoanCreate(BaseModel):
    asset_id: str
    assigned_to: Optional[str] = None  # Free text — auto-filled from employees.name when employee_id is set
    employee_id: Optional[str] = None  # Link to employees table (preferred)
    expected_return: Optional[str] = None
    notes: Optional[str] = None


# ─── EMPLOYEES ────────────────────────────────────────────────────────────

class EmployeeCreate(BaseModel):
    name: str
    email: Optional[str] = None
    position: Optional[str] = None
    department: Optional[str] = None
    phone: Optional[str] = None
    active: Optional[bool] = True
    notes: Optional[str] = None


class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    position: Optional[str] = None
    department: Optional[str] = None
    phone: Optional[str] = None
    active: Optional[bool] = None
    notes: Optional[str] = None
