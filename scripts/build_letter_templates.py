"""Build the placeholder (docxtpl) letter templates from the original .docx files.

The original templates are positional skeletons: the builders in
document_generator.py write into paras[2], paras[4], … so the file's paragraph
layout is load-bearing. This script converts them into real templates whose
body is {{ placeholders }}, keeping the letterhead, logos and signature block
of the source file untouched.

Run from the repo root:  python scripts/build_letter_templates.py
The generated *_TPL.docx files are committed. Re-run when a letterhead changes.
"""
from pathlib import Path

from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH

TEMPLATES = Path("templates")
DARK = RGBColor(0x2A, 0x2A, 0x2A)

RIGHT = WD_ALIGN_PARAGRAPH.RIGHT
CENTER = WD_ALIGN_PARAGRAPH.CENTER
JUSTIFY = WD_ALIGN_PARAGRAPH.JUSTIFY

# Body text shared by the nomination letters. Only the font, the paragraph the
# body starts at and the fee style differ between WCQ and GENERIC.
#   {{ x }}   plain value        {{r x }}  RichText (carries colour/bold)
#   {%p %}    paragraph-level Jinja tag, removed on render
def nomination_body(fee_style=None):
    return [
        # (text, align, size_pt, style)
        ("{{r letter_date }}", RIGHT, 10, None),
        ("", None, None, None),
        ("Dear {{r nominee }},", None, None, None),
        ("", None, None, None),
        ("We would like to inform that you have been nominated for the following "
         "games of the {{ competition_name }}.", None, None, None),
        ("", None, None, None),
        ("{%p for game in game_dates %}", None, None, None),
        ("{{r game }}", CENTER, 10, None),
        ("{%p endfor %}", None, None, None),
        ("{{r host_line }}", CENTER, 10, None),
        ("", None, None, None),
        ("As per the FIBA Internal Regulations Book 3, please confirm to us your "
         "availability to fulfil your assignment as {{ role_label }} by {{r deadline }}. "
         "Confirmation shall be sent to {{ confirm_email }}", JUSTIFY, None, None),
        ("", None, None, None),
        ("As soon as we receive your confirmation, we will make arrangements for "
         "international flights to the host country and provide you with relevant "
         "information in order for you to prepare the game and establish contact "
         "with the Game Director of the Host National Federation.", None, None, None),
        ("", None, None, None),
        ("Below list the details of payment you will receive as {{ role_label }} "
         "assigned to the competition listed above:", None, None, None),
        ("", None, None, None),
        ("{%p for fee in fee_lines %}", None, None, None),
        ("{{r fee }}", None, 10, fee_style),
        ("{%p endfor %}", None, None, None),
        ("", None, None, None),
        ("We wish you the best in your preparation and accomplishment of your "
         "assignment.", None, None, None),
        # Gap before the signature. The positional builders sized this
        # dynamically (`keep_empty = max(0, 30 - closing_idx - 2)`), which came
        # out to 5-7 blank lines on a typical 1-3 game letter. A declarative
        # template can't do that arithmetic, so it uses a fixed 5.
        ("", None, None, None),
        ("", None, None, None),
        ("", None, None, None),
        ("", None, None, None),
        ("", None, None, None),
    ]


SPECS = {
    "GENERIC": {
        "src": "GENERIC_TEMPLATE.docx",
        "dst": "GENERIC_TEMPLATE_TPL.docx",
        "font": "Univers",
        # Body starts at the very first paragraph: the letterhead logo lives in
        # the section header, not in the body.
        "body_start": 0,
        "body": nomination_body(),
    },
    "WCQ": {
        "src": "WCQ_TEMPLATE.docx",
        "dst": "WCQ_TEMPLATE_TPL.docx",
        "font": "IBM Plex Sans",
        # [0] is the title + competition logo — preserved as-is.
        "body_start": 1,
        "body": nomination_body(fee_style="List Paragraph"),
    },
}


def build(name, spec):
    src = TEMPLATES / spec["src"]
    doc = Document(str(src))
    font = spec["font"]

    # docxtpl splits the run holding a tag, and text trailing a {{r }} insert
    # comes back without an explicit colour. Pin the document default so
    # inherited text renders in the same ink as the explicit runs.
    for style_name in ("Normal", "Body Text", "Heading 1"):
        try:
            style = doc.styles[style_name]
            style.font.name = font
            style.font.color.rgb = DARK
        except KeyError:
            pass

    paras = doc.paragraphs

    # Find the signature block by locating its scanned image rather than using
    # a fixed offset from the end — an offset silently eats the image when a
    # letterhead gains or loses a trailing paragraph.
    images = [i for i, p in enumerate(paras) if "graphic" in p._p.xml]
    tail_images = [i for i in images if i > spec["body_start"]]
    if not tail_images:
        raise SystemExit(f"{name}: no signature image found after the body start")
    sig_start = tail_images[-1]

    body = paras[spec["body_start"]:sig_start]
    content = spec["body"]
    if len(content) > len(body):
        raise SystemExit(
            f"{name}: template too short — need {len(content)} body paragraphs, "
            f"have {len(body)}")

    for para, (text, align, size, style_name) in zip(body, content):
        for run in list(para.runs):
            run._element.getparent().remove(run._element)
        if align is not None:
            para.alignment = align
        if style_name:
            try:
                para.style = doc.styles[style_name]
            except KeyError:
                pass
        if text:
            run = para.add_run(text)
            run.font.name = font
            run.font.color.rgb = DARK
            if size:
                run.font.size = Pt(size)

    # Drop leftover empties so the signature isn't pushed to a second page —
    # the Jinja loops expand at render time instead.
    for para in body[len(content):]:
        para._element.getparent().remove(para._element)

    dst = TEMPLATES / spec["dst"]
    doc.save(str(dst))

    out = Document(str(dst))
    sig = [i for i, p in enumerate(out.paragraphs) if "graphic" in p._p.xml]
    print(f"{name}: {src.name} ({len(paras)} paras) -> {dst.name} "
          f"({len(out.paragraphs)} paras), images at {sig}")


if __name__ == "__main__":
    for name, spec in SPECS.items():
        build(name, spec)
