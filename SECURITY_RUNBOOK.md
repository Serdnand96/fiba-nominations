# FIBA App — Manual Security Actions

Acciones de hardening que requieren acceso a paneles externos (DigitalOcean,
Supabase, GoDaddy, Cloudflare). Status interno se trackea en
`fibaapp_security_audit.md`.

---

## ⚡ Quick wins (15 min total)

### 1. Supabase Auth Rate Limits (cierra pen-test N8)

👉 https://supabase.com/dashboard/project/mckaplalscnvaanukrmz/auth/rate-limits

Setear:

| Límite | Valor recomendado |
|---|---|
| Sign up / Sign in | **5 / hour / IP** |
| Token refresh | 30 / hour |
| OTP / Email verifications | 10 / hour |
| Password reset | 3 / hour |

> Sin esto, un atacante puede hacer burst de signups (aunque el filtro de
> dominio los rechace, sigue siendo ruido y posible vector de DoS).

---

### 2. DNS records faltantes en `fibaamericascloud.com` (cierra N5/N6)

👉 GoDaddy → DNS de `fibaamericascloud.com`

Agregá estos 4 records:

| Type | Name | Value | TTL |
|---|---|---|---|
| TXT | @ | `v=spf1 -all` | 3600 |
| TXT | _dmarc | `v=DMARC1; p=reject; adkim=s; aspf=s; rua=mailto:dmarc_rua@onsecureserver.net;` | 3600 |
| CAA | @ | `0 issuewild ";"` | 3600 |
| CAA | @ | `0 iodef "mailto:vargas20057@gmail.com"` | 3600 |

(Si `_dmarc` ya existe, editalo en vez de duplicar.)

`fibaapp.com` ya está configurado.

---

## 🟡 Decisión + 1 hora (cierra N7)

### 3. Activar Cloudflare en ambos dominios

**Beneficios:**
- IP origen del droplet oculta (`64.227.19.67`)
- DDoS protection global automática
- WAF gratis con reglas OWASP
- Rate limiting en `/auth/*` y `/api/*`
- CDN edge caching para assets estáticos

**Pasos:**

1. Crear cuenta en https://dash.cloudflare.com (Free tier)
2. **Add a site:** `fibaapp.com` → plan Free
3. Cloudflare escanea DNS existentes — verificar que detecte:
   - A `@` → `64.227.19.67`
   - A `www` → `64.227.19.67`
   - TXT, CAA recién agregados
4. **Set proxy ON (orange cloud)** en los 2 A records
5. Cloudflare te muestra **2 nameservers** (algo como `ada.ns.cloudflare.com` + `bob.ns.cloudflare.com`)
6. En GoDaddy → Settings → Nameservers → cambiar a custom + pegar los 2 de Cloudflare
7. Esperar propagación (~5-30 min)
8. Verificar:
   ```bash
   curl -sI https://www.fibaapp.com/ | grep cf-ray
   # Debe aparecer: cf-ray: ...
   ```
9. **En Cloudflare Dashboard → SSL/TLS:** poner mode **"Full (strict)"**
10. **Security → WAF:** activar "Bot Fight Mode" + Security Level "Medium"
11. **Security → Rate Limiting:** crear reglas:
    - `/auth/v1/signup` → max 5 / 10 minutos / IP
    - `/api/auth/*` → max 10 / minuto / IP
12. Repetir 2-7 para `fibaamericascloud.com`

**Cuando Cloudflare esté activo**, restringir el firewall del droplet
para que solo IPs de Cloudflare puedan llegar a 80/443:

```bash
# Lista oficial: https://www.cloudflare.com/ips-v4/
ssh fiba
sudo ufw delete allow 80/tcp
sudo ufw delete allow 443/tcp
for ip in $(curl -s https://www.cloudflare.com/ips-v4/); do
  sudo ufw allow from "$ip" to any port 80,443 proto tcp
done
sudo ufw reload
```

> Si te conectás directo al droplet por IP en algún momento (debug),
> agregá tu IP residencial al whitelist primero.

---

## 🟢 Plan upgrade futuro (cierra N4)

### 4. Migrar a Supabase Pro plan ($25/mes) cuando aplique

Permite:
- **Auth Hooks** (`before-user-created`, `before-user-update`, etc) — fix
  HTTP 500 → 400 en filter de dominio (N4).
- **Leaked password protection** automático.
- Daily backups + point-in-time recovery.
- 2x más recursos, soporte priority.

Cuando se migre, reemplazar el trigger DB `enforce_email_domain` por un
Auth Hook que devuelva `{ "error": { "http_code": 400, ... } }`.

---

## 📋 Verificación

Después de aplicar 1, 2 y 3, correr:

```bash
bash verify_security.sh
# Y agregar manualmente:
dig +short TXT fibaamericascloud.com | grep spf
dig +short CAA fibaamericascloud.com
curl -sI https://www.fibaapp.com/ | grep cf-ray
```

Y mandar al pen-tester una **Ronda 4** para confirmar.
