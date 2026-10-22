---
name: security-checklist
description: Checklist de seguridad de fiba-nominations — autorización a nivel de app (el service_role bypassa RLS), permisos por usuario con require_view/require_edit/require_superadmin, guards de frontend que son solo UX, storage privado, el estado real del módulo Logística (permisado, sin auth standalone), la vista pública por token, y finanzas (scope por departamento de Budget, aprobación con separación de funciones, datos bancarios por persona, notificaciones /me). Usar al revisar cambios que tocan auth, permisos, datos o storage.
---

# Checklist de seguridad (fiba-nominations)

El modelo mental correcto: **la base de datos no protege nada por sí sola**, y
**el frontend tampoco**. La seguridad vive en las dependencies de permiso del
backend. Revisá cada cambio con eso en mente.

## 1. Autorización a nivel de aplicación (lo central)

- El backend pega a Supabase con el **`service_role` key**
  (`api/_lib/database.py`). Ese key **bypassa Row Level Security**. Conclusión:
  toda tabla es accesible desde el backend sin restricción → **la autorización
  se enforcea en el código**, endpoint por endpoint.
- Enforcement con las dependencies de `api/_lib/auth.py`:
  - Cada router declara el permiso de lectura a nivel `APIRouter`:
    `dependencies=[Depends(require_view("<módulo>"))]`.
  - Cada endpoint de escritura agrega `Depends(require_edit("<módulo>"))`.
  - Endpoints solo-superadmin: `Depends(require_superadmin)`.
- Fuente de verdad de permisos: tabla `user_permissions` (`can_view`/`can_edit`
  por `user_id`+`module`) y `user_profiles.is_superadmin` (siempre pasa).

**❗ Revisión P0:** cualquier endpoint nuevo/modificado **sin** dependency de
permiso es un agujero — expone datos a cualquier usuario autenticado (o al mundo
si cuelga de `/api/public/*`). Buscá routers o rutas sin `require_*` y marcalos.

```bash
# Ayudas para revisar:
grep -rn "APIRouter(" api/_lib/routers/            # ¿cada uno con require_view?
grep -rn "@router\.\(post\|put\|patch\|delete\)" api/_lib/routers/  # ¿cada uno con require_edit?
```

### 1b. La excepción: el Muro (`feed`)

`api/_lib/routers/feed.py` es el **único** router donde escrituras van con
`require_view`. Es a propósito y no es un hallazgo:

- `feed:view` = **participar** (publicar, reaccionar, comentar, votar, editar y
  borrar lo propio). El router lleva `require_view("feed")` y cada escritura
  sobre contenido ajeno pasa por `_assert_can_manage()` → autor o moderador.
- `feed:edit` = **moderar** (fijar, marcar oficial, borrar ajeno). Eso sí lleva
  `require_edit("feed")` o el chequeo `has_edit()` (la variante bool de
  `auth.py`).

Lo que SÍ hay que revisar ahí: que toda escritura sobre algo ajeno pase por
`_assert_can_manage()`, que `is_official` no lo pueda setear un no-moderador, y
que las fotos sigan bajo el prefijo `feed/` del bucket público `inventory` (no
documentos: el muro es solo fotos).

## 2. Middleware de auth

- Valida el `Bearer <JWT>` contra `GET {SUPABASE_URL}/auth/v1/user` y guarda el
  usuario en `request.state.user` (ver `api/index.py`).
- **Bypassa auth solo para:** `OPTIONS`, `/api` (health) y `/api/public/*`.
- Las rutas públicas (`/api/public/*`) llevan rate-limit por IP (60/min) y **no**
  deben devolver datos sensibles ni aceptar escrituras sin token de un solo uso.
- `/download` y `/export/pdf` **requieren auth** (hallazgo de pen-test N1): el
  frontend manda el JWT vía fetch+blob. No los abras.

## 3. Los guards del frontend son UX, no seguridad

- `hasView`/`hasEdit`/`PermissionGuard`/`SuperadminGuard` solo **esconden UI**.
  Un usuario puede pegarle al API igual. **Nunca** confíes en el frontend para
  proteger un dato: el gate real es la dependency del backend.

## 4. Estado de RLS (defensa en profundidad, no control principal)

- RLS está habilitada en algunas tablas como capa extra (ver migraciones
  `006_enable_rls_game_assignments.sql`,
  `007_lock_enforce_email_domain_grants.sql`), pero **como el backend usa
  `service_role`, RLS no es lo que protege los datos en runtime**.
- **No asumas** que una tabla está protegida solo porque "tiene RLS". El control
  efectivo es la dependency de permiso del endpoint.

## 5. Módulo Logística (antes Transport) — corrección importante

- Logística es un **módulo normal permisado**: todos sus endpoints usan
  `require_view("logistics")` / `require_edit("logistics")`. Vive en **dos
  routers** que comparten ese único permiso:
  `api/_lib/routers/logistics.py` (padrón, manifest, hospedaje, comidas, links)
  y `api/_lib/routers/transport.py` (vehículos, choferes, viajes; su prefijo de
  URL sigue siendo `/transport`). En el frontend comparte el **mismo
  `AuthContext` y el mismo cliente de Supabase** (`src/lib/supabase.js`) que
  todo el resto.
- **No existe** una "Supabase Auth standalone" ni un aislamiento especial.
  Revisalo con **el mismo** checklist de permisos que cualquier otro módulo: lo
  que hay que verificar es que cada endpoint lleve su dependency, no un supuesto
  sandbox separado.
- El permiso `transport` **ya no existe** (migración 025 lo renombró a
  `logistics` en `user_permissions`). Un `require_view("transport")` que
  sobreviva en el código es un endpoint al que nadie puede entrar.

## 5b. Vista pública de logística

- `api/_lib/routers/public_logistics.py` sirve **sin auth** bajo
  `/api/public/logistics/{token}`. El token de `logistics_public_links` es el
  único credencial.
- Token inválido, inexistente o con `enabled = false` deben contestar **el mismo
  404** (`_resolve_link`). Cualquier respuesta que distinga esos casos filtra
  qué tokens existen.
- **Por decisión explícita del cliente la vista publica los datos completos,
  número de pasaporte incluido.** El único punto para recortar eso es
  `_redact()`; si alguna vez hay que ocultar campos, se cambia ahí y no en los
  cuatro endpoints.
- Las respuestas bajo `/api/public/` llevan `X-Robots-Tag: noindex` (middleware
  en `api/index.py`). Si agregás una vista pública nueva, cae bajo esa regla
  sola — pero no la saques del prefijo `/api/public/`, porque ahí también viven
  el bypass de auth y el rate limit por IP.

## 6. Storage privado

- Hay un único bucket **privado**: `nominations` (payments y reports guardan
  bajo los prefijos `payments/…` / `reports/…` dentro de él). El bucket
  `inventory` es **público** a propósito: fotos de assets (QR), de personnel y
  del Muro (`feed/…`). Solo imágenes; un documento jamás va ahí. Reglas:
  - Nunca construir/devolver URLs públicas (`get_public_url`) para ellos.
  - Servir archivos solo por endpoints de descarga **autenticados** (blob+JWT).
  - Borrados que tocan storage van por la Storage API
    (`_delete_pdf_from_storage`), no por SQL directo.
  - Respetar la convención `storage://<bucket>/<key>` y su normalización
    (`_extract_storage_key`, 3 formatos).

## 7. Input, uploads y errores

- Validación con Pydantic en todos los bodies.
- Uploads: cap de tamaño (→ 413) y chequeo de extensión (p.ej. training: 5 MB,
  solo `.xlsx/.xls`). Sanitización de nombres de archivo (`_SAFE_FILENAME_RE` en
  nominations).
- Errores como `HTTPException` con detalle legible; los parsers no filtran
  contenido del archivo en el mensaje de error.

## 8. Secretos y config

- `SUPABASE_SERVICE_ROLE_KEY`, `DROPLET_SSH_KEY`, `CLOUDCONVERT_API_KEY`, etc.
  **nunca** en el repo, logs ni commits. El service_role solo del lado servidor.
- CORS restringido por `CORS_ORIGINS`; headers de seguridad + CSP fijados en
  `api/index.py`. No los aflojes sin motivo.

## 9. Auditoría

- Las escrituras autenticadas (`POST/PUT/PATCH/DELETE`, salvo `/api/public/*`)
  se registran en el activity log vía middleware (background task). No
  deshabilites el auditing para escrituras autenticadas.

## 10. Finanzas: Budget, Payments y la campana

Budget es el **único** módulo con recorte por fila (`budget_access`), y el
recorte vive en el código (el `service_role` bypassa RLS). Contrato completo en
`BUDGET_MODULE.md` §4, §14-§16.

### 10a. Scope por departamento

- Toda lectura de `expenses | budget_lines | revenues | recurring_expenses |
  payments` en `budget.py` va dentro de `_scoped(…)`. La **única** excepción
  documentada es `GET /budget/competitions/{id}/cost`. Una query sin `_scoped()`
  es P0.
- `_scoped()` aplica **un solo** `.eq`/`.in_` sobre `department_code`: el
  builder guarda un filtro por columna y un segundo filtro encadenado pisa el
  scope (bypass con `?department=finance`).
- **Los exports pasan por `_scoped`**: `/budget/expenses/export.xlsx` y
  `/budget/summary/export.xlsx` salen de las mismas funciones que la pantalla
  (`_expense_rows` → `_fetch_expenses`, `_summary_data`). Un export nuevo que
  arme su propia query es un hallazgo.
- Escrituras: `_assert_can_edit(dept)` o `_row_or_403(…, "edit")`; mover una
  fila a otro departamento exige permiso sobre el destino. Filas ajenas → 404.

### 10b. Aprobación y separación de funciones

- Aprobar/rechazar gastos es `budget_access.can_approve` del departamento
  (migración 048), **no** `can_edit`. `can_approve` implica `can_view`.
- **`created_by != aprobador` y `last_financial_edit_by != aprobador`**
  (migración 050): nadie aprueba un gasto ni completa un pago que creó **o cuyo
  último cambio de plata hizo** — si no, A edita a $10.000 el gasto de $100 que
  cargó B y lo aprueba. El superadmin puede, **solo con `reason`**, y queda
  `meta.override` en `finance_status_history`. Verificá que toda acción nueva
  que "suelte plata" mantenga las dos reglas y el motivo obligatorio, y que todo
  camino que edite montos selle `last_financial_edit_by/at`.
- Completar un pago exige `payments:edit` **más** el permiso no-página
  `payments_approve` (o superadmin), además de fecha, nominación no declinada,
  CM aprobado, W-8 vigente, datos bancarios y `paid_amount == total`.
- **`POST /payments/{id}/record-partial`** (pago parcial) suelta plata igual que
  completar y lleva **el mismo gating**. `paid_amount` no se escribe por
  ningún otro camino (el PUT ya no lo acepta): si aparece en otro update, es un
  bypass.
- Las ediciones de plata y los DELETE de gastos y pagos dejan fila en
  `finance_status_history` (`meta.edit` / `to_status = 'deleted'`). Un camino
  nuevo que cambie montos sin dejar traza es un hallazgo.
- **Rutas sin `require_edit` en el decorador, a propósito** — no es un
  hallazgo, pero sí hay que revisar que adentro se siga chequeando:
  - `POST /budget/expenses/{id}/transition` y `POST /budget/expenses/{id}/approve`
    (alias): el router exige `require_view("budget")` y
    `check_expense_transition()` exige, por transición, `can_approve` del
    departamento, o "editor" (= `has_edit("budget")` + `can_edit` del depto), o
    superadmin. El aprobador puede no tener `budget:edit`; agregar
    `require_edit` lo dejaría afuera.
  - Ninguna otra escritura de budget/payments va sin `require_edit` (o
    `require_superadmin`).
- **`status` nunca por PATCH/PUT**: un `{"status": "paid"}` en un update se
  saltearía todo lo anterior. Grep: ningún update de `expenses` / `payments`
  fuera de las transiciones debe escribir `status`.

### 10c. Admin general (lo que no se recorta por fila)

`_assert_general_admin()` = superadmin o fila `'*'` con `can_edit`. Lo exigen:
`POST`/`PATCH` de `/budget/accounts`, `/accounts/{code}/remap`,
`DELETE /budget/vendors/{id}`, cambiar `name` / `active` de un proveedor, crear
un gasto ya `paid`, y **todo** lo que toque `vendors.bank_info` /
`vendors.tax_id`:

- Un no-admin recibe `has_bank_info: bool`, nunca el dato: ni en el GET, ni en
  la **respuesta** de un POST/PATCH (`_shape_vendor`), ni como oráculo de
  búsqueda (`search` sobre `tax_id` solo corre para el admin).
- Un POST/PATCH de un no-admin que traiga esos campos —aunque sea en `null`—
  es 403. Cambiar el CBU de un proveedor es el fraude de manual.

El headcount y los supuestos no son de admin general sino de Competitions:
los GET exigen **ver** ese departamento y los PUT **editarlo**.

### 10d. Datos bancarios de personas (`personnel_banking`)

- **Solo** por `/api/payments/personnel/{id}/banking/*` (hereda
  `require_view("payments")`). **Nunca** por `personnel.py`: quien tiene
  `personnel` sin `payments` no tiene que ver ni la ficha enmascarada. Ídem en
  el front (`BankingPanel` solo con `hasView('payments')`, que es UX).
- El GET **enmascara** `account_number`, `routing_number`, `iban` y nunca
  devuelve `tax_form_path`.
- `POST …/banking/reveal` (con `require_edit("payments")`) es el único camino a
  los números completos y es **POST para que el activity log lo audite** (el
  middleware no registra GETs). Pasarlo a GET borra la auditoría.
- La descarga del W-8 es **`POST …/banking/tax-form/download`** con
  `require_edit("payments")`, auditada igual que `reveal`. Un GET de descarga
  ahí es un hallazgo.
- El export de pagos no lleva números de cuenta.
- El W-8 va al bucket **privado** `nominations` bajo `banking/`, solo PDF
  (magic bytes `%PDF`), ≤ 10 MB.
- Los adjuntos de pagos y gastos aceptan PDF o imagen, **sin SVG** (es
  `image/*` pero lleva scripts), ≤ 10 MB (413).

### 10e. Notificaciones (`/api/me/notifications`)

- Router con `require_user`, sin permiso de módulo (como `/me` de profile).
- **Toda** query filtra por `user_id` del caller, en lecturas **y** escrituras:
  el `UPDATE` de marcar leída lleva `id` y `user_id` en el mismo filtro, así una
  ajena da 404 igual que una inexistente. Un endpoint nuevo ahí sin ese filtro
  es P0 (lee o modifica la bandeja de otro).
- `/pending` solo calcula un ítem si el caller tiene el permiso que lo habilita
  (`has_view` / `has_edit`) y devuelve contadores + link, nunca filas.
- `notify()` es best-effort: un fallo nunca puede tumbar la transición.
- `budget_approvers_for()` solo devuelve usuarios que además pueden entrar al
  módulo (`budget` con `can_view`, o superadmin): una fila suelta de `budget_access` no recibe títulos de gastos (con
  monto y departamento) de un módulo que no puede abrir.

### 10f. Google Calendar (`/api/me/google-calendar`)

- Router con `require_user`; toda query por el `user_id` del caller. Conectar y
  sincronizar piden además `has_view('calendar') or has_view('games')`; el cron
  re-chequea el permiso por usuario en cada corrida (`user_can_sync`).
- `refresh_token_enc` va cifrado con Fernet (`GOOGLE_TOKEN_KEY`). **Ninguna**
  respuesta lo devuelve, ni `oauth_state_hash`: todo pasa por `_public()` del
  router. Un campo nuevo en la respuesta se agrega ahí, no devolviendo la fila.
- El `state` del OAuth se guarda hasheado, vence a los 10 minutos, se compara
  con `hmac.compare_digest` y se consume aunque el callback falle.
- Scope mínimo `calendar.app.created`. Ampliarlo es un cambio de seguridad, no
  de comodidad.

## 11. Regla de dominio — neutralidad de árbitros

- No se nomina/asigna un árbitro a juegos que involucran su país. La lógica se
  apoya en `country_code`/`nationalities` (migraciones `014_referee_neutrality`,
  `016_referee_nationalities_and_crew_roles`; ver `personnel.py`, `games.py`).
  Si un cambio toca asignaciones de REFs, verificá que los checks de neutralidad
  sigan intactos.

---

## Contexto de pen-test

Cerrado en mayo 2026 (H1–H9 + N1, N2, N3 cerrados). Pendientes manuales
(N4–N8) documentados en `SECURITY_RUNBOOK.md` (SPF/DMARC/CAA, WAF, rate limits
de Supabase Auth). Tenelos presentes pero no son código de este repo.

## Checklist rápido para un PR

- [ ] ¿Cada router nuevo tiene `require_view` a nivel `APIRouter`?
- [ ] ¿Cada endpoint de escritura tiene `require_edit` (o `require_superadmin`)?
- [ ] ¿Ninguna ruta nueva bajo `/api/public/*` devuelve datos sensibles o acepta
      escrituras sin token?
- [ ] ¿Ningún archivo de bucket privado se sirve por URL pública?
- [ ] ¿Los borrados que tocan storage pasan por la Storage API?
- [ ] ¿Uploads con cap de tamaño + extensión validada?
- [ ] ¿Se preservan los headers/CSP/CORS y el activity log?
- [ ] Si toca REFs: ¿neutralidad intacta?
- [ ] Budget: ¿toda query nueva (incluidos exports) pasa por `_scoped()`, con
      un solo filtro sobre `department_code`?
- [ ] Gastos/pagos: ¿el `status` cambia solo por `/transition`, con
      `created_by` y `last_financial_edit_by` distintos del aprobador y `reason`
      obligatorio en el override? ¿`paid_amount` solo por `/record-partial` y
      `/transition`?
- [ ] ¿Las rutas sin `require_edit` en el decorador (transición/aprobación de
      gastos) siguen chequeando el derecho adentro?
- [ ] ¿`bank_info` / `tax_id` de proveedores siguen solo para el admin general
      (GET, respuesta de PATCH y búsqueda)?
- [ ] ¿`personnel_banking` sigue fuera de `personnel.py`, enmascarado en el GET
      y con `reveal` y la descarga del W-8 como POST auditados?
- [ ] `/me/*`: ¿cada query filtra por el `user_id` del caller?
