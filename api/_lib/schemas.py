from pydantic import BaseModel
from typing import Literal, Optional

# fee_type gobierna todo el dispatch per-game vs. tournament. Un str libre dejaba
# pasar typos ('Tournament') que caían a per_game en silencio; un Literal los
# rechaza con 422.
FeeType = Literal["per_game", "tournament"]


class LetterTemplateCreate(BaseModel):
    key: str
    label: str
    kind: str  # 'nomination' | 'confirmation'
    signatory_name: Optional[str] = None
    signatory_title: Optional[str] = None
    signatory_org: Optional[str] = None


class VisaEntry(BaseModel):
    country: str
    expires: Optional[str] = None  # YYYY-MM-DD


class PersonnelCreate(BaseModel):
    name: str
    email: str
    country: Optional[str] = None
    country_code: Optional[str] = None  # FIBA code (COL, ARG…) — see api/_lib/countries.py
    nationalities: Optional[list[str]] = None  # additional nationalities (FIBA codes)
    phone: Optional[str] = None
    passport: Optional[str] = None
    role: str
    languages: Optional[list[str]] = None
    visas: Optional[list[VisaEntry]] = None


class PersonnelUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    country: Optional[str] = None
    country_code: Optional[str] = None
    nationalities: Optional[list[str]] = None
    phone: Optional[str] = None
    passport: Optional[str] = None
    role: Optional[str] = None
    languages: Optional[list[str]] = None
    visas: Optional[list[VisaEntry]] = None


class CompetitionCreate(BaseModel):
    name: str
    template_key: str
    year: Optional[int] = None
    fiba_games_url: Optional[str] = None
    # W1..W6 — acota el sync a una ventana del clasificatorio. FIBA devuelve el
    # clasificatorio entero por la misma URL (migración 040). None = sin filtro.
    fiba_window_code: Optional[str] = None
    fee_type: Optional[FeeType] = "per_game"
    # National-team event → referee neutrality restriction applies.
    # None → derived from template_key (WCQ) at creation.
    is_national_team: Optional[bool] = None


class CompetitionUpdate(BaseModel):
    name: Optional[str] = None
    template_key: Optional[str] = None
    year: Optional[int] = None
    fiba_games_url: Optional[str] = None
    fiba_window_code: Optional[str] = None
    fee_type: Optional[FeeType] = None
    is_national_team: Optional[bool] = None
    # Nomination defaults used by the per-game assignment workflow
    default_letter_date: Optional[str] = None
    default_location: Optional[str] = None
    default_venue: Optional[str] = None
    default_arrival_date: Optional[str] = None
    default_departure_date: Optional[str] = None
    default_confirmation_deadline: Optional[str] = None
    # Travel offsets: arrival/departure derived per person from their games
    default_arrival_offset_days: Optional[int] = None
    default_departure_offset_days: Optional[int] = None
    td_window_fee: Optional[float] = None
    td_incidentals: Optional[float] = None
    vgo_window_fee: Optional[float] = None
    vgo_incidentals: Optional[float] = None
    ref_window_fee: Optional[float] = None
    ref_incidentals: Optional[float] = None
    ref_instructor_window_fee: Optional[float] = None
    ref_instructor_incidentals: Optional[float] = None
    video_operator_window_fee: Optional[float] = None
    video_operator_incidentals: Optional[float] = None


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


# ─── PAYMENTS ─────────────────────────────────────────────────────────────

class PaymentCreate(BaseModel):
    nomination_id: str
    budget_code: str
    amount: Optional[float] = None  # None → prefilled from nomination.total
    extra: Optional[float] = 0
    airfare: Optional[float] = 0    # flight cost — tracked apart, not in total
    comments: Optional[str] = None
    status: Optional[str] = "new"
    payment_date: Optional[str] = None
    bank_confirmation: Optional[str] = None


class PaymentUpdate(BaseModel):
    budget_code: Optional[str] = None
    amount: Optional[float] = None
    extra: Optional[float] = None
    airfare: Optional[float] = None
    comments: Optional[str] = None
    status: Optional[str] = None
    payment_date: Optional[str] = None
    bank_confirmation: Optional[str] = None


# ─── COMPETITION REPORTS ──────────────────────────────────────────────────

class CompetitionReportCreate(BaseModel):
    competition_id: str
    type_code: str
    title: str
    venue: Optional[str] = None
    loc: Optional[str] = None       # Local Organizing Committee
    report_date: Optional[str] = None
    summary: Optional[str] = None


class CompetitionReportUpdate(BaseModel):
    type_code: Optional[str] = None
    title: Optional[str] = None
    venue: Optional[str] = None
    loc: Optional[str] = None
    report_date: Optional[str] = None
    summary: Optional[str] = None


# ─── BUDGET: catálogos ────────────────────────────────────────────────────

class AccountCreate(BaseModel):
    code: str
    label: str
    kind: Optional[str] = "expense"          # expense | revenue
    parent_code: Optional[str] = None
    escalation_pct: Optional[float] = 0
    pending_mapping: Optional[bool] = False
    active: Optional[bool] = True
    sort: Optional[int] = 0
    notes: Optional[str] = None


class AccountUpdate(BaseModel):
    label: Optional[str] = None
    kind: Optional[str] = None
    parent_code: Optional[str] = None
    escalation_pct: Optional[float] = None
    pending_mapping: Optional[bool] = None
    active: Optional[bool] = None
    sort: Optional[int] = None
    notes: Optional[str] = None


class VendorCreate(BaseModel):
    name: str
    tax_id: Optional[str] = None
    country: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    bank_info: Optional[str] = None
    notes: Optional[str] = None
    active: Optional[bool] = True


class VendorUpdate(BaseModel):
    name: Optional[str] = None
    tax_id: Optional[str] = None
    country: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    bank_info: Optional[str] = None
    notes: Optional[str] = None
    active: Optional[bool] = None


# ─── BUDGET: gastos ───────────────────────────────────────────────────────

class ExpenseCreate(BaseModel):
    department_code: str
    account_code: str
    competition_id: Optional[str] = None     # None → gasto general, sin evento
    payee_type: Optional[str] = "vendor"     # vendor | employee | other
    vendor_id: Optional[str] = None
    employee_id: Optional[str] = None
    payee_name: Optional[str] = None
    description: str
    amount: float
    expense_date: str
    payment_date: Optional[str] = None
    status: Optional[str] = "draft"
    payment_method: Optional[str] = None
    bank_confirmation: Optional[str] = None
    invoice_no: Optional[str] = None
    comments: Optional[str] = None


class ExpenseUpdate(BaseModel):
    department_code: Optional[str] = None
    account_code: Optional[str] = None
    competition_id: Optional[str] = None
    payee_type: Optional[str] = None
    vendor_id: Optional[str] = None
    employee_id: Optional[str] = None
    payee_name: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    expense_date: Optional[str] = None
    payment_date: Optional[str] = None
    status: Optional[str] = None
    payment_method: Optional[str] = None
    bank_confirmation: Optional[str] = None
    invoice_no: Optional[str] = None
    comments: Optional[str] = None


# ─── BUDGET: recurrentes ──────────────────────────────────────────────────

class RecurringCreate(BaseModel):
    department_code: str
    account_code: str
    vendor_id: Optional[str] = None
    description: str
    amount: float
    frequency: str                            # monthly | quarterly | annual
    day_of_month: Optional[int] = None
    start_date: str
    end_date: Optional[str] = None
    active: Optional[bool] = True
    notes: Optional[str] = None


class RecurringUpdate(BaseModel):
    department_code: Optional[str] = None
    account_code: Optional[str] = None
    vendor_id: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    frequency: Optional[str] = None
    day_of_month: Optional[int] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    active: Optional[bool] = None
    notes: Optional[str] = None


class RecurringGenerateItem(BaseModel):
    recurring_id: str
    period: str                               # 'YYYY-MM'
    amount: Optional[float] = None            # override si la factura vino distinta
    expense_date: Optional[str] = None


class RecurringGenerate(BaseModel):
    items: list[RecurringGenerateItem]


# ─── BUDGET: líneas de presupuesto ────────────────────────────────────────

class BudgetLineCreate(BaseModel):
    year: int
    department_code: str
    account_code: str
    competition_id: Optional[str] = None     # None → línea general del año
    kind: Optional[str] = "expense"
    description: str
    qty: Optional[float] = None
    monthly_amount: Optional[float] = None
    amount: float = 0
    escalation_pct: Optional[float] = None   # None → default de la cuenta
    notes: Optional[str] = None


class BudgetLineUpdate(BaseModel):
    department_code: Optional[str] = None
    account_code: Optional[str] = None
    competition_id: Optional[str] = None
    kind: Optional[str] = None
    description: Optional[str] = None
    qty: Optional[float] = None
    monthly_amount: Optional[float] = None
    amount: Optional[float] = None
    escalation_pct: Optional[float] = None
    source: Optional[str] = None
    notes: Optional[str] = None


class BudgetProject(BaseModel):
    """Genera los años siguientes de un presupuesto aplicando la escalación."""
    from_year: int
    to_years: list[int]
    department_code: Optional[str] = None    # None → todos los departamentos
    overwrite: Optional[bool] = False        # pisar los años destino existentes


class HeadcountItem(BaseModel):
    competition_id: Optional[str] = None
    role_label: str
    headcount: int
    account_code: Optional[str] = None   # a qué línea de travel alimenta


class FeeScheduleItem(BaseModel):
    role_prefix: str                     # td | vgo | ref | ref_instructor | video_operator
    event_type: str
    fee: float
    incidentals: float = 0
    active: bool = True
    notes: Optional[str] = None


class FeeScheduleUpdate(BaseModel):
    items: list[FeeScheduleItem]


class FeeScheduleApply(BaseModel):
    """Copia el tarifario a los defaults de fee de una competencia."""
    competition_id: str
    fee_event_type: Optional[str] = None   # None → usa el que ya tiene
    overwrite: bool = False                # pisar los valores ya cargados


class HeadcountPut(BaseModel):
    year: int
    items: list[HeadcountItem]


class BudgetAccessItem(BaseModel):
    department_code: str          # '*' = todos los departamentos
    can_view: bool = True
    can_edit: bool = False


class BudgetAccessPut(BaseModel):
    items: list[BudgetAccessItem]


class AssumptionsPut(BaseModel):
    avg_flight_cost: float
    notes: Optional[str] = None


# ─── BUDGET: ingresos ─────────────────────────────────────────────────────

class RevenueCreate(BaseModel):
    department_code: str
    account_code: str
    competition_id: Optional[str] = None
    source_name: str
    description: Optional[str] = None
    amount: float
    expected_date: Optional[str] = None
    received_date: Optional[str] = None
    status: Optional[str] = "expected"
    comments: Optional[str] = None


class RevenueUpdate(BaseModel):
    department_code: Optional[str] = None
    account_code: Optional[str] = None
    competition_id: Optional[str] = None
    source_name: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    expected_date: Optional[str] = None
    received_date: Optional[str] = None
    status: Optional[str] = None
    comments: Optional[str] = None


# ─── EXTERNAL STAFF EVALUATIONS ───────────────────────────────────────────

class StaffEvaluationCreate(BaseModel):
    competition_id: str
    personnel_id: str
    evaluator_role: Optional[str] = "competition_lead"
    scores: Optional[dict] = None   # {criterion: 1..5}, validated in the router
    strengths: Optional[str] = None
    improvements: Optional[str] = None
    comments: Optional[str] = None
    status: Optional[str] = "draft"


class StaffEvaluationUpdate(BaseModel):
    evaluator_role: Optional[str] = None
    scores: Optional[dict] = None
    strengths: Optional[str] = None
    improvements: Optional[str] = None
    comments: Optional[str] = None
    status: Optional[str] = None
