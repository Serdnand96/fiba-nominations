"""A qué año del presupuesto cae cada pago e ingreso, y en qué balde.

`/budget/summary` filtra por año en Python con estas tres funciones puras
(budget.py). Antes un `completed` sin fecha desaparecía de todos los años y un
`new` contaba como comprometido en cualquier año consultado.
"""
import pytest

from api._lib.routers.budget import _payment_buckets, _payment_fiscal_year, _revenue_year


def payment(status, payment_date=None, year=None, start_date=None, **kw):
    return {"status": status, "payment_date": payment_date,
            "nominations": {"competitions": {"year": year, "start_date": start_date}}, **kw}


@pytest.mark.parametrize("row, expected", [
    # completed → año de payment_date, aunque la competencia sea de otro año
    (payment("completed", "2026-05-01", year=2027), 2026),
    (payment("completed", "2026-12-31T23:00:00+00:00", year=2027), 2026),
    # completed sin fecha → cae al año de la competencia (antes desaparecía)
    (payment("completed", None, year=2027), 2027),
    (payment("completed", None, start_date="2025-11-20"), 2025),
    # abierto → año de la competencia, aunque tenga una fecha cargada
    (payment("new", "2026-01-01", year=2027), 2027),
    (payment("in_process", None, year=2026), 2026),
    (payment("in_process", None, start_date="2026-02-01"), 2026),
    # competitions.year gana sobre start_date
    (payment("new", None, year=2027, start_date="2026-12-15"), 2027),
    # no cuentan
    (payment("cancelled", "2026-05-01", year=2027), None),
    (payment("split", None, year=2026), None),        # estado muerto desde la 047
    ({"status": "new", "nominations": None}, None),   # sin competencia → sin año
    (payment("completed", None), None),               # completed sin fecha ni competencia
])
def test_payment_fiscal_year(row, expected):
    assert _payment_fiscal_year(row) == expected


@pytest.mark.parametrize("row, expected", [
    ({"status": "received", "received_date": "2026-03-01", "expected_date": "2027-01-01"}, 2026),
    ({"status": "expected", "received_date": None, "expected_date": "2027-01-01"}, 2027),
    ({"status": "expected"}, None),                          # esperado sin fecha → afuera
    ({"status": "received", "expected_date": "2026-01-01"}, None),
    ({"status": "cancelled", "expected_date": "2026-01-01"}, None),
])
def test_revenue_year(row, expected):
    assert _revenue_year(row) == expected


@pytest.mark.parametrize("status, amount, paid_amount, expected", [
    ("completed", 1000, None, (1000.0, 0.0)),     # todo ejecutado
    ("completed", 1000, 300, (1000.0, 0.0)),      # paid_amount no recorta un completed
    ("in_process", 1000, 300, (300.0, 700.0)),    # parcial: reparte
    ("in_process", 1000, 5000, (1000.0, 0.0)),    # tope en el monto
    ("in_process", 1000, -50, (0.0, 1000.0)),     # piso en cero
    ("in_process", 1000, None, (0.0, 1000.0)),
    ("new", 1000, 300, (0.0, 1000.0)),            # new no lee paid_amount
    ("cancelled", 1000, 300, (0.0, 0.0)),
    ("split", 1000, None, (0.0, 0.0)),
    ("completed", None, None, (0.0, 0.0)),
])
def test_payment_buckets(status, amount, paid_amount, expected):
    assert _payment_buckets(status, amount, paid_amount) == expected
