"""Perfil del usuario logueado — hoy, su avatar (foto de perfil).

`/me` no lleva permiso de módulo: es lo propio de quien está logueado y
cualquier usuario autenticado puede ver y cambiar SU foto. Falla cerrado igual
que el resto (401 sin usuario en request.state) vía `require_user`.

El avatar va al bucket público `inventory` bajo `avatars/<user_id>.<ext>`, el
mismo criterio que las fotos de personnel y las del muro. Se guarda la URL
pública en `user_profiles.avatar_url` (migración 044) con `?v=<timestamp>` para
que al cambiar la foto el navegador no siga mostrando la anterior.

`user_profiles` tenía fila solo para los superadmin: acá se crea la del usuario
si no existe, sin tocar `is_superadmin` (queda en su default false).

`avatars_for()` es la lectura batcheada que usan el muro y la lista de usuarios
para mostrar la foto de otros.
"""
import logging
import time
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile

from api._lib.auth import require_user
from api._lib.database import supabase

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/me",
    tags=["profile"],
    dependencies=[Depends(require_user)],
)

_BUCKET = "inventory"
_PREFIX = "avatars"
_MAX_BYTES = 2 * 1024 * 1024
# Allowlist, no "image/*": un SVG puede llevar script y el bucket es público.
# La extensión sale del content-type, no del nombre del archivo.
_EXT_BY_TYPE = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}


def _uid(request: Request) -> str:
    user = getattr(request.state, "user", None) or {}
    uid = user.get("id")
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")
    return uid


def _email(request: Request) -> Optional[str]:
    user = getattr(request.state, "user", None) or {}
    return user.get("email")


def _profile(uid: str) -> Optional[dict]:
    rows = (
        supabase.table("user_profiles")
        .select("id, avatar_url")
        .eq("user_id", uid)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def _set_avatar(uid: str, url: Optional[str]) -> None:
    """Upsert a mano: el wrapper no tiene on_conflict. Nunca toca is_superadmin."""
    if _profile(uid):
        supabase.table("user_profiles").update({"avatar_url": url}).eq("user_id", uid).execute()
    else:
        supabase.table("user_profiles").insert({"user_id": uid, "avatar_url": url}).execute()


def _storage_key(url: Optional[str]) -> Optional[str]:
    marker = f"/storage/v1/object/public/{_BUCKET}/"
    if not url or marker not in url:
        return None
    key = url.split(marker, 1)[1]
    return key.split("?", 1)[0]


def _remove_object(url: Optional[str]) -> None:
    key = _storage_key(url)
    if not key or not key.startswith(f"{_PREFIX}/"):
        return
    try:
        supabase.storage.from_(_BUCKET).remove([key])
    except Exception as e:
        logger.warning("[profile] could not remove avatar %s: %s", key, e)


def avatars_for(user_ids: list) -> dict:
    """{user_id: avatar_url} para una lista de ids, en una sola query.

    Para que el muro y Usuarios muestren la foto de otros sin N+1. Los ids sin
    fila o sin foto simplemente no aparecen en el dict.
    """
    ids = sorted({str(i) for i in user_ids if i})
    if not ids:
        return {}
    try:
        rows = (
            supabase.table("user_profiles")
            .select("user_id, avatar_url")
            .in_("user_id", ids)
            .execute()
            .data
        )
    except Exception as e:  # la foto nunca rompe una lista
        logger.warning("[profile] avatar lookup failed: %s", e)
        return {}
    return {r["user_id"]: r["avatar_url"] for r in rows if r.get("avatar_url")}


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("")
def get_me(request: Request):
    """Quién soy para la UI: id, email y avatar."""
    uid = _uid(request)
    prof = _profile(uid) or {}
    return {"id": uid, "email": _email(request), "avatar_url": prof.get("avatar_url")}


@router.post("/avatar")
async def upload_avatar(request: Request, photo: UploadFile = File(...)):
    """Sube o reemplaza MI foto de perfil."""
    uid = _uid(request)
    ctype = (photo.content_type or "").lower()
    ext = _EXT_BY_TYPE.get(ctype)
    if not ext:
        raise HTTPException(status_code=400, detail="Only JPG, PNG, WebP or GIF images are allowed")
    content = await photo.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 2 MB)")

    previous = (_profile(uid) or {}).get("avatar_url")
    key = f"{_PREFIX}/{uid}.{ext}"
    try:
        supabase.storage.from_(_BUCKET).upload(
            path=key,
            file=content,
            file_options={"content-type": ctype, "upsert": "true"},
        )
    except Exception as e:
        logger.error("[profile] avatar upload failed for %s: %s", uid, e)
        raise HTTPException(status_code=500, detail="Could not store the image")

    url = f"{supabase.storage.from_(_BUCKET).get_public_url(key)}?v={int(time.time())}"
    _set_avatar(uid, url)

    # Si cambió la extensión, el objeto viejo quedaría huérfano en el bucket.
    if _storage_key(previous) and _storage_key(previous) != key:
        _remove_object(previous)
    return {"avatar_url": url}


@router.delete("/avatar")
def delete_avatar(request: Request):
    """Quita MI foto de perfil (vuelve a las iniciales)."""
    uid = _uid(request)
    previous = (_profile(uid) or {}).get("avatar_url")
    if previous:
        _remove_object(previous)
        _set_avatar(uid, None)
    return {"avatar_url": None}
