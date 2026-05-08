"""Public asset view (no auth) — used by QR code landing page."""
from fastapi import APIRouter, HTTPException

from api._lib.database import supabase

router = APIRouter(prefix="/public", tags=["public"])


@router.get("/asset/{asset_id}")
def public_asset(asset_id: str):
    """Limited public view of an asset for QR scans. No auth required."""
    res = (
        supabase.table("assets")
        .select("name,serial_number,category,brand,model,status,location,photo_url")
        .eq("id", asset_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Asset not found")
    asset = res.data[0]

    if asset["status"] == "in_use":
        loan = (
            supabase.table("loans")
            .select("assigned_to,expected_return")
            .eq("asset_id", asset_id)
            .eq("status", "active")
            .limit(1)
            .execute()
            .data
        )
        if loan:
            asset["assigned_to"] = loan[0]["assigned_to"]
            asset["expected_return"] = loan[0]["expected_return"]

    return asset
