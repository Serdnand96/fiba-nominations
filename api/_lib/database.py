"""
Lightweight Supabase client using httpx instead of the heavy supabase-py SDK.
This keeps the serverless function under Vercel's 250 MB limit.
"""
import os
import httpx

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or os.environ.get("SUPABASE_KEY", "")

# Shared httpx Client — reuses TCP/TLS connections across requests.
# We use one client for short queries (REST/Auth) and one for bulkier uploads.
_HTTP = httpx.Client(
    timeout=30.0,
    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
    http2=False,
)
_HTTP_UPLOAD = httpx.Client(
    timeout=60.0,
    limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
)


class _SupabaseResult:
    """Mimics the result object from supabase-py."""
    def __init__(self, data: list):
        self.data = data


class _QueryBuilder:
    """Minimal PostgREST query builder."""

    def __init__(self, url: str, headers: dict, table: str):
        self._url = f"{url}/rest/v1/{table}"
        self._headers = {**headers, "Content-Type": "application/json", "Prefer": "return=representation"}
        self._params: dict = {}
        self._method = "GET"
        self._body = None

    def select(self, columns: str = "*"):
        self._method = "GET"
        self._params["select"] = columns
        return self

    def insert(self, data):
        self._method = "POST"
        self._body = data
        return self

    def update(self, data: dict):
        self._method = "PATCH"
        self._body = data
        return self

    def delete(self):
        self._method = "DELETE"
        return self

    def eq(self, column: str, value):
        self._params[column] = f"eq.{value}"
        return self

    def or_(self, filters: str):
        self._params["or"] = f"({filters})"
        return self

    def order(self, column: str, desc: bool = False):
        direction = "desc" if desc else "asc"
        self._params["order"] = f"{column}.{direction}"
        return self

    def execute(self) -> _SupabaseResult:
        client = _HTTP
        if self._method == "GET":
            resp = client.get(self._url, headers=self._headers, params=self._params)
        elif self._method == "POST":
            resp = client.post(self._url, headers=self._headers, params=self._params, json=self._body)
        elif self._method == "PATCH":
            resp = client.patch(self._url, headers=self._headers, params=self._params, json=self._body)
        elif self._method == "DELETE":
            resp = client.delete(self._url, headers=self._headers, params=self._params)
        else:
            raise ValueError(f"Unknown method: {self._method}")

        if resp.status_code >= 400:
            raise Exception(f"Supabase error {resp.status_code}: {resp.text}")

        data = resp.json() if resp.text else []
        if isinstance(data, dict):
            data = [data]
        return _SupabaseResult(data)


class _StorageBucket:
    """Minimal Supabase Storage client for a specific bucket."""

    def __init__(self, url: str, headers: dict, bucket: str):
        self._url = f"{url}/storage/v1"
        self._headers = headers
        self._bucket = bucket

    def upload(self, path: str, file: bytes, file_options: dict = None):
        url = f"{self._url}/object/{self._bucket}/{path}"
        content_type = (file_options or {}).get("content-type", "application/octet-stream")
        upsert = (file_options or {}).get("upsert", "false")
        headers = {**self._headers, "Content-Type": content_type, "x-upsert": str(upsert).lower()}
        resp = _HTTP_UPLOAD.post(url, headers=headers, content=file)
        if resp.status_code >= 400:
            raise Exception(f"Storage upload error {resp.status_code}: {resp.text}")
        return resp.json()

    def remove(self, paths: list[str]):
        url = f"{self._url}/object/{self._bucket}"
        return _HTTP.request(
            "DELETE", url,
            headers={**self._headers, "Content-Type": "application/json"},
            json={"prefixes": paths},
        )

    def get_public_url(self, path: str) -> str:
        return f"{self._url.replace('/storage/v1', '')}/storage/v1/object/public/{self._bucket}/{path}"

    def list_buckets(self):
        url = f"{self._url}/bucket"
        resp = _HTTP.get(url, headers=self._headers)
        return resp.json()


class _StorageClient:
    def __init__(self, url: str, headers: dict):
        self._url = url
        self._headers = headers

    def from_(self, bucket: str) -> _StorageBucket:
        return _StorageBucket(self._url, self._headers, bucket)

    def list_buckets(self):
        url = f"{self._url}/storage/v1/bucket"
        resp = _HTTP.get(url, headers=self._headers)
        items = resp.json()

        class _Bucket:
            def __init__(self, d):
                self.name = d.get("name", "")

        return [_Bucket(b) for b in items]


class _AuthAdmin:
    """Minimal Supabase Auth Admin client."""

    def __init__(self, url: str, headers: dict):
        self._url = f"{url}/auth/v1/admin"
        self._headers = {**headers, "Content-Type": "application/json"}

    def list_users(self):
        resp = _HTTP.get(f"{self._url}/users", headers=self._headers)
        if resp.status_code >= 400:
            raise Exception(f"Auth error {resp.status_code}: {resp.text}")
        data = resp.json()
        users_list = data.get("users", data) if isinstance(data, dict) else data

        class _User:
            def __init__(self, d):
                self.id = d.get("id")
                self.email = d.get("email")
                self.created_at = d.get("created_at")
                self.last_sign_in_at = d.get("last_sign_in_at")

        return [_User(u) for u in users_list]

    def create_user(self, params: dict):
        resp = _HTTP.post(f"{self._url}/users", headers=self._headers, json=params)
        if resp.status_code >= 400:
            raise Exception(f"Auth error {resp.status_code}: {resp.text}")
        data = resp.json()

        class _UserResult:
            def __init__(self, d):
                self.id = d.get("id")
                self.email = d.get("email")
                self.created_at = d.get("created_at")

        class _Result:
            def __init__(self, d):
                self.user = _UserResult(d)

        return _Result(data)

    def delete_user(self, user_id: str):
        resp = _HTTP.delete(f"{self._url}/users/{user_id}", headers=self._headers)
        if resp.status_code >= 400:
            raise Exception(f"Auth error {resp.status_code}: {resp.text}")


class _Auth:
    def __init__(self, url: str, headers: dict):
        self.admin = _AuthAdmin(url, headers)


class SupabaseClient:
    """Lightweight Supabase client."""

    def __init__(self, url: str, key: str):
        self._url = url
        self._headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
        }
        self.storage = _StorageClient(url, self._headers)
        self.auth = _Auth(url, self._headers)

    def table(self, name: str) -> _QueryBuilder:
        return _QueryBuilder(self._url, self._headers, name)


_client = None


def get_supabase() -> SupabaseClient:
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_KEY:
            raise RuntimeError("SUPABASE_URL and SUPABASE_KEY/SUPABASE_SERVICE_ROLE_KEY must be set")
        _client = SupabaseClient(SUPABASE_URL, SUPABASE_KEY)
    return _client


def create_client(url: str, key: str) -> SupabaseClient:
    return SupabaseClient(url, key)


# Backward-compatible lazy alias
class _LazySupabase:
    def __getattr__(self, name):
        return getattr(get_supabase(), name)


supabase = _LazySupabase()
