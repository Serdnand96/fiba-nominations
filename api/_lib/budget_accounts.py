"""Cuentas del presupuesto que le corresponden a un pago, según el rol.

Vive fuera de los routers porque lo usan los dos lados del circuito y tienen
que decir lo mismo:

  - `payments.py` (write path) imputa el pago al crearlo.
  - `budget.py`   (read path)  reparte el pasaje al sumar el ejecutado.

El plan de cuentas de Competitions viene apareado fee/travel por rol, así que
el destino del pasaje no hay que inventarlo. Un pago aporta DOS imputaciones
distintas: el fee (`total` = amount + extra) a la cuenta de fees y el pasaje
(`airfare`, migración 013) a la de travel. Cargar el pasaje a la cuenta del fee
infla una línea y deja la otra en cero para siempre.

⚠️ Los códigos `COMP-*` son provisorios (`accounts.pending_mapping`) hasta que
Finance entregue el plan de cuentas oficial. Cuando se renombren hay que tocar
este archivo: el `ON UPDATE CASCADE` arregla las filas ya escritas, estos dicts
no se enteran.
"""
from typing import Optional

# Rol de `personnel` → cuenta del fee.
ACCOUNT_BY_ROLE = {
    "TD":             "COMP-11",   # Technical Delegate Fees
    "VGO":            "COMP-13",   # TV Graphics Operator Fees
    "REF":            "COMP-10",   # Referees Fees
    "REF_INSTRUCTOR": "COMP-08",   # Referee Instructor / Commissioners Fees
}

# Rol de `personnel` → cuenta del pasaje. Mismo orden que arriba.
TRAVEL_ACCOUNT_BY_ROLE = {
    "TD":             "COMP-12",   # Technical Delegate Travel Expense
    "VGO":            "COMP-14",   # TV Graphics Operator Travel Expenses
    "REF":            "COMP-07",   # Referees Travel Expense
    "REF_INSTRUCTOR": "COMP-09",   # Referee Instructor / Commissioners Travel Expense
}


def account_for_role(role: Optional[str]) -> Optional[str]:
    """Cuenta de fees del rol, o None si no está mapeado (queda sin imputar)."""
    return ACCOUNT_BY_ROLE.get(role or "")


def travel_account_for_role(role: Optional[str]) -> Optional[str]:
    """Cuenta de travel del rol, o None si no está mapeado."""
    return TRAVEL_ACCOUNT_BY_ROLE.get(role or "")
