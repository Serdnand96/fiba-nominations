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
├── components/
│   ├── ui/             ← primitivos del DS (Button, Card, Input, Table, Modal…)
│   ├── layout/         ← Sidebar, Topbar, AppShell
│   └── brand/          ← Logo (Monogram, Wordmark)
├── contexts/AuthContext.jsx
├── i18n/               ← LanguageContext.jsx + translations.js (ES/EN)
├── lib/                ← icons.jsx, supabase.js, utils, countries, roles, lastSearch
└── api/client.js       ← todas las llamadas HTTP al backend
```

## Routing, lazy-load y permission guards (`App.jsx`)

- **Toda página autenticada se lazy-loadea:**
  `const Training = lazy(() => import('./pages/Training'))`. Vite genera un
  chunk por página. Solo `Login` y las vistas públicas se cargan distinto.
- Cada ruta va envuelta en `<PermissionGuard module="X">…</PermissionGuard>`,
  que muestra un 403 si no hay `can_view`. Las rutas superadmin-only usan
  `<SuperadminGuard>` (p.ej. `/activity`).
- Para una página nueva: (1) `lazy(import)`, (2) `<Route>` con su guard, (3)
  entrada en `allNavItems` (`{ to, label: t('nav.x'), module }`), (4) icono en
  el map `moduleIcon`. El sidebar filtra items por `hasView`/`isSuperadmin`.

## Auth (`useAuth()` de `contexts/AuthContext`)

```jsx
const { user, loading, signIn, signOut, isSuperadmin, hasView, hasEdit } = useAuth()
```

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
  `MultiSelect`, `Avatar`, `Empty`. Reutilizalos antes de inventar markup.
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
