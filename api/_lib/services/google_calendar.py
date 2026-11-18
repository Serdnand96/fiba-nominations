"""Sync de partidos con el Google Calendar de cada usuario.

Quien tiene `calendar` o `games` conecta su cuenta de Google desde "Mi perfil"
(router `google_calendar.py`, prefijo `/me/google-calendar`). La app crea en esa
cuenta un calendario SECUNDARIO propio, "FIBA Americas — Partidos", y lo
mantiene al día con los partidos de las competencias activas. El principal de
la persona no se toca: el scope `calendar.app.created` solo deja ver y editar
los calendarios que creó la app.

Reglas que se ven raras y son correctas:

- **Sin tabla de mapeo partido ↔ evento.** El ID del evento es
  `"g" + game_id sin guiones`: el hex es un subconjunto del base32hex que acepta
  Google. El hash del contenido viaja en `extendedProperties.private.fiba_hash`
  y solo se escribe lo que cambió.
- **"Activa" = `end_date >= hoy - 3 días`.** Los días de gracia son para el
  resultado del último partido: en América termina de noche, que en el reloj
  UTC del servidor ya es el día siguiente. Cuando una competencia sale de ese
  rango sus eventos SE QUEDAN en Google como historial (con el resultado): solo
  se borra un evento si su partido ya no existe en `game_schedule`.
- **Una sync por usuario a la vez** (`sync_started_at`, claim atómico) y el
  `calendar_id` se guarda apenas se crea el calendario: si no, una sync cortada
  o dos en paralelo le dejan a la persona calendarios duplicados.
- **La hora sale de `datetime_utc`** (CLAUDE.md punto 12), nunca de sumar un
  offset a `date`/`time`. Sin `datetime_utc`, o con el `'00:00'` de relleno, el
  partido va como evento de día completo: no se inventa una hora.
- Los eventos van `transparent`: un partido no marca a la persona como ocupada.
- El refresh token se guarda cifrado con Fernet (`GOOGLE_TOKEN_KEY`). Si la
  clave cambia, el token viejo no se puede leer y la conexión queda como
  revocada: hay que reconectar, no hay nada que migrar.

Todo pega a Google con httpx, sin la librería de Google. Las funciones puras
(`event_for_game`, `plan_sync`) no tocan red ni base: son las que cubren los
tests.
"""
import base64
import hashlib
import json
import logging
import os
import secrets
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote, urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken

from api._lib.crew import is_tournament_mode, list_crew
from api._lib.database import SupabaseError, supabase
from api._lib.services.notify import notify

logger = logging.getLogger(__name__)

SCOPES = (
    "openid",
    "email",
    "https://www.googleapis.com/auth/calendar.app.created",
)
_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
_API = "https://www.googleapis.com/calendar/v3"

CALENDAR_NAME = "FIBA Americas — Partidos"
GAME_DURATION = timedelta(hours=2)
STATE_TTL = timedelta(minutes=10)
ACTIVE_GRACE = timedelta(days=3)
# Una sync que lleva más que esto se da por muerta (el proceso se cayó sin
# liberar el claim) y otra puede tomar su lugar.
SYNC_LEASE = timedelta(minutes=10)
TABLE = "google_calendar_links"

_PUBLIC_BASE = (os.environ.get("PUBLIC_APP_URL") or "https://www.fibaapp.com").rstrip("/")
# Las listas de IDs van en la URL de PostgREST (?id=in.(...)): en tandas, para
# no pasarse del largo de URL con una competencia de 84 partidos y más.
_CHUNK = 80
# Las competencias van en tandas chicas: cada una trae hasta ~84 partidos y
# PostgREST corta en 1000 filas por respuesta.
_COMP_CHUNK = 10
_RETRIES = 3


class GoogleCalendarError(Exception):
    """Falla hablando con Google. El mensaje se guarda en `last_sync_error`."""


class GoogleAuthRevoked(GoogleCalendarError):
    """El refresh token ya no sirve (revocado, vencido o clave cambiada)."""


class NotConfigured(GoogleCalendarError):
    """Faltan las variables de entorno de Google en el servidor."""


class SyncPaused(GoogleCalendarError):
    """El usuario ya no tiene `calendar` ni `games`: no se sincroniza."""


class SyncInProgress(GoogleCalendarError):
    """Ya hay otra sync corriendo para este usuario."""


# ─── Configuración y cifrado ─────────────────────────────────────────────────

def _client_config() -> tuple[str, str, str]:
    client_id = (os.environ.get("GOOGLE_OAUTH_CLIENT_ID") or "").strip()
    secret = (os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET") or "").strip()
    redirect = (os.environ.get("GOOGLE_OAUTH_REDIRECT_URI") or f"{_PUBLIC_BASE}/google/callback").strip()
    if not client_id or not secret or not os.environ.get("GOOGLE_TOKEN_KEY"):
        raise NotConfigured("Google Calendar no está configurado en el servidor")
    return client_id, secret, redirect


def is_configured() -> bool:
    try:
        _client_config()
        _fernet()
    except NotConfigured:
        return False
    return True


def _fernet() -> Fernet:
    key = (os.environ.get("GOOGLE_TOKEN_KEY") or "").strip()
    if not key:
        raise NotConfigured("Falta GOOGLE_TOKEN_KEY")
    try:
        return Fernet(key.encode())
    except ValueError as exc:
        raise NotConfigured("GOOGLE_TOKEN_KEY no es una clave Fernet válida") from exc


def encrypt_token(token: str) -> str:
    return _fernet().encrypt(token.encode()).decode()


def decrypt_token(blob: str) -> str:
    try:
        return _fernet().decrypt(blob.encode()).decode()
    except InvalidToken as exc:
        raise GoogleAuthRevoked("El token guardado no se puede leer; reconectá la cuenta") from exc


def new_state() -> tuple[str, str, datetime]:
    """(state para Google, su hash para la base, vencimiento)."""
    state = secrets.token_urlsafe(32)
    return state, state_hash(state), datetime.now(timezone.utc) + STATE_TTL


def state_hash(state: str) -> str:
    return hashlib.sha256(state.encode()).hexdigest()


# ─── OAuth ───────────────────────────────────────────────────────────────────

def auth_url(state: str) -> str:
    client_id, _, redirect = _client_config()
    params = {
        "client_id": client_id,
        "redirect_uri": redirect,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        # offline + consent: sin esto Google no manda refresh token cuando la
        # persona ya había autorizado antes (p.ej. después de desconectar).
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return f"{_AUTH_URL}?{urlencode(params)}"


def _email_from_id_token(id_token: Optional[str]) -> Optional[str]:
    # El id_token llega directo del token endpoint de Google por TLS: no hace
    # falta validar la firma para leer el email (lo dice la doc de Google).
    if not id_token or id_token.count(".") != 2:
        return None
    payload = id_token.split(".")[1]
    try:
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (ValueError, json.JSONDecodeError):
        return None
    return data.get("email")


def exchange_code(code: str, http: httpx.Client) -> dict:
    """code → {refresh_token, access_token, email}."""
    client_id, secret, redirect = _client_config()
    resp = http.post(_TOKEN_URL, data={
        "code": code,
        "client_id": client_id,
        "client_secret": secret,
        "redirect_uri": redirect,
        "grant_type": "authorization_code",
    })
    if resp.status_code != 200:
        raise GoogleCalendarError(f"Google rechazó el código de autorización ({resp.status_code})")
    try:
        data = resp.json()
    except ValueError as exc:
        raise GoogleCalendarError("Google devolvió una respuesta inválida") from exc
    granted = set((data.get("scope") or "").split())
    if SCOPES[2] not in granted:
        # Consentimiento granular: la persona destildó el calendario. El token
        # que Google ya emitió no sirve para nada: se revoca en vez de dejarlo vivo.
        revoke(data.get("refresh_token") or data.get("access_token") or "", http)
        raise GoogleCalendarError("No se otorgó el permiso de calendario")
    if not data.get("refresh_token"):
        raise GoogleCalendarError("Google no devolvió un refresh token")
    return {
        "refresh_token": data["refresh_token"],
        "access_token": data.get("access_token"),
        "email": _email_from_id_token(data.get("id_token")),
    }


def refresh_access_token(refresh_token: str, http: httpx.Client) -> str:
    client_id, secret, _ = _client_config()
    resp = http.post(_TOKEN_URL, data={
        "refresh_token": refresh_token,
        "client_id": client_id,
        "client_secret": secret,
        "grant_type": "refresh_token",
    })
    if resp.status_code == 200:
        try:
            return resp.json()["access_token"]
        except (ValueError, KeyError) as exc:
            raise GoogleCalendarError("Google devolvió una respuesta inválida") from exc
    try:
        error = resp.json().get("error")
    except ValueError:
        error = None
    if error in ("invalid_grant", "unauthorized_client"):
        raise GoogleAuthRevoked("Google revocó el acceso; reconectá la cuenta")
    raise GoogleCalendarError(f"No se pudo renovar el acceso a Google ({resp.status_code})")


def revoke(token: str, http: httpx.Client) -> None:
    """Best-effort: si Google ya lo había revocado, no importa."""
    if not token:
        return
    try:
        http.post(_REVOKE_URL, data={"token": token})
    except httpx.HTTPError:
        logger.warning("google_calendar: no se pudo revocar el token en Google")


# ─── Cliente de la Calendar API ──────────────────────────────────────────────

class CalendarClient:
    def __init__(self, access_token: str, http: httpx.Client, sleep=None):
        self._http = http
        self._headers = {"Authorization": f"Bearer {access_token}"}
        self._sleep = sleep or (lambda s: time.sleep(s))

    def _request(self, method: str, path: str, ok=(200, 204), **kwargs) -> httpx.Response:
        for attempt in range(_RETRIES):
            resp = self._http.request(method, f"{_API}{path}", headers=self._headers, **kwargs)
            if resp.status_code in ok:
                return resp
            # 429, el 403 de rateLimitExceeded y los 5xx se reintentan con
            # backoff; el resto es un error de verdad.
            if (resp.status_code == 429 or resp.status_code >= 500
                    or (resp.status_code == 403 and "ateLimitExceeded" in resp.text)):
                self._sleep(2 ** attempt)
                continue
            if resp.status_code == 401:
                raise GoogleAuthRevoked("Google rechazó el acceso; reconectá la cuenta")
            raise GoogleCalendarError(f"Google Calendar respondió {resp.status_code} en {method} {path.split('?')[0]}")
        raise GoogleCalendarError(f"Google Calendar no respondió ({resp.status_code}); se reintenta en la próxima sync")

    def create_calendar(self) -> str:
        resp = self._request("POST", "/calendars", json={
            "summary": CALENDAR_NAME,
            "description": f"Partidos de las competencias activas. Lo mantiene {_PUBLIC_BASE}: no edites estos eventos, los cambios se pierden cuando cambia el partido.",
        })
        return resp.json()["id"]

    def calendar_exists(self, calendar_id: str) -> bool:
        resp = self._request("GET", f"/calendars/{quote(calendar_id, safe='')}", ok=(200, 404, 410))
        return resp.status_code == 200

    def delete_calendar(self, calendar_id: str) -> None:
        self._request("DELETE", f"/calendars/{quote(calendar_id, safe='')}", ok=(200, 204, 404, 410))

    def list_events(self, calendar_id: str) -> list[dict]:
        cal = quote(calendar_id, safe="")
        out: list[dict] = []
        page = None
        while True:
            params = {"privateExtendedProperty": "fiba=1", "maxResults": 2500, "showDeleted": "false"}
            if page:
                params["pageToken"] = page
            data = self._request("GET", f"/calendars/{cal}/events", params=params).json()
            out.extend(data.get("items") or [])
            page = data.get("nextPageToken")
            if not page:
                return out

    def insert_event(self, calendar_id: str, body: dict) -> None:
        cal = quote(calendar_id, safe="")
        resp = self._request("POST", f"/calendars/{cal}/events", ok=(200, 409), json=body)
        if resp.status_code == 409:
            # El ID ya existe: un evento que se borró (Google lo guarda como
            # cancelado) o una sync en paralelo. Se restaura con un update.
            self.update_event(calendar_id, {**body, "status": "confirmed"})

    def update_event(self, calendar_id: str, body: dict) -> None:
        cal = quote(calendar_id, safe="")
        self._request("PUT", f"/calendars/{cal}/events/{body['id']}", json=body)

    def delete_event(self, calendar_id: str, event_id: str) -> None:
        cal = quote(calendar_id, safe="")
        self._request("DELETE", f"/calendars/{cal}/events/{event_id}", ok=(200, 204, 404, 410))


# ─── Funciones puras ─────────────────────────────────────────────────────────

def event_id_for(game_id: str) -> str:
    """ID de evento determinístico. Google pide base32hex (a-v, 0-9), 5-1024."""
    return "g" + str(game_id).replace("-", "").lower()


def _is_timed(game: dict) -> bool:
    # '00:00' en `time` es relleno de "FIBA no fijó horario", no medianoche.
    return bool(game.get("datetime_utc")) and (game.get("time") or "")[:5] != "00:00"


def _team(game: dict, side: str) -> str:
    return (game.get(f"team_{side}_code") or game.get(f"team_{side}") or "TBD").strip()


def event_for_game(game: dict, competition: dict, crew: list[tuple[str, str]]) -> dict:
    """El evento de Google para un partido. `crew` = [(cargo, nombre), ...]."""
    a, b = _team(game, "a"), _team(game, "b")
    score_a, score_b = game.get("score_a"), game.get("score_b")
    if game.get("status") == "completed" and score_a is not None and score_b is not None:
        title = f"{a} {score_a}–{score_b} {b}"
    else:
        title = f"{a} vs {b}"
    comp_label = competition.get("short_name") or competition.get("name") or ""
    if comp_label:
        title = f"{title} · {comp_label}"

    lines = [competition.get("name") or ""]
    detail = " · ".join(x for x in (game.get("phase"), game.get("game_number")) if x)
    if detail:
        lines.append(detail)
    full_a, full_b = game.get("team_a"), game.get("team_b")
    if full_a and full_b and (full_a, full_b) != (a, b):
        lines.append(f"{full_a} vs {full_b}")
    if _is_timed(game):
        tz = game.get("venue_timezone")
        lines.append(f"Hora local de la sede: {(game.get('time') or '')[:5]}" + (f" ({tz})" if tz else ""))
    else:
        lines.append("Horario a confirmar por FIBA")
    for role, name in crew:
        lines.append(f"{role}: {name}")
    lines += ["", f"{_PUBLIC_BASE}/games"]

    body: dict = {
        "id": event_id_for(game["id"]),
        "summary": title,
        "description": "\n".join(l for l in lines if l is not None),
        "location": ", ".join(x for x in (game.get("venue"), game.get("city"), game.get("country")) if x),
        "transparency": "transparent",
    }
    if _is_timed(game):
        start = datetime.fromisoformat(str(game["datetime_utc"]).replace("Z", "+00:00")).astimezone(timezone.utc)
        tz = game.get("venue_timezone") or "UTC"
        body["start"] = {"dateTime": start.isoformat(), "timeZone": tz}
        body["end"] = {"dateTime": (start + GAME_DURATION).isoformat(), "timeZone": tz}
    else:
        day = date.fromisoformat(str(game["date"])[:10])
        body["start"] = {"date": day.isoformat()}
        body["end"] = {"date": (day + timedelta(days=1)).isoformat()}

    digest = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
    body["extendedProperties"] = {"private": {"fiba": "1", "game_id": str(game["id"]), "fiba_hash": digest}}
    return body


def _hash_of(event: dict) -> Optional[str]:
    return ((event.get("extendedProperties") or {}).get("private") or {}).get("fiba_hash")


def _game_id_of(event: dict) -> Optional[str]:
    return ((event.get("extendedProperties") or {}).get("private") or {}).get("game_id")


def plan_sync(desired: dict[str, dict], existing: list[dict], live_game_ids: set[str]) -> dict:
    """Qué crear, actualizar y borrar.

    `desired`: event_id → body (partidos de competencias activas).
    `existing`: los eventos que hoy tiene el calendario.
    `live_game_ids`: de los partidos de `existing` que NO están en `desired`,
    los que siguen existiendo en `game_schedule`. Esos se dejan: son de una
    competencia que terminó y quedan como historial.
    """
    by_id = {e["id"]: e for e in existing if e.get("id")}
    create = [body for eid, body in desired.items() if eid not in by_id]
    update = [body for eid, body in desired.items() if eid in by_id and _hash_of(by_id[eid]) != _hash_of(body)]
    delete = [
        eid for eid, e in by_id.items()
        if eid not in desired and _game_id_of(e) not in live_game_ids
    ]
    return {"create": create, "update": update, "delete": delete}


# ─── Datos ───────────────────────────────────────────────────────────────────

def _chunks(items: list, size: int = _CHUNK):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _crew_for_games(competitions: dict[str, dict], games: list[dict]) -> dict[str, list[tuple[str, str]]]:
    """game_id → [(cargo, nombre)]: por partido si hay filas, si no el crew del
    torneo en modo `tournament` (CLAUDE.md punto 9)."""
    per_game: dict[str, list[tuple[str, str]]] = {}
    ids = [g["id"] for g in games]
    for chunk in _chunks(ids):
        rows = (
            supabase.table("game_assignments")
            .select("game_id, role, personnel(name)")
            .in_("game_id", chunk)
            .execute()
            .data
        ) or []
        for r in rows:
            name = (r.get("personnel") or {}).get("name")
            if name:
                per_game.setdefault(r["game_id"], []).append((r.get("role") or "", name))

    tournament_crew: dict[str, list[tuple[str, str]]] = {}
    for cid, comp in competitions.items():
        if is_tournament_mode(comp):
            tournament_crew[cid] = [
                (c.get("role") or "", (c.get("personnel") or {}).get("name"))
                for c in list_crew(cid)
                if (c.get("personnel") or {}).get("name")
            ]

    out = {}
    for g in games:
        rows = per_game.get(g["id"], [])
        base = tournament_crew.get(g.get("competition_id"))
        if base is None:
            crew = rows                       # per_game: solo lo asignado al partido
        else:
            # tournament: la fila por partido es un override de SU cargo (quién
            # estuvo en la mesa); el resto del crew del torneo sigue.
            overridden = {role for role, _ in rows}
            crew = [c for c in base if c[0] not in overridden] + rows
        out[g["id"]] = sorted(crew)
    return out


def desired_events(today: Optional[date] = None) -> dict[str, dict]:
    """event_id → body para los partidos de las competencias activas.

    Es lo mismo para todos los usuarios: el cron lo calcula una vez por corrida.
    """
    today = today or datetime.now(timezone.utc).date()
    comps = (
        supabase.table("competitions")
        .select("id, name, short_name, end_date, fee_type")
        .gte("end_date", (today - ACTIVE_GRACE).isoformat())
        .execute()
        .data
    ) or []
    by_id = {c["id"]: c for c in comps}
    if not by_id:
        return {}
    games: list[dict] = []
    for chunk in _chunks(list(by_id), _COMP_CHUNK):
        games += (
            supabase.table("game_schedule")
            .select("id, competition_id, game_number, date, time, datetime_utc, venue_timezone, "
                    "team_a, team_a_code, team_b, team_b_code, score_a, score_b, venue, city, "
                    "country, phase, status")
            .in_("competition_id", chunk)
            .execute()
            .data
        ) or []
    games = [g for g in games if g.get("date")]
    crew = _crew_for_games(by_id, games)
    out = {}
    for g in games:
        body = event_for_game(g, by_id[g["competition_id"]], crew.get(g["id"], []))
        out[body["id"]] = body
    return out


def _existing_game_ids(game_ids: list[str]) -> set[str]:
    found: set[str] = set()
    for chunk in _chunks([g for g in game_ids if g]):
        rows = supabase.table("game_schedule").select("id").in_("id", chunk).execute().data or []
        found |= {r["id"] for r in rows}
    return found


def user_can_sync(user_id: str) -> bool:
    """¿Superadmin, o `can_view` sobre `calendar` o `games`? Para el cron, que
    no tiene request: la misma regla que el router aplica con has_view()."""
    profile = (
        supabase.table("user_profiles").select("is_superadmin").eq("user_id", user_id).execute().data
    ) or []
    if profile and profile[0].get("is_superadmin"):
        return True
    perms = (
        supabase.table("user_permissions")
        .select("module, can_view")
        .eq("user_id", user_id)
        .in_("module", ["calendar", "games"])
        .execute()
        .data
    ) or []
    return any(p.get("can_view") for p in perms)


def get_link(user_id: str) -> Optional[dict]:
    rows = supabase.table(TABLE).select("*").eq("user_id", user_id).execute().data or []
    return rows[0] if rows else None


def save_link(user_id: str, fields: dict) -> None:
    fields = {**fields, "updated_at": datetime.now(timezone.utc).isoformat()}
    if get_link(user_id):
        supabase.table(TABLE).update(fields).eq("user_id", user_id).execute()
        return
    try:
        supabase.table(TABLE).insert({"user_id": user_id, **fields}).execute()
    except SupabaseError as exc:
        # Dos requests a la vez sin fila previa (doble clic en Conectar): el
        # segundo choca con la PK y pasa a update.
        if exc.pg_code != "23505":
            raise
        supabase.table(TABLE).update(fields).eq("user_id", user_id).execute()


def _claim_sync(user_id: str) -> bool:
    """Toma la sync del usuario. Cada PATCH es atómico en Postgres: si dos
    procesos llegan juntos, solo uno ve la fila con el claim libre."""
    now = datetime.now(timezone.utc)
    stamp = {"sync_started_at": now.isoformat()}
    if supabase.table(TABLE).update(stamp).eq("user_id", user_id).is_("sync_started_at", "null").execute().data:
        return True
    stale = (now - SYNC_LEASE).isoformat()
    return bool(
        supabase.table(TABLE).update(stamp).eq("user_id", user_id).lt("sync_started_at", stale).execute().data
    )


def _release_sync(user_id: str) -> None:
    supabase.table(TABLE).update({"sync_started_at": None}).eq("user_id", user_id).execute()


def forget_user(user_id: str, http: Optional[httpx.Client] = None) -> None:
    """Al borrar un usuario: revocar su token en Google y borrar la fila.
    Best-effort: nunca rompe el borrado del usuario."""
    try:
        link = get_link(user_id)
        if link and link.get("refresh_token_enc") and is_configured():
            with (http or httpx.Client(timeout=20)) as client:
                revoke(decrypt_token(link["refresh_token_enc"]), client)
    except Exception:  # noqa: BLE001
        logger.warning("google_calendar: no se pudo revocar el token de %s", user_id)
    try:
        supabase.table(TABLE).delete().eq("user_id", user_id).execute()
    except Exception:  # noqa: BLE001
        logger.warning("google_calendar: no se pudo borrar la conexión de %s", user_id)


# ─── Orquestación ────────────────────────────────────────────────────────────

def sync_user(user_id: str, desired: Optional[dict] = None, http: Optional[httpx.Client] = None,
              dry_run: bool = False) -> dict:
    """Sincroniza el calendario de un usuario y deja el resultado en su fila.

    Devuelve {created, updated, deleted, failed, total} o levanta
    GoogleCalendarError (con el mensaje ya guardado en `last_sync_error`). Un
    token revocado borra el refresh token guardado y avisa por la campana.

    Un evento que Google rechaza no corta la sync de los demás: se cuenta en
    `failed` y queda como error. Un token revocado sí corta todo.
    """
    link = get_link(user_id)
    if not link or not link.get("refresh_token_enc"):
        raise GoogleCalendarError("La cuenta de Google no está conectada")
    if not dry_run and not _claim_sync(user_id):
        raise SyncInProgress("Ya hay una sincronización en curso")

    own_http = http is None
    http = http or httpx.Client(timeout=20)
    try:
        if not user_can_sync(user_id):
            raise SyncPaused("Sin permiso de calendar o games: la sync está pausada")
        token = refresh_access_token(decrypt_token(link["refresh_token_enc"]), http)
        client = CalendarClient(token, http)

        calendar_id = link.get("calendar_id")
        if not calendar_id or not client.calendar_exists(calendar_id):
            # Primera vez, o la persona borró el calendario a mano desde Google.
            # Se guarda YA: si la carga de eventos se corta a mitad, la próxima
            # sync sigue en este calendario en vez de crear otro.
            calendar_id = None if dry_run else client.create_calendar()
            if calendar_id:
                save_link(user_id, {"calendar_id": calendar_id})
            existing = []
        else:
            existing = client.list_events(calendar_id)

        desired = desired_events() if desired is None else desired
        orphans = [_game_id_of(e) for e in existing if e.get("id") not in desired]
        plan = plan_sync(desired, existing, _existing_game_ids(orphans))
        if dry_run:
            return {
                "created": len(plan["create"]),
                "updated": len(plan["update"]),
                "deleted": len(plan["delete"]),
                "failed": 0,
                "total": len(existing) + len(plan["create"]) - len(plan["delete"]),
            }

        stats = {"created": 0, "updated": 0, "deleted": 0, "failed": 0}
        steps = (
            [("created", client.insert_event, body) for body in plan["create"]]
            + [("updated", client.update_event, body) for body in plan["update"]]
            + [("deleted", client.delete_event, eid) for eid in plan["delete"]]
        )
        for key, call, arg in steps:
            try:
                call(calendar_id, arg)
                stats[key] += 1
            except GoogleAuthRevoked:
                raise
            except GoogleCalendarError as exc:
                stats["failed"] += 1
                logger.warning("google_calendar: %s %s de %s falló: %s",
                               key, arg if isinstance(arg, str) else arg.get("id"), user_id, exc)
        stats["total"] = len(existing) + stats["created"] - stats["deleted"]

        save_link(user_id, {
            "calendar_id": calendar_id,
            "last_synced_at": datetime.now(timezone.utc).isoformat(),
            "last_sync_error": (
                f"{stats['failed']} partidos no se pudieron sincronizar; se reintentan en la próxima sync"
                if stats["failed"] else None
            ),
            "events_count": stats["total"],
        })
        return stats
    except GoogleAuthRevoked as exc:
        if not dry_run:
            save_link(user_id, {"refresh_token_enc": None, "last_sync_error": str(exc)})
            notify(user_id, "google_calendar_revoked", "Google Calendar se desconectó",
                   body=str(exc), link="/?profile=google")
        raise
    except GoogleCalendarError as exc:
        if not dry_run:
            save_link(user_id, {"last_sync_error": str(exc)})
        raise
    except httpx.HTTPError as exc:
        message = "No se pudo conectar con Google; se reintenta en la próxima sync"
        if not dry_run:
            save_link(user_id, {"last_sync_error": message})
        raise GoogleCalendarError(message) from exc
    except Exception:
        # Cualquier otra cosa (p.ej. Supabase): que quede un error visible, si
        # no el panel se queda en "Cargando partidos..." para siempre.
        if not dry_run:
            try:
                save_link(user_id, {"last_sync_error": "Error interno al sincronizar; se reintenta en la próxima sync"})
            except Exception:  # noqa: BLE001
                pass
        raise
    finally:
        if not dry_run:
            try:
                _release_sync(user_id)
            except Exception:  # noqa: BLE001 — el lease vence solo
                logger.warning("google_calendar: no se pudo liberar la sync de %s", user_id)
        if own_http:
            http.close()


def connected_user_ids() -> list[str]:
    rows = (
        supabase.table(TABLE).select("user_id").not_is("refresh_token_enc", "null").execute().data
    ) or []
    return [r["user_id"] for r in rows]
