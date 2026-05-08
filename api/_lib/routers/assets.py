"""Inventory: assets router."""
import io
import os
from datetime import datetime, timezone
from typing import Optional

import qrcode
from fastapi import APIRouter, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import Response

from api._lib.database import supabase
from api._lib.schemas import AssetCreate, AssetUpdate

router = APIRouter(prefix="/assets", tags=["assets"])

_BUCKET = "inventory"
_PUBLIC_BASE = (os.environ.get("PUBLIC_APP_URL") or "https://www.fibaapp.com").rstrip("/")


def _user_id(request: Request) -> Optional[str]:
    user = getattr(request.state, "user", None)
    if user and isinstance(user, dict):
        return user.get("id")
    return None


def _generate_qr_png(asset_id: str) -> bytes:
    """Generate a PNG QR code that links to the public asset page."""
    url = f"{_PUBLIC_BASE}/asset/{asset_id}"
    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _upload_to_storage(path: str, content: bytes, content_type: str) -> str:
    """Upload bytes to Supabase Storage and return the public URL."""
    # Try to remove first (upsert behaviour) — ignore errors if it doesn't exist
    try:
        supabase.storage.from_(_BUCKET).remove([path])
    except Exception:
        pass
    supabase.storage.from_(_BUCKET).upload(
        path=path,
        file=content,
        file_options={"content-type": content_type, "upsert": "true"},
    )
    return supabase.storage.from_(_BUCKET).get_public_url(path)


# ─── GET /assets ────────────────────────────────────────────────────────────
@router.get("")
def list_assets(
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
):
    """List assets with optional filters. Joins active loan info."""
    q = supabase.table("assets").select("*").order("created_at", desc=True)
    if status:
        q = q.eq("status", status)
    if category:
        q = q.eq("category", category)
    assets = q.execute().data or []

    # Filter by search client-side (Supabase REST has limited OR support across columns)
    if search:
        s = search.lower()
        assets = [
            a for a in assets
            if s in (a.get("name") or "").lower()
            or s in (a.get("serial_number") or "").lower()
            or s in (a.get("brand") or "").lower()
        ]

    # Attach active loan info
    if assets:
        ids = [a["id"] for a in assets]
        # Older supabase-py versions don't expose .in_(); use a PostgREST filter
        loans = (
            supabase.table("loans")
            .select("id,asset_id,assigned_to,expected_return")
            .filter("asset_id", "in", f"({','.join(ids)})")
            .eq("status", "active")
            .execute()
            .data
            or []
        )
        loan_map = {l["asset_id"]: l for l in loans}
        for a in assets:
            l = loan_map.get(a["id"])
            if l:
                a["active_loan_id"] = l["id"]
                a["assigned_to"] = l["assigned_to"]
                a["expected_return"] = l.get("expected_return")

    return assets


# ─── GET /assets/{id} ───────────────────────────────────────────────────────
@router.get("/{asset_id}")
def get_asset(asset_id: str):
    """Asset detail with active loan and recent loan history."""
    res = supabase.table("assets").select("*").eq("id", asset_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Asset not found")
    asset = res.data[0]

    active = (
        supabase.table("loans")
        .select("*")
        .eq("asset_id", asset_id)
        .eq("status", "active")
        .limit(1)
        .execute()
        .data
    )
    history = (
        supabase.table("loans")
        .select("*")
        .eq("asset_id", asset_id)
        .order("loan_date", desc=True)
        .limit(5)
        .execute()
        .data
        or []
    )

    asset["active_loan"] = active[0] if active else None
    asset["loan_history"] = history
    return asset


# ─── POST /assets ───────────────────────────────────────────────────────────
@router.post("", status_code=201)
def create_asset(data: AssetCreate, request: Request):
    record = data.model_dump(exclude_none=True)
    record.setdefault("status", "available")
    record["created_by"] = _user_id(request)

    inserted = supabase.table("assets").insert(record).execute()
    asset = inserted.data[0]

    # Generate QR + upload to storage
    try:
        png = _generate_qr_png(asset["id"])
        qr_url = _upload_to_storage(f"qr/{asset['id']}.png", png, "image/png")
        updated = (
            supabase.table("assets")
            .update({"qr_code_url": qr_url})
            .eq("id", asset["id"])
            .execute()
        )
        asset = updated.data[0] if updated.data else {**asset, "qr_code_url": qr_url}
    except Exception as e:
        # QR generation failure shouldn't break asset creation
        print(f"[assets] QR generation failed for {asset['id']}: {e}")

    return asset


# ─── PUT /assets/{id} ───────────────────────────────────────────────────────
@router.put("/{asset_id}")
def update_asset(asset_id: str, data: AssetUpdate):
    updates = {k: v for k, v in data.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    result = (
        supabase.table("assets")
        .update(updates)
        .eq("id", asset_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Asset not found")
    return result.data[0]


# ─── DELETE /assets/{id} (soft delete: status=retired) ──────────────────────
@router.delete("/{asset_id}")
def retire_asset(asset_id: str):
    result = (
        supabase.table("assets")
        .update({"status": "retired"})
        .eq("id", asset_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"ok": True, "message": "Asset retired"}


# ─── GET /assets/{id}/qr  (returns PNG bytes) ───────────────────────────────
@router.get("/{asset_id}/qr")
def get_asset_qr(asset_id: str):
    res = supabase.table("assets").select("qr_code_url").eq("id", asset_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Asset not found")
    qr_url = res.data[0].get("qr_code_url")
    if qr_url:
        # Redirect to the storage URL — frontend can also <img src> directly
        return {"qr_code_url": qr_url}
    # Generate on-the-fly if missing
    png = _generate_qr_png(asset_id)
    qr_url = _upload_to_storage(f"qr/{asset_id}.png", png, "image/png")
    supabase.table("assets").update({"qr_code_url": qr_url}).eq("id", asset_id).execute()
    return {"qr_code_url": qr_url}


# ─── POST /assets/{id}/photo ────────────────────────────────────────────────
@router.post("/{asset_id}/photo")
async def upload_asset_photo(asset_id: str, photo: UploadFile = File(...)):
    if not (photo.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")
    content = await photo.read()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Photo too large (max 5 MB)")

    ext = (photo.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp"):
        ext = "jpg"

    photo_url = _upload_to_storage(f"photos/{asset_id}.{ext}", content, photo.content_type)

    result = (
        supabase.table("assets")
        .update({"photo_url": photo_url})
        .eq("id", asset_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Asset not found")
    return result.data[0]
