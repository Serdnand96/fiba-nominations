"""Lectura del ledger de Finanzas y plan de importación de gastos.

Sin base: `expense_import` recibe bytes y listas. Lo que se prueba acá es lo
que no puede salir mal en silencio, porque los gastos entran pagados: qué fila
es un movimiento, cuál es un duplicado y a qué cuenta, departamento y
competencia va cada una.
"""
import io
from datetime import datetime

import pytest
from openpyxl import Workbook

from api._lib.services import expense_import as ei

HEADERS = ["Posting Date", "Account", "Details", "Debit (LC)", "Credit (LC)",
           "Project", "Departments", "Cost Center"]
COMP = "11111111-1111-1111-1111-111111111111"


def _bytes(wb) -> bytes:
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def move(day, account, details, debit, credit=None, project="OTHOPS26", dept="ADMN", cc="GN0100"):
    return [datetime(2026, 1, day), account, details, debit, credit, project, dept, cc]


def ledger(rows, headers=HEADERS, header_row=2, first_col=1, title="Sheet1"):
    """Libro con el encabezado en `header_row` y los datos debajo."""
    wb = Workbook()
    ws = wb.active
    ws.title = title
    for offset, value in enumerate(headers):
        ws.cell(row=header_row, column=first_col + offset, value=value)
    for r, row in enumerate(rows, header_row + 1):
        for offset, value in enumerate(row):
            ws.cell(row=r, column=first_col + offset, value=value)
    return wb


def catalog(**extra):
    accounts = {
        "611000": {"code": "611000", "kind": "expense", "active": True},
        "612100": {"code": "612100", "kind": "expense", "active": True},
        "612200": {"code": "612200", "kind": "expense", "active": True},
        "699999": {"code": "699999", "kind": "expense", "active": False},
        "REV-01": {"code": "REV-01", "kind": "revenue", "active": True},
    }
    departments = {c: {"code": c, "active": True} for c in ("it", "admin", "competitions")}
    return {"accounts": accounts, "departments": departments,
            "competitions": {COMP: {"id": COMP, "name": "BCLA"}}, **extra}


MAPPED = {"departments": {"ADMN": "it"}, "projects": {"OTHOPS26": ei.GENERAL}}


def plan_for(rows, mapping=MAPPED, existing=(), lines=(), **kwargs):
    parsed = ei.read_ledger(_bytes(ledger(rows, **kwargs)))
    return ei.build_plan(parsed, mapping=mapping, catalog=catalog(),
                         existing=list(existing), lines=list(lines))


def expense(i, day, description, amount, account="611000", department="it", **extra):
    return {"id": f"e{i}", "record_no": f"GA-{i:05d}", "expense_date": f"2026-01-{day:02d}",
            "description": description, "amount": amount, "account_code": account,
            "department_code": department, "status": "paid", "comments": "import:it-2026-ledger", **extra}


def by_row(plan):
    return {r["row"]: r for r in plan["rows"]}


# ─── Lectura ─────────────────────────────────────────────────────────────────

class TestReadLedger:
    def test_real_layout_header_on_row_two(self):
        parsed = ei.read_ledger(_bytes(ledger([move(14, 611000, "ADOBE Adobe Systems SAN JOSE            CA", 59.99)])))
        assert parsed["header_row"] == 2
        row = parsed["rows"][0]
        assert row == {**row, "row": 3, "date": "2026-01-14", "account": "611000",
                       "description": "ADOBE Adobe Systems SAN JOSE CA", "debit": 59.99,
                       "project": "OTHOPS26", "department": "ADMN", "cost_center": "GN0100"}

    def test_header_on_row_one_with_the_other_vocabulary(self):
        headers = ["Date", "Account", "Description", "Amount", "Project", "Dept ", "Cost Center"]
        wb = ledger([[datetime(2026, 1, 14), "611000", "AT&T", 10, "P1", "ADMN", "GN"]],
                    headers=headers, header_row=1)
        row = ei.read_ledger(_bytes(wb))["rows"][0]
        assert (row["row"], row["debit"], row["department"]) == (2, 10.0, "ADMN")

    def test_header_shifted_one_column_and_blank_row_below(self):
        wb = ledger([[None] * 8, move(14, 611000, "AT&T", 10)], first_col=2)
        parsed = ei.read_ledger(_bytes(wb))
        assert [r["row"] for r in parsed["rows"]] == [4]
        assert parsed["blank"] == 1

    def test_offset_account_is_never_the_expense_account(self):
        headers = ["Posting Date", "Offset Account", "Details", "Debit (LC)"]
        with pytest.raises(ei.LedgerFormatError, match="cuenta"):
            ei.read_ledger(_bytes(ledger([[datetime(2026, 1, 14), 102430, "AT&T", 10]], headers=headers)))

    def test_offset_account_next_to_the_account_is_kept_as_reference(self):
        headers = ["Posting Date", "Account", "Offset Account", "Details", "Debit (LC)", "Balance"]
        wb = ledger([[datetime(2026, 1, 14), 611000, 102430, "AT&T", 10, 999]], headers=headers)
        row = ei.read_ledger(_bytes(wb))["rows"][0]
        assert (row["account"], row["offset"], row["debit"]) == ("611000", "102430", 10.0)

    def test_sheet_without_ledger_columns_is_rejected(self):
        wb = ledger([["x", 1]], headers=["Row Labels", "Sum of Amount"])
        with pytest.raises(ei.LedgerFormatError, match="Falta"):
            ei.read_ledger(_bytes(wb))

    def test_corrupt_file_is_a_format_error(self):
        with pytest.raises(ei.LedgerFormatError):
            ei.read_ledger(b"not a workbook")

    def test_unknown_sheet_is_rejected(self):
        with pytest.raises(ei.LedgerFormatError, match="no existe"):
            ei.read_ledger(_bytes(ledger([move(14, 611000, "AT&T", 10)])), sheet="Otra")

    def test_picks_the_first_recognized_sheet_and_lists_all(self):
        wb = ledger([["x", 1]], headers=["Row Labels", "Sum of Amount"], title="Pivot")
        data = wb.create_sheet("Data")
        data.append(HEADERS)
        data.append(move(14, 611000, "AT&T", 10))
        parsed = ei.read_ledger(_bytes(wb))
        assert parsed["sheet"] == "Data"
        assert parsed["sheets"] == [{"name": "Pivot", "recognized": False}, {"name": "Data", "recognized": True}]

    def test_trailing_blank_rows_are_not_counted(self):
        wb = ledger([move(14, 611000, "AT&T", 10)])
        wb.active.cell(row=20, column=1, value=None)
        wb.active.row_dimensions[20].height = 15     # fila con formato y sin datos
        assert ei.read_ledger(_bytes(wb))["blank"] == 0

    def test_too_many_rows(self, monkeypatch):
        monkeypatch.setattr(ei, "MAX_ROWS", 2)
        rows = [move(14, 611000, f"M{i}", 10) for i in range(3)]
        with pytest.raises(ei.LedgerFormatError, match="más de 2"):
            ei.read_ledger(_bytes(ledger(rows)))


# ─── Filas ───────────────────────────────────────────────────────────────────

class TestRows:
    def test_total_row_that_closes_is_ignored(self):
        plan = plan_for([move(14, 611000, "A", 10), move(15, 611000, "B", 5.5),
                         [None, None, None, 15.5]])
        assert plan["counts"]["import"] == 2
        assert plan["ignored"]["totals"] == [{"row": 5, "amount": 15.5, "ok": True}]

    def test_amount_alone_that_does_not_close_is_an_error(self):
        plan = plan_for([move(14, 611000, "A", 10), [None, None, None, 99]])
        row = by_row(plan)[4]
        assert (row["status"], row["code"]) == ("error", "orphan_amount")
        assert [w["code"] for w in plan["warnings"]] == ["total_mismatch"]

    def test_credits_and_negatives_are_listed_not_imported(self):
        plan = plan_for([move(14, 611000, "A", 10), move(15, 611000, "Reembolso", None, credit=4),
                         move(16, 611000, "Ajuste", -3)])
        assert plan["counts"]["import"] == 1
        assert [c["row"] for c in plan["credits"]] == [4, 5]
        assert plan["totals"]["credits"] == 7

    def test_debit_and_credit_on_the_same_row_is_an_error_not_a_silent_debit(self):
        plan = plan_for([move(14, 611000, "Cargo y reverso", 100, credit=100)])
        assert (plan["rows"][0]["status"], plan["rows"][0]["code"]) == ("error", "debit_and_credit")
        assert plan["counts"]["import"] == 0

    def test_zero_is_skipped_and_unreadable_amount_is_an_error(self):
        plan = plan_for([move(14, 611000, "Cero", 0), move(15, 611000, "Sin monto", None),
                         move(16, 611000, "Texto", "doce")])
        assert plan["ignored"]["zero"] == 1
        assert {r["row"]: r["code"] for r in plan["rows"]} == {4: "amount_unreadable", 5: "amount_unreadable"}

    def test_amount_as_text_is_read(self):
        plan = plan_for([move(14, 611000, "Texto", "$ 1,234.50")])
        assert plan["rows"][0]["amount"] == 1234.5

    def test_dates(self):
        rows = [move(14, 611000, "Excel", 1),
                ["2026-01-15", 611000, "ISO", 1, None, "OTHOPS26", "ADMN", "GN"],
                ["3/4/2026", 611000, "Ambigua", 1, None, "OTHOPS26", "ADMN", "GN"],
                [None, 611000, "Sin fecha", 1, None, "OTHOPS26", "ADMN", "GN"]]
        rows_out = by_row(plan_for(rows))
        assert rows_out[3]["expense_date"] == "2026-01-14"
        assert rows_out[4]["expense_date"] == "2026-01-15"
        assert rows_out[5]["code"] == "date_unreadable"
        assert rows_out[6]["code"] == "date_missing"

    def test_missing_details_or_account(self):
        rows_out = by_row(plan_for([move(14, 611000, None, 1), move(14, None, "Sin cuenta", 1)]))
        assert rows_out[3]["code"] == "description_missing"
        assert rows_out[4]["code"] == "account_missing"


# ─── Cuenta, departamento y proyecto ─────────────────────────────────────────

class TestResolution:
    def test_account_from_a_numeric_cell(self):
        assert plan_for([move(14, 611000.0, "A", 1)])["rows"][0]["account_code"] == "611000"

    @pytest.mark.parametrize("account", ["102430", "699999", "REV-01"])
    def test_account_that_is_not_an_active_expense_account_is_an_error(self, account):
        plan = plan_for([move(14, account, "A", 1)])
        assert (plan["rows"][0]["status"], plan["rows"][0]["code"]) == ("error", "account_unknown")
        assert plan["accounts"] == [{"code": account, "rows": 1, "amount": 1.0, "mapped": None}]

    def test_unknown_account_is_resolved_by_the_mapping_never_by_default(self):
        mapping = {**MAPPED, "accounts": {"102430": "612100"}}
        row = plan_for([move(14, "102430", "A", 1)], mapping=mapping)["rows"][0]
        assert (row["status"], row["account_code"], row["file_account"]) == ("new", "612100", "102430")

    def test_department_without_mapping_is_an_error_and_never_guessed(self):
        plan = plan_for([move(14, 611000, "A", 1)], mapping={"projects": {"OTHOPS26": ei.GENERAL}})
        assert plan["rows"][0]["code"] == "department_unmapped"
        # "ADMN" se parece a `admin`, pero no se sugiere por parecido.
        assert plan["departments"] == [
            {"code": "ADMN", "rows": 1, "amount": 1.0, "mapped": None, "suggested": None, "evidence": 0}]

    def test_department_suggested_by_where_its_duplicates_live(self):
        existing = [expense(1, 14, "A", 1)]
        plan = plan_for([move(14, 611000, "A", 1), move(15, 611000, "B", 2)],
                        mapping={"projects": {"OTHOPS26": ei.GENERAL}}, existing=existing)
        assert plan["departments"][0]["suggested"] == "it"
        assert plan["departments"][0]["evidence"] == 1

    def test_department_code_identical_to_the_system_one_is_suggested_not_applied(self):
        plan = plan_for([move(14, 611000, "A", 1, dept="IT")], mapping={"projects": {"OTHOPS26": ei.GENERAL}})
        assert plan["rows"][0]["code"] == "department_unmapped"
        assert (plan["departments"][0]["suggested"], plan["departments"][0]["evidence"]) == ("it", 0)

    def test_project_without_mapping_is_an_error(self):
        plan = plan_for([move(14, 611000, "A", 1, project="26BCLAGP")])
        assert plan["rows"][0]["code"] == "project_unmapped"
        assert plan["projects"] == [{"code": "26BCLAGP", "rows": 1, "amount": 1.0, "mapped": None}]

    def test_project_mapped_to_a_competition_or_to_general(self):
        mapping = {"departments": {"ADMN": "it"}, "projects": {"26BCLAGP": COMP, "OTHOPS26": ei.GENERAL}}
        rows = plan_for([move(14, 611000, "A", 1, project="26BCLAGP"), move(14, 611000, "B", 1)],
                        mapping=mapping)["rows"]
        assert [r["competition_id"] for r in rows] == [COMP, None]
        assert all(r["status"] == "new" for r in rows)

    def test_blank_project_is_general_without_asking(self):
        row = plan_for([move(14, 611000, "A", 1, project=None)], mapping={"departments": {"ADMN": "it"}})["rows"][0]
        assert (row["status"], row["competition_id"]) == ("new", None)

    def test_mapping_to_an_unknown_competition_stays_unmapped(self):
        mapping = {"departments": {"ADMN": "it"}, "projects": {"OTHOPS26": "no-existe"}}
        assert plan_for([move(14, 611000, "A", 1)], mapping=mapping)["rows"][0]["code"] == "project_unmapped"


# ─── Duplicados ──────────────────────────────────────────────────────────────

class TestDuplicates:
    def test_key_ignores_spacing_case_and_a_stray_quote(self):
        a = ei.dedupe_key("2026-01-14", 'ANYDESK AMERICAS, INC"', 629.0)
        b = ei.dedupe_key("2026-01-14T00:00:00", "Anydesk   Americas, Inc", "629.00")
        assert a == b

    def test_key_keeps_non_latin_details_apart(self):
        assert ei.text_key("東京ホテル") != ei.text_key("京都")
        assert ei.text_key("Café São Paulo") == ei.text_key("CAFE SAO PAULO")
        plan = plan_for([move(14, 611000, "東京ホテル", 50)], existing=[expense(1, 14, "京都", 50)])
        assert plan["rows"][0]["status"] == "new"
        assert [w["code"] for w in plan["warnings"]] == ["possible_duplicate"]

    def test_warnings_carry_params_for_translation(self):
        plan = plan_for([move(14, 611000, "APPLE", 0.99), move(14, 611000, "APPLE", 0.99)])
        assert plan["warnings"][0]["params"] == {"count": 2, "rows": "3, 4"}

    def test_cents_round_half_up_like_postgres(self):
        assert ei.cents(2.675) == 268
        assert ei.cents("2.675") == 268
        assert ei.cents(None) is None

    def test_existing_expense_is_a_duplicate(self):
        plan = plan_for([move(14, 611000, "ADOBE Adobe Systems SAN JOSE            CA", 59.99)],
                        existing=[expense(1, 14, "ADOBE Adobe Systems SAN JOSE CA", 59.99)])
        row = plan["rows"][0]
        assert (row["status"], row["will_import"]) == ("duplicate", False)
        assert row["duplicate_of"]["record_no"] == "GA-00001"
        assert plan["counts"] == {"import": 0, "duplicate": 1, "error": 0, "skipped": 0}

    def test_multiset_more_in_the_file_than_in_the_base(self):
        rows = [move(14, 611000, "APPLE", 0.99), move(14, 611000, "APPLE", 0.99), move(14, 611000, "APPLE", 0.99)]
        plan = plan_for(rows, existing=[expense(1, 14, "APPLE", 0.99)])
        assert [r["status"] for r in plan["rows"]] == ["duplicate", "new", "new"]
        assert [w["code"] for w in plan["warnings"]] == ["repeated_in_file"]

    def test_multiset_more_in_the_base_than_in_the_file(self):
        existing = [expense(1, 14, "APPLE", 0.99), expense(2, 14, "APPLE", 0.99)]
        plan = plan_for([move(14, 611000, "APPLE", 0.99)], existing=existing)
        assert plan["rows"][0]["status"] == "duplicate"
        assert plan["not_in_file"]["count"] == 1

    def test_same_charge_in_two_accounts_matches_its_own_account_first(self):
        # La base lo tiene solo en 612100. Sin emparejar por cuenta, el orden
        # de las filas decidiría cuál de las dos entra.
        rows = [move(14, 612200, "FEDEX", 20), move(14, 612100, "FEDEX", 20)]
        plan = plan_for(rows, existing=[expense(1, 14, "FEDEX", 20, account="612100")])
        assert [r["status"] for r in plan["rows"]] == ["new", "duplicate"]

    def test_cancelled_and_rejected_do_not_count_draft_and_approved_do(self):
        rows = [move(14, 611000, "A", 1), move(14, 611000, "B", 1), move(14, 611000, "C", 1), move(14, 611000, "D", 1)]
        existing = [expense(1, 14, "A", 1, status="cancelled"), expense(2, 14, "B", 1, status="rejected"),
                    expense(3, 14, "C", 1, status="draft"), expense(4, 14, "D", 1, status="approved")]
        assert [r["status"] for r in plan_for(rows, existing=existing)["rows"]] == \
            ["new", "new", "duplicate", "duplicate"]

    def test_duplicate_wins_over_a_missing_mapping(self):
        plan = plan_for([move(14, 611000, "A", 1)], mapping={}, existing=[expense(1, 14, "A", 1)])
        assert plan["rows"][0]["status"] == "duplicate"

    def test_force_imports_a_duplicate_and_then_needs_its_mapping(self):
        existing = [expense(1, 14, "A", 1)]
        forced = plan_for([move(14, 611000, "A", 1)], mapping={**MAPPED, "force": [3]}, existing=existing)
        assert (forced["rows"][0]["status"], forced["rows"][0]["forced"]) == ("new", True)
        unmapped = plan_for([move(14, 611000, "A", 1)], mapping={"force": [3]}, existing=existing)
        assert unmapped["rows"][0]["status"] == "error"

    def test_skip_leaves_a_new_row_out(self):
        plan = plan_for([move(14, 611000, "A", 1), move(14, 611000, "B", 2)], mapping={**MAPPED, "skip": [3]})
        assert [r["will_import"] for r in plan["rows"]] == [False, True]
        assert plan["counts"] == {"import": 1, "duplicate": 0, "error": 0, "skipped": 1}
        assert plan["expected"] == {"count": 1, "total": 2.0}

    def test_same_date_and_amount_with_other_details_is_only_a_warning(self):
        plan = plan_for([move(14, 611000, "DIGITALOCEAN.COM", 19.2)], existing=[expense(1, 14, "Digitalocean", 19.2)])
        assert plan["rows"][0]["status"] == "new"
        assert [w["code"] for w in plan["warnings"]] == ["possible_duplicate"]

    def test_not_in_file_lists_only_imported_paid_rows_of_the_target_departments(self):
        existing = [
            expense(1, 14, "A", 1),                                    # duplicado
            expense(2, 14, "Quitado del ledger", 5),                   # ← este
            expense(3, 14, "Cargado a mano", 5, comments=None),
            expense(4, 14, "De otro departamento", 5, department="competitions"),
            expense(5, 14, "Borrador", 5, status="draft"),
        ]
        plan = plan_for([move(14, 611000, "A", 1)], existing=existing)
        assert [r["record_no"] for r in plan["not_in_file"]["rows"]] == ["GA-00002"]
        assert plan["not_in_file"]["amount"] == 5


# ─── Línea de presupuesto, destinatario y registros ──────────────────────────

def line(i, account="611000", department="it", year=2026, competition_id=None, kind="expense"):
    return {"id": f"l{i}", "year": year, "department_code": department, "account_code": account,
            "competition_id": competition_id, "kind": kind}


class TestBudgetLine:
    def test_links_only_with_exactly_one_candidate(self):
        rows = [move(14, 611000, "A", 1)]
        assert plan_for(rows, lines=[])["rows"][0]["budget_line_id"] is None
        assert plan_for(rows, lines=[line(1)])["rows"][0]["budget_line_id"] == "l1"
        assert plan_for(rows, lines=[line(1), line(2)])["rows"][0]["budget_line_id"] is None

    def test_other_year_competition_or_kind_is_not_a_candidate(self):
        lines = [line(1, year=2027), line(2, competition_id=COMP), line(3, kind="revenue"),
                 line(4, department="admin"), line(5, account="612100")]
        assert plan_for([move(14, 611000, "A", 1)], lines=lines)["rows"][0]["budget_line_id"] is None


class TestPayee:
    def test_known_pattern(self):
        assert ei.payee_for("ADOBE Adobe Systems SAN JOSE CA") == "Adobe"
        assert ei.payee_for("Best Buy 00012345") == "Best Buy"

    def test_fallback_takes_the_first_fixed_width_chunk(self):
        assert ei.payee_for("WETRANSFER AMSTERDAM NL", "WETRANSFER          AMSTERDAM           NL") == "WETRANSFER"
        assert ei.payee_for("CANVA* I04969 AUSTIN TX", "CANVA* I04969-502723AUSTIN              TX") == "CANVA"

    def test_invoice_number(self):
        assert ei.invoice_for("A/P Invoices - 12345 - SubIT") == "12345"
        assert ei.invoice_for("AT&T") is None


class TestCommitRecords:
    def test_only_rows_to_import_all_paid_with_uniform_keys(self):
        rows = [move(14, 611000, "ADOBE", 59.99), move(14, 611000, "Dup", 1),
                move(15, 611000, "A/P Invoices - 77 - SubIT", 100, project=None)]
        plan = plan_for(rows, existing=[expense(1, 14, "Dup", 1)], lines=[line(1)])
        records = ei.commit_records(plan, batch="a1b2c3d4e5f6", file_name="10.31.26.xlsx",
                                    user_id="u1", now="2026-11-24T00:00:00+00:00")
        assert len(records) == 2
        assert len({tuple(r) for r in records}) == 1          # mismas claves, mismo orden
        first = records[0]
        assert first == {**first, "status": "paid", "expense_date": "2026-01-14", "payment_date": "2026-01-14",
                         "payee_type": "other", "payee_name": "Adobe", "amount": 59.99,
                         "department_code": "it", "account_code": "611000", "competition_id": None,
                         "budget_line_id": "l1", "created_by": "u1", "paid_by": "u1"}
        assert first["comments"].startswith("import:ledger:a1b2c3d4e5f6. 10.31.26.xlsx, hoja Sheet1, fila 3")
        assert "Proyecto: OTHOPS26" in first["comments"] and "Departamento: ADMN" in first["comments"]
        assert records[1]["invoice_no"] == "77"

    def test_file_name_is_sanitized(self):
        plan = plan_for([move(14, 611000, "A", 1)])
        record = ei.commit_records(plan, batch="b" * 12, file_name="led*ger%.xlsx", user_id=None, now="x")[0]
        assert "ledger.xlsx, hoja" in record["comments"]
