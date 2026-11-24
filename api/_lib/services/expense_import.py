"""Import de gastos desde el ledger de Finanzas (.xlsx).

Finanzas entrega el ejecutado como un ledger plano: una fila por movimiento con
fecha, cuenta de gasto, detalle, débito, proyecto, departamento y centro de
costo. Este módulo lo lee y arma el plan de importación; el router
(`budget.py`, `/budget/import/expenses/*`) trae los catálogos y los gastos ya
cargados, y es el único que escribe.

Es puro a propósito: no consulta la base. Recibe bytes y listas, devuelve
dicts. Así el preview y el commit calculan exactamente el mismo plan y los
tests del parser no necesitan sembrar nada.

Reglas que se ven estrictas y son correctas:

- Los gastos entran `paid` y un gasto pagado casi no se corrige (BUDGET_MODULE
  §14). Por eso nada se adivina: un código de departamento o de proyecto sin
  asignar deja la fila en error hasta que una persona decide, y una cuenta que
  no está en el plan nunca cae a otra en silencio.
- El duplicado se decide por fecha + detalle + monto, comparado como
  multiconjunto: el mismo cargo dos veces el mismo día es legítimo y pasa
  (Apple cobra dos veces $0,99 el mismo día), pero lo que ya está en la base
  no se vuelve a cargar.
- Un crédito o un monto negativo no se importa: `expenses.amount` no admite
  negativos. Se lista con su total para que el ejecutado no parezca cerrado.
"""
import hashlib
import io
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Optional

from openpyxl import load_workbook

from api._lib.services.budget_import import clean, norm, to_number

GENERAL = "__general__"     # proyecto asignado a "gasto general" (competition_id NULL)
MARK = "import:ledger:"     # prefijo de `comments`; lo sigue el código de lote

MAX_ROWS = 1000             # movimientos por hoja
MAX_HEADER_SCAN = 25        # filas donde buscar el encabezado

# Estados de un gasto existente que no cuentan como "ya cargado".
_DEAD_STATUSES = {"cancelled", "rejected"}


class LedgerFormatError(ValueError):
    """El archivo no se puede leer como ledger. El router lo devuelve como 400."""


# ─── Encabezados ─────────────────────────────────────────────────────────────
#
# Clasificador propio y por texto exacto (ya normalizado). El del import de
# presupuesto no sirve acá: toma "offset account" como cuenta y "total" como
# monto. En este formato "Offset Account" es la contrapartida (la tarjeta), no
# la cuenta de gasto, y confundirlas imputaría todo a una cuenta inexistente.
_ROLES = {
    "date": {"posting date", "date", "fecha", "fecha de contabilizacion", "transaction date"},
    "account": {"account", "cuenta", "g/l account", "expense account", "cuenta de gasto"},
    "details": {"details", "description", "descripcion", "detalle", "detalles", "concepto"},
    "debit": {"debit", "debit (lc)", "amount", "monto", "importe", "debito", "debe"},
    "credit": {"credit", "credit (lc)", "credito", "haber"},
    "project": {"project", "proyecto", "project code"},
    "department": {"dept", "department", "departments", "departamento", "departamentos"},
    "cost_center": {"cost center", "cost centre", "centro de costo", "centro de costos"},
    "offset": {"offset account", "contra account", "cuenta de contrapartida"},
}
_ROLE_BY_HEADER = {header: role for role, headers in _ROLES.items() for header in headers}
_REQUIRED = ("date", "account", "details", "debit")
_ROLE_LABEL = {"date": "fecha", "account": "cuenta", "details": "detalle", "debit": "monto"}


def _header_roles(cells) -> dict:
    """{rol: índice de columna} de una fila; el primero de cada rol gana."""
    roles: dict = {}
    for index, value in enumerate(cells):
        role = _ROLE_BY_HEADER.get(norm(value))
        if role and role not in roles:
            roles[role] = index
    return roles


def _find_header(ws):
    """(fila, roles) del encabezado, o (None, mejor candidato) si no hay."""
    best: dict = {}
    for row_no, cells in enumerate(
        ws.iter_rows(min_row=1, max_row=MAX_HEADER_SCAN, values_only=True), 1
    ):
        roles = _header_roles(cells)
        if all(r in roles for r in _REQUIRED):
            return row_no, roles
        if len(roles) > len(best):
            best = roles
    return None, best


# ─── Celdas ──────────────────────────────────────────────────────────────────
def _code(value) -> Optional[str]:
    """Código de cuenta, proyecto o departamento como texto.

    Excel guarda 611000 como número: `str(611000.0)` daría "611000.0".
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return clean(value)


def _iso_date(value) -> Optional[str]:
    """Fecha ISO de una celda. Solo `datetime`/`date` o texto ISO.

    Un texto como "3/4/2026" es ambiguo (el ledger es de EE. UU., la app se usa
    en América Latina) y devuelve None: la fila queda en error en vez de entrar
    con el mes y el día cruzados.
    """
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        text = value.strip()[:10]
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            try:
                return date.fromisoformat(text).isoformat()
            except ValueError:
                return None
    return None


def cents(amount) -> Optional[int]:
    """Monto en centavos, redondeando la mitad hacia arriba.

    `round()` de Python redondea al par (2,675 → 2,67) y `numeric(12,2)` de
    Postgres no: con centavos enteros la clave de duplicado y lo que se guarda
    coinciden siempre.
    """
    if amount is None or isinstance(amount, bool):
        return None
    try:
        value = Decimal(repr(amount)) if isinstance(amount, float) else Decimal(str(amount))
    except InvalidOperation:
        return None
    if not value.is_finite():
        return None
    return int((value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _description(value) -> Optional[str]:
    """Detalle con espacios colapsados y sin las comillas sueltas del export."""
    text = clean(value)
    return (text.strip('"').strip() or None) if text else None


def text_key(description) -> str:
    """Detalle reducido a letras y números, para comparar entre exports.

    El mismo cargo sale del ledger con espacios de ancho fijo, con o sin una
    comilla final y en otra capitalización según cuándo se exportó.
    """
    text = unicodedata.normalize("NFKD", str(description or "").casefold())
    text = "".join(c for c in text if not unicodedata.combining(c))
    # Letras y números de cualquier alfabeto: con solo [a-z0-9], dos detalles
    # en otro alfabeto quedaban con la misma clave vacía y uno tapaba al otro.
    return " ".join(re.findall(r"[^\W_]+", text))


def dedupe_key(expense_date, description, amount) -> tuple:
    return (str(expense_date or "")[:10], text_key(description), cents(amount))


# ─── Destinatario ────────────────────────────────────────────────────────────
#
# Descripción de tarjeta → proveedor legible. Regex sobre la descripción limpia
# en mayúsculas. Vivían en scripts/import_it_2026.py; el script ahora los
# importa de acá. No crean proveedores: el nombre va a `payee_name`.
VENDOR_PATTERNS = [
    (r"^AT&T|^CREDENCE-AT&T", "AT&T"),
    (r"^TMOBILE|^T-MOBILE", "T-Mobile"),
    (r"^ADOBE", "Adobe"),
    (r"^MICROSOFT", "Microsoft"),
    (r"APPLE\.COM", "Apple"),
    (r"^WIFIONBOARD", "WiFi Onboard"),
    (r"^OPENAI", "OpenAI"),
    (r"^AD AGE", "Ad Age"),
    (r"^ESPN PLUS", "ESPN+"),
    (r"^SPOTIFY", "Spotify"),
    (r"^STARLINK", "Starlink"),
    (r"^TELECOM ARGENTINA", "Telecom Argentina"),
    (r"^AMAZON", "Amazon"),
    (r"^THE UPS STORE", "The UPS Store"),
    (r"^HOLAFLY", "Holafly"),
    (r"EVOLVE BY HUD", "Evolve by Hudl"),
    (r"^PERSONAL ", "Personal"),
    (r"^ZOOM\.COM", "Zoom"),
    (r"^BEST ?BUY", "Best Buy"),
    (r"^FEDEX", "FedEx"),
    (r"^TAX1099", "Tax1099"),
    (r"^ANYDESK", "AnyDesk"),
    (r"^BOLD ", "Bold"),
    (r"^GOOGLE", "Google"),
    (r"^CLAUDE\.AI|^ANTHROPIC", "Anthropic"),
    (r"^OTTER\.AI", "Otter.ai"),
    (r"^DIGITALOCEAN", "DigitalOcean"),
    (r"^DROPBOX", "Dropbox"),
    (r"^A/P INVOICES", "A/P Invoice"),
]


def vendor_for(description: str) -> tuple:
    """(nombre, reconocido). Sin patrón devuelve la descripción tal cual."""
    upper = str(description or "").upper()
    for pattern, name in VENDOR_PATTERNS:
        if re.search(pattern, upper):
            return name, True
    return description, False


def invoice_for(description: str) -> Optional[str]:
    match = re.search(r"A/P Invoices?\s*-\s*(\S+)", str(description or ""), re.I)
    return match.group(1) if match else None


def payee_for(description: str, raw=None) -> str:
    """Nombre del destinatario de un movimiento.

    Con patrón conocido, el proveedor legible. Sin patrón, el primer tramo del
    detalle crudo: las descripciones de tarjeta vienen en columnas de ancho
    fijo ("WETRANSFER          AMSTERDAM           NL") y lo que sigue a los
    espacios es la ciudad.
    """
    name, matched = vendor_for(description)
    if matched:
        return name
    head = re.split(r"\s{2,}", str(raw if raw is not None else description or "").strip())[0]
    head = head.split("*")[0].strip(' "')
    return head or description


# ─── Lectura ─────────────────────────────────────────────────────────────────
def read_ledger(content: bytes, sheet: Optional[str] = None) -> dict:
    """Lee una hoja del ledger. No decide nada: solo qué dice cada fila.

    Levanta LedgerFormatError si el archivo no abre, si la hoja pedida no
    existe o si ninguna hoja tiene las columnas de fecha, cuenta, detalle y
    monto. Una hoja que no se reconoce no se adivina.
    """
    try:
        wb = load_workbook(io.BytesIO(content), data_only=True)
    except Exception:
        # openpyxl levanta BadZipFile, InvalidFileException, KeyError… según
        # qué tan roto esté el archivo o si tiene contraseña.
        raise LedgerFormatError("No se pudo abrir el archivo. Verifica que sea un .xlsx sin contraseña.")

    visible = [ws for ws in wb.worksheets if ws.sheet_state == "visible"] or list(wb.worksheets)
    found = {ws.title: _find_header(ws) for ws in visible}
    sheets = [{"name": ws.title, "recognized": found[ws.title][0] is not None} for ws in visible]

    if sheet:
        ws = next((w for w in visible if w.title == sheet), None)
        if ws is None:
            raise LedgerFormatError(f"La hoja «{sheet}» no existe en el archivo.")
    else:
        ws = next((w for w in visible if found[w.title][0] is not None), visible[0])

    header_row, roles = found[ws.title]
    if header_row is None:
        missing = [_ROLE_LABEL[r] for r in _REQUIRED if r not in roles]
        raise LedgerFormatError(
            f"La hoja «{ws.title}» no tiene las columnas de un ledger. "
            f"Falta: {', '.join(missing)}."
        )

    def cell(cells, role):
        index = roles.get(role)
        return cells[index] if index is not None and index < len(cells) else None

    rows: list = []
    blank = 0
    hidden = 0
    last_data_row = header_row
    for row_no, cells in enumerate(ws.iter_rows(min_row=header_row + 1, values_only=True), header_row + 1):
        values = {role: cell(cells, role) for role in roles}
        if all(v is None or (isinstance(v, str) and not v.strip()) for v in values.values()):
            blank += 1
            continue
        last_data_row = row_no
        if ws.row_dimensions[row_no].hidden:
            hidden += 1
        raw_details = values.get("details")
        rows.append({
            "row": row_no,
            "date": _iso_date(values.get("date")),
            "date_raw": values.get("date"),
            "account": _code(values.get("account")),
            "description": _description(raw_details),
            "details_raw": raw_details if isinstance(raw_details, str) else None,
            "debit": to_number(values.get("debit")),
            "debit_raw": values.get("debit"),
            "credit": to_number(values.get("credit")),
            "project": _code(values.get("project")),
            "department": _code(values.get("department")),
            "cost_center": _code(values.get("cost_center")),
            "offset": _code(values.get("offset")),
        })
        if len(rows) > MAX_ROWS:
            raise LedgerFormatError(
                f"La hoja «{ws.title}» tiene más de {MAX_ROWS} movimientos. Divide el archivo."
            )

    # Las filas vacías del final no son parte del ledger: no se cuentan.
    trailing = max(0, (ws.max_row or last_data_row) - last_data_row)
    return {
        "sheet": ws.title,
        "sheets": sheets,
        "header_row": header_row,
        "has_department": "department" in roles,
        "has_project": "project" in roles,
        "rows": rows,
        "blank": max(0, blank - trailing),
        "hidden": hidden,
        "sha256": hashlib.sha256(content).hexdigest(),
    }


# ─── Plan ────────────────────────────────────────────────────────────────────
def _classify_rows(parsed: dict) -> tuple:
    """Separa movimientos de totales, créditos y ceros. (movimientos, aparte)."""
    entries: list = []
    aside = {"totals": [], "credits": [], "zero": 0}
    running = 0  # centavos de los débitos leídos hasta acá

    for row in parsed["rows"]:
        debit, credit = cents(row["debit"]), cents(row["credit"])
        entry = {**row, "problem": None, "amount_cents": debit}

        # Una fila con monto y nada más es el total del export.
        if row["date"] is None and row["date_raw"] is None and not row["description"] \
                and not row["account"] and debit is not None:
            closes = abs(debit - running) <= 1
            aside["totals"].append({"row": row["row"], "amount": debit / 100, "ok": closes})
            if closes:
                continue
            entry["problem"] = ("orphan_amount", "Monto sin fecha ni detalle, y no coincide con la suma del archivo")
            entries.append(entry)
            continue

        if credit and debit and debit > 0:
            # Débito y crédito en la misma fila: no hay forma de saber cuál
            # vale, y tomar el débito escondería el crédito.
            entry["problem"] = ("debit_and_credit", "La fila trae débito y crédito a la vez")
            running += debit
            entries.append(entry)
            continue
        if credit and (not debit or debit <= 0):
            aside["credits"].append({
                "row": row["row"], "expense_date": row["date"],
                "description": row["description"], "amount": abs(credit) / 100,
            })
            continue
        if debit is not None and debit < 0:
            aside["credits"].append({
                "row": row["row"], "expense_date": row["date"],
                "description": row["description"], "amount": abs(debit) / 100,
            })
            continue
        if debit == 0:
            aside["zero"] += 1
            continue

        if debit is None:
            entry["problem"] = ("amount_unreadable", "No se pudo leer el monto")
        elif row["date"] is None:
            entry["problem"] = (
                ("date_missing", "Falta la fecha") if row["date_raw"] is None
                else ("date_unreadable", "La fecha no es una fecha de Excel ni tiene formato AAAA-MM-DD")
            )
        elif not 2000 <= int(row["date"][:4]) <= 2100:
            entry["problem"] = ("date_unreadable", "La fecha está fuera de rango")
        elif not row["description"]:
            entry["problem"] = ("description_missing", "Falta el detalle")
        elif not row["account"]:
            entry["problem"] = ("account_missing", "Falta la cuenta")

        if debit is not None and debit > 0:
            running += debit
        entries.append(entry)
    return entries, aside


def _existing_index(existing: list) -> dict:
    """{clave: [gasto, …]} de los gastos vivos de la base."""
    index = defaultdict(list)
    for expense in existing:
        if expense.get("status") in _DEAD_STATUSES:
            continue
        key = dedupe_key(expense.get("expense_date"), expense.get("description"), expense.get("amount"))
        index[key].append(expense)
    return index


def build_plan(parsed: dict, *, mapping: Optional[dict], catalog: dict,
               existing: list, lines: list) -> dict:
    """Decide qué pasa con cada fila. No escribe.

    mapping: {"accounts": {código del archivo: cuenta}, "departments": {código:
              departamento}, "projects": {código: id de competencia | GENERAL},
              "force": [fila], "skip": [fila]}
    catalog: {"accounts": {code: {...}}, "departments": {code: {...}},
              "competitions": {id: {...}}}
    existing: gastos de la base en las fechas del archivo (cualquier estado).
    lines:    líneas de presupuesto de los años del archivo.
    """
    mapping = mapping or {}
    map_accounts = mapping.get("accounts") or {}
    map_departments = mapping.get("departments") or {}
    map_projects = mapping.get("projects") or {}
    forced = {int(r) for r in mapping.get("force") or []}
    skipped = {int(r) for r in mapping.get("skip") or []}

    accounts = catalog.get("accounts") or {}
    departments = catalog.get("departments") or {}
    competitions = catalog.get("competitions") or {}
    department_by_lower = {code.lower(): code for code, d in departments.items() if d.get("active", True)}

    def warn(row, code, message, **params):
        # `params` es para que el front traduzca por `code`; `message` es el
        # texto en español de respaldo.
        return {"row": row, "code": code, "message": message, "params": params}

    entries, aside = _classify_rows(parsed)

    # ── Resolver cuenta, departamento y proyecto de cada fila ────────────
    for entry in entries:
        entry["issues"] = []

        file_account = entry["account"]
        account = map_accounts.get(file_account, file_account) if file_account else None
        info = accounts.get(account) if account else None
        if info and info.get("active", True) and info.get("kind") == "expense":
            entry["account_code"] = account
        else:
            entry["account_code"] = None
            if file_account:
                entry["issues"].append(("account_unknown", f"La cuenta {file_account} no es una cuenta de gasto activa"))

        file_department = entry["department"] or ""
        department = map_departments.get(file_department)
        if department in departments and departments[department].get("active", True):
            entry["department_code"] = department
        else:
            entry["department_code"] = None
            entry["issues"].append((
                "department_unmapped",
                f"Falta asignar el departamento {file_department}" if file_department
                else "Falta asignar el departamento",
            ))

        file_project = entry["project"] or ""
        target = map_projects.get(file_project)
        if not file_project and target is None:
            target = GENERAL    # sin proyecto en el archivo no hay nada que asignar
        if target == GENERAL:
            entry["competition_id"], entry["project_resolved"] = None, True
        elif target in competitions:
            entry["competition_id"], entry["project_resolved"] = target, True
        else:
            entry["competition_id"], entry["project_resolved"] = None, False
            entry["issues"].append(("project_unmapped", f"Falta asignar el proyecto {file_project}"))

    # ── Duplicados: multiconjunto contra la base, de lo más a lo menos exacto ─
    index = _existing_index(existing)
    consumed: set = set()
    comparable = [e for e in entries if e["problem"] is None]
    for entry in comparable:
        entry["key"] = dedupe_key(entry["date"], entry["description"], entry["amount_cents"] / 100)
        entry["duplicate_of"] = None

    def match(entry, test):
        for candidate in index.get(entry["key"], ()):
            if candidate["id"] not in consumed and test(candidate):
                consumed.add(candidate["id"])
                entry["duplicate_of"] = candidate
                return

    tiers = (
        lambda e: lambda c: (e["account_code"] and e["department_code"]
                             and c.get("account_code") == e["account_code"]
                             and c.get("department_code") == e["department_code"]),
        lambda e: lambda c: e["account_code"] and c.get("account_code") == e["account_code"],
        lambda e: lambda c: True,
    )
    for tier in tiers:
        for entry in comparable:
            if entry["duplicate_of"] is None:
                match(entry, tier(entry))

    # ── Estado final de cada fila ─────────────────────────────────────────
    #
    # error de lectura > duplicado (salvo "Importar igual") > error de
    # asignación > nueva. Un duplicado no se importa, así que no hace falta
    # asignarle nada para dejarlo afuera.
    rows_out: list = []
    warnings: list = []
    to_import: list = []
    evidence = defaultdict(Counter)        # código de depto del archivo → dónde están sus duplicados

    by_date_amount = defaultdict(list)     # para el aviso de posible duplicado
    for expense in existing:
        if expense.get("status") not in _DEAD_STATUSES:
            by_date_amount[(str(expense.get("expense_date") or "")[:10], cents(expense.get("amount")))].append(expense)

    for entry in entries:
        row_no = entry["row"]
        duplicate = entry.get("duplicate_of")
        is_forced, is_skipped = row_no in forced, row_no in skipped
        code = message = None

        if duplicate:
            evidence[entry["department"] or ""][duplicate.get("department_code")] += 1

        if entry["problem"]:
            status = "error"
            code, message = entry["problem"]
        elif duplicate and not is_forced:
            status = "duplicate"
        elif entry["issues"]:
            status = "error"
            code, message = entry["issues"][0]
        else:
            status = "new"

        will_import = status == "new" and not is_skipped
        amount = entry["amount_cents"] / 100 if entry["amount_cents"] is not None else None
        payee = payee_for(entry["description"], entry["details_raw"]) if entry["description"] else None
        out = {
            "row": row_no,
            "expense_date": entry["date"],
            "description": entry["description"],
            "payee_name": payee,
            "amount": amount,
            "file_account": entry["account"],
            "account_code": entry.get("account_code"),
            "file_department": entry["department"],
            "department_code": entry.get("department_code"),
            "file_project": entry["project"],
            "competition_id": entry.get("competition_id"),
            "cost_center": entry["cost_center"],
            "offset": entry["offset"],
            "budget_line_id": None,
            "status": status,
            "code": code,
            "message": message,
            "duplicate_of": (
                {"id": duplicate["id"], "record_no": duplicate.get("record_no"),
                 "department_code": duplicate.get("department_code"),
                 "account_code": duplicate.get("account_code")}
                if duplicate else None
            ),
            "forced": bool(duplicate) and is_forced,
            "skipped": is_skipped and status == "new",
            "will_import": will_import,
        }
        rows_out.append(out)
        if will_import:
            to_import.append(out)
            if not duplicate:
                near = [
                    e for e in by_date_amount.get((entry["date"], entry["amount_cents"]), ())
                    if e["id"] not in consumed
                ]
                if near:
                    record = near[0].get("record_no") or "-"
                    details = near[0].get("description") or "-"
                    warnings.append(warn(
                        row_no, "possible_duplicate",
                        f"Posible duplicado de {record}: misma fecha y monto, otro detalle ({details})",
                        record=record, details=details,
                    ))

    # ── Línea de presupuesto: solo si hay exactamente una candidata ───────
    lines_by_key = defaultdict(list)
    for line in lines:
        if (line.get("kind") or "expense") != "expense":
            continue
        lines_by_key[(
            int(line.get("year") or 0), line.get("department_code"),
            line.get("account_code"), line.get("competition_id"),
        )].append(line["id"])
    for out in to_import:
        candidates = lines_by_key.get((
            int(out["expense_date"][:4]), out["department_code"],
            out["account_code"], out["competition_id"],
        ), [])
        if len(candidates) == 1:
            out["budget_line_id"] = candidates[0]

    # ── Repeticiones dentro del archivo: se importan, pero se avisan ──────
    repeated = defaultdict(list)
    for entry in comparable:
        repeated[entry["key"]].append(entry["row"])
    for key, row_numbers in repeated.items():
        if len(row_numbers) > 1:
            listed = ", ".join(str(r) for r in row_numbers)
            warnings.append(warn(
                row_numbers[0], "repeated_in_file",
                f"El mismo movimiento aparece {len(row_numbers)} veces en el archivo (filas {listed})",
                count=len(row_numbers), rows=listed,
            ))
    if parsed.get("hidden"):
        warnings.append(warn(
            None, "hidden_rows",
            f"El archivo tiene {parsed['hidden']} filas ocultas o filtradas. Se leen igual.",
            count=parsed["hidden"],
        ))
    for total in aside["totals"]:
        if not total["ok"]:
            amount = f"{total['amount']:,.2f}"
            warnings.append(warn(
                total["row"], "total_mismatch",
                f"La fila de total ({amount}) no coincide con la suma del archivo",
                amount=amount,
            ))
    warnings.sort(key=lambda w: (w["row"] is None, w["row"] or 0))

    # ── Paneles de asignación ─────────────────────────────────────────────
    def group(field):
        totals = defaultdict(lambda: {"rows": 0, "cents": 0})
        for entry in entries:
            if entry["problem"] is None:
                bucket = totals[entry[field] or ""]
                bucket["rows"] += 1
                bucket["cents"] += entry["amount_cents"] or 0
        return totals

    department_panel = []
    for code, bucket in sorted(group("department").items()):
        # Se sugiere por evidencia (dónde están los duplicados de ese código)
        # o porque el código es idéntico a uno del sistema. Nunca por parecido,
        # y la sugerencia no se aplica sola: la confirma una persona.
        found = evidence.get(code) or Counter()
        suggested = next(iter(found)) if len(found) == 1 else None
        proof = found.get(suggested, 0) if suggested else 0
        if suggested is None and not found and code:
            suggested = department_by_lower.get(code.lower())
        mapped = map_departments.get(code)
        department_panel.append({
            "code": code, "rows": bucket["rows"], "amount": bucket["cents"] / 100,
            "mapped": mapped if mapped in departments else None,
            "suggested": suggested if suggested in departments else None,
            "evidence": proof,
        })

    project_panel = []
    for code, bucket in sorted(group("project").items()):
        if not code:
            continue
        mapped = map_projects.get(code)
        project_panel.append({
            "code": code, "rows": bucket["rows"], "amount": bucket["cents"] / 100,
            "mapped": mapped if (mapped == GENERAL or mapped in competitions) else None,
        })

    account_panel = []
    for code, bucket in sorted(group("account").items()):
        info = accounts.get(code)
        if not code or (info and info.get("active", True) and info.get("kind") == "expense"):
            continue
        mapped = map_accounts.get(code)
        account_panel.append({
            "code": code, "rows": bucket["rows"], "amount": bucket["cents"] / 100,
            "mapped": mapped if mapped in accounts else None,
        })

    # ── En la base y no en el archivo ─────────────────────────────────────
    #
    # Solo gastos que entraron por un import y son de los departamentos que
    # toca este archivo: lo que Finanzas sacó del ledger después de cargarlo.
    target_departments = {o["department_code"] for o in rows_out if o["department_code"]}
    target_departments |= {
        o["duplicate_of"]["department_code"] for o in rows_out if o["duplicate_of"]
    }
    not_in_file = [
        {"id": e["id"], "record_no": e.get("record_no"), "expense_date": str(e.get("expense_date") or "")[:10],
         "description": e.get("description"), "amount": (cents(e.get("amount")) or 0) / 100,
         "account_code": e.get("account_code"), "department_code": e.get("department_code")}
        for e in existing
        if e["id"] not in consumed and e.get("status") == "paid"
        and str(e.get("comments") or "").startswith("import:")
        and e.get("department_code") in target_departments
    ]
    not_in_file.sort(key=lambda r: (r["expense_date"], r["record_no"] or ""))

    # ── Resumen y totales ─────────────────────────────────────────────────
    summary = defaultdict(lambda: {"rows": 0, "cents": 0})
    for out in to_import:
        bucket = summary[(out["department_code"], out["account_code"], out["competition_id"])]
        bucket["rows"] += 1
        bucket["cents"] += cents(out["amount"])

    def total(predicate):
        return sum(cents(o["amount"]) or 0 for o in rows_out if predicate(o)) / 100

    counts = {
        "import": len(to_import),
        "duplicate": sum(1 for o in rows_out if o["status"] == "duplicate"),
        "error": sum(1 for o in rows_out if o["status"] == "error"),
        "skipped": sum(1 for o in rows_out if o["skipped"]),
    }
    dates = sorted({o["expense_date"] for o in rows_out if o["expense_date"]})
    return {
        "sheet": parsed["sheet"],
        "sheets": parsed["sheets"],
        "header_row": parsed["header_row"],
        "sha256": parsed["sha256"],
        "date_from": dates[0] if dates else None,
        "date_to": dates[-1] if dates else None,
        "counts": counts,
        "totals": {
            "file": total(lambda o: o["amount"] is not None),
            "import": total(lambda o: o["will_import"]),
            "duplicate": total(lambda o: o["status"] == "duplicate"),
            "error": total(lambda o: o["status"] == "error"),
            "skipped": total(lambda o: o["skipped"]),
            "credits": sum(c["amount"] for c in aside["credits"]),
        },
        "departments": department_panel,
        "projects": project_panel,
        "accounts": account_panel,
        "summary": [
            {"department_code": d, "account_code": a, "competition_id": c,
             "rows": bucket["rows"], "amount": bucket["cents"] / 100}
            for (d, a, c), bucket in sorted(summary.items(), key=lambda kv: tuple(str(x or "") for x in kv[0]))
        ],
        "ignored": {"blank": parsed.get("blank", 0), "zero": aside["zero"],
                    "totals": [t for t in aside["totals"] if t["ok"]]},
        "credits": aside["credits"],
        "not_in_file": {
            "count": len(not_in_file),
            "amount": sum(cents(r["amount"]) for r in not_in_file) / 100,
            "rows": not_in_file,
        },
        "warnings": warnings,
        "rows": rows_out,
        "expected": {"count": counts["import"], "total": total(lambda o: o["will_import"])},
    }


# ─── Registros a insertar ────────────────────────────────────────────────────
_FILE_NAME_RE = re.compile(r"[^\w\s\-\.\(\)]")


def _comments(batch: str, file_name: str, sheet: str, row: dict) -> str:
    """Marca de lote y lo que el ledger decía de la fila.

    Empieza con la marca: el deshacer busca el lote por prefijo. Lo demás es la
    trazabilidad que el formulario no tiene dónde guardar (proyecto,
    departamento y centro de costo tal como venían).
    """
    name = _FILE_NAME_RE.sub("", file_name or "").strip()[:80] or "ledger.xlsx"
    parts = [f"{MARK}{batch}", f"{name}, hoja {sheet}, fila {row['row']}"]
    for label, field in (("Proyecto", "file_project"), ("Departamento", "file_department"),
                         ("Centro de costo", "cost_center"), ("Contrapartida", "offset")):
        if row.get(field):
            parts.append(f"{label}: {row[field]}")
    if row.get("file_account") and row["file_account"] != row["account_code"]:
        parts.append(f"Cuenta en el archivo: {row['file_account']}")
    return ". ".join(parts)


def commit_records(plan: dict, *, batch: str, file_name: str, user_id: Optional[str], now: str) -> list:
    """Filas de `expenses` para las filas a importar, todas con las mismas claves.

    PostgREST exige un array uniforme en el insert en lote. Entran `paid` con
    `payment_date = expense_date`: el ledger trae una sola fecha y el cargo ya
    se cobró. Es la carga histórica de `create_expense`, en lote.
    """
    records = []
    for row in plan["rows"]:
        if not row["will_import"]:
            continue
        records.append({
            "department_code": row["department_code"],
            "account_code": row["account_code"],
            "competition_id": row["competition_id"],
            "payee_type": "other",
            "payee_name": row["payee_name"] or row["description"],
            "description": row["description"],
            "amount": row["amount"],
            "expense_date": row["expense_date"],
            "payment_date": row["expense_date"],
            "status": "paid",
            "invoice_no": invoice_for(row["description"]),
            "comments": _comments(batch, file_name, plan["sheet"], row),
            "budget_line_id": row["budget_line_id"],
            "created_by": user_id,
            "paid_by": user_id,
            "paid_at": now,
        })
    return records
