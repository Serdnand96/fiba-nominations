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
│   ├── budget/         ← pestañas de Budget (*Tab.jsx), editors/, scope.jsx, shared.jsx
│   └── payments/       ← QueueTab, EventTab, PaymentDrawer, BulkStatusModal, shared.js
├── components/
│   ├── ui/             ← primitivos del DS (Button, Card, Input, Table, Modal, Tabs, Drawer…)
│   ├── charts/         ← BudgetCharts (recharts) — solo con React.lazy
│   ├── brand/          ← Logo (Monogram, Wordmark)
│   └── *.jsx           ← compartidos: AttachmentList, StatusHistory, BankingPanel,
│                          NotificationsBell, PersonProfilePanel, …
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

La segunda mitad es **`saveBlob(blob, filename)`** (exportado de
`api/client.js`): object URL + `<a download>` efímero + `revokeObjectURL`. No
la reimplementes en cada página. Los exports a Excel (`downloadPaymentsXlsx`,
`downloadBudgetLinesXlsx`, los de gastos y resumen de budget) ya la llaman.

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
  `MultiSelect`, `Avatar`, `Empty`, `Tooltip`, `Tabs` (+ `useTabParam`),
  `Drawer` (+ `useOpenParam`). Reutilizalos antes de inventar markup.
  - `Button` tiene `variant` (`primary|secondary|ghost|navy|danger|link`) y
    `size` (`xs|sm|md|lg`), más props `icon`/`iconRight`.
- Iconos: `import { Icon } from '../lib/icons'` → `<Icon.Trophy className="w-4 h-4" />`
  (Tabler-style).

## Páginas con pestañas y detalle por URL

Budget y Pagos son **shells** (`pages/Budget.jsx`, `pages/Payments.jsx`) que
cargan lo compartido y dibujan la pestaña activa; cada pestaña es un archivo en
`pages/budget/` o `pages/payments/`. La pestaña y el registro abierto viven en
la URL, para que un link (por ejemplo, de la campana) caiga directo en el
detalle:

```jsx
import { Tabs, useTabParam, Drawer, useOpenParam } from '../components/ui'

const [tab, setTab] = useTabParam(['queue', 'event'], 'queue')   // ?tab=
<Tabs value={tab} onChange={setTab}
  items={[{ key: 'queue', label: t('payments.tabQueue') }, …]} />

const [openId, setOpenId] = useOpenParam()                        // ?open=<id>
{openId && <Drawer title={…} onClose={() => setOpenId(null)}>…</Drawer>}
```

- `useTabParam(keys, fallback)`: un valor desconocido cae en `fallback`;
  cambiar de pestaña **borra `?open=`** y reemplaza la entrada del historial.
- `useOpenParam()`: `setOpenId(null)` lo saca de la URL; abrir/cerrar no apila
  historial. `Drawer` se monta con portal en `<body>` (como `Modal`).
- Los filtros que un link tiene que poder fijar también van en la URL (la cola
  de pagos: `?status=&year=&budget=&missing_docs=1&stale=1&q=&page=`).
- Links de la campana: `/budget?tab=expenses&open=<id>`,
  `/payments?tab=queue&open=<id>`, `/budget?tab=recurring`.

## Piezas compartidas de finanzas

- **`AttachmentList`** (`components/AttachmentList.jsx`): lista, subida con
  etiqueta, descarga y borrado de adjuntos de un pago o un gasto. No sabe de
  buckets: el caller pasa `onUpload(file, kind)` / `onDownload` / `onDelete`
  (la descarga va por blob + `saveBlob`). `kinds` array = etiquetas cerradas
  (las de la migración 047 en pagos), si no, texto libre. `canEdit` esconde
  subir/borrar.
- **`StatusHistory`** (`components/StatusHistory.jsx`): timeline de
  `finance_status_history`. Recibe `items` tal cual los devuelve
  `GET …/history`; no pide nada solo (el caller decide cuándo refrescar). No usa
  `StatusPill` (su mapa no cubre estos estados): `Badge` con tono por estado.
- **`BankingPanel`** / `BankingSummary` / `TaxFormBadge`
  (`components/BankingPanel.jsx`): ficha bancaria enmascarada, "Mostrar" →
  `POST …/reveal`, edición solo con `hasEdit('payments')`, upload del W-8. Se
  monta **solo con `hasView('payments')`** (en `PersonProfilePanel` y el drawer
  de pagos).
- **`NotificationsBell`** (`components/NotificationsBell.jsx`, en el topbar de
  `App.jsx`): novedades + pendientes, poll cada 60 s y al volver a la pestaña
  (`visibilitychange`). Sin websockets.
- **Transiciones de estado:** el estado de un gasto o un pago **nunca** es un
  campo del formulario. Los botones salen de una tabla en el front
  (`validTransitions` en `pages/payments/shared.js`, `expenseActions` en
  `pages/budget/ExpenseActionModals.jsx`), pero es solo UX: el backend vuelve a
  validar y su `detail` (400/403/409) se muestra tal cual.

### `BudgetScopeContext` (`pages/budget/scope.jsx`)

`<BudgetScopeProvider>` envuelve Budget y carga `GET /budget/access/me/scope`.
`useBudgetScope()` devuelve:

```js
{ ready, isSuperadmin, view, edit, approve,   // null = todos, [] = ninguno
  isGeneralAdmin,                              // superadmin o edit === null
  canEditDept(code), canApproveDept(code) }
```

Los botones de Budget se deciden **por fila** con eso (más `hasEdit('budget')`
para editar; aprobar no exige `budget:edit`). La pestaña Cuentas y los datos
bancarios de proveedores solo con `isGeneralAdmin`. Si el endpoint falla, cae
cerrado (sin departamentos). Es UX: el recorte real es `_scoped()` en el
backend.

### Gráficos: chunk `charts`

`recharts` vive en su propio chunk (`manualChunks.charts` en `vite.config.js`)
y **solo** se importa desde `components/charts/`. Se carga siempre con
`React.lazy` + `Suspense`:

```jsx
const BudgetCharts = lazy(() => import('../../components/charts'))
<Suspense fallback={<ChartsFallback t={t} />}><BudgetCharts summary={summary} t={t} /></Suspense>
```

Un `import` estático metería recharts en la página que lo use. Los colores no
salen de clases (recharts pinta atributos SVG): grilla y texto leen las CSS
variables `--c-fiba-*` y las series usan los hex de los tokens de
`tailwind.config.js`; un `MutationObserver` sobre la clase de `<html>` repinta al
cambiar de tema.

## Patrón de componente

- Componentes de función con hooks (`useState`, `useEffect`, `useMemo`,
  `useRef`). La página exporta `default`.
- Persistencia de "última búsqueda" (competición/tab/filtros) vía
  `lib/lastSearch.js` (`readLastSearch`/`writeLastSearch`) — ver `Training.jsx`,
  `Games.jsx`.
- Vendor chunking configurado en `vite.config.js` (`react-vendor`, `supabase`,
  `qrcode-scan`, `http`, `charts`).

## Verificación

No hay tests automatizados de frontend (los de `tests/` son de backend). Después
de un cambio corré `npm run build` para confirmar que compila —y que `charts-*.js`
sigue saliendo como chunk aparte—, y revisá el diff.
