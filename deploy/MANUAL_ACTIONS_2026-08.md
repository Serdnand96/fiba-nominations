# Acciones manuales en producción — auditoría 2026-08

Estos ítems **no se pueden aplicar desde el repo/deploy**: son cambios en el
droplet, la base de Supabase o el dashboard, y varios necesitan tu password.
Ordenados por prioridad. Los fixes de código correspondientes ya están en la
branch `fix/audit-2026-08`.

---

## 🔴 CRÍTICO — hacer primero

### 1. Cerrar el `.env` y rotar el service_role key
El `.env` está en modo **644 (world-readable)** con el `SUPABASE_SERVICE_ROLE_KEY`
(acceso total a la base, bypassa RLS). Lo puede leer cualquier proceso del box,
incluido el worker nginx.

```bash
ssh fiba   # entra como root
chown fiba:fiba /opt/fiba-nominations/.env
chmod 600 /opt/fiba-nominations/.env
```
Después **rotar el service_role key** en el dashboard de Supabase
(Settings → API → Reset), y actualizar el `.env` del droplet con el nuevo valor.
Estuvo expuesto ~3 semanas en un box compartido.

### 2. Acotar el sudo de la deploy key
La deploy key de GitHub Actions es, de hecho, **root sin password** sobre un box
con 4 apps (`/etc/sudoers.d/fiba` = `NOPASSWD:ALL`). El deploy solo necesita
reiniciar el servicio.

```
# /etc/sudoers.d/fiba  (editar con `sudo visudo -f /etc/sudoers.d/fiba`)
fiba ALL=(ALL) NOPASSWD: /bin/systemctl restart fiba-api, /bin/systemctl is-active fiba-api
```

### 3. Aislar el trading-bot Docker de la interfaz pública
`trading-bot-dashboard` escucha en `0.0.0.0:8080` y, como Docker escribe iptables
directo, **saltea ufw**. Publicalo solo en localhost (o detrás de auth):
en el `docker run`/compose, mapear `127.0.0.1:8080:8080` en vez de `8080:8080`.
Idealmente, mover FIBA a su propio droplet.

---

## 🟠 ALTO

### 4. Aplicar el nginx corregido
`deploy/nginx/security.conf.example` (actualizado) ahora incluye:
- headers de seguridad re-emitidos en `location /assets/` (hoy los chunks se
  sirven sin CSP/X-Frame-Options),
- `location = /index.html` con `Cache-Control: no-cache`,
- las zonas de rate limit.

```bash
# reconciliar /etc/nginx/sites-available/fiba-nominations contra el ejemplo, luego:
sudo nginx -t && sudo systemctl reload nginx
```
Verificar: `curl -I https://www.fibaapp.com/assets/<algún>.js` debe traer CSP.

### 5. Hardening de systemd
Ver `deploy/systemd/fiba-api.service.example`. Agregar `NoNewPrivileges`,
`PrivateTmp`, `ProtectSystem=full`, etc. al `[Service]`.
```bash
sudo systemctl daemon-reload && sudo systemctl restart fiba-api
sudo systemctl is-active fiba-api
```

### 6. Reiniciar el sistema (updates pendientes)
`*** System restart required ***` + 25 updates (16 de seguridad ESM) sin aplicar.
Planificar una ventana: `sudo apt update && sudo apt upgrade && sudo reboot`.

---

## 🟡 MEDIO

### 7. Aplicar la migración `032_audit_hardening.sql`
Constraints verificados contra los datos de prod (nada los viola hoy):
`total` con COALESCE, `UNIQUE(competition_id, personnel_id)` en nominations,
índice parcial de staff_evaluations, CHECKs de fee_type/month/score/pax.
Es cambio de schema en prod — aplicalo a mano (SQL editor de Supabase o psql),
**en staging primero** si tenés. La sección `ON DELETE RESTRICT` está comentada:
es decisión de producto (ver el archivo).

### 8. Toggles en el dashboard de Supabase
- **Leaked Password Protection**: Auth → Password security → activar (chequeo
  contra HaveIBeenPwned). Relacionado con el pendiente N8.
- **Revocar EXECUTE** de las funciones SECURITY DEFINER expuestas a `anon`:
  ```sql
  revoke execute on function public.block_nomination_delete_with_payment() from anon, authenticated;
  revoke execute on function public.is_superadmin() from authenticated;
  ```

### 9. Scanner de seguridad: marca de agua + logrotate
`scripts/fiba-security-scan.sh` reemite el mismo alerta cada hora (el log tiene
498k líneas duplicadas, 34 MB, sin rotar). Agregar un offset procesado y
`/etc/logrotate.d/fiba-security-alerts`.

### 10. Borrar las tablas de backup viejas
`_backup_competitions_3x3_20260723` y `_backup_competitions_sync_20260723`
(del 23-jul) siguen en `public`. Confirmar que no se necesitan y `DROP TABLE`.

---

## 🔵 BAJO
- `nginx.conf`: `ssl_protocols TLSv1.2 TLSv1.3;` (hoy incluye TLSv1/1.1 a nivel
  http, anulado por certbot en los vhosts de FIBA pero es un footgun para vecinos).
- Bajar `api_limit` de 30r/s a ~10r/s; borrar la zona `login_limit` huérfana.
- Limpiar los `.bak` de `/etc/nginx/sites-available/`.
- Índices de FK sugeridos por el linter de Supabase (deuda, no urgente — todas
  las tablas están por debajo de 1000 filas hoy).
