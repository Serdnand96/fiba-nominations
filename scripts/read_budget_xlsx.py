"""Extrae las dos planillas a una estructura comun (sin tocar la base)."""
import json, re, openpyxl

IT = "/Users/varga/Library/CloudStorage/OneDrive-FIBA(1)/ADMIN/BUDGET/FIBA_IT_Budget_2027-2030.xlsx"
COMP = "/Users/varga/Library/CloudStorage/OneDrive-FIBA(1)/Competitions (private)/Budgets/2027/CompsDraftBudget2027_Proposed2027-May292026.xlsx"

out = {"it": [], "comp_cols": [], "comp_rows": []}

# ── IT: lista plana con codigo contable y proyeccion 2027-2030 ──
wb = openpyxl.load_workbook(IT, data_only=True)
ws = wb["IT Budget 2027-2030"]
for r in ws.iter_rows(values_only=True):
    detalle, code, qty, monthly, a27, a28, a29, a30, esc, expl = (list(r) + [None]*10)[:10]
    # Filtrar por FORMA del dato y no por numero de fila: el encabezado tiene
    # celdas combinadas y saltos de linea, y contar filas se rompe solo.
    if not detalle or not re.fullmatch(r"\d{6}", str(code or "").strip()):
        continue
    if not isinstance(a27, (int, float)) or not a27:
        continue
    out["it"].append({
        "description": str(detalle).strip(),
        "account_code": str(code).strip(),
        "qty": float(qty) if isinstance(qty, (int, float)) else None,
        "monthly": float(monthly) if isinstance(monthly, (int, float)) else None,
        "years": {2027: float(a27 or 0), 2028: float(a28 or 0),
                  2029: float(a29 or 0), 2030: float(a30 or 0)},
        "escalation": float(esc or 0),
    })

# ── Competitions: matriz linea x competencia ──
wb = openpyxl.load_workbook(COMP, data_only=True)
ws = wb["Breakdown - General Budget"]
rows = list(ws.iter_rows(values_only=True))
header = rows[3]                                   # fila 4: nombres de columna
# col 0 = Line, col 1 = Expense Item, col 2..N = competencias, luego TOTALS
for i, name in enumerate(header):
    if i < 2 or not name or str(name).strip().upper() == "TOTALS":
        continue
    out["comp_cols"].append({"idx": i, "name": str(name).strip()})

for r in rows[4:]:
    if not r[0] or not isinstance(r[0], (int, float)):
        continue
    line_no = int(r[0])
    if line_no > 28:
        continue
    cells = {}
    for c in out["comp_cols"]:
        v = r[c["idx"]]
        if isinstance(v, (int, float)) and v:
            cells[c["name"]] = float(v)
    out["comp_rows"].append({
        "line": line_no,
        "account_code": f"COMP-{line_no:02d}",
        "description": str(r[1]).strip(),
        "cells": cells,
    })

print(f"IT: {len(out['it'])} lineas, total 2027 = ${sum(l['years'][2027] for l in out['it']):,.0f}")
print(f"Competitions: {len(out['comp_rows'])} lineas x {len(out['comp_cols'])} columnas")
tot = sum(v for row in out["comp_rows"] for v in row["cells"].values())
print(f"  total 2027 = ${tot:,.0f}")
print("\ncolumnas del Excel:")
for c in out["comp_cols"]:
    print(f"  - {c['name']}")
json.dump(out, open("/private/tmp/claude-501/-Users-varga-Downloads-fiba-nominations/bf823a19-fde0-4de8-a88a-4554bdb382d1/scratchpad/budgets.json", "w"), indent=1)
