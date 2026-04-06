# Template configuration and constants

TEMPLATE_FILES = {
    "WCQ": "WCQ_TEMPLATE_fixed.docx",
    "BCLA": "BCL_Americas_VGO_Final4.docx",
    "LSB": "LSB_2024_VGO_Nomination.docx",
    "GENERIC": "GENERIC_TEMPLATE.docx",
}

TEMPLATE_FIELDS = {
    "WCQ": [
        "NOMINEE_NAME", "LETTER_DATE", "GAME_DATES",
        "CONFIRMATION_DEADLINE", "PER_GAME_FEE", "INCIDENTALS", "TOTAL",
    ],
    "GENERIC": [
        "NOMINEE_NAME", "LETTER_DATE", "GAME_DATES",
        "CONFIRMATION_DEADLINE", "PER_GAME_FEE", "INCIDENTALS", "TOTAL",
    ],
    "BCLA": [
        "NOMINEE_NAME", "LETTER_DATE", "COMPETITION_NAME",
        "LOCATION", "VENUE", "ARRIVAL_DATE", "GAME_DATES",
        "DEPARTURE_DATE", "WINDOW_FEE", "INCIDENTALS", "TOTAL",
    ],
    "LSB": [
        "NOMINEE_NAME", "LETTER_DATE", "COMPETITION_YEAR",
        "LOCATION", "VENUE", "ARRIVAL_DATE", "GAME_DATES",
        "DEPARTURE_DATE", "WINDOW_FEE", "INCIDENTALS", "TOTAL",
    ],
}

SIGNATORIES = {
    "WCQ": "Carlos Alves, Executive Director FIBA Americas",
    "GENERIC": "Carlos Alves, Executive Director FIBA Americas",
    "BCLA": "Gino Rullo, Head of Operations, Basketball Champions League Americas",
    "LSB": "Gino Rullo, Head of Operations, Club Competitions – FIBA Americas",
}

TEMPLATE_TYPES = {
    "WCQ": "Nominación",
    "GENERIC": "Nominación",
    "BCLA": "Confirmación",
    "LSB": "Confirmación",
}
