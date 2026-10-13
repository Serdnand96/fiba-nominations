"""
Historial de estados de gastos y pagos (tabla `finance_status_history`,
migración 046).

Regla del área de finanzas: el `status` de un gasto (`expenses`) o de un pago
(`payments`) NUNCA se edita por PATCH/PUT. Solo cambia por
`POST /{id}/transition`, que valida la transición contra la máquina de estados
y, si la aplica, llama a `record_transition()` para dejar la traza: de qué
estado a cuál, quién, cuándo, con qué motivo y con qué contexto (`meta`).

Esta tabla ES la traza. El `activity_log` (services/activity_log.py) registra
método + path + id, pero no guarda bodies, así que no puede responder "¿quién
lo aprobó y por qué?". Para eso está esto.

Convenciones de `meta`:
  - {"override": True} → un superadmin aprobó/completó algo creado por él
    mismo (separación de funciones salteada con `reason` obligatorio).
  - {"bulk": True}     → el cambio vino de una acción en lote.
  - Cualquier otro dato útil de la transición (payment_date, paid_amount…).

Best-effort, igual que `record_activity()`: si el insert falla, se loguea un
warning y el request sigue. El estado ya se aplicó; perder una fila de historial
es preferible a devolverle un 500 al usuario por un cambio que sí ocurrió.

La autorización NO vive acá: quien llama (el router) ya chequeó permisos y, para
`history_for()`, que el caller pueda ver la entidad (p. ej. `_scoped()` en
budget.py antes de devolver el historial de un gasto).
"""
import logging
from typing import Optional

from fastapi import Request

from api._lib.database import supabase

logger = logging.getLogger(__name__)

ENTITY_TYPES = ("expense", "payment")


def _caller(request: Optional[Request]) -> tuple[Optional[str], Optional[str]]:
    """(id, email) del usuario autenticado, desde request.state.user."""
    user = getattr(getattr(request, "state", None), "user", None)
    if isinstance(user, dict):
        return user.get("id"), user.get("email")
    return None, None


def record_transition(
    entity_type: str,
    entity_id: str,
    from_status: Optional[str],
    to_status: str,
    request: Optional[Request],
    reason: Optional[str] = None,
    meta: Optional[dict] = None,
) -> None:
    """Inserta una fila de historial. Nunca lanza.

    `from_status` es None en el alta (no había estado anterior).
    """
    if entity_type not in ENTITY_TYPES:
        logger.warning("[finance_history] entity_type inválido: %r", entity_type)
        return
    user_id, user_email = _caller(request)
    try:
        supabase.table("finance_status_history").insert({
            "entity_type": entity_type,
            "entity_id": str(entity_id),
            "from_status": from_status,
            "to_status": to_status,
            "changed_by": user_id,
            "changed_by_email": user_email,
            "reason": (reason or "").strip() or None,
            "meta": meta or None,
        }).execute()
    except Exception as exc:
        logger.warning(
            "[finance_history] insert failed (%s %s %s→%s): %s",
            entity_type, entity_id, from_status, to_status, exc,
        )


def history_for(entity_type: str, entity_id: str) -> list:
    """Historial de una entidad, del cambio más reciente al más viejo."""
    if entity_type not in ENTITY_TYPES:
        return []
    return supabase.table("finance_status_history").select("*") \
        .eq("entity_type", entity_type) \
        .eq("entity_id", str(entity_id)) \
        .order("changed_at", desc=True) \
        .execute().data or []
