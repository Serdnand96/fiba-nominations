"""Fixtures comunes de la suite.

Nada de esto toca la red: el backend real pega a Supabase con el service_role
(ver api/_lib/database.py), así que un test que se escapara a la base escribiría
en producción. Por eso hay un fixture `autouse` que reemplaza el cliente de
`database.py` por un supabase falso, en memoria, en TODOS los tests.

`supabase` en database.py es un `_LazySupabase` que delega en `get_supabase()`,
que devuelve el singleton `_client`. Los routers lo importan por referencia
(`from api._lib.database import supabase`), así que cambiar `_client` alcanza
para que todos los módulos vean el falso sin parchear uno por uno.
"""
import os
import re
import uuid
from types import SimpleNamespace

# Antes de importar cualquier módulo de `api`: database.py lee las variables al
# importarse. Con valores dummy, get_supabase() nunca tira RuntimeError — y de
# todas formas el fixture de abajo pisa el cliente antes de que se use.
os.environ.setdefault("SUPABASE_URL", "http://supabase.invalid")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

import pytest  # noqa: E402

from api._lib import database  # noqa: E402


# ─── Request falso ───────────────────────────────────────────────────────────

class FakeRequest:
    """Lo mínimo de un starlette Request que leen auth.py y los routers.

    `state.user` = {id, email} (lo que deja el middleware de auth) y
    `state._is_superadmin` precargado: así `_is_superadmin_cached()` responde
    desde el cache del request y no consulta `user_profiles`.

    `user_id=None` → request sin usuario (para probar el fail-closed).
    `budget_access` precarga el cache de `budget._access_rows()`.
    """

    def __init__(self, user_id="user-1", *, superadmin=False, email=None, budget_access=None):
        self.state = SimpleNamespace()
        if user_id is not None:
            self.state.user = {"id": user_id, "email": email or f"{user_id}@example.test"}
        self.state._is_superadmin = bool(superadmin)
        if budget_access is not None:
            self.state._budget_access = list(budget_access)


@pytest.fixture
def make_request():
    return FakeRequest


# ─── Supabase falso ──────────────────────────────────────────────────────────
#
# Hereda del _QueryBuilder real: los métodos de encadenado (select/eq/in_/
# order/…) son EXACTAMENTE los de producción, con la misma semántica de "un
# filtro por columna" (un .eq después de un .in_ sobre la misma columna lo
# pisa). Solo cambia execute(): en vez de mandar `_params` a PostgREST, los
# interpreta contra listas de dicts en memoria.

_TRUE_FALSE = {"true", "false"}


def _norm(value):
    """Texto comparable con lo que el builder escribe en `_params`."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value)
    return text.lower() if text.lower() in _TRUE_FALSE else text


def _parse_in(raw: str) -> list:
    inner = raw[1:-1] if raw.startswith("(") and raw.endswith(")") else raw
    if not inner:
        return []
    return [v[1:-1] if v.startswith('"') and v.endswith('"') else v for v in inner.split(",")]


def _matches(row: dict, column: str, expr: str) -> bool:
    value = _norm(row.get(column))
    if expr.startswith("not.is."):
        return value is not None
    if expr.startswith("is."):
        return value is None
    op, _, arg = expr.partition(".")
    arg = _norm(arg)
    if op == "eq":
        return value == arg
    if op == "in":
        return value in _parse_in(expr[3:])
    if op in ("gte", "lte", "lt"):
        if value is None:
            return False
        return {"gte": value >= arg, "lte": value <= arg, "lt": value < arg}[op]
    if op == "ilike":
        pattern = "^" + re.escape(arg).replace(r"\*", ".*").replace("%", ".*") + "$"
        return value is not None and re.match(pattern, value, re.IGNORECASE) is not None
    raise NotImplementedError(f"FakeSupabase: unsupported filter {expr!r} on {column!r}")


_RESERVED = {"select", "order", "limit", "offset"}


class FakeQuery(database._QueryBuilder):
    def __init__(self, db: "FakeSupabase", table: str):
        super().__init__("http://supabase.invalid", {}, table)
        self._db = db
        self._table = table

    def _rows_matching(self, rows):
        if "or" in self._params:
            raise NotImplementedError("FakeSupabase: .or_() is not supported")
        filters = {k: v for k, v in self._params.items() if k not in _RESERVED}
        return [r for r in rows if all(_matches(r, c, e) for c, e in filters.items())]

    def _ordered(self, rows):
        spec = self._params.get("order")
        if not spec:
            return rows
        for term in reversed(spec.split(",")):
            col, _, rest = term.partition(".")
            desc = rest.startswith("desc")
            present = [r for r in rows if r.get(col) is not None]
            missing = [r for r in rows if r.get(col) is None]
            present.sort(key=lambda r: str(r.get(col)), reverse=desc)
            rows = present + missing
        return rows

    def execute(self):
        db = self._db
        db.calls.append(SimpleNamespace(table=self._table, method=self._method,
                                        params=dict(self._params), body=self._body))
        if self._table in db.fail_tables:
            raise database.SupabaseError(400, f'{{"message": "fake failure on {self._table}"}}')
        rows = db.tables.setdefault(self._table, [])

        if self._method == "GET":
            data = [dict(r) for r in self._ordered(self._rows_matching(rows))]
            offset = int(self._params.get("offset", 0))
            limit = self._params.get("limit")
            data = data[offset:offset + int(limit)] if limit is not None else data[offset:]
        elif self._method == "POST":
            items = self._body if isinstance(self._body, list) else [self._body]
            data = []
            for item in items:
                row = {"id": str(uuid.uuid4()), **item}
                rows.append(row)
                data.append(dict(row))
        elif self._method == "PATCH":
            data = []
            for row in self._rows_matching(rows):
                row.update(self._body)
                data.append(dict(row))
        elif self._method == "DELETE":
            gone = self._rows_matching(rows)
            db.tables[self._table] = [r for r in rows if r not in gone]
            data = [dict(r) for r in gone]
        else:
            raise ValueError(self._method)
        return database._SupabaseResult(data)


class FakeSupabase:
    """Base en memoria: `tables[name]` es una lista de dicts.

    - `calls`: cada execute() con tabla, método, `_params` y body (para afirmar
      qué filtros se mandaron, o que no se consultó nada).
    - `fail_tables`: tablas cuyo execute() levanta SupabaseError (simula una
      migración no aplicada).
    - `select(...)` ignora las columnas y los embeds: si un test necesita un
      embed (`nominations(competitions(...))`) lo carga ya anidado en la fila.
    """

    def __init__(self, **tables):
        self.tables = {name: [dict(r) for r in rows] for name, rows in tables.items()}
        self.calls = []
        self.fail_tables = set()

    def table(self, name: str) -> FakeQuery:
        return FakeQuery(self, name)

    def seed(self, name: str, rows) -> None:
        self.tables[name] = [dict(r) for r in rows]

    def calls_to(self, table: str) -> list:
        return [c for c in self.calls if c.table == table]


@pytest.fixture(autouse=True)
def fake_db(monkeypatch):
    """Supabase falso y vacío en cada test. Ningún test sale a la red."""
    db = FakeSupabase()
    monkeypatch.setattr(database, "_client", db)
    return db
