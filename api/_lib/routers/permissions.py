from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from api._lib.database import supabase

router = APIRouter(prefix="/permissions", tags=["permissions"])

MODULES = ["calendar", "nominations", "personnel", "competitions", "templates", "users", "transport", "availability"]


def is_superadmin(user_id: str) -> bool:
    """Check if a user is superadmin via user_profiles table."""
    result = supabase.table("user_profiles").select("is_superadmin").eq("user_id", user_id).execute()
    if result.data and result.data[0].get("is_superadmin"):
        return True
    return False


class PermissionItem(BaseModel):
    module: str
    can_view: bool
    can_edit: bool


class PermissionsUpdate(BaseModel):
    permissions: list[PermissionItem]


# ---------------------------------------------------------------------------
# GET /permissions/{user_id}
# ---------------------------------------------------------------------------
@router.get("/{user_id}")
def get_permissions(user_id: str):
    """Get all module permissions for a user."""
    superadmin = is_superadmin(user_id)

    if superadmin:
        # Superadmin gets full access to everything
        return {
            "is_superadmin": True,
            "permissions": [
                {"module": m, "can_view": True, "can_edit": True}
                for m in MODULES
            ],
        }

    # Fetch actual permissions
    result = supabase.table("user_permissions").select("module,can_view,can_edit").eq("user_id", user_id).execute()
    perm_map = {p["module"]: p for p in result.data}

    permissions = []
    for m in MODULES:
        if m in perm_map:
            permissions.append({
                "module": m,
                "can_view": perm_map[m]["can_view"],
                "can_edit": perm_map[m]["can_edit"],
            })
        else:
            permissions.append({"module": m, "can_view": False, "can_edit": False})

    return {"is_superadmin": False, "permissions": permissions}


# ---------------------------------------------------------------------------
# PUT /permissions/{user_id}
# ---------------------------------------------------------------------------
@router.put("/{user_id}")
def update_permissions(user_id: str, payload: PermissionsUpdate):
    """Bulk update permissions for a user. Only superadmin can call this."""
    # Cannot modify superadmin permissions
    if is_superadmin(user_id):
        raise HTTPException(status_code=403, detail="Cannot modify superadmin permissions")

    for item in payload.permissions:
        if item.module not in MODULES:
            raise HTTPException(status_code=400, detail=f"Invalid module: {item.module}")

        # Upsert each permission
        existing = (
            supabase.table("user_permissions")
            .select("id")
            .eq("user_id", user_id)
            .eq("module", item.module)
            .execute()
        )

        if existing.data:
            supabase.table("user_permissions").update({
                "can_view": item.can_view,
                "can_edit": item.can_edit,
            }).eq("user_id", user_id).eq("module", item.module).execute()
        else:
            supabase.table("user_permissions").insert({
                "user_id": user_id,
                "module": item.module,
                "can_view": item.can_view,
                "can_edit": item.can_edit,
            }).execute()

    return {"ok": True}


# ---------------------------------------------------------------------------
# GET /permissions/check-superadmin/{user_id}
# ---------------------------------------------------------------------------
@router.get("/check-superadmin/{user_id}")
def check_superadmin(user_id: str):
    """Check if a user is superadmin."""
    return {"is_superadmin": is_superadmin(user_id)}
