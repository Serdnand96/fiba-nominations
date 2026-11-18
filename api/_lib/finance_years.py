"""A qué año pertenece un pago — un solo criterio para Budget y Payments.

Antes cada router tenía su copia (`_payment_fiscal_year` en budget.py y
`_payment_year` en payments.py) y diferían en los cancelados: la cola de pagos
filtrada por año y el desglose `by_status` del dashboard no contaban lo mismo.
Vive acá, y no en uno de los dos routers, para que ninguno importe al otro.

Las funciones esperan la fila de `payments` con el embed
`nominations(competitions(year, start_date))` sin aplanar.
"""
from typing import Optional

# `split` dejó de existir en la migración 047: el pago parcial es un
# `in_process` con `paid_amount`.
OPEN_PAYMENT_STATUSES = ("new", "in_process")


def year_of(value) -> Optional[int]:
    """Año de una fecha ISO ('2026-03-01' / timestamptz), o None."""
    text = str(value or "")
    return int(text[:4]) if len(text) >= 4 and text[:4].isdigit() else None


def _competition_year(p: dict) -> Optional[int]:
    comp = ((p.get("nominations") or {}).get("competitions")) or {}
    return comp.get("year") or year_of(comp.get("start_date"))


def payment_fiscal_year(p: dict) -> Optional[int]:
    """A qué año del presupuesto se imputa un pago. None = a ninguno.

    - `completed` → el año de `payment_date`, que es cuando salió la plata. Si
      no tiene fecha, cae al año de la competencia: antes un completado sin
      fecha desaparecía de TODOS los años.
    - abierto (`new` / `in_process`) → el año de la competencia, que es contra
      qué presupuesto compromete.
    - cualquier otro estado → no cuenta.

    El año de la competencia es `competitions.year`, y si falta, el de
    `start_date`.
    """
    comp_year = _competition_year(p)
    status = p.get("status")
    if status == "completed":
        return year_of(p.get("payment_date")) or comp_year
    if status in OPEN_PAYMENT_STATUSES:
        return comp_year
    return None


def payment_status_year(p: dict) -> Optional[int]:
    """Año en el que un pago se LISTA: `by_status` del summary y la cola.

    Para los estados que imputan es el de payment_fiscal_year. Un `cancelled`
    no imputa a ningún año, pero listado sí tiene que aparecer: va al año de su
    `payment_date` y, si no tiene, al de la competencia. Si tampoco hay
    competencia con año, no aparece en ninguno.
    """
    fiscal = payment_fiscal_year(p)
    if fiscal is not None:
        return fiscal
    return year_of(p.get("payment_date")) or _competition_year(p)
