"""Carga el sheet `Staffing (travel)` en budget_headcount. Preview/--commit."""
import sys, openpyxl
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")
from api._lib.database import supabase

COMMIT = "--commit" in sys.argv
COMP = "/Users/varga/Library/CloudStorage/OneDrive-FIBA(1)/Competitions (private)/Budgets/2027/CompsDraftBudget2027_Proposed2027-May292026.xlsx"

# Mismo mapeo de columnas que el import de presupuesto: no se adivina.
COMP_MAP = {
    "FIBA Basketball World Cup 2027 Qualifiers - Window 6": "FIBA Basketball WC 2027 Qualifiers – Window 6",
    "FIBA U16 AmeriCup": "FIBA U16 AmeriCup",
    "FIBA U16 Women's  AmeriCup": "FIBA U16 Women's AmeriCup",
    "Women's AmeriCup": "FIBA Women's AmeriCup",
    "2018 U18 AmeriCup Qualifier 1": "FIBA U18 AmeriCup Qualifiers Men #1",
    "2018 U18 AmeriCup Qualifier 2": "FIBA U18 AmeriCup Qualifiers Men #2",
    "2018 U18 Women's AmeriCup Qualifier 1": "FIBA U18 Women's AmeriCup Qualifiers #1",
    "2018 U18 Women's AmeriCup Qualifier 2": "FIBA U18 Women's AmeriCup Qualifiers #2",
    "FIBA Women's AmeriCup 2029 CBC Pre-Qualifiers": "CBC Women's Championship",
    "Women's AmeriCup 2029 COCABA Pre-Qualifier": "COCABA Women's Championship",
    "FIBA Olympic Pre-Qualifying Tournament": "FIBA Pre-OQT",
    "FIBA Basketball World Cup 2027 Qatar": "FIBA Basketball WC 2027",
    "FIBA AmeriCup 2029 Qualifiers - W1": "FIBA AmeriCup 2029 Qualifiers – Window 1",
}
# Rol -> linea de travel que alimenta (bloque Summary del sheet).
ROLE_ACCOUNT = {
    "FIBA Coordinator": "COMP-04",              # FIBA Coordinator Travel Expense
    "Technical Delegates": "COMP-12",           # Technical Delegate Travel Expense
    "VGOs": "COMP-14",                          # TV Graphics Operator Travel Expenses
    "Competitions Lead": "COMP-19",             # FA Staff Travel
    "Competition Staff": "COMP-19",
    "Competition IT Manager or Deputy": "COMP-19",
    "Accreditation & Ticketing Coordinator": "COMP-19",
    "Player Experience Coordinator": "COMP-19",
    "Security Advisor": "COMP-19",
    "Game Experience Crew": "COMP-19",
    "NF Development / Scouting": "COMP-19",
    "Supervisory Doctor": "COMP-19",
    "HQ Staff": "COMP-19",
    "Coaches / CSR Activation Staff": "COMP-19",
    "VIP hold": "COMP-20",                      # Authorities Travel Expenses
}

wb = openpyxl.load_workbook(COMP, data_only=True)
ws = wb["Staffing (travel)"]
rows = list(ws.iter_rows(values_only=True))
header = rows[3]
cols = {i: str(n).strip() for i, n in enumerate(header) if i >= 2 and n and str(n).strip().upper() != "TOTALS"}

comps = {c["name"]: c["id"] for c in supabase.table("competitions").select("id, name").eq("year", 2027).execute().data}

items, skipped, unmapped_roles = [], {}, set()
for r in rows[4:]:
    if not r[0] or not isinstance(r[0], (int, float)) or not r[1]:
        continue
    role = str(r[1]).strip()
    if role.lower() in ("total", "other"):
        continue
    acct = ROLE_ACCOUNT.get(role)
    if not acct:
        unmapped_roles.add(role)
        continue
    for i, col_name in cols.items():
        v = r[i]
        if not isinstance(v, (int, float)) or not v:
            continue
        if col_name not in COMP_MAP:
            skipped[col_name] = skipped.get(col_name, 0) + int(v)
            continue
        cid = comps.get(COMP_MAP[col_name])
        if not cid:
            skipped[col_name] = skipped.get(col_name, 0) + int(v)
            continue
        items.append({"competition_id": cid, "role_label": role,
                      "headcount": int(v), "account_code": acct})

total = sum(i["headcount"] for i in items)
print(f"headcount a cargar: {len(items)} filas, {total} persona-evento")
by_acct = {}
for i in items:
    by_acct[i["account_code"]] = by_acct.get(i["account_code"], 0) + i["headcount"]
for a, n in sorted(by_acct.items()):
    print(f"  {a}: {n} personas  →  ${n * 1050:,}")
if unmapped_roles:
    print(f"roles sin linea asignada (omitidos): {sorted(unmapped_roles)}")
if skipped:
    print(f"columnas sin match (omitidas): {sum(skipped.values())} personas — {list(skipped)}")

if not COMMIT:
    print("\n(preview — nada escrito)")
    sys.exit(0)

supabase.table("budget_headcount").delete().eq("year", 2027).execute()
supabase.table("budget_assumptions").delete().eq("year", 2027).execute()
supabase.table("budget_assumptions").insert({
    "year": 2027, "avg_flight_cost": 1050,
    "notes": "CompsDraftBudget2027: 'updated flight cost (950 to 1050)'"}).execute()
for i in range(0, len(items), 100):
    supabase.table("budget_headcount").insert(
        [{"year": 2027, **it} for it in items[i:i+100]]).execute()
print(f"\n{len(items)} filas de headcount insertadas")
