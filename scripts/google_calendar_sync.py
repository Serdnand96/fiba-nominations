"""Sync automático de los partidos con el Google Calendar de cada usuario.

Lo mismo que el botón "Sincronizar ahora" de Mi perfil → Google Calendar
(services/google_calendar.py), para todos los usuarios conectados. Los partidos
de las competencias activas se calculan UNA vez por corrida y se aplican a cada
calendario; solo se escribe en Google lo que cambió.

Un usuario que falla no corta la corrida: el error queda en
`google_calendar_links.last_sync_error` (lo ve en Mi perfil) y en el log. Un
token revocado además le avisa por la campana.

Uso local:
    ./venv/bin/python scripts/google_calendar_sync.py --dry-run
    ./venv/bin/python scripts/google_calendar_sync.py --user <uuid>

Instalación (droplet, como el resto de los crons de scripts/). Corre a los
minutos 5/20/35/50, después del --live de fiba_sync.py (0/15/30/45), para
llevarse los resultados recién bajados de FIBA:
    sudo touch /var/log/fiba-google-calendar.log
    sudo chown fiba:adm /var/log/fiba-google-calendar.log
    sudo chmod 640 /var/log/fiba-google-calendar.log
    sudo tee /etc/cron.d/fiba-google-calendar <<'CRON'
    5-59/15 * * * * fiba cd /opt/fiba-nominations && ./venv/bin/python scripts/google_calendar_sync.py >> /var/log/fiba-google-calendar.log 2>&1
    CRON

Tail:
    ssh fiba sudo tail -f /var/log/fiba-google-calendar.log
"""
import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from api._lib.services import google_calendar as gcal  # noqa: E402


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}] {msg}", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--user", help="un solo usuario (uuid)")
    parser.add_argument("--dry-run", action="store_true", help="no escribe nada, solo reporta")
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")

    if not gcal.is_configured():
        log("Google Calendar no está configurado (GOOGLE_OAUTH_CLIENT_ID/SECRET, GOOGLE_TOKEN_KEY): nada que hacer")
        return 0

    users = [args.user] if args.user else gcal.connected_user_ids()
    if not users:
        return 0
    desired = gcal.desired_events()
    log(f"start users={len(users)} events={len(desired)}{' DRY-RUN' if args.dry_run else ''}")

    failed = 0
    with httpx.Client(timeout=20) as http:
        for uid in users:
            try:
                s = gcal.sync_user(uid, desired=desired, http=http, dry_run=args.dry_run)
            except (gcal.SyncPaused, gcal.SyncInProgress) as e:
                # No es una falla: le sacaron el permiso, o la está corriendo
                # el botón "Sincronizar ahora" en este momento.
                log(f"skip {uid}: {e}")
                continue
            except gcal.GoogleCalendarError as e:
                failed += 1
                log(f"ERROR {uid}: {e}")
                continue
            except Exception as e:  # noqa: BLE001 — un usuario roto no corta los demás
                failed += 1
                log(f"ERROR {uid}: {type(e).__name__}: {e}")
                continue
            log(f"ok {uid}: created={s['created']} updated={s['updated']} deleted={s['deleted']}"
                f" failed={s['failed']} total={s['total']}")

    log(f"done users={len(users)} failed={failed}")
    return 1 if failed and failed == len(users) else 0


if __name__ == "__main__":
    sys.exit(main())
