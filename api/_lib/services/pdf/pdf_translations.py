"""
Central translation table for PDF templates.

Short labels and headings live here; long prose (nomination letter bodies)
stays inline in the template because it varies per template_type and is
written as a block by subject matter, not as atomic strings.

Adding a new language: add a second-level key to every entry in STRINGS.
Missing translations fall back to English to avoid rendering raw keys.
"""

from __future__ import annotations

DEFAULT_LANGUAGE = "en"

STRINGS: dict[str, dict[str, str]] = {
    # base.html
    "footer.confidential": {"en": "Confidential", "es": "Confidencial"},
    "footer.page": {"en": "Page", "es": "Página"},

    # shared labels
    "label.competition": {"en": "Competition:", "es": "Competencia:"},
    "label.country": {"en": "Country", "es": "País"},
    "label.country_colon": {"en": "Country:", "es": "País:"},
    "label.date": {"en": "Date:", "es": "Fecha:"},
    "label.dates": {"en": "Dates:", "es": "Fechas:"},
    "label.location": {"en": "Location:", "es": "Sede:"},
    "label.role": {"en": "Role:", "es": "Rol:"},

    # nomination_letter.html
    "nomination.title": {"en": "Nomination Letter", "es": "Carta de Nominación"},
    "nomination.greeting": {"en": "Dear", "es": "Estimado/a"},
    "nomination.closing": {"en": "Sincerely,", "es": "Atentamente,"},
    "nomination.nominee": {"en": "Nominee:", "es": "Nominado/a:"},

    # training_schedule.html
    "training.title": {"en": "Training Schedule", "es": "Cronograma de Entrenamientos"},
    "training.filter_daily": {"en": "Daily", "es": "Diario"},
    "training.filter_team": {"en": "By Team", "es": "Por Equipo"},
    "training.filter_full": {"en": "Full Schedule", "es": "Completo"},
    "training.filter": {"en": "Filter:", "es": "Filtro:"},
    "training.total_slots": {"en": "Total slots:", "es": "Total de slots:"},
    "training.col_date": {"en": "Date", "es": "Fecha"},
    "training.col_start": {"en": "Start", "es": "Inicio"},
    "training.col_end": {"en": "End", "es": "Fin"},
    "training.col_venue": {"en": "Venue", "es": "Cancha"},
    "training.col_team": {"en": "Team", "es": "Equipo"},
    "training.col_tds": {"en": "Assigned TDs", "es": "TDs Asignados"},
    "training.empty": {
        "en": "No training slots to display.",
        "es": "No hay slots de entrenamiento para mostrar.",
    },

    # availability_report.html
    "availability.header": {
        "en": "Availability Report", "es": "Reporte de Disponibilidad",
    },
    "availability.title": {
        "en": "TD Availability Report",
        "es": "Reporte de Disponibilidad de TDs",
    },
    "availability.total_tds": {"en": "Total TDs:", "es": "Total de TDs:"},
    "availability.available_count": {"en": "Available:", "es": "Disponibles:"},
    "availability.col_td": {"en": "Technical Delegate", "es": "Delegado Técnico"},
    "availability.col_status": {"en": "Status", "es": "Estado"},
    "availability.col_notes": {"en": "Notes", "es": "Notas"},
    "availability.status_available": {"en": "Available", "es": "Disponible"},
    "availability.status_unavailable": {"en": "Unavailable", "es": "No disponible"},
    "availability.status_restricted": {"en": "Restricted", "es": "Con restricciones"},
    "availability.status_nodata": {"en": "No data", "es": "Sin datos"},
    "availability.empty": {
        "en": "No availability data found.",
        "es": "No hay datos de disponibilidad.",
    },

    # generic_table.html
    "generic.empty": {"en": "No data to display.", "es": "No hay datos para mostrar."},
}


def t(key: str, language: str = DEFAULT_LANGUAGE) -> str:
    """Look up a translation, falling back to English then to the key itself."""
    entry = STRINGS.get(key)
    if entry is None:
        return key
    return entry.get(language) or entry.get(DEFAULT_LANGUAGE) or key
