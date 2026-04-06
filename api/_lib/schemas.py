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
