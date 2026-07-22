"""FIBA Americas country codes — Python mirror of src/lib/countries.js.

Used by the referee-neutrality check in the games router to resolve a
person's country (explicit ``country_code`` or legacy free-text ``country``)
and a game's teams to comparable FIBA codes.
"""
import unicodedata

# code → (english name, spanish name)
COUNTRIES = {
    "ARG": ("Argentina", "Argentina"),
    "ARU": ("Aruba", "Aruba"),
    "BAH": ("Bahamas", "Bahamas"),
    "BAR": ("Barbados", "Barbados"),
    "BIZ": ("Belize", "Belice"),
    "BER": ("Bermuda", "Bermudas"),
    "BOL": ("Bolivia", "Bolivia"),
    "BRA": ("Brazil", "Brasil"),
    "IVB": ("British Virgin Islands", "Islas Vírgenes Británicas"),
    "CAN": ("Canada", "Canadá"),
    "CAY": ("Cayman Islands", "Islas Caimán"),
    "CHI": ("Chile", "Chile"),
    "COL": ("Colombia", "Colombia"),
    "CRC": ("Costa Rica", "Costa Rica"),
    "CUB": ("Cuba", "Cuba"),
    "DMA": ("Dominica", "Dominica"),
    "DOM": ("Dominican Republic", "República Dominicana"),
    "ECU": ("Ecuador", "Ecuador"),
    "ESA": ("El Salvador", "El Salvador"),
    "GRN": ("Grenada", "Granada"),
    "GUA": ("Guatemala", "Guatemala"),
    "GUY": ("Guyana", "Guyana"),
    "HAI": ("Haiti", "Haití"),
    "HON": ("Honduras", "Honduras"),
    "JAM": ("Jamaica", "Jamaica"),
    "MEX": ("Mexico", "México"),
    "NCA": ("Nicaragua", "Nicaragua"),
    "PAN": ("Panama", "Panamá"),
    "PAR": ("Paraguay", "Paraguay"),
    "PER": ("Peru", "Perú"),
    "PUR": ("Puerto Rico", "Puerto Rico"),
    "SKN": ("Saint Kitts and Nevis", "San Cristóbal y Nieves"),
    "LCA": ("Saint Lucia", "Santa Lucía"),
    "VIN": ("Saint Vincent and the Grenadines", "San Vicente y las Granadinas"),
    "SUR": ("Suriname", "Surinam"),
    "TTO": ("Trinidad and Tobago", "Trinidad y Tobago"),
    "TCA": ("Turks and Caicos Islands", "Islas Turcas y Caicos"),
    "USA": ("United States", "Estados Unidos"),
    "ISV": ("US Virgin Islands", "Islas Vírgenes de EE. UU."),
    "URU": ("Uruguay", "Uruguay"),
    "VEN": ("Venezuela", "Venezuela"),
}


def normalize_name(name: str | None) -> str:
    if not name:
        return ""
    decomposed = unicodedata.normalize("NFD", name.lower())
    return "".join(c for c in decomposed if unicodedata.category(c) != "Mn").strip()


_NAME_TO_CODE: dict[str, str] = {}
for _code, (_en, _es) in COUNTRIES.items():
    _NAME_TO_CODE[normalize_name(_en)] = _code
    _NAME_TO_CODE[normalize_name(_es)] = _code


def name_to_code(name: str | None) -> str | None:
    """Free text ("Brasil", "brazil ", "COL") → FIBA code, or None."""
    if not name:
        return None
    upper = name.strip().upper()
    if upper in COUNTRIES:
        return upper
    return _NAME_TO_CODE.get(normalize_name(name))


def person_country_code(person: dict) -> str | None:
    """Explicit country_code first, then the legacy free-text country field."""
    if not person:
        return None
    code = (person.get("country_code") or "").strip().upper()
    if code:
        return code
    return name_to_code(person.get("country"))


def game_country_codes(game: dict) -> set[str]:
    """FIBA codes of the two teams: explicit codes, else mapped from names."""
    codes: set[str] = set()
    for code_field, name_field in (("team_a_code", "team_a"), ("team_b_code", "team_b")):
        code = (game.get(code_field) or "").strip().upper() or name_to_code(game.get(name_field))
        if code:
            codes.add(code)
    return codes


def country_display_name(code: str | None, lang: str = "es") -> str:
    if not code:
        return ""
    names = COUNTRIES.get(code.upper())
    if not names:
        return code
    return names[0] if lang == "en" else names[1]
