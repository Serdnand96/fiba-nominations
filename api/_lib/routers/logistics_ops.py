"""Operación de logística: contactos, salones, adicionales de hotel y documentos.

Es lo que pidió la gerente de eventos y no entra en el padrón (logistics.py) ni
en el transporte (transport.py): el directorio de proveedores, los salones de
reunión, lo que el hotel cobra de más y los archivos privados que cuelgan de
todo eso (menús, pasaportes, cotizaciones). Migración 055.

Comparte el permiso `logistics` con el resto del módulo: `require_view` a nivel
router, `require_edit` en cada escritura. Nada de esto sale por el link público
(`public_logistics.py`): contactos, salones, cargos y documentos son de la
plataforma. Los escaneos de pasaporte, además, solo los baja quien tiene
Logística.

Dos reglas que se ven raras y son correctas:

  * `audience` NULL = "sirve a todas las audiencias". Un GET con `audience`
    devuelve esa audiencia MÁS las filas NULL, y se filtra en Python.
  * Los montos de `logistics_hotel_charges` son informativos: NO suman en
    Budget. Los pagos reales son filas de `expenses`, que acá se leen en solo
    lectura (`GET /hotels/{id}/payments`).
"""
import logging
import re
import shutil
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from api._lib.auth import require_edit, require_view
from api._lib.database import supabase
from api._lib.logistics_audiences import check_audience, for_audience
from api._lib.routers.logistics import _blank_to_none, document_paths, remove_objects
from api._lib.routers.payments import (
    _BUCKET, _MAX_UPLOAD_BYTES, _SAFE_FILENAME_RE, _delete_from_storage, _stream_private,
)
from api._lib.services.logistics_import import parse_time

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/logistics",
    tags=["logistics"],
    dependencies=[Depends(require_view("logistics"))],
)

CONTACT_KINDS = ("transport", "hotel", "ice", "laundry", "hydration", "vip", "other")
ROOM_PURPOSES = ("media_day", "technical_meeting", "pic", "meeting", "other")
CHARGE_KINDS = ("extra", "quote")
DOCUMENT_KINDS = ("menu", "passport", "quote", "other")

_DOCS_PREFIX = "logistics/docs"
# Tipo por magic bytes → (content-type, extensión). El tipo que declara el
# cliente no cuenta: un SVG con `image/png` no pasa porque no empieza así.
_MAGIC = (
    (b"%PDF", "application/pdf", "pdf"),
    (b"\xff\xd8\xff", "image/jpeg", "jpg"),
    (b"\x89PNG", "image/png", "png"),
)
_DOC_EXTENSIONS = {"pdf": ("pdf",), "jpg": ("jpg", "jpeg"), "png": ("png",)}
# Lo único que sale de `logistics_documents` hacia el cliente. `file_path` (la
# ruta de Storage) y `uploaded_by` se quedan en el servidor.
DOCUMENT_FIELDS = (
    "id", "competition_id", "kind", "hotel_id", "participant_id", "charge_id",
    "file_name", "content_type", "size_bytes", "created_at",
)
_IN_CHUNK = 100


# ── Helpers ──────────────────────────────────────────────────────────────────

def _user_id(request: Request) -> Optional[str]:
    user = getattr(request.state, "user", None)
    return user.get("id") if isinstance(user, dict) else None


def _is_uuid(value) -> bool:
    try:
        uuid.UUID(str(value))
    except ValueError:
        return False
    return True


def _competition_or_404(competition_id: str) -> dict:
    rows = (
        _is_uuid(competition_id)
        and supabase.table("competitions").select("id,name")
        .eq("id", competition_id).execute().data
    )
    if not rows:
        raise HTTPException(404, "Competition not found")
    return rows[0]


def _check_hotel(hotel_id: Optional[str], competition_id: str) -> None:
    """El hotel tiene que ser de la competencia: sin esto un contacto, un salón
    o un cargo de una competencia quedaría colgado del hotel de otra."""
    if not hotel_id:
        return
    rows = (
        _is_uuid(hotel_id)
        and supabase.table("logistics_hotels").select("id")
        .eq("id", hotel_id).eq("competition_id", competition_id).execute().data
    )
    if not rows:
        raise HTTPException(400, "The hotel does not belong to this competition")


def _row_or_404(table: str, row_id: str, label: str) -> dict:
    rows = _is_uuid(row_id) and supabase.table(table).select("*").eq("id", row_id).execute().data
    if not rows:
        raise HTTPException(404, f"{label} not found")
    return rows[0]


def _one_of(value: Optional[str], valid: tuple, field: str) -> str:
    if value not in valid:
        raise HTTPException(400, f"{field} must be one of {', '.join(valid)}")
    return value


def _text(updates: dict, fields: tuple) -> None:
    """'' → NULL en los textos libres (el formulario manda vacío por 'sin dato')."""
    for field in fields:
        if field in updates:
            updates[field] = _blank_to_none(updates[field])


def _iso_date_or_400(value, field: str = "date") -> Optional[str]:
    from datetime import date
    value = _blank_to_none(value)
    if value is None:
        return None
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise HTTPException(400, f"{field} must be YYYY-MM-DD")


def _time_or_400(value, field: str) -> Optional[str]:
    value = _blank_to_none(value)
    if value is None:
        return None
    parsed = parse_time(value)
    if parsed is None:
        raise HTTPException(400, f"{field} must be a time (HH:MM)")
    return parsed


def _drop_null(updates: dict, *required: str) -> None:
    """Las columnas NOT NULL no se pueden limpiar: omitirlas es distinto de
    mandarlas en null, y un null no las borra."""
    for field in required:
        if field in updates and updates[field] is None:
            updates.pop(field)


def _require_hotel(value) -> str:
    hotel_id = _blank_to_none(value)
    if not hotel_id:
        raise HTTPException(400, "hotel_id is required")
    return hotel_id


def _require_name(value, field: str = "name") -> str:
    name = _blank_to_none(value)
    if not name:
        raise HTTPException(400, f"{field} is required")
    return name


# ── Contactos ────────────────────────────────────────────────────────────────

class ContactCreate(BaseModel):
    competition_id: str
    kind: str = "other"
    audience: Optional[str] = None
    hotel_id: Optional[str] = None
    name: str
    company: Optional[str] = None
    role: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    pickup_hours: Optional[str] = None
    delivery_hours: Optional[str] = None
    notes: Optional[str] = None


class ContactUpdate(BaseModel):
    kind: Optional[str] = None
    audience: Optional[str] = None
    hotel_id: Optional[str] = None
    name: Optional[str] = None
    company: Optional[str] = None
    role: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    pickup_hours: Optional[str] = None
    delivery_hours: Optional[str] = None
    notes: Optional[str] = None


_CONTACT_TEXTS = ("company", "role", "phone", "email", "pickup_hours", "delivery_hours", "notes")


@router.get("/contacts")
def list_contacts(competition_id: str = Query(...), audience: Optional[str] = None,
                  kind: Optional[str] = None):
    """Directorio de la competencia. Con `audience`: esa audiencia más los
    contactos que sirven a todas (audience NULL)."""
    if kind:
        _one_of(kind, CONTACT_KINDS, "kind")
    query = supabase.table("logistics_contacts").select("*").eq("competition_id", competition_id)
    if kind:
        query = query.eq("kind", kind)
    rows = for_audience(query.execute().data or [], audience)
    return sorted(rows, key=lambda r: (r.get("kind") or "", (r.get("name") or "").lower()))


@router.post("/contacts", dependencies=[Depends(require_edit("logistics"))])
def create_contact(data: ContactCreate):
    record = data.model_dump()
    record["name"] = _require_name(record["name"])
    record["kind"] = _one_of(record["kind"], CONTACT_KINDS, "kind")
    record["audience"] = check_audience(record["audience"])
    record["hotel_id"] = _blank_to_none(record["hotel_id"])
    _text(record, _CONTACT_TEXTS)
    _competition_or_404(record["competition_id"])
    _check_hotel(record["hotel_id"], record["competition_id"])
    return supabase.table("logistics_contacts").insert(record).execute().data[0]


@router.put("/contacts/{contact_id}", dependencies=[Depends(require_edit("logistics"))])
def update_contact(contact_id: str, data: ContactUpdate):
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    current = _row_or_404("logistics_contacts", contact_id, "Contact")
    _drop_null(updates, "kind", "name")
    if "name" in updates:
        updates["name"] = _require_name(updates["name"])
    if "kind" in updates:
        _one_of(updates["kind"], CONTACT_KINDS, "kind")
    if "audience" in updates:
        updates["audience"] = check_audience(updates["audience"])
    if "hotel_id" in updates:
        updates["hotel_id"] = _blank_to_none(updates["hotel_id"])
        _check_hotel(updates["hotel_id"], current["competition_id"])
    _text(updates, _CONTACT_TEXTS)
    if not updates:
        raise HTTPException(400, "No fields to update")
    rows = supabase.table("logistics_contacts").update(updates).eq("id", contact_id).execute().data
    if not rows:
        raise HTTPException(404, "Contact not found")
    return rows[0]


@router.delete("/contacts/{contact_id}", dependencies=[Depends(require_edit("logistics"))])
def delete_contact(contact_id: str):
    _row_or_404("logistics_contacts", contact_id, "Contact")
    supabase.table("logistics_contacts").delete().eq("id", contact_id).execute()
    return {"ok": True}


# ── Salones ──────────────────────────────────────────────────────────────────

class RoomCreate(BaseModel):
    competition_id: str
    hotel_id: Optional[str] = None
    name: str
    purpose: str = "meeting"
    audience: Optional[str] = None
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    capacity: Optional[int] = Field(default=None, ge=0)
    notes: Optional[str] = None


class RoomUpdate(BaseModel):
    hotel_id: Optional[str] = None
    name: Optional[str] = None
    purpose: Optional[str] = None
    audience: Optional[str] = None
    date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    location: Optional[str] = None
    capacity: Optional[int] = Field(default=None, ge=0)
    notes: Optional[str] = None


def _clean_room(record: dict) -> None:
    """Normaliza fecha, horas y textos de un salón (create y update)."""
    if "date" in record:
        record["date"] = _iso_date_or_400(record["date"])
    for field in ("start_time", "end_time"):
        if field in record:
            record[field] = _time_or_400(record[field], field)
    _text(record, ("location", "notes"))


@router.get("/rooms")
def list_rooms(competition_id: str = Query(...), audience: Optional[str] = None,
               hotel_id: Optional[str] = None):
    """Salones de la competencia, en orden de fecha y hora. Con `audience`:
    esa audiencia más los que sirven a todas (audience NULL)."""
    query = supabase.table("logistics_rooms").select("*").eq("competition_id", competition_id)
    if hotel_id:
        query = query.eq("hotel_id", hotel_id)
    rows = for_audience(query.execute().data or [], audience)
    # Sin fecha al final: un salón todavía sin día no tapa los que ya tienen.
    return sorted(rows, key=lambda r: (
        r.get("date") is None, r.get("date") or "", r.get("start_time") or "", (r.get("name") or "").lower(),
    ))


@router.post("/rooms", dependencies=[Depends(require_edit("logistics"))])
def create_room(data: RoomCreate):
    record = data.model_dump()
    record["name"] = _require_name(record["name"])
    record["purpose"] = _one_of(record["purpose"], ROOM_PURPOSES, "purpose")
    record["audience"] = check_audience(record["audience"])
    record["hotel_id"] = _blank_to_none(record["hotel_id"])
    _clean_room(record)
    _competition_or_404(record["competition_id"])
    _check_hotel(record["hotel_id"], record["competition_id"])
    return supabase.table("logistics_rooms").insert(record).execute().data[0]


@router.put("/rooms/{room_id}", dependencies=[Depends(require_edit("logistics"))])
def update_room(room_id: str, data: RoomUpdate):
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    current = _row_or_404("logistics_rooms", room_id, "Room")
    _drop_null(updates, "name", "purpose")
    if "name" in updates:
        updates["name"] = _require_name(updates["name"])
    if "purpose" in updates:
        _one_of(updates["purpose"], ROOM_PURPOSES, "purpose")
    if "audience" in updates:
        updates["audience"] = check_audience(updates["audience"])
    if "hotel_id" in updates:
        updates["hotel_id"] = _blank_to_none(updates["hotel_id"])
        _check_hotel(updates["hotel_id"], current["competition_id"])
    _clean_room(updates)
    if not updates:
        raise HTTPException(400, "No fields to update")
    rows = supabase.table("logistics_rooms").update(updates).eq("id", room_id).execute().data
    if not rows:
        raise HTTPException(404, "Room not found")
    return rows[0]


@router.delete("/rooms/{room_id}", dependencies=[Depends(require_edit("logistics"))])
def delete_room(room_id: str):
    _row_or_404("logistics_rooms", room_id, "Room")
    supabase.table("logistics_rooms").delete().eq("id", room_id).execute()
    return {"ok": True}


# ── Adicionales y cotizaciones de hotel ──────────────────────────────────────

class ChargeCreate(BaseModel):
    competition_id: str
    hotel_id: Optional[str] = None      # obligatorio: se valida acá para dar un 400 claro
    kind: str = "extra"
    concept: str
    amount: Optional[float] = Field(default=None, ge=0)
    currency: Optional[str] = "USD"
    date: Optional[str] = None
    notes: Optional[str] = None


class ChargeUpdate(BaseModel):
    hotel_id: Optional[str] = None
    kind: Optional[str] = None
    concept: Optional[str] = None
    amount: Optional[float] = Field(default=None, ge=0)
    currency: Optional[str] = None
    date: Optional[str] = None
    notes: Optional[str] = None


def _clean_charge(record: dict) -> None:
    if "amount" in record and record["amount"] is not None:
        record["amount"] = round(float(record["amount"]), 2)
    if "currency" in record:
        record["currency"] = (record["currency"] or "").strip().upper() or "USD"
    if "date" in record:
        record["date"] = _iso_date_or_400(record["date"])
    _text(record, ("notes",))


@router.get("/hotel-charges")
def list_hotel_charges(competition_id: Optional[str] = None, hotel_id: Optional[str] = None):
    """Adicionales y cotizaciones. Informativos: no suman en Budget."""
    if not competition_id and not hotel_id:
        raise HTTPException(400, "competition_id or hotel_id is required")
    query = supabase.table("logistics_hotel_charges").select("*")
    if competition_id:
        query = query.eq("competition_id", competition_id)
    if hotel_id:
        query = query.eq("hotel_id", hotel_id)
    rows = query.execute().data or []
    return sorted(rows, key=lambda r: (r.get("date") or "", r.get("created_at") or ""), reverse=True)


@router.post("/hotel-charges", dependencies=[Depends(require_edit("logistics"))])
def create_hotel_charge(data: ChargeCreate, request: Request):
    record = data.model_dump()
    record["concept"] = _require_name(record["concept"], "concept")
    record["kind"] = _one_of(record["kind"], CHARGE_KINDS, "kind")
    record["hotel_id"] = _require_hotel(record["hotel_id"])
    _clean_charge(record)
    _competition_or_404(record["competition_id"])
    _check_hotel(record["hotel_id"], record["competition_id"])
    record["created_by"] = _user_id(request)
    return supabase.table("logistics_hotel_charges").insert(record).execute().data[0]


@router.put("/hotel-charges/{charge_id}", dependencies=[Depends(require_edit("logistics"))])
def update_hotel_charge(charge_id: str, data: ChargeUpdate):
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    current = _row_or_404("logistics_hotel_charges", charge_id, "Charge")
    _drop_null(updates, "kind", "concept")
    if "hotel_id" in updates:
        updates["hotel_id"] = _require_hotel(updates["hotel_id"])    # '' o null: 400, no un 500 de Postgres
    if "concept" in updates:
        updates["concept"] = _require_name(updates["concept"], "concept")
    if "kind" in updates:
        _one_of(updates["kind"], CHARGE_KINDS, "kind")
    if "hotel_id" in updates:
        _check_hotel(updates["hotel_id"], current["competition_id"])
    _clean_charge(updates)
    if not updates:
        raise HTTPException(400, "No fields to update")
    rows = supabase.table("logistics_hotel_charges").update(updates).eq("id", charge_id).execute().data
    if not rows:
        raise HTTPException(404, "Charge not found")
    if "hotel_id" in updates and updates["hotel_id"] != current.get("hotel_id"):
        # Los documentos del cargo (la cotización) siguen al cargo: sin esto el
        # panel del hotel nuevo no los ve y borrar el viejo se llevaría el
        # archivo de un cargo que sigue vivo.
        supabase.table("logistics_documents").update({"hotel_id": updates["hotel_id"]}) \
            .eq("charge_id", charge_id).execute()
    return rows[0]


@router.delete("/hotel-charges/{charge_id}", dependencies=[Depends(require_edit("logistics"))])
def delete_hotel_charge(charge_id: str):
    _row_or_404("logistics_hotel_charges", charge_id, "Charge")
    # Las cotizaciones adjuntas caen por el ON DELETE CASCADE, pero el objeto de
    # Storage no: las rutas se juntan antes de que la fila se las lleve y los
    # objetos se quitan después (si la fila no se pudo borrar, no queda un
    # documento apuntando a un objeto que ya no existe).
    paths = document_paths("charge_id", charge_id)
    supabase.table("logistics_hotel_charges").delete().eq("id", charge_id).execute()
    remove_objects(paths)
    return {"ok": True}


# ── Documentos (bucket privado `nominations`, bajo logistics/docs/) ──────────

def _doc_view(row: dict) -> dict:
    """Metadatos de un documento: nunca `file_path` ni quién lo subió."""
    return {field: row.get(field) for field in DOCUMENT_FIELDS}


@router.get("/documents")
def list_documents(competition_id: Optional[str] = None, kind: Optional[str] = None,
                   hotel_id: Optional[str] = None, participant_id: Optional[str] = None,
                   charge_id: Optional[str] = None):
    """Metadatos de los documentos. Para bajar uno: `POST /documents/{id}/download`."""
    if not (competition_id or hotel_id or participant_id or charge_id):
        raise HTTPException(400, "competition_id, hotel_id, participant_id or charge_id is required")
    if kind:
        _one_of(kind, DOCUMENT_KINDS, "kind")
    query = supabase.table("logistics_documents").select(",".join(DOCUMENT_FIELDS))
    for column, value in (("competition_id", competition_id), ("kind", kind), ("hotel_id", hotel_id),
                          ("participant_id", participant_id), ("charge_id", charge_id)):
        if value:
            query = query.eq(column, value)
    rows = query.execute().data or []
    return sorted((_doc_view(r) for r in rows), key=lambda r: r.get("created_at") or "", reverse=True)


def _detect(content: bytes) -> tuple:
    for magic, content_type, extension in _MAGIC:
        if content.startswith(magic):
            return content_type, extension
    raise HTTPException(400, "Only PDF, JPEG or PNG files are allowed")


def _file_name(raw: Optional[str], kind: str, extension: str) -> str:
    name = re.sub(r"\s+", " ", _SAFE_FILENAME_RE.sub("", raw or "")).strip()
    if not name:
        return f"{kind}.{extension}"
    # El nombre que baja el usuario tiene que abrir con el programa correcto:
    # si no trae la extensión del contenido real, se le agrega.
    if not name.lower().endswith(tuple(f".{e}" for e in _DOC_EXTENSIONS[extension])):
        name = f"{name}.{extension}"
    return name


@router.post("/documents", dependencies=[Depends(require_edit("logistics"))])
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    competition_id: str = Query(...),
    kind: str = Query(...),
    hotel_id: Optional[str] = None,
    participant_id: Optional[str] = None,
    charge_id: Optional[str] = None,
):
    """Sube un PDF, JPEG o PNG (≤ 10 MB) y lo cuelga de un hotel, una persona o
    un cargo. Lo que se guarda es `storage://nominations/<key>`: nunca se arma
    una URL pública, el archivo se sirve por `POST /documents/{id}/download`.

    El dueño que exige el CHECK de la migración 055 se valida acá para dar un
    400 claro: un menú es de un hotel, un pasaporte de una persona y una
    cotización de un cargo.
    """
    _one_of(kind, DOCUMENT_KINDS, "kind")
    hotel_id, participant_id, charge_id = (_blank_to_none(v) for v in (hotel_id, participant_id, charge_id))
    for needed, owner in (("menu", ("hotel_id", hotel_id)), ("passport", ("participant_id", participant_id)),
                          ("quote", ("charge_id", charge_id))):
        if kind == needed and not owner[1]:
            raise HTTPException(400, f"A {kind} document needs {owner[0]}")

    content = await file.read()
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large (max 10 MB)")
    if not content:
        raise HTTPException(400, "The file is empty")
    content_type, extension = _detect(content)

    # Cada dueño tiene que ser de ESTA competencia: si no, un documento de un
    # hotel ajeno quedaría colgado de la competencia equivocada.
    _competition_or_404(competition_id)
    if charge_id:
        charge = _is_uuid(charge_id) and supabase.table("logistics_hotel_charges").select("id,hotel_id") \
            .eq("id", charge_id).eq("competition_id", competition_id).execute().data
        if not charge:
            raise HTTPException(400, "Charge does not belong to this competition")
        # Un documento de un cargo es del hotel de ESE cargo: el `hotel_id` que
        # mande el cliente se ignora (una cotización no puede quedar en un hotel
        # y colgar del cargo de otro).
        hotel_id = charge[0]["hotel_id"]
    _check_hotel(hotel_id, competition_id)
    if participant_id:
        found = _is_uuid(participant_id) and supabase.table("logistics_participants").select("id") \
            .eq("id", participant_id).eq("competition_id", competition_id).execute().data
        if not found:
            raise HTTPException(400, "Participant does not belong to this competition")

    key = f"{_DOCS_PREFIX}/{competition_id}/{kind}-{uuid.uuid4().hex}.{extension}"
    try:
        supabase.storage.from_(_BUCKET).upload(
            path=key, file=content,
            file_options={"content-type": content_type, "upsert": "false"},
        )
    except Exception as e:
        logger.warning("[logistics] document upload failed for %s: %s", competition_id, e)
        raise HTTPException(502, "Upload failed")

    new_path = f"storage://{_BUCKET}/{key}"
    record = {
        "competition_id": competition_id, "kind": kind,
        "hotel_id": hotel_id, "participant_id": participant_id, "charge_id": charge_id,
        "file_path": new_path, "file_name": _file_name(file.filename, kind, extension),
        "content_type": content_type, "size_bytes": len(content), "uploaded_by": _user_id(request),
    }
    try:
        row = supabase.table("logistics_documents").insert(record).execute().data[0]
    except Exception:
        _delete_from_storage(new_path)   # no dejar huérfano el objeto recién subido
        raise
    return _doc_view(row)


@router.post("/documents/{document_id}/download")
def download_document(document_id: str, request: Request):
    """El archivo, como descarga autenticada. Es POST a propósito: el middleware
    del activity log audita POST/PUT/PATCH/DELETE y no los GET, y un pasaporte
    escaneado tiene que dejar rastro de quién lo bajó (mismo criterio que el W-8,
    CLAUDE.md punto 25). No lo pases a GET."""
    doc = _row_or_404("logistics_documents", document_id, "Document")
    logger.info("[logistics] document download id=%s kind=%s by user=%s",
                document_id, doc.get("kind"), _user_id(request))
    return _stream_private(doc.get("file_path"), doc.get("file_name") or "document")


@router.delete("/documents/{document_id}", dependencies=[Depends(require_edit("logistics"))])
def delete_document(document_id: str):
    doc = _row_or_404("logistics_documents", document_id, "Document")
    # Primero la fila: si falla, el archivo sigue accesible; al revés quedaría un
    # registro apuntando a un objeto que ya no existe.
    supabase.table("logistics_documents").delete().eq("id", document_id).execute()
    _delete_from_storage(doc.get("file_path"))
    return {"ok": True}


# ── Pagos de FIBA por hotel (lectura de Budget) ──────────────────────────────

_PAYMENT_FIELDS = ("record_no", "description", "amount", "status", "expense_date",
                   "payment_date", "invoice_no")


def _num(value) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


@router.get("/hotels/{hotel_id}/payments")
def hotel_payments(hotel_id: str):
    """Lo que FIBA ya aprobó o pagó a un hotel, leído de `expenses` en solo lectura.

    EXCEPCIÓN DOCUMENTADA a `_scoped()` de budget (migración 056): esta consulta
    sobre `expenses` NO recorta por departamento. Quien tiene `logistics` ve los
    pagos de SUS hoteles aunque no tenga acceso al departamento que los imputó
    — la misma clase de excepción que `competition_cost` en budget.py. Lo que
    la hace tolerable es la proyección angosta: solo `record_no`, `description`,
    `amount`, `status`, `expense_date`, `payment_date`, `invoice_no` y el nombre
    del proveedor. Nunca `bank_confirmation`, `payment_method`, `comments`,
    `created_by`, emails ni adjuntos. Y solo `approved` / `paid`: un borrador,
    un rechazo o una cancelación todavía no son plata comprometida.

    No suma nada en Budget ni lo escribe: `logistics_hotel_charges` (lo que el
    hotel informó) es otra cosa y no se mezcla con esto.
    """
    _row_or_404("logistics_hotels", hotel_id, "Hotel")
    expenses = (
        supabase.table("expenses")
        .select(",".join(_PAYMENT_FIELDS) + ",vendor_id")
        .eq("hotel_id", hotel_id)
        .in_("status", ["approved", "paid"])
        .execute()
        .data
    ) or []

    # Nombres de proveedor en UNA consulta (por tandas: los ids van en la URL).
    vendor_ids = sorted({e["vendor_id"] for e in expenses if e.get("vendor_id")})
    names: dict = {}
    for start in range(0, len(vendor_ids), _IN_CHUNK):
        for vendor in (
            supabase.table("vendors").select("id,name")
            .in_("id", vendor_ids[start:start + _IN_CHUNK]).execute().data or []
        ):
            names[vendor["id"]] = vendor.get("name")

    rows = [
        {**{field: e.get(field) for field in _PAYMENT_FIELDS}, "vendor_name": names.get(e.get("vendor_id"))}
        for e in expenses
    ]
    rows.sort(key=lambda r: (r.get("payment_date") or r.get("expense_date") or ""), reverse=True)
    return {
        "rows": rows,
        "total_paid": round(sum(_num(r["amount"]) for r in rows if r["status"] == "paid"), 2),
        "total_approved": round(sum(_num(r["amount"]) for r in rows if r["status"] == "approved"), 2),
    }


# ── PDF operativo para delegaciones ──────────────────────────────────────────

@router.get("/export/delegation-briefing")
def export_delegation_briefing(competition_id: str = Query(...)):
    """Un PDF por competencia para mandar a los equipos: hoteles, cronogramas,
    salones y contactos. Sin datos personales (ni participantes, ni pasaportes,
    ni VIPs). Si el servidor no puede convertir a PDF, sale el .docx.

    El armado vive en services/logistics_briefing.py. El archivo es temporal:
    se borra el directorio una vez enviada la respuesta.
    """
    _competition_or_404(competition_id)
    from api._lib.services.logistics_briefing import render_briefing
    file_path, media_type, filename, temp_dir = render_briefing(competition_id)
    return FileResponse(
        file_path,
        media_type=media_type,
        filename=filename,
        headers={"Cache-Control": "private, no-store"},
        background=BackgroundTask(shutil.rmtree, temp_dir, ignore_errors=True),
    )
