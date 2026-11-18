"""Hallazgos del code review de la rama feat/finance-workflow.

Corre contra el supabase falso de conftest.py (`fake_db`): los endpoints se
llaman como funciones, con un FakeRequest que ya trae usuario y superadmin.

  P1-1/2/8  paid_amount solo por /record-partial; completed ⇒ paid == total
  P1-3      separación de funciones por `last_financial_edit_by` (050)
  P1-4      by_month cierra con totals
  P1-5      descarga del W-8 por POST con require_edit
  P2-1      vendors: renombrar / dar de baja es de admin general
  P2-2      filtro cm_pending de la cola
  P2-5      traza de ediciones de plata y de borrados
  P2-6/12   generate_recurring en lote, plantillas inactivas, fechas
  P2-9      headcount / supuestos solo con acceso a Competitions
"""
import uuid

import pytest
from fastapi import HTTPException

from api._lib.routers import budget, payments
from api._lib.routers.payments import check_partial_payment
from api._lib.schemas import (
    ExpenseUpdate,
    PaymentRecordPartial,
    PaymentSyncAmount,
    PaymentUpdate,
    RecurringGenerate,
    VendorUpdate,
)

CREATOR, APPROVER, EDITOR, BOSS = "u-creator", "u-approver", "u-editor", "u-boss"
BANK_OK = {
    "personnel_id": "pp",
    "tax_form_kind": "W-8BEN",
    "tax_form_path": "storage://nominations/banking/x.pdf",
    "tax_form_signed_at": "2025-01-10",
    "account_number": "123456789",
}
NOM_OK = {
    "id": "n1", "personnel_id": "pp", "competition_id": "c1", "total": 1000,
    "status": "generated", "confirmation_status": "confirmed", "cm_approved": True,
    "personnel": {"name": "Ana Pérez", "role": "TD", "country": "ARG"},
    "competitions": {"name": "AmeriCup", "year": 2027, "start_date": "2027-08-01"},
}


def status_of(fn, *args, **kwargs) -> int:
    try:
        fn(*args, **kwargs)
    except HTTPException as exc:
        return exc.status_code
    return 200


def history(fake_db, entity_type="payment"):
    return [h for h in fake_db.tables.get("finance_status_history", []) if h["entity_type"] == entity_type]


# ─── check_partial_payment (pura) ────────────────────────────────────────────

def pay(status="in_process", **kw):
    return {"id": "p1", "status": status, "created_by": CREATOR, "amount": 1000,
            "extra": 0, "total": 1000, **kw}


def partial(payment, amount, payload=None, *, nom=NOM_OK, bank=BANK_OK, user=APPROVER,
            approve=True, sa=False):
    return check_partial_payment(payment, nom, bank, amount, payload,
                                 user_id=user, has_approve=approve, is_superadmin=sa)


class TestCheckPartialPayment:
    def test_ok_is_absolute_and_keeps_previous(self):
        r = partial(pay(paid_amount=200), 450)
        assert r["updates"] == {"paid_amount": 450}
        assert r["meta"] == {"paid_amount": 450, "previous": 200}
        assert r["warnings"] == []

    def test_previous_none_is_zero(self):
        assert partial(pay(), 100)["meta"] == {"paid_amount": 100, "previous": 0}

    @pytest.mark.parametrize("current", ["new", "completed", "cancelled"])
    def test_only_in_process_409(self, current):
        assert status_of(partial, pay(current), 100) == 409

    @pytest.mark.parametrize("amount", [-5, 1000.5, None])
    def test_out_of_range_400(self, amount):
        assert status_of(partial, pay(), amount) == 400

    def test_zero_without_reason_400(self):
        # Cero deshace un parcial: solo con motivo, para que quede el porqué.
        assert status_of(partial, pay(paid_amount=200), 0) == 400

    def test_zero_with_reason_undoes_partial(self):
        r = partial(pay(paid_amount=200), 0, {"reason": "se cargó por error"})
        assert r["updates"] == {"paid_amount": 0}
        assert r["meta"] == {"paid_amount": 0, "previous": 200}

    def test_equal_to_total_400_use_completed(self):
        with pytest.raises(HTTPException) as exc:
            partial(pay(), 1000)
        assert exc.value.status_code == 400 and "completed" in exc.value.detail

    def test_without_approve_403(self):
        assert status_of(partial, pay(), 100, approve=False) == 403

    def test_creator_403(self):
        assert status_of(partial, pay(), 100, user=CREATOR) == 403

    def test_last_financial_editor_403(self):
        assert status_of(partial, pay(last_financial_edit_by=APPROVER), 100) == 403

    def test_superadmin_editor_needs_reason(self):
        p = pay(last_financial_edit_by=BOSS)
        assert status_of(partial, p, 100, user=BOSS, approve=False, sa=True) == 400
        r = partial(p, 100, {"reason": "pagamos la mitad"}, user=BOSS, approve=False, sa=True)
        assert r["meta"]["override"] == "edited_then_approved"

    def test_superadmin_creator_override(self):
        r = partial(pay(), 100, {"reason": "r"}, user=CREATOR, approve=False, sa=True)
        assert r["meta"]["override"] == "self_completion"

    @pytest.mark.parametrize("nom, bank", [
        ({**NOM_OK, "cm_approved": False}, BANK_OK),
        ({**NOM_OK, "confirmation_status": "declined"}, BANK_OK),
        (NOM_OK, None),                                                   # sin W-8
        (NOM_OK, {**BANK_OK, "tax_form_signed_at": "2020-01-01"}),         # vencido
        (NOM_OK, {k: v for k, v in BANK_OK.items() if k != "account_number"}),  # sin cuenta
    ])
    def test_same_business_rules_as_completing_409(self, nom, bank):
        assert status_of(partial, pay(), 100, nom=nom, bank=bank) == 409


# ─── endpoints de payments ───────────────────────────────────────────────────

@pytest.fixture
def seeded(fake_db):
    pid = str(uuid.uuid4())
    fake_db.seed("payments", [{
        "id": pid, "record_no": "PG-00001", "status": "in_process", "created_by": CREATOR,
        "nomination_id": "n1", "budget_code": "COMP", "amount": 1000, "extra": 0, "airfare": 0,
        "total": 1000, "paid_amount": None, "nominations": NOM_OK,
    }])
    fake_db.seed("personnel_banking", [BANK_OK])
    fake_db.seed("user_permissions", [
        {"user_id": APPROVER, "module": "payments_approve", "can_view": True, "can_edit": False},
        {"user_id": APPROVER, "module": "payments", "can_view": True, "can_edit": True},
        {"user_id": EDITOR, "module": "payments", "can_view": True, "can_edit": True},
    ])
    return pid


class TestRecordPartialEndpoint:
    def test_writes_paid_amount_history_and_queue_item(self, fake_db, make_request, seeded):
        out = payments.record_partial_payment(seeded, PaymentRecordPartial(paid_amount=300),
                                              make_request(APPROVER))
        assert out["warnings"] == []
        item = out["payment"]
        assert item["paid_amount"] == 300 and item["is_partial"] is True
        assert item["nominee_name"] == "Ana Pérez" and item["fiscal_year"] == 2027
        (h,) = history(fake_db)
        assert (h["from_status"], h["to_status"]) == ("in_process", "in_process")
        assert h["meta"] == {"paid_amount": 300, "previous": 0}

    def test_second_partial_replaces(self, fake_db, make_request, seeded):
        req = make_request(APPROVER)
        payments.record_partial_payment(seeded, PaymentRecordPartial(paid_amount=300), req)
        payments.record_partial_payment(seeded, PaymentRecordPartial(paid_amount=700), req)
        assert fake_db.tables["payments"][0]["paid_amount"] == 700
        assert history(fake_db)[-1]["meta"] == {"paid_amount": 700, "previous": 300}

    def test_editor_without_approve_403(self, fake_db, make_request, seeded):
        with pytest.raises(HTTPException) as exc:
            payments.record_partial_payment(seeded, PaymentRecordPartial(paid_amount=300),
                                            make_request(EDITOR))
        assert exc.value.status_code == 403
        assert fake_db.tables["payments"][0]["paid_amount"] is None


class TestPutPayment:
    @pytest.mark.parametrize("status", ["new", "in_process", "completed"])
    def test_paid_amount_rejected_in_any_status(self, fake_db, make_request, seeded, status):
        fake_db.tables["payments"][0]["status"] = status
        with pytest.raises(HTTPException) as exc:
            payments.update_payment(seeded, PaymentUpdate(paid_amount=10), make_request(EDITOR))
        assert exc.value.status_code == 400 and "record-partial" in exc.value.detail

    def test_amount_change_seals_editor_and_traces(self, fake_db, make_request, seeded):
        req = make_request(EDITOR, email="ed@fiba.test")
        row = payments.update_payment(seeded, PaymentUpdate(amount=900, comments="x"), req)
        assert row["last_financial_edit_by"] == EDITOR
        assert row["last_financial_edit_by_email"] == "ed@fiba.test"
        assert row["last_financial_edit_at"]
        (h,) = history(fake_db)
        assert h["meta"] == {"edit": {"amount": {"from": 1000, "to": 900}}}

    def test_same_amount_and_comments_do_not_seal(self, fake_db, make_request, seeded):
        row = payments.update_payment(seeded, PaymentUpdate(amount=1000, airfare=0, comments="x"),
                                      make_request(EDITOR))
        assert "last_financial_edit_by" not in row
        assert history(fake_db) == []

    def test_editor_then_cannot_complete(self, fake_db, make_request, seeded):
        payments.update_payment(seeded, PaymentUpdate(extra=50), make_request(APPROVER))
        payment = payments._load_payment(seeded)
        ctx = payments._transition_ctx(make_request(APPROVER))
        with pytest.raises(HTTPException) as exc:
            payments._apply_transition(payment, BANK_OK, {"status": "completed",
                                                          "payment_date": "2027-08-10"},
                                       make_request(APPROVER), ctx)
        assert exc.value.status_code == 403


def test_sync_amount_seals_and_traces(fake_db, make_request, seeded):
    fake_db.tables["payments"][0].update(status="new", amount=900, total=900)
    out = payments.sync_amount(PaymentSyncAmount(ids=[seeded]), make_request(EDITOR))
    assert out["updated"][0]["new_amount"] == 1000
    row = fake_db.tables["payments"][0]
    assert row["amount"] == 1000 and row["last_financial_edit_by"] == EDITOR
    (h,) = history(fake_db)
    assert h["meta"]["edit"] == {"amount": {"from": 900, "to": 1000}}


def test_delete_payment_leaves_trace(fake_db, make_request, seeded):
    fake_db.tables["payments"][0]["status"] = "new"
    payments.delete_payment(seeded, make_request(EDITOR))
    assert fake_db.tables["payments"] == []
    (h,) = history(fake_db)
    assert (h["from_status"], h["to_status"]) == ("new", "deleted")
    assert h["meta"]["record_no"] == "PG-00001"


def test_tax_form_download_is_audited_post_with_edit(fake_db, make_request):
    (route,) = [r for r in payments.router.routes
                if r.path == "/payments/personnel/{personnel_id}/banking/tax-form/download"]
    assert route.methods == {"POST"}
    fake_db.seed("user_permissions", [
        {"user_id": "viewer", "module": "payments", "can_view": True, "can_edit": False},
    ])
    checks = [d.dependency for d in route.dependencies]
    with pytest.raises(HTTPException) as exc:
        for check in checks:
            check(make_request("viewer"))
    assert exc.value.status_code == 403


class TestQueueCmPending:
    def test_filters_like_the_bell_counter(self, fake_db):
        def row(pid, cm, status="in_process"):
            return {"id": pid, "record_no": pid, "status": status, "amount": 1, "extra": 0, "total": 1,
                    "nominations": {**NOM_OK, "personnel_id": pid, "cm_approved": cm}}
        fake_db.seed("payments", [row("a", False), row("b", True), row("c", False, "new")])
        items = payments._queue(status="in_process", budget=None, year=None, competition_id=None,
                                missing_docs=False, stale=False, search=None, cm_pending=True)
        assert [i["id"] for i in items] == ["a"]

    def test_cancelled_year_matches_budget_by_status(self, fake_db):
        # Un cancelado con fecha de pago 2026 de una competencia 2027 se lista en
        # 2026, igual que en by_status del dashboard (finance_years.py).
        fake_db.seed("payments", [{
            "id": "x", "status": "cancelled", "payment_date": "2026-11-02", "total": 1,
            "nominations": NOM_OK,
        }])
        items = payments._queue(status=None, budget=None, year=2026, competition_id=None,
                                missing_docs=False, stale=False, search=None)
        assert [i["id"] for i in items] == ["x"]


# ─── budget: by_month == totals ──────────────────────────────────────────────

def test_by_month_adds_up_to_totals(fake_db, make_request):
    def p(pid, status, total, comp, **kw):
        return {"id": pid, "status": status, "total": total, "airfare": kw.pop("airfare", 0),
                "paid_amount": kw.pop("paid_amount", None), "department_code": "competitions",
                "account_code": "COMP-11", "payment_date": kw.pop("payment_date", None),
                "nominations": {"competition_id": "c1", "personnel": {"role": "TD"},
                                "competitions": comp}}
    fake_db.seed("payments", [
        # Competencia 2027 que arranca en diciembre 2026: comprometido "en 2026-12".
        p("p1", "new", 500, {"year": 2027, "start_date": "2026-12-15"}, airfare=200),
        # Sin start_date: antes no caía en ningún mes.
        p("p2", "in_process", 300, {"year": 2027, "start_date": None}, paid_amount=100),
        # Completado sin fecha de una competencia que arranca en 2028 (año 2027
        # declarado): va a diciembre.
        p("p3", "completed", 50, {"year": 2027, "start_date": "2028-01-05"}),
        p("p4", "completed", 70, {"year": 2026}, payment_date="2027-04-02"),
    ])
    fake_db.seed("expenses", [
        {"id": "e1", "amount": 40, "status": "paid", "department_code": "it", "account_code": "x",
         "expense_date": "2027-03-01", "payment_date": "2027-03-05"},
        {"id": "e2", "amount": 60, "status": "approved", "department_code": "it", "account_code": "x",
         "expense_date": "2027-06-01"},
    ])
    out = budget._summary_data(make_request(BOSS, superadmin=True), 2027)
    months = {m["month"]: m for m in out["by_month"]}
    assert len(months) == 12
    for key in ("executed", "committed"):
        assert round(sum(m[key] for m in out["by_month"]), 2) == out["totals"][key]
    assert out["totals"]["executed"] == 40 + 100 + 50 + 70
    assert out["totals"]["committed"] == 60 + 500 + 200 + 200
    assert months["2027-01"]["committed"] == 500 + 200 + 200   # p1 (fee + pasaje) y p2
    assert months["2027-01"]["executed"] == 100                 # parcial de p2 sin mes
    assert months["2027-12"]["executed"] == 50


@pytest.mark.parametrize("month, expected", [
    ("2027-05", "2027-05"), ("2026-12", "2027-01"), (None, "2027-01"), ("2028-01", "2027-12"),
])
def test_clamp_month(month, expected):
    assert budget._clamp_month(month, 2027) == expected


# ─── budget: separación de funciones y traza en gastos ───────────────────────

@pytest.fixture
def draft_expense(fake_db):
    eid = str(uuid.uuid4())
    fake_db.seed("expenses", [{
        "id": eid, "record_no": "GA-00001", "status": "draft", "department_code": "it",
        "account_code": "x", "amount": 100, "description": "Licencia", "created_by": CREATOR,
        "payee_type": "other", "payee_name": "Adobe", "expense_date": "2027-01-10",
    }])
    return eid


def test_update_expense_seals_and_traces(fake_db, make_request, draft_expense):
    req = make_request(EDITOR, superadmin=True, email="ed@fiba.test")
    row = budget.update_expense(draft_expense, ExpenseUpdate(amount=150, description="Licencia"), req)
    assert row["last_financial_edit_by"] == EDITOR
    assert row["last_financial_edit_by_email"] == "ed@fiba.test"
    (h,) = history(fake_db, "expense")
    assert h["meta"] == {"edit": {"amount": {"from": 100, "to": 150}}}


def test_update_expense_non_financial_does_not_seal(fake_db, make_request, draft_expense):
    row = budget.update_expense(draft_expense, ExpenseUpdate(description="Licencia anual"),
                                make_request(EDITOR, superadmin=True))
    assert "last_financial_edit_by" not in row
    assert history(fake_db, "expense") == []


def test_delete_expense_leaves_trace(fake_db, make_request, draft_expense):
    budget.delete_expense(draft_expense, make_request(EDITOR, superadmin=True))
    (h,) = history(fake_db, "expense")
    assert (h["from_status"], h["to_status"]) == ("draft", "deleted")
    assert h["meta"]["record_no"] == "GA-00001"


# ─── budget: vendors (P2-1) ──────────────────────────────────────────────────

IT_EDITOR_ACCESS = [{"user_id": EDITOR, "department_code": "it", "can_view": True, "can_edit": True}]


@pytest.fixture
def vendor(fake_db):
    fake_db.seed("vendors", [{"id": "v1", "name": "Adobe", "active": True, "country": "US"}])
    return "v1"


class TestVendorUpdate:
    def test_rename_needs_general_admin(self, make_request, vendor):
        req = make_request(EDITOR, budget_access=IT_EDITOR_ACCESS)
        assert status_of(budget.update_vendor, vendor, VendorUpdate(name="Adobe Inc"), req) == 403

    def test_deactivate_needs_general_admin(self, make_request, vendor):
        req = make_request(EDITOR, budget_access=IT_EDITOR_ACCESS)
        assert status_of(budget.update_vendor, vendor, VendorUpdate(active=False), req) == 403

    def test_resending_same_name_and_active_is_fine(self, fake_db, make_request, vendor):
        req = make_request(EDITOR, budget_access=IT_EDITOR_ACCESS)
        row = budget.update_vendor(vendor, VendorUpdate(name="Adobe", active=True, country="IE"), req)
        assert row["country"] == "IE"

    def test_general_admin_can_rename(self, make_request, vendor):
        req = make_request(EDITOR, budget_access=[
            {"user_id": EDITOR, "department_code": "*", "can_view": True, "can_edit": True}])
        assert budget.update_vendor(vendor, VendorUpdate(name="Adobe Inc"), req)["name"] == "Adobe Inc"

    def test_unknown_vendor_404(self, make_request, vendor):
        req = make_request(BOSS, superadmin=True)
        assert status_of(budget.update_vendor, "nope", VendorUpdate(country="AR"), req) == 404


# ─── budget: headcount / supuestos (P2-9) ────────────────────────────────────

@pytest.mark.parametrize("call", [
    lambda req: budget.list_headcount(req, year=2027),
    lambda req: budget.get_assumptions(2027, req),
])
def test_headcount_and_assumptions_need_competitions(make_request, call):
    it_only = make_request(EDITOR, budget_access=IT_EDITOR_ACCESS)
    assert status_of(call, it_only) == 403
    comp = make_request(EDITOR, budget_access=[
        {"user_id": EDITOR, "department_code": "competitions", "can_view": True}])
    assert status_of(call, comp) == 200


# ─── budget: generate_recurring (P2-6 / P2-12) ───────────────────────────────

@pytest.fixture
def templates(fake_db):
    t1, t2, t3 = (str(uuid.uuid4()) for _ in range(3))
    base = {"department_code": "it", "account_code": "x", "amount": 10, "frequency": "monthly",
            "start_date": "2026-01-01", "active": True, "vendor_id": None}
    fake_db.seed("recurring_expenses", [
        {**base, "id": t1, "description": "Internet", "day_of_month": 31},
        {**base, "id": t2, "description": "Leasing", "day_of_month": 5},
        {**base, "id": t3, "description": "Viejo", "active": False},
    ])
    fake_db.seed("budget_access", [
        {"user_id": APPROVER, "department_code": "it", "can_view": True, "can_approve": True}])
    fake_db.seed("user_permissions", [{"user_id": APPROVER, "module": "budget", "can_view": True}])
    return t1, t2, t3


class TestGenerateRecurring:
    def test_batched_insert_and_one_notification_per_department(self, fake_db, make_request, templates):
        t1, t2, _ = templates
        out = budget.generate_recurring(RecurringGenerate(items=[
            {"recurring_id": t1, "period": "2027-02"},
            {"recurring_id": t2, "period": "2027-02"},
            {"recurring_id": t2, "period": "2027-02"},     # repetido en el body
        ]), make_request(BOSS, superadmin=True))
        assert len(out["created"]) == 2 and len(out["skipped"]) == 1
        inserts = [c for c in fake_db.calls_to("expenses") if c.method == "POST"]
        assert len(inserts) == 1 and len(inserts[0].body) == 2
        dates = {r["description"]: r["expense_date"] for r in out["created"]}
        assert dates["Internet — 2027-02"] == "2027-02-28"     # día 31 recortado
        assert len(fake_db.tables["notifications"]) == 1
        assert fake_db.tables["notifications"][0]["user_id"] == APPROVER
        assert len(history(fake_db, "expense")) == 2

    def test_existing_period_is_skipped(self, fake_db, make_request, templates):
        t1, _, _ = templates
        fake_db.tables["expenses"] = [{"id": "e", "recurring_id": t1, "recurring_period": "2027-02"}]
        out = budget.generate_recurring(RecurringGenerate(items=[{"recurring_id": t1, "period": "2027-02"}]),
                                        make_request(BOSS, superadmin=True))
        assert out == {"created": [], "skipped": [{"recurring_id": t1, "period": "2027-02"}]}

    def test_inactive_template_400_and_nothing_created(self, fake_db, make_request, templates):
        t1, _, t3 = templates
        body = RecurringGenerate(items=[{"recurring_id": t1, "period": "2027-02"},
                                        {"recurring_id": t3, "period": "2027-02"}])
        assert status_of(budget.generate_recurring, body, make_request(BOSS, superadmin=True)) == 400
        assert not fake_db.tables.get("expenses")

    def test_bad_expense_date_400(self, fake_db, make_request, templates):
        t1, _, _ = templates
        body = RecurringGenerate(items=[{"recurring_id": t1, "period": "2027-02",
                                         "expense_date": "2027-02-30"}])
        assert status_of(budget.generate_recurring, body, make_request(BOSS, superadmin=True)) == 400
        assert not fake_db.tables.get("expenses")
