import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from api._lib.routers import (
    personnel, competitions, nominations, users, calendar, transport,
    availability, permissions, training, games,
    assets, loans, public_assets, employees, templates, payments,
)

app = FastAPI(title="FIBA Americas Administration API", docs_url=None, redoc_url=None)

# ── CORS — restrict to known origins ────────────────────────────────────────
_allowed_origins = [
    o.strip()
    for o in os.environ.get("CORS_ORIGINS", "").split(",")
    if o.strip()
] or ["http://localhost:5173", "http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# ── Security headers middleware ─────────────────────────────────────────────
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    # This API only ever returns JSON and file downloads (never HTML that runs
    # in a browsing context), so a locked-down CSP is safe and defends against
    # any response being framed or used to load active content.
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    # HSTS — the app is HTTPS-only in prod behind nginx; tell browsers to never
    # downgrade. Browsers ignore this header over plain HTTP (e.g. local dev).
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# ── Supabase JWT validation (used by the auth middleware) ───────────────────
import httpx as _httpx

_SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
_SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or os.environ.get("SUPABASE_KEY", "")


# Store auth user on request state so routers can access it
@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    # Skip auth for OPTIONS (CORS preflight) and health-check root only.
    # Download/export endpoints DO require auth — frontend uses fetch()+blob so
    # the JWT is sent. (Pen-test N1: leaving them open was a P0 leak.)
    path = request.url.path.rstrip("/")
    if request.method == "OPTIONS" or path in ("/api", ""):
        return await call_next(request)

    # Public asset view (QR scan landing) — no auth required
    if path.startswith("/api/public/"):
        return await call_next(request)

    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        try:
            resp = _httpx.get(
                f"{_SUPABASE_URL}/auth/v1/user",
                headers={"Authorization": f"Bearer {token}", "apikey": _SUPABASE_KEY},
                timeout=10.0,
            )
            if resp.status_code == 200:
                request.state.user = resp.json()
            else:
                return JSONResponse(status_code=401, content={"detail": "Invalid or expired token"})
        except Exception:
            return JSONResponse(status_code=401, content={"detail": "Authentication failed"})
    else:
        return JSONResponse(status_code=401, content={"detail": "Missing authorization token"})

    return await call_next(request)


# Mount all routers under /api prefix (nginx proxies /api/* to this app)
app.include_router(personnel.router, prefix="/api")
app.include_router(competitions.router, prefix="/api")
app.include_router(nominations.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(calendar.router, prefix="/api")
app.include_router(transport.router, prefix="/api")
app.include_router(availability.router, prefix="/api")
app.include_router(permissions.router, prefix="/api")
app.include_router(training.router, prefix="/api")
app.include_router(games.router, prefix="/api")
app.include_router(assets.router, prefix="/api")
app.include_router(loans.router, prefix="/api")
app.include_router(employees.router, prefix="/api")
app.include_router(public_assets.router, prefix="/api")
app.include_router(templates.router, prefix="/api")
app.include_router(payments.router, prefix="/api")


@app.get("/api")
@app.get("/api/")
def root():
    return {"message": "FIBA Americas Administration API"}
