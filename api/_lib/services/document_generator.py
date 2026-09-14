from __future__ import annotations

import functools
import logging
import os
import re
import copy
import shutil
import tempfile
import httpx
from datetime import datetime
from pathlib import Path
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn

OUTPUT_DIR = Path(tempfile.gettempdir()) / "fiba_generated"
TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent.parent / "templates"
# Free TTFs + fontconfig aliases for the letters' brand fonts (Univers, IBM
# Plex Sans, Cochocib Script, Titillium) — none of them is installed on the
# droplet. See fonts/fonts.conf for what each alias substitutes and why.
FONTS_DIR = TEMPLATES_DIR.parent / "fonts"
FONTCONFIG_FILE = FONTS_DIR / "fonts.conf"


def _sandboxed_jinja_env():
    """Entorno Jinja sandboxeado para renderizar plantillas .docx.

    Las plantillas de carta se suben por el módulo Templates (permiso
    `templates:edit`), así que son input semi-confiable. docxtpl usa Jinja2
    estándar por default, donde una expresión como
    `{{ ''.__class__.__mro__[1].__subclasses__() }}` logra RCE al renderizar.
    El SandboxedEnvironment bloquea el acceso a atributos internos y a
    callables peligrosos, cerrando el salto de "editar plantillas" a
    "ejecutar código en el droplet". Se pasa a DocxTemplate.render(jinja_env=…).
    """
    from jinja2.sandbox import SandboxedEnvironment

    return SandboxedEnvironment()

# FIBA brand colors
COLOR_DARK = RGBColor(0x2A, 0x2A, 0x2A)
COLOR_RED = RGBColor(0xED, 0x00, 0x00)

# FIBA brand fonts per template
FONT_WCQ = "IBM Plex Sans"
FONT_GENERIC = "Univers"
FONT_NAME = FONT_WCQ  # default

ROLE_LABELS = {
    "TD": "Technical Delegate",
    "VGO": "Video Graphic Operator",
    "REF": "Referee",
    "REF_INSTRUCTOR": "Referee Instructor",
    "VIDEO_OPERATOR": "Video Operator",
}


def _role_label(role: str) -> str:
    return ROLE_LABELS.get((role or "").upper(), "Technical Delegate")


CONFIRMATION_EMAIL = {
    "VGO": "vgo.americas@fiba.basketball",
    "TD": "competitions.americas@fiba.basketball",
    # Referees, instructors and video operators all confirm to the
    # Americas Referees inbox.
    "REF": "americas.refs@fiba.basketball",
    "REF_INSTRUCTOR": "americas.refs@fiba.basketball",
    "VIDEO_OPERATOR": "americas.refs@fiba.basketball",
}

SIGNATORIES = {
    "WCQ": ("Carlos Alves", "Executive Director", "FIBA Americas"),
    "GENERIC": ("Carlos Alves", "Executive Director", "FIBA Americas"),
    "BCLA": ("Gino Rullo", "Head of Operations", "Basketball Champions League Americas"),
    "BCLA_F4": ("Gino Rullo", "Head of Operations", "Basketball Champions League Americas"),
    "BCLA_RS": ("Gino Rullo", "Head of Operations", "Basketball Champions League Americas"),
    "LSB": ("Gino Rullo", "Head of Operations", "Club Competitions – FIBA Americas"),
}


def _build_doc(nomination_data: dict):
    """Dispatch to the letter builder that matches the competition's template_key."""
    template_key = nomination_data["template_key"]

    if template_key == "WCQ":
        path = template_path("WCQ")
        doc = (_render_template(path, _letter_context(nomination_data, FONT_WCQ, RED_HEX))
               if path else _build_wcq_letter(nomination_data))
    elif template_key == "GENERIC":
        path = template_path("GENERIC")
        doc = (_render_template(path, _letter_context(nomination_data, FONT_GENERIC))
               if path else _build_generic_letter(nomination_data))
    elif template_key == "BCLA":
        doc = _build_bcla(nomination_data, bcla_variant(nomination_data))
    elif template_key == "BCLA_F4":
        doc = _build_bcla(nomination_data, "F4")
    elif template_key == "BCLA_RS":
        doc = _build_bcla(nomination_data, "RS")
    elif template_key == "LSB":
        doc = _build_lsb(nomination_data)
    else:
        # A template type created from the UI: no bespoke code, just an
        # uploaded .docx plus one of the two letter shapes.
        spec = spec_for(template_key)
        path = template_path(template_key) if spec else None
        if not path:
            raise ValueError(f"Unknown template_key: {template_key}")
        doc = _render_template(path, spec["context"](nomination_data))

    return doc


def generate_nomination(nomination_data: dict) -> tuple[str, str | None, str | None]:
    """Generate a nomination/confirmation .docx letter, convert to PDF, upload.
    Returns (local_path, storage_url, conversion_error).
    """
    doc = _build_doc(nomination_data)

    # Build output filename: "Nombre Apellido Competencia Nomination"
    name_clean = re.sub(r"[^\w\s-]", "", nomination_data["nominee_name"]).strip()
    comp_clean = re.sub(r"[^\w\s-]", "", nomination_data["competition_name"]).strip()
    base_name = f"{name_clean} {comp_clean} Nomination"

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    docx_path = OUTPUT_DIR / f"{base_name}.docx"
    doc.save(str(docx_path))

    # Convert to PDF
    pdf_path, conversion_error = _convert_to_pdf(str(docx_path))
    final_path = pdf_path if pdf_path else str(docx_path)

    # Upload to Supabase Storage
    storage_url = _upload_to_storage(final_path, base_name)
    if storage_url:
        # Subida OK: OUTPUT_DIR es compartido y persistente (no un tempdir por
        # llamada), así que los locales ya no se necesitan. Sin esto se acumulan
        # dos archivos por carta —cientos por temporada— hasta llenar el disco.
        for p in {str(docx_path), final_path}:
            try:
                os.remove(p)
            except OSError:
                pass
    return final_path, storage_url, conversion_error


# ─── PREVIEW ─────────────────────────────────────────────────────────────────

# Fictional nominee/competition used to render a sample letter per template.
# Nothing here touches the DB or Storage — the preview is generated on the fly.
PREVIEW_SAMPLE = {
    "nominee_name": "John Doe",
    "role": "TD",
    "letter_date": "2026-01-15",
    "competition": "Sample Competition",
    "competition_name": "Sample Competition",
    "year": 2026,
    "location": "Buenos Aires, Argentina",
    "venue": "Estadio Obras Sanitarias",
    "arrival_date": "2026-02-10",
    "departure_date": "2026-02-16",
    "game_dates": [
        {"date": "2026-02-11", "label": "Game 1"},
        {"date": "2026-02-13", "label": "Game 2"},
        {"date": "2026-02-15", "label": "Game 3"},
    ],
    "window_fee": 500,
    "incidentals": 300,
    "total": 1800,
    "confirmation_deadline": "2026-01-25",
    "fee_type": "per_game",
    "host_city": "Buenos Aires",
    "host_country": "Argentina",
}


def validate_template(template_key: str, data: bytes) -> dict:
    """Check that an uploaded .docx can actually produce this letter.

    Returns {"ok": bool, "error": str|None, "unknown": [...], "unused": [...]}.
    `unknown` are placeholders the letter's data can't fill — they would render
    empty, so they are reported but not fatal. The real test is whether the
    template renders at all, which is what the caller then shows as a preview.
    """
    spec = spec_for(template_key)
    if not spec:
        return {"ok": False, "error": f"Unknown template: {template_key}",
                "unknown": [], "unused": []}

    sample = copy.deepcopy(PREVIEW_SAMPLE)
    sample["template_key"] = template_key
    context = spec["context"](sample)
    ctx = with_legacy_aliases(context)
    richtext_names = {name for name, value in ctx.items()
                       if type(value).__name__ == "RichText"}
    name_map = _template_name_map(context)

    tmp = Path(tempfile.mkdtemp(prefix="fiba_tplcheck_")) / "candidate.docx"
    try:
        tmp.write_bytes(data)
        try:
            tpl = LetterTemplate(str(tmp), richtext_names, name_map)
            # get_undeclared_template_variables() runs patch_xml() too (it is
            # an override on this instance), so `used` already reports
            # canonical names for a bare {{ saludo }} or {{ greeting }} alike
            # — LetterTemplate resolved both to {{r greeting }} before Jinja
            # ever parsed the file.
            used = tpl.get_undeclared_template_variables()
        except Exception as exc:
            return {"ok": False, "unknown": [], "unused": [],
                    "error": f"Not a readable .docx template: {type(exc).__name__}"}

        # A file with no placeholders at all renders perfectly — it just prints
        # whatever is typed in it, the same words for every nominee. That is a
        # letterhead, not a template, and it is the easy mistake to make: upload
        # the blank stationery instead of the tagged version. It happened, and
        # nothing caught it — the letters went out with the logo, the signature
        # and no body, with not a single error in the log. Partial use is fine
        # (WCQ and GENERIC legitimately ignore several fields); zero is not.
        if not used:
            return {"ok": False, "unknown": [], "unused": sorted(context),
                    "error": ("This file uses none of the letter's fields, so "
                              "every letter would come out with no content. It "
                              "looks like the blank letterhead rather than the "
                              "template — see this template type's field table "
                              "(GET /templates returns it as `placeholders`, and "
                              "the Templates page renders it) for what it needs.")}

        try:
            tpl.render(ctx, jinja_env=_sandboxed_jinja_env())
        except Exception as exc:
            # Jinja syntax errors and bad expressions land here.
            return {"ok": False, "unknown": [], "unused": [],
                    "error": f"Template failed to render: {exc}"}

        # Legacy and friendly names still resolve, so don't flag them as
        # unknown; but only the current names are advertised as "unused".
        known = set(ctx)
        return {
            "ok": True,
            "error": None,
            "unknown": sorted(used - known),
            "unused": sorted(set(context) - used),
        }
    finally:
        shutil.rmtree(tmp.parent, ignore_errors=True)


def generate_preview_from_bytes(template_key: str, data: bytes) -> tuple[str, str, str | None]:
    """Render a preview of an uploaded template that is not active yet."""
    spec = spec_for(template_key)
    if not spec:
        raise ValueError(f"Unknown template_key: {template_key}")

    sample = copy.deepcopy(PREVIEW_SAMPLE)
    sample["template_key"] = template_key

    temp_dir = tempfile.mkdtemp(prefix="fiba_preview_")
    src = Path(temp_dir) / "candidate.docx"
    src.write_bytes(data)

    doc = _render_template(src, spec["context"](sample))
    docx_path = Path(temp_dir) / f"{template_key}_preview.docx"
    doc.save(str(docx_path))

    pdf_path, conversion_error = _convert_to_pdf(str(docx_path))
    return (pdf_path if pdf_path else str(docx_path)), temp_dir, conversion_error


def generate_preview(template_key: str) -> tuple[str, str, str | None]:
    """Render a sample letter for `template_key` and convert it to PDF.

    Uses the same builders as the real nominations, so the preview reflects what
    a generated letter actually looks like — letterhead, footer and signature
    block included. Never uploads to Storage.

    Writes into a fresh temp dir per call rather than a shared fixed filename:
    two concurrent previews would otherwise fight over the same path, and a
    leftover file owned by another user makes every later call fail.

    Returns (local_path, temp_dir, conversion_error) — the caller owns temp_dir
    and must remove it once the response has been sent. If LibreOffice fails,
    the path is the .docx and the caller should serve it as such.
    """
    data = copy.deepcopy(PREVIEW_SAMPLE)
    data["template_key"] = template_key
    return generate_preview_for_data(data)


def generate_preview_for_data(data: dict) -> tuple[str, str, str | None]:
    """Like generate_preview(), but from real data instead of PREVIEW_SAMPLE.

    Backs `GET /templates/{key}/preview?nomination_id=...`: `data` is a real
    nomination's letter_data_for() dict (see routers/nominations.py) with
    `template_key` overridden to whatever template the caller wants to try it
    against — showing what THIS nominee's letter would look like on a
    different template, not a fictional one. Same guarantees as
    generate_preview(): nothing is uploaded to Storage and the nomination row
    is never touched.
    """
    template_key = data["template_key"]
    doc = _build_doc(data)

    temp_dir = tempfile.mkdtemp(prefix="fiba_preview_")
    docx_path = Path(temp_dir) / f"{template_key}_preview.docx"
    doc.save(str(docx_path))

    pdf_path, conversion_error = _convert_to_pdf(str(docx_path))
    return (pdf_path if pdf_path else str(docx_path)), temp_dir, conversion_error


# ─── DATE FORMATTING ─────────────────────────────────────────────────────────

def _fmt_date(date_str: str) -> str:
    """Convert ISO date (2026-04-17) to readable format (17 April 2026)."""
    if not date_str:
        return ""
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        return dt.strftime("%-d %B %Y")
    except (ValueError, TypeError):
        try:
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            return dt.strftime("%d %B %Y").lstrip("0")
        except Exception:
            return date_str


def _ordinal(day: int) -> str:
    if 11 <= day <= 13:
        return "th"
    return {1: "st", 2: "nd", 3: "rd"}.get(day % 10, "th")


def _fmt_deadline(date_str: str) -> str:
    """Format deadline: January 18th, 2026."""
    if not date_str:
        return ""
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        return dt.strftime(f"%B {dt.day}{_ordinal(dt.day)}, %Y")
    except Exception:
        return date_str


def _fmt_date_range(start_str: str, end_str: str) -> str:
    """Competition span for the tournament letter: "August 3rd to 9th, 2026".

    Collapses the month/year when shared ("August 30th to September 5th, 2026",
    "December 30th, 2026 to January 4th, 2027" otherwise). A single-day span
    prints as one date.
    """
    try:
        s = datetime.strptime(start_str, "%Y-%m-%d")
        e = datetime.strptime(end_str, "%Y-%m-%d")
    except Exception:
        return ""
    if (s.year, s.month, s.day) == (e.year, e.month, e.day):
        return f"{s.strftime('%B')} {s.day}{_ordinal(s.day)}, {s.year}"
    if (s.year, s.month) == (e.year, e.month):
        return (f"{s.strftime('%B')} {s.day}{_ordinal(s.day)} to "
                f"{e.day}{_ordinal(e.day)}, {s.year}")
    if s.year == e.year:
        return (f"{s.strftime('%B')} {s.day}{_ordinal(s.day)} to "
                f"{e.strftime('%B')} {e.day}{_ordinal(e.day)}, {s.year}")
    return (f"{s.strftime('%B')} {s.day}{_ordinal(s.day)}, {s.year} to "
            f"{e.strftime('%B')} {e.day}{_ordinal(e.day)}, {e.year}")


def _fee_label(fee_type: str | None) -> str:
    """Return the fee line label based on the competition's fee_type."""
    if (fee_type or "per_game") == "tournament":
        return "Tournament Fee"
    return "Per Game Fee"


def _fee_lines(data: dict, *, incidentals_label: str = "Incidentals",
               total_label: str = "Total") -> list[tuple[str, bool]]:
    """Build the fee block (rate, incidentals, total) honoring fee_type.

    The fee line always shows the per-game (or tournament) rate as a single
    amount. The total is computed correctly: for per_game, fee × number of
    nominated games + incidentals; for tournament, fee + incidentals.
    """
    fee_type = (data.get("fee_type") or "per_game")
    fee = data.get("window_fee") or 0
    incidentals = data.get("incidentals") or 0
    game_dates = data.get("game_dates") or []
    # NO forzar a 1: una carta per_game generada antes de que se carguen los
    # partidos (sync que no corrió, click apurado) mostraba fee × 1 —un cargo de
    # un partido, creíble y equivocado—. Con 0 partidos el total queda
    # visiblemente incompleto (solo incidentals) y delata el problema.
    num_games = len(game_dates)

    subtotal = fee * num_games if fee_type == "per_game" else fee
    total = subtotal + incidentals

    return [
        (f"{_fee_label(fee_type)}: {_fmt_money(fee)}", False),
        (f"{incidentals_label}: {_fmt_money(incidentals)}", False),
        (f"{total_label}: {_fmt_money(total)}", True),
    ]


# ─── PLACEHOLDER-BASED TEMPLATES (docxtpl) ───────────────────────────────────
#
# The older builders below address the template's paragraphs by index
# (paras[2], paras[4], …), so the .docx is really a positional skeleton: any
# file with a different paragraph layout produces garbage, and the `if idx <
# sig_start - N` guards drop content silently. Templates rendered through
# _render_template instead carry {{ placeholders }}, so the letter
# survives edits to the .docx and an uploaded file can be validated by
# rendering it.
#
# Migrated: all four — GENERIC, WCQ, BCLA and LSB. The positional builders
# below survive only as the fallback for a missing template file.

RED_HEX = "ED0000"
DARK_HEX = "2A2A2A"


def _richtext_block(lines: list[tuple[str, str, bool, int | None]], font: str):
    """One RichText spanning several `\n`-separated lines — docxtpl's
    resolve_listing() (docxtpl/template.py) turns a literal "\n" inside a
    rendered value into `<w:br/>` after render, so this prints as several
    lines inside whatever single paragraph the user put the tag in, with
    that paragraph's own alignment. That is the point of it: the equivalent
    `{%p for %}` loop needs a paragraph of its own per line and the Jinja
    syntax to go with it, which is exactly what game_list/fees_block/
    details_block exist to avoid for someone hand-editing a .docx.

    Each item is (text, color_hex, bold, size_pt_or_None). An empty `lines`
    still returns a (blank) RichText rather than "" so the field's kind is
    always "styled" — see placeholders_for().
    """
    from docxtpl import RichText

    rt = RichText()
    for i, (text, color, bold, size) in enumerate(lines):
        if i:
            rt.add("\n")
        rt.add(text, color=color, bold=bold, font=font,
                size=(size * 2) if size else None)
    return rt


def _dear_line(data: dict, font: str, size: int | None = None):
    """"Dear <name>," as one RichText — the name in red, the rest in ink.

    Mixed-ink paragraphs are assembled here rather than as
    `Dear {{r nominee }},` in the .docx: docxtpl splits the run around a
    RichText insert and the trailing text loses its explicit colour.

    `size` is in points. The nomination letters leave it unset so the run
    inherits the template default; BCLA pins its mixed runs to 10pt.
    """
    from docxtpl import RichText

    half = (size * 2) if size else None
    rt = RichText()
    rt.add("Dear ", color=DARK_HEX, font=font, size=half)
    rt.add(data.get("nominee_name", ""), color=RED_HEX, font=font, size=half)
    rt.add(",", color=DARK_HEX, font=font, size=half)
    return rt


def _letter_context(data: dict, font: str, date_color: str = DARK_HEX) -> dict:
    """Values for a placeholder template, mirroring _build_generic_letter.

    RichText carries its own colour/size, so the .docx only has to place the
    tag — it does not need to know that the fee total is bold or the nominee
    name is red.
    """
    from docxtpl import RichText

    role = data.get("role", "VGO")
    role_label = _role_label(role)

    def rich(text, color=DARK_HEX, bold=False, size=None):
        rt = RichText()
        rt.add(text, color=color, bold=bold, font=font,
               size=(size * 2) if size else None)
        return rt

    def rich_parts(*parts):
        """A whole paragraph as one RichText.

        Paragraphs that mix inks (the greeting, the confirmation line) are
        built here rather than as `text {{r tag }} text` in the .docx: docxtpl
        splits the run around a RichText insert and the trailing text comes
        back without an explicit colour, which would otherwise force us to
        repaint the document default and recolour the signature and footer.

        Each part is (text, color) or (text, color, bold).
        """
        rt = RichText()
        for part in parts:
            text, color, bold = part if len(part) == 3 else (*part, False)
            rt.add(text, color=color, font=font, bold=bold)
        return rt

    game_line_texts = []
    for gd in data.get("game_dates") or []:
        label = gd.get("label", "")
        date_val = _fmt_date(gd.get("date", ""))
        game_line_texts.append(f"{label}: {date_val}" if label else date_val)

    games = [rich(text, color=RED_HEX, bold=True, size=10)
             for text in game_line_texts]
    game_list = _richtext_block(
        [(text, RED_HEX, True, 10) for text in game_line_texts], font)

    host_city = (data.get("host_city") or "").strip()
    host_country = (data.get("host_country") or "").strip()
    host_line = ", ".join(p for p in (host_city, host_country) if p)

    comp_name = data.get("competition_name", "")

    # Tournament-fee letters mirror the letters Competitions writes by hand:
    # no per-game list — one sentence carries the venue and the competition
    # span — plus a bold subject line, the travel paragraph the manual letters
    # include, and "mission" in the closing. Per-game letters keep the game
    # list exactly as before.
    is_tournament = (data.get("fee_type") or "per_game") == "tournament"

    game_dates_sorted = sorted(
        {(gd.get("date") or "").strip() for gd in data.get("game_dates") or []
         if (gd.get("date") or "").strip()})
    span = (_fmt_date_range(game_dates_sorted[0], game_dates_sorted[-1])
            if game_dates_sorted else "")

    if is_tournament:
        intro_parts = [
            ("We would like to inform that you have been nominated for the ",
             DARK_HEX),
            (comp_name, DARK_HEX, True),
        ]
        if host_line or span:
            intro_parts.append((" to be held", DARK_HEX))
            if host_line:
                intro_parts.append((f" in {host_line}", DARK_HEX))
            if span:
                intro_parts.append((" from ", DARK_HEX))
                intro_parts.append((span, DARK_HEX, True))
        intro_parts.append((".", DARK_HEX))
        intro_paragraph = rich_parts(*intro_parts)
        confirmation_role = f"FIBA {role_label}"
        travel_paragraph = (
            "As soon as we receive your confirmation, we will make arrangements "
            "for international flights to the host country at least 3 days "
            "before the game and provide you with relevant information in order "
            "for you to prepare the game and establish contact with the Game "
            "Director of the Host National Federation. Should you have any "
            "questions regarding travel arrangements, please contact "
            "logistics.americas@fiba.basketball.")
        closing_paragraph = ("We wish you the best in your preparation and "
                             "accomplishment of your mission.")
    else:
        intro_paragraph = rich_parts(
            ("We would like to inform that you have been nominated for the "
             f"following games of the {comp_name}.", DARK_HEX))
        confirmation_role = role_label
        travel_paragraph = (
            "As soon as we receive your confirmation, we will make arrangements "
            "for international flights to the host country and provide you with "
            "relevant information in order for you to prepare the game and "
            "establish contact with the Game Director of the Host National "
            "Federation.")
        closing_paragraph = ("We wish you the best in your preparation and "
                             "accomplishment of your assignment.")

    sig_name, sig_title, sig_org = SIGNATORIES.get(
        data.get("template_key", ""), SIGNATORIES["GENERIC"])

    return {
        # WCQ prints the date in red, GENERIC in ink — hence the parameter.
        "letter_date": rich(_fmt_date(data.get("letter_date", "")),
                            color=date_color, size=10),
        # The built-in nomination templates carry a scanned signature in the
        # .docx and ignore this; an uploaded template can print it instead.
        "signature": f"{sig_name} {sig_title} {sig_org}".strip(),
        "is_tournament": is_tournament,
        # Always a RichText, even when the letter is per_game and the built-in
        # templates drop it via {%p if is_tournament %}: placeholders_for()
        # derives the tag from the sample value's type, and a plain "" here
        # would advertise {{ subject }} — which docxtpl renders EMPTY (no
        # error) the day the value is a RichText on a tournament letter.
        "subject": rich(f"Nomination for the {comp_name}", bold=True),
        "greeting": _dear_line(data, font),
        "intro_paragraph": intro_paragraph,
        "confirmation_paragraph": rich_parts(
            ("As per the FIBA Internal Regulations Book 3, please confirm to us "
             f"your availability to fulfil your assignment as {confirmation_role} by ", DARK_HEX),
            (_fmt_deadline(data.get("confirmation_deadline", "")), RED_HEX),
            (".", DARK_HEX),
            (" Confirmation shall be sent to ", DARK_HEX),
            (CONFIRMATION_EMAIL.get(role, CONFIRMATION_EMAIL["VGO"]), DARK_HEX),
            (".", DARK_HEX),
        ),
        "travel_paragraph": travel_paragraph,
        "closing_paragraph": closing_paragraph,
        "competition": comp_name,
        "competition_span": span,
        "game_dates": games,
        # Same lines as game_dates, but as one styled paragraph — for a
        # simple uploaded template that writes {{ partidos }} once instead of
        # the {%p for %} loop. See _richtext_block().
        "game_list": game_list,
        "host": rich(host_line, bold=True, size=10) if host_line else "",
        "role": role_label,
        "deadline": rich(_fmt_deadline(data.get("confirmation_deadline", "")), color=RED_HEX),
        "confirmation_email": CONFIRMATION_EMAIL.get(role, CONFIRMATION_EMAIL["VGO"]),
        "payment_lines": [rich(text, color=RED_HEX, bold=bold, size=10)
                      for text, bold in _fee_lines(data)],
        "fees_block": _richtext_block(
            [(text, RED_HEX, bold, 10) for text, bold in _fee_lines(data)], font),
    }


def _bcla_context(data: dict, variant: str, font: str) -> dict:
    """Values for the BCLA confirmation template.

    BCLA differs from the nomination letters: fees print in ink rather than
    red, dates use the "January 15th, 2026" long form, and two paragraphs are
    worded differently for the Final Four (F4) and regular season (RS)
    variants. The variant wording lives here so the .docx stays a flat
    sequence the user can edit.
    """
    from docxtpl import RichText

    role = data.get("role", "VGO")
    role_label = _role_label(role)
    comp_name = data.get("competition_name", "")
    comp_year = data.get("competition_year", "")

    def rich(text, bold=False, size=10, color=DARK_HEX):
        rt = RichText()
        rt.add(text, color=color, bold=bold, font=font, size=size * 2)
        return rt

    letter_date = data.get("letter_date", "")

    # F4 letters list the individual game dates; RS letters do not.
    games = []
    if variant == "F4":
        for gd in data.get("game_dates") or []:
            label = gd.get("label", "")
            date_val = _fmt_deadline(gd.get("date", ""))
            games.append(f"{label}: {date_val}" if label else date_val)

    if variant == "RS":
        payment_intro = (f"Below lists the details of payment you will receive as a BCL "
                         f"Americas {role_label} assigned to the games listed above. The "
                         f"distribution of this payment is as follows:")
        banking_line = ("If your banking information has recently changed, please be sure "
                        "to send this information to payments.americas@fiba.basketball.")
    else:
        payment_intro = (f"Below lists the details of payment you will receive as a BCL "
                         f"Americas {role_label} assigned to the games listed above:")
        banking_line = ("If your banking information has recently changed, please be sure "
                        "to send this information to payments.americas@fiba.basketball "
                        "before the start of the window.")

    location = (data.get("location") or "").strip()
    venue = (data.get("venue") or "").strip()
    arrival_date = _fmt_deadline(data.get("arrival_date", "")) if data.get("arrival_date") else ""
    departure_date = _fmt_deadline(data.get("departure_date", "")) if data.get("departure_date") else ""
    details_lines = [
        f"{label}: {value}" for label, value in (
            ("Location", location), ("Venue", venue),
            ("Arrival Date", arrival_date), ("Departure Date", departure_date),
        ) if value
    ]

    fee_lines = _fee_lines(data, incidentals_label="Incidentals Fee",
                            total_label="Total Fees to be received")

    return {
        "letter_date": rich(f"Miami, {_fmt_deadline(letter_date)}" if letter_date else ""),
        "heading": rich(f"BCL Americas {comp_year} – {role_label.upper()} NOMINATION",
                           bold=True, size=11),
        "greeting": _dear_line(data, font, size=10),
        "role": role_label,
        "competition": comp_name,
        "year": comp_year,
        "location": location,
        "venue": venue,
        "arrival_date": arrival_date,
        "departure_date": departure_date,
        # Plain lines, not RichText: matches the game_dates items above (the
        # F4 branch is plain text too, see BCLA_BODY's `{{ game }}` — not
        # `{{r game }}`) so a simple template gets the same visual result.
        "details_block": _richtext_block(
            [(line, DARK_HEX, False, 10) for line in details_lines], font),
        "game_dates": games,
        "game_list": _richtext_block(
            [(text, DARK_HEX, False, 10) for text in games], font),
        "payment_intro": payment_intro,
        "banking_paragraph": banking_line,
        "payment_lines": [rich(text, bold=bold) for text, bold in fee_lines],
        "fees_block": _richtext_block(
            [(text, DARK_HEX, bold, 10) for text, bold in fee_lines], font),
    }


def _lsb_context(data: dict, font: str, *, signature: bool = True) -> dict:
    """Values for the LSB confirmation template.

    Also the context of every template type created from the UI with the
    `confirmation` shape — they have no bespoke Python, they reuse this letter.

    Mirrors _build_confirmation_from_scratch: short date form, detail bullets
    that vanish when empty and game dates centred in red.

    `signature` is False for LSB itself: its letterhead carries the real
    signature block (Respectfully, + the handwritten name + the contact lines),
    so a `signature` value would only be an extra placeholder offered in the
    Templates UI for a line the letter no longer has. Custom types still get it
    — their uploaded .docx has to print a signatory from somewhere.
    """
    from docxtpl import RichText

    role = data.get("role", "VGO")
    role_label = _role_label(role)
    comp_name = data.get("competition_name", "")

    def rich(text, bold=False, color=DARK_HEX):
        rt = RichText()
        rt.add(text, color=color, bold=bold, font=font, size=20)  # 10pt
        return rt

    game_line_texts = []
    for gd in data.get("game_dates") or []:
        label = gd.get("label", "")
        date_val = _fmt_date(gd.get("date", ""))
        game_line_texts.append(f"{label}: {date_val}" if label else date_val)

    games = [rich(text, bold=True, color=RED_HEX) for text in game_line_texts]

    sig_name, sig_title, sig_org = SIGNATORIES.get("LSB", SIGNATORIES["BCLA"])

    # Líneas en blanco entre el cierre y la firma. Es lo único que decide dónde
    # cae el bloque de firma, y no puede ser fijo: esta carta mide entre ocho y
    # quince líneas según cuántos gamedays liste, y un hueco que deja bien a la
    # más corta manda a la más larga a una segunda hoja. Medido contra el
    # LibreOffice del droplet, cada gameday ocupa alrededor de línea y media de
    # las de relleno; el piso de 2 es para que la firma nunca quede pegada al
    # "Thank you".
    gap = max(2, 7 - round(1.4 * len(games)))

    location = data.get("location") or ""
    venue = data.get("venue") or ""
    arrival_date = _fmt_date(data["arrival_date"]) if data.get("arrival_date") else ""
    departure_date = _fmt_date(data["departure_date"]) if data.get("departure_date") else ""
    details_lines = [
        f"{label}: {value}" for label, value in (
            ("Location", location), ("Venue", venue),
            ("Arrival Date", arrival_date), ("Departure Date", departure_date),
        ) if value
    ]

    fee_lines = _fee_lines(data)

    context = {
        "heading": f"Confirmation – {comp_name} {data.get('competition_year', '')}",
        "greeting": _dear_line(data, font, size=10),
        "role": role_label,
        "competition": comp_name,
        "location": location,
        "venue": venue,
        "arrival_date": arrival_date,
        "departure_date": departure_date,
        "details_block": _richtext_block(
            [(line, DARK_HEX, False, 10) for line in details_lines], font),
        "game_dates": games,
        "game_list": _richtext_block(
            [(text, RED_HEX, True, 10) for text in game_line_texts], font),
        "payment_lines": [rich(text, bold=bold, color=RED_HEX)
                      for text, bold in fee_lines],
        "fees_block": _richtext_block(
            [(text, RED_HEX, bold, 10) for text, bold in fee_lines], font),
        # Solo importa el largo; el contenido de cada elemento no se imprime.
        "signature_gap": [""] * gap,
    }
    if signature:
        context["signature"] = f"{sig_name} {sig_title} {sig_org}"
    return context


def bcla_variant(data: dict) -> str:
    """F4 when the game labels are Final Four rounds, RS otherwise."""
    f4_labels = {"Semifinals", "3rd Place", "Final"}
    game_dates = data.get("game_dates") or []
    return "F4" if any(gd.get("label") in f4_labels for gd in game_dates) else "RS"


# One place that maps a template key to its file and its context builder, so
# generation, preview and upload validation can never drift apart.
TEMPLATE_SPECS = {
    "WCQ": {
        "file": "WCQ_TEMPLATE_TPL.docx",
        "context": lambda d: _letter_context(d, FONT_WCQ, RED_HEX),
    },
    "GENERIC": {
        "file": "GENERIC_TEMPLATE_TPL.docx",
        "context": lambda d: _letter_context(d, FONT_GENERIC, DARK_HEX),
    },
    "BCLA": {
        "file": "BCLA_TEMPLATE_TPL.docx",
        "context": lambda d: _bcla_context(d, bcla_variant(d), "Univers"),
    },
    "LSB": {
        "file": "LSB_TEMPLATE_TPL.docx",
        "context": lambda d: _lsb_context(d, FONT_GENERIC, signature=False),
    },
}


def custom_type(template_key: str) -> dict | None:
    """Look up a template type created from the UI, if any."""
    from api._lib.database import supabase

    try:
        rows = (supabase.table("letter_templates")
                .select("*").eq("key", template_key).execute().data)
    except Exception:
        logging.getLogger(__name__).exception(
            "Could not read letter_templates for %s", template_key)
        return None
    return rows[0] if rows else None


# Field names used before they were renamed to something readable. Kept as
# aliases so a .docx downloaded under the old names keeps working; the UI only
# ever lists the new ones.
LEGACY_FIELD_ALIASES = {
    "dear_line": "greeting",
    "confirm_line": "confirmation_paragraph",
    "confirm_email": "confirmation_email",
    "host_line": "host",
    "role_label": "role",
    "competition_name": "competition",
    "fee_lines": "payment_lines",
    "signature_line": "signature",
    "bcla_date": "letter_date",
    "bcla_title": "heading",
    "lsb_title": "heading",
    "banking_line": "banking_paragraph",
    "competition_year": "year",
}

# Spanish names for the same fields, offered so a template author never has
# to know the English field name or the {{ }}/{{r }} distinction — the {{r }}
# part is handled by LetterTemplate.patch_xml below, not by this dict, which
# only carries the name. Unlike LEGACY_FIELD_ALIASES these are advertised in
# the UI (placeholders_for()'s "aliases"), not just tolerated on upload.
FRIENDLY_ALIASES = {
    "saludo": "greeting",
    "fecha_carta": "letter_date",
    "asunto": "subject",
    "titulo": "heading",
    "competencia": "competition",
    "cargo": "role",
    "sede": "venue",
    "lugar": "location",
    "llegada": "arrival_date",
    "salida": "departure_date",
    "partidos": "game_list",
    "honorarios": "fees_block",
    "detalles": "details_block",
    "cierre": "closing_paragraph",
    "viaje": "travel_paragraph",
    "confirmacion": "confirmation_paragraph",
    "intro": "intro_paragraph",
    "firma": "signature",
    "fecha_limite": "deadline",
    "email_confirmacion": "confirmation_email",
    "anfitrion": "host",
    "periodo": "competition_span",
    "anio": "year",
    "intro_pago": "payment_intro",
    "banco": "banking_paragraph",
}


def with_legacy_aliases(context: dict) -> dict:
    out = dict(context)
    for old, new in LEGACY_FIELD_ALIASES.items():
        if new in context and old not in out:
            out[old] = context[new]
    for friendly, real in FRIENDLY_ALIASES.items():
        if real in context and friendly not in out:
            out[friendly] = context[real]
    return out


def _template_name_map(context: dict) -> dict[str, str]:
    """Every name a .docx can use for a field of `context`, mapped to its
    canonical name: the canonical name itself, plus any legacy or friendly
    alias that resolves to a field this context actually has.

    Feeds LetterTemplate, which rewrites a bare `{{ name }}` — canonical or
    aliased — to the form docxtpl needs (`{{r real }}` for a styled value,
    `{{ real }}` for a plain one) before Jinja ever parses the file.
    """
    name_map = {name: name for name in context}
    for old, new in LEGACY_FIELD_ALIASES.items():
        if new in context:
            name_map[old] = new
    for friendly, real in FRIENDLY_ALIASES.items():
        if real in context:
            name_map[friendly] = real
    return name_map


_BARE_TAG_RE = re.compile(r"\{\{\s*(\w+)\s*\}\}")

try:
    # Imported at module level (unlike the rest of this file's docxtpl uses)
    # because LetterTemplate has to subclass it. Falls back to `object` so a
    # machine without docxtpl can still import this module — only
    # instantiating LetterTemplate would fail there, same as every other
    # docxtpl-dependent function in this file already does.
    from docxtpl import DocxTemplate as _DocxTemplate
except Exception:  # pragma: no cover - docxtpl always present in prod/CI
    _DocxTemplate = object


class LetterTemplate(_DocxTemplate):
    """A DocxTemplate that accepts a bare `{{ campo }}` for styled values too.

    docxtpl normally needs `{{r campo }}` for anything that renders as
    RichText: a plain `{{ campo }}` drops the value's raw run XML inside a
    `<w:t>` text node instead of splicing it in as sibling XML, which
    corrupts the document rather than erroring. Requiring the template author
    to know in advance which fields are "styled" is exactly the "writing
    Jinja in Word" complaint — this makes the distinction the app's problem
    instead of the template author's: write `{{ campo }}` always, in English
    or through a FRIENDLY_ALIASES name, and this fixes it up before Jinja
    ever parses the file. `{{r campo }}` and `{%p for %}` loops keep working
    unchanged — this only ever adds an `r`, never removes one.

    `richtext_names` and `name_map` come from the context that will be
    rendered (see _template_name_map()), computed once per render/validation
    by the caller.
    """

    def __init__(self, path, richtext_names: set[str], name_map: dict[str, str]):
        self._richtext_names = richtext_names
        self._name_map = name_map
        super().__init__(path)

    def _rewrite_bare_tag(self, m: re.Match) -> str:
        real = self._name_map.get(m.group(1))
        if real is None:
            # Not one of ours — leave untouched. Could be a typo (comes back
            # as "unknown" from validate_template) or a deliberately raw
            # Jinja expression this app doesn't model.
            return m.group(0)
        if real in self._richtext_names:
            return "{{r " + real + " }}"
        return "{{ " + real + " }}"

    def patch_xml(self, src_xml):
        # The first two regexes of DocxTemplate.patch_xml (docxtpl 0.20.2,
        # docxtpl/template.py): they strip the XML tags Word scatters inside
        # a {{ }}/{% %}/{# #} tag when a user edits around it, so a tag typed
        # as one "word" in Word is a clean contiguous string here. Copied
        # rather than reached via super() because everything AFTER our
        # rewrite below (the {%y ... %} collapsing that turns {{r x }} into
        # the <w:r> splice) has to run on the rewritten text, not before it.
        src_xml = re.sub(
            r"(?<={)(<[^>]*>)+(?=[\{%\#])|(?<=[%\}\#])(<[^>]*>)+(?=\})",
            "",
            src_xml,
            flags=re.DOTALL,
        )

        def striptags(m):
            return re.sub(
                "</w:t>.*?(<w:t>|<w:t [^>]*>)", "", m.group(0), flags=re.DOTALL
            )

        src_xml = re.sub(
            r"{%(?:(?!%}).)*|{#(?:(?!#}).)*|{{(?:(?!}}).)*",
            striptags,
            src_xml,
            flags=re.DOTALL,
        )

        src_xml = _BARE_TAG_RE.sub(self._rewrite_bare_tag, src_xml)

        return super().patch_xml(src_xml)


def _render_template(path, context: dict):
    """Render a placeholder template file. Returns a DocxTemplate (a
    LetterTemplate, which is one), which exposes the same .save(path) as a
    Document, so the rest of the pipeline is unchanged."""
    ctx = with_legacy_aliases(context)
    richtext_names = {name for name, value in ctx.items()
                       if type(value).__name__ == "RichText"}
    tpl = LetterTemplate(str(path), richtext_names, _template_name_map(context))
    tpl.render(ctx, jinja_env=_sandboxed_jinja_env())
    return tpl


def spec_for(template_key: str) -> dict | None:
    """Resolve a key to {file, context} — built-in first, then a custom type.

    A custom type has no bespoke Python: it renders through the same context
    every other custom type does and supplies its own signatory, so the
    generator can render a key it has never seen before.

    `kind` ("nomination" or "confirmation") no longer limits which fields the
    context carries — it only picks the Word starter handed to a brand-new
    type (STARTER_FOR_KIND in routers/templates.py) and, through `font`,
    which brand font the starter and the field examples use. The context
    itself is always the union of _lsb_context's fields (location, venue,
    arrival/departure dates, details_block, heading, the LSB-shaped
    signature_gap sizing…) and _letter_context's (subject, intro_paragraph,
    travel_paragraph, confirmation_paragraph, is_tournament…), with
    _letter_context's values winning on the handful of names both share
    (greeting, competition, role, game_dates, game_list, payment_lines,
    fees_block, signature). That way an uploaded .docx can use any field
    regardless of which shape its type was created as — the old split meant
    a `nomination` type had no `location`/`venue` and a `confirmation` type
    had no `subject`/`travel_paragraph`, for no reason a template author
    could see from the UI.
    """
    built_in = TEMPLATE_SPECS.get(template_key)
    if built_in:
        return built_in

    row = custom_type(template_key)
    if not row:
        return None

    signature = " ".join(p for p in (
        row.get("signatory_name") or "",
        row.get("signatory_title") or "",
        row.get("signatory_org") or "",
    ) if p)

    # Still IBM Plex Sans for "confirmation": a custom type is not LSB. It
    # prints on its own uploaded letterhead and signs with its own
    # signatory, so the Univers swap LSB itself got doesn't apply here.
    font = FONT_WCQ if row["kind"] == "confirmation" else FONT_GENERIC

    def context(d, _sig=signature, _font=font):
        lsb_ctx = _lsb_context(d, _font)
        ctx = {**lsb_ctx, **_letter_context(d, _font)}
        ctx["heading"] = lsb_ctx["heading"]  # _letter_context has no heading
        # Not {{ signature }}: that key still exists (from _letter_context,
        # a generic FIBA Americas signatory) as a fallback for a template
        # that doesn't know about custom signatories, but a type created
        # from the UI supplies its own via signature_line — see
        # STARTER_FOR_KIND / build_confirmation_starter in
        # scripts/build_letter_templates.py for why it isn't just {{ signature }}.
        ctx["signature_line"] = _sig
        return ctx

    # Custom types have no file in the repo — theirs is always uploaded.
    return {"file": None, "context": context, "custom_type": row}


def _richtext_text(value) -> str:
    """Plain text of a RichText, for showing an example in the UI.

    Joined without a separator: the runs are consecutive pieces of one line
    ("Dear " + name + ","), so anything between them invents spacing.
    """
    return "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", getattr(value, "xml", "")))


# Field order the Templates UI shows a non-advanced field in, when it's
# present — a fixed order beats alphabetical because it reads like the
# letter itself (date, heading, greeting, body, fees, signature) rather than
# an arbitrary word list. Everything else this template key offers follows,
# alphabetically.
_PLACEHOLDER_ORDER = [
    "letter_date", "heading", "subject", "greeting", "intro_paragraph",
    "competition", "role", "host", "competition_span", "details_block",
    "location", "venue", "arrival_date", "departure_date", "game_list",
    "confirmation_paragraph", "deadline", "confirmation_email",
    "travel_paragraph", "payment_intro", "fees_block", "banking_paragraph",
    "closing_paragraph", "signature", "year",
]

# Reverse of FRIENDLY_ALIASES: canonical field name -> the Spanish names that
# resolve to it, for placeholders_for()'s "aliases".
_FRIENDLY_ALIASES_BY_FIELD: dict[str, list[str]] = {}
for _friendly_name, _real_name in FRIENDLY_ALIASES.items():
    _FRIENDLY_ALIASES_BY_FIELD.setdefault(_real_name, []).append(_friendly_name)


def placeholders_for(template_key: str) -> list[dict]:
    """What a template of this key can use, ready to show in the UI.

    Each styled or plain entry's `tag` is always the bare `{{ name }}` —
    LetterTemplate (see _render_template) upgrades it to `{{r name }}` at
    render time when the value is RichText, so the author never has to know
    which case they're in. Lists still need the `{%p for %}` loop docxtpl
    requires (`tag_extra`) and are marked `advanced`, along with
    `signature_gap`, which isn't listed at all — its length matters, not
    anything a template would print from it.

    `example` is rendered from the same sample letter used by
    generate_preview(). Anything not listed here renders empty; that's what
    upload validation warns about.
    """
    spec = spec_for(template_key)
    if not spec:
        return []
    sample = copy.deepcopy(PREVIEW_SAMPLE)
    sample["template_key"] = template_key
    try:
        context = spec["context"](sample)
    except Exception:
        logging.getLogger(__name__).exception(
            "Could not compute placeholders for %s", template_key)
        return []

    scalars = []
    lists_out = []
    for name, value in context.items():
        # Booleans (is_tournament) exist for {%p if %} branches, not to be
        # printed — advertising {{ is_tournament }} would invite a literal
        # "True"/"False" in a letter.
        if isinstance(value, bool):
            continue
        if name == "signature_gap":
            continue
        aliases = _FRIENDLY_ALIASES_BY_FIELD.get(name, [])
        if isinstance(value, list):
            first = value[0] if value else ""
            example = _richtext_text(first) if type(first).__name__ == "RichText" else str(first)
            lists_out.append({
                "name": name,
                "kind": "list",
                # One paragraph per item: the for/endfor lines disappear on render.
                "tag": "{%p for item in " + name + " %}",
                "tag_extra": ["{{r item }}", "{%p endfor %}"],
                "aliases": aliases,
                "example": example,
                "advanced": True,
            })
        elif type(value).__name__ == "RichText":
            scalars.append({
                "name": name,
                "kind": "styled",
                "tag": "{{ " + name + " }}",
                "aliases": aliases,
                "example": _richtext_text(value),
                "advanced": False,
            })
        else:
            scalars.append({
                "name": name,
                "kind": "plain",
                "tag": "{{ " + name + " }}",
                "aliases": aliases,
                "example": str(value),
                "advanced": False,
            })

    def _order(name: str) -> tuple[int, str]:
        if name in _PLACEHOLDER_ORDER:
            return (0, f"{_PLACEHOLDER_ORDER.index(name):03d}")
        return (1, name)

    scalars.sort(key=lambda item: _order(item["name"]))
    lists_out.sort(key=lambda item: item["name"])
    return scalars + lists_out


def template_path(template_key: str) -> Path | None:
    """Where to read a template from: the uploaded one wins over the repo's.

    Returns None when the key has no placeholder template at all, which sends
    the caller back to the legacy positional builder.
    """
    spec = spec_for(template_key)
    if not spec:
        return None

    from api._lib.services import template_store

    try:
        uploaded = template_store.custom_path(template_key)
    except Exception:
        # Storage being unreachable must not stop letters going out — but log
        # it, or an uploaded template silently stops being used.
        logging.getLogger(__name__).exception(
            "Could not read uploaded template for %s; using the built-in one",
            template_key)
        uploaded = None
    if uploaded:
        return uploaded

    # Types created from the UI have no file in the repo (spec["file"] is
    # None): without an upload there is nothing to render.
    if not spec.get("file"):
        return None

    built_in = TEMPLATES_DIR / spec["file"]
    return built_in if built_in.exists() else None


def _build_lsb(data: dict):
    """LSB confirmation — placeholder template if available, else the
    from-scratch builder.

    Univers because that is the letterhead's own font: the fallback below still
    writes IBM Plex Sans, but it prints on blank paper, where nothing clashes.
    """
    path = template_path("LSB")
    if path:
        return _render_template(path, _lsb_context(data, FONT_GENERIC,
                                                   signature=False))
    return _build_confirmation_from_scratch(data)


def _build_bcla(data: dict, variant: str):
    """BCLA confirmation — placeholder template if available, else the
    positional builder."""
    path = template_path("BCLA")
    if path:
        return _render_template(path, _bcla_context(data, variant, "Univers"))
    return _build_bcla_letter(data, variant=variant)



# ─── WCQ / GENERIC LETTER ────────────────────────────────────────────────────

def _build_wcq_letter(data: dict) -> Document:
    template_path = TEMPLATES_DIR / "WCQ_TEMPLATE.docx"
    if not template_path.exists():
        return _build_wcq_from_scratch(data)

    doc = Document(str(template_path))

    # Set IBM Plex Sans as the default font for the document
    for style_name in ["Normal", "Body Text", "Heading 1"]:
        try:
            doc.styles[style_name].font.name = FONT_NAME
        except Exception:
            pass

    paras = doc.paragraphs

    nominee = data.get("nominee_name", "")
    comp_name = data.get("competition_name", "")
    role = data.get("role", "VGO")
    role_label = _role_label(role)
    game_dates = data.get("game_dates") or []
    deadline = _fmt_deadline(data.get("confirmation_deadline", ""))
    letter_date = _fmt_date(data.get("letter_date", ""))

    # Clear paragraphs 1-44 (keep [0] title+logo, [45] signature image, [46] signature text)
    for i in range(1, len(paras) - 2):
        _clear_para(paras[i])

    # [1] — Letter date (right-aligned, red)
    if letter_date:
        _set_para_text(paras[1], letter_date, COLOR_RED, size=Pt(10),
                      align=WD_ALIGN_PARAGRAPH.RIGHT)

    # [2] — "Dear [Name],"
    _set_para_mixed(paras[2], [
        ("Dear ", COLOR_DARK, False),
        (nominee, COLOR_RED, False),
        (",", COLOR_DARK, False),
    ])

    # [4] — Body intro
    _set_para_text(paras[4],
        f"We would like to inform that you have been nominated for the "
        f"following games of the {comp_name}.",
        COLOR_DARK)

    # [6+] — Game dates (centered, bold, red)
    for i, gd in enumerate(game_dates):
        idx = 6 + i
        if idx < len(paras) - 3:
            label = gd.get("label", "")
            date_val = _fmt_date(gd.get("date", ""))
            text = f"{label}: {date_val}" if label else date_val
            _set_para_text(paras[idx], text, COLOR_RED, bold=True, size=Pt(10),
                          align=WD_ALIGN_PARAGRAPH.CENTER)

    # Host location — line right after the game dates (centered, dark, bold)
    host_city = (data.get("host_city") or "").strip()
    host_country = (data.get("host_country") or "").strip()
    host_line = ", ".join([p for p in (host_city, host_country) if p])
    location_idx = 6 + max(len(game_dates), 1)
    if host_line and location_idx < len(paras) - 3:
        _set_para_text(paras[location_idx], host_line, COLOR_DARK, bold=True,
                      size=Pt(10), align=WD_ALIGN_PARAGRAPH.CENTER)

    # Confirmation paragraph — 2 lines after last game date
    confirm_email = CONFIRMATION_EMAIL.get(role, CONFIRMATION_EMAIL["VGO"])
    confirm_idx = 6 + max(len(game_dates), 1) + 2
    if confirm_idx < len(paras) - 3:
        _set_para_mixed(paras[confirm_idx], [
            (f"As per the FIBA Internal Regulations Book 3, please confirm to us "
             f"your availability to fulfil your assignment as {role_label} by ",
             COLOR_DARK, False),
            (f"{deadline}", COLOR_RED, False),
            (".", COLOR_DARK, False),
            (" Confirmation shall be sent to ", COLOR_DARK, False),
            (confirm_email, COLOR_DARK, False),
        ], align=WD_ALIGN_PARAGRAPH.JUSTIFY)

    # Travel paragraph
    travel_idx = confirm_idx + 2
    if travel_idx < len(paras) - 3:
        _set_para_text(paras[travel_idx],
            "As soon as we receive your confirmation, we will make arrangements "
            "for international flights to the host country and provide you with "
            "relevant information in order for you to prepare the game and "
            "establish contact with the Game Director of the Host National Federation.",
            COLOR_DARK)

    # Payment intro
    payment_idx = travel_idx + 2
    if payment_idx < len(paras) - 3:
        _set_para_text(paras[payment_idx],
            f"Below list the details of payment you will receive as {role_label} "
            f"assigned to the competition listed above:",
            COLOR_DARK)

    # Fee items — 2 blank lines after payment intro, then the fees
    fee_idx = payment_idx + 3
    fee_items = _fee_lines(data)
    for i, (text, bold) in enumerate(fee_items):
        idx = fee_idx + i
        if idx < len(paras) - 3:
            _set_para_text(paras[idx], text, COLOR_RED, bold=bold, size=Pt(10))
            try:
                paras[idx].style = doc.styles["List Paragraph"]
            except Exception:
                pass

    # Closing — 2 blank lines after last fee
    closing_idx = fee_idx + len(fee_items) + 2
    if closing_idx < len(paras) - 3:
        _set_para_text(paras[closing_idx],
            "We wish you the best in your preparation and accomplishment of your assignment.",
            COLOR_DARK)

    # Remove excess empty paragraphs between closing and signature,
    # but keep enough so the signature sits at the bottom of the page.
    # Target: ~30 total paragraphs keeps signature near the bottom of page 1.
    keep_empty = max(0, 30 - closing_idx - 2)  # 2 = signature image + text
    remove_from = closing_idx + 1 + keep_empty
    if remove_from < len(paras) - 2:
        _remove_excess_paragraphs(doc, remove_from, len(paras) - 2)

    return doc


def _remove_excess_paragraphs(doc, start_idx, end_idx):
    """Remove empty paragraphs from start_idx to end_idx (exclusive) to compact the document."""
    body = doc.element.body
    paras = doc.paragraphs
    WP_DRAWING = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
    W_DRAWING = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}drawing'
    to_remove = []
    for i in range(end_idx - 1, start_idx - 1, -1):
        p = paras[i]
        if not p.text.strip():
            # Check for any drawing elements (images) using direct XML search
            has_drawing = (
                len(p._element.findall(f'.//{W_DRAWING}')) > 0 or
                len(p._element.findall(f'.//{WP_DRAWING}anchor')) > 0 or
                len(p._element.findall(f'.//{WP_DRAWING}inline')) > 0
            )
            if not has_drawing:
                to_remove.append(p._element)
    for elem in to_remove:
        body.remove(elem)


# ─── GENERIC LETTER (Univers Condensed font, separate template) ──────────────

def _build_generic_letter(data: dict) -> Document:
    template_path = TEMPLATES_DIR / "GENERIC_TEMPLATE.docx"
    if not template_path.exists():
        return _build_wcq_from_scratch(data)

    doc = Document(str(template_path))
    font_name = FONT_GENERIC

    # Set default font for the document
    for style_name in ["Normal", "Body Text", "Heading 1"]:
        try:
            doc.styles[style_name].font.name = font_name
        except Exception:
            pass

    paras = doc.paragraphs

    nominee = data.get("nominee_name", "")
    comp_name = data.get("competition_name", "")
    role = data.get("role", "VGO")
    role_label = _role_label(role)
    game_dates = data.get("game_dates") or []
    deadline = _fmt_deadline(data.get("confirmation_deadline", ""))
    letter_date = _fmt_date(data.get("letter_date", ""))

    # Generic template structure: [0-38] content area, [39] signature image, [40-42] sig text
    # Clear content paragraphs (preserve signature at end)
    sig_start = len(paras) - 4  # last 4 paragraphs are signature area
    for i in range(0, sig_start):
        _clear_para_generic(paras[i])

    # [0] — Letter date (right-aligned)
    if letter_date:
        _set_para_text_font(paras[0], letter_date, COLOR_DARK, font_name, size=Pt(10),
                            align=WD_ALIGN_PARAGRAPH.RIGHT)

    # [2] — "Dear [Name],"
    _set_para_mixed_font(paras[2], [
        ("Dear ", COLOR_DARK, False),
        (nominee, COLOR_RED, False),
        (",", COLOR_DARK, False),
    ], font_name)

    # [4] — Body intro
    _set_para_text_font(paras[4],
        f"We would like to inform that you have been nominated for the "
        f"following games of the {comp_name}.",
        COLOR_DARK, font_name)

    # [6+] — Game dates (centered, bold, red)
    for i, gd in enumerate(game_dates):
        idx = 6 + i
        if idx < sig_start - 10:
            label = gd.get("label", "")
            date_val = _fmt_date(gd.get("date", ""))
            text = f"{label}: {date_val}" if label else date_val
            _set_para_text_font(paras[idx], text, COLOR_RED, font_name, bold=True, size=Pt(10),
                                align=WD_ALIGN_PARAGRAPH.CENTER)

    # Host location — line right after the game dates (centered, dark, bold)
    host_city = (data.get("host_city") or "").strip()
    host_country = (data.get("host_country") or "").strip()
    host_line = ", ".join([p for p in (host_city, host_country) if p])
    location_idx = 6 + max(len(game_dates), 1)
    if host_line and location_idx < sig_start - 9:
        _set_para_text_font(paras[location_idx], host_line, COLOR_DARK, font_name,
                            bold=True, size=Pt(10), align=WD_ALIGN_PARAGRAPH.CENTER)

    # Confirmation paragraph
    confirm_email = CONFIRMATION_EMAIL.get(role, CONFIRMATION_EMAIL["VGO"])
    confirm_idx = 6 + max(len(game_dates), 1) + 2
    if confirm_idx < sig_start - 8:
        _set_para_mixed_font(paras[confirm_idx], [
            (f"As per the FIBA Internal Regulations Book 3, please confirm to us "
             f"your availability to fulfil your assignment as {role_label} by ",
             COLOR_DARK, False),
            (f"{deadline}", COLOR_RED, False),
            (".", COLOR_DARK, False),
            (" Confirmation shall be sent to ", COLOR_DARK, False),
            (confirm_email, COLOR_DARK, False),
        ], font_name, align=WD_ALIGN_PARAGRAPH.JUSTIFY)

    # Travel paragraph
    travel_idx = confirm_idx + 2
    if travel_idx < sig_start - 6:
        _set_para_text_font(paras[travel_idx],
            "As soon as we receive your confirmation, we will make arrangements "
            "for international flights to the host country and provide you with "
            "relevant information in order for you to prepare the game and "
            "establish contact with the Game Director of the Host National Federation.",
            COLOR_DARK, font_name)

    # Payment intro
    payment_idx = travel_idx + 2
    if payment_idx < sig_start - 5:
        _set_para_text_font(paras[payment_idx],
            f"Below list the details of payment you will receive as {role_label} "
            f"assigned to the competition listed above:",
            COLOR_DARK, font_name)

    # Fee items
    fee_idx = payment_idx + 3
    fee_items = _fee_lines(data)
    for i, (text, bold) in enumerate(fee_items):
        idx = fee_idx + i
        if idx < sig_start - 2:
            _set_para_text_font(paras[idx], text, COLOR_RED, font_name, bold=bold, size=Pt(10))

    # Closing
    closing_idx = fee_idx + len(fee_items) + 2
    if closing_idx < sig_start - 1:
        _set_para_text_font(paras[closing_idx],
            "We wish you the best in your preparation and accomplishment of your assignment.",
            COLOR_DARK, font_name)

    # Remove excess empty paragraphs between closing and signature
    keep_empty = max(0, 30 - closing_idx - 2)
    remove_from = closing_idx + 1 + keep_empty
    if remove_from < len(paras) - 4:
        _remove_excess_paragraphs(doc, remove_from, len(paras) - 4)

    return doc


# ─── BCLA LETTER (Univers font, BCLA template) ──────────────────────────────

def _build_bcla_letter(data: dict, variant: str = "F4") -> Document:
    template_path = TEMPLATES_DIR / "BCLA_TEMPLATE.docx"
    if not template_path.exists():
        return _build_confirmation_from_scratch(data)

    doc = Document(str(template_path))
    font_name = "Univers"

    for style_name in ["Normal", "Body Text"]:
        try:
            doc.styles[style_name].font.name = font_name
        except Exception:
            pass

    paras = doc.paragraphs

    nominee = data.get("nominee_name", "")
    comp_name = data.get("competition_name", "")
    comp_year = data.get("competition_year", "")
    role = data.get("role", "VGO")
    role_label = _role_label(role)
    game_dates = data.get("game_dates") or []
    location = data.get("location", "")
    venue = data.get("venue", "")
    arrival_date = data.get("arrival_date", "")
    departure_date = data.get("departure_date", "")
    letter_date = data.get("letter_date", "")

    # Format letter date like "Miami, March 27th, 2024"
    formatted_letter_date = ""
    if letter_date:
        formatted_letter_date = f"Miami, {_fmt_deadline(letter_date)}"

    # Clear the placeholder paragraph [4]
    _clear_para(paras[4])

    # Set date in paragraph [2] (right-aligned)
    if formatted_letter_date:
        _set_para_text_font(paras[2], formatted_letter_date, COLOR_DARK, font_name,
                            size=Pt(10), align=WD_ALIGN_PARAGRAPH.RIGHT)

    content_lines = []

    # Title
    content_lines.append({
        "text": f"BCL Americas {comp_year} – {role_label.upper()} NOMINATION",
        "bold": True, "color": COLOR_DARK, "size": Pt(11)
    })
    content_lines.append({"text": ""})

    # Dear
    content_lines.append({
        "mixed": [("Dear ", COLOR_DARK, False), (nominee, COLOR_RED, False), (",", COLOR_DARK, False)]
    })
    content_lines.append({"text": ""})

    # Confirmation body
    content_lines.append({
        "text": f"By way of this letter, we confirm your acceptance for your assignment as "
                f"{role_label} for the {comp_name} {comp_year}.",
        "color": COLOR_DARK, "align": WD_ALIGN_PARAGRAPH.JUSTIFY
    })
    content_lines.append({"text": ""})

    # Game Information
    content_lines.append({"text": "Game Information", "bold": True, "color": COLOR_DARK,
                          "align": WD_ALIGN_PARAGRAPH.JUSTIFY})
    if location:
        content_lines.append({"text": f"Location: {location}.", "color": COLOR_DARK,
                              "align": WD_ALIGN_PARAGRAPH.JUSTIFY})
    if venue:
        content_lines.append({"text": f"Venue: {venue}", "color": COLOR_DARK,
                              "align": WD_ALIGN_PARAGRAPH.JUSTIFY})
    content_lines.append({"text": ""})

    if arrival_date:
        content_lines.append({"text": f"Arrival Date: {_fmt_deadline(arrival_date)}",
                              "color": COLOR_DARK, "align": WD_ALIGN_PARAGRAPH.JUSTIFY})

    # F4 has game date rows (Semifinals, 3rd Place, Final); RS does not
    if variant == "F4":
        for gd in game_dates:
            label = gd.get("label", "")
            date_val = _fmt_deadline(gd.get("date", ""))
            text = f"{label}: {date_val}" if label else date_val
            content_lines.append({"text": text, "color": COLOR_DARK,
                                  "align": WD_ALIGN_PARAGRAPH.JUSTIFY})

    if departure_date:
        content_lines.append({"text": f"Departure Date: {_fmt_deadline(departure_date)}",
                              "color": COLOR_DARK, "align": WD_ALIGN_PARAGRAPH.JUSTIFY})

    content_lines.append({"text": ""})

    # Financial Details
    content_lines.append({"text": "Financial Details", "bold": True, "color": COLOR_DARK,
                          "align": WD_ALIGN_PARAGRAPH.JUSTIFY})

    if variant == "RS":
        content_lines.append({
            "text": f"Below lists the details of payment you will receive as a BCL Americas "
                    f"{role_label} assigned to the games listed above. The distribution of this "
                    f"payment is as follows:",
            "color": COLOR_DARK, "align": WD_ALIGN_PARAGRAPH.JUSTIFY
        })
    else:
        content_lines.append({
            "text": f"Below lists the details of payment you will receive as a BCL Americas "
                    f"{role_label} assigned to the games listed above:",
            "color": COLOR_DARK, "align": WD_ALIGN_PARAGRAPH.JUSTIFY
        })

    for line_text, line_bold in _fee_lines(data,
                                           incidentals_label="Incidentals Fee",
                                           total_label="Total Fees to be received"):
        content_lines.append({"text": line_text, "color": COLOR_DARK,
                              "bold": line_bold,
                              "align": WD_ALIGN_PARAGRAPH.JUSTIFY})
    content_lines.append({"text": ""})

    # Additional info
    content_lines.append({
        "text": "Additionally, breakfast, lunch and dinner will be provided by the club at your hotel "
                "as per the dates of your assigned games.",
        "color": COLOR_DARK, "align": WD_ALIGN_PARAGRAPH.JUSTIFY
    })
    content_lines.append({"text": ""})
    content_lines.append({
        "text": "Payment for this assignment will be made within 21-days of the window conclusion. ",
        "color": COLOR_DARK, "align": WD_ALIGN_PARAGRAPH.JUSTIFY
    })
    content_lines.append({"text": ""})

    if variant == "F4":
        content_lines.append({
            "text": "If your banking information has recently changed, please be sure to send this "
                    "information to payments.americas@fiba.basketball before the start of the window.",
            "color": COLOR_DARK, "align": WD_ALIGN_PARAGRAPH.JUSTIFY
        })
    else:
        content_lines.append({
            "text": "If your banking information has recently changed, please be sure to send this "
                    "information to payments.americas@fiba.basketball.",
            "color": COLOR_DARK, "align": WD_ALIGN_PARAGRAPH.JUSTIFY
        })

    content_lines.append({"text": ""})
    content_lines.append({
        "text": "If you have any questions, please do not hesitate to contact.",
        "color": COLOR_DARK, "align": WD_ALIGN_PARAGRAPH.JUSTIFY
    })
    content_lines.append({"text": ""})

    # Insert all content paragraphs into the document before ref_element
    # First, use paragraph [4] for the first content line
    first = content_lines[0]
    if "mixed" in first:
        _set_para_mixed_font(paras[4], first["mixed"], font_name)
    else:
        _set_para_text_font(paras[4], first.get("text", ""), first.get("color", COLOR_DARK),
                            font_name, bold=first.get("bold", False),
                            size=first.get("size"), align=first.get("align"))

    # Insert remaining content paragraphs after [4]
    from docx.oxml.ns import qn as _qn

    insert_after = paras[4]._element
    for line in content_lines[1:]:
        new_p = doc.element.makeelement(_qn('w:p'), {})
        insert_after.addnext(new_p)
        insert_after = new_p

        # Create a temporary paragraph wrapper
        from docx.text.paragraph import Paragraph
        para = Paragraph(new_p, doc)

        if line.get("align") is not None:
            para.alignment = line["align"]

        text = line.get("text", "")
        if "mixed" in line:
            for t, color, bold in line["mixed"]:
                run = para.add_run(t)
                run.font.name = font_name
                run.font.color.rgb = color
                run.bold = bold
                run.font.size = Pt(10)
        elif text:
            run = para.add_run(text)
            run.font.name = font_name
            run.font.color.rgb = line.get("color", COLOR_DARK)
            run.bold = line.get("bold", False)
            run.font.size = line.get("size", Pt(10))
        # else: empty paragraph, leave as-is

    return doc


# ─── CONFIRMATION (BCLA / LSB) FROM SCRATCH ──────────────────────────────────

def _build_confirmation_from_scratch(data: dict) -> Document:
    doc = Document()
    _apply_base_style(doc)

    nominee = data.get("nominee_name", "")
    comp_name = data.get("competition_name", "")
    role = data.get("role", "VGO")
    role_label = _role_label(role)
    tk = data.get("template_key", "BCLA")
    game_dates = data.get("game_dates") or []

    title = f"Confirmation – {comp_name}"
    if tk == "LSB":
        title += f" {data.get('competition_year', '')}"

    _add_heading(doc, title)
    _add_empty(doc)
    _add_body(doc, [("Dear ", COLOR_DARK), (nominee, COLOR_RED), (",", COLOR_DARK)])
    _add_empty(doc)
    _add_body_text(doc, f"This letter confirms your assignment as {role_label} for the {comp_name}.")
    _add_empty(doc)

    details = []
    if data.get("location"):
        details.append(f"Location: {data['location']}")
    if data.get("venue"):
        details.append(f"Venue: {data['venue']}")
    if data.get("arrival_date"):
        details.append(f"Arrival Date: {_fmt_date(data['arrival_date'])}")
    if data.get("departure_date"):
        details.append(f"Departure Date: {_fmt_date(data['departure_date'])}")
    for d in details:
        _add_body_text(doc, f"  •  {d}")
    _add_empty(doc)

    for gd in game_dates:
        label = gd.get("label", "")
        date_val = _fmt_date(gd.get("date", ""))
        text = f"{label}: {date_val}" if label else date_val
        _add_centered_red(doc, text)
    _add_empty(doc)

    _add_body_text(doc, f"Below list the details of payment you will receive as {role_label} assigned to the competition listed above:")
    _add_empty(doc)
    for line_text, line_bold in _fee_lines(data):
        _add_fee_line(doc, line_text, bold=line_bold)
    _add_empty(doc)

    _add_body_text(doc, "Thank you for your commitment and professionalism.")
    _add_empty(doc)
    _add_empty(doc)

    sig_name, sig_title, sig_org = SIGNATORIES.get(tk, SIGNATORIES["BCLA"])
    _add_body_text(doc, f"{sig_name} {sig_title} {sig_org}")

    return doc


# ─── WCQ FROM SCRATCH (fallback) ─────────────────────────────────────────────

def _build_wcq_from_scratch(data: dict) -> Document:
    doc = Document()
    _apply_base_style(doc)

    nominee = data.get("nominee_name", "")
    comp_name = data.get("competition_name", "")
    role = data.get("role", "VGO")
    role_label = _role_label(role)
    game_dates = data.get("game_dates") or []
    deadline = _fmt_deadline(data.get("confirmation_deadline", ""))

    _add_heading(doc, f"Nomination for the {comp_name}")
    _add_empty(doc)
    _add_body(doc, [("Dear ", COLOR_DARK), (nominee, COLOR_RED), (",", COLOR_DARK)])
    _add_empty(doc)
    _add_body_text(doc, f"We would like to inform that you have been nominated for the following games of the {comp_name}.")
    _add_empty(doc)

    for gd in game_dates:
        label = gd.get("label", "")
        date_val = _fmt_date(gd.get("date", ""))
        text = f"{label}: {date_val}" if label else date_val
        _add_centered_red(doc, text)

    _add_empty(doc)
    _add_empty(doc)

    confirm_email = CONFIRMATION_EMAIL.get(role, CONFIRMATION_EMAIL["VGO"])
    parts = [
        (f"As per the FIBA Internal Regulations Book 3, please confirm to us your availability to fulfil your assignment as {role_label} by ", COLOR_DARK),
        (deadline, COLOR_RED),
        (f". Confirmation shall be sent to {confirm_email}", COLOR_DARK),
    ]
    _add_body(doc, parts, align=WD_ALIGN_PARAGRAPH.JUSTIFY)
    _add_empty(doc)
    _add_body_text(doc, "As soon as we receive your confirmation, we will make arrangements for international flights to the host country and provide you with relevant information in order for you to prepare the game and establish contact with the Game Director of the Host National Federation.")
    _add_empty(doc)
    _add_body_text(doc, f"Below list the details of payment you will receive as {role_label} assigned to the competition listed above:")
    _add_empty(doc)
    _add_empty(doc)
    _add_empty(doc)

    for line_text, line_bold in _fee_lines(data):
        _add_fee_line(doc, line_text, bold=line_bold)

    _add_empty(doc)
    _add_empty(doc)
    _add_empty(doc)

    _add_body_text(doc, "We wish you the best in your preparation and accomplishment of your assignment.")
    _add_empty(doc)
    _add_empty(doc)

    sig_name, sig_title, sig_org = SIGNATORIES.get(data.get("template_key", "GENERIC"), SIGNATORIES["GENERIC"])
    _add_body_text(doc, f"{sig_name} {sig_title} {sig_org}")

    return doc


# ─── FONTS ────────────────────────────────────────────────────────────────────
#
# fonts_report() tells the Templates UI whether a .docx will actually print in
# the font it declares once LibreOffice converts it on the droplet — the
# .docx itself always shows the right font in Word, which is not the same
# question.

_RFONTS_ASCII_RE = re.compile(r'<w:rFonts\b[^>]*\bw:ascii="([^"]*)"')
_IGNORED_FONT_FAMILIES = {
    "symbol", "wingdings", "courier new", "courier", "times new roman", "",
}
# First word of the families fontconfig's 30-metric-aliases.conf resolves the
# common Microsoft/Adobe faces to. See _font_status().
_METRIC_COMPATIBLE_PREFIXES = {"Nimbus", "Liberation", "Carlito", "Caladea", "TeX"}


def _docx_declared_fonts(docx_bytes_or_path) -> list[str]:
    """Family names from `w:rFonts w:ascii` in document.xml, headers and
    footers, in first-seen order, deduplicated.

    styles.xml is deliberately NOT scanned: a letterhead carries dozens of
    latent styles (Minion Pro, Segoe UI, "FIBA"…) that no paragraph uses,
    and listing them as "missing" buries the two fonts that matter."""
    import io
    import zipfile

    if isinstance(docx_bytes_or_path, (bytes, bytearray)):
        source = io.BytesIO(docx_bytes_or_path)
    else:
        source = str(docx_bytes_or_path)

    families: list[str] = []
    try:
        with zipfile.ZipFile(source) as zf:
            names = [
                n for n in zf.namelist()
                if n == "word/document.xml"
                or re.fullmatch(r"word/(header|footer)\d*\.xml", n)
            ]
            for name in names:
                try:
                    xml = zf.read(name).decode("utf-8", errors="ignore")
                except Exception:
                    continue
                families.extend(_RFONTS_ASCII_RE.findall(xml))
    except Exception:
        logging.getLogger(__name__).exception(
            "fonts_report: could not read the .docx as a zip")
        return []

    seen: list[str] = []
    for fam in families:
        fam = (fam or "").strip()
        if not fam or fam.lower() in _IGNORED_FONT_FAMILIES:
            continue
        if fam not in seen:
            seen.append(fam)
    return seen


@functools.lru_cache(maxsize=None)
def _alias_source_families() -> frozenset[str]:
    """Family names fonts/fonts.conf declares an <alias> for (lower-cased) —
    i.e. fonts we deliberately chose a substitute for, as opposed to fonts
    fontconfig happened to fall back on."""
    import xml.etree.ElementTree as ET

    if not FONTCONFIG_FILE.exists():
        return frozenset()
    try:
        tree = ET.parse(str(FONTCONFIG_FILE))
    except Exception:
        logging.getLogger(__name__).exception(
            "_alias_source_families: could not parse fonts.conf")
        return frozenset()

    out = set()
    for alias in tree.getroot().findall("alias"):
        family = alias.find("family")
        if family is not None and (family.text or "").strip():
            out.add(family.text.strip().lower())
    return frozenset(out)


@functools.lru_cache(maxsize=None)
def _fc_match(family: str) -> str | None:
    """Raw `fc-match -f '%{family}' <family>` output, or None if fc-match
    isn't installed (a developer's Mac) — the caller turns that into
    status "unknown" rather than failing. Cached per family: cheap, not
    free, and fonts_report() is called once per template on every catalog
    load."""
    import shutil as _shutil
    import subprocess

    fc_match = _shutil.which("fc-match")
    if not fc_match:
        return None

    env = ({**os.environ, "FONTCONFIG_FILE": str(FONTCONFIG_FILE)}
           if FONTCONFIG_FILE.exists() else None)
    try:
        result = subprocess.run(
            [fc_match, "-f", "%{family}", family],
            capture_output=True, text=True, timeout=10, env=env,
        )
    except Exception:
        logging.getLogger(__name__).exception("_fc_match(%r) failed", family)
        return None
    if result.returncode != 0:
        return None
    return result.stdout.strip()


def _font_status(family: str) -> dict:
    matched = _fc_match(family)
    if matched is None:
        return {"family": family, "status": "unknown", "substitute": None}

    matched_families = [f.strip() for f in matched.split(",") if f.strip()]
    if family.lower() in {f.lower() for f in matched_families}:
        return {"family": family, "status": "ok", "substitute": None}

    substitute = matched_families[0] if matched_families else None
    if family.lower() in _alias_source_families():
        return {"family": family, "status": "substituted", "substitute": substitute}
    # fontconfig ships its own metric-compatible aliases (Arial → Liberation
    # Sans / Nimbus Sans, Helvetica → Nimbus Sans, Times New Roman → Nimbus
    # Roman…). Those print at the same widths as the original, so they are a
    # chosen substitute too, not a fallback nobody picked.
    if substitute and substitute.split(" ")[0] in _METRIC_COMPATIBLE_PREFIXES:
        return {"family": family, "status": "substituted", "substitute": substitute}
    return {"family": family, "status": "missing", "substitute": substitute}


def fonts_report(docx_bytes_or_path) -> list[dict]:
    """What a .docx will actually print as, once LibreOffice converts it on
    the droplet with fonts/fonts.conf applied.

    `docx_bytes_or_path` is either the raw bytes of a .docx (an in-flight
    upload) or a path to one on disk. Returns one entry per distinct
    declared font family:

        {"family": "Univers", "status": "substituted", "substitute": "Nimbus Sans"}

    `status` is "ok" (fc-match resolves to the same family — installed, or a
    system alias already points there), "substituted" (fonts.conf has a
    deliberate <alias> for it — the letter prints, just not in the brand
    font), "missing" (falls back to whatever fontconfig's default is, e.g.
    DejaVu Sans — nobody chose that), or "unknown" (fc-match isn't
    available, e.g. developing on a Mac; nothing was checked).
    """
    families = _docx_declared_fonts(docx_bytes_or_path)
    return [_font_status(family) for family in families]


# ─── PDF CONVERSION (CloudConvert) ───────────────────────────────────────────

def _convert_to_pdf_libreoffice(docx_path: str) -> tuple[str | None, str | None]:
    """Convert .docx to .pdf using local LibreOffice headless. Returns (pdf_path, error)."""
    import subprocess, shutil, tempfile
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return None, "LibreOffice not installed"

    pdf_path = docx_path.replace(".docx", ".pdf")
    out_dir = str(Path(docx_path).parent)
    # The droplet has none of the letters' brand fonts (Univers, IBM Plex
    # Sans, Cochocib Script, Titillium) installed system-wide, so fontconfig
    # was falling back to DejaVu Sans — wider, so titles wrapped, the
    # four-line signature block broke and the footer clipped mid-word.
    # fonts/fonts.conf aliases each brand font to a free equivalent shipped in
    # fonts/ (or to something licensed in fonts/private/, gitignored, if FIBA
    # ever hands those over); pointing LibreOffice at it via FONTCONFIG_FILE
    # scopes the substitution to this conversion only — it does not touch
    # fontconfig for the rest of the system or depend on the service user's
    # HOME. See the comment at the top of fonts/fonts.conf for the full story.
    env = {**os.environ, "FONTCONFIG_FILE": str(FONTCONFIG_FILE)} if FONTCONFIG_FILE.exists() else None
    # Use a per-call user profile to avoid concurrency lock contention
    with tempfile.TemporaryDirectory(prefix="lo-profile-") as profile_dir:
        try:
            result = subprocess.run(
                [
                    soffice, "--headless",
                    f"-env:UserInstallation=file://{profile_dir}",
                    "--convert-to", "pdf",
                    "--outdir", out_dir,
                    docx_path,
                ],
                capture_output=True, text=True, timeout=90,
                env=env,
            )
        except subprocess.TimeoutExpired:
            return None, "LibreOffice conversion timed out"
        except Exception as e:
            return None, f"LibreOffice exception: {type(e).__name__}: {e}"

    if result.returncode != 0:
        return None, f"LibreOffice failed: {result.stderr[:300] or result.stdout[:300]}"
    if not Path(pdf_path).exists():
        return None, f"LibreOffice produced no output. stdout={result.stdout[:200]}"
    return pdf_path, None


def _convert_to_pdf(docx_path: str) -> tuple[str | None, str | None]:
    """
    Convert .docx to .pdf. Prefer local LibreOffice (set USE_LOCAL_LIBREOFFICE=1).
    Falls back to CloudConvert API if local not available.
    """
    use_local = os.environ.get("USE_LOCAL_LIBREOFFICE", "").strip() in ("1", "true", "yes")
    if use_local:
        result = _convert_to_pdf_libreoffice(docx_path)
        if result[0]:
            return result
        # If local fails and CC key exists, fall through to CloudConvert
        if not os.environ.get("CLOUDCONVERT_API_KEY", "").strip():
            return result

    api_key = os.environ.get("CLOUDCONVERT_API_KEY", "").strip()
    if not api_key:
        return None, "Neither USE_LOCAL_LIBREOFFICE nor CLOUDCONVERT_API_KEY configured"

    pdf_path = docx_path.replace(".docx", ".pdf")
    base_url = "https://api.cloudconvert.com/v2"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        # Step 1: Create job with import + convert + export
        job_payload = {
            "tasks": {
                "import-file": {
                    "operation": "import/upload",
                },
                "convert-file": {
                    "operation": "convert",
                    "input": ["import-file"],
                    "output_format": "pdf",
                    "engine": "libreoffice",
                },
                "export-file": {
                    "operation": "export/url",
                    "input": ["convert-file"],
                },
            }
        }

        job_resp = httpx.post(
            f"{base_url}/jobs", json=job_payload, headers=headers, timeout=30.0
        )
        if job_resp.status_code not in (200, 201):
            err = f"Job create error {job_resp.status_code}: {job_resp.text[:300]}"
            print(f"[CLOUDCONVERT] {err}")
            return None, err

        job_data = job_resp.json()["data"]

        # Step 2: Find the upload task and upload the file
        upload_task = None
        for task in job_data["tasks"]:
            if task["name"] == "import-file" and task.get("result", {}).get("form"):
                upload_task = task
                break

        if not upload_task:
            return None, "No upload task found in job response"

        form_data = upload_task["result"]["form"]
        upload_url = form_data["url"]
        form_params = form_data["parameters"]

        with open(docx_path, "rb") as f:
            docx_bytes = f.read()

        filename = Path(docx_path).name

        # Build multipart upload
        files = {"file": (filename, docx_bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        upload_resp = httpx.post(
            upload_url, data=form_params, files=files, timeout=60.0
        )
        if upload_resp.status_code not in (200, 201, 204):
            err = f"Upload error {upload_resp.status_code}: {upload_resp.text[:200]}"
            print(f"[CLOUDCONVERT] {err}")
            return None, err

        # Step 3: Wait for job to complete (poll)
        job_id = job_data["id"]
        import time
        status_data = None
        for _ in range(30):
            time.sleep(1)
            status_resp = httpx.get(
                f"{base_url}/jobs/{job_id}", headers=headers, timeout=15.0
            )
            if status_resp.status_code != 200:
                continue
            status_data = status_resp.json()["data"]
            if status_data["status"] == "finished":
                break
            elif status_data["status"] == "error":
                err = f"Job failed: {status_data}"
                print(f"[CLOUDCONVERT] {err}")
                return None, err

        if not status_data or status_data["status"] != "finished":
            return None, f"Job timed out. Last status: {status_data.get('status') if status_data else 'unknown'}"

        # Step 4: Get export URL and download PDF
        export_task = None
        for task in status_data["tasks"]:
            if task["name"] == "export-file" and task["status"] == "finished":
                export_task = task
                break

        if not export_task or not export_task.get("result", {}).get("files"):
            return None, "No export result found"

        download_url = export_task["result"]["files"][0]["url"]
        pdf_resp = httpx.get(download_url, timeout=30.0)
        if pdf_resp.status_code == 200:
            with open(pdf_path, "wb") as f:
                f.write(pdf_resp.content)
            return pdf_path, None
        else:
            return None, f"Download error {pdf_resp.status_code}"

    except Exception as e:
        import traceback
        traceback.print_exc()
        return None, f"{type(e).__name__}: {e}"


# ─── PARAGRAPH HELPERS ───────────────────────────────────────────────────────

def _set_para_text(para, text, color, bold=False, size=None, align=None):
    _clear_para(para)
    if align is not None:
        para.alignment = align
    run = para.add_run(text)
    run.font.name = FONT_NAME
    run.font.color.rgb = color
    run.bold = bold
    if size:
        run.font.size = size


def _set_para_mixed(para, parts, align=None):
    _clear_para(para)
    if align is not None:
        para.alignment = align
    for text, color, bold in parts:
        run = para.add_run(text)
        run.font.name = FONT_NAME
        run.font.color.rgb = color
        run.bold = bold


def _clear_para(para):
    for r in para._element.findall(qn('w:r')):
        para._element.remove(r)


def _apply_base_style(doc):
    style = doc.styles["Normal"]
    style.font.name = FONT_NAME
    style.font.size = Pt(10)
    style.font.color.rgb = COLOR_DARK


def _add_heading(doc, text):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.name = FONT_NAME
    run.bold = True
    run.font.size = Pt(14)
    run.font.color.rgb = COLOR_DARK


def _add_body_text(doc, text):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.name = FONT_NAME
    run.font.size = Pt(10)
    run.font.color.rgb = COLOR_DARK


def _add_body(doc, parts, align=None):
    p = doc.add_paragraph()
    if align:
        p.alignment = align
    for text, color in parts:
        run = p.add_run(text)
        run.font.name = FONT_NAME
        run.font.size = Pt(10)
        run.font.color.rgb = color


def _add_centered_red(doc, text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = p.add_run(text)
    run.font.name = FONT_NAME
    run.bold = True
    run.font.size = Pt(10)
    run.font.color.rgb = COLOR_RED


def _add_fee_line(doc, text, bold=False):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.font.name = FONT_NAME
    run.font.size = Pt(10)
    run.font.color.rgb = COLOR_RED
    run.bold = bold


def _add_empty(doc):
    doc.add_paragraph()


def _clear_para_generic(para):
    """Clear paragraph runs (same as _clear_para but also checks for drawings to preserve)."""
    for r in para._element.findall(qn('w:r')):
        # Skip runs that contain drawing elements
        if r.findall(qn('w:drawing')):
            continue
        para._element.remove(r)


def _set_para_text_font(para, text, color, font_name, bold=False, size=None, align=None):
    _clear_para_generic(para)
    if align is not None:
        para.alignment = align
    run = para.add_run(text)
    run.font.name = font_name
    run.font.color.rgb = color
    run.bold = bold
    if size:
        run.font.size = size


def _set_para_mixed_font(para, parts, font_name, align=None):
    _clear_para_generic(para)
    if align is not None:
        para.alignment = align
    for text, color, bold in parts:
        run = para.add_run(text)
        run.font.name = font_name
        run.font.color.rgb = color
        run.bold = bold


def _fmt_money(val) -> str:
    if val is None:
        return ""
    try:
        v = float(val)
        if v == int(v):
            return f"${int(v)}"
        return f"${v:,.2f}"
    except (ValueError, TypeError):
        return str(val)


# ─── STORAGE ─────────────────────────────────────────────────────────────────

def _upload_to_storage(file_path: str, base_name: str) -> str | None:
    """Upload generated file to private Supabase Storage bucket 'nominations'.

    Uses a random UUID for the path so filenames aren't predictable from
    public information (person + competition). Returns the storage path
    (NOT a public URL); the download endpoint fetches it via authenticated
    Storage REST.
    """
    import traceback
    import uuid
    try:
        from api._lib.database import get_supabase

        client = get_supabase()
        bucket_name = "nominations"
        ext = Path(file_path).suffix
        # Random UUID-based path keeps the bucket private and unenumerable
        storage_path = f"{uuid.uuid4()}{ext}"

        with open(file_path, "rb") as f:
            file_bytes = f.read()

        content_type = "application/pdf" if ext == ".pdf" else \
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

        try:
            client.storage.from_(bucket_name).upload(
                path=storage_path,
                file=file_bytes,
                file_options={"content-type": content_type, "upsert": "true"},
            )
        except Exception:
            try:
                client.storage.from_(bucket_name).remove([storage_path])
            except Exception:
                pass
            client.storage.from_(bucket_name).upload(
                path=storage_path,
                file=file_bytes,
                file_options={"content-type": content_type},
            )

        # Return the storage path (relative to bucket). The download endpoint
        # fetches via authenticated Storage REST using service_role.
        return f"storage://nominations/{storage_path}"

    except Exception as e:
        print(f"[STORAGE ERROR] {type(e).__name__}: {e}")
        traceback.print_exc()
        return None
