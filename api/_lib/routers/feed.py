"""Muro — el feed interno del equipo.

Un muro a lo Facebook: novedades de los compañeros, eventos, avisos de RRHH y
lo que haga al día a día. Es el módulo menos formal del sistema y está pensado
como dispersión con información, así que el modelo es chico: publicaciones
(con foto, link o encuesta opcional), reacciones con emoji, comentarios y
publicaciones fijadas.

⚠️ El permiso `feed` NO sigue la regla "toda escritura lleva require_edit":

  * feed:view  → PARTICIPAR. Leer, publicar, reaccionar, comentar, votar y
                 borrar/editar lo PROPIO. Un muro donde solo unos pocos pueden
                 escribir no es un muro.
  * feed:edit  → MODERAR. Fijar arriba, marcar una publicación como oficial
                 y borrar publicaciones o comentarios ajenos.

Por eso las escrituras sobre contenido propio van con require_view (el del
router) más `_assert_can_manage()`, que deja pasar al autor o a un moderador
(`has_edit`). Lo que solo modera lleva require_edit como en cualquier módulo.
Está documentado en CLAUDE.md (punto 18) y en el skill security-checklist.

Imágenes: bucket público `inventory`, prefijo `feed/`, mismo criterio que las
fotos de personnel. El muro no lleva documentos, solo fotos.
"""
import json
import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

from api._lib.auth import has_edit, require_edit, require_view
from api._lib.database import supabase
from api._lib.routers.profile import avatars_for

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/feed",
    tags=["feed"],
    dependencies=[Depends(require_view("feed"))],
)

_BUCKET = "inventory"
_IMAGE_PREFIX = "feed"
_MAX_IMAGE_BYTES = 5 * 1024 * 1024
_IMAGE_EXTS = ("jpg", "jpeg", "png", "webp", "gif")
# Allowlist, no "image/*": un SVG puede llevar script y el bucket es público.
_IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp", "image/gif")

CATEGORIES = ("general", "news", "event", "hr", "fun", "kudos")
EMOJIS = ("👍", "❤️", "🏀", "🎉", "😂", "👏")

_MAX_BODY = 4000
_MAX_COMMENT = 1000
_MAX_LINK = 2000
_MAX_POLL_OPTIONS = 6
_MAX_POLL_OPTION_LEN = 100
_PAGE_MAX = 50

_URL_RE = re.compile(r"^https?://", re.I)


# ── Schemas ──────────────────────────────────────────────────────────────────

class PostUpdate(BaseModel):
    body: Optional[str] = Field(default=None, min_length=1, max_length=_MAX_BODY)
    category: Optional[str] = None
    link_url: Optional[str] = Field(default=None, max_length=_MAX_LINK)
    # Solo moderadores. Un usuario común que lo mande recibe 403.
    is_official: Optional[bool] = None


class PinUpdate(BaseModel):
    pinned: bool


class ReactionIn(BaseModel):
    emoji: str


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=_MAX_COMMENT)


class VoteIn(BaseModel):
    option_index: int = Field(ge=0, le=_MAX_POLL_OPTIONS - 1)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user(request: Request) -> dict:
    return getattr(request.state, "user", None) or {}


def _user_id(request: Request) -> str:
    uid = _user(request).get("id")
    if not uid:
        # No debería pasar: require_view ya falló cerrado. Defensa en profundidad.
        raise HTTPException(status_code=401, detail="Authentication required")
    return uid


def _is_moderator(request: Request) -> bool:
    return has_edit(request, "feed")


def _name_from_email(email: str) -> str:
    """'juan.perez@fiba.basketball' → 'Juan Perez'. Fallback cuando la persona
    no está cargada en employees."""
    local = (email or "").split("@", 1)[0]
    parts = [p for p in re.split(r"[._\-+]+", local) if p]
    return " ".join(p.capitalize() for p in parts) or (email or "Usuario")


def _display_name(request: Request) -> str:
    """Nombre legible del usuario logueado.

    Sale de `employees` por email si está cargado (el staff interno de FIBA es
    quien usa el muro); si no, se arma a partir del email. Es una foto: se
    congela en author_name al publicar.
    """
    email = (_user(request).get("email") or "").strip()
    if email:
        # ilike para no depender de mayúsculas. Se sacan los comodines y
        # separadores de PostgREST para que el email no distorsione el patrón.
        needle = re.sub(r"[*%,()]", "", email)
        try:
            rows = (
                supabase.table("employees")
                .select("name")
                .ilike("email", needle)
                .limit(1)
                .execute()
                .data
            )
            if rows and rows[0].get("name"):
                return rows[0]["name"]
        except Exception as e:  # el nombre nunca bloquea una publicación
            logger.warning("[feed] employee lookup failed for %s: %s", email, e)
    return _name_from_email(email)


def _validate_category(category: Optional[str]) -> str:
    cat = (category or "general").strip().lower()
    if cat not in CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Category must be one of {', '.join(CATEGORIES)}")
    return cat


def _validate_link(link_url: Optional[str]) -> Optional[str]:
    link = (link_url or "").strip()
    if not link:
        return None
    if len(link) > _MAX_LINK or not _URL_RE.match(link):
        raise HTTPException(status_code=400, detail="Link must start with http:// or https://")
    return link


def _validate_uuid(value: Optional[str], what: str) -> Optional[str]:
    if value in (None, ""):
        return None
    try:
        return str(uuid.UUID(value))
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail=f"Invalid {what}")


def _parse_poll(raw: Optional[str]) -> Optional[list[str]]:
    """poll_options llega como JSON string dentro del multipart."""
    if raw in (None, ""):
        return None
    try:
        options = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="poll_options must be a JSON array")
    if not isinstance(options, list):
        raise HTTPException(status_code=400, detail="poll_options must be a JSON array")
    cleaned = [str(o).strip() for o in options if str(o).strip()]
    if not cleaned:
        return None
    if len(cleaned) < 2 or len(cleaned) > _MAX_POLL_OPTIONS:
        raise HTTPException(status_code=400, detail=f"A poll needs between 2 and {_MAX_POLL_OPTIONS} options")
    if any(len(o) > _MAX_POLL_OPTION_LEN for o in cleaned):
        raise HTTPException(status_code=400, detail=f"Poll options must be at most {_MAX_POLL_OPTION_LEN} characters")
    return cleaned


def _image_key(image_url: Optional[str]) -> Optional[str]:
    marker = f"/storage/v1/object/public/{_BUCKET}/"
    if image_url and marker in image_url:
        return image_url.split(marker, 1)[1]
    return None


def _delete_image(image_url: Optional[str]) -> None:
    key = _image_key(image_url)
    if not key:
        return
    try:
        supabase.storage.from_(_BUCKET).remove([key])
    except Exception as e:
        logger.warning("[feed] could not remove image %s: %s", key, e)


async def _store_image(image: UploadFile, post_id: str) -> str:
    if (image.content_type or "").lower() not in _IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Only JPG, PNG, WebP or GIF images are allowed")
    content = await image.read()
    if len(content) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 5 MB)")
    ext = (image.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in _IMAGE_EXTS:
        ext = "jpg"
    key = f"{_IMAGE_PREFIX}/{post_id}.{ext}"
    supabase.storage.from_(_BUCKET).upload(
        path=key,
        file=content,
        file_options={"content-type": image.content_type, "upsert": "true"},
    )
    return supabase.storage.from_(_BUCKET).get_public_url(key)


def _get_post(post_id: str) -> dict:
    pid = _validate_uuid(post_id, "post id")
    rows = supabase.table("feed_posts").select("*").eq("id", pid).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Post not found")
    return rows[0]


def _assert_can_manage(request: Request, row: dict) -> None:
    """Autor o moderador. Es el único chequeo de escritura para lo propio."""
    if row.get("author_id") == _user_id(request) or _is_moderator(request):
        return
    raise HTTPException(status_code=403, detail="You can only change your own posts")


_POST_COLUMNS = (
    "id, author_id, author_name, category, body, image_url, link_url, "
    "poll_options, competition_id, is_pinned, is_official, created_at, edited_at, "
    "competitions(id, name, short_name, start_date, end_date, location)"
)


def _reaction_summary(reactions: list[dict], uid: str) -> dict:
    counts: dict[str, int] = {}
    mine = None
    for r in reactions:
        counts[r["emoji"]] = counts.get(r["emoji"], 0) + 1
        if r["user_id"] == uid:
            mine = r["emoji"]
    return {"reactions": counts, "reaction_count": len(reactions), "my_reaction": mine}


def _poll_summary(options: Optional[list], votes: list[dict], uid: str) -> Optional[dict]:
    if not options:
        return None
    tally = [0] * len(options)
    mine = None
    for v in votes:
        idx = v.get("option_index")
        if isinstance(idx, int) and 0 <= idx < len(options):
            tally[idx] += 1
            if v.get("user_id") == uid:
                mine = idx
    return {
        "options": [{"text": text, "votes": n} for text, n in zip(options, tally)],
        "total": sum(tally),
        "my_vote": mine,
    }


def _shape_posts(rows: list[dict], request: Request) -> list[dict]:
    """Agrega reacciones, comentarios y votos a una página de posts en tres
    queries batcheadas, no N+1."""
    if not rows:
        return []
    uid = _user_id(request)
    moderator = _is_moderator(request)
    ids = [r["id"] for r in rows]

    reactions = supabase.table("feed_reactions").select("post_id, user_id, emoji").in_("post_id", ids).execute().data
    comments = supabase.table("feed_comments").select("post_id").in_("post_id", ids).execute().data
    poll_ids = [r["id"] for r in rows if r.get("poll_options")]
    votes = (
        supabase.table("feed_poll_votes").select("post_id, user_id, option_index").in_("post_id", poll_ids).execute().data
        if poll_ids else []
    )

    # La foto del autor se lee en vivo (no se congela como author_name):
    # cambiar el avatar tiene que verse en lo ya publicado.
    avatars = avatars_for([r.get("author_id") for r in rows])

    by_post: dict[str, dict] = {pid: {"reactions": [], "comments": 0, "votes": []} for pid in ids}
    for r in reactions:
        by_post[r["post_id"]]["reactions"].append(r)
    for c in comments:
        by_post[c["post_id"]]["comments"] += 1
    for v in votes:
        by_post[v["post_id"]]["votes"].append(v)

    out = []
    for row in rows:
        extra = by_post[row["id"]]
        # El email del autor no viaja al cliente: alcanza con el nombre.
        item = {k: v for k, v in row.items() if k not in ("poll_options", "author_email")}
        item["competition"] = row.get("competitions")
        item.pop("competitions", None)
        item.update(_reaction_summary(extra["reactions"], uid))
        item["comment_count"] = extra["comments"]
        item["poll"] = _poll_summary(row.get("poll_options"), extra["votes"], uid)
        item["author_avatar_url"] = avatars.get(row.get("author_id"))
        item["is_mine"] = row.get("author_id") == uid
        item["can_manage"] = item["is_mine"] or moderator
        out.append(item)
    return out


# ── Yo ───────────────────────────────────────────────────────────────────────

@router.get("/me")
def me(request: Request):
    """Cómo me ve el muro: nombre a mostrar y si puedo moderar."""
    uid = _user_id(request)
    return {
        "name": _display_name(request),
        "is_moderator": _is_moderator(request),
        "avatar_url": avatars_for([uid]).get(uid),
    }


# ── Publicaciones ────────────────────────────────────────────────────────────

@router.get("/posts")
def list_posts(
    request: Request,
    category: Optional[str] = Query(None, max_length=20),
    pinned: bool = Query(False, description="Solo publicaciones fijadas"),
    limit: int = Query(15, ge=1, le=_PAGE_MAX),
    offset: int = Query(0, ge=0),
):
    q = supabase.table("feed_posts").select(_POST_COLUMNS)
    if category:
        q = q.eq("category", _validate_category(category))
    if pinned:
        q = q.eq("is_pinned", "true")
    # Fijados arriba, después lo más nuevo.
    q = q.order("is_pinned", desc=True).order("created_at", desc=True)
    rows = q.limit(limit + 1).offset(offset).execute().data
    return {"items": _shape_posts(rows[:limit], request), "has_more": len(rows) > limit}


@router.post("/posts", status_code=201)
async def create_post(
    request: Request,
    body: str = Form(...),
    category: str = Form("general"),
    link_url: Optional[str] = Form(None),
    poll_options: Optional[str] = Form(None),
    competition_id: Optional[str] = Form(None),
    is_official: bool = Form(False),
    image: Optional[UploadFile] = File(None),
):
    """Publicar. Cualquiera con feed:view — ver el docstring del módulo.

    Multipart en un solo request para que la foto y el texto lleguen juntos:
    si la inserción falla después de subir la imagen, se limpia."""
    text = body.strip()
    if not text or len(text) > _MAX_BODY:
        raise HTTPException(status_code=400, detail=f"Body must be between 1 and {_MAX_BODY} characters")
    if is_official and not _is_moderator(request):
        raise HTTPException(status_code=403, detail="Only moderators can publish official posts")

    record = {
        "id": str(uuid.uuid4()),
        "author_id": _user_id(request),
        "author_email": _user(request).get("email"),
        "author_name": _display_name(request),
        "category": _validate_category(category),
        "body": text,
        "link_url": _validate_link(link_url),
        "poll_options": _parse_poll(poll_options),
        "competition_id": _validate_uuid(competition_id, "competition id"),
        "is_official": bool(is_official),
    }

    image_url = None
    if image is not None and image.filename:
        image_url = await _store_image(image, record["id"])
        record["image_url"] = image_url

    try:
        supabase.table("feed_posts").insert(record).execute()
    except Exception:
        _delete_image(image_url)
        raise

    rows = supabase.table("feed_posts").select(_POST_COLUMNS).eq("id", record["id"]).execute().data
    return _shape_posts(rows, request)[0]


@router.patch("/posts/{post_id}")
def update_post(post_id: str, payload: PostUpdate, request: Request):
    """Editar texto, categoría o link. Autor o moderador."""
    row = _get_post(post_id)
    _assert_can_manage(request, row)

    changes: dict = {}
    if payload.body is not None:
        text = payload.body.strip()
        if not text:
            raise HTTPException(status_code=400, detail="Body cannot be empty")
        changes["body"] = text
    if payload.category is not None:
        changes["category"] = _validate_category(payload.category)
    if payload.link_url is not None:
        changes["link_url"] = _validate_link(payload.link_url)
    if payload.is_official is not None:
        if not _is_moderator(request):
            raise HTTPException(status_code=403, detail="Only moderators can mark a post as official")
        changes["is_official"] = payload.is_official
    if not changes:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Un moderador que solo fija/oficializa no "edita" el texto del otro.
    if "body" in changes or "category" in changes or "link_url" in changes:
        changes["edited_at"] = _now()

    supabase.table("feed_posts").update(changes).eq("id", row["id"]).execute()
    rows = supabase.table("feed_posts").select(_POST_COLUMNS).eq("id", row["id"]).execute().data
    return _shape_posts(rows, request)[0]


@router.delete("/posts/{post_id}")
def delete_post(post_id: str, request: Request):
    """Borrar. Autor o moderador. Reacciones, comentarios y votos caen en
    cascada; la foto se saca por la Storage API."""
    row = _get_post(post_id)
    _assert_can_manage(request, row)
    _delete_image(row.get("image_url"))
    supabase.table("feed_posts").delete().eq("id", row["id"]).execute()
    return {"ok": True}


@router.post("/posts/{post_id}/pin", dependencies=[Depends(require_edit("feed"))])
def pin_post(post_id: str, payload: PinUpdate, request: Request):
    """Fijar arriba del muro. Solo moderadores."""
    row = _get_post(post_id)
    supabase.table("feed_posts").update({"is_pinned": payload.pinned}).eq("id", row["id"]).execute()
    rows = supabase.table("feed_posts").select(_POST_COLUMNS).eq("id", row["id"]).execute().data
    return _shape_posts(rows, request)[0]


# ── Reacciones ───────────────────────────────────────────────────────────────

def _post_reactions(post_id: str, uid: str) -> dict:
    rows = supabase.table("feed_reactions").select("post_id, user_id, emoji").eq("post_id", post_id).execute().data
    return _reaction_summary(rows, uid)


@router.put("/posts/{post_id}/reaction")
def react(post_id: str, payload: ReactionIn, request: Request):
    """Reaccionar. Mismo emoji otra vez = sacar la reacción; otro emoji = cambiarla."""
    if payload.emoji not in EMOJIS:
        raise HTTPException(status_code=400, detail="Unknown emoji")
    row = _get_post(post_id)
    uid = _user_id(request)
    existing = (
        supabase.table("feed_reactions").select("id, emoji")
        .eq("post_id", row["id"]).eq("user_id", uid).execute().data
    )
    if existing and existing[0]["emoji"] == payload.emoji:
        supabase.table("feed_reactions").delete().eq("id", existing[0]["id"]).execute()
    elif existing:
        supabase.table("feed_reactions").update({"emoji": payload.emoji}).eq("id", existing[0]["id"]).execute()
    else:
        supabase.table("feed_reactions").insert({
            "post_id": row["id"], "user_id": uid, "emoji": payload.emoji,
        }).execute()
    return _post_reactions(row["id"], uid)


@router.delete("/posts/{post_id}/reaction")
def unreact(post_id: str, request: Request):
    row = _get_post(post_id)
    uid = _user_id(request)
    supabase.table("feed_reactions").delete().eq("post_id", row["id"]).eq("user_id", uid).execute()
    return _post_reactions(row["id"], uid)


# ── Comentarios ──────────────────────────────────────────────────────────────

def _shape_comment(c: dict, request: Request, avatars: Optional[dict] = None) -> dict:
    uid = _user_id(request)
    if avatars is None:
        avatars = avatars_for([c.get("author_id")])
    return {
        **c,
        "author_avatar_url": avatars.get(c.get("author_id")),
        "is_mine": c.get("author_id") == uid,
        "can_manage": c.get("author_id") == uid or _is_moderator(request),
    }


@router.get("/posts/{post_id}/comments")
def list_comments(post_id: str, request: Request):
    row = _get_post(post_id)
    rows = (
        supabase.table("feed_comments")
        .select("id, post_id, author_id, author_name, body, created_at")
        .eq("post_id", row["id"]).order("created_at").execute().data
    )
    avatars = avatars_for([c.get("author_id") for c in rows])
    return [_shape_comment(c, request, avatars) for c in rows]


@router.post("/posts/{post_id}/comments", status_code=201)
def add_comment(post_id: str, payload: CommentIn, request: Request):
    row = _get_post(post_id)
    text = payload.body.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Comment cannot be empty")
    created = supabase.table("feed_comments").insert({
        "post_id": row["id"],
        "author_id": _user_id(request),
        "author_name": _display_name(request),
        "body": text,
    }).execute().data[0]
    return _shape_comment(created, request)


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: str, request: Request):
    """Autor del comentario o moderador."""
    cid = _validate_uuid(comment_id, "comment id")
    rows = supabase.table("feed_comments").select("id, author_id").eq("id", cid).execute().data
    if not rows:
        raise HTTPException(status_code=404, detail="Comment not found")
    _assert_can_manage(request, rows[0])
    supabase.table("feed_comments").delete().eq("id", cid).execute()
    return {"ok": True}


# ── Encuestas ────────────────────────────────────────────────────────────────

@router.post("/posts/{post_id}/vote")
def vote(post_id: str, payload: VoteIn, request: Request):
    """Votar. Volver a votar cambia la opción."""
    row = _get_post(post_id)
    options = row.get("poll_options") or []
    if not options:
        raise HTTPException(status_code=400, detail="This post has no poll")
    if payload.option_index >= len(options):
        raise HTTPException(status_code=400, detail="Unknown poll option")
    uid = _user_id(request)
    existing = (
        supabase.table("feed_poll_votes").select("id")
        .eq("post_id", row["id"]).eq("user_id", uid).execute().data
    )
    if existing:
        supabase.table("feed_poll_votes").update({"option_index": payload.option_index}).eq("id", existing[0]["id"]).execute()
    else:
        supabase.table("feed_poll_votes").insert({
            "post_id": row["id"], "user_id": uid, "option_index": payload.option_index,
        }).execute()
    votes = supabase.table("feed_poll_votes").select("post_id, user_id, option_index").eq("post_id", row["id"]).execute().data
    return _poll_summary(options, votes, uid)


# ── Barra lateral ────────────────────────────────────────────────────────────
#
# Lo que hace al día a día y no es una publicación: qué evento está en cancha o
# viene, quién está de viaje y cómo estuvo el muro esta semana. Muestra solo
# nombres, fechas y ciudades — nada de fees, pasaportes ni logística fina.
# Quien tiene `feed` ve esto aunque no tenga `calendar`, `games` o `employees`:
# es información de pasillo, no del módulo.

_UPCOMING_DAYS = 60
_TRAVEL_DAYS = 7
_SIDEBAR_EVENTS = 6
_SIDEBAR_TRIPS = 8


def _competition_public(c: dict) -> dict:
    return {
        "id": c.get("id"),
        "name": c.get("name"),
        "short_name": c.get("short_name"),
        "start_date": c.get("start_date"),
        "end_date": c.get("end_date"),
        "location": c.get("location"),
        "competition_type": c.get("competition_type"),
    }


def _upcoming_events(today: date) -> list[dict]:
    horizon = today + timedelta(days=_UPCOMING_DAYS)
    rows = (
        supabase.table("competitions")
        .select("id, name, short_name, start_date, end_date, location, competition_type")
        .gte("end_date", today.isoformat())
        .lte("start_date", horizon.isoformat())
        .order("start_date")
        .limit(_SIDEBAR_EVENTS)
        .execute()
        .data
    )
    out = []
    for c in rows:
        item = _competition_public(c)
        start = c.get("start_date") or ""
        item["live"] = bool(start) and start <= today.isoformat()
        out.append(item)
    return out


def _traveling(today: date) -> list[dict]:
    """Empleados con una designación que cae dentro de la semana que viene,
    agrupados por competencia."""
    week_end = today + timedelta(days=_TRAVEL_DAYS)
    rows = (
        supabase.table("competition_staffing")
        .select(
            "employee_id, external_name, event_role, start_date, end_date, status, "
            "employees(name), "
            "competitions!inner(id, name, short_name, start_date, end_date, location, competition_type)"
        )
        .in_("status", ["planned", "confirmed"])
        # Filtra las FILAS PADRE por la competencia embebida (!inner): sin el
        # inner, PostgREST solo vaciaría el embed y devolvería todo el histórico.
        .gte("competitions.end_date", today.isoformat())
        .lte("competitions.start_date", week_end.isoformat())
        .execute()
        .data
    )
    groups: dict[str, dict] = {}
    seen: set[tuple] = set()
    for r in rows:
        comp = r.get("competitions") or {}
        start = r.get("start_date") or comp.get("start_date")
        end = r.get("end_date") or comp.get("end_date") or start
        if not start or not end:
            continue
        if end < today.isoformat() or start > week_end.isoformat():
            continue
        name = (r.get("employees") or {}).get("name") or r.get("external_name")
        if not name:
            continue
        key = (comp.get("id"), r.get("employee_id") or name)
        if key in seen:
            continue
        seen.add(key)
        group = groups.setdefault(comp.get("id"), {"competition": _competition_public(comp), "people": []})
        group["people"].append({"name": name, "role": r.get("event_role")})

    ordered = sorted(groups.values(), key=lambda g: g["competition"].get("start_date") or "")
    for g in ordered:
        g["people"].sort(key=lambda p: p["name"])
    return ordered[:_SIDEBAR_TRIPS]


def _week_stats(today: date) -> dict:
    since = (today - timedelta(days=7)).isoformat()
    posts = supabase.table("feed_posts").select("id, author_name").gte("created_at", since).execute().data
    reactions = supabase.table("feed_reactions").select("id").gte("created_at", since).execute().data
    comments = supabase.table("feed_comments").select("id").gte("created_at", since).execute().data
    by_author: dict[str, int] = {}
    for p in posts:
        by_author[p["author_name"]] = by_author.get(p["author_name"], 0) + 1
    top = max(by_author.items(), key=lambda kv: kv[1]) if by_author else None
    return {
        "posts": len(posts),
        "reactions": len(reactions),
        "comments": len(comments),
        "top_author": {"name": top[0], "posts": top[1]} if top else None,
    }


@router.get("/sidebar")
def sidebar():
    today = date.today()
    return {
        "events": _upcoming_events(today),
        "traveling": _traveling(today),
        "week": _week_stats(today),
    }
