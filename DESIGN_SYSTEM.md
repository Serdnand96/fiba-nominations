# FIBA Americas — Design System

Documentación de los tokens, componentes y convenciones del rediseño
adoptado en mayo 2026 (commits `45800f5`, `b4eca5e`, `79904af`).

---

## 🎨 Marca

| Color           | Hex        | Token Tailwind        | Uso                                  |
|-----------------|------------|-----------------------|--------------------------------------|
| FIBA Navy       | `#0c2340`  | `navy-900`            | Sidebar, headers institucionales     |
| Basketball      | `#F57C2A`  | `basketball-500`      | CTAs primarios, active states        |
| Ink (warm slate)| `#0f1320…` | `ink-50…900`          | Texto, bordes, fondos neutros        |

Reglas de `basketball`:

- ✅ Botón primario (1 por vista), evento "live", indicador activo, eyebrows
- ❌ Múltiples botones naranja en la misma vista
- ❌ Backgrounds extensos ni gradientes
- ❌ Para indicar estado (eso lo cubre `success`/`warning`/`danger`)

**Fuentes:** IBM Plex Sans (UI) + IBM Plex Mono (IDs, datos tabulares, código).

---

## 🧱 Tokens completos

Definidos en `tailwind.config.js`:

| Familia         | Shades                          |
|-----------------|---------------------------------|
| `navy-*`        | 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950 |
| `basketball-*`  | 50, 100, 200, 300, 400, 500, 600, 700, 800, 900 |
| `ink-*`         | 50, 100, 200, 300, 400, 500, 600, 700, 800, 900 |
| `success/warning/danger/info` | 50, 100, 500, 600, 700 |

**Shadows:** `shadow-card`, `shadow-card-lg`, `shadow-pop`,
`shadow-focus`, `shadow-focus-accent`.

**Radios:** `rounded-{xs,sm,md,lg,xl,2xl}` (3, 4, 6, 8, 12, 16px).

**Tipografía escala:**

| Tag      | Tamaño / line-height | Peso |
|----------|----------------------|------|
| Display  | 36 / 40              | 600  |
| H1       | 30 / 36              | 600  |
| H2       | 24 / 30              | 600  |
| H3       | 20 / 26              | 600  |
| H4       | 17 / 24              | 600  |
| Body     | 14 / 20              | 400  |
| Small    | 13 / 18              | 400  |
| Caption  | 12 / 16              | 500  |
| Overline | 11 / 14 · upper      | 600  |

---

## 🌙 Modo oscuro

Activado por la clase `.dark` en `<html>`. Se persiste en
`localStorage.fiba_dark` (`"1"` = dark, `"0"` = light).

**Default actual: dark mode.** Esto es transitorio: muchas páginas
todavía no son 100% light-mode friendly (ver "Migración pendiente"
abajo). Cuando todas las páginas estén migradas, cambiar la línea
en `src/App.jsx`:

```diff
- return stored === null ? true : stored === '1'
+ return stored === null ? false : stored === '1'
```

Toggle en el topbar (icono ☀/🌙). Mobile theme-color en `index.html`
está hardcodeado a navy-900.

---

## 🪄 Aliases legacy (`fiba-*`) — dark-aware vía CSS vars

Para no migrar las ~600 ocurrencias inline de `bg-fiba-card` /
`text-fiba-muted` / etc. de un saque, los tokens `fiba-*` están
mapeados a **CSS custom properties** que cambian con `.dark`:

```js
// tailwind.config.js
fiba: {
  card:   'rgb(var(--c-fiba-card) / <alpha-value>)',
  muted:  'rgb(var(--c-fiba-muted) / <alpha-value>)',
  border: 'rgb(var(--c-fiba-border) / <alpha-value>)',
  // …
}
```

```css
/* src/index.css */
:root {
  --c-fiba-card:   255 255 255;   /* white */
  --c-fiba-muted:  107 115 133;   /* ink-500 */
  --c-fiba-border: 228 232 238;   /* ink-200 */
}
.dark {
  --c-fiba-card:   20  44  78;    /* navy-800 */
  --c-fiba-muted:  154 163 178;   /* ink-400 */
  --c-fiba-border: 26  54  104;   /* navy-700 */
}
```

**Esto significa que `bg-fiba-card` SE COMPORTA distinto según el
modo**, sin tocar el JSX. Si migras una página, podés:

- Dejar los tokens `fiba-*` (siguen funcionando)
- O reemplazar por los explícitos: `bg-white dark:bg-navy-900`,
  `text-ink-500 dark:text-ink-400`, etc.

Los aliases viven en el componente `@layer components` de
`src/index.css` (`.btn-fiba`, `.fiba-card`, `.fiba-input`, etc).

---

## 🧩 Componentes

Bajo `src/components/`:

### `ui/` — primitivos

| Componente         | Export                              | Notas                                          |
|--------------------|-------------------------------------|------------------------------------------------|
| `Button`           | `Button`, `IconButton`              | variants: `primary` (basketball), `navy`, `secondary`, `ghost`, `danger`, `link`. Sizes: `xs/sm/md/lg` |
| `Input`            | `Input`, `Select`                   | con `label`, `icon`, `error`                  |
| `Card`             | `Card`, `SectionHeader`             | shadow-card por default                       |
| `Badge`            | `Badge`, `StatusPill`               | tone: `navy/basketball/success/warning/danger/info` |
| `Avatar`           | `Avatar`, `NameCell`                | iniciales o imagen + nombre + flag           |
| `Table`            | `Table`                             | columns/rows, `selectable`, `dense`           |
| `MultiSelect`      | `MultiSelect`                       | filtros Linear-style                          |
| `Modal`            | `Modal`                             | overlay con backdrop blur                     |
| `Toast`            | `ToastProvider`, `useToast`         | wrapper alrededor de `<App/>`                 |
| `Stat`             | `Stat`                              | tarjeta de KPI                                |
| `Empty`            | `Empty`, `Kbd`                      | estados vacíos + tecla helper                 |

Barrel: `import { Button, Badge } from '@/components/ui'`.

### `layout/`

- `Sidebar` — navy-900 con accent basketball-500 en el item activo
- `Topbar` — título + dark toggle + iconos auxiliares
- `AppShell` — wrapper completo (no se usa en este proyecto;
  `App.jsx` tiene su propia versión integrada al router)

### `brand/` (`src/components/brand/Logo.jsx`)

| Logo                  | Tamaño mínimo | Uso                                |
|-----------------------|---------------|------------------------------------|
| `LogoMonogram`        | 24px          | App icon, favicon, slot pequeño    |
| `LogoRoundel`         | 32px          | Splash, social, sello formal       |
| `LogoWordmark`        | 28px alto     | Lockup principal horizontal        |
| `LogoShield`          | —             | Documentos institucionales (.docx) |
| `LogoWordmarkCompact` | —             | Una línea, sin submark             |
| `LogoSidebar`         | —             | Lockup compacto del sidebar        |

Clear space mínimo = altura de la "F" alrededor del logo.

### `lib/icons.jsx`

Subset de **Tabler Icons** inline (sin dependencia npm). Uso:

```jsx
import { Icon } from '@/lib/icons'

<Icon.Trophy className="w-5 h-5" />
```

Iconos disponibles: Dashboard, Trophy, Users, Calendar, Whistle, Truck,
Shield, Palette, Plus, Search, Filter, Download, Upload, Doc, Edit,
Trash, More, Check, X, Chevron, ChevronDown, ArrowUp/Down/Right, Alert,
Info, Bell, Clock, Globe, Mail, Pin, Moon, Sun, Cog, Logout, Eye, Lock.

Si necesitás otro: agregalo a `lib/icons.jsx` con la sintaxis
`I(<><path d="…"/></>)` o instalá `@tabler/icons-react`.

---

## 🗺️ Mapa módulo → icono (sidebar)

Definido en `src/App.jsx` (`moduleIcon`):

```
calendar     → Icon.Calendar       transport    → Icon.Truck
nominations  → Icon.Trophy         training     → Icon.Whistle
personnel    → Icon.Users          games        → Icon.Globe
competitions → Icon.Trophy         assets       → Icon.Dashboard
templates    → Icon.Doc            loans        → Icon.Upload
users        → Icon.Shield         scan         → Icon.Pin
availability → Icon.Clock          employees    → Icon.Users
```

---

## 🚧 Migración pendiente

El sweep automático (`text-white` → `text-ink-900 dark:text-white`,
etc.) cubrió 146 ocurrencias en `src/pages/*.jsx`. Lo que queda:

1. **Revisión visual por página** en light mode. El sweep agarra el
   patrón global pero puede romper contraste en sub-cases (texto blanco
   sobre fondo naranja, por ejemplo, donde el blanco DEBE quedar
   blanco — ver `Login.jsx` para el patrón corregido a mano).

2. **Migrar a componentes del DS.** Reemplazar `<button class="btn-fiba">`
   por `<Button variant="primary">`, `<input class="fiba-input">` por
   `<Input>`, etc. Esto da consistencia y elimina dependencia de los
   aliases legacy.

3. **Cuando todas las páginas estén migradas:** flipear el default a
   light mode (ver "Modo oscuro" arriba).

### Orden sugerido (por cantidad de markup dark-only)

```
1. Training.jsx       (61 ocurrencias)
2. Calendar.jsx       (53)
3. Transport.jsx      (49)
4. Personnel.jsx      (46)
5. Nominations.jsx    (34)
6. Games.jsx          (34)
7. AssetDetail.jsx    (26)
8. Availability.jsx   (23)
9. Users.jsx          (20)
10. resto (≤14 c/u)
```

---

## 📦 Archivos clave

```
tailwind.config.js               ← tokens (navy/basketball/ink + fiba-* legacy)
src/index.css                    ← globals + :root/.dark CSS vars + aliases legacy
src/App.jsx                      ← shell (sidebar navy + topbar + dark toggle)
src/pages/Login.jsx              ← entry rediseñado
src/lib/icons.jsx                ← Tabler icons
src/components/ui/               ← primitivos (Button, Input, Table, …)
src/components/layout/           ← Sidebar, Topbar, AppShell
src/components/brand/Logo.jsx    ← LogoMonogram, Roundel, Wordmark, Shield, …
public/favicon.svg               ← monograma F + basketball seam
index.html                       ← favicon link + theme-color navy
```

---

## 📚 Referencias

- README original del export: contiene la spec completa de la marca
- Commits del rediseño:
  - `45800f5` — adopción inicial del design system
  - `b4eca5e` — soporte de light mode (CSS vars + sweep dark:)
  - `79904af` — monograma en sidebar + favicon
