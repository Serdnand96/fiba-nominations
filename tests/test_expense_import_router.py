"""Import de gastos desde el ledger, contra la base en memoria.

Lo que el parser no cubre: quién puede importar, que el preview no escriba, que
lo que se confirma sea lo que se vio, que los gastos entren pagados con sus
sellos y su historial, y que el deshacer solo se lleve lo que sigue intacto.
"""
import asyncio
import json

import pytest
from fastapi import HTTPException

from api._lib import database
from api._lib.routers import budget
from api._lib.schemas import ExpenseImportUndo
from tests.test_expense_import import _bytes, ledger, move

ADMIN = "admin-general"       # fila `*` con can_edit, sin ser superadmin
BOSS = "superadmin"
IT_EDITOR = "editor-it"       # edita IT, no es admin general
MAPPING = {"departments": {"ADMN": "it"}, "projects": {"OTHOPS26": "__general__"}}


class FakeUpload:
    def __init__(self, content: bytes, filename: str = "10.31.26.xlsx"):
        self._content = content
        self.filename = filename

    async def read(self) -> bytes:
        return self._content


@pytest.fixture
def db(fake_db):
    fake_db.seed("departments", [
        {"code": "it", "label": "IT", "active": True},
        {"code": "admin", "label": "Administration", "active": True},
        {"code": "old", "label": "Viejo", "active": False},
    ])
    fake_db.seed("accounts", [
        {"code": "611000", "label": "Telephone", "kind": "expense", "active": True},
        {"code": "612100", "label": "Hardware", "kind": "expense", "active": True},
        {"code": "REV-01", "label": "Sponsors", "kind": "revenue", "active": True},
    ])
    fake_db.seed("competitions", [{"id": "comp-1", "name": "BCLA"}])
    fake_db.seed("budget_lines", [
        {"id": "line-1", "year": 2026, "department_code": "it", "account_code": "611000",
         "competition_id": None, "kind": "expense"},
    ])
    fake_db.seed("budget_access", [
        {"user_id": ADMIN, "department_code": "*", "can_view": True, "can_edit": True},
        {"user_id": IT_EDITOR, "department_code": "it", "can_view": True, "can_edit": True},
    ])
    return fake_db


def rows_default():
    return [move(14, 611000, "ADOBE Adobe Systems SAN JOSE            CA", 59.99),
            move(14, 611000, "AT&T                800-288-2020        TX", 2126.19),
            move(15, 612100, "BESTBUY 00012", 300)]


def upload(rows=None, filename="10.31.26.xlsx"):
    return FakeUpload(_bytes(ledger(rows if rows is not None else rows_default())), filename)


def preview(request, rows=None, mapping=MAPPING, **kwargs):
    return asyncio.run(budget.preview_expense_import(
        request, file=upload(rows, **kwargs), sheet=None, mapping=json.dumps(mapping)))


def commit(request, rows=None, mapping=MAPPING, expected=None, **kwargs):
    if expected is None:
        plan = preview(request, rows, mapping)
        expected = plan["expected"]
    return asyncio.run(budget.commit_expense_import(
        request, file=upload(rows, **kwargs), sheet=None, mapping=json.dumps(mapping),
        expected_count=expected["count"], expected_total=expected["total"]))


def status_of(fn, *args, **kwargs) -> int:
    try:
        fn(*args, **kwargs)
    except HTTPException as exc:
        return exc.status_code
    return 200


def history(db):
    return [h for h in db.tables.get("finance_status_history", []) if h["entity_type"] == "expense"]


# ─── Permiso ─────────────────────────────────────────────────────────────────

class TestGeneralAdminOnly:
    def test_department_editor_gets_403_everywhere(self, db, make_request):
        request = make_request(IT_EDITOR)
        assert status_of(preview, request) == 403
        assert status_of(commit, request, expected={"count": 3, "total": 2486.18}) == 403
        assert status_of(budget.undo_expense_import,
                         ExpenseImportUndo(batch="a" * 12, reason="x"), request) == 403
        assert not db.tables.get("expenses")

    def test_user_without_budget_access_gets_403(self, db, make_request):
        assert status_of(preview, make_request("nadie")) == 403

    def test_star_editor_and_superadmin_pass(self, db, make_request):
        assert preview(make_request(ADMIN))["counts"]["import"] == 3
        assert preview(make_request(BOSS, superadmin=True))["counts"]["import"] == 3


# ─── Preview ─────────────────────────────────────────────────────────────────

class TestPreview:
    def test_writes_nothing(self, db, make_request):
        plan = preview(make_request(ADMIN))
        assert plan["expected"] == {"count": 3, "total": 2486.18}
        assert plan["rows"][0]["budget_line_id"] == "line-1"
        assert all(c.method == "GET" for c in db.calls)

    def test_existing_expenses_are_read_with_one_date_filter_and_paged(self, db, make_request):
        preview(make_request(ADMIN))
        reads = db.calls_to("expenses")
        assert reads and all(c.method == "GET" for c in reads)
        for call in reads:
            assert call.params["expense_date"] == 'in.("2026-01-14","2026-01-15")'
            assert call.params["limit"] == "1000" and "order" in call.params

    def test_reads_past_the_first_page(self, db, make_request, monkeypatch):
        monkeypatch.setattr(budget, "_PAGE", 2)
        db.seed("expenses", [
            {"id": f"e{i}", "record_no": f"GA-{i}", "expense_date": "2026-01-14", "description": f"Otro {i}",
             "amount": 1, "account_code": "611000", "department_code": "it", "status": "paid"}
            for i in range(4)
        ] + [{"id": "e9", "record_no": "GA-9", "expense_date": "2026-01-14",
              "description": "ADOBE Adobe Systems SAN JOSE CA", "amount": 59.99,
              "account_code": "611000", "department_code": "it", "status": "paid"}])
        plan = preview(make_request(ADMIN))
        assert plan["rows"][0]["status"] == "duplicate"

    def test_bad_extension_corrupt_file_and_bad_mapping_are_400(self, db, make_request):
        request = make_request(ADMIN)
        assert status_of(preview, request, filename="ledger.csv") == 400
        assert status_of(lambda: asyncio.run(budget.preview_expense_import(
            request, file=FakeUpload(b"not a workbook"), sheet=None, mapping=None))) == 400
        assert status_of(lambda: asyncio.run(budget.preview_expense_import(
            request, file=upload(), sheet=None, mapping="{not json"))) == 400
        assert status_of(preview, request, mapping={"otra_clave": {}}) == 400

    @pytest.mark.parametrize("mapping", [
        {"departments": {"ADMN": "no-existe"}},
        {"departments": {"ADMN": "old"}},
        {"accounts": {"102430": "REV-01"}},
        {"projects": {"OTHOPS26": "comp-inexistente"}},
    ])
    def test_mapping_to_something_that_does_not_exist_is_400(self, db, make_request, mapping):
        assert status_of(preview, make_request(ADMIN), mapping=mapping) == 400

    def test_file_too_large_is_400(self, db, make_request, monkeypatch):
        monkeypatch.setattr(budget, "_MAX_SHEET_BYTES", 10)
        assert status_of(preview, make_request(ADMIN)) == 400


# ─── Commit ──────────────────────────────────────────────────────────────────

class TestCommit:
    def test_creates_paid_expenses_with_stamps_and_history(self, db, make_request):
        out = commit(make_request(ADMIN))
        assert (out["created"], out["total"], out["failed"]) == (3, 2486.18, [])
        expenses = db.tables["expenses"]
        assert len(expenses) == 3
        for e in expenses:
            assert e["status"] == "paid" and e["payment_date"] == e["expense_date"]
            assert e["created_by"] == ADMIN and e["paid_by"] == ADMIN and e["paid_at"]
            assert e["department_code"] == "it" and e["payee_type"] == "other"
            assert e["comments"].startswith(f"import:ledger:{out['batch']}. 10.31.26.xlsx")
        assert {e["payee_name"] for e in expenses} == {"Adobe", "AT&T", "Best Buy"}

        inserts = [c for c in db.calls_to("expenses") if c.method == "POST"]
        assert len(inserts) == 1 and len(inserts[0].body) == 3      # un insert por tramo

        rows = history(db)
        assert len(rows) == 3
        assert all(h["from_status"] is None and h["to_status"] == "paid" and h["changed_by"] == ADMIN
                   and h["meta"]["historical_load"] and h["meta"]["import"]["batch"] == out["batch"]
                   for h in rows)
        assert len([c for c in db.calls_to("finance_status_history") if c.method == "POST"]) == 1
        assert not db.tables.get("notifications")                   # nada que aprobar

    def test_second_commit_of_the_same_file_creates_nothing(self, db, make_request):
        commit(make_request(ADMIN))
        assert preview(make_request(ADMIN))["counts"] == {"import": 0, "duplicate": 3, "error": 0, "skipped": 0}
        assert status_of(commit, make_request(ADMIN)) == 400        # nada para importar
        assert len(db.tables["expenses"]) == 3

    def test_plan_that_no_longer_matches_the_preview_is_409(self, db, make_request):
        request = make_request(ADMIN)
        expected = preview(request)["expected"]
        # Alguien cargó a mano uno de los tres entre el preview y el commit.
        db.seed("expenses", [{"id": "e1", "record_no": "GA-1", "expense_date": "2026-01-15",
                              "description": "BESTBUY 00012", "amount": 300, "account_code": "612100",
                              "department_code": "it", "status": "draft"}])
        assert status_of(commit, make_request(ADMIN), expected=expected) == 409
        assert len(db.tables["expenses"]) == 1
        assert status_of(commit, request, expected={"count": 3, "total": 1.0}) == 409

    def test_rows_in_error_are_left_out_and_reported(self, db, make_request):
        rows = rows_default() + [move(16, 611000, "Proyecto nuevo", 10, project="26BCLAGP")]
        out = commit(make_request(ADMIN), rows)
        assert out["created"] == 3 and out["skipped"] == {"duplicate": 0, "error": 1}

    def test_project_mapped_to_a_competition(self, db, make_request):
        rows = [move(16, 611000, "Traslado", 10, project="26BCLAGP")]
        mapping = {"departments": {"ADMN": "it"}, "projects": {"26BCLAGP": "comp-1"}}
        commit(make_request(ADMIN), rows, mapping=mapping)
        expense = db.tables["expenses"][0]
        assert expense["competition_id"] == "comp-1"
        assert expense["budget_line_id"] is None        # la línea es general, no de la competencia

    @pytest.mark.parametrize("total", [float("nan"), float("inf")])
    def test_non_finite_expected_total_does_not_switch_the_guard_off(self, db, make_request, total):
        assert status_of(commit, make_request(ADMIN), expected={"count": 3, "total": total}) == 409
        assert not db.tables.get("expenses")

    def test_timeout_after_the_insert_landed_does_not_duplicate(self, db, make_request, monkeypatch):
        """El INSERT entró pero la respuesta se perdió: reintentar duplicaría el tramo."""
        request = make_request(ADMIN)
        expected = preview(request)["expected"]
        real_execute = type(db.table("expenses")).execute

        def lost_response(self):
            result = real_execute(self)
            if self._table == "expenses" and self._method == "POST":
                raise TimeoutError("read timeout")
            return result

        monkeypatch.setattr(type(db.table("expenses")), "execute", lost_response)
        out = commit(request, expected=expected)
        assert (out["created"], out["failed"]) == (3, [])
        assert len(db.tables["expenses"]) == 3
        assert len(history(db)) == 3

    def test_timeout_before_the_insert_landed_reports_the_rows(self, db, make_request, monkeypatch):
        request = make_request(ADMIN)
        expected = preview(request)["expected"]
        real_execute = type(db.table("expenses")).execute

        def never_arrives(self):
            if self._table == "expenses" and self._method == "POST":
                raise TimeoutError("connect timeout")
            return real_execute(self)

        monkeypatch.setattr(type(db.table("expenses")), "execute", never_arrives)
        out = commit(request, expected=expected)
        assert out["created"] == 0 and len(out["failed"]) == 3
        assert not db.tables.get("expenses") and not history(db)

    def test_history_failure_is_reported(self, db, make_request):
        request = make_request(ADMIN)
        expected = preview(request)["expected"]
        db.fail_tables.add("finance_status_history")
        out = commit(request, expected=expected)
        assert (out["created"], out["history_failed"]) == (3, 3)

    def test_failed_chunk_is_retried_row_by_row(self, db, make_request, monkeypatch):
        request = make_request(ADMIN)
        expected = preview(request)["expected"]
        real_execute = type(db.table("expenses")).execute

        def flaky(self):
            body = self._body
            if self._table == "expenses" and self._method == "POST":
                if isinstance(body, list) or "AT&T" in body["description"]:
                    raise database.SupabaseError(400, "boom")
            return real_execute(self)

        monkeypatch.setattr(type(db.table("expenses")), "execute", flaky)
        out = commit(request, expected=expected)
        assert out["created"] == 2
        assert [f["description"] for f in out["failed"]] == ["AT&T 800-288-2020 TX"]
        assert len(history(db)) == 2


# ─── Undo ────────────────────────────────────────────────────────────────────

class TestUndo:
    def undo(self, request, batch, reason="Departamento equivocado"):
        return budget.undo_expense_import(ExpenseImportUndo(batch=batch, reason=reason), request)

    def test_removes_the_batch_and_leaves_a_trace(self, db, make_request):
        batch = commit(make_request(ADMIN))["batch"]
        out = self.undo(make_request(ADMIN), batch)
        assert (out["deleted"], out["total"], out["kept"]) == (3, 2486.18, [])
        assert db.tables["expenses"] == []
        gone = [h for h in history(db) if h["to_status"] == "deleted"]
        assert len(gone) == 3
        assert all(h["from_status"] == "paid" and h["reason"] == "Departamento equivocado"
                   and h["meta"]["import_undo"] == batch for h in gone)

    def test_only_touches_its_own_batch(self, db, make_request):
        first = commit(make_request(ADMIN))["batch"]
        second = commit(make_request(ADMIN), [move(20, 611000, "Otro archivo", 5)])["batch"]
        self.undo(make_request(ADMIN), first)
        assert [e["description"] for e in db.tables["expenses"]] == ["Otro archivo"]
        assert second in db.tables["expenses"][0]["comments"]

    def test_reason_is_required_and_batch_is_validated(self, db, make_request):
        batch = commit(make_request(ADMIN))["batch"]
        request = make_request(ADMIN)
        assert status_of(self.undo, request, batch, reason="  ") == 400
        assert status_of(self.undo, request, "*") == 400
        assert status_of(self.undo, request, batch[:6]) == 400
        assert status_of(self.undo, request, "f" * 12) == 404
        assert len(db.tables["expenses"]) == 3

    def test_another_admin_cannot_undo_but_a_superadmin_can(self, db, make_request):
        batch = commit(make_request(ADMIN))["batch"]
        db.tables["budget_access"].append(
            {"user_id": "otro-admin", "department_code": "*", "can_view": True, "can_edit": True})
        assert status_of(self.undo, make_request("otro-admin"), batch) == 403
        assert len(db.tables["expenses"]) == 3
        assert self.undo(make_request(BOSS, superadmin=True), batch)["deleted"] == 3

    def test_edited_or_reopened_expenses_are_kept(self, db, make_request):
        batch = commit(make_request(ADMIN))["batch"]
        adobe, att, bestbuy = db.tables["expenses"]
        att["status"] = "approved"                       # reabierto
        bestbuy["last_financial_edit_by"] = BOSS         # reabierto, corregido y vuelto a pagar
        out = self.undo(make_request(ADMIN), batch)
        assert out["deleted"] == 1
        assert sorted(k["id"] for k in out["kept"]) == sorted([att["id"], bestbuy["id"]])
        assert len(db.tables["expenses"]) == 2

    def test_nothing_removable_is_409(self, db, make_request):
        batch = commit(make_request(ADMIN))["batch"]
        for expense in db.tables["expenses"]:
            expense["status"] = "approved"
        assert status_of(self.undo, make_request(ADMIN), batch) == 409

    def test_reopened_and_paid_again_is_kept(self, db, make_request):
        # paid → approved → paid no deja sello en la fila (limpia paid_* y los
        # vuelve a escribir): se nota por el historial y por los datos del pago.
        batch = commit(make_request(ADMIN))["batch"]
        adobe, att, bestbuy = db.tables["expenses"]
        db.tables["finance_status_history"] += [
            {"id": "h1", "entity_type": "expense", "entity_id": adobe["id"], "from_status": "paid", "to_status": "approved"},
            {"id": "h2", "entity_type": "expense", "entity_id": adobe["id"], "from_status": "approved", "to_status": "paid"},
        ]
        att["bank_confirmation"] = "WIRE-1"          # mismo caso, con el historial perdido
        bestbuy["paid_by"] = "otro-editor"
        assert status_of(self.undo, make_request(ADMIN), batch) == 409
        assert len(db.tables["expenses"]) == 3

    @pytest.mark.parametrize("field, value", [
        ("hotel_id", "hotel-1"), ("invoice_no", "F-123"), ("payment_date", "2026-02-01"),
        ("payment_method", "wire"),
    ])
    def test_anything_edited_after_the_import_is_kept(self, db, make_request, field, value):
        batch = commit(make_request(ADMIN))["batch"]
        db.tables["expenses"][0][field] = value
        out = self.undo(make_request(ADMIN), batch)
        assert out["deleted"] == 2 and [k["id"] for k in out["kept"]] == [db.tables["expenses"][0]["id"]]

    def test_expense_with_attachments_is_kept_with_its_files(self, db, make_request, monkeypatch):
        batch = commit(make_request(ADMIN))["batch"]
        adobe = db.tables["expenses"][0]
        db.seed("expense_attachments", [
            {"id": "a1", "expense_id": adobe["id"], "storage_path": "storage://nominations/expenses/x.pdf"}])
        removed = []
        monkeypatch.setattr(budget, "_delete_from_storage", removed.append)
        out = self.undo(make_request(ADMIN), batch)
        assert out["deleted"] == 2 and removed == []
        assert [e["id"] for e in db.tables["expenses"]] == [adobe["id"]]

    def test_the_batch_comes_from_the_history_not_from_comments(self, db, make_request):
        """`comments` es editable hasta en `paid`: no puede decidir qué se borra."""
        batch = commit(make_request(ADMIN))["batch"]
        adobe, att, bestbuy = db.tables["expenses"]
        adobe["comments"] = "Nota de alguien, sin la marca"           # sacado "a mano" del lote
        db.tables["expenses"].append({                                # metido "a mano" en el lote
            "id": "ajeno", "record_no": "GA-00001", "status": "paid", "created_by": None, "paid_by": None,
            "expense_date": "2026-01-14", "payment_date": "2026-01-14", "description": "Carga histórica",
            "amount": 999, "department_code": "it", "comments": f"import:ledger:{batch}. inyectado"})
        out = self.undo(make_request(BOSS, superadmin=True), batch)
        assert out["deleted"] == 3
        assert [e["id"] for e in db.tables["expenses"]] == ["ajeno"]

    def test_a_marked_draft_of_someone_else_does_not_block_the_importer(self, db, make_request):
        batch = commit(make_request(ADMIN))["batch"]
        db.tables["expenses"].append({"id": "trampa", "status": "draft", "created_by": IT_EDITOR,
                                      "department_code": "it", "comments": f"import:ledger:{batch}. x"})
        assert self.undo(make_request(ADMIN), batch)["deleted"] == 3
        assert [e["id"] for e in db.tables["expenses"]] == ["trampa"]

    def test_status_is_rechecked_in_the_delete(self, db, make_request):
        batch = commit(make_request(ADMIN))["batch"]
        self.undo(make_request(ADMIN), batch)
        deletes = [c for c in db.calls_to("expenses") if c.method == "DELETE"]
        assert deletes and all(
            c.params["status"] == "eq.paid" and c.params["approved_by"] == "is.null"
            and c.params["last_financial_edit_by"] == "is.null" and c.params["hotel_id"] == "is.null"
            for c in deletes)

    def test_undoing_twice_is_409(self, db, make_request):
        batch = commit(make_request(ADMIN))["batch"]
        self.undo(make_request(ADMIN), batch)
        assert status_of(self.undo, make_request(ADMIN), batch) == 409


class TestRecordTransitions:
    def test_invalid_entity_type_is_dropped_and_failure_never_raises(self, fake_db, make_request):
        from api._lib.services.finance_history import record_transitions
        record_transitions([
            {"entity_type": "expense", "entity_id": "e1", "from_status": None, "to_status": "paid"},
            {"entity_type": "otra", "entity_id": "x", "from_status": None, "to_status": "paid"},
        ], make_request(ADMIN))
        assert [h["entity_id"] for h in fake_db.tables["finance_status_history"]] == ["e1"]
        fake_db.fail_tables.add("finance_status_history")
        assert record_transitions([{"entity_type": "expense", "entity_id": "e2", "from_status": None,
                                    "to_status": "paid"}], make_request(ADMIN)) == 0
