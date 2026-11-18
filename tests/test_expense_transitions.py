"""Máquina de estados de gastos (`check_expense_transition`, budget.py).

Pura: `can_edit` / `can_approve` llegan ya resueltos contra el departamento del
gasto (eso lo cubre test_budget_scope.py). Acá se prueba la tabla, quién puede
hacer cada paso y la separación de funciones (el que carga no aprueba).
"""
import pytest
from fastapi import HTTPException

from api._lib.routers.budget import _EXPENSE_TRANSITIONS, check_expense_transition
from api._lib.schemas import ExpenseTransition

NOW = "2026-10-13T00:00:00+00:00"
CREATOR, OTHER, BOSS = "user-a", "user-b", "user-sa"


def exp(status, created_by=CREATOR, **kw):
    return {"id": "e1", "status": status, "department_code": "it", "created_by": created_by,
            "payment_date": "2026-09-01" if status == "paid" else None, **kw}


def run(expense, target, payload=None, *, user=OTHER, edit=False, approve=False, sa=False):
    return check_expense_transition(expense, target, payload, user_id=user, can_edit=edit,
                                    can_approve=approve, is_superadmin=sa, now=NOW)


def status_of(*args, **kwargs) -> int:
    try:
        run(*args, **kwargs)
    except HTTPException as exc:
        return exc.status_code
    return 200


def test_transition_table_is_the_documented_one():
    assert _EXPENSE_TRANSITIONS == {
        ("draft", "approved"), ("draft", "rejected"), ("draft", "cancelled"),
        ("approved", "paid"), ("approved", "draft"),
        ("rejected", "draft"), ("cancelled", "draft"),
        ("paid", "approved"),
    }


# ─── genéricos ───────────────────────────────────────────────────────────────

def test_invalid_status_400():
    assert status_of(exp("draft"), "split", approve=True, edit=True, sa=True) == 400


def test_same_status_409():
    assert status_of(exp("draft"), "draft", edit=True) == 409


@pytest.mark.parametrize("current, target, payload", [
    ("draft", "paid", {"payment_date": "2026-10-01"}),
    ("approved", "cancelled", {"reason": "x"}),
    ("approved", "rejected", {"reason": "x"}),
    ("rejected", "approved", None),
    ("cancelled", "approved", None),
    ("paid", "draft", None),
    ("paid", "cancelled", {"reason": "x"}),
])
def test_missing_transition_409(current, target, payload):
    # Con todos los derechos: el 409 sale de la tabla, no del permiso.
    assert status_of(exp(current), target, payload, edit=True, approve=True, sa=True) == 409


# ─── draft → approved ────────────────────────────────────────────────────────

class TestApprove:
    def test_other_approver_ok(self):
        r = run(exp("draft"), "approved", approve=True)
        assert r["updates"] == {"status": "approved", "approved_by": OTHER, "approved_at": NOW}
        assert r["meta"] is None and r["from_status"] == "draft" and r["to_status"] == "approved"

    def test_editor_without_approve_403(self):
        assert status_of(exp("draft"), "approved", edit=True) == 403

    def test_self_approval_403(self):
        assert status_of(exp("draft", created_by=OTHER), "approved", approve=True) == 403

    def test_self_approval_superadmin_without_reason_400(self):
        assert status_of(exp("draft", created_by=BOSS), "approved",
                         user=BOSS, approve=True, sa=True) == 400

    def test_self_approval_superadmin_with_reason_is_override(self):
        r = run(exp("draft", created_by=BOSS), "approved", {"reason": " Finance soy yo "},
                user=BOSS, approve=True, sa=True)
        assert r["meta"] == {"override": "self_approval"} and r["reason"] == "Finance soy yo"

    def test_superadmin_on_someone_elses_no_override(self):
        r = run(exp("draft"), "approved", user=BOSS, approve=True, sa=True)
        assert r["meta"] is None

    def test_imported_expense_without_creator(self):
        assert status_of(exp("draft", created_by=None), "approved", approve=True) == 200

    def test_pydantic_payload(self):
        r = run(exp("draft", created_by=BOSS), "approved",
                ExpenseTransition(status="approved", reason="r"), user=BOSS, approve=True, sa=True)
        assert r["meta"] == {"override": "self_approval"}


# ─── separación de funciones: quien editó la plata no aprueba (050) ──────────

class TestEditedThenApproved:
    def test_editor_cannot_approve_403(self):
        # B cargó, A le cambió el monto: A no lo aprueba aunque no lo haya creado.
        e = exp("draft", created_by=CREATOR, last_financial_edit_by=OTHER)
        assert status_of(e, "approved", approve=True) == 403

    def test_superadmin_editor_without_reason_400(self):
        e = exp("draft", created_by=CREATOR, last_financial_edit_by=BOSS)
        assert status_of(e, "approved", user=BOSS, approve=True, sa=True) == 400

    def test_superadmin_editor_with_reason_is_override(self):
        e = exp("draft", created_by=CREATOR, last_financial_edit_by=BOSS)
        r = run(e, "approved", {"reason": "corregí el tipo de cambio"}, user=BOSS, approve=True, sa=True)
        assert r["meta"] == {"override": "edited_then_approved"}

    def test_creator_wins_over_editor_label(self):
        e = exp("draft", created_by=BOSS, last_financial_edit_by=BOSS)
        r = run(e, "approved", {"reason": "r"}, user=BOSS, approve=True, sa=True)
        assert r["meta"] == {"override": "self_approval"}

    def test_third_approver_ok(self):
        e = exp("draft", created_by=CREATOR, last_financial_edit_by=BOSS)
        r = run(e, "approved", approve=True)
        assert r["meta"] is None

    def test_reject_is_not_blocked_by_edit(self):
        # Rechazar no suelta plata: quien editó puede rechazar.
        e = exp("draft", created_by=CREATOR, last_financial_edit_by=OTHER)
        assert status_of(e, "rejected", {"reason": "x"}, approve=True) == 200


# ─── draft → rejected ────────────────────────────────────────────────────────

class TestReject:
    def test_approver_with_reason(self):
        r = run(exp("draft"), "rejected", {"reason": "falta factura"}, approve=True)
        assert r["updates"] == {"status": "rejected", "rejected_by": OTHER, "rejected_at": NOW,
                                "rejection_reason": "falta factura"}

    @pytest.mark.parametrize("payload", [None, {"reason": "   "}])
    def test_without_reason_400(self, payload):
        assert status_of(exp("draft"), "rejected", payload, approve=True) == 400

    def test_editor_without_approve_403(self):
        assert status_of(exp("draft"), "rejected", {"reason": "x"}, edit=True) == 403


# ─── draft → cancelled ───────────────────────────────────────────────────────

class TestCancel:
    def test_editor_with_reason(self):
        r = run(exp("draft"), "cancelled", {"reason": "duplicado"}, edit=True)
        assert r["updates"] == {"status": "cancelled", "cancelled_by": OTHER, "cancelled_at": NOW,
                                "cancel_reason": "duplicado"}

    def test_without_reason_400(self):
        assert status_of(exp("draft"), "cancelled", {}, edit=True) == 400

    def test_approver_without_edit_403(self):
        assert status_of(exp("draft"), "cancelled", {"reason": "x"}, approve=True) == 403


# ─── approved → paid ─────────────────────────────────────────────────────────

class TestPay:
    def test_editor_with_date(self):
        r = run(exp("approved"), "paid", {"payment_date": "2026-10-10", "payment_method": "wire",
                                          "bank_confirmation": " ABC123 "}, edit=True)
        assert r["updates"] == {"status": "paid", "payment_date": "2026-10-10", "paid_by": OTHER,
                                "paid_at": NOW, "payment_method": "wire", "bank_confirmation": "ABC123"}
        assert r["meta"] == {"payment_date": "2026-10-10"}

    def test_without_date_400(self):
        assert status_of(exp("approved"), "paid", {}, edit=True) == 400

    def test_bad_date_400(self):
        assert status_of(exp("approved"), "paid", {"payment_date": "10/10/2026"}, edit=True) == 400

    def test_approver_without_edit_403(self):
        assert status_of(exp("approved"), "paid", {"payment_date": "2026-10-10"}, approve=True) == 403


# ─── approved → draft ────────────────────────────────────────────────────────

class TestReopenApproved:
    def test_approver(self):
        r = run(exp("approved"), "draft", approve=True)
        assert r["updates"] == {"status": "draft", "approved_by": None, "approved_at": None}

    def test_superadmin(self):
        assert status_of(exp("approved"), "draft", user=BOSS, sa=True) == 200

    def test_editor_without_approve_403(self):
        assert status_of(exp("approved"), "draft", edit=True) == 403


# ─── rejected / cancelled → draft ────────────────────────────────────────────

@pytest.mark.parametrize("current", ["rejected", "cancelled"])
class TestBackToDraft:
    def test_editor_clears_stamps(self, current):
        r = run(exp(current, rejection_reason="x", cancel_reason="y"), "draft", edit=True)
        u = r["updates"]
        assert u["status"] == "draft"
        for col in ("approved_by", "approved_at", "rejected_by", "rejected_at", "rejection_reason",
                    "cancelled_by", "cancelled_at", "cancel_reason"):
            assert col in u and u[col] is None

    def test_approver_without_edit_403(self, current):
        assert status_of(exp(current), "draft", approve=True) == 403


# ─── paid → approved ─────────────────────────────────────────────────────────

class TestRevertPaid:
    def test_superadmin_with_reason(self):
        r = run(exp("paid"), "approved", {"reason": "pago rebotado"}, user=BOSS, sa=True)
        assert r["updates"] == {"status": "approved", "payment_date": None, "paid_by": None, "paid_at": None}
        assert r["meta"] == {"reverted_payment_date": "2026-09-01"}

    def test_superadmin_without_reason_400(self):
        assert status_of(exp("paid"), "approved", {}, user=BOSS, sa=True) == 400

    def test_general_admin_not_superadmin_403(self):
        assert status_of(exp("paid"), "approved", {"reason": "x"}, edit=True, approve=True) == 403
