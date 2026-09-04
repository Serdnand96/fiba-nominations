---
name: api-conventions
description: Convenciones del backend FastAPI de fiba-nominations — estructura de routers, acceso a datos con el wrapper de Supabase (httpx/PostgREST), modelo de autorización por permisos, manejo de errores y storage. Usar al implementar o revisar endpoints del API.
---

# API conventions — FastAPI backend (fiba-nominations)

El backend es FastAPI (Python 3.11) servido por gunicorn/uvicorn en un droplet
DigitalOcean. Un router por módulo, montado bajo `/api`. **No usa un ORM ni
`supabase-py`**: hay un wrapper propio de PostgREST sobre httpx.

## Estructura de un router

Los routers viven en `api/_lib/routers/*.py` y se montan en `api/index.py`
(`app.include_router(x.router, prefix="/api")`). Patrón:

```python
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from api._lib.database import supabase
from api._lib.auth import require_view, require_edit

# El permiso de LECTURA se declara a nivel del router entero:
router = APIRouter(
    prefix="/training", tags=["training"],
    dependencies=[Depends(require_view("training"))],
)

@router.get("/slots")
def list_slots(competition_id: str = Query(...)):
    return supabase.table("training_slots").select("*") \
        .eq("competition_id", competition_id).order("date").execute().data

# Cada endpoint de ESCRITURA agrega el permiso de edición:
@router.post("/slots", dependencies=[Depends(require_edit("training"))])
def create_slot(data: SlotCreate):
    return supabase.table("training_slots").insert(data.model_dump()).execute().data[0]
```

Para montar un módulo nuevo: agregá el import y el `include_router` en
`api/index.py`, y declará el permiso en **tres** lugares: el CHECK de
`user_permissions.module` (migración nueva), `MODULES` en
`api/_lib/routers/permissions.py` y `MODULES` en `src/pages/Users.jsx`.
Recién después las filas en `user_permissions`.

Antes de crear un permiso, fijate si lo que pedís es un **panel** de un módulo
existente: crew (`crew.py`), `staffing.py` y `checklists.py` cuelgan del
permiso `games` con prefijos propios (`/staffing`, `/checklists`).

## Autorización — a nivel de aplicación (NO RLS)

Este es el punto más importante del backend.

- La app pega a Supabase con el **`service_role` key** (ver
  `api/_lib/database.py`), que **bypassa Row Level Security**. Por lo tanto la
  DB no protege nada por sí sola: **la autorización se hace en el código**.
- `api/_lib/auth.py` define las dependencies:
  - `require_view(module)` → 401 sin usuario, 403 sin `can_view`.
  - `require_edit(module)` → 401 sin usuario, 403 sin `can_edit`.
  - `require_superadmin` → solo superadmins.
- Los permisos salen de la tabla `user_permissions` (`can_view`/`can_edit` por
  `user_id` + `module`). El flag de superadmin sale de
  `user_profiles.is_superadmin` y **siempre pasa** cualquier check. El lookup de
  superadmin se cachea por request en `request.state._is_superadmin`.
- **Fail-closed:** si un request llega a una ruta guardada sin usuario en
  `request.state`, se rechaza.
- Variantes bool, sin excepción: `has_view(request, module)` y
  `has_edit(request, module)`. Para permisos que recortan datos (`comp_days`
  en employees.py) o cambian qué se puede hacer adentro (`feed`: `can_view`
  publica y comenta, `can_edit` modera — es la única excepción a "toda
  escritura lleva require_edit", ver feed.py).
- `require_user` → 401 sin usuario, y nada más. Solo para lo propio del
  logueado (`profile.py`, prefijo `/me`): el endpoint trabaja siempre sobre
  `request.state.user["id"]`, nunca sobre un id que venga del cliente.
- **Budget filtra por fila:** en `budget.py` cada lectura pasa por
  `_scoped()`, que recorta por los departamentos de `budget_access`. Es
  además del `require_view("budget")`, no en vez de. Ver `BUDGET_MODULE.md`.
- **Regla:** cualquier endpoint sin dependency de permiso expone datos a
  cualquier usuario autenticado (o al mundo si cuelga de `/api/public/*`). Es un
  bug de seguridad P0.

### Middleware de auth (en `api/index.py`)

- Valida el `Bearer <JWT>` contra `GET {SUPABASE_URL}/auth/v1/user` y guarda el
  usuario en `request.state.user`.
- **Bypassa auth solo para:** `OPTIONS` (preflight CORS), `/api` (health) y
  `/api/public/*` (vistas públicas, con rate-limit por IP: 60 req/min).
- Los endpoints `/download` y `/export/pdf` **requieren auth** (el frontend usa
  fetch+blob y manda el JWT). Fue un hallazgo de pen-test (N1).
- También hay middleware de **security headers/CSP** y de **activity log**
  (audita `POST/PUT/PATCH/DELETE` exitosos que no sean `/api/public/*`, como
  background task).
- Un handler global traduce `SupabaseError` con SQLSTATE de dato inválido
  (CHECK, FK, largo de columna, NOT NULL) a **4xx con mensaje genérico**; el
  nombre de la columna o constraint queda en el log. No hace falta envolver
  cada insert en try/except para eso, pero tampoco dependas del handler para
  validar: la validación de negocio va en Pydantic o en el endpoint.

## Acceso a datos — el wrapper de Supabase

`from api._lib.database import supabase`. Es un query builder mínimo de
PostgREST (`api/_lib/database.py`). Encadenás y terminás en `.execute()`, que
devuelve un objeto con `.data` (siempre una lista). Lanza `Exception` si el
status HTTP ≥ 400.

Métodos disponibles: `.table(name)` → `.select(cols)`, `.insert(data)`,
`.update(data)`, `.delete()`, filtros `.eq/.gte/.lte/.lt/.ilike/.in_/.or_`,
`.order(col, desc=)`, `.limit(n)`, `.offset(n)`.

Notas:
- **El builder guarda un filtro por columna.** Dos `.eq()`/`.in_()` sobre la
  misma columna no se combinan: el segundo pisa al primero. En budget eso sería
  un bypass del scope; en cualquier otro lado, un filtro que se pierde en
  silencio.
- PostgREST no ordena por más de una columna: cuando necesitás orden secundario
  se hace en Python (`slots.sort(key=lambda s: (s["date"], s["start_time"]))`).
- No hay joins arbitrarios; se usa el embedding de PostgREST en `select`
  (`"*, personnel(name, role), competitions(name, template_key)"`) o se batchea
  en Python para evitar N+1.
- Storage y Auth Admin también cuelgan del cliente: `supabase.storage.from_(bucket)`
  y `supabase.auth.admin` (list/create/update/delete users).

## Validación con Pydantic

Schemas en `api/_lib/schemas.py` (o `BaseModel` inline en el router para
módulos chicos como transport). En el endpoint:

- `data.model_dump()` para insert.
- `data.model_dump(exclude_none=True)` para updates parciales (solo los campos
  provistos).

## Manejo de errores

- `raise HTTPException(status_code, detail)`.
- Patrones vistos en el repo:
  - **404** cuando el `.data` de una búsqueda por id viene vacío.
  - **400** cuando no hay campos para actualizar (`"No fields to update"`).
  - **409** en conflictos de unicidad (`"already assigned"`).
  - **413** en uploads que exceden el límite de tamaño.
- El detalle es un string legible; el frontend lo muestra.

## Storage

- Bucket privado único: `nominations` (los adjuntos de payments y reports
  viven ahí bajo los prefijos `payments/…` y `reports/…`; **no existe** un
  bucket "payments"). **Nunca** construyas ni devuelvas URLs públicas
  (`get_public_url`) para él; serví los archivos por endpoints de descarga
  autenticados (`FileResponse` / blob).
- Convención de paths: `storage://<bucket>/<key>`. En `nominations.py`,
  `_extract_storage_key()` normaliza 3 formatos
  (`storage://nominations/X`, `/storage/v1/object/public/nominations/X`,
  `/storage/v1/object/nominations/X`).
- Borrados que tocan storage van por la Storage API
  (`_delete_pdf_from_storage`), no por SQL directo.

## Datos: tablas que confunden

- `personnel` = oficiales que se nominan (TDs, VGOs, REFs…).
- `employees` = staff interno de FIBA (inventario, staffing plan, viajes),
  **no** se nomina.
- `competition_assignments` = crew del torneo (se nomina, cobra);
  `competition_staffing` = empleados FIBA en el evento (no se nomina, no cobra).
  No unificarlas: la primera alimenta `sync-nominations`, cartas y fees.
- `payments` (una persona nominada) y `expenses` (todo lo demás) son dos
  tablas de gasto y el reporte suma las dos. No metas un `nomination_id`
  nullable en `payments`.
- `games.date`/`time` son hora **local de la sede**; `game_schedule.datetime_utc`
  es el ancla para convertir. `NULL` = FIBA no fijó horario.
- El esquema real está en `supabase/migrations/*.sql` (numeradas). Las
  migraciones se aplican **a mano** en Supabase antes del push; el deploy no
  las corre.
