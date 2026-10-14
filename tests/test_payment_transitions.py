"""Máquina de estados de pagos (`check_payment_transition`, payments.py).

La función es pura a propósito: recibe el pago, la nominación, los datos
bancarios y el contexto del caller ya resueltos, y devuelve qué escribir o
levanta HTTPException. Se prueba sin base.

Tabla (docstring de check_payment_transition):
  new → in_process          nominación generated y no declined; W-8 avisa
  in_process → completed    payments_approve; no el creador (superadmin con
                            reason = override); payment_date; cm_approved; W-8
  in_process → new          sin plata pagada
  new|in_process → cancelled  reason; sin plata pagada
  cancelled → new           limpia sellos
  completed → in_process    solo superadmin, con reason
"""
from datetime import date, datetime, timezone

import pytest
from fastapi import HTTPException

from api._lib.routers.payments import (
    PAYMENT_STATUSES,
    _TRANSITIONS,
    check_payment_transition,
    has_bank_info,
    mask_value,
    tax_form_expiry,
    tax_form_status,
)

TODAY = date(2026, 10, 13)
NOW = datetime(2026, 10, 13, 12, tzinfo=timezone.utc)
CREATOR, OTHER = "u-creator", "u-other"
BANK_OK = {
    "tax_form_kind": "W-8BEN",
    "tax_form_path": "storage://nominations/banking/x.pdf",
    "tax_form_signed_at": "2025-01-10",
    "account_number": "123456789",
}
NOM_OK = {"status": "generated", "confirmation_status": "confirmed", "cm_approved": True}
PAID_ON = {"payment_date": "2026-10-01"}


def pay(status, **kw):
    return {"id": "p1", "status": status, "created_by": CREATOR,
            "amount": 1000, "extra": 0, "total": 1000, **kw}


def run(payment, target, payload=None, *, nom=NOM_OK, bank=BANK_OK, user=OTHER,
        approve=False, sa=False):
    return check_payment_transition(
        payment, nom, bank, target, payload or {},
        user_id=user, has_approve=approve, is_superadmin=sa, today=TODAY, now=NOW,
    )


def status_of(*args, **kwargs) -> int:
    try:
        run(*args, **kwargs)
    except HTTPException as exc:
        return exc.status_code
    return 200


def test_transition_table_is_the_documented_one():
    # Si alguien agrega una fila, este test obliga a sumarle casos acá.
    assert _TRANSITIONS == {
        ("new", "in_process"), ("in_process", "completed"), ("in_process", "new"),
        ("new", "cancelled"), ("in_process", "cancelled"), ("cancelled", "new"),
        ("completed", "in_process"),
    }
    assert "split" not in PAYMENT_STATUSES


# ─── new → in_process ────────────────────────────────────────────────────────

class TestNewToInProcess:
    def test_ok_without_warnings(self):
        r = run(pay("new"), "in_process")
        assert r["updates"] == {"status": "in_process"}
        assert r["warnings"] == [] and r["tax_form_status"] == "ok"

    def test_missing_tax_form_warns_but_passes(self):
        r = run(pay("new"), "in_process", bank=None)
        assert r["warnings"] == ["tax_form_missing"]

    def test_expired_tax_form_warns_but_passes(self):
        r = run(pay("new"), "in_process", bank={**BANK_OK, "tax_form_signed_at": "2020-01-01"})
        assert r["warnings"] == ["tax_form_expired"]

    def test_letter_not_generated_409(self):
        assert status_of(pay("new"), "in_process", nom={**NOM_OK, "status": "draft"}) == 409

    def test_declined_409(self):
        assert status_of(pay("new"), "in_process",
                         nom={**NOM_OK, "confirmation_status": "declined"}) == 409


# ─── in_process → completed ──────────────────────────────────────────────────

class TestCompleted:
    def test_ok_defaults_paid_amount_to_total(self):
        r = run(pay("in_process"), "completed",
                {**PAID_ON, "bank_confirmation": " TX1 "}, approve=True)
        u = r["updates"]
        assert u["status"] == "completed" and u["payment_date"] == "2026-10-01"
        assert u["paid_amount"] == 1000 and u["completed_by"] == OTHER
        assert u["completed_at"] == NOW.isoformat() and u["bank_confirmation"] == "TX1"
        assert r["meta"] == {"payment_date": "2026-10-01", "paid_amount": 1000}

    def test_existing_payment_date_is_enough(self):
        r = run(pay("in_process", payment_date="2026-09-30"), "completed", approve=True)
        assert r["updates"]["payment_date"] == "2026-09-30"

    def test_total_derived_from_amount_plus_extra(self):
        r = run(pay("in_process", total=None, amount=800, extra=50), "completed", PAID_ON, approve=True)
        assert r["updates"]["paid_amount"] == 850

    def test_without_approve_permission_403(self):
        assert status_of(pay("in_process"), "completed", PAID_ON) == 403

    def test_superadmin_counts_as_approver(self):
        assert status_of(pay("in_process"), "completed", PAID_ON, sa=True) == 200

    def test_own_payment_403(self):
        assert status_of(pay("in_process"), "completed", PAID_ON, user=CREATOR, approve=True) == 403

    def test_own_payment_superadmin_without_reason_400(self):
        assert status_of(pay("in_process"), "completed", PAID_ON, user=CREATOR, sa=True) == 400

    def test_own_payment_superadmin_with_reason_is_override(self):
        r = run(pay("in_process"), "completed", {**PAID_ON, "reason": "Finance soy yo"},
                user=CREATOR, sa=True)
        assert r["meta"]["override"] == "self_completion"
        assert r["updates"]["completed_by"] == CREATOR

    def test_legacy_payment_without_creator_skips_self_check(self):
        assert status_of(pay("in_process", created_by=None), "completed", PAID_ON,
                         user=CREATOR, approve=True) == 200

    def test_without_date_400(self):
        assert status_of(pay("in_process"), "completed", approve=True) == 400

    def test_bad_date_400(self):
        assert status_of(pay("in_process"), "completed", {"payment_date": "01/10/2026"},
                         approve=True) == 400

    def test_without_cm_approval_409(self):
        assert status_of(pay("in_process"), "completed", PAID_ON,
                         nom={**NOM_OK, "cm_approved": False}, approve=True) == 409

    def test_without_tax_form_409(self):
        assert status_of(pay("in_process"), "completed", PAID_ON, bank=None, approve=True) == 409

    def test_w8_without_pdf_409(self):
        assert status_of(pay("in_process"), "completed", PAID_ON,
                         bank={**BANK_OK, "tax_form_path": None}, approve=True) == 409

    def test_w8_expired_explicit_409(self):
        assert status_of(pay("in_process"), "completed", PAID_ON,
                         bank={**BANK_OK, "tax_form_expires_at": "2026-01-01"}, approve=True) == 409

    def test_w8_expired_derived_from_signature_409(self):
        # Firmado en 2022 → vence 31/12/2025.
        assert status_of(pay("in_process"), "completed", PAID_ON,
                         bank={**BANK_OK, "tax_form_signed_at": "2022-12-31"}, approve=True) == 409

    def test_exempt_passes(self):
        assert status_of(pay("in_process"), "completed", PAID_ON,
                         bank={"tax_form_kind": "exempt", "iban": "ES91"}, approve=True) == 200

    def test_without_bank_info_409(self):
        # W-8 vigente pero sin cuenta: no hay a dónde transferir.
        bank = {k: v for k, v in BANK_OK.items() if k != "account_number"}
        assert status_of(pay("in_process"), "completed", PAID_ON, bank=bank, approve=True) == 409

    def test_declined_409(self):
        assert status_of(pay("in_process"), "completed", PAID_ON,
                         nom={**NOM_OK, "confirmation_status": "declined"}, approve=True) == 409

    def test_last_financial_editor_403(self):
        p = pay("in_process", last_financial_edit_by=OTHER)
        assert status_of(p, "completed", PAID_ON, approve=True) == 403

    def test_last_financial_editor_superadmin_without_reason_400(self):
        p = pay("in_process", last_financial_edit_by=OTHER)
        assert status_of(p, "completed", PAID_ON, sa=True) == 400

    def test_last_financial_editor_superadmin_with_reason_is_override(self):
        p = pay("in_process", last_financial_edit_by=OTHER)
        r = run(p, "completed", {**PAID_ON, "reason": "ajusté el extra"}, sa=True)
        assert r["meta"]["override"] == "edited_then_approved"

    def test_paid_amount_above_total_400(self):
        assert status_of(pay("in_process"), "completed", {**PAID_ON, "paid_amount": 1500},
                         approve=True) == 400

    def test_negative_paid_amount_400(self):
        assert status_of(pay("in_process"), "completed", {**PAID_ON, "paid_amount": -1},
                         approve=True) == 400

    def test_paid_amount_below_total_400(self):
        # completed ⇒ paid_amount == total: lo parcial va por /record-partial.
        assert status_of(pay("in_process"), "completed", {**PAID_ON, "paid_amount": 900},
                         approve=True) == 400

    def test_paid_amount_equal_to_total_ok(self):
        r = run(pay("in_process"), "completed", {**PAID_ON, "paid_amount": 1000.001}, approve=True)
        assert r["updates"]["paid_amount"] == 1000

    def test_partial_then_complete_forces_total(self):
        r = run(pay("in_process", paid_amount=400), "completed", PAID_ON, approve=True)
        assert r["updates"]["paid_amount"] == 1000


# ─── in_process → new ────────────────────────────────────────────────────────

class TestBackToNew:
    def test_unpaid_ok(self):
        assert run(pay("in_process"), "new")["updates"] == {"status": "new"}

    def test_partially_paid_cannot_go_back_409(self):
        assert status_of(pay("in_process", paid_amount=200), "new") == 409


# ─── → cancelled / cancelled → new ───────────────────────────────────────────

class TestCancel:
    @pytest.mark.parametrize("current", ["new", "in_process"])
    def test_with_reason_ok(self, current):
        r = run(pay(current), "cancelled", {"reason": " No viajó "})
        assert r["updates"] == {"status": "cancelled", "cancelled_by": OTHER,
                                "cancelled_at": NOW.isoformat(), "cancel_reason": "No viajó"}

    @pytest.mark.parametrize("payload", [{}, {"reason": "   "}])
    def test_without_reason_400(self, payload):
        assert status_of(pay("new"), "cancelled", payload) == 400

    def test_partially_paid_409(self):
        assert status_of(pay("in_process", paid_amount=10), "cancelled", {"reason": "x"}) == 409

    def test_reopen_clears_stamps(self):
        r = run(pay("cancelled", cancel_reason="x"), "new")
        assert r["updates"] == {"status": "new", "cancelled_by": None,
                                "cancelled_at": None, "cancel_reason": None}

    def test_cancelled_cannot_jump_to_in_process(self):
        assert status_of(pay("cancelled"), "in_process") == 409


# ─── completed → in_process ──────────────────────────────────────────────────

class TestReopenCompleted:
    def test_superadmin_with_reason(self):
        r = run(pay("completed", payment_date="2026-10-01", paid_amount=1000),
                "in_process", {"reason": "fecha mal"}, sa=True)
        assert r["updates"] == {"status": "in_process", "completed_by": None, "completed_at": None}

    def test_approver_is_not_enough_403(self):
        assert status_of(pay("completed"), "in_process", {"reason": "x"}, approve=True) == 403

    def test_superadmin_without_reason_400(self):
        assert status_of(pay("completed"), "in_process", sa=True) == 400


# ─── transiciones que no existen ─────────────────────────────────────────────

@pytest.mark.parametrize("current, target, expected", [
    ("new", "new", 409),
    ("new", "completed", 409),
    ("completed", "cancelled", 409),
    ("completed", "new", 409),
    ("new", "split", 400),      # estado muerto desde la 047
    ("new", "paid", 400),
])
def test_invalid_transitions(current, target, expected):
    # Con todos los derechos: el rechazo tiene que venir de la tabla, no del permiso.
    assert status_of(pay(current), target, {**PAID_ON, "reason": "x"},
                     approve=True, sa=True) == expected


# ─── helpers puros ───────────────────────────────────────────────────────────

@pytest.mark.parametrize("banking, expected", [
    (None, "missing"),
    ({}, "missing"),
    ({"tax_form_kind": "exempt"}, "exempt"),
    ({"tax_form_kind": "W-9", "tax_form_path": "x"}, "ok"),
    ({"tax_form_kind": "W-8BEN"}, "missing"),                                  # sin PDF
    ({"tax_form_path": "x"}, "missing"),                                       # sin tipo
    (BANK_OK, "ok"),
    ({**BANK_OK, "tax_form_signed_at": "2023-03-01"}, "ok"),                   # vence 31/12/2026
    ({**BANK_OK, "tax_form_signed_at": "2022-12-31"}, "expired"),              # venció 31/12/2025
    ({**BANK_OK, "tax_form_expires_at": "2026-10-13"}, "ok"),                  # vence hoy: vale
    ({**BANK_OK, "tax_form_expires_at": "2026-10-12"}, "expired"),
    ({"tax_form_kind": "W-9", "tax_form_path": "x", "tax_form_signed_at": "2000-01-01"}, "ok"),  # W-9 no vence
])
def test_tax_form_status(banking, expected):
    assert tax_form_status(banking, TODAY) == expected


def test_tax_form_expiry_w8bene():
    assert tax_form_expiry({"tax_form_kind": "W-8BEN-E", "tax_form_signed_at": "2024-05-02"}) == date(2027, 12, 31)


@pytest.mark.parametrize("banking, expected", [
    (None, False),
    ({}, False),
    ({"bank_name": "x"}, False),
    ({"account_number": "   "}, False),
    ({"account_number": "123"}, True),
    ({"iban": "ES91"}, True),
])
def test_has_bank_info(banking, expected):
    assert has_bank_info(banking) is expected


@pytest.mark.parametrize("value, expected", [
    ("ES91 2100 0418 4502 0005 1332", "****1332"),
    ("123456789", "****6789"),
    ("1234", "****"),
    ("123", "****"),
    ("", ""),
    (None, None),
])
def test_mask_value(value, expected):
    assert mask_value(value) == expected
