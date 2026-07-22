# FIBA Americas Administration System

Sistema admin de FIBA Americas para gestión de nominaciones de oficiales
(TDs / VGOs), training, transport, inventario, calendario y staff.

**Producción:** https://www.fibaapp.com (redirect 301 desde el legacy
`fibaamericascloud.com`).

---

## 📚 Documentación

| Doc                         | Para qué                                                       |
|-----------------------------|----------------------------------------------------------------|
| [`CLAUDE.md`](CLAUDE.md)               | **Onboarding para sesiones AI.** Léelo si arrancás de cero. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)   | Cómo encajan frontend / backend / DB / storage / deploy.      |
| [`DEPLOYMENT.md`](DEPLOYMENT.md)       | Pipeline GitHub Actions → DigitalOcean droplet.               |
| [`DEVELOPMENT.md`](DEVELOPMENT.md)     | Correr el stack local.                                        |
| [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md) | Tokens, componentes UI, modo oscuro, migración pendiente.     |
| [`SECURITY_RUNBOOK.md`](SECURITY_RUNBOOK.md) | Acciones manuales pendientes del último pen-test.         |

---

## Stack

- **Frontend:** React 18 + Vite + Tailwind 3 + IBM Plex
- **Backend:** FastAPI (Python 3.11) + gunicorn + uvicorn workers
- **DB / Auth / Storage:** Supabase (PostgreSQL + RLS, Auth, Storage)
- **PDF generation:** python-docx → LibreOffice headless local
- **Hosting:** DigitalOcean droplet ($16 plan, 2GB / 1vCPU)
- **CI/CD:** GitHub Actions → SSH deploy
- **TLS:** Let's Encrypt (4 dominios)

---

## Estructura

```
fiba-nominations/
├── api/                      # FastAPI backend
│   ├── index.py              # entry + middleware + mount routers
│   └── _lib/
│       ├── auth.py           # require_view, require_edit
│       ├── database.py       # supabase client httpx-based
│       ├── routers/          # uno por módulo
│       └── services/
│           └── document_generator.py
│
├── src/                      # React frontend
│   ├── App.jsx               # shell + router
│   ├── pages/                # uno por ruta
│   ├── components/
│   │   ├── ui/               # Button, Input, Table, …
│   │   ├── layout/           # Sidebar, Topbar, AppShell
│   │   └── brand/            # Logos
│   ├── lib/icons.jsx         # Tabler icons
│   ├── contexts/             # Auth, Language
│   └── i18n/                 # ES + EN
│
├── public/                   # estáticos (favicon, logos)
├── scripts/
│   └── fiba-security-scan.sh # scanner horario de logs (corre en droplet)
├── supabase/migrations/      # schema SQL
├── templates/                # .docx templates
├── verify_security.sh        # smoke test post-deploy
├── .github/workflows/        # CI/CD
├── tailwind.config.js
├── vite.config.js
├── package.json
└── requirements.txt
```

---

## Quickstart

### Producción

```bash
# Deploy automático: push a main
git push origin main

# Smoke test
bash verify_security.sh
```

### Local

```bash
# 1) Frontend
npm install
npm run dev                  # vite:5173

# 2) Backend FastAPI (otra terminal)
pip install -r requirements.txt
python -m uvicorn api.index:app --reload --port 8000
```

Ver [`DEVELOPMENT.md`](DEVELOPMENT.md) para detalles de env vars y setup
inicial.

---

## Módulos del sistema

| Módulo         | Ruta            | Tabla principal       |
|----------------|-----------------|-----------------------|
| Calendar       | `/calendar`     | `competitions`        |
| Nominations    | `/nominations`  | `nominations`         |
| Personnel      | `/personnel`    | `personnel` (TDs/VGOs)|
| Competitions   | `/competitions` | `competitions`        |
| Templates      | `/templates`    | filesystem            |
| Users          | `/users`        | `auth.users` + `user_permissions` |
| Availability   | `/availability` | `availability`        |
| Transport      | `/transport`    | `vehicles`, `trips`   |
| Training       | `/training`     | `training_*`          |
| Games          | `/games`        | `games`               |
| Inventory      | `/inventory`    | `assets`              |
| Loans          | `/loans`        | `loans`               |
| Scan           | `/scan`         | (QR landing)          |
| Employees      | `/employees`    | `employees` (staff interno) |

---

## Adding a New Competition Template

1. Coloca el `.docx` template en `templates/`
2. Agregá la `template_key` al CHECK constraint en `competitions.template_key`
3. Agregá el spec en `api/_lib/services/document_generator.py` →
   `TEMPLATE_SPECS` (archivo `_TPL.docx` + contexto/builder)
4. Registralo en `api/_lib/routers/templates.py` → `TEMPLATES` para que
   aparezca en la UI de Templates
5. Actualizá `src/pages/Nominations.jsx` para lógica template-specific

---

## Bulk Import (Personnel)

`.csv`, `.xlsx`, `.xls` con columnas:

| Column            | Required | Valid Values                     |
|-------------------|----------|----------------------------------|
| Nombre / Name     | Yes      | Free text                        |
| Email             | Yes      | Valid email                      |
| País / Country    | No       | Free text                        |
| Teléfono / Phone  | No       | Free text                        |
| Pasaporte / Passport | No    | Free text                        |
| Rol / Role        | Yes      | `VGO` / `TD`                     |

---

## Estado actual (mayo 2026)

- ✅ Migración a DigitalOcean droplet completada
- ✅ Reemplazado CloudConvert por LibreOffice local
- ✅ Pen-test 3 rondas — H1-H9 + N1, N2, N3 cerrados
- ✅ Design system completo (navy + basketball orange + IBM Plex)
- ✅ Scanner horario de alertas en `/var/log/fiba-security-alerts.log`
- ⏳ Manuales pendientes: ver [`SECURITY_RUNBOOK.md`](SECURITY_RUNBOOK.md)
