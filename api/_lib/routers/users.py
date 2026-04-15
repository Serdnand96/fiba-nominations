from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import os

from api._lib.database import supabase

router = APIRouter(prefix="/users", tags=["users"])

MODULES = ["calendar", "nominations", "personnel", "competitions", "templates", "users", "transport", "availability", "training"]


def _get_admin_client():
    """Get a Supabase client with service_role key for admin operations."""
    from api._lib.database import create_client
    url = os.environ.get("SUPABASE_URL", "")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    return create_client(url, service_key)


class UserCreate(BaseModel):
    email: str
    password: str


@router.get("/")
def list_users():
    """List all auth users with superadmin flag."""
    try:
        client = _get_admin_client()
        res = client.auth.admin.list_users()

        # Fetch all superadmin flags
        profiles = supabase.table("user_profiles").select("user_id,is_superadmin").execute().data
        sa_set = {p["user_id"] for p in profiles if p.get("is_superadmin")}

        users = [
            {
                "id": u.id,
                "email": u.email,
                "created_at": u.created_at if u.created_at else None,
                "last_sign_in_at": u.last_sign_in_at if u.last_sign_in_at else None,
                "is_superadmin": u.id in sa_set,
            }
            for u in res
        ]
        return users
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to load users")


@router.post("/")
def create_user(payload: UserCreate):
    """Create a new auth user."""
    # Basic password validation
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    try:
        client = _get_admin_client()
        res = client.auth.admin.create_user({
            "email": payload.email,
            "password": payload.password,
            "email_confirm": True,
        })
        new_user_id = res.user.id

        # Create default permissions (all false) for the new user
        for m in MODULES:
            try:
                supabase.table("user_permissions").insert({
                    "user_id": new_user_id,
                    "module": m,
                    "can_view": False,
                    "can_edit": False,
                }).execute()
            except Exception:
                pass  # Ignore if already exists

        return {
            "id": new_user_id,
            "email": res.user.email,
            "created_at": res.user.created_at if res.user.created_at else None,
        }
    except Exception as e:
        msg = str(e)
        if "already been registered" in msg.lower() or "already exists" in msg.lower():
            raise HTTPException(status_code=409, detail="Este email ya está registrado")
        raise HTTPException(status_code=500, detail="Failed to create user")


@router.delete("/{user_id}")
def delete_user(user_id: str):
    """Delete an auth user."""
    try:
        client = _get_admin_client()
        client.auth.admin.delete_user(user_id)
        return {"ok": True}
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to delete user")
