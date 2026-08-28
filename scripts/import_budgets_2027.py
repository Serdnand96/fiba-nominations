"""Importa los dos presupuestos a budget_lines.

Dos pasos como el resto de los importadores del repo: preview por defecto,
--commit para escribir. NO adivina: una columna sin match seguro se reporta y
se deja afuera, NUNCA se manda a "General" — General es una columna real del
Excel ($166.500) y ensuciarla arruinaria el reporte.

Idempotente: borra lo importado antes (marcado en notes) y reinserta.
"""
import json, sys, uuid
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
from api._lib.database import supabase

COMMIT = "--commit" in sys.argv
MARK_IT = "import:FIBA_IT_Budget_2027-2030"
MARK_COMP = "import:CompsDraftBudget2027"
GENERAL_COL = "General Expenses (not associated to the competitions)"

# Mapeo columna del Excel -> competencia en la base. Explicito y a mano: son 17
# nombres con typos reales ("2018" por 2028) y agrupaciones que no coinciden
# con como la base modela las fases. Un fuzzy match aca seria adivinar plata.
COMP_MAP = {
    "FIBA Basketball World Cup 2027 Qualifiers - Window 6": "FIBA Basketball WC 2027 Qualifiers – Window 6",
    "FIBA U16 AmeriCup":                                    "FIBA U16 AmeriCup",
    "FIBA U16 Women's  AmeriCup":                           "FIBA U16 Women's AmeriCup",
    "Women's AmeriCup":                                     "FIBA Women's AmeriCup",
    "2018 U18 AmeriCup Qualifier 1":                        "FIBA U18 AmeriCup Qualifiers Men #1",
    "2018 U18 AmeriCup Qualifier 2":                        "FIBA U18 AmeriCup Qualifiers Men #2",
    "2018 U18 Women's AmeriCup Qualifier 1":                "FIBA U18 Women's AmeriCup Qualifiers #1",
    "2018 U18 Women's AmeriCup Qualifier 2":                "FIBA U18 Women's AmeriCup Qualifiers #2",
    "FIBA Women's AmeriCup 2029 CBC Pre-Qualifiers":        "CBC Women's Championship",
    "Women's AmeriCup 2029 COCABA Pre-Qualifier":           "COCABA Women's Championship",
    "FIBA Olympic Pre-Qualifying Tournament":               "FIBA Pre-OQT",
    "FIBA Basketball World Cup 2027 Qatar":                 "FIBA Basketball WC 2027",
    "FIBA AmeriCup 2029 Qualifiers - W1":                   "FIBA AmeriCup 2029 Qualifiers – Window 1",
}
# Sin match: la base modela estas ligas por fase y el Excel presupuesta la
# temporada entera; "Draws" directamente no es una competencia.
UNMATCHED = ["Draws (AmeriCup Q & AmeriCup W", "Liga Sudamericana",
             "Liga Sudamericana Femenina", "Women's Basketball League Americas (WBLA)"]

# El departamento sale de la LINEA, no de la planilla: es el caso testigo de
# por que departamento y cuenta son dimensiones separadas.
DEPT_BY_ACCOUNT = {"COMP-15": "comms", "COMP-16": "comms", "COMP-26": "it"}

data = json.load(open("/private/tmp/claude-501/-Users-varga-Downloads-fiba-nominations/bf823a19-fde0-4de8-a88a-4554bdb382d1/scratchpad/budgets.json"))
comps = {c["name"]: c["id"] for c in supabase.table("competitions").select("id, name").eq("year", 2027).execute().data}

rows, skipped = [], []

# ── IT: una fila por anio, unidas por series_id ──
for line in data["it"]:
    sid = str(uuid.uuid4())
    for year, amount in line["years"].items():
        if not amount:
            continue
        rows.append({
            "year": int(year), "department_code": "it", "account_code": line["account_code"],
            "competition_id": None, "kind": "expense", "description": line["description"][:300],
            "qty": line["qty"], "monthly_amount": line["monthly"] if int(year) == 2027 else None,
            "amount": round(amount, 2), "escalation_pct": line["escalation"],
            "series_id": sid, "notes": MARK_IT,
        })

# ── Competitions: matriz ──
for row in data["comp_rows"]:
    if not row["cells"]:
        continue
    dept = DEPT_BY_ACCOUNT.get(row["account_code"], "competitions")
    for col_name, amount in row["cells"].items():
        if col_name == GENERAL_COL:
            comp_id = None
        elif col_name in COMP_MAP:
            comp_id = comps.get(COMP_MAP[col_name])
            if not comp_id:
                skipped.append((col_name, row["account_code"], amount, "competencia no existe en la base"))
                continue
        else:
            skipped.append((col_name, row["account_code"], amount, "sin match seguro"))
            continue
        rows.append({
            "year": 2027, "department_code": dept, "account_code": row["account_code"],
            "competition_id": comp_id, "kind": "expense", "description": row["description"][:300],
            "amount": round(amount, 2), "escalation_pct": 0,
            "series_id": str(uuid.uuid4()), "notes": MARK_COMP,
        })

# ── Reporte ──
def money(n): return f"${n:,.2f}"
it_rows = [r for r in rows if r["notes"] == MARK_IT]
cp_rows = [r for r in rows if r["notes"] == MARK_COMP]
print(f"IT           : {len(it_rows):3d} filas — 2027 {money(sum(r['amount'] for r in it_rows if r['year']==2027))}")
for y in (2028, 2029, 2030):
    print(f"               {'':3s}         {y} {money(sum(r['amount'] for r in it_rows if r['year']==y))}")
print(f"Competitions : {len(cp_rows):3d} filas — 2027 {money(sum(r['amount'] for r in cp_rows))}")
by_dept = {}
for r in cp_rows:
    by_dept[r["department_code"]] = by_dept.get(r["department_code"], 0) + r["amount"]
for d, v in sorted(by_dept.items(), key=lambda x: -x[1]):
    print(f"                 {d:20s} {money(v)}")

if skipped:
    tot = sum(s[2] for s in skipped)
    cols = {}
    for name, _, amt, reason in skipped:
        cols[name] = cols.get(name, 0) + amt
    print(f"\nNO IMPORTADO — {len(skipped)} celdas, {money(tot)}:")
    for name, amt in sorted(cols.items(), key=lambda x: -x[1]):
        print(f"  {money(amt):>14s}  {name}")

if not COMMIT:
    print("\n(preview — nada escrito; correr con --commit)")
    sys.exit(0)

for mark in (MARK_IT, MARK_COMP):
    old = supabase.table("budget_lines").select("id").eq("notes", mark).execute().data or []
    for o in old:
        supabase.table("budget_lines").delete().eq("id", o["id"]).execute()
    if old:
        print(f"\nreimport: {len(old)} filas previas de {mark} borradas")

# PostgREST exige que todas las filas de un batch tengan las MISMAS claves.
# Las de IT llevan qty/monthly_amount y las de Competitions no, asi que se
# normaliza el juego de claves antes de insertar.
keys = set().union(*(r.keys() for r in rows))
rows = [{k: r.get(k) for k in keys} for r in rows]

for i in range(0, len(rows), 100):
    supabase.table("budget_lines").insert(rows[i:i+100]).execute()
print(f"\n{len(rows)} filas insertadas")
