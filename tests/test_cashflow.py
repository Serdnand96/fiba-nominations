"""Flujo de caja por trimestre (GET /budget/cashflow).

Lo que tiene que cumplirse siempre:

  - Los cuatro trimestres suman lo mismo que los totales del Resumen: las dos
    vistas salen de `_summary_rows` y no pueden mostrar años distintos.
  - Cada matriz (departamento, competencia, cuenta) suma lo mismo que la fila
    de totales.
  - El recorte por departamento es el del Resumen: quien ve solo IT no recibe
    nada de Competitions, ni en los trimestres ni en las matrices.
"""
import io

import pytest
from openpyxl import load_workbook

from api._lib.routers import budget

BOSS = "u-boss"
FIELDS = ("executed", "committed", "revenue_received", "revenue_expected")


def _payment(pid, status, total, comp, **kw):
    return {
        "id": pid, "status": status, "total": total, "airfare": kw.pop("airfare", 0),
        "paid_amount": kw.pop("paid_amount", None),
        "department_code": kw.pop("department_code", "competitions"),
        "account_code": "COMP-11", "payment_date": kw.pop("payment_date", None),
        "nominations": {"competition_id": "c1", "personnel": {"role": "TD"}, "competitions": comp},
    }


@pytest.fixture
def year_2027(fake_db):
    """Un 2027 con gastos, pagos e ingresos repartidos en los cuatro trimestres."""
    fake_db.seed("departments", [
        {"code": "it", "label": "IT"}, {"code": "competitions", "label": "Competitions"},
    ])
    fake_db.seed("budget_lines", [
        {"id": "l1", "year": 2027, "kind": "expense", "amount": 1000.01,
         "department_code": "it", "account_code": "IT-01"},
        {"id": "l2", "year": 2027, "kind": "expense", "amount": 4000,
         "department_code": "competitions", "account_code": "COMP-11"},
        {"id": "l3", "year": 2027, "kind": "revenue", "amount": 9000,
         "department_code": "competitions", "account_code": "REV-01"},
        # Otro año: no entra.
        {"id": "l4", "year": 2026, "kind": "expense", "amount": 777,
         "department_code": "it", "account_code": "IT-01"},
    ])
    fake_db.seed("expenses", [
        # Q1: pagado en marzo.
        {"id": "e1", "amount": 40, "status": "paid", "department_code": "it",
         "account_code": "IT-01", "expense_date": "2027-03-01", "payment_date": "2027-03-05"},
        # Factura de marzo pagada en abril: el ejecutado cae en Q2.
        {"id": "e2", "amount": 25, "status": "paid", "department_code": "it",
         "account_code": "IT-01", "expense_date": "2027-03-28", "payment_date": "2027-04-02"},
        # Q2: aprobado sin pagar.
        {"id": "e3", "amount": 60, "status": "approved", "department_code": "it",
         "account_code": "IT-01", "expense_date": "2027-06-01"},
        # Borrador: no mueve plata.
        {"id": "e4", "amount": 999, "status": "draft", "department_code": "it",
         "account_code": "IT-01", "expense_date": "2027-08-01"},
    ])
    fake_db.seed("payments", [
        # Abierto de una competencia que arranca en noviembre: comprometido en Q4,
        # el fee a la cuenta de fees y el pasaje a la de travel.
        _payment("p1", "new", 500, {"year": 2027, "start_date": "2027-11-20"}, airfare=200),
        # Parcial: lo pagado en el trimestre de la fecha de pago (Q3), el resto
        # en el de la competencia (Q4).
        _payment("p2", "in_process", 300, {"year": 2027, "start_date": "2027-11-20"},
                 paid_amount=100, payment_date="2027-08-10"),
        # Completado en febrero.
        _payment("p3", "completed", 70, {"year": 2027, "start_date": "2027-02-01"},
                 payment_date="2027-02-15"),
        # Cancelado: afuera.
        _payment("p4", "cancelled", 5000, {"year": 2027, "start_date": "2027-05-01"}),
    ])
    fake_db.seed("revenues", [
        {"id": "r1", "amount": 3000, "status": "received", "department_code": "competitions",
         "account_code": "REV-01", "received_date": "2027-01-20", "expected_date": "2026-12-01"},
        {"id": "r2", "amount": 1500, "status": "expected", "department_code": "competitions",
         "account_code": "REV-01", "expected_date": "2027-09-30"},
        {"id": "r3", "amount": 800, "status": "cancelled", "department_code": "competitions",
         "account_code": "REV-01", "expected_date": "2027-05-01"},
        # Esperado para otro año.
        {"id": "r4", "amount": 600, "status": "expected", "department_code": "competitions",
         "account_code": "REV-01", "expected_date": "2028-02-01"},
    ])


@pytest.mark.parametrize("month, quarter", [
    ("2027-01", 1), ("2027-03", 1), ("2027-04", 2), ("2027-06", 2),
    ("2027-07", 3), ("2027-09", 3), ("2027-10", 4), ("2027-12", 4),
])
def test_quarter_of(month, quarter):
    assert budget._quarter_of(month) == quarter


@pytest.mark.parametrize("annual", [0, 100, 100.01, 1627431, 0.01, 0.02, 0.03, 280111.07])
def test_quarter_budget_adds_up_to_the_year(annual):
    parts = budget._quarter_budget(annual)
    assert len(parts) == 4
    assert round(sum(parts), 2) == annual
    # Ninguna parte negativa ni más de un centavo de diferencia entre ellas.
    assert min(parts) >= 0
    assert round(max(parts) - min(parts), 2) <= 0.01


def test_quarters_add_up_to_summary_totals(year_2027, make_request):
    request = make_request(BOSS, superadmin=True)
    summary = budget._summary_data(request, 2027)["totals"]
    out = budget._cashflow_data(make_request(BOSS, superadmin=True), 2027)

    assert [q["quarter"] for q in out["quarters"]] == [1, 2, 3, 4]
    for field in FIELDS:
        assert round(sum(q[field] for q in out["quarters"]), 2) == summary[field]
        assert out["totals"][field] == summary[field]
    assert out["totals"]["budgeted"] == summary["budgeted"] == 5000.01
    assert round(sum(q["budgeted"] for q in out["quarters"]), 2) == 5000.01
    assert out["totals"]["revenue_budgeted"] == summary["revenue_budgeted"] == 9000


def test_each_row_lands_in_its_quarter(year_2027, make_request):
    q1, q2, q3, q4 = budget._cashflow_data(make_request(BOSS, superadmin=True), 2027)["quarters"]

    assert q1["executed"] == 40 + 70           # e1 y p3
    assert q1["revenue_received"] == 3000      # por fecha de recepción, no la esperada
    assert q2["executed"] == 25                # e2: factura de marzo pagada en abril
    assert q2["committed"] == 60               # e3
    assert q3["executed"] == 100               # lo pagado del parcial
    assert q3["revenue_expected"] == 1500
    assert q4["committed"] == 500 + 200 + 200  # p1 (fee y pasaje) y el resto de p2
    assert q4["executed"] == 0


def test_net_and_cumulative(year_2027, make_request):
    out = budget._cashflow_data(make_request(BOSS, superadmin=True), 2027)
    q1, q2, q3, q4 = out["quarters"]

    assert q1["outflow"] == 110 and q1["inflow"] == 3000 and q1["net"] == 2890
    assert q2["net"] == -85
    assert q3["net"] == 1400
    assert q4["net"] == -900
    assert [q["net_cumulative"] for q in out["quarters"]] == [2890, 2805, 4205, 3305]
    assert out["totals"]["net"] == q4["net_cumulative"] == 3305
    # Solo lo que ya pasó por el banco: recibido menos ejecutado.
    assert out["totals"]["net_actual"] == 3000 - (40 + 25 + 100 + 70)
    assert q4["net_actual_cumulative"] == out["totals"]["net_actual"]


@pytest.mark.parametrize("matrix", ["by_department", "by_competition", "by_account"])
def test_each_matrix_adds_up_to_totals(year_2027, make_request, matrix):
    out = budget._cashflow_data(make_request(BOSS, superadmin=True), 2027)
    rows = out[matrix]
    assert rows
    for field in FIELDS:
        assert round(sum(r[field] for r in rows), 2) == out["totals"][field]
        for index, quarter in enumerate(out["quarters"]):
            assert round(sum(r["quarters"][index][field] for r in rows), 2) == quarter[field]
    assert round(sum(r["budgeted"] for r in rows), 2) == out["totals"]["budgeted"]


def test_airfare_goes_to_the_travel_account(year_2027, make_request):
    out = budget._cashflow_data(make_request(BOSS, superadmin=True), 2027)
    accounts = {r["key"]: r for r in out["by_account"]}
    travel = budget.travel_account_for_role("TD")

    assert accounts[travel]["quarters"][3]["committed"] == 200
    assert accounts["COMP-11"]["quarters"][3]["committed"] == 500 + 200
    # Los ingresos tienen su propia cuenta y no ensucian las de gasto.
    assert accounts["REV-01"]["revenue_received"] == 3000
    assert accounts["REV-01"]["executed"] == 0


def test_department_scope_is_the_summary_one(year_2027, make_request):
    access = [{"user_id": "u-it", "department_code": "it", "can_view": True, "can_edit": False}]
    out = budget._cashflow_data(make_request("u-it", budget_access=access), 2027)

    assert {r["key"] for r in out["by_department"]} == {"it"}
    assert {r["key"] for r in out["by_account"]} == {"IT-01"}
    assert out["totals"]["executed"] == 40 + 25
    assert out["totals"]["committed"] == 60
    assert out["totals"]["inflow"] == 0
    assert out["totals"]["budgeted"] == 1000.01


def test_scoped_response_carries_no_foreign_labels(year_2027, fake_db, make_request):
    # Las etiquetas se leen sin recorte (son catálogos), pero solo se usan para
    # las claves que quedaron después del recorte: en la respuesta de quien ve
    # solo IT no puede aparecer ni el nombre de otro departamento.
    fake_db.seed("accounts", [
        {"code": "IT-01", "label": "Licencias"}, {"code": "COMP-11", "label": "Honorarios TD"},
        {"code": "REV-01", "label": "Grant HQ"},
    ])
    fake_db.seed("competitions", [{"id": "c1", "name": "WCQ Window 5"}])
    access = [{"user_id": "u-it", "department_code": "it", "can_view": True, "can_edit": False}]
    out = budget._cashflow_data(make_request("u-it", budget_access=access), 2027)

    text = repr(out)
    for foreign in ("Competitions", "Honorarios TD", "Grant HQ", "WCQ Window 5", "COMP-11", "REV-01", "c1"):
        assert foreign not in text
    assert "Licencias" in text


def test_no_access_sees_nothing(year_2027, make_request):
    out = budget._cashflow_data(make_request("u-none", budget_access=[]), 2027)

    assert out["by_department"] == out["by_account"] == out["by_competition"] == []
    assert all(q["outflow"] == 0 and q["inflow"] == 0 for q in out["quarters"])


def test_requested_department_narrows_the_view(year_2027, make_request):
    out = budget._cashflow_data(make_request(BOSS, superadmin=True), 2027, "competitions")

    assert {r["key"] for r in out["by_department"]} == {"competitions"}
    assert out["totals"]["executed"] == 100 + 70


def test_export_matches_the_screen(year_2027, make_request):
    request = make_request(BOSS, superadmin=True)
    data = budget._cashflow_data(request, 2027)
    response = budget.export_cashflow(make_request(BOSS, superadmin=True), 2027, None, "es")

    assert "no-store" in response.headers["Cache-Control"]
    wb = load_workbook(io.BytesIO(response.body))
    assert wb.sheetnames == ["Por trimestre", "Por departamento", "Por competencia", "Por cuenta"]

    by_label = {row[0]: row[1:] for row in wb["Por trimestre"].iter_rows(min_row=2, values_only=True)}
    assert list(by_label["Ejecutado"]) == [q["executed"] for q in data["quarters"]] + [data["totals"]["executed"]]
    assert list(by_label["Neto"])[-1] == data["totals"]["net"]
    assert list(by_label["Neto acumulado"])[-1] is None

    # La hoja por departamento cierra con una fila de total por concepto.
    dept_rows = list(wb["Por departamento"].iter_rows(min_row=2, values_only=True))
    totals = {row[2]: row[-1] for row in dept_rows if row[0] == "Total"}
    assert totals["Ejecutado"] == data["totals"]["executed"]
    assert totals["Ingresos cobrados"] == data["totals"]["revenue_received"]
