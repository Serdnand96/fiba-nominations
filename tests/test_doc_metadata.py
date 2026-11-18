"""Los documentos que salen del sistema no firman como la librería que los armó."""
import io
import zipfile

from docx import Document
from openpyxl import Workbook

from api._lib.services.doc_metadata import ORG_AUTHOR, set_docx_metadata
from api._lib.services.xlsx_utils import workbook_bytes


def _core(data: bytes) -> str:
    return zipfile.ZipFile(io.BytesIO(data)).read("docProps/core.xml").decode()


def test_docx_metadata_replaces_python_docx_defaults():
    doc = set_docx_metadata(Document(), "Información operativa")
    buf = io.BytesIO()
    doc.save(buf)
    core = _core(buf.getvalue())
    assert f"<dc:creator>{ORG_AUTHOR}</dc:creator>" in core
    assert f"<cp:lastModifiedBy>{ORG_AUTHOR}</cp:lastModifiedBy>" in core
    assert "<dc:title>Información operativa</dc:title>" in core
    assert "python-docx" not in core and "2013" not in core


def test_docx_metadata_clips_long_title():
    doc = set_docx_metadata(Document(), "A" * 400)
    assert len(doc.core_properties.title) <= 255


def test_workbook_bytes_sets_author():
    core = _core(workbook_bytes(Workbook(), "Rooming list"))
    # openpyxl declara el namespace en cada elemento: <dc:creator xmlns:dc="...">
    assert f">{ORG_AUTHOR}</dc:creator>" in core
    assert f">{ORG_AUTHOR}</cp:lastModifiedBy>" in core
    assert ">Rooming list</dc:title>" in core
    assert "openpyxl" not in core


def test_workbook_bytes_does_not_name_the_library():
    import io
    import zipfile

    from openpyxl import load_workbook

    wb = Workbook()
    wb.active["A1"] = "dato"
    data = workbook_bytes(wb, "Pagos")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        app = z.read("docProps/app.xml").decode("utf-8")
    assert "openpyxl" not in app.lower()
    # El archivo reescrito se sigue abriendo y conserva el contenido.
    assert load_workbook(io.BytesIO(data)).active["A1"].value == "dato"
