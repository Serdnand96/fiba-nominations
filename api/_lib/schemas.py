from pydantic import BaseModel, Field, field_validator
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
    # ID de GDAP (migración 051). Si llega solo la URL, el primer sync lo resuelve.
    fiba_competition_id: Optional[int] = None
    # "A" o "37,38,39,40": acota el sync a esos groupPairingCode (LSB, Final Four).
    fiba_group_codes: Optional[str] = None
    # Fechas de los PARTIDOS del tramo (migración 053), no las del viaje: para
    # feeds sin windowCode que solo se separan por fecha (BCLA). Las dos o ninguna.
    fiba_segment_from: Optional[str] = None
    fiba_segment_to: Optional[str] = None
    # Alta desde "Nuevas en FIBA": las fechas y la sede que publica FIBA.
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    month: Optional[int] = Field(default=None, ge=1, le=12)
    location: Optional[str] = None
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
    fiba_competition_id: Optional[int] = None
    fiba_group_codes: Optional[str] = None
    fiba_segment_from: Optional[str] = None
    fiba_segment_to: Optional[str] = None
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


# Un <input type="date"> que el usuario deja vacío manda "", no null, y estas
# columnas son `date` en Postgres: el string vacío no es una fecha ausente, es
# una fecha inválida, y el insert muere con 22007 (invalid input syntax for type
# date). Como el campo es opcional de verdad —las cuatro columnas son nullable—
# lo correcto es leer "" como "sin fecha" acá, en el borde, y no confiar en que
# cada cliente lo normalice.
_DATE_FIELDS = ("letter_date", "arrival_date", "departure_date",
                "confirmation_deadline")


def _blank_date_is_none(value):
    return None if isinstance(value, str) and not value.strip() else value


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

    _blank_dates = field_validator(*_DATE_FIELDS, mode="before")(_blank_date_is_none)


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

    _blank_dates = field_validator(*_DATE_FIELDS, mode="before")(_blank_date_is_none)


class NominationUpdate(BaseModel):
    letter_date: Optional[str] = None
    location: Optional[str] = None
    venue: Optional[str] = None
    arrival_date: Optional[str] = None
    departure_date: Optional[str] = None
    game_dates: Optional[list[GameDate]] = None
    window_fee: Optional[float] = None
    incidentals: Optional[float] = None
    confirmation_deadline: Optional[str] = None

    _blank_dates = field_validator(*_DATE_FIELDS, mode="before")(_blank_date_is_none)


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

# Un str libre dejaba pasar cualquier cosa hasta el CHECK de Postgres (500
# genérico); el Literal lo rechaza con 422 antes de llegar a la base.
# `split` dejó de existir en la migración 047: lo reemplaza `paid_amount` sobre
# un pago `in_process` (pago parcial explícito en vez de un estado opaco).
PaymentStatus = Literal["new", "in_process", "completed", "cancelled"]

# Clases de adjunto de un pago (CHECK de payment_attachments.kind, migración
# 047). El upload normaliza lo que mande un cliente viejo ("BANK INFO", "w-8").
PaymentAttachmentKind = Literal["EXPENSES", "W8", "BANK_INFO", "INVOICE", "RECEIPT", "OTHER"]

# Formulario fiscal de la persona (personnel_banking.tax_form_kind). `exempt`
# = no corresponde formulario (lo decide Finance, no el sistema).
TaxFormKind = Literal["W-8BEN", "W-8BEN-E", "W-9", "exempt"]


class PaymentCreate(BaseModel):
    nomination_id: str
    budget_code: str
    # ge=0: un monto negativo no es un pago, es un error de tipeo que restaría
    # del ejecutado del presupuesto sin que nada lo marque.
    amount: Optional[float] = Field(None, ge=0)   # None → prefilled from nomination.total
    extra: Optional[float] = Field(0, ge=0)
    airfare: Optional[float] = Field(0, ge=0)     # flight cost — tracked apart, not in total
    comments: Optional[str] = None
    # Un pago nace SIEMPRE `new`. El campo queda para no romper a un cliente que
    # lo mande, pero cualquier otro valor es 400: el estado se mueve solo por
    # POST /payments/{id}/transition.
    status: Optional[PaymentStatus] = "new"
    payment_date: Optional[str] = None
    bank_confirmation: Optional[str] = None


class PaymentUpdate(BaseModel):
    """Update parcial. El router usa model_dump(exclude_unset=True): un campo
    ausente no se toca y uno mandado en null se limpia (comments, payment_date,
    bank_confirmation). Los montos y el budget no admiten null — ver
    _PAYMENT_NOT_NULL en payments.py.

    `status` y `paid_amount` siguen declarados SOLO para poder rechazarlos con
    un 400 legible ("use /transition", "use /record-partial"): si se sacaran
    del schema, Pydantic los ignoraría en silencio y el cliente creería que los
    cambió. Registrar plata pagada es soltar plata: pide los mismos sellos que
    completar, y eso solo lo valida POST /payments/{id}/record-partial."""
    budget_code: Optional[str] = None
    amount: Optional[float] = Field(None, ge=0)
    extra: Optional[float] = Field(None, ge=0)
    airfare: Optional[float] = Field(None, ge=0)
    paid_amount: Optional[float] = Field(None, ge=0)
    comments: Optional[str] = None
    status: Optional[str] = None
    payment_date: Optional[str] = None
    bank_confirmation: Optional[str] = None


class PaymentTransition(BaseModel):
    """Cuerpo de POST /payments/{id}/transition. Qué campos hacen falta depende
    de la transición (ver check_payment_transition en payments.py)."""
    status: PaymentStatus
    reason: Optional[str] = Field(None, max_length=2000)
    payment_date: Optional[str] = None
    bank_confirmation: Optional[str] = Field(None, max_length=120)
    # Solo para `completed`, y tiene que ser el total (o no venir): un pago
    # completado está pagado entero. El parcial va por /record-partial.
    paid_amount: Optional[float] = Field(None, ge=0)


class PaymentRecordPartial(BaseModel):
    """Cuerpo de POST /payments/{id}/record-partial: cuánto se lleva pagado de
    un pago `in_process`. 0 < paid_amount < total (el total se completa por
    /transition). `reason` solo hace falta para el override del superadmin."""
    paid_amount: float = Field(..., ge=0)
    reason: Optional[str] = Field(None, max_length=2000)


class PaymentBulkStatus(BaseModel):
    """Cambio de estado en lote. Sin `paid_amount`: cada pago tiene su total, y
    al completar en lote se asume el total de cada uno."""
    ids: list[str] = Field(..., min_length=1, max_length=500)
    status: PaymentStatus
    reason: Optional[str] = Field(None, max_length=2000)
    payment_date: Optional[str] = None
    bank_confirmation: Optional[str] = Field(None, max_length=120)


class PaymentBulkCreate(BaseModel):
    """Alta masiva desde una competencia. Sin `nomination_ids` → todas las
    nominaciones elegibles del evento."""
    competition_id: str
    budget_code: str
    nomination_ids: Optional[list[str]] = Field(None, max_length=500)


class PaymentSyncAmount(BaseModel):
    ids: list[str] = Field(..., min_length=1, max_length=500)


class PersonnelBankingPut(BaseModel):
    """Upsert parcial de la ficha bancaria (exclude_unset: null limpia).

    Los números enmascarados que devuelve el GET (`****1234`) se ignoran si
    vuelven en el body: el formulario puede reenviar la ficha entera sin pisar
    el número real con la máscara."""
    payment_method: Optional[Literal["wire", "ach", "other"]] = None
    bank_name: Optional[str] = Field(None, max_length=200)
    bank_address: Optional[str] = Field(None, max_length=500)
    account_holder: Optional[str] = Field(None, max_length=200)
    account_number: Optional[str] = Field(None, max_length=64)
    routing_number: Optional[str] = Field(None, max_length=64)
    swift: Optional[str] = Field(None, max_length=32)
    iban: Optional[str] = Field(None, max_length=64)
    currency: Optional[str] = Field(None, max_length=8)
    notes: Optional[str] = Field(None, max_length=2000)
    tax_form_kind: Optional[TaxFormKind] = None
    tax_form_signed_at: Optional[str] = None
    tax_form_expires_at: Optional[str] = None


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


class AccountRemap(BaseModel):
    """Asignar el código oficial a una cuenta provisoria (`COMP-*`).

    `force` saltea el 409 que protege a las cuentas que `budget_accounts.py`
    usa para imputar pagos por rol: ver POST /budget/accounts/{code}/remap.
    """
    new_code: str
    force: bool = False


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
    # Solo para la carga histórica directa en `paid` (admin general). Fuera de
    # eso un gasto nace `draft` y la fecha de pago la pone /transition.
    payment_date: Optional[str] = None
    status: Optional[str] = "draft"           # draft | paid (paid: solo admin general)
    payment_method: Optional[str] = None
    bank_confirmation: Optional[str] = None
    invoice_no: Optional[str] = None
    comments: Optional[str] = None
    # Línea del presupuesto contra la que se ejecuta (columna de la 035). Tiene
    # que ser del mismo departamento, la misma cuenta y el año de expense_date.
    budget_line_id: Optional[str] = None


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
    # `status` y `payment_date` siguen declarados SOLO para poder rechazarlos
    # con un 400 explícito ("usá /transition"): si se sacaran del modelo,
    # Pydantic los descartaría en silencio y el cliente creería que el cambio
    # de estado se aplicó.
    payment_date: Optional[str] = None
    status: Optional[str] = None
    payment_method: Optional[str] = None
    bank_confirmation: Optional[str] = None
    invoice_no: Optional[str] = None
    comments: Optional[str] = None
    budget_line_id: Optional[str] = None     # null explícito = desvincular


class ExpenseTransition(BaseModel):
    """Cuerpo de POST /budget/expenses/{id}/transition.

    `status` es el estado DESTINO. Qué campos hacen falta depende de la
    transición (ver check_expense_transition en budget.py): `reason` para
    rechazar, cancelar, revertir un pago o aprobar lo propio siendo
    superadmin; `payment_date` para pagar.
    """
    status: str
    reason: Optional[str] = Field(None, max_length=2000)
    payment_date: Optional[str] = None
    payment_method: Optional[str] = Field(None, max_length=40)
    bank_confirmation: Optional[str] = Field(None, max_length=120)


class ExpenseApprove(BaseModel):
    """Cuerpo opcional del alias POST /budget/expenses/{id}/approve."""
    reason: Optional[str] = Field(None, max_length=2000)


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
    # Aprobar gastos del departamento (migración 048). Implica can_view. Es
    # independiente de can_edit: el que carga y el que aprueba son roles
    # distintos a propósito (separación de funciones).
    can_approve: bool = False


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
