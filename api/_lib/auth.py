"""
Authorization dependencies for FastAPI routes.

These complement the auth middleware in api/index.py — that one verifies
the JWT and stores the user on request.state.user; these enforce module
permissions or superadmin status before reaching the endpoint.

Usage:

    @router.get("", dependencies=[Depends(require_view("nominations"))])
    def list_nominations(): ...

    @router.post("", dependencies=[Depends(require_edit("nominations"))])
    def create_nomination(...): ...

    @router.delete("/{id}", dependencies=[Depends(require_superadmin)])
    def delete_user(...): ...
"""
from typing import Optional

from fastapi import HTTPException, Request

from api._lib.database import supabase


def _user_id(request: Request) -> Optional[str]:
    user = getattr(request.state, "user", None)
    if isinstance(user, dict):
        return user.get("id")
    return None


def _is_superadmin_cached(request: Request, user_id: Optional[str]) -> bool:
    """Cache the superadmin lookup on request.state to avoid repeated DB hits."""
    cached = getattr(request.state, "_is_superadmin", None)
    if cached is not None:
        return cached
    if not user_id:
        request.state._is_superadmin = False
        return False
    res = (
        supabase.table("user_profiles")
        .select("is_superadmin")
        .eq("user_id", user_id)
        .execute()
        .data
    )
    flag = bool(res and res[0].get("is_superadmin"))
    request.state._is_superadmin = flag
    return flag


def _has_permission(request: Request, user_id: Optional[str], module: str, action: str = "view") -> bool:
    """action: 'view' or 'edit'. Superadmin always passes."""
    if _is_superadmin_cached(request, user_id):
        return True
    if not user_id:
        return False
    col = "can_edit" if action == "edit" else "can_view"
    res = (
        supabase.table("user_permissions")
        .select(f"{col}")
        .eq("user_id", user_id)
        .eq("module", module)
        .execute()
        .data
    )
    return bool(res and res[0].get(col))


def require_superadmin(request: Request):
    """Dependency that allows only superadmins."""
    if not _is_superadmin_cached(request, _user_id(request)):
        raise HTTPException(status_code=403, detail="Superadmin only")


def require_view(module: str):
    """Dependency factory: 403 unless caller has can_view on `module` (or is superadmin)."""
    def _check(request: Request):
        if not _has_permission(request, _user_id(request), module, "view"):
            raise HTTPException(status_code=403, detail=f"Missing {module}:view permission")
    return _check


def require_edit(module: str):
    """Dependency factory: 403 unless caller has can_edit on `module` (or is superadmin)."""
    def _check(request: Request):
        if not _has_permission(request, _user_id(request), module, "edit"):
            raise HTTPException(status_code=403, detail=f"Missing {module}:edit permission")
    return _check
