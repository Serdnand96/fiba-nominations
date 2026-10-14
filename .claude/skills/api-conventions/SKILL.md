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
`api/index.py` y creá la fila de permiso en `user_permissions`.

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
- **Regla:** cualquier endpoint sin dependency de permiso expone datos a
  cualquier usuario autenticado (o al mundo si cuelga de `/api/public/*`). Es un
  bug de seguridad P0.

### Routers `/me/*`: `require_user`, sin permiso de módulo

Lo que es **del propio usuario** no cuelga de un módulo: `profile.py` (avatar,
prefijo `/me`) y `notifications.py` (`/me/notifications`, la campana). Llevan
`dependencies=[Depends(require_user)]` a nivel router (401 sin usuario, falla
cerrado) y **toda** query filtra por el id del caller — lecturas **y**
escrituras:

```python
router = APIRouter(prefix="/me/notifications", tags=["notifications"],
                   dependencies=[Depends(require_user)])

@router.post("/{notification_id}/read")
def mark_read(notification_id: str, request: Request):
    uid = _uid(request)
    # id Y user_id en el MISMO update: una ajena no matchea y da 404, sin un
    # SELECT previo que distinga "existe pero no es tuya".
    updated = supabase.table("notifications").update({"read_at": _now_iso()}) \
        .eq("id", notification_id).eq("user_id", uid).execute().data
    if not updated:
        raise HTTPException(status_code=404, detail="Notification not found")
```

Si un endpoint `/me` necesita mirar permisos de módulo (como `/pending`), usa
`has_view` / `has_edit` para decidir **qué calcular**, nunca para abrir filas
de otro.

### Budget: scope por fila y admin general

Budget es el único módulo con filtrado por fila (`budget_access`). Además del
`require_view("budget")` / `require_edit("budget")` de siempre:

- Toda lectura pasa por `_scoped(q, request, requested, action='view')`; toda
  escritura por `_assert_can_edit(request, dept)` o `_row_or_403(table, id,
  request, "edit")` (404, no 403, sobre filas ajenas).
- `_departments_for(request, 'view' | 'edit' | 'approve')` → `None` = todos,
  lista = esos. Una acción desconocida levanta `ValueError`.
- Lo que no pertenece a ningún departamento (plan de cuentas, datos bancarios
  y fiscales de proveedores, renombrar / dar de baja / borrar proveedores,
  cargar un gasto ya pagado) va
  con **`_assert_general_admin(request)`**: superadmin o fila `'*'` con
  `can_edit`. `require_edit("budget")` solo no alcanza: dejaría al designado de
  IT renombrar una cuenta de Competitions o cambiarle el CBU a un proveedor.

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

## Acceso a datos — el wrapper de Supabase

`from api._lib.database import supabase`. Es un query builder mínimo de
PostgREST (`api/_lib/database.py`). Encadenás y terminás en `.execute()`, que
devuelve un objeto con `.data` (siempre una lista). Lanza `Exception` si el
status HTTP ≥ 400.

Métodos disponibles: `.table(name)` → `.select(cols)`, `.insert(data)`,
`.update(data)`, `.delete()`, filtros `.eq/.gte/.lte/.lt/.ilike/.in_/.or_`,
`.order(col, desc=)`, `.limit(n)`, `.offset(n)`.

Notas:
- ⚠️ **El builder guarda UN filtro por columna** (`self._params[column] = …`).
  Dos filtros sobre la misma columna **se pisan en silencio**, sin error:
  - `.gte("expense_date", a).lte("expense_date", b)` deja vivo solo el `.lte`
    → "gastos de 2027" devolvía también todos los años anteriores. Mandá a la
    base **una** cota (la inferior) y aplicá la otra en Python
    (`_fetch_expenses`, `_summary_data` en `budget.py`).
  - `.in_("department_code", scope).eq("department_code", pedido)` pisa el scope
    → bypass. Por eso `_scoped()` resuelve scope y filtro pedido en **un solo**
    `.eq`/`.in_`.
  - Lo mismo con `status`: si aceptás varios, armá un único `.in_` (ver
    `_queue` en `payments.py`).
- `.neq()` de PostgREST descarta también los `NULL`; si la columna puede venir
  vacía (p.ej. `created_by` de filas importadas), excluí en Python.
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
  provistos) en los módulos viejos.
- En budget y payments los updates usan **`model_dump(exclude_unset=True)`**:
  distingue "no lo mandé" de "ponelo en `null"` (sin eso no hay forma de borrar
  un comentario o sacarle la competencia a un gasto). El precio es rechazar a
  mano el `null` sobre columnas NOT NULL (`_patch_updates` /
  `_REQUIRED_ON_UPDATE` en `budget.py`, `_PAYMENT_NOT_NULL` en `payments.py`).
- Endpoints que comparten lógica no se llaman entre sí como funciones: los
  defaults `Query()` llegan como objetos truthy y se vuelven filtros fantasma.
  Se factoriza el cuerpo (`_fetch_expenses`, `_summary_data`, `_queue`) y cada
  endpoint lo llama con valores reales.

## Manejo de errores

- `raise HTTPException(status_code, detail)`.
- Patrones vistos en el repo:
  - **404** cuando el `.data` de una búsqueda por id viene vacío.
  - **400** cuando no hay campos para actualizar (`"No fields to update"`).
  - **409** en conflictos de unicidad (`"already assigned"`).
  - **413** en uploads que exceden el límite de tamaño.
  - **409** también cuando el estado de la fila no permite la operación, y
    cuando un lock optimista no matchea (`.eq("status", <validado>)` en el
    UPDATE → 0 filas → "changed meanwhile; reload").
- El detalle es un string legible; el frontend lo muestra.

## Cambios de estado: `POST /{id}/transition`

En gastos (`budget.py`) y pagos (`payments.py`) el `status` **no** se edita por
PATCH/PUT (un PATCH/PUT con `status` es 400; las altas nacen `draft` / `new`).
Cambia solo por `POST /{id}/transition`, con este patrón:

```python
# 1. Función PURA: sin I/O, testeable sin base. Recibe la fila, el destino, el
#    body y los derechos del caller ya resueltos. Devuelve qué escribir o
#    levanta 400 (falta dato) / 403 (no le toca) / 409 (transición inválida).
_TRANSITIONS = {("new", "in_process"), ("in_process", "completed"), …}

def check_payment_transition(payment, nomination, banking, target, payload, *,
                             user_id, has_approve, is_superadmin, today=None, now=None):
    if (payment["status"], target) not in _TRANSITIONS:
        raise HTTPException(409, f"Cannot move a payment from … to {target}")
    …
    return {"updates": {...}, "warnings": [...], "meta": {...}}

# 2. Endpoint: permisos → check puro → UPDATE con lock → historial → aviso.
@router.post("/{payment_id}/transition", dependencies=[Depends(require_edit("payments"))])
def transition_payment(payment_id: str, data: PaymentTransition, request: Request):
    payment = _load_payment(payment_id)
    plan = check_payment_transition(payment, …, data.status, data.model_dump(), …)
    rows = supabase.table("payments").update({**plan["updates"], "updated_at": _now_iso()}) \
        .eq("id", payment_id).eq("status", payment["status"]).execute().data
    if not rows:
        raise HTTPException(409, "The payment changed meanwhile; reload and try again")
    record_transition("payment", payment_id, payment["status"], data.status, request,
                      reason=data.reason, meta=plan["meta"] or None)
    notify(destinatarios, "payment_completed", titulo, …, exclude=_user_id(request))
```

- **`record_transition()`** (`services/finance_history.py`) escribe en
  `finance_status_history`; **`notify()`** (`services/notify.py`) en
  `notifications`. Los dos son **best-effort**: loguean un warning y nunca
  levantan — el cambio de estado ya se aplicó. Llamá a `record_transition`
  también en el alta (`from_status=None`).
- `meta`: `{"override": …}` cuando un superadmin aprueba/completa lo propio
  (siempre con `reason` obligatorio), `{"bulk": true}` en lotes, y datos de la
  transición (`payment_date`, `paid_amount`).
- Un lote (`/bulk-status`) aplica la misma función ítem por ítem y **nunca
  aborta**: devuelve `{ok: [...], failed: [{id, record_no, error, status_code}]}`.
- Separación de funciones: para aprobar un gasto, completar un pago o
  registrar un pago parcial, ni `created_by` ni `last_financial_edit_by`
  (migración 050) pueden ser el caller; el superadmin pasa con `reason` y
  `meta.override`. Todo camino que cambie montos sella
  `last_financial_edit_by/at` y deja una fila en el historial con el mismo
  status y `meta.edit`; los DELETE, una con `to_status = 'deleted'`.
- Si una transición se resuelve con un permiso que **no** es `can_edit` del
  módulo (aprobar un gasto es `budget_access.can_approve`), el decorador puede
  ir sin `require_edit` — pero la función tiene que exigir, por transición, uno
  de los derechos válidos, y hay que dejar el porqué en un comentario arriba del
  endpoint (ver `transition_expense` en `budget.py`).
- Cada transición nueva va con su fila en el test
  (`test_transition_table_is_the_documented_one`) y en BUDGET_MODULE.md §14.

## Exports a Excel: `services/xlsx_utils.py`

Los exports nuevos (pagos, gastos, resumen de budget) usan
`api/_lib/services/xlsx_utils.py` en vez de repetir `_autosize` / `_save`:

```python
from openpyxl import Workbook
from api._lib.services.xlsx_utils import (
    autosize, money_format, safe_text, style_header, workbook_bytes, xlsx_response,
)
wb = Workbook(); ws = wb.active
ws.append(headers); style_header(ws)          # navy del DS + fila congelada
for r in rows:
    ws.append([safe_text(r["name"]), float(r["amount"] or 0)])
money_format(ws, [2]); autosize(ws)
return xlsx_response(workbook_bytes(wb), "pagos-2027.xlsx")
```

- `safe_text()` en **todo** texto: antepone `'` a lo que empieza con `= + - @`
  (formula injection). Los montos van como número, no como string.
- `xlsx_response()` sanitiza el nombre y manda `Cache-Control: private,
  no-store` (llevan montos).
- El export sale de **la misma función** que la pantalla, con los mismos
  filtros: en budget eso significa que pasa por `_scoped()`.
- Los exports viejos (`logistics_import.py`, `budget_import.py`) no se migraron
  a propósito.

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
- `employees` = staff interno de FIBA (solo inventario), **no** se nomina.
- El esquema real está en `supabase/migrations/*.sql` (numeradas).
