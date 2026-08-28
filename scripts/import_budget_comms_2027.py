"""Importa el presupuesto de Comms 2027 con el mapeo que confirmó el cliente.

El import en sí lo hace el módulo (`api/_lib/services/budget_import.py`, el
mismo camino que la pantalla). Este script existe por dos cosas que la UI no
puede decidir sola y que se acordaron a mano:

1. **El mapeo de los 10 grupos** de la planilla (§13 de BUDGET_MODULE.md: el
   evento es la fila de subtotal). BCLA y LSBF van a General porque el Excel
   presupuesta la temporada entera y la base la modela por fases; CentroBasket
   U15/U17 y South American U17 (Women) quedan afuera porque todavía no existen
   en el calendario 2027 — cuando existan, se reimporta y entran solas.

2. **El reparto 50/50 de "U16 (Both) Boys & Girls"**, que es un solo bloque de
   $78.000 para los dos torneos U16 de 2027. La planilla no discrimina ("for
   both boys & girls"), así que se importa al masculino y después se parte en
   dos. Es un reparto acordado, no un dato del Excel: queda anotado en cada
   línea.

Dos pasos como el resto: preview por defecto, --commit para escribir.
Idempotente: el import actualiza en vez de duplicar y el reparto se calcula
siempre sobre el monto del archivo, así que correrlo dos veces da lo mismo.
"""
import sys

from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from api._lib.database import supabase                      # noqa: E402
from api._lib.services import budget_import as bi           # noqa: E402

COMMIT = "--commit" in sys.argv
FILE = "/Users/varga/Downloads/2027_Budget_Comms_Americas.xlsx"
YEAR = 2027
DEPARTMENT = "comms"
SPLIT_LABEL = "U16 (Both) Boys & Girls"
SPLIT_NOTE = "50/50 de «U16 (Both) Boys & Girls»"

# Etiqueta del Excel -> nombre en la base, GENERAL o SKIP.
DECISIONS = {
    "BCLA": bi.GENERAL,                                     # temporada, no fase
    "Liga Sudamericana de Baloncesto Femenina (LSBF)": bi.GENERAL,
    "DIGITAL / SOCIAL MEDIA": bi.GENERAL,                   # "For All Events"
    "EDITORIAL 24/7 EA3 534320": bi.GENERAL,                # "For All Events"
    "FIBA Women's AmeriCup 2027": "FIBA Women's AmeriCup",
    "FIBA AmeriCup 2029 Qualifiers W1": "FIBA AmeriCup 2029 Qualifiers – Window 1",
    "WBLA": "WBLA – Final 4",
    SPLIT_LABEL: "FIBA U16 AmeriCup",                       # se parte después
    # Creadas el 2026-08-12 con `is_tbd`: van en el segundo semestre pero
    # todavía no tienen fecha. CentroBasket queda como un solo evento —
    # es como lo presupuesta la planilla, y partirlo en U15 y U17 sería
    # inventar un reparto que el Excel no da.
    "CentroBasket U15 / U17": "FIBA Centrobasket U15 & U17",
    "South American U17 Championship (Women)": "South American U17 Women's Championship",
}
SPLIT_INTO = "FIBA U16 Women's AmeriCup"


def competition_ids() -> dict:
    rows = supabase.table("competitions").select("id, name").eq("year", YEAR).execute().data or []
    return {r["name"]: r["id"] for r in rows}


def build_mapping(by_name: dict) -> dict:
    mapping = {}
    for label, target in DECISIONS.items():
        if target in (bi.GENERAL, bi.SKIP):
            mapping[label] = target
            continue
        if target not in by_name:
            raise SystemExit(f"No existe la competencia '{target}' en {YEAR}")
        mapping[label] = by_name[target]
    return mapping


def money(n) -> str:
    return f"${n:,.2f}"


def split_u16(plan_rows: list, by_name: dict) -> tuple:
    """Reparte en dos las líneas del bloque U16, 50% a cada torneo."""
    source_id, target_id = by_name["FIBA U16 AmeriCup"], by_name[SPLIT_INTO]
    updated = created = 0
    for row in plan_rows:
        if row["competition_label"] != SPLIT_LABEL:
            continue
        half = round(row["amount"] / 2, 2)
        note = " · ".join(x for x in (row.get("notes"), SPLIT_NOTE) if x)
        for competition_id in (source_id, target_id):
            existing = (
                supabase.table("budget_lines")
                .select("id")
                .eq("year", YEAR).eq("department_code", DEPARTMENT)
                .eq("account_code", row["account_code"])
                .eq("competition_id", competition_id)
                .eq("description", row["description"])
                .execute().data
            )
            if existing:
                supabase.table("budget_lines").update(
                    {"amount": half, "notes": note}
                ).eq("id", existing[0]["id"]).execute()
                updated += 1
            else:
                supabase.table("budget_lines").insert({
                    "year": YEAR, "department_code": DEPARTMENT,
                    "account_code": row["account_code"], "competition_id": competition_id,
                    "kind": "expense", "description": row["description"],
                    "amount": half, "notes": note, "source": "manual",
                }).execute()
                created += 1
    return updated, created


def main() -> None:
    content = open(FILE, "rb").read()
    by_name = competition_ids()
    mapping = build_mapping(by_name)

    plan = bi.preview(content, year=YEAR, kind="expense",
                      department=DEPARTMENT, mapping=mapping)

    print(f"hoja: {plan['sheet']}  ({plan['shape']})")
    print(f"a crear {plan['counts']['new']}, a actualizar {plan['counts']['update']}, "
          f"con error {plan['counts']['error']}")
    print(f"se importa {money(plan['totals']['import'])}, "
          f"queda afuera {money(plan['totals']['skipped'])}")
    print(f"total del archivo: {money(plan['totals']['import'] + plan['totals']['skipped'])}")

    print("\ncuentas nuevas:")
    for account in plan["new_accounts"]:
        print(f"  {account['code']:9s} {account['label'][:44]:46s} {money(account['amount']):>12s}")

    print("\ngrupos:")
    for group in plan["competitions"]:
        target = group["name"] or ("General" if group["status"] == "general" else "—")
        print(f"  {group['status']:9s} {group['label'][:46]:48s} -> {target}")

    if plan["skipped_cells"]:
        print(f"\nafuera ({len(plan['skipped_cells'])} líneas):")
        for cell in plan["skipped_cells"]:
            print(f"  {cell['label'][:40]:42s} {cell['description'][:24]:26s} {money(cell['amount']):>11s}")

    split_rows = [r for r in plan["rows"] if r["competition_label"] == SPLIT_LABEL]
    if split_rows:
        total = sum(r["amount"] for r in split_rows)
        print(f"\nreparto 50/50 de «{SPLIT_LABEL}»: {len(split_rows)} líneas, "
              f"{money(total)} -> {money(total / 2)} a cada U16")

    if not COMMIT:
        print("\n(preview — no se escribió nada; correr con --commit)")
        return

    result = bi.commit(content, year=YEAR, kind="expense",
                       department=DEPARTMENT, mapping=mapping)
    print(f"\nimportado: {result['created']} creadas, {result['updated']} actualizadas, "
          f"cuentas nuevas: {', '.join(result['accounts_created']) or 'ninguna'}")

    updated, created = split_u16(plan["rows"], by_name)
    print(f"reparto U16: {updated} actualizadas, {created} creadas")

    total = sum(
        float(r["amount"]) for r in
        supabase.table("budget_lines").select("amount")
        .eq("year", YEAR).eq("department_code", DEPARTMENT).execute().data
    )
    print(f"\ncomms {YEAR} en la base: {money(total)}")


if __name__ == "__main__":
    main()
