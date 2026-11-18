"""Campana in-app: escritura (`services/notify.py`) y lectura
(`routers/notifications.py`, `/api/me/notifications`).

Corre contra el supabase falso de conftest.py (`fake_db`).
"""
import uuid
from datetime import date

import pytest
from fastapi import HTTPException

from api._lib.auth import require_user
from api._lib.routers import notifications
from api._lib.routers.payments import tax_form_status
from api._lib.services import notify as notify_service
from api._lib.services.notify import budget_approvers_for, notify

TODAY = date.today()
SIGNED_NOW = TODAY.isoformat()   # W-8 firmado hoy → vale hasta 31/12 de año+3
BANK = {"account_number": "123456789"}


# ─── notify() ────────────────────────────────────────────────────────────────

class TestNotify:
    def test_dedupes_drops_empty_and_excludes(self, fake_db):
        n = notify(["b", "a", "a", None, "", "me"], "expense_submitted", "  Gasto  ",
                   entity_id=42, link="/budget?open=42", exclude="me")
        assert n == 2
        rows = fake_db.tables["notifications"]
        assert [r["user_id"] for r in rows] == ["a", "b"]
        assert rows[0]["title"] == "Gasto" and rows[0]["entity_id"] == "42"
        assert rows[0]["kind"] == "expense_submitted" and rows[0]["link"] == "/budget?open=42"
        # Un solo INSERT para todos los destinatarios.
        assert len(fake_db.calls_to("notifications")) == 1

    def test_single_string_recipient(self, fake_db):
        assert notify("a", "k", "T") == 1

    def test_exclude_iterable(self, fake_db):
        assert notify(["a", "b"], "k", "T", exclude=["a", "b"]) == 0

    @pytest.mark.parametrize("ids", [None, [], set(), [None, ""]])
    def test_empty_does_not_touch_db(self, fake_db, ids):
        assert notify(ids, "k", "T") == 0
        assert fake_db.calls == []

    def test_title_falls_back_and_truncates(self, fake_db):
        notify(["a"], "kind_x", "")
        notify(["b"], "k", "x" * 500, body="y" * 5000)
        rows = fake_db.tables["notifications"]
        assert rows[0]["title"] == "kind_x"
        assert len(rows[1]["title"]) == 300 and len(rows[1]["body"]) == 2000

    def test_db_failure_is_swallowed(self, fake_db):
        fake_db.fail_tables.add("notifications")
        assert notify(["a"], "k", "T") == 0


# ─── budget_approvers_for() ──────────────────────────────────────────────────

class TestBudgetApprovers:
    ROWS = [
        {"user_id": "it-approver", "department_code": "it", "can_view": True, "can_approve": True},
        {"user_id": "it-editor", "department_code": "it", "can_view": True, "can_approve": False},
        {"user_id": "general", "department_code": "*", "can_view": True, "can_approve": True},
        {"user_id": "comms-approver", "department_code": "comms", "can_view": True, "can_approve": True},
    ]

    PERMS = [
        {"user_id": u, "module": "budget", "can_view": True, "can_edit": False}
        for u in ("it-approver", "it-editor", "general", "comms-approver")
    ]

    def test_department_plus_star(self, fake_db):
        fake_db.seed("budget_access", self.ROWS)
        fake_db.seed("user_permissions", self.PERMS)
        assert budget_approvers_for("it") == {"it-approver", "general"}
        params = fake_db.calls_to("budget_access")[-1].params
        assert params["department_code"] == 'in.("it","*")'
        assert params["can_approve"] == "eq.True"

    def test_does_not_add_superadmins(self, fake_db):
        fake_db.seed("budget_access", self.ROWS)
        fake_db.seed("user_profiles", [{"user_id": "boss", "is_superadmin": True}])
        assert "boss" not in budget_approvers_for("comms")

    @pytest.mark.parametrize("code", [None, ""])
    def test_no_department(self, fake_db, code):
        assert budget_approvers_for(code) == set()
        assert fake_db.calls == []

    def test_pre_048_failure_returns_empty(self, fake_db):
        fake_db.fail_tables.add("budget_access")
        assert budget_approvers_for("it") == set()

    def test_requires_budget_module_view(self, fake_db):
        # La fila de budget_access quedó, pero le sacaron el módulo: avisarle
        # sería mandarlo a un 403.
        fake_db.seed("budget_access", self.ROWS)
        fake_db.seed("user_permissions", [
            {"user_id": "general", "module": "budget", "can_view": True},
            {"user_id": "it-approver", "module": "budget", "can_view": False},
            {"user_id": "it-approver", "module": "payments", "can_view": True},
        ])
        assert budget_approvers_for("it") == {"general"}

    def test_superadmin_with_row_but_no_module_row_counts(self, fake_db):
        fake_db.seed("budget_access", self.ROWS)
        fake_db.seed("user_permissions", [])
        fake_db.seed("user_profiles", [{"user_id": "it-approver", "is_superadmin": True}])
        assert budget_approvers_for("it") == {"it-approver"}

    def test_no_approvers_skips_permission_lookup(self, fake_db):
        fake_db.seed("budget_access", [])
        assert budget_approvers_for("it") == set()
        assert fake_db.calls_to("user_permissions") == []


def test_module_editors_includes_superadmins(fake_db):
    fake_db.seed("user_permissions", [
        {"user_id": "e1", "module": "payments", "can_edit": True},
        {"user_id": "v1", "module": "payments", "can_edit": False},
        {"user_id": "x1", "module": "budget", "can_edit": True},
    ])
    fake_db.seed("user_profiles", [{"user_id": "sa", "is_superadmin": True},
                                   {"user_id": "plain", "is_superadmin": False}])
    assert notify_service.module_editors("payments") == {"e1", "sa"}


# ─── _tax_form_valid ≡ payments.tax_form_status ──────────────────────────────

TAX_CASES = {
    "ok": {"tax_form_kind": "W-8BEN", "tax_form_path": "p", "tax_form_signed_at": SIGNED_NOW, **BANK},
    "missing": {"tax_form_kind": "W-8BEN", "tax_form_path": None, **BANK},   # tildó W-8 sin PDF
    "expired": {"tax_form_kind": "W-8BEN", "tax_form_path": "p", "tax_form_signed_at": "2000-01-01", **BANK},
    "exempt": {"tax_form_kind": "exempt", **BANK},
}


@pytest.mark.parametrize("expected_status", sorted(TAX_CASES))
def test_tax_form_valid_matches_payments(expected_status):
    banking = TAX_CASES[expected_status]
    assert tax_form_status(banking, TODAY) == expected_status
    valid = notifications._tax_form_valid(banking, TODAY)
    assert valid is (expected_status in ("ok", "exempt"))


def test_tax_form_valid_requires_bank_info():
    banking = {k: v for k, v in TAX_CASES["ok"].items() if k != "account_number"}
    assert tax_form_status(banking, TODAY) == "ok"
    assert notifications._tax_form_valid(banking, TODAY) is False


def test_tax_form_valid_without_banking_row():
    assert notifications._tax_form_valid(None, TODAY) is False


# ─── GET /pending ────────────────────────────────────────────────────────────

@pytest.fixture
def perms(monkeypatch):
    """Parchea has_view / has_edit del router: {(module, action)} habilitados."""
    granted = set()
    monkeypatch.setattr(notifications, "has_view", lambda r, m: (m, "view") in granted)
    monkeypatch.setattr(notifications, "has_edit", lambda r, m: (m, "edit") in granted)
    return granted


def test_router_requires_user():
    deps = [d.dependency for d in notifications.router.dependencies]
    assert require_user in deps


class TestPending:
    def test_no_permissions_returns_empty_without_queries(self, perms, fake_db, make_request):
        assert notifications.pending(make_request("me")) == []
        assert fake_db.calls == []

    def test_no_user_401(self, perms, make_request):
        with pytest.raises(HTTPException) as exc:
            notifications.pending(make_request(None))
        assert exc.value.status_code == 401

    def test_superadmin_counts_drafts_except_own(self, perms, fake_db, make_request):
        perms.add(("budget", "view"))
        fake_db.seed("expenses", [
            {"id": "1", "status": "draft", "department_code": "it", "created_by": "me"},
            {"id": "2", "status": "draft", "department_code": "it", "created_by": "x"},
            {"id": "3", "status": "draft", "department_code": "comms", "created_by": None},
            {"id": "4", "status": "approved", "department_code": "it", "created_by": "x"},
        ])
        out = notifications.pending(make_request("me", superadmin=True))
        assert out == [{"key": "expenses_to_approve", "count": 2,
                        "link": "/budget?tab=expenses&status=pending_approval"}]

    def test_approver_counts_only_own_departments(self, perms, fake_db, make_request):
        perms.add(("budget", "view"))
        fake_db.seed("expenses", [
            {"id": "1", "status": "draft", "department_code": "it", "created_by": "x"},
            {"id": "2", "status": "draft", "department_code": "comms", "created_by": "x"},
        ])
        request = make_request("me", budget_access=[
            {"user_id": "me", "department_code": "it", "can_view": True, "can_approve": True},
            {"user_id": "me", "department_code": "comms", "can_view": True, "can_approve": False},
        ])
        assert notifications.pending(request)[0]["count"] == 1
        assert fake_db.calls_to("expenses")[-1].params["department_code"] == 'in.("it")'

    def test_pre_048_rows_do_not_count_as_approver(self, perms, fake_db, make_request):
        perms.add(("budget", "view"))
        fake_db.seed("expenses", [{"id": "1", "status": "draft", "department_code": "it"}])
        request = make_request("me", budget_access=[
            {"user_id": "me", "department_code": "it", "can_view": True, "can_edit": True},
        ])
        assert notifications.pending(request) == []
        assert fake_db.calls_to("expenses") == []

    def test_payments_missing_docs_and_awaiting_cm(self, perms, fake_db, make_request):
        perms.add(("payments", "view"))
        fake_db.seed("payments", [
            {"id": "p1", "status": "in_process", "nominations": {"personnel_id": "a", "cm_approved": False}},
            {"id": "p2", "status": "in_process", "nominations": {"personnel_id": "b", "cm_approved": True}},
            {"id": "p3", "status": "in_process", "nominations": {"personnel_id": "c", "cm_approved": True}},
            {"id": "p4", "status": "in_process", "nominations": {"personnel_id": "d", "cm_approved": None}},
            {"id": "p5", "status": "new", "nominations": {"personnel_id": "e", "cm_approved": False}},
        ])
        fake_db.seed("personnel_banking", [
            {"personnel_id": "a", **TAX_CASES["exempt"]},    # válido
            {"personnel_id": "b", **TAX_CASES["expired"]},   # vencido
            {"personnel_id": "c", **TAX_CASES["ok"]},        # válido
            # d sin fila → faltante
        ])
        items = notifications.pending(make_request("me"))
        out = {i["key"]: i["count"] for i in items}
        assert out == {"payments_missing_docs": 2, "payments_awaiting_cm": 1}
        links = {i["key"]: i["link"] for i in items}
        assert links == {
            "payments_missing_docs": "/payments?tab=queue&status=in_process&missing_docs=1",
            "payments_awaiting_cm": "/payments?tab=queue&status=in_process&cm_pending=1",
        }

    def test_missing_banking_table_omits_item(self, perms, fake_db, make_request):
        perms.add(("payments", "view"))
        fake_db.seed("payments", [
            {"id": "p1", "status": "in_process", "nominations": {"personnel_id": "a", "cm_approved": True}},
        ])
        fake_db.fail_tables.add("personnel_banking")
        assert notifications.pending(make_request("me")) == []


# ─── aislamiento entre usuarios ──────────────────────────────────────────────

class TestIsolation:
    def _seed(self, fake_db):
        mine, theirs = str(uuid.uuid4()), str(uuid.uuid4())
        fake_db.seed("notifications", [
            {"id": mine, "user_id": "me", "title": "mía", "read_at": None, "created_at": "2026-10-01"},
            {"id": theirs, "user_id": "other", "title": "ajena", "read_at": None, "created_at": "2026-10-02"},
        ])
        return mine, theirs

    def test_list_only_returns_own(self, fake_db, make_request):
        self._seed(fake_db)
        out = notifications.list_notifications(make_request("me"), unread=False, limit=20, offset=0)
        assert [n["title"] for n in out["items"]] == ["mía"]
        assert out["unread_count"] == 1 and out["has_more"] is False

    def test_mark_read_foreign_is_404(self, fake_db, make_request):
        _, theirs = self._seed(fake_db)
        with pytest.raises(HTTPException) as exc:
            notifications.mark_read(theirs, make_request("me"))
        assert exc.value.status_code == 404
        assert all(r["read_at"] is None for r in fake_db.tables["notifications"])

    def test_mark_read_invalid_id_is_404(self, fake_db, make_request):
        with pytest.raises(HTTPException) as exc:
            notifications.mark_read("not-a-uuid", make_request("me"))
        assert exc.value.status_code == 404

    def test_mark_read_own(self, fake_db, make_request):
        mine, _ = self._seed(fake_db)
        assert notifications.mark_read(mine, make_request("me")) == {"ok": True, "unread_count": 0}

    def test_mark_all_read_only_touches_own(self, fake_db, make_request):
        self._seed(fake_db)
        notifications.mark_all_read(make_request("me"))
        by_user = {r["user_id"]: r["read_at"] for r in fake_db.tables["notifications"]}
        assert by_user["me"] is not None and by_user["other"] is None
