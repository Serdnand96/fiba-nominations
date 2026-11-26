"""Tablero "En vivo" de Partidos: lo que se juega hoy, de todas las competencias.

Lo sirve `GET /games/live` (`routers/games.py`). Tres grupos: en juego, por
jugar hoy y finalizados hoy.

Cosas que se ven raras y son correctas:

- **"Hoy" es el día del war room** (Miami), no el del servidor ni el de la
  sede: una jornada toca varias zonas y quien la sigue está en una sola.
- **Qué está en juego lo decide el instante del partido, no solo `status`.**
  En agosto de 2026 quedaron tres partidos clavados en `live` porque su
  ventana no se volvió a sincronizar: un tablero que confiara en `status` los
  habría mostrado en juego tres meses después.
- **El marcador se le pide a FIBA en el momento**, porque el cron guarda cada
  15 minutos y `game_schedule` no tiene cuarto ni reloj. Se consulta solo por
  las competencias con algún partido que puede estar en juego, una vez por ID
  de FIBA (las ventanas de un clasificatorio comparten ID) y con un cache de
  `FEED_TTL_SECONDS` por proceso. Un día sin partidos en juego no gasta ni una
  llamada a GDAP.
- **No escribe nada.** El que guarda resultados sigue siendo el sync
  (`services/fiba_sync.py`), que además controla equipos invertidos y partidos
  de otra competencia. Si FIBA no responde, el tablero muestra lo que hay en la
  base y lo dice (`fiba_error`).
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Callable
from zoneinfo import ZoneInfo

import httpx

from api._lib.database import supabase
from api._lib.services import fiba_sync

logger = logging.getLogger(__name__)

# La misma zona que WAR_ROOM_TZ en src/lib/warRoom.js. Si el seguimiento se
# muda, se cambian las dos.
WAR_ROOM_TZ = "America/New_York"

# Un partido que empezó hace menos de esto puede seguir en juego. Un partido de
# básquet dura dos horas; cuatro cubre prórrogas y un arranque demorado.
LIVE_WINDOW = timedelta(hours=4)
# FIBA a veces abre el partido unos minutos antes de la hora.
EARLY_START = timedelta(minutes=10)

FEED_TTL_SECONDS = 30
# El tablero se pide cada 30 s: no puede quedarse esperando a FIBA más que eso.
FEED_TIMEOUT_SECONDS = 8.0

_GAME_COLUMNS = (
    "id,competition_id,fiba_game_id,game_number,date,time,datetime_utc,venue_timezone,"
    "team_a,team_a_code,team_b,team_b_code,score_a,score_b,venue,city,country,"
    "phase,group_label,status"
)
_COMPETITION_COLUMNS = "id,name,short_name,template_key,fiba_competition_id,fiba_games_url"

# fiba_competition_id → (cuándo se pidió, partidos | None si FIBA falló)
_feed_cache: dict[int, tuple[float, list[dict] | None]] = {}
_feed_lock = threading.Lock()


# ── FIBA ─────────────────────────────────────────────────────────────────────

def _fetch_feed(fiba_id: int) -> list[dict]:
    with httpx.Client(timeout=FEED_TIMEOUT_SECONDS) as http:
        return fiba_sync.GdapClient(http=http).games(fiba_id)


def cached_feed(fiba_id: int, fetch: Callable[[int], list[dict]] = _fetch_feed,
                clock: Callable[[], float] = time.monotonic) -> list[dict] | None:
    """Los partidos de esa competencia en FIBA, o None si FIBA no respondió.

    El fallo también se guarda: con FIBA caída, cada persona que mira el tablero
    no vuelve a esperar el timeout en cada refresco.
    """
    now = clock()
    with _feed_lock:
        hit = _feed_cache.get(fiba_id)
        if hit and now - hit[0] < FEED_TTL_SECONDS:
            return hit[1]
    try:
        games = fetch(fiba_id)
    except fiba_sync.FibaSyncError as e:
        logger.warning("live_board: FIBA %s no respondió: %s", fiba_id, e)
        games = None
    with _feed_lock:
        _feed_cache[fiba_id] = (now, games)
    return games


def clear_feed_cache() -> None:
    with _feed_lock:
        _feed_cache.clear()


# ── Tablero ──────────────────────────────────────────────────────────────────

def _instant(game: dict) -> datetime | None:
    raw = game.get("datetime_utc")
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _war_room_day(now: datetime) -> tuple[date, datetime, datetime]:
    """El día del war room y sus dos bordes como instantes."""
    zone = ZoneInfo(WAR_ROOM_TZ)
    day = now.astimezone(zone).date()
    start = datetime(day.year, day.month, day.day, tzinfo=zone)
    nxt = day + timedelta(days=1)
    end = datetime(nxt.year, nxt.month, nxt.day, tzinfo=zone)
    return day, start, end


def _may_be_live(game: dict, now: datetime) -> bool:
    """Vale la pena preguntarle a FIBA por este partido."""
    if game.get("status") == "completed":
        return False
    if game.get("status") == "live":
        return True
    at = _instant(game)
    return bool(at and now - LIVE_WINDOW <= at <= now + EARLY_START)


def _bucket(game: dict, now: datetime) -> str:
    status = game.get("status")
    if status == "live":
        return "live"
    if status == "completed":
        return "finished"
    # Terminó y FIBA todavía no validó el resultado: ya no está en juego, tiene
    # marcador y su hora pasó. No es un partido por jugar.
    at = _instant(game)
    if at and at < now - EARLY_START and ((game.get("score_a") or 0) or (game.get("score_b") or 0)):
        return "finished"
    return "upcoming"


def _sort_key(game: dict) -> str:
    at = _instant(game)
    if at:
        return at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M")
    return f"{game.get('date') or '9999-99-99'}T{game.get('time') or '99:99'}"


def _public(game: dict, comp: dict | None) -> dict:
    comp = comp or {}
    return {
        "id": game["id"],
        "competition_id": game.get("competition_id"),
        "competition_name": comp.get("short_name") or comp.get("name"),
        "template_key": comp.get("template_key"),
        "game_number": game.get("game_number"),
        "group_label": game.get("group_label"),
        "phase": game.get("phase"),
        "date": game.get("date"),
        "time": game.get("time"),
        "datetime_utc": game.get("datetime_utc"),
        "venue_timezone": game.get("venue_timezone"),
        "team_a": game.get("team_a"),
        "team_a_code": game.get("team_a_code"),
        "team_b": game.get("team_b"),
        "team_b_code": game.get("team_b_code"),
        "score_a": game.get("score_a"),
        "score_b": game.get("score_b"),
        "status": game.get("status"),
        "period": game.get("period"),
        "clock": game.get("clock"),
        "venue": game.get("venue"),
        "city": game.get("city"),
        "country": game.get("country"),
    }


def _refresh_from_fiba(games: list[dict], comps: dict[str, dict], now: datetime,
                       feed: Callable[[int], list[dict] | None]) -> tuple[bool, bool]:
    """Pisa estado, marcador, cuarto y reloj con lo que dice FIBA ahora.

    Devuelve (se consultó a FIBA, alguna consulta falló).
    """
    wanted: dict[int, list[dict]] = {}
    for g in games:
        if not g.get("fiba_game_id") or not _may_be_live(g, now):
            continue
        fiba_id = fiba_sync.resolve_competition_id(comps.get(g.get("competition_id")) or {})
        if fiba_id:
            wanted.setdefault(fiba_id, []).append(g)

    failed = False
    for fiba_id, ours in wanted.items():
        fiba_games = feed(fiba_id)
        if fiba_games is None:
            failed = True
            continue
        by_id = {str(fg.get("gameId")): fg for fg in fiba_games}
        for g in ours:
            fg = by_id.get(str(g["fiba_game_id"]))
            if not fg:
                continue
            fresh = fiba_sync.fiba_json_to_game(fg)
            g["status"] = fresh["status"]
            g["score_a"] = fresh["score_a"]
            g["score_b"] = fresh["score_b"]
            if fresh["status"] == "live":
                g["period"] = (fg.get("currentPeriod") or "").strip() or None
                g["clock"] = (fg.get("chrono") or "").strip() or None
    return bool(wanted), failed


def _next_game(day: date, now: datetime, on_board: set, comps_seen: dict[str, dict]) -> dict | None:
    """El próximo partido que no está en el tablero, para un día sin nada por jugar."""
    rows = (supabase.table("game_schedule").select(_GAME_COLUMNS)
            .gte("date", day.isoformat()).order("date").limit(60).execute().data or [])

    def is_ahead(g: dict) -> bool:
        if g["id"] in on_board or g.get("status") == "completed":
            return False
        at = _instant(g)
        return at > now if at else (g.get("date") or "") > day.isoformat()

    rows = [g for g in rows if is_ahead(g)]
    if not rows:
        return None
    nxt = min(rows, key=_sort_key)
    comp = comps_seen.get(nxt.get("competition_id"))
    if comp is None:
        found = (supabase.table("competitions").select(_COMPETITION_COLUMNS)
                 .eq("id", nxt.get("competition_id")).execute().data or [])
        comp = found[0] if found else None
    return _public(nxt, comp)


def build_board(now: datetime | None = None,
                feed: Callable[[int], list[dict] | None] = cached_feed) -> dict:
    now = now or datetime.now(timezone.utc)
    day, day_start, day_end = _war_room_day(now)

    # Un solo filtro por columna (el query builder pisa el segundo): se trae por
    # fecha local de la sede con un día de margen a cada lado, que cubre todos
    # los husos de América, y el recorte fino por instante se hace acá.
    dates = [(day + timedelta(days=d)).isoformat() for d in (-1, 0, 1)]
    rows = supabase.table("game_schedule").select(_GAME_COLUMNS).in_("date", dates).execute().data or []

    games = []
    for g in rows:
        at = _instant(g)
        if at:
            if day_start <= at < day_end or now - LIVE_WINDOW <= at <= now:
                games.append(g)
        elif g.get("date") == day.isoformat():
            # Cargado a mano o sin horario en FIBA: solo se sabe su fecha.
            games.append(g)

    comp_ids = sorted({g["competition_id"] for g in games if g.get("competition_id")})
    comps = {
        c["id"]: c for c in (
            supabase.table("competitions").select(_COMPETITION_COLUMNS).in_("id", comp_ids).execute().data or []
        )
    } if comp_ids else {}

    fiba_checked, fiba_error = _refresh_from_fiba(games, comps, now, feed)

    out = {"live": [], "upcoming": [], "finished": []}
    for g in games:
        out[_bucket(g, now)].append(g)
    out["live"].sort(key=_sort_key)
    out["upcoming"].sort(key=_sort_key)
    out["finished"].sort(key=_sort_key, reverse=True)

    board = [
        {**_public(g, comps.get(g.get("competition_id"))), "bucket": bucket}
        for bucket in ("live", "upcoming", "finished") for g in out[bucket]
    ]
    return {
        "now": now.astimezone(timezone.utc).isoformat(),
        "day": day.isoformat(),
        "timezone": WAR_ROOM_TZ,
        "fiba_checked": fiba_checked,
        "fiba_error": fiba_error,
        "games": board,
        # Solo cuando hoy ya no queda nada: es lo que evita una pestaña en blanco.
        "next_game": None if (out["live"] or out["upcoming"])
        else _next_game(day, now, {g["id"] for g in games}, comps),
    }
