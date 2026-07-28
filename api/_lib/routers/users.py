from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import json
import os
import re

from api._lib.database import supabase
from api._lib.auth import require_superadmin

router = APIRouter(
    prefix="/users",
    tags=["users"],
    dependencies=[Depends(require_superadmin)],  # ALL endpoints superadmin-only
)

MODULES = ["calendar", "nominations", "personnel", "competitions", "templates", "users", "transport", "availability", "training"]


def _get_admin_client():
    """Get a Supabase client with service_role key for admin operations."""
    from api._lib.database import create_client
    url = os.environ.get("SUPABASE_URL", "")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not service_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    return create_client(url, service_key)


def _auth_error(exc: Exception, fallback: str) -> HTTPException:
    """Turn a GoTrue admin error into an HTTPException with a usable message.

    `_AuthAdmin` raises `Exception("Auth error <status>: <body>")`; the body is
    normally `{"code": ..., "message": ...}`. GoTrue answers 500 when a trigger on
    `auth.users` rejects the row (e.g. the email-domain allow-list), so without
    unwrapping it the superadmin only ever sees a generic failure.
    """
    raw = str(exc)
    m = re.match(r"Auth error (\d+): (.*)", raw, re.S)
    if not m:
        return HTTPException(status_code=500, detail=fallback)

    status = int(m.group(1))
    message = m.group(2)
    try:
        body = json.loads(message)
        message = body.get("msg") or body.get("message") or body.get("error_description") or message
    except (ValueError, AttributeError):
        pass

    low = message.lower()
    if "already been registered" in low or "already exists" in low:
        return HTTPException(status_code=409, detail="Este email ya está registrado")
    if "not allowed" in low and "domain" in low:
        # Check-constraint trigger on auth.users; a 500 here is a rejected input, not an outage.
        return HTTPException(status_code=400, detail=message)
    if status < 500:
        return HTTPException(status_code=status, detail=message)
    return HTTPException(status_code=500, detail=fallback)


class UserCreate(BaseModel):
    email: str
    password: str


class PasswordUpdate(BaseModel):
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
    except HTTPException:
        raise
    except Exception as e:
        raise _auth_error(e, "Failed to create user")


@router.put("/{user_id}/password")
def update_user_password(user_id: str, payload: PasswordUpdate):
    """Set a new password for an auth user (superadmin-only)."""
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 8 caracteres")
    try:
        client = _get_admin_client()
        client.auth.admin.update_user(user_id, {"password": payload.password})
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise _auth_error(e, "Failed to update password")


@router.delete("/{user_id}")
def delete_user(user_id: str):
    """Delete an auth user."""
    try:
        client = _get_admin_client()
        client.auth.admin.delete_user(user_id)
        return {"ok": True}
    except Exception as e:
        raise _auth_error(e, "Failed to delete user")
