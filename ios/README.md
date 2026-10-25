# FIBA Americas — app de iOS

App nativa en **SwiftUI** (iOS 17+). Es un cliente más del mismo backend que la
web (`https://www.fibaapp.com/api`): mismo login de Supabase, mismos permisos,
mismos endpoints. No hay lógica de negocio duplicada; la autorización sigue
viviendo en el backend.

## Correrla en una Mac

```bash
brew install xcodegen
cd ios
cp Config/Secrets.example.xcconfig Config/Secrets.xcconfig   # completar SUPABASE_ANON_KEY
xcodegen generate
open FIBAAmericas.xcodeproj                                  # ⌘R en un simulador
```

- El `.xcodeproj` **no se commitea**: se genera desde `project.yml`. Si agregás
  archivos, volvé a correr `xcodegen generate`.
- `SUPABASE_ANON_KEY` es la misma que `VITE_SUPABASE_ANON_KEY` del `.env` de la
  web. Es pública por diseño; la app **nunca** lleva la `service_role`.
- Para pegarle a un backend local, descomentá `API_BASE_URL` en
  `Config/Secrets.xcconfig`.
- Para un iPhone físico: en Xcode → Signing, elegí tu equipo de Apple Developer.

## CI

`.github/workflows/ios.yml` genera el proyecto, compila y corre los tests en un
runner `macos-15` en cada push o PR que toque `ios/` (cualquier rama). Es la forma de validar la app sin
Mac.

## Estructura

```
ios/
├── project.yml            ← XcodeGen (targets, Info.plist, paquete Supabase)
├── Config/                ← URLs y anon key por xcconfig
├── FIBAAmericas/
│   ├── App/               ← entrada, login vs app
│   ├── Core/              ← APIClient, APIError, AuthStore, permisos, modelos
│   ├── DesignSystem/      ← colores (navy / basketball / ink, dark-aware), IBM Plex, componentes
│   ├── Localization/      ← ES/EN con las mismas claves que src/i18n/translations.js
│   ├── Features/          ← una carpeta por pantalla o módulo
│   └── Resources/         ← assets (ícono, logo)
└── FIBAAmericasTests/     ← XCTest sin red
```

Las fuentes IBM Plex salen de `../fonts/` (las mismas de las cartas), no se copian.

## Convenciones

- **Auth:** `AuthStore` es el `AuthContext.jsx` de la app. La sesión la guarda
  supabase-swift en el **Keychain**. El `user_id` que se manda al backend va en
  minúsculas (`AuthStore.backendID`): `UUID.uuidString` sale en mayúsculas y el
  backend compara contra el `sub` del JWT.
- **Permisos:** `PermissionSet` sale de `GET /permissions/{user_id}`. Los guards
  de la app son UX; el que decide es el backend. Si se agrega un permiso, sumarlo
  a `AppModule` (hay un test que compara contra `MODULES` del backend).
- **Menú:** `NavItem.all` sigue el orden de `allNavItems` de `src/App.jsx`.
- **Modelos:** `CodingKeys` explícitos en snake_case. No usar
  `convertFromSnakeCase`: también reescribe claves de diccionarios.
- **Errores:** `APIError` interpreta el `detail` de FastAPI (string, lista de
  Pydantic o dict; `missingFields` para el 422 de las cartas).
- **Archivos privados:** `APIClient.download` baja con JWT a un temporal (para
  QuickLook / share sheet). Nunca construir URLs públicas del bucket
  `nominations`. Los endpoints que son POST para quedar en el activity log
  (`/banking/reveal`, descarga del W-8) siguen siendo POST.
- **Textos:** `L10n.t("clave", lang)` con `@Environment(\.language)`. Claves
  iguales a las de la web para portarlas módulo a módulo.

## Estado y plan

**Fase 0 (hecha):** login, sesión persistida, permisos, menú por permisos,
perfil (foto, idioma, apariencia), cerrar sesión. Las descargas se borran al
cerrar sesión. Los módulos todavía no
portados muestran "Próximamente en la app" con un link a la misma pantalla en la web.

Siguientes fases (un PR por módulo o grupo chico):

1. Muro, notificaciones, Calendario, Games (hora local vs `datetime_utc`), checklists de sede.
2. Personnel, Competencias, Nominaciones (prefill, preview, PDF), Training, Availability.
3. Logística, Empleados + staffing, Inventario/Préstamos con escaneo QR (VisionKit), Evaluaciones.
4. Pagos, Presupuesto, Reportes, Templates, Usuarios, Actividad.
5. Nativo con cambios de backend: push (APNs), Face ID, Google Calendar con `ASWebAuthenticationSession`.
