"""Audiencias de Logística: la división staff / delegación / VIP.

Logística pidió separar las tres secciones del módulo (transporte, hospedaje,
travel manifest) según a quién le sirven. No es un dato nuevo: sale de la
categoría que el padrón ya guarda en `logistics_participants.category`.

    staff       → oficiales (TDs, árbitros) y staff FIBA
    delegation  → equipos
    vip         → VIPs e invitados

Vive en un módulo aparte porque lo usan el router, el importador de planillas y
la vista pública, y el importador ya importa del router de forma diferida.
"""
from typing import Optional

from fastapi import HTTPException

AUDIENCES = {
    "staff": ("official", "fiba_staff"),
    "delegation": ("team",),
    "vip": ("vip", "guest"),
}

# Categoría con la que entra una fila importada desde la pestaña de una
# audiencia cuando la planilla no dice nada que la clasifique.
_DEFAULT_CATEGORY = {"staff": "official", "delegation": "team", "vip": "vip"}


def categories_for(audience: Optional[str]) -> Optional[tuple]:
    """Categorías de una audiencia. `None` = sin filtro (todo el padrón)."""
    if not audience:
        return None
    if audience not in AUDIENCES:
        raise HTTPException(400, f"audience must be one of {', '.join(AUDIENCES)}")
    return AUDIENCES[audience]


def check_audience(audience: Optional[str]) -> Optional[str]:
    """Valida una audiencia que se GUARDA en una fila (hotel, contacto, salón).

    '' y None son lo mismo: NULL = "compartido por todas las audiencias". Una
    audiencia desconocida es 400, no un NULL silencioso.
    """
    audience = (audience or "").strip()
    if not audience:
        return None
    categories_for(audience)  # valida
    return audience


def for_audience(rows: list[dict], audience: Optional[str]) -> list[dict]:
    """Filas de `audience` más las compartidas (audience NULL).

    Se filtra en Python y no con `.or_()`: es lo que usan hoteles, contactos y
    salones, y el fake de los tests no soporta `.or_`. Sin audiencia no recorta.
    """
    audience = check_audience(audience)
    if not audience:
        return rows
    return [r for r in rows if r.get("audience") in (None, audience)]


def audience_of(category: Optional[str]) -> str:
    for audience, categories in AUDIENCES.items():
        if category in categories:
            return audience
    return "staff"


def apply_default_category(rows: list[dict], audience: Optional[str]) -> None:
    """Reclasifica solo lo que la planilla dejó sin clasificar.

    `categorize()` devuelve 'official' tanto para un TD como para un cargo que
    no reconoce. Importando desde Delegación o VIP ese fallback pasa a ser la
    categoría de la pestaña — salvo que la fila haya matcheado contra
    `personnel` / `employees`, que es una señal más fuerte que la pestaña.
    """
    categories_for(audience)  # valida
    default = _DEFAULT_CATEGORY.get(audience or "staff", "official")
    if default == "official":
        return
    for row in rows:
        matched = (row.get("match") or {}).get("status") == "matched"
        if row.get("category") in (None, "official") and not matched:
            row["category"] = default
