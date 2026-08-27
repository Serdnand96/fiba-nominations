"""Siembra plantillas de gasto recurrente a partir de las líneas de presupuesto.

El presupuesto de IT ya tiene cargadas las ~20 suscripciones y servicios fijos
del año (Adobe, AWS, Zoom, Dropbox, Comcast, Crown Castle…). Este script las
convierte en `recurring_expenses`, que es lo que hace que el panel del mes
avise qué falta cargar en vez de que se olvide.

Dos pasos como el resto de los importadores del repo: preview por defecto,
--commit para escribir. Idempotente: borra lo sembrado antes (marcado en
`notes`) y reinserta.

NO ADIVINA LA FRECUENCIA. La planilla presupuesta un monto ANUAL por línea y no
dice cada cuánto se factura. Todo entra como `annual` salvo lo que esté listado
explícitamente en MONTHLY acá abajo — y las líneas de las cuentas de servicios
se reportan aparte como "a confirmar", porque son las candidatas obvias a ser
mensuales. Poner 'monthly' por parecido dejaría al panel del mes reclamando
doce veces un gasto que se paga una.

    ./venv/bin/python scripts/seed_recurring_from_budget.py                 # preview
    ./venv/bin/python scripts/seed_recurring_from_budget.py --commit        # escribe
    ./venv/bin/python scripts/seed_recurring_from_budget.py --year 2027 --department it
"""
import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from api._lib.database import supabase   # noqa: E402

# Facturación mensual CONFIRMADA (la planilla lo dice en el texto de la línea).
# El monto de la plantilla es el anual / 12. Agregá acá lo que el equipo de IT
# confirme y volvé a correr el script: es idempotente.
MONTHLY = {
    "Zoom Audio Conferencing (Monthly)",
}

# Cuentas de servicios y suscripciones: si una línea de acá quedó como `annual`
# es probable que en realidad se facture mensual, pero eso lo confirma una
# persona. Se listan al final del preview para que la decisión sea explícita.
SERVICE_ACCOUNTS = {"611000", "612300"}

# Cuentas de la matriz por evento (Competitions / Comms). Quedan afuera aunque
# la línea no cuelgue de una competencia: la columna "General Expenses" del
# Excel es gasto de eventos sin asignar, no un servicio que se paga todos los
# meses. Sin este filtro se cuela "IT on Events" ($40.000) como recurrente.
EVENT_ACCOUNT_PREFIXES = ("COMP-", "COMM-")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=2027)
    ap.add_argument("--department", default="it")
    ap.add_argument("--commit", action="store_true")
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

    rows, to_confirm = [], []
    for line in sorted(lines, key=lambda l: (l["account_code"], l["description"])):
        annual = float(line.get("amount") or 0)
        monthly = line["description"] in MONTHLY
        rows.append({
            "department_code": args.department,
            "account_code": line["account_code"],
            "description": line["description"],
            "amount": round(annual / 12, 2) if monthly else round(annual, 2),
            "frequency": "monthly" if monthly else "annual",
            "start_date": f"{args.year}-01-01",
            "active": True,
            "notes": mark,
        })
        if not monthly and line["account_code"] in SERVICE_ACCOUNTS:
            to_confirm.append((line["account_code"], line["description"], annual))

    print(f"\n{'CUENTA':<10} {'FREQ':<8} {'MONTO':>10}  DESCRIPCIÓN")
    print("─" * 100)
    for r in rows:
        print(f"{r['account_code']:<10} {r['frequency']:<8} {r['amount']:>10,.2f}  {r['description'][:66]}")
    total = sum(r["amount"] * (12 if r["frequency"] == "monthly" else 1) for r in rows)
    print("─" * 100)
    print(f"{len(rows)} plantillas · equivalente anual ${total:,.2f}")

    if to_confirm:
        print(f"\n⚠️  {len(to_confirm)} líneas de cuentas de servicios quedaron ANUALES.")
        print("   La planilla no dice la cadencia. Si alguna se factura mensual,")
        print("   agregala a MONTHLY en este script y volvé a correrlo:")
        for code, desc, annual in to_confirm:
            print(f"     · [{code}] {desc[:60]:<60} ${annual:,.2f}/año → ${annual/12:,.2f}/mes")

    if not args.commit:
        print("\nPreview. Nada escrito. Agregá --commit para sembrar.")
        return 0

    supabase.table("recurring_expenses").delete().eq("notes", mark).execute()
    supabase.table("recurring_expenses").insert(rows).execute()
    print(f"\n✓ {len(rows)} plantillas sembradas ({mark}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
