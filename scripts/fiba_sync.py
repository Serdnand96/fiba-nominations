"""Sync automático con FIBA: partidos, resultados y fechas de competencias.

Lo mismo que el botón Sync de Games (services/fiba_sync.py), para todas las
competencias vinculadas a FIBA. Dos modos:

    --live   competencias en curso (start_date - 1 ≤ hoy ≤ end_date + 1): los
             resultados del día. Cada 15 minutos.
    --all    todas las vinculadas que no terminaron (y sus fechas): cambios de
             horario, partidos nuevos, fechas de FIBA. Una vez por día.

Una competencia que falla no corta la corrida: el error queda en
`competitions.fiba_sync_error` y en el log.

Uso local:
    ./venv/bin/python scripts/fiba_sync.py --live --dry-run
    ./venv/bin/python scripts/fiba_sync.py --competition <uuid> --dry-run

Instalación (droplet, como el resto de los crons de scripts/):
    sudo touch /var/log/fiba-gdap-sync.log
    sudo chown fiba:adm /var/log/fiba-gdap-sync.log
    sudo chmod 640 /var/log/fiba-gdap-sync.log
    sudo tee /etc/cron.d/fiba-gdap-sync <<'CRON'
    */15 * * * * fiba cd /opt/fiba-nominations && ./venv/bin/python scripts/fiba_sync.py --live >> /var/log/fiba-gdap-sync.log 2>&1
    0 6 * * * fiba cd /opt/fiba-nominations && ./venv/bin/python scripts/fiba_sync.py --all >> /var/log/fiba-gdap-sync.log 2>&1
    CRON

Tail:
    ssh fiba sudo tail -f /var/log/fiba-gdap-sync.log
"""
import argparse
import logging
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from api._lib.database import supabase      # noqa: E402
from api._lib.services import fiba_sync      # noqa: E402
from api._lib.services.notify import notify, module_editors  # noqa: E402


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}] {msg}", flush=True)


def select_competitions(mode: str, competition_id: str | None) -> list[dict]:
    rows = supabase.table("competitions").select("*").execute().data or []
    if competition_id:
        return [r for r in rows if r["id"] == competition_id]

    rows = [r for r in rows if fiba_sync.is_linked(r)]
    today = date.today()
    out = []
    for r in rows:
        start = date.fromisoformat(r["start_date"]) if r.get("start_date") else None
        end = date.fromisoformat(r["end_date"]) if r.get("end_date") else None
        if mode == "live":
            # Un día de margen a cada lado: partidos que terminan pasada la
            # medianoche UTC y husos de toda América.
            if start and end and start - timedelta(days=1) <= today <= end + timedelta(days=1):
                out.append(r)
        else:
            # Sin fechas también entra: es justo la que necesita que FIBA se las dé.
            if not end or end + timedelta(days=1) >= today:
                out.append(r)
    return out


def link_missing_ids(dry_run: bool) -> int:
    """Competencias con URL de FIBA y sin ID: resolverlo y guardarlo.

    Va aparte del sync porque abarca también las que ya terminaron (que --all
    no sincroniza): sin el ID, "Nuevas en FIBA" las ofrecería como nuevas.
    """
    rows = supabase.table("competitions").select("id, fiba_games_url, fiba_competition_id").execute().data or []
    pending = [r for r in rows if not r.get("fiba_competition_id") and (r.get("fiba_games_url") or "").strip()]
    resolved: dict = {}
    linked = 0
    for r in pending:
        url = r["fiba_games_url"].strip()
        if url not in resolved:
            found = fiba_sync.extract_fiba_competition_id(url)
            resolved[url] = int(found) if found else None
        if resolved[url]:
            linked += 1
            if not dry_run:
                supabase.table("competitions").update({"fiba_competition_id": resolved[url]}).eq("id", r["id"]).execute()
        else:
            log(f"   sin ID de FIBA para {r['id']}: {url[:100]}")
    if pending:
        log(f"link ids: {linked}/{len(pending)} competencias vinculadas por ID")
    return linked


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--live", action="store_true", help="competencias en curso (resultados)")
    mode.add_argument("--all", action="store_true", help="todas las vinculadas que no terminaron")
    mode.add_argument("--competition", help="una sola competencia (uuid)")
    parser.add_argument("--dry-run", action="store_true", help="no escribe nada, solo reporta")
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

    if args.all:
        link_missing_ids(args.dry_run)
    comps = select_competitions("live" if args.live else "all", args.competition)
    label = "live" if args.live else ("all" if args.all else "one")
    client = fiba_sync.GdapClient()
    log(f"start mode={label} competitions={len(comps)} source={'gdap' if client.has_gdap else 'hapi'}"
        f"{' DRY-RUN' if args.dry_run else ''}")

    failed = 0
    for comp in comps:
        name = comp.get("short_name") or comp.get("name")
        try:
            r = fiba_sync.sync_competition(comp, client, dry_run=args.dry_run)
        except Exception as e:  # noqa: BLE001 — una competencia rota no corta las demás
            failed += 1
            log(f"ERROR {name} ({comp['id']}): {e}")
            if not args.dry_run:
                fiba_sync.record_sync_error(comp["id"], str(e))
            continue
        filt = []
        if r["window_applied"]:
            filt.append(f"ventana {r['window_code']}")
        if r["group_applied"]:
            filt.append("grupos " + ",".join(r["group_codes"]))
        log(
            f"ok {name}: fiba={r['fiba_competition_id']} feed={r['total_from_fiba']}"
            f"{' [' + '; '.join(filt) + ']' if filt else ''} tramo={r['imported_from_window']}"
            f" synced={r['synced']} created={r['created']} rescheduled={len(r['rescheduled'])}"
            f" mismatches={len(r['mismatches'])} pending={len(r['pending_in_fiba'])}"
            f" errors={len(r['errors'])} fechas={r['fiba_start_date']}..{r['fiba_end_date']}"
        )
        for m in r["rescheduled"]:
            log(f"   movido {m.get('game_number')} {m['game']}: "
                + ", ".join(f"{k} {v['before']} → {v['after']}" for k, v in m["changes"].items()))
        # Con el botón, quien sincroniza ve el reporte. El cron no tiene a quién
        # mostrárselo, y un partido que se mueve arrastra traslados, crew y
        # checklists: aviso a quien edita Games.
        if r["rescheduled"] and not args.dry_run:
            lines = [f"{m.get('game_number') or ''} {m['game']}: "
                     + ", ".join(f"{k} {v['before'] or '—'} → {v['after']}" for k, v in m["changes"].items())
                     for m in r["rescheduled"][:15]]
            notify(
                module_editors("games"),
                "games_rescheduled",
                f"FIBA movió {len(r['rescheduled'])} partido(s) de {name}",
                body="\n".join(lines),
                entity_type="competition", entity_id=comp["id"],
                link="/games",
            )

    log(f"end ok={len(comps) - failed} failed={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
