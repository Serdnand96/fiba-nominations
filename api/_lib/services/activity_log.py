"""
Server-side activity log: who did what in the admin.

record_activity() runs as a background task scheduled by the middleware in
api/index.py after each successful mutation. Auditing is best-effort by
design: any failure is printed to stderr (journalctl) and never propagates
into the user's request.

Request bodies are deliberately not recorded — they can carry sensitive data
(user passwords, personal details). Method + path + entity id + filtered
query params give enough context to answer "who touched what, when".
"""
import re
import sys
from datetime import datetime, timedelta, timezone
from typing import Optional

from api._lib.database import supabase

RETENTION_DAYS = 180

# Query-param keys that must never be persisted (secrets) — matched as
# substrings, so e.g. "access_token" and "apikey" are both caught.
_SENSITIVE_PARAM = re.compile(r"token|password|secret|key|auth", re.IGNORECASE)

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def parse_path(path: str) -> tuple[Optional[str], Optional[str]]:
    """Split '/api/<module>/...' into (module, first id-looking segment)."""
    segments = [s for s in path.split("/") if s]
    if segments and segments[0] == "api":
        segments = segments[1:]
    if not segments:
        return None, None
    module = segments[0]
    entity_id = next(
        (s for s in segments[1:] if _UUID_RE.match(s) or s.isdigit()),
        None,
    )
    return module, entity_id


def filtered_query_params(params) -> dict:
    """Drop secret-looking keys from a query-params mapping."""
    return {k: v for k, v in params.items() if not _SENSITIVE_PARAM.search(k)}


def record_activity(
    *,
    user_id: Optional[str],
    user_email: Optional[str],
    action: str,
    path: str,
    status: int,
    ip: Optional[str],
    user_agent: Optional[str],
    metadata: Optional[dict],
):
    """Insert one audit row. Never raises."""
    module, entity_id = parse_path(path)
    try:
        supabase.table("activity_log").insert({
            "user_id": user_id,
            "user_email": user_email,
            "action": action,
            "module": module,
            "path": path,
            "entity_id": entity_id,
            "status": status,
            "ip": ip,
            "user_agent": user_agent,
            "metadata": metadata,
        }).execute()
    except Exception as exc:
        print(f"[activity_log] insert failed: {exc}", file=sys.stderr)


def purge_old_entries():
    """Delete rows past RETENTION_DAYS. Runs in background when the log is read,
    so the table self-limits without any cron on the droplet. Never raises."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).isoformat()
    try:
        supabase.table("activity_log").delete().lt("created_at", cutoff).execute()
    except Exception as exc:
        print(f"[activity_log] purge failed: {exc}", file=sys.stderr)
