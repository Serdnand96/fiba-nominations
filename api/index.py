from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api._lib.routers import personnel, competitions, nominations

app = FastAPI(title="FIBA Americas Nominations API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount all routers under /api prefix to match Vercel's routing
app.include_router(personnel.router, prefix="/api")
app.include_router(competitions.router, prefix="/api")
app.include_router(nominations.router, prefix="/api")


@app.get("/api")
@app.get("/api/")
def root():
    return {"message": "FIBA Americas Nominations API"}


@app.get("/api/debug/storage")
def debug_storage():
    try:
        from api._lib.database import get_supabase
        client = get_supabase()
        buckets = client.storage.list_buckets()
        bucket_names = [b.name for b in buckets]
        return {"buckets": bucket_names, "status": "ok"}
    except Exception as e:
        return {"error": str(e), "type": type(e).__name__}


@app.get("/api/debug/cloudconvert")
def debug_cloudconvert():
    """Test CloudConvert API key."""
    import os
    import httpx
    api_key = os.environ.get("CLOUDCONVERT_API_KEY", "")
    if not api_key:
        return {"error": "CLOUDCONVERT_API_KEY not set", "key_preview": ""}

    try:
        resp = httpx.get(
            "https://api.cloudconvert.com/v2/users/me",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=10.0,
        )
        return {
            "status_code": resp.status_code,
            "response": resp.json() if resp.status_code == 200 else resp.text[:300],
            "key_preview": api_key[:20] + "...",
        }
    except Exception as e:
        return {"error": str(e), "type": type(e).__name__}
