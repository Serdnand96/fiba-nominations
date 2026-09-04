---
name: frontend-conventions
description: Convenciones del frontend React de fiba-nominations — estructura de carpetas, routing con lazy-load y permission guards, auth/i18n por contexto, el cliente HTTP (src/api/client.js), descargas de buckets privados, y el uso de Tailwind con los tokens del design system. Usar al implementar o revisar UI.
---

# Frontend conventions — React 18 + Vite + Tailwind (fiba-nominations)

SPA en React 18 con Vite, servida como estático por nginx en el droplet. Todo
el estado de sesión vive en contextos; no hay Redux ni librería de data
fetching — se usa `axios` vía un cliente central.

## Estructura de carpetas (`src/`)

```
src/
├── App.jsx              ← shell: sidebar + topbar + router + guards
├── main.jsx            ← monta App, envuelve en AuthProvider + LanguageProvider
├── pages/              ← una página por ruta (Nominations.jsx, Training.jsx, …)
│   ├── games/          ← paneles de Games: ChecklistPanel, ChecklistRunner, SyncReport…
│   ├── budget/         ← BudgetImport
│   └── logistics/      ← TransportTab, HousingTab, ManifestTab, SharePanel, SheetImport
├── components/
│   ├── ui/             ← primitivos del DS (Button, Card, Input, Table, Modal, Tooltip…)
│   ├── brand/          ← Logo (Monogram, Wordmark)
│   ├── ProfileModal.jsx        ← "Mi perfil": foto o avatar (se abre desde el sidebar)
│   ├── PersonProfilePanel.jsx  ← panel lateral de una persona (personnel)
│   ├── CompetitionSearch.jsx   ← buscador de competencias reutilizable
│   └── NominationsMatrix.jsx
├── contexts/AuthContext.jsx
├── i18n/               ← LanguageContext.jsx + translations.js (ES/EN)
├── lib/                ← icons.jsx, supabase.js, utils, countries, roles, lastSearch,
│                          competitions.js, warRoom.js, avatars.js, refereeNeutrality.js
└── api/client.js       ← todas las llamadas HTTP al backend
```

### Módulos de `lib/` que hay que usar en vez de reinventar

- **`competitions.js`** — `COMPETITION_TYPES` / `SELECTABLE_COMPETITION_TYPES`
  (registro único, coincide con el CHECK de la migración 042),
  `competitionLabel()` (nombre para mostrar con año) y `sortCompetitions()`. Todo `<select>` o filtro de competencias sale de acá:
  hay pares con `name` idéntico que solo difieren por el año.
- **`warRoom.js`** — hora del war room de Miami (`WAR_ROOM_TZ`) desde
  `game.datetime_utc`. `date`/`time` de un partido son hora local de la sede;
  nunca sumes un offset.
- **`avatars.js`** — DiceBear, cargado con `import()` dinámico para no engordar
  el bundle principal.

## Routing, lazy-load y permission guards (`App.jsx`)

- **Toda página autenticada se lazy-loadea:**
  `const Training = lazy(() => import('./pages/Training'))`. Vite genera un
  chunk por página. Solo `Login` y las vistas públicas se cargan distinto.
- Cada ruta va envuelta en `<PermissionGuard module="X">…</PermissionGuard>`,
  que muestra un 403 si no hay `can_view`. Las rutas superadmin-only usan
  `<SuperadminGuard>` (p.ej. `/activity`).
- La ruta `/` redirige al **primer item visible** del sidebar (`defaultRoute`):
  el orden de `allNavItems` decide la página de entrada (hoy, el Muro si el
  usuario tiene `feed`).
- Vistas públicas sin login (fuera del shell): `/asset/:id`,
  `/availability/:token`, `/logistica/:token`, `/checklist/:token`. Pegan a
  `/api/public/*` sin JWT; no les agregues llamadas a endpoints autenticados.
- Para una página nueva: (1) `lazy(import)`, (2) `<Route>` con su guard, (3)
  entrada en `allNavItems` (`{ to, label: t('nav.x'), module }`), (4) icono en
  el map `moduleIcon`, (5) el permiso en `MODULES` de `src/pages/Users.jsx`
  (y en el backend: CHECK de `user_permissions.module` + `MODULES` de
  `api/_lib/routers/permissions.py`). El sidebar filtra items por
  `hasView`/`isSuperadmin`.
- No toda funcionalidad es una página: Crew, Staffing Plan y Control de
  operación son paneles dentro de Games con el permiso `games`; `comp_days` es
  una columna de Employees. Antes de crear un módulo, fijate si es un panel.

## Auth (`useAuth()` de `contexts/AuthContext`)

```jsx
const { user, loading, signIn, signOut, isSuperadmin, hasView, hasEdit, profile, updateProfile } = useAuth()
```

- `profile` es lo propio del logueado (hoy `avatar_url`, de `user_profiles`),
  cargado desde `/api/me`; `updateProfile` lo refresca después de subir o
  quitar la foto en `ProfileModal` (`/api/me/avatar`). La URL lleva
  `?v=<timestamp>` porque la key del bucket es siempre la misma.

- La sesión se maneja con Supabase Auth (un único cliente en `lib/supabase.js`,
  anon key). Al loguear/refrescar se cargan los permisos desde el backend
  (`getUserPermissions`).
- Gate de UI de edición: `const canEdit = hasEdit('training')` y escondé
  botones/acciones según eso. **Esto es solo UX** — la seguridad real la aplica
  el backend; nunca confíes en el guard del frontend para proteger datos.

## i18n (`useLanguage()` de `i18n/LanguageContext`)

```jsx
const { t, lang, setLang } = useLanguage()
```

- **Todo** string visible pasa por `t('clave')`. ES es el default; el switch
  ES/EN está en el sidebar.
- Agregá las claves nuevas en **ambos** idiomas en `src/i18n/translations.js`.

## Llamadas al API (`src/api/client.js`)

- Instancia `axios` con `baseURL = import.meta.env.VITE_API_URL || '/api'` y un
  interceptor que inyecta el JWT de Supabase (`supabase.auth.getSession()`) en
  cada request.
- **No** llames `axios`/`fetch` directo desde una página: agregá una función
  exportada acá (`export const getX = (p) => api.get('/x', { params: p }).then(r => r.data)`)
  y reutilizala.
- Uploads: `FormData` con header `multipart/form-data`.

### Descargas de buckets privados (patrón obligatorio)

Los buckets son privados. Descargá con blob + JWT, nunca con `<a href>` a una
URL pública:

```js
export const downloadNominationBlob = async (id, filename) => {
  const resp = await api.get(`/nominations/${id}/download?filename=...`, { responseType: 'blob' })
  return resp.data  // el caller crea un object URL para disparar el guardado
}
```

Ejemplos existentes: `downloadNominationBlob`, `downloadPaymentAttachment`,
`downloadTrainingPdf`.

Las fotos (personnel, Muro, avatares) van al bucket **público** `inventory` y
sí se muestran por URL directa. Solo imágenes; un documento nunca va ahí.

## Estilos — Tailwind + design system

- **Antes de tocar colores/clases, leé `DESIGN_SYSTEM.md`.** Los aliases
  `fiba-*` son dark-aware mediante CSS variables (no es Tailwind nativo).
- Tokens de marca: `navy` (`#0c2340`), `basketball` (`#F57C2A`), `ink`
  (neutrales), `danger`. Escalas 50–950. Definidos en `tailwind.config.js`.
- **Dark mode:** clase `.dark` en `<html>`, persistida en
  `localStorage.fiba_dark`, **default dark**. Estilá siempre con variantes
  `dark:` (ej: `bg-white dark:bg-navy-900 text-ink-800 dark:text-ink-100`).
- Fuentes: IBM Plex Sans + IBM Plex Mono.

## Primitivos de UI e iconos

- Importá de `src/components/ui/` (hay un `index.js` barrel): `Button`,
  `IconButton`, `Card`, `Input`, `Table`, `Modal`, `Badge`, `Toast`, `Stat`,
  `MultiSelect`, `Avatar`, `Empty`, `Tooltip`. Reutilizalos antes de inventar
  markup.
- `Modal` renderiza en un portal sobre `document.body`: un modal abierto desde
  el sidebar (como Mi perfil) no puede quedar atrapado en su `overflow`.
  - `Button` tiene `variant` (`primary|secondary|ghost|navy|danger|link`) y
    `size` (`xs|sm|md|lg`), más props `icon`/`iconRight`.
- Iconos: `import { Icon } from '../lib/icons'` → `<Icon.Trophy className="w-4 h-4" />`
  (Tabler-style).

## Patrón de componente

- Componentes de función con hooks (`useState`, `useEffect`, `useMemo`,
  `useRef`). La página exporta `default`.
- Persistencia de "última búsqueda" (competición/tab/filtros) vía
  `lib/lastSearch.js` (`readLastSearch`/`writeLastSearch`) — ver `Training.jsx`,
  `Games.jsx`.
- Vendor chunking configurado en `vite.config.js` (`react-vendor`, `supabase`,
  `qrcode-scan`, `http`).

## Verificación

No hay tests automatizados. Después de un cambio corré `npm run build` para
confirmar que compila, y revisá el diff.
