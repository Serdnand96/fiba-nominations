"""Storage for user-uploaded letter templates.

Uploaded templates cannot live in `templates/` in the repo: the deploy runs
`git reset --hard origin/main` (.github/workflows/deploy.yml), which would
silently revert an uploaded file on the next push. They go to the private
Supabase Storage bucket instead, and the generator resolves each template
key to either the uploaded file or the one shipped in the repo.

Layout inside the `nominations` bucket:

    letter-templates/<KEY>.docx          the active uploaded template
    letter-templates/staging/<KEY>.docx  an upload awaiting confirmation

A staged file is never used to generate real letters — only to render the
preview the user confirms before activating.
"""
from __future__ import annotations

import tempfile
import time
from pathlib import Path

BUCKET = "nominations"
PREFIX = "letter-templates"

# Downloaded templates are cached on disk so a bulk generation of 50 letters
# doesn't fetch the same file 50 times. Each gunicorn worker has its own cache,
# so an activation can take up to CACHE_TTL to be picked up by every worker.
CACHE_TTL = 60
CACHE_DIR = Path(tempfile.gettempdir()) / "fiba_templates"

_cache: dict[str, tuple[float, Path | None]] = {}


def _client():
    from api._lib.database import get_supabase

    return get_supabase()


def active_key(template_key: str) -> str:
    return f"{PREFIX}/{template_key}.docx"


def staging_key(template_key: str) -> str:
    return f"{PREFIX}/staging/{template_key}.docx"


def _download(key: str) -> bytes | None:
    try:
        return _client().storage.from_(BUCKET).download(key)
    except Exception:
        return None


def _upload(key: str, data: bytes) -> None:
    storage = _client().storage.from_(BUCKET)
    opts = {
        "content-type": "application/vnd.openxmlformats-officedocument"
                        ".wordprocessingml.document",
        "upsert": "true",
    }
    try:
        storage.upload(path=key, file=data, file_options=opts)
    except Exception:
        # Some storage versions reject upsert on an existing object.
        try:
            storage.remove([key])
        except Exception:
            pass
        storage.upload(path=key, file=data, file_options={"content-type": opts["content-type"]})


def _remove(key: str) -> None:
    try:
        _client().storage.from_(BUCKET).remove([key])
    except Exception:
        pass


def stage(template_key: str, data: bytes) -> None:
    _upload(staging_key(template_key), data)


def staged_bytes(template_key: str) -> bytes | None:
    return _download(staging_key(template_key))


def discard_staged(template_key: str) -> None:
    _remove(staging_key(template_key))


def activate(template_key: str) -> bool:
    """Promote the staged upload to active. Returns False if nothing staged."""
    data = staged_bytes(template_key)
    if data is None:
        return False
    _upload(active_key(template_key), data)
    _remove(staging_key(template_key))
    invalidate(template_key)
    return True


def remove_custom(template_key: str) -> None:
    """Drop the uploaded template so the repo's built-in one is used again."""
    _remove(active_key(template_key))
    invalidate(template_key)


def invalidate(template_key: str) -> None:
    _cache.pop(template_key, None)


def custom_path(template_key: str) -> Path | None:
    """Local path of the uploaded template, or None if there isn't one."""
    hit = _cache.get(template_key)
    if hit and hit[0] > time.time():
        return hit[1]

    data = _download(active_key(template_key))
    path = None
    if data:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path = CACHE_DIR / f"{template_key}.docx"
        path.write_bytes(data)

    _cache[template_key] = (time.time() + CACHE_TTL, path)
    return path


def has_custom(template_key: str) -> bool:
    return custom_path(template_key) is not None


def has_staged(template_key: str) -> bool:
    return staged_bytes(template_key) is not None
