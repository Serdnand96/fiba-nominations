"""Sync con FIBA: calendario, partidos y resultados (GDAP).

FIBA es la fuente del CRONOGRAMA y del RESULTADO de cada partido, y de las
fechas de cada competencia. Las nominaciones NO salen de acá: las hace este
sistema.

Una competencia de FIBA puede ser varias de las nuestras. El WCQ 2027 son 84
partidos bajo un solo ID y acá son seis ventanas; la LSB 2026 son 40 partidos y
acá son siete competencias (grupos A–D, QF E, QF F, Finals). El tramo de cada
una lo acotan `fiba_window_code` (windowCode) y `fiba_group_codes`
(groupPairingCode). Ver migraciones 040 y 051.

Lo usan dos caminos, con el mismo código:
- `POST /games/sync-results` (botón Sync, `routers/games.py`).
- `scripts/fiba_sync.py` (cron en el droplet).

Fuente: GDAP (`gdap.fiba.basketball`) con `GDAP_API_KEY`. Si la key no está,
los partidos salen del feed de la web pública (`digital-api…/hapi`, con
`FIBA_API_KEY`), que devuelve la misma forma; lo demás (ventanas, fechas de la
competencia, competencias nuevas) necesita GDAP.
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone

import httpx

from api._lib.database import supabase
from api._lib.net import safe_get

logger = logging.getLogger(__name__)

GDAP_BASE = "https://gdap.fiba.basketball"
HAPI_BASE = "https://digital-api.fiba.basketball/hapi"
# Americas en el árbol de zonas de GDAP (/v1/zones). Con includeSubZone trae
# también Centroamérica, Sudamérica y Norteamérica.
AMERICAS_ZONE_ID = 10

# Campos del cronograma que manda FIBA y que el sync pisa sobre lo que haya.
# `phase` NO está: la deriva _detect_phase() y pisaría una fase corregida a mano.
#
# Son también los que se reportan en `rescheduled`: lo que una persona lee y lo
# que arrastra operación (traslados, crew, checklists).
SCHEDULE_FIELDS = ("date", "time", "venue", "city", "country", "group_label", "game_number")

# Se sincronizan igual, pero NO se reportan: son la misma hora contada de otra
# forma —el instante en UTC y la zona de la sede— para poder mostrar el partido
# en la hora del war room. Meterlos en el reporte sería contar cada cambio de
# horario dos veces.
DERIVED_TIME_FIELDS = ("datetime_utc", "venue_timezone")

# round.roundCode de FIBA → la fase que usa el front (PHASE_OPTIONS en Games).
# El 3er puesto no tiene opción propia y va a Classification.
_ROUND_PHASES = {
    "GP": "Group Phase",
    "QF": "Quarterfinals",
    "SF": "Semifinals",
    "3PG": "Classification",
    "F": "Finals",
}


class FibaSyncError(Exception):
    """Algo que el usuario tiene que leer: sin vínculo, FIBA caída, etc."""


# ── Cliente ──────────────────────────────────────────────────────────────────

class GdapClient:
    """Lo que el sync le pide a FIBA, con cache por instancia.

    Una instancia por corrida: el cron sincroniza las seis ventanas del WCQ y
    baja el feed una sola vez.
    """

    def __init__(self, gdap_key: str | None = None, hapi_key: str | None = None, http: httpx.Client | None = None):
        # Las keys se leen al instanciar, no al importar: el script carga el
        # .env con dotenv después de los imports.
        self.gdap_key = (gdap_key if gdap_key is not None else os.environ.get("GDAP_API_KEY", "")).strip()
        self.hapi_key = (hapi_key if hapi_key is not None else os.environ.get("FIBA_API_KEY", "")).strip()
        self._http = http or httpx.Client(timeout=30.0)
        self._cache: dict = {}

    @property
    def has_gdap(self) -> bool:
        return bool(self.gdap_key)

    def _get(self, base: str, path: str, key: str, params: dict | None = None):
        cache_key = (base, path, tuple(sorted((params or {}).items())))
        if cache_key in self._cache:
            return self._cache[cache_key]
        try:
            resp = self._http.get(
                base + path,
                params=params,
                headers={
                    "Ocp-Apim-Subscription-Key": key,
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip, deflate",
                },
            )
        except httpx.HTTPError as e:
            raise FibaSyncError(f"FIBA API no responde ({type(e).__name__})") from e
        if resp.status_code == 404:
            data = None
        elif resp.status_code != 200:
            # El cuerpo va al log, no al mensaje: el mensaje termina en
            # fiba_sync_error, que ve cualquiera con calendar o competitions.
            logger.warning("fiba_sync: %s%s → HTTP %s: %s", base, path, resp.status_code, resp.text[:300])
            raise FibaSyncError(f"FIBA API HTTP {resp.status_code}")
        else:
            data = resp.json()
        self._cache[cache_key] = data
        return data

    def games(self, competition_id: int) -> list[dict]:
        if self.has_gdap:
            data = self._get(GDAP_BASE, f"/v1/competitions/{competition_id}/games", self.gdap_key)
        else:
            logger.warning("fiba_sync: sin GDAP_API_KEY, partidos desde el feed de la web (hapi)")
            data = self._get(HAPI_BASE, "/getgdapgamesbycompetitionid", self.hapi_key,
                             {"gdapCompetitionId": competition_id})
        games = data if isinstance(data, list) else (data or {}).get("games", (data or {}).get("data", []))
        if not isinstance(games, list):
            raise FibaSyncError(f"Unexpected FIBA API format: {type(data).__name__}")
        return [g for g in games if g.get("gameId")]

    def windows(self, competition_id: int) -> list[dict]:
        if not self.has_gdap:
            return []
        return self._get(GDAP_BASE, f"/v1/competitions/{competition_id}/windows", self.gdap_key) or []

    def competition(self, competition_id: int) -> dict | None:
        if not self.has_gdap:
            return None
        return self._get(GDAP_BASE, f"/v1/competitions/{competition_id}", self.gdap_key)

    def americas_competitions(self, from_season: int, to_season: int) -> list[dict]:
        if not self.has_gdap:
            raise FibaSyncError("GDAP_API_KEY no configurada: no se pueden listar competencias de FIBA")
        return self._get(GDAP_BASE, "/v1/competitions", self.gdap_key, {
            "zoneId": AMERICAS_ZONE_ID, "includeSubZone": "true",
            "fromSeason": from_season, "toSeason": to_season,
        }) or []


# ── Vínculo competencia ↔ FIBA ───────────────────────────────────────────────

def extract_fiba_competition_id(fiba_url: str) -> str | None:
    """El competitionId de GDAP a partir de un ID pelado o de la URL del evento."""
    stripped = (fiba_url or "").strip()
    if is_fiba_id(stripped):
        return stripped
    if not stripped:
        return None

    # safe_get es un guard SSRF: rechaza URLs que no sean http(s) y hosts que
    # resuelvan a direcciones internas, revisando cada salto de redirect.
    try:
        resp = safe_get(stripped, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept-Encoding": "gzip, deflate",
        })
        if resp.status_code != 200:
            return None

        html = resp.text

        # El payload RSC trae JSON escapado:
        # \"competitionId\":209032  o  "competitionId":209032
        all_patterns = [
            re.compile(r'\\?"gdapCompetitionId\\?"\s*:\s*\\?"?(\d+)\\?"?'),
            re.compile(r'\\?"competitionId\\?"\s*:\s*\\?"?(\d+)\\?"?'),
            re.compile(r'"gdapCompetitionId"\s*:\s*"?(\d+)"?'),
            re.compile(r'"competitionId"\s*:\s*"?(\d+)"?'),
            re.compile(r'competitionId[=:](\d+)'),
        ]
        for pattern in all_patterns:
            m = pattern.search(html)
            if m:
                return m.group(1)
    except Exception:
        pass

    return None


def is_fiba_id(value: str) -> bool:
    """Un ID de GDAP: solo dígitos ASCII y que entre en un integer de Postgres.

    `str.isdigit()` acepta "²" y después `int()` revienta.
    """
    return bool(re.fullmatch(r"[0-9]{1,9}", value or ""))


def is_linked(comp: dict) -> bool:
    return bool(comp.get("fiba_competition_id") or (comp.get("fiba_games_url") or "").strip())


def resolve_competition_id(comp: dict) -> int | None:
    if comp.get("fiba_competition_id"):
        return int(comp["fiba_competition_id"])
    found = extract_fiba_competition_id(comp.get("fiba_games_url") or "")
    return int(found) if found else None


def parse_codes(raw: str | None) -> list[str]:
    """'37, 38,39 40' → ['37', '38', '39', '40']."""
    return [c for c in re.split(r"[\s,;]+", (raw or "").strip().upper()) if c]


# ── Tramo: ventana y grupos ──────────────────────────────────────────────────

def filter_segment(games: list[dict], window_code: str | None, group_codes: list[str]) -> tuple[list[dict], dict]:
    """Los partidos de ESTA competencia dentro del feed entero de FIBA.

    Los dos filtros fallan del lado seguro: si la competencia declara ventana (o
    grupos) pero NINGÚN partido del feed trae ese campo, no se filtra nada. Un
    feed sin ventanas tiene que devolver sus partidos, no cero — si no, parece
    que FIBA se cayó.

    No se filtra por el rango de fechas de la competencia: W3 de FIBA termina el
    2026-07-08 y la competencia declara hasta el 07-07, y ese filtro se comería
    un partido con TD y VGO asignados (CLAUDE.md, punto 13).
    """
    total = len(games)
    info = {
        "total_from_fiba": total,
        "window_code": window_code,
        "window_applied": False,
        "skipped_other_windows": 0,
        "group_codes": group_codes,
        "group_applied": False,
        "skipped_other_groups": 0,
    }

    if window_code:
        want = window_code.strip().upper()
        if any((g.get("windowCode") or "").strip() for g in games):
            kept = [g for g in games if (g.get("windowCode") or "").strip().upper() == want]
            info["window_applied"] = True
            info["skipped_other_windows"] = len(games) - len(kept)
            games = kept
        else:
            logger.info("fiba_sync: la competencia declara ventana %s pero el feed no trae windowCode; "
                        "no se filtra por ventana", want)

    if group_codes:
        wanted = set(group_codes)
        if any((g.get("groupPairingCode") or "").strip() for g in games):
            kept = [g for g in games if (g.get("groupPairingCode") or "").strip().upper() in wanted]
            info["group_applied"] = True
            info["skipped_other_groups"] = len(games) - len(kept)
            games = kept
        else:
            logger.info("fiba_sync: la competencia declara grupos %s pero el feed no trae groupPairingCode; "
                        "no se filtra por grupo", ",".join(group_codes))

    return games, info


def is_defined(g: dict) -> bool:
    """¿FIBA ya fijó fecha y los dos equipos?

    Los cruces de una fase futura existen en el feed antes de tener fecha y
    equipos: fecha `0001-01-01` y `teamB: null` (hoy, QF F y las Finals de la
    LSB). Insertarlos dejaría filas basura que después no matchean por fecha.
    """
    date = (g.get("gameDateTime") or "")[:10]
    if not date or date.startswith("0001"):
        return False
    for side in ("teamA", "teamB"):
        team = g.get(side) or {}
        if not (team.get("officialName") or team.get("shortName")):
            return False
    return True


# ── Mapeo FIBA → game_schedule ───────────────────────────────────────────────

def utc_iso(raw: str | None) -> str | None:
    """`gameDateTimeUTC` de FIBA → ISO con zona explícita.

    FIBA lo manda sin sufijo ("2026-08-27T23:10:00") aunque el nombre del campo
    diga UTC. Guardarlo así deja que Postgres lo interprete en la zona del
    servidor, que es exactamente el bug que esta columna viene a evitar.
    """
    raw = (raw or "").strip()
    if len(raw) < 19:
        return None
    # Por si algún día viene ya con zona.
    if raw.endswith("Z") or raw[19:].startswith(("+", "-")):
        return raw
    return raw + "Z"


def detect_phase(g: dict) -> str:
    """La fase del partido: round.roundCode si viene, si no la heurística vieja."""
    round_code = ((g.get("round") or {}).get("roundCode") or "").upper()
    if round_code in _ROUND_PHASES:
        return _ROUND_PHASES[round_code]

    name = (g.get("gameName") or "").lower()
    pairing = (g.get("groupPairingCode") or "").lower()

    if "final" in name or "final" in pairing:
        return "Finals"
    if "semi" in name or "semi" in pairing:
        return "Semifinals"
    if "quarter" in name or "qf" in pairing:
        return "Quarterfinals"
    if "class" in name or "class" in pairing:
        return "Classification"
    return "Group Phase"


def fiba_json_to_game(g: dict) -> dict:
    """Un partido de FIBA → fila de game_schedule."""
    # `gameDateTime` es hora LOCAL de la sede; `gameDateTimeUTC` es la otra cara
    # del mismo dato. Va la local a propósito: es la que le sirve al VGO parado
    # en el gimnasio y la que muestra la web de FIBA.
    game_dt = g.get("gameDateTime", "") or ""
    date_str = game_dt[:10] if game_dt else ""
    # hasTimeGameDateTime=false → FIBA todavía no fijó el horario y la parte de
    # hora es relleno. Mejor sin hora que con una inventada: el front ya muestra
    # "--:--".
    has_time = g.get("hasTimeGameDateTime", True)
    time_str = game_dt[11:16] if (has_time and len(game_dt) >= 16) else None
    # El instante real, para poder mostrar el partido en la hora del war room.
    # Sin horario fijado no hay instante que valga: el UTC de esos partidos es
    # el reflejo del mismo relleno.
    datetime_utc = utc_iso(g.get("gameDateTimeUTC")) if has_time else None

    score_a = g.get("teamAScore")
    score_b = g.get("teamBScore")

    # El estado sale de `statusCode`, no del score: FIBA manda 0-0 en todo lo
    # que no se jugó, así que derivarlo del score marcaba como "FINAL 0-0" cada
    # partido futuro. INIT = programado, VALID = resultado oficial.
    status_code = (g.get("statusCode") or "").upper()
    if g.get("isLive", False):
        status = "live"
    elif status_code == "VALID":
        status = "completed"
    elif status_code == "INIT":
        status = "scheduled"
    else:
        # statusCode que no conocemos: volver al score, pero un partido de
        # básquet no termina 0-0.
        status = "completed" if (score_a or 0) or (score_b or 0) else "scheduled"

    team_a = g.get("teamA") or {}
    team_b = g.get("teamB") or {}

    return {
        "fiba_game_id": g.get("gameId"),
        "game_number": g.get("gameName"),
        "date": date_str,
        "time": time_str,
        "datetime_utc": datetime_utc,
        "venue_timezone": g.get("ianaTimeZone") or None,
        # strip: FIBA manda "Club Deportivo Jorge Guzmán " con espacio al final.
        "team_a": (team_a.get("officialName") or team_a.get("shortName", "")).strip(),
        "team_a_code": team_a.get("code", ""),
        "team_b": (team_b.get("officialName") or team_b.get("shortName", "")).strip(),
        "team_b_code": team_b.get("code", ""),
        "score_a": score_a,
        "score_b": score_b,
        "venue": g.get("venueName", ""),
        "city": g.get("hostCity", ""),
        "country": g.get("hostCountry", "") or g.get("country", ""),
        "phase": detect_phase(g),
        "group_label": g.get("groupPairingCode"),
        "status": status,
        "sport": "Basketball",
    }


def team_mismatch(ours: dict, fiba: dict) -> dict | None:
    """¿Nuestra fila y FIBA discrepan en los equipos? Devuelve el detalle o None.

    El caso frecuente es `swapped`: los mismos dos equipos con el local y el
    visitante al revés. Se nota poco a simple vista y se paga caro, porque el
    local define la sede — un partido cargado "COL vs MEX" jugándose en
    Zacatecas es Mexico de local con el nombre invertido.

    `differs` es que FIBA cambió el cruce para ese mismo gameId. Es raro y
    merece que alguien lo mire, no que el sync lo aplique solo.
    """
    ours_pair = ((ours.get("team_a_code") or "").upper(), (ours.get("team_b_code") or "").upper())
    fiba_pair = ((fiba.get("team_a_code") or "").upper(), (fiba.get("team_b_code") or "").upper())
    # Sin códigos de los dos lados no hay comparación posible que valga la pena.
    if not all(ours_pair) or not all(fiba_pair) or ours_pair == fiba_pair:
        return None

    kind = "swapped" if ours_pair == fiba_pair[::-1] else "differs"
    return {
        "game_id": ours["id"],
        "game_number": ours.get("game_number"),
        "date": fiba.get("date") or ours.get("date"),
        "kind": kind,
        "ours": {k: ours.get(k) for k in ("team_a", "team_a_code", "team_b", "team_b_code")},
        # Lo que la UI manda de vuelta por PUT /games/{id} si el usuario acepta.
        "fiba": {k: fiba.get(k) for k in ("team_a", "team_a_code", "team_b", "team_b_code")},
    }


# ── Fechas del tramo ─────────────────────────────────────────────────────────

def segment_dates(client: GdapClient, fiba_id: int, info: dict, games: list[dict]) -> tuple[str | None, str | None]:
    """Inicio y fin que FIBA le da al tramo de esta competencia.

    Ventana → las fechas de la ventana en /windows. Grupos → el primer y último
    partido del grupo (FIBA no publica fechas por grupo). Competencia entera →
    inicio y fin de la competencia. En los tres casos, si FIBA no lo trae, el
    rango de los partidos.
    """
    dates = sorted(g["date"] for g in games if g.get("date"))
    by_games = (dates[0], dates[-1]) if dates else (None, None)

    if info.get("window_applied"):
        want = (info.get("window_code") or "").strip().upper()
        for w in client.windows(fiba_id):
            if (w.get("code") or "").strip().upper() == want:
                return (w.get("startDate") or "")[:10] or None, (w.get("endDate") or "")[:10] or None
        return by_games

    if info.get("group_applied"):
        return by_games

    comp = client.competition(fiba_id) or {}
    if comp.get("start") and comp.get("end"):
        return comp["start"][:10], comp["end"][:10]
    return by_games


# ── Sync ─────────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _same(ours, fiba) -> bool:
    """¿El valor guardado ya es el de FIBA? datetime_utc vuelve de Postgres como
    "2026-10-23T20:10:00+00:00" y FIBA lo da como "…Z": es el mismo instante."""
    if ours == fiba:
        return True
    if isinstance(ours, str) and isinstance(fiba, str) and fiba.endswith("Z"):
        return ours.replace("+00:00", "Z").replace(" ", "T") == fiba
    return False


def record_sync_error(competition_id: str, message: str) -> None:
    """Deja el error a la vista (el cron no tiene a quién mostrárselo)."""
    try:
        supabase.table("competitions").update(
            {"fiba_sync_error": message[:500]}
        ).eq("id", competition_id).execute()
    except Exception:
        logger.exception("fiba_sync: no se pudo registrar el error de %s", competition_id)


def sync_competition(comp: dict, client: GdapClient | None = None, *, dry_run: bool = False) -> dict:
    """Trae de FIBA los partidos del tramo de `comp` y los aplica.

    Actualiza score, estado y cronograma de los que ya existen; crea los que
    faltan; reporta los que cambiaron de horario o sede (`rescheduled`) y los
    cruces con local/visitante distinto (`mismatches`), que NO aplica solo.
    También guarda en la competencia las fechas que FIBA le da al tramo.

    `dry_run` no escribe nada: devuelve el mismo reporte.
    """
    client = client or GdapClient()
    competition_id = comp["id"]

    fiba_id = resolve_competition_id(comp)
    if not fiba_id:
        url = (comp.get("fiba_games_url") or "").strip()
        if url:
            raise FibaSyncError(f"Could not extract FIBA competition ID from: {url[:100]}")
        raise FibaSyncError("Competition has no FIBA link (ID or URL) configured")

    raw = client.games(fiba_id)
    kept, info = filter_segment(raw, comp.get("fiba_window_code"), parse_codes(comp.get("fiba_group_codes")))

    defined = [g for g in kept if is_defined(g)]
    pending = [g.get("gameName") or str(g.get("gameId")) for g in kept if not is_defined(g)]
    games_data = [fiba_json_to_game(g) for g in defined]

    existing = (
        supabase.table("game_schedule").select("*").eq("competition_id", competition_id).execute().data
    ) or []

    synced = 0
    created = 0
    errors = []
    rescheduled = []
    mismatches = []

    for fiba_game in games_data:
        # Primero por fiba_game_id; si no, por fecha + equipos.
        match = None
        if fiba_game.get("fiba_game_id"):
            match = next((e for e in existing if e.get("fiba_game_id") == fiba_game["fiba_game_id"]), None)
        if not match:
            match = next(
                (e for e in existing
                 if e["date"] == fiba_game["date"]
                 and e["team_a"] == fiba_game["team_a"]
                 and e["team_b"] == fiba_game["team_b"]),
                None,
            )

        if match:
            update_data = {}
            if fiba_game.get("score_a") is not None:
                update_data["score_a"] = fiba_game["score_a"]
            if fiba_game.get("score_b") is not None:
                update_data["score_b"] = fiba_game["score_b"]
            if fiba_game.get("status"):
                update_data["status"] = fiba_game["status"]
            # Una fila que matcheó por fecha + equipos queda enganchada al
            # gameId: el próximo sync la encuentra aunque cambie la fecha.
            if fiba_game.get("fiba_game_id") and not match.get("fiba_game_id"):
                update_data["fiba_game_id"] = fiba_game["fiba_game_id"]

            # FIBA es la fuente del CRONOGRAMA, no solo del resultado: un cambio
            # de horario o de sede tiene que llegar.
            #
            # `phase` queda afuera a propósito: pisaría una fase corregida a mano.
            for field in SCHEDULE_FIELDS + DERIVED_TIME_FIELDS:
                value = fiba_game.get(field)
                if value not in (None, ""):
                    update_data[field] = value

            # Un partido que se mueve de hora o de sede arrastra traslados,
            # crew y checklists. Que el sync lo devuelva callado y el desk se
            # entere por el grupo de WhatsApp no sirve.
            moved = {
                field: {"before": match.get(field), "after": update_data[field]}
                for field in SCHEDULE_FIELDS
                if field in update_data and (match.get(field) or None) != (update_data[field] or None)
            }
            if moved:
                rescheduled.append({
                    "game_id": match["id"],
                    "game": f"{match.get('team_a')} vs {match.get('team_b')}",
                    "game_number": match.get("game_number"),
                    "date": update_data.get("date") or match.get("date"),
                    "changes": moved,
                })

            # Los equipos NO se pisan automáticamente: cambiar quién es local
            # cambia la sede, los traslados y el texto de las cartas, así que es
            # una decisión de una persona, no del sync. Se reporta con los dos
            # valores para que la UI ofrezca aplicarlo de un clic.
            mismatch = team_mismatch(match, fiba_game)
            if mismatch:
                mismatches.append(mismatch)

            # Solo si algo cambió: el cron pasa cada 15 minutos y un UPDATE
            # incondicional dejaría updated_at sin sentido.
            changed = {k: v for k, v in update_data.items() if not _same(match.get(k), v)}
            if changed and not dry_run:
                changed["updated_at"] = _now_iso()
                supabase.table("game_schedule").update(changed).eq("id", match["id"]).execute()
            synced += 1
        else:
            record = {"competition_id": competition_id, **fiba_game}
            try:
                if not dry_run:
                    # El botón y el cron pueden correr a la vez: `existing` se
                    # leyó al principio y el otro pudo haberlo insertado.
                    if fiba_game.get("fiba_game_id") and (
                        supabase.table("game_schedule").select("id")
                        .eq("competition_id", competition_id)
                        .eq("fiba_game_id", fiba_game["fiba_game_id"]).execute().data
                    ):
                        synced += 1
                        continue
                    supabase.table("game_schedule").insert(record).execute()
                created += 1
            except Exception as e:
                # No abortar todo el sync por un partido malo, pero tampoco
                # tragarlo: el usuario veía 'created' menor a lo esperado sin
                # ninguna pista de qué partido falló ni por qué.
                logger.warning("fiba_sync: no se pudo insertar partido %s: %s",
                               fiba_game.get("fiba_game_id") or fiba_game.get("team_a"), e)
                errors.append({
                    "game": f"{fiba_game.get('team_a')} vs {fiba_game.get('team_b')} ({fiba_game.get('date')})",
                    "error": str(e),
                })

    fiba_start, fiba_end = segment_dates(client, fiba_id, info, games_data)

    # Un tramo sin ningún partido (ni siquiera pendiente) es casi siempre una
    # ventana o un grupo mal tipeado ("W9"): que se vea, en vez de quedar en
    # verde con cero partidos.
    segment_filtered = info["window_applied"] or info["group_applied"]
    empty_segment = bool(segment_filtered and info["total_from_fiba"] and not kept)
    message = None
    if not info["total_from_fiba"]:
        message = "No games found on FIBA"
    elif empty_segment:
        message = (f"FIBA tiene {info['total_from_fiba']} partidos pero ninguno de este tramo "
                   f"(ventana {comp.get('fiba_window_code') or '-'}, grupos {comp.get('fiba_group_codes') or '-'})")

    comp_update = {
        "fiba_competition_id": fiba_id,
        "fiba_synced_at": _now_iso(),
        "fiba_sync_error": message if empty_segment else None,
    }
    # Sin fechas (tramo todavía sin partidos definidos) no se borran las que ya
    # había: un QF sin fecha hoy no anula lo que FIBA dijo ayer.
    if fiba_start and fiba_end:
        comp_update["fiba_start_date"] = fiba_start
        comp_update["fiba_end_date"] = fiba_end
    # La sede, solo si la competencia no tiene: lo que el equipo cargó a mano
    # gana siempre. Y solo si el tramo se juega en una sede.
    venues = {(g.get("venue"), g.get("city"), g.get("country")) for g in games_data if g.get("venue")}
    if len(venues) == 1:
        venue, city, country = venues.pop()
        if not (comp.get("default_venue") or "").strip():
            comp_update["default_venue"] = venue
        if city and not (comp.get("location") or "").strip():
            comp_update["location"] = f"{city}, {country}" if country else city
    if not dry_run:
        supabase.table("competitions").update(comp_update).eq("id", competition_id).execute()

    return {
        "synced": synced,
        "created": created,
        "errors": errors,
        "rescheduled": rescheduled,
        "mismatches": mismatches,
        # total_from_fiba / window_applied / skipped_other_*: cuántos partidos
        # trajo FIBA y cuántos quedaron afuera por no ser de este tramo. Va al
        # reporte para que "84 en FIBA, 12 importados" se lea como lo correcto
        # que es y no como que se perdió algo.
        **info,
        "imported_from_window": len(games_data),
        # Cruces que FIBA todavía no definió (sin fecha o sin equipos).
        "pending_in_fiba": pending,
        "fiba_competition_id": fiba_id,
        "fiba_start_date": fiba_start,
        "fiba_end_date": fiba_end,
        "source": "gdap" if client.has_gdap else "hapi",
        "dry_run": dry_run,
        **({"message": message} if message else {}),
    }


# ── Competencias nuevas ──────────────────────────────────────────────────────

def discover(client: GdapClient, from_season: int, to_season: int) -> list[dict]:
    """Competencias de FIBA Americas que ninguna de las nuestras tiene vinculadas.

    Solo lista: dar de alta es una decisión de una persona (nombre, plantilla,
    si se divide en ventanas o grupos).
    """
    linked = {
        int(r["fiba_competition_id"])
        for r in (supabase.table("competitions").select("fiba_competition_id").execute().data or [])
        if r.get("fiba_competition_id")
    }
    out = []
    for c in client.americas_competitions(from_season, to_season):
        cid = c.get("competitionId")
        if not cid or int(cid) in linked:
            continue
        host = (c.get("hosts") or [{}])[0] or {}
        cities = host.get("cities") or []
        zone = c.get("zoneInformation") or {}
        out.append({
            "fiba_competition_id": int(cid),
            "name": c.get("officialName"),
            "marketing_name": (c.get("competitionMarketingName") or {}).get("marketingName"),
            "season": c.get("season"),
            "start": (c.get("start") or "")[:10] or None,
            "end": (c.get("end") or "")[:10] or None,
            "status": c.get("status"),
            "zone": zone.get("zoneOfficialName") or c.get("fibaZone"),
            "gender": c.get("gender"),
            "age_category": c.get("ageCategory"),
            "competition_type": c.get("competitionType"),
            "host_city": cities[0] if cities else None,
            "host_country": host.get("countryName"),
        })
    out.sort(key=lambda x: (x["start"] or "9999", x["name"] or ""))
    return out
