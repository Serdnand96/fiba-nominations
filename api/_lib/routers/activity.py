from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Query

from api._lib.auth import require_superadmin
from api._lib.database import supabase
from api._lib.services.activity_log import purge_old_entries

router = APIRouter(prefix="/activity", tags=["activity"])


# ---------------------------------------------------------------------------
# GET /activity — paginated audit trail, newest first. Superadmin only.
# ---------------------------------------------------------------------------
@router.get("", dependencies=[Depends(require_superadmin)])
def list_activity(
    background_tasks: BackgroundTasks,
    user_email: Optional[str] = Query(None, max_length=200),
    module: Optional[str] = Query(None, max_length=50),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,  # inclusive
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    # Retention runs after the response is sent so it never delays the page.
    background_tasks.add_task(purge_old_entries)

    q = supabase.table("activity_log").select("*").order("created_at", desc=True)
    if user_email:
        # Strip PostgREST wildcard chars so user input can't distort the match.
        needle = user_email.strip().replace("*", "").replace(",", "")
        if needle:
            q = q.ilike("user_email", f"*{needle}*")
    if module:
        q = q.eq("module", module)
    if date_from:
        q = q.gte("created_at", date_from.isoformat())
    if date_to:
        q = q.lt("created_at", (date_to + timedelta(days=1)).isoformat())

    # Fetch one extra row to know whether another page exists.
    rows = q.limit(limit + 1).offset(offset).execute().data
    return {"items": rows[:limit], "has_more": len(rows) > limit}
