"""Conexión del usuario logueado con su Google Calendar (sync de partidos).

Cuelga de `/me` como profile.py y notifications.py: es lo propio de quien
llama, con `require_user` (401 sin usuario) y TODA query filtrada por su
user_id. No hay forma de ver ni tocar la conexión de otro.

Además de estar logueado, conectar y sincronizar exigen ver partidos:
`calendar` o `games` con `can_view` (o superadmin). Ver el estado y
desconectar no: alguien a quien le sacaron el permiso tiene que poder cortar
la conexión. El cron vuelve a chequear el permiso en cada corrida.

El flujo OAuth no pasa por ningún endpoint público: Google vuelve a la ruta
`/google/callback` del FRONTEND, que le manda `code` y `state` a
`POST /callback` con el JWT. Van en el body y no en la URL porque el activity
log guarda los query params de los POST.

La lógica (OAuth, cifrado, armado de eventos, sync) vive en
services/google_calendar.py; acá solo permisos, estado y respuestas.
"""
import hmac
import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from api._lib.auth import has_view, require_user
from api._lib.services import google_calendar as gcal

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/me/google-calendar",
    tags=["google-calendar"],
    dependencies=[Depends(require_user)],
)


class CallbackBody(BaseModel):
    code: str = Field(min_length=1, max_length=2048)
    state: str = Field(min_length=1, max_length=256)


def _uid(request: Request) -> str:
    user = getattr(request.state, "user", None) or {}
    uid = user.get("id")
    if not uid:
        raise HTTPException(status_code=401, detail="Authentication required")
    return uid


def _require_games_access(request: Request) -> None:
    if not (has_view(request, "calendar") or has_view(request, "games")):
        raise HTTPException(status_code=403, detail="Missing calendar:view or games:view permission")


def _require_configured() -> None:
    if not gcal.is_configured():
        raise HTTPException(status_code=503, detail="Google Calendar no está configurado en el servidor")


def _public(link: dict | None) -> dict:
    """Lo que ve el frontend. Nunca el token ni el state."""
    link = link or {}
    return {
        "configured": gcal.is_configured(),
        "connected": bool(link.get("refresh_token_enc")),
        "google_email": link.get("google_email"),
        "calendar_id": link.get("calendar_id"),
        "connected_at": link.get("connected_at"),
        "last_synced_at": link.get("last_synced_at"),
        "last_sync_error": link.get("last_sync_error"),
        "events_count": link.get("events_count"),
    }


def _http() -> httpx.Client:
    return httpx.Client(timeout=20)


def _sync_quietly(user_id: str) -> None:
    """Para BackgroundTasks: el error ya queda en last_sync_error."""
    try:
        gcal.sync_user(user_id)
    except gcal.GoogleCalendarError as exc:
        logger.warning("google_calendar: sync inicial de %s falló: %s", user_id, exc)
    except Exception:
        logger.exception("google_calendar: sync inicial de %s falló", user_id)


@router.get("")
def get_status(request: Request):
    # Sin configurar no se toca la tabla: si el código llega antes que la
    # migración 052, la pestaña dice "no configurado" en vez de dar 500.
    if not gcal.is_configured():
        return _public(None)
    return _public(gcal.get_link(_uid(request)))


@router.post("/connect")
def connect(request: Request):
    """Arranca el OAuth: guarda el hash del state y devuelve la URL de Google."""
    _require_games_access(request)
    _require_configured()
    uid = _uid(request)
    state, digest, expires = gcal.new_state()
    gcal.save_link(uid, {"oauth_state_hash": digest, "oauth_state_expires_at": expires.isoformat()})
    return {"auth_url": gcal.auth_url(state)}


@router.post("/callback")
def callback(body: CallbackBody, request: Request, background: BackgroundTasks):
    _require_games_access(request)
    _require_configured()
    uid = _uid(request)
    link = gcal.get_link(uid) or {}

    # El state tiene que ser el que se generó para ESTE usuario y estar vigente.
    # Se consume siempre, salga bien o mal: un state sirve una sola vez.
    expected = link.get("oauth_state_hash") or ""
    expires = link.get("oauth_state_expires_at")
    gcal.save_link(uid, {"oauth_state_hash": None, "oauth_state_expires_at": None})
    if not expected or not hmac.compare_digest(expected, gcal.state_hash(body.state)):
        raise HTTPException(status_code=400, detail="El pedido de conexión no es válido; volvé a intentar")
    if not expires or datetime.fromisoformat(str(expires).replace("Z", "+00:00")) < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="El pedido de conexión venció; volvé a intentar")

    try:
        with _http() as http:
            tokens = gcal.exchange_code(body.code, http)
    except gcal.GoogleCalendarError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="No se pudo conectar con Google")

    fields = {
        "refresh_token_enc": gcal.encrypt_token(tokens["refresh_token"]),
        "google_email": tokens.get("email"),
        "connected_at": datetime.now(timezone.utc).isoformat(),
        "last_sync_error": None,
    }
    # Reconexión con OTRA cuenta de Google: la anterior se revoca (si no, sigue
    # autorizada) y su calendario no se reusa. Con la misma cuenta no se
    # revoca: revocar anula el grant entero, y con él el token recién emitido.
    if link.get("refresh_token_enc") and link.get("google_email") != tokens.get("email"):
        try:
            with _http() as http:
                gcal.revoke(gcal.decrypt_token(link["refresh_token_enc"]), http)
        except gcal.GoogleCalendarError:
            pass
        fields.update({"calendar_id": None, "events_count": None, "last_synced_at": None})
    gcal.save_link(uid, fields)
    # La primera sync crea el calendario y carga los partidos: puede tardar,
    # así que va después de responder.
    background.add_task(_sync_quietly, uid)
    return _public(gcal.get_link(uid))


@router.post("/sync")
def sync_now(request: Request):
    _require_games_access(request)
    _require_configured()
    uid = _uid(request)
    link = gcal.get_link(uid)
    if not link or not link.get("refresh_token_enc"):
        raise HTTPException(status_code=409, detail="La cuenta de Google no está conectada")
    try:
        stats = gcal.sync_user(uid)
    except gcal.SyncPaused as exc:
        raise HTTPException(status_code=403, detail=str(exc))
    except (gcal.GoogleAuthRevoked, gcal.SyncInProgress) as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except gcal.GoogleCalendarError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return {**_public(gcal.get_link(uid)), "stats": stats}


@router.delete("")
def disconnect(request: Request, delete_calendar: bool = True):
    """Revoca el token en Google y, por defecto, borra el calendario de la app.

    Sin `_require_games_access`: cortar la conexión tiene que poder hacerlo
    cualquiera, también alguien que ya no tiene el permiso.
    """
    uid = _uid(request)
    link = gcal.get_link(uid)
    if not link:
        return _public(None)

    if link.get("refresh_token_enc") and gcal.is_configured():
        try:
            with _http() as http:
                refresh = gcal.decrypt_token(link["refresh_token_enc"])
                if delete_calendar and link.get("calendar_id"):
                    try:
                        access = gcal.refresh_access_token(refresh, http)
                        gcal.CalendarClient(access, http).delete_calendar(link["calendar_id"])
                    except gcal.GoogleAuthRevoked:
                        # Google ya revocó el acceso: no se puede borrar, el
                        # calendario queda en la cuenta y la persona lo borra a
                        # mano. Igual se desconecta.
                        pass
                    except gcal.GoogleCalendarError as exc:
                        # Falla transitoria: NO revocar todavía. Con el token
                        # revocado ya no habría forma de borrar el calendario.
                        logger.warning("google_calendar: no se pudo borrar el calendario de %s: %s", uid, exc)
                        raise HTTPException(
                            status_code=502,
                            detail="Google no respondió al borrar el calendario; volvé a intentar o desconectá sin borrarlo",
                        )
                gcal.revoke(refresh, http)
        except gcal.GoogleAuthRevoked:
            pass
        except httpx.HTTPError:
            logger.warning("google_calendar: Google no respondió al desconectar a %s", uid)

    gcal.save_link(uid, {
        "refresh_token_enc": None,
        "calendar_id": None,
        "google_email": None,
        "connected_at": None,
        "last_synced_at": None,
        "last_sync_error": None,
        "events_count": None,
        "oauth_state_hash": None,
        "oauth_state_expires_at": None,
    })
    return _public(gcal.get_link(uid))
