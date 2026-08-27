"""Siembra plantillas de gasto recurrente a partir de las líneas de presupuesto.

El presupuesto de IT ya tiene cargadas las ~20 suscripciones y servicios fijos
del año (Adobe, AWS, Zoom, Dropbox, Comcast, Crown Castle…). Este script las
convierte en `recurring_expenses`, que es lo que hace que el panel del mes
avise qué falta cargar en vez de que se olvide.

Dos pasos como el resto de los importadores del repo: preview por defecto,
--commit para escribir.

NO PISA LO QUE YA EXISTE. La cadencia de acá es un punto de partida razonable,
no la verdad: cada plantilla se edita después en **Budget → Recurrentes**
(frecuencia, monto, día, proveedor, vigencia). Por eso una segunda corrida solo
agrega lo que falta y deja intacto lo que ya está cargado — si el equipo pasó
una suscripción a trimestral, no se la volvemos a pisar. `--replace` fuerza el
borrado y la resiembra, y ahí sí se pierden esos ajustes.

    ./venv/bin/python scripts/seed_recurring_from_budget.py                 # preview
    ./venv/bin/python scripts/seed_recurring_from_budget.py --commit        # agrega lo que falta
    ./venv/bin/python scripts/seed_recurring_from_budget.py --commit --replace
    ./venv/bin/python scripts/seed_recurring_from_budget.py --year 2027 --department it
"""
import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from api._lib.database import supabase   # noqa: E402

# Cadencia por CUENTA, no por proveedor. La planilla presupuesta un monto anual
# y en ningún lado dice cada cuánto se factura; mirar el nombre ("AWS suena
# mensual") sería adivinar. Lo que sí se puede afirmar es qué tipo de gasto es:
# un servicio se paga todos los meses y una compra no.
#
# Todo entra como `monthly` con monto = anual / 12, salvo las cuentas de acá,
# que son compras y reemplazos puntuales: ahí `annual` con el monto tal cual,
# que es literalmente lo que dice el presupuesto.
ANNUAL_ACCOUNTS = {
    "612100",   # Hardware Purchase — Office (computers, monitores, periféricos)
    "612200",   # Accessory Replacements / Office Equipment Maintenance
}

# Cuentas de la matriz por evento (Competitions / Comms). Quedan afuera aunque
# la línea no cuelgue de una competencia: la columna "General Expenses" del
# Excel es gasto de eventos sin asignar, no un servicio que se paga todos los
# meses. Sin este filtro se cuela "IT on Events" ($40.000) como recurrente.
EVENT_ACCOUNT_PREFIXES = ("COMP-", "COMM-")


def _key(row: dict) -> tuple:
    """Identidad de una plantilla. Sobrevive a que la editen en la UI."""
    return (row["department_code"], row["account_code"], row["description"].strip())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=2027)
    ap.add_argument("--department", default="it")
    ap.add_argument("--commit", action="store_true")
    ap.add_argument("--replace", action="store_true",
                    help="borra lo sembrado antes y resiembra (pisa ediciones manuales)")
    args = ap.parse_args()

    mark = f"seed:recurring:{args.year}:{args.department}"

    # Solo las líneas del departamento que NO cuelgan de una competencia: un
    # gasto de evento no es recurrente, pasa una vez y ya tiene su presupuesto.
    lines = (
        supabase.table("budget_lines")
        .select("account_code, description, amount, competition_id")
        .eq("year", args.year)
        .eq("department_code", args.department)
        .execute()
        .data
    ) or []
    lines = [
        l for l in lines
        if not l.get("competition_id")
        and not l["account_code"].startswith(EVENT_ACCOUNT_PREFIXES)
    ]
    if not lines:
        print(f"Sin líneas para {args.department} {args.year}.")
        return 1

    proposed = []
    for line in sorted(lines, key=lambda l: (l["account_code"], l["description"])):
        annual = float(line.get("amount") or 0)
        monthly = line["account_code"] not in ANNUAL_ACCOUNTS
        proposed.append({
            "department_code": args.department,
            "account_code": line["account_code"],
            "description": line["description"],
            "amount": round(annual / 12, 2) if monthly else round(annual, 2),
            "frequency": "monthly" if monthly else "annual",
            "start_date": f"{args.year}-01-01",
            "active": True,
            "notes": mark,
        })

    existing = (
        supabase.table("recurring_expenses")
        .select("id, department_code, account_code, description, frequency, amount, notes")
        .eq("department_code", args.department)
        .execute()
        .data
    ) or []
    seen = {_key(r) for r in existing}
    new_rows = [r for r in proposed if _key(r) not in seen]

    print(f"\n{'CUENTA':<10} {'FREQ':<8} {'MONTO':>10}  DESCRIPCIÓN")
    print("─" * 100)
    for r in proposed:
        flag = "  " if _key(r) not in seen else "= "   # '=' ya existe, no se toca
        print(f"{flag}{r['account_code']:<8} {r['frequency']:<8} {r['amount']:>10,.2f}  {r['description'][:64]}")
    print("─" * 100)
    anual_eq = sum(r["amount"] * (12 if r["frequency"] == "monthly" else 1) for r in proposed)
    print(f"{len(proposed)} plantillas · equivalente anual ${anual_eq:,.2f}")
    if len(proposed) != len(new_rows):
        print(f"{len(proposed) - len(new_rows)} ya existen (marcadas '=') y NO se tocan"
              + (" — salvo con --replace" if not args.replace else " → --replace las va a pisar"))

    monthly_n = sum(1 for r in proposed if r["frequency"] == "monthly")
    print(f"\n{monthly_n} mensuales · {len(proposed) - monthly_n} anuales (compras puntuales).")
    print("La cadencia es un punto de partida: se ajusta plantilla por plantilla")
    print("en Budget → Recurrentes. Si pasás una a anual, acordate del monto: acá")
    print("el mensual es el anual dividido 12.")

    if not args.commit:
        print("\nPreview. Nada escrito. Agregá --commit para sembrar.")
        return 0

    if args.replace:
        supabase.table("recurring_expenses").delete().eq("notes", mark).execute()
        new_rows = proposed
    if not new_rows:
        print("\nNada para agregar: ya estaban todas.")
        return 0
    supabase.table("recurring_expenses").insert(new_rows).execute()
    print(f"\n✓ {len(new_rows)} plantillas sembradas ({mark}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
