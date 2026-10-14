# Development

Cómo correr el stack en tu máquina. Para arquitectura general ver
[`ARCHITECTURE.md`](ARCHITECTURE.md), para deploy ver
[`DEPLOYMENT.md`](DEPLOYMENT.md).

---

## Prerequisites

- **Node 20+** y npm
- **Python 3.11+**
- **LibreOffice** instalado (`brew install --cask libreoffice` en
  macOS) si vas a probar generación de PDFs locally
- Acceso al proyecto Supabase (anon key + service-role key)

---

## Setup inicial

```bash
git clone git@github.com:Serdnand96/fiba-nominations.git
cd fiba-nominations

# Frontend deps
npm install

# Backend venv
python3.11 -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/pip install "uvicorn[standard]"
```

---

## Environment variables

Copia `.env.example` a `.env`:

```bash
cp .env.example .env
```

Y llená:

```bash
SUPABASE_URL=https://mckaplalscnvaanukrmz.supabase.co
SUPABASE_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service-role key>

VITE_SUPABASE_URL=https://mckaplalscnvaanukrmz.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
VITE_API_URL=/api

CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```

> **No commitees `.env`** (ya está en `.gitignore`).
>
> Las keys actuales viven en `/opt/fiba-nominations/.env` en el droplet;
> pedile al admin si necesitás conectarte al proyecto Supabase real.
> Alternativa: usar un proyecto Supabase de staging propio.

---

## Correr el stack

```bash
# terminal 1
npm run dev                          # vite (frontend) → http://localhost:5173

# terminal 2
./venv/bin/uvicorn api.index:app --reload --port 8000
```

### Proxy

`vite.config.js` proxea `/api/*` → `http://localhost:8000`, así que el
frontend en :5173 puede llamar `/api/nominations` y vite lo redirige al
FastAPI local sin CORS.

---

## URLs locales

| URL                          | Qué es                                   |
|------------------------------|------------------------------------------|
| http://localhost:5173        | Frontend Vite (HMR)                      |
| http://localhost:8000/api    | FastAPI raw (no proxy, útil para curl)   |
| http://localhost:5173/api/X  | Frontend con proxy al backend            |

---

## Workflows comunes

### Agregar un módulo nuevo

1. **Backend router** — crear `api/_lib/routers/<modulo>.py`:

   ```python
   from fastapi import APIRouter, Depends
   from api._lib.auth import require_view, require_edit

   router = APIRouter(prefix="/api/<modulo>", tags=["<modulo>"])

   @router.get("", dependencies=[Depends(require_view("<modulo>"))])
   def list_items():
       ...
   ```

2. **Mount** en `api/index.py`:

   ```python
   from api._lib.routers import <modulo>
   app.include_router(<modulo>.router)
   ```

3. **Frontend page** — `src/pages/<Modulo>.jsx`:

   ```jsx
   export default function Modulo() {
     return <div>...</div>
   }
   ```

4. **Ruta + permission guard** en `src/App.jsx`:

   ```jsx
   const Modulo = lazy(() => import('./pages/Modulo'))
   // …
   { to: '/modulo', label: t('nav.modulo'), module: '<modulo>' }
   // …
   <Route path="/modulo" element={
     <PermissionGuard module="<modulo>"><Modulo /></PermissionGuard>
   } />
   ```

5. **Icono** en el map `moduleIcon` (`src/App.jsx`):

   ```js
   <modulo>: Icon.<Algo>,
   ```

6. **Traducciones** en `src/i18n/translations.js` (una sola tabla con
   ambos idiomas por key):

   ```js
   nav: { modulo: { en: 'My Module', es: 'Mi Módulo' } }
   ```

7. **Permission** — insertar fila en `user_permissions` para los users
   que deban acceder (o superadmin lo tiene gratis).

### Agregar un template `.docx` de competition

1. Drop el `.docx` en `templates/`
2. SQL: agregar el key al `CHECK` constraint de `competitions.template_key`
3. `api/_lib/services/document_generator.py` → `TEMPLATE_SPECS[key]` (archivo + contexto)
4. `api/_lib/routers/templates.py` → `TEMPLATES` para exponerlo en la UI
5. Si el template tiene lógica especial: `src/pages/Nominations.jsx`

### Agregar un icono al DS

`src/lib/icons.jsx`:

```jsx
export const Icon = {
  // …existentes
  MiIcono: I(<><path d="..."/><path d="..."/></>),
}
```

Paths SVG de Tabler Icons (MIT). Buscá en https://tabler.io/icons.

### Tocar tokens de color

Si añadís un shade nuevo, va en `tailwind.config.js`. Si querés que un
alias `fiba-*` cambie con dark mode, va con la sintaxis CSS-var (ver
`DESIGN_SYSTEM.md`).

---

## Tests

```bash
./venv/bin/pip install -r requirements-dev.txt   # o: uv pip install --python venv/bin/python pytest
./venv/bin/python -m pytest tests -q
```

Son tests unitarios de backend, **sin red ni base**: `tests/conftest.py`
reemplaza el cliente de `api/_lib/database.py` por un supabase falso en memoria
(hereda del `_QueryBuilder` real, así que el encadenado y la semántica de "un
filtro por columna" son los de producción) en **todos** los tests, y trae un
`FakeRequest` con `state.user` y `state._is_superadmin` precargados. No hace
falta `.env`.

Qué cubren:

| Archivo | Qué |
|---|---|
| `test_authorization.py` | `require_view` / `require_edit` / `require_superadmin` (401/403, fail-closed) y la autoría del Muro |
| `test_budget_scope.py` | `_scoped()` mirando el filtro que viaja a PostgREST, `_departments_for` (`view`/`edit`/`approve`), `_assert_can_approve`, `_is_general_admin` |
| `test_payment_transitions.py` | cada fila de la máquina de estados de pagos, W-8 (`tax_form_status`), `has_bank_info`, `mask_value` |
| `test_expense_transitions.py` | cada fila de la máquina de estados de gastos, self-approval y override del superadmin |
| `test_summary_year.py` | a qué año cae un pago o ingreso (`_payment_fiscal_year`, `_revenue_year`) y ejecutado/comprometido (`_payment_buckets`) |
| `test_notifications.py` | `notify()`, `budget_approvers_for`, `/pending` y el aislamiento por usuario de `/me/notifications` |
| `test_finance_review.py` | lo que salió de la revisión: `check_partial_payment`, invariante de `completed`, separación por `last_financial_edit_by`, `by_month == totals`, vendors, `cm_pending`, headcount 403 |

Las funciones de transición (`check_payment_transition`,
`check_expense_transition`) y las de año/balde son **puras a propósito**:
reciben la fila y los derechos del caller ya resueltos y devuelven qué escribir
o levantan `HTTPException`. Eso es lo que permite testear las reglas de plata
sin base. Si agregás una transición, sumá la fila a la tabla del test
(`test_transition_table_is_the_documented_one` falla hasta que lo hagas).

⚠️ **No hay job de CI**: nadie los corre por vos. Correlos antes de pushear
cambios en `auth.py`, `budget.py`, `payments.py` o `notifications.py`. El smoke
test contra producción sigue siendo `verify_security.sh`. Frontend: sin tests.

---

## Debugging

### Frontend

- React DevTools (extensión Chrome)
- Network tab para ver JWT en headers + responses
- `localStorage.fiba_dark` para forzar light/dark mode
- `localStorage['fiba-lang']` para forzar idioma

### Backend

- `print()` aparece en stdout del uvicorn (en dev)
- En prod: `ssh fiba sudo journalctl -u fiba-api -f`
- Para reproducir bugs prod localmente: usar la misma Supabase con
  service-role, pegarle a `localhost:8000/api/...` con el JWT real
  del usuario afectado

### Supabase

- Studio: https://supabase.com/dashboard/project/mckaplalscnvaanukrmz
- SQL editor para queries ad-hoc
- Logs: dashboard → Logs Explorer (auth events, postgres queries)

---

## Convenciones de código

- **Commits:** type prefix (`feat:`, `fix:`, `docs:`, `design:`, `ops:`,
  `security:`). Ver `git log` para más patrones.
- **Branches:** trabajo directo en `main` para hotfixes; feature
  branches para cambios grandes. Push a main = deploy automático.
- **Imports:** absolute desde `src/` en frontend; absolute desde `api.`
  en backend.
- **Lang:** mensajes user-facing en ES por default, traducción en EN.
  Comentarios de código en ES o EN, sin mezclar dentro del mismo archivo.

---

## Trampas conocidas

1. **LibreOffice locks** — si corrés muchas generaciones de PDF en
   paralelo, LO se traba. Usar profile dir por request (ya manejado
   en `document_generator.py`).

2. **CORS** — si tu frontend está en otro puerto (ej. Storybook en
   :6006) agregalo a `CORS_ORIGINS`.

3. **Auth middleware bypassa `/api`** — si testeás un endpoint vía
   curl sin JWT, le pegás directo y devuelve 401 — eso es esperado.
   Sacá un JWT con `await supabase.auth.signInWithPassword(...)` y
   pegalo al header.

4. **`storage://nominations/X` paths** — son convención propia, no son
   URLs reales. El backend los traduce. Si necesitás el URL real:
   `await supabase.storage.from_("nominations").createSignedUrl(...)`.

5. **Vercel está muerto.** `vercel.json` ya no existe (a lo sumo queda un
   `.vercel/` local, gitignoreado). El deploy real es al DigitalOcean
   droplet — ver `DEPLOYMENT.md`.

6. **`personnel` ≠ `employees`** — TDs/VGOs vs staff interno. Dos
   tablas distintas, no mezclar.
