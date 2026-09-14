"""Carga el año 2026 de IT: el presupuesto de Finance y el ledger de gastos.

Son las dos mitades del pendiente «gastos ejecutados 2026» de BUDGET_MODULE.md
§12, y entran juntas a propósito: un gasto sin presupuesto se ve como ejecutado
contra cero, y un presupuesto sin gasto no dice nada.

1. **Presupuesto.** No hay planilla: Finance lo mandó por mail como una tabla
   de 8 cuentas (septiembre 2026). Va acá tal cual, con el signo dado vuelta
   (el ledger lo muestra en negativo por convención contable). Tres cuentas no
   existían en el plan (610300, 611200, 648500) y se crean como reales, no
   provisorias: son códigos de Finance.

   648500 «Technology Applications» son los equipos de VGO y estadístico. La
   plata sale del presupuesto de Competitions y así lo dice el mail, pero la
   línea va al departamento `it` porque el departamento es quién ejecuta, no de
   dónde sale la plata (§2 del contrato). Mismo criterio que «IT on Events»
   (COMP-26) en 2027.

2. **Gastos.** El export del ledger (`IT Budget July 2026.xlsx`, hoja `Data`):
   una fila por movimiento, con cuenta, fecha, descripción de tarjeta y monto.
   Enero a julio. Cada fila entra como gasto **pagado** del departamento `it`,
   sin competencia, con `expense_date = payment_date` (el ledger tiene una
   sola fecha) y `payee_type = 'other'`: no se crean proveedores, el nombre
   normalizado queda en `payee_name` y la descripción cruda en `description`.

   ⚠️ **612100 y 612200 vienen idénticas** en el ledger: las mismas 8 filas
   (Best Buy, FedEx, Amazon), misma fecha y monto, imputadas a las dos cuentas.
   Se importan las dos tal cual, porque el ledger es la fuente y elegir una
   sería adivinar; cada fila lleva la marca `DUP` en comments y el preview lo
   avisa. Si Finance corrige, se reimporta el archivo y desaparece.

Dos pasos como el resto de los importadores: preview por defecto, --commit
para escribir. Idempotente: borra lo que importó antes (marcado en notes /
comments) y reinserta.

    ./venv/bin/python scripts/import_it_2026.py                       # preview
    ./venv/bin/python scripts/import_it_2026.py --commit
    ./venv/bin/python scripts/import_it_2026.py --file /ruta/otro.xlsx --commit
"""
import argparse
import collections
import re
import sys
from pathlib import Path

import openpyxl
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from api._lib.database import supabase   # noqa: E402

YEAR = 2026
DEPARTMENT = "it"
DEFAULT_FILE = Path.home() / "Downloads" / "IT Budget July 2026.xlsx"

MARK_BUDGET = f"import:it-{YEAR}-budget"
MARK_LEDGER = f"import:it-{YEAR}-ledger"

# Cuentas que faltan en el plan. Las demás (610400, 611000, 612100, 612200,
# 612300) ya están sembradas desde la migración 033.
NEW_ACCOUNTS = [
    {"code": "610300", "label": "Office Equipment / Furniture", "sort": 5},
    {"code": "611200", "label": "Supplies, Photocopies & Printed Materials", "sort": 35},
    {"code": "648500", "label": "Technology Applications", "sort": 70},
]

# Mail de Finance, septiembre 2026. Montos en USD, positivos.
BUDGET_2026 = [
    ("610300", "Office equipment / furniture", 15_000),
    ("610400", "Utilities", 12_000),
    ("611000", "Telephone, internet, mail & courier", 78_600),
    ("611200", "Supplies, photocopies & printed materials", 10_200),
    ("612100", "IT hardware & equipment", 12_000),
    ("612200", "IT maintenance & repairs", 27_600),
    ("612300", "IT software & licenses", 42_000),
    ("648500", "Technology Applications — equipos de VGO y estadístico "
               "(sale del presupuesto de Competitions)", 82_711),
]
BUDGET_TOTAL = 280_111

# Descripción de tarjeta -> proveedor legible. Regex sobre la descripción ya
# limpia (mayúsculas, un espacio). Lo que no matchea se importa con la
# descripción cruda como payee_name y el preview lo lista.
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
    (r"^BESTBUY", "Best Buy"),
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


def clean(text) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip().strip('"')


def vendor_for(description: str) -> tuple:
    upper = description.upper()
    for pattern, name in VENDOR_PATTERNS:
        if re.search(pattern, upper):
            return name, True
    return description, False


def invoice_for(description: str):
    m = re.search(r"A/P Invoices?\s*-\s*(\S+)", description, re.I)
    return m.group(1) if m else None


def read_ledger(path: Path) -> list:
    ws = openpyxl.load_workbook(path, data_only=True)["Data"]
    rows = []
    for account, date, description, amount, *_ in ws.iter_rows(min_row=2, values_only=True):
        if account is None or amount is None:
            continue
        if not hasattr(date, "date"):
            raise SystemExit(f"fila sin fecha: {account!r} {description!r}")
        rows.append({
            "account_code": str(account).strip(),
            "date": date.date().isoformat(),
            "description": clean(description),
            "amount": round(float(amount), 2),
        })
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", type=Path, default=DEFAULT_FILE)
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    if not args.file.exists():
        raise SystemExit(f"no existe {args.file}")

    # ── Cuentas ──────────────────────────────────────────────────────────
    existing = {a["code"] for a in supabase.table("accounts").select("code").execute().data or []}
    accounts_to_create = [a for a in NEW_ACCOUNTS if a["code"] not in existing]
    for code, _, _ in BUDGET_2026:
        if code not in existing and code not in {a["code"] for a in NEW_ACCOUNTS}:
            raise SystemExit(f"cuenta {code} no existe y no está en NEW_ACCOUNTS")

    # ── Presupuesto ──────────────────────────────────────────────────────
    budget_rows = [{
        "year": YEAR, "department_code": DEPARTMENT, "account_code": code,
        "competition_id": None, "kind": "expense", "description": description,
        "amount": amount, "escalation_pct": 0, "source": "manual", "notes": MARK_BUDGET,
    } for code, description, amount in BUDGET_2026]
    budget_sum = sum(r["amount"] for r in budget_rows)
    if budget_sum != BUDGET_TOTAL:
        raise SystemExit(f"el presupuesto suma {budget_sum}, Finance dice {BUDGET_TOTAL}")

    # ── Ledger ───────────────────────────────────────────────────────────
    ledger = read_ledger(args.file)
    known = existing | {a["code"] for a in NEW_ACCOUNTS}
    bad = sorted({r["account_code"] for r in ledger if r["account_code"] not in known})
    if bad:
        raise SystemExit(f"cuentas del ledger sin plan: {bad}")

    # Filas idénticas (fecha, descripción, monto) imputadas a más de una cuenta.
    seen = collections.defaultdict(set)
    for r in ledger:
        seen[(r["date"], r["description"], r["amount"])].add(r["account_code"])
    dup_keys = {k for k, accs in seen.items() if len(accs) > 1}

    expense_rows, unmatched = [], collections.Counter()
    for r in ledger:
        payee, matched = vendor_for(r["description"])
        if not matched:
            unmatched[r["description"]] += 1
        is_dup = (r["date"], r["description"], r["amount"]) in dup_keys
        comments = MARK_LEDGER + (" DUP: misma fila imputada a más de una cuenta en el ledger"
                                  if is_dup else "")
        expense_rows.append({
            "department_code": DEPARTMENT, "account_code": r["account_code"],
            "competition_id": None, "payee_type": "other", "payee_name": payee,
            "description": r["description"], "amount": r["amount"],
            "expense_date": r["date"], "payment_date": r["date"], "status": "paid",
            "invoice_no": invoice_for(r["description"]), "comments": comments,
        })

    # ── Preview ──────────────────────────────────────────────────────────
    print(f"cuentas nuevas: {[a['code'] for a in accounts_to_create] or 'ninguna'}")
    print(f"\npresupuesto {YEAR} {DEPARTMENT}: {len(budget_rows)} líneas, ${budget_sum:,.2f}")
    for r in budget_rows:
        print(f"  {r['account_code']}  {r['amount']:>10,.2f}  {r['description'][:60]}")

    by_acc = collections.Counter(); sum_acc = collections.defaultdict(float)
    for r in expense_rows:
        by_acc[r["account_code"]] += 1; sum_acc[r["account_code"]] += r["amount"]
    total = sum(sum_acc.values())
    print(f"\ngastos: {len(expense_rows)} filas, ${total:,.2f} "
          f"({min(r['expense_date'] for r in expense_rows)} → {max(r['expense_date'] for r in expense_rows)})")
    for code in sorted(by_acc):
        budget = next((b["amount"] for b in budget_rows if b["account_code"] == code), 0)
        pct = f"{sum_acc[code] / budget:.0%}" if budget else "—"
        print(f"  {code}  {by_acc[code]:>3} filas  {sum_acc[code]:>10,.2f}  de {budget:>10,.2f}  ({pct})")
    dup_rows = [r for r in expense_rows if "DUP" in r["comments"]]
    if dup_rows:
        accs = sorted({r["account_code"] for r in dup_rows})
        per_account = sum(r["amount"] for r in dup_rows) / len(accs)
        print(f"\n⚠️  {len(dup_rows) // len(accs)} filas idénticas imputadas a {accs} a la vez "
              f"(${per_account:,.2f} en cada cuenta). Se importan todas con marca DUP.")
    if unmatched:
        print(f"\nsin proveedor reconocido ({len(unmatched)}), quedan con la descripción cruda:")
        for desc, n in unmatched.most_common():
            print(f"  {n:>2}× {desc}")

    if not args.commit:
        print("\n(preview; --commit para escribir)")
        return 0

    # ── Commit ───────────────────────────────────────────────────────────
    if accounts_to_create:
        supabase.table("accounts").insert([{
            **a, "kind": "expense", "escalation_pct": 0, "pending_mapping": False, "active": True,
        } for a in accounts_to_create]).execute()
        print(f"\n{len(accounts_to_create)} cuentas creadas")

    old_exp = supabase.table("expenses").select("id").ilike("comments", f"{MARK_LEDGER}%").execute().data or []
    for o in old_exp:
        supabase.table("expenses").delete().eq("id", o["id"]).execute()
    old_lines = supabase.table("budget_lines").select("id").eq("notes", MARK_BUDGET).execute().data or []
    for o in old_lines:
        supabase.table("budget_lines").delete().eq("id", o["id"]).execute()
    if old_exp or old_lines:
        print(f"reimport: {len(old_lines)} líneas y {len(old_exp)} gastos previos borrados")

    inserted = supabase.table("budget_lines").insert(budget_rows).execute().data or []
    line_by_account = {r["account_code"]: r["id"] for r in inserted}
    print(f"{len(inserted)} líneas de presupuesto insertadas")

    for r in expense_rows:
        r["budget_line_id"] = line_by_account.get(r["account_code"])
    for i in range(0, len(expense_rows), 100):
        supabase.table("expenses").insert(expense_rows[i:i + 100]).execute()
    print(f"{len(expense_rows)} gastos insertados")
    return 0


if __name__ == "__main__":
    sys.exit(main())
