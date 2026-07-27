"""Competition Reports — centralized post-event documentation.

Each report hangs off a competition, records the venue and the LOC (Local
Organizing Committee) it belongs to, and carries the actual documents. The
point of the module is retrieval: when planning a future event the team wants
to pull up "everything we have for this competition / this venue / this LOC",
so those three are the primary filters.

Files live in the private `nominations` bucket under `reports/<report_id>/`
and are served back as authenticated blobs — the bucket is private, the
frontend never builds a public URL.
"""
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response

from api._lib.auth import require_edit, require_view
from api._lib.database import supabase
from api._lib.schemas import CompetitionReportCreate, CompetitionReportUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reports", tags=["reports"], dependencies=[Depends(require_view("reports"))])

_BUCKET = "nominations"
_PREFIX = "reports"
_MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB — final reports carry photos
_SAFE_FILENAME_RE = re.compile(r"[^\w\s\-\.\(\)]")

# Post-event documentation is PDFs, Office documents and photos.
_ALLOWED_CONTENT = (
    "application/pdf",
    "image/",
    "application/msword",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "text/plain",
    "text/csv",
)


def _user_id(request: Request) -> Optional[str]:
    user = getattr(request.state, "user", None)
    if isinstance(user, dict):
        return user.get("id")
    return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _valid_type(code: str) -> bool:
    row = supabase.table("competition_report_types").select("code").eq("code", code).eq("active", True).execute().data
    return bool(row)


# ─── Storage helpers (private bucket) ────────────────────────────────────────
def _extract_storage_key(storage_path: Optional[str]) -> Optional[str]:
    """Object key inside the `nominations` bucket for any supported path format."""
    if not storage_path:
        return None
    if storage_path.startswith(f"storage://{_BUCKET}/"):
        return storage_path[len(f"storage://{_BUCKET}/"):]
    if f"/storage/v1/object/public/{_BUCKET}/" in storage_path:
        return storage_path.split(f"/storage/v1/object/public/{_BUCKET}/", 1)[1]
    if f"/storage/v1/object/{_BUCKET}/" in storage_path:
        return storage_path.split(f"/storage/v1/object/{_BUCKET}/", 1)[1]
    return None


def _delete_from_storage(storage_path: Optional[str]) -> None:
    """Best-effort removal of a report document."""
    key = _extract_storage_key(storage_path)
    if not key:
        return
    try:
        supabase.storage.from_(_BUCKET).remove([key])
    except Exception as e:
        logger.warning(f"[storage cleanup] could not remove {key}: {e}")


def _shape_report(row: dict) -> dict:
    """Flatten the nested competition into flat fields the table can render."""
    comp = row.pop("competitions", None) or {}
    row["competition_name"] = comp.get("name")
    row["competition_year"] = comp.get("year")
    return row


# ─── Report types catalogue ──────────────────────────────────────────────────
@router.get("/types")
def list_report_types():
    return (
        supabase.table("competition_report_types")
        .select("*")
        .eq("active", True)
        .order("sort")
        .execute()
        .data
    ) or []


# ─── Distinct venues / LOCs, for the filter dropdowns ────────────────────────
@router.get("/facets")
def report_facets():
    rows = supabase.table("competition_reports").select("venue, loc").execute().data or []
    venues = sorted({(r.get("venue") or "").strip() for r in rows if (r.get("venue") or "").strip()})
    locs = sorted({(r.get("loc") or "").strip() for r in rows if (r.get("loc") or "").strip()})
    return {"venues": venues, "locs": locs}


# ─── List ────────────────────────────────────────────────────────────────────
@router.get("")
def list_reports(
    competition_id: Optional[str] = Query(None),
    type_code: Optional[str] = Query(None),
    venue: Optional[str] = Query(None),
    loc: Optional[str] = Query(None),
    search: Optional[str] = Query(None, max_length=200),
):
    q = supabase.table("competition_reports").select("*, competitions(name, year)")
    if competition_id:
        q = q.eq("competition_id", competition_id)
    if type_code:
        q = q.eq("type_code", type_code)
    if venue:
        q = q.eq("venue", venue)
    if loc:
        q = q.eq("loc", loc)
    rows = [_shape_report(r) for r in (q.execute().data or [])]
    # Newest first, undated reports last. Sorted here rather than in PostgREST
    # because the query builder only carries one `order` param.
    rows.sort(key=lambda r: (r.get("report_date") or "", r.get("created_at") or ""), reverse=True)

    if search:
        needle = search.strip().lower()
        if needle:
            rows = [
                r for r in rows
                if needle in " ".join(
                    str(r.get(f) or "") for f in ("title", "venue", "loc", "summary", "competition_name")
                ).lower()
            ]

    # File counts in one round-trip rather than one query per report.
    ids = [r["id"] for r in rows]
    if ids:
        files = (
            supabase.table("competition_report_files")
            .select("report_id")
            .in_("report_id", ids)
            .execute()
            .data
        ) or []
        counts: dict[str, int] = {}
        for f in files:
            counts[f["report_id"]] = counts.get(f["report_id"], 0) + 1
        for r in rows:
            r["file_count"] = counts.get(r["id"], 0)

    return rows


# ─── Create ──────────────────────────────────────────────────────────────────
@router.post("", status_code=201, dependencies=[Depends(require_edit("reports"))])
def create_report(data: CompetitionReportCreate, request: Request):
    comp = supabase.table("competitions").select("id").eq("id", data.competition_id).execute().data
    if not comp:
        raise HTTPException(status_code=404, detail="Competition not found")
    if not _valid_type(data.type_code):
        raise HTTPException(status_code=400, detail="Unknown report type")
    if not (data.title or "").strip():
        raise HTTPException(status_code=400, detail="Title is required")

    record = {
        "competition_id": data.competition_id,
        "type_code": data.type_code,
        "title": data.title.strip(),
        "venue": (data.venue or "").strip() or None,
        "loc": (data.loc or "").strip() or None,
        "report_date": data.report_date,
        "summary": data.summary,
        "created_by": _user_id(request),
    }
    record = {k: v for k, v in record.items() if v is not None}
    return supabase.table("competition_reports").insert(record).execute().data[0]


# ─── Update ──────────────────────────────────────────────────────────────────
@router.put("/{report_id}", dependencies=[Depends(require_edit("reports"))])
def update_report(report_id: str, data: CompetitionReportUpdate):
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if "type_code" in updates and not _valid_type(updates["type_code"]):
        raise HTTPException(status_code=400, detail="Unknown report type")
    if "title" in updates:
        updates["title"] = updates["title"].strip()
        if not updates["title"]:
            raise HTTPException(status_code=400, detail="Title is required")
    for field in ("venue", "loc"):
        if field in updates:
            updates[field] = (updates[field] or "").strip() or None
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    updates["updated_at"] = _now_iso()

    result = supabase.table("competition_reports").update(updates).eq("id", report_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Report not found")
    return result.data[0]


# ─── Delete a file (declared before /{report_id} so the paths don't clash) ───
@router.delete("/files/{file_id}", dependencies=[Depends(require_edit("reports"))])
def delete_report_file(file_id: str):
    row = supabase.table("competition_report_files").select("storage_path").eq("id", file_id).execute().data
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    supabase.table("competition_report_files").delete().eq("id", file_id).execute()
    _delete_from_storage(row[0].get("storage_path"))
    return {"ok": True}


# ─── Download a file (authenticated blob; the bucket is private) ─────────────
@router.get("/files/{file_id}/download")
def download_report_file(file_id: str, filename: Optional[str] = None):
    row = (
        supabase.table("competition_report_files")
        .select("storage_path, file_name")
        .eq("id", file_id)
        .execute()
        .data
    )
    if not row:
        raise HTTPException(status_code=404, detail="File not found")

    key = _extract_storage_key(row[0].get("storage_path"))
    if not key:
        raise HTTPException(status_code=404, detail="File not available")

    filename = filename or row[0].get("file_name") or "report"
    filename = _SAFE_FILENAME_RE.sub("", filename).strip() or "report"

    supabase_url = os.environ.get("SUPABASE_URL", "")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or os.environ.get("SUPABASE_KEY", "")
    object_url = f"{supabase_url}/storage/v1/object/{_BUCKET}/{key}"
    try:
        headers = {"Authorization": f"Bearer {supabase_key}", "apikey": supabase_key}
        resp = httpx.get(object_url, headers=headers, timeout=60.0, follow_redirects=True)
        if resp.status_code != 200:
            raise HTTPException(status_code=404, detail="File not available")
        return Response(
            content=resp.content,
            media_type=resp.headers.get("content-type", "application/octet-stream"),
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Cache-Control": "private, no-store",
            },
        )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="Storage fetch failed")


# ─── Upload a file ───────────────────────────────────────────────────────────
@router.post("/{report_id}/files", status_code=201, dependencies=[Depends(require_edit("reports"))])
async def upload_report_file(report_id: str, request: Request, file: UploadFile = File(...)):
    report = supabase.table("competition_reports").select("id").eq("id", report_id).execute().data
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    content_type = file.content_type or "application/octet-stream"
    if not any(content_type.startswith(a) for a in _ALLOWED_CONTENT):
        raise HTTPException(status_code=400, detail="Unsupported file type")

    content = await file.read()
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 25 MB)")

    ext = (file.filename or "").rsplit(".", 1)[-1].lower() if "." in (file.filename or "") else "bin"
    ext = re.sub(r"[^a-z0-9]", "", ext)[:8] or "bin"
    key = f"{_PREFIX}/{report_id}/{uuid.uuid4().hex}.{ext}"
    try:
        supabase.storage.from_(_BUCKET).upload(
            path=key,
            file=content,
            file_options={"content-type": content_type, "upsert": "true"},
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upload failed: {e}")

    record = {
        "report_id": report_id,
        "storage_path": f"storage://{_BUCKET}/{key}",
        "file_name": file.filename or f"report.{ext}",
        "content_type": content_type,
        "size_bytes": len(content),
        "uploaded_by": _user_id(request),
    }
    return supabase.table("competition_report_files").insert(record).execute().data[0]


# ─── A report's files ────────────────────────────────────────────────────────
@router.get("/{report_id}/files")
def list_report_files(report_id: str):
    return (
        supabase.table("competition_report_files")
        .select("id, file_name, content_type, size_bytes, uploaded_at")
        .eq("report_id", report_id)
        .order("uploaded_at")
        .execute()
        .data
    ) or []


# ─── Delete a report (cleans its documents out of Storage first) ─────────────
@router.delete("/{report_id}", dependencies=[Depends(require_edit("reports"))])
def delete_report(report_id: str):
    files = (
        supabase.table("competition_report_files")
        .select("storage_path")
        .eq("report_id", report_id)
        .execute()
        .data
    ) or []
    result = supabase.table("competition_reports").delete().eq("id", report_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Report not found")
    for f in files:
        _delete_from_storage(f.get("storage_path"))
    return {"ok": True}
