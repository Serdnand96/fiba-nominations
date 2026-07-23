---
name: security-checklist
description: Checklist de seguridad de fiba-nominations — autorización a nivel de app (el service_role bypassa RLS), permisos por usuario con require_view/require_edit/require_superadmin, guards de frontend que son solo UX, storage privado, y el estado real del módulo Transport (permisado, sin auth standalone). Usar al revisar cambios que tocan auth, permisos, datos o storage.
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

## 5. Módulo Transport — corrección importante

- Transport es un **módulo normal permisado**: sus endpoints usan
  `require_view("transport")` / `require_edit("transport")`
  (`api/_lib/routers/transport.py`), sus tablas son `transport_*`, y en el
  frontend comparte el **mismo `AuthContext` y el mismo cliente de Supabase**
  (`src/lib/supabase.js`) que todo el resto.
- **No existe** una "Supabase Auth standalone" ni un aislamiento especial para
  Transport en el código actual. Revisalo con **el mismo** checklist de permisos
  que cualquier otro módulo; lo que hay que verificar es que cada endpoint de
  transport lleve su dependency de permiso, no un supuesto sandbox separado.

## 6. Storage privado

- Buckets `nominations` y `payments` son **privados**. Reglas:
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

## 10. Regla de dominio — neutralidad de árbitros

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
