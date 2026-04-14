from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from api._lib.routers import personnel, competitions, nominations, users, calendar, transport, availability, permissions, training

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
app.include_router(users.router, prefix="/api")
app.include_router(calendar.router, prefix="/api")
app.include_router(transport.router, prefix="/api")
app.include_router(availability.router, prefix="/api")
app.include_router(permissions.router, prefix="/api")
app.include_router(training.router, prefix="/api")


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
    api_key = os.environ.get("CLOUDCONVERT_API_KEY", "").strip()
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


@app.get("/api/debug/test-conversion")
def debug_test_conversion():
    """Create a tiny .docx and try converting to PDF via CloudConvert."""
    import os
    import tempfile
    import httpx
    import time
    from docx import Document as DocxDoc

    api_key = os.environ.get("CLOUDCONVERT_API_KEY", "").strip()
    if not api_key:
        return {"error": "CLOUDCONVERT_API_KEY not set"}

    steps = []
    try:
        doc = DocxDoc()
        doc.add_paragraph("Test PDF conversion")
        tmp_path = os.path.join(tempfile.gettempdir(), "test_convert.docx")
        doc.save(tmp_path)
        steps.append("1. Created test .docx")

        base_url = "https://api.cloudconvert.com/v2"
        hdrs = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

        job_payload = {"tasks": {
            "import-file": {"operation": "import/upload"},
            "convert-file": {"operation": "convert", "input": ["import-file"], "output_format": "pdf", "engine": "libreoffice"},
            "export-file": {"operation": "export/url", "input": ["convert-file"]},
        }}
        job_resp = httpx.post(f"{base_url}/jobs", json=job_payload, headers=hdrs, timeout=30.0)
        steps.append(f"2. Job create: {job_resp.status_code}")
        if job_resp.status_code not in (200, 201):
            return {"steps": steps, "error": job_resp.text[:500]}

        job_data = job_resp.json()["data"]
        upload_task = next((t for t in job_data["tasks"] if t["name"] == "import-file" and t.get("result", {}).get("form")), None)
        if not upload_task:
            return {"steps": steps, "error": "No upload task", "tasks": [f'{t["name"]}:{t["status"]}' for t in job_data["tasks"]]}
        steps.append("3. Found upload task")

        form_d = upload_task["result"]["form"]
        with open(tmp_path, "rb") as f:
            docx_bytes = f.read()
        upload_resp = httpx.post(form_d["url"], data=form_d["parameters"],
            files={"file": ("test.docx", docx_bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}, timeout=60.0)
        steps.append(f"4. Upload: {upload_resp.status_code}")
        if upload_resp.status_code not in (200, 201, 204):
            return {"steps": steps, "error": upload_resp.text[:300]}

        job_id = job_data["id"]
        status_data = None
        for _ in range(30):
            time.sleep(1)
            sr = httpx.get(f"{base_url}/jobs/{job_id}", headers=hdrs, timeout=15.0)
            if sr.status_code == 200:
                status_data = sr.json()["data"]
                if status_data["status"] in ("finished", "error"):
                    break
        steps.append(f"5. Final status: {status_data['status'] if status_data else 'timeout'}")

        if not status_data or status_data["status"] != "finished":
            td = [{"name": t["name"], "status": t["status"], "msg": t.get("message", "")} for t in (status_data or {}).get("tasks", [])]
            return {"steps": steps, "error": "Not finished", "tasks": td}

        export_task = next((t for t in status_data["tasks"] if t["name"] == "export-file" and t["status"] == "finished"), None)
        if not export_task or not export_task.get("result", {}).get("files"):
            return {"steps": steps, "error": "No export result"}

        dl_url = export_task["result"]["files"][0]["url"]
        pdf_resp = httpx.get(dl_url, timeout=30.0)
        steps.append(f"6. PDF: {pdf_resp.status_code}, {len(pdf_resp.content)} bytes")
        return {"steps": steps, "success": True, "pdf_size": len(pdf_resp.content)}
    except Exception as exc:
        import traceback
        return {"steps": steps, "error": f"{type(exc).__name__}: {exc}", "trace": traceback.format_exc()}
