import os
from supabase import create_client, Client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

_client = None


def get_supabase() -> Client:
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_KEY:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_KEY environment variables must be set"
            )
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _client


# Backward-compatible alias — lazy initialization
class _LazySupabase:
    def __getattr__(self, name):
        return getattr(get_supabase(), name)


supabase = _LazySupabase()
