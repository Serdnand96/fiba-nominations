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
VITE_FIBA_SERVICE_URL=http://localhost:3002
```

> **No commitees `.env`** (ya está en `.gitignore`).
>
> Las keys actuales viven en `/opt/fiba-nominations/.env` en el droplet;
> pedile al admin si necesitás conectarte al proyecto Supabase real.
> Alternativa: usar un proyecto Supabase de staging propio.

---

## Correr el stack

### Opción 1 — los 3 procesos en una sola terminal

```bash
npm run dev
```

Eso lanza concurrentemente:
- **vite** (frontend) → http://localhost:5173
- **fiba_sync** (micro-service) → http://localhost:3002

Pero **no incluye el FastAPI principal**. Para ese, abrir otra terminal:

```bash
./venv/bin/uvicorn api.index:app --reload --port 8000
```

### Opción 2 — los 3 separados

```bash
# terminal 1
npm run dev:frontend                 # vite

# terminal 2
./venv/bin/uvicorn api.index:app --reload --port 8000

# terminal 3 (solo si tocás fiba_sync)
npm run dev:fiba                     # uvicorn services.fiba_sync:app
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
| http://localhost:3002        | fiba_sync micro-service                  |
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

6. **Traducciones** en `src/i18n/es.js` y `src/i18n/en.js`:

   ```js
   nav: { modulo: 'Mi Módulo' }
   ```

7. **Permission** — insertar fila en `user_permissions` para los users
   que deban acceder (o superadmin lo tiene gratis).

### Agregar un template `.docx` de competition

1. Drop el `.docx` en `templates/`
2. SQL: agregar el key al `CHECK` constraint de `competitions.template_key`
3. `api/_lib/services/document_generator.py` → `TEMPLATE_FILES[key] = 'archivo.docx'`
4. `api/_lib/models.py` → `TEMPLATE_FIELDS[key] = [...]` con los placeholders
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

⚠️ **No hay test suite aún.** El test "manual" oficial es el
`verify_security.sh` que corre contra producción.

Si vas a agregar tests:
- Backend: pytest + httpx (recomendado)
- Frontend: vitest + Testing Library

---

## Debugging

### Frontend

- React DevTools (extensión Chrome)
- Network tab para ver JWT en headers + responses
- `localStorage.fiba_dark` para forzar light/dark mode
- `localStorage.fiba_lang` para forzar idioma

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

5. **vercel.json y .vercel/** existen pero **están dead**. El deploy
   real es al DigitalOcean droplet — ver `DEPLOYMENT.md`.

6. **`personnel` ≠ `employees`** — TDs/VGOs vs staff interno. Dos
   tablas distintas, no mezclar.
