# FIBA Americas Administration System

Sistema admin de FIBA Americas para gestión de nominaciones de oficiales
(TDs / VGOs), training, logística, inventario, calendario, staff, pagos,
presupuesto y el muro interno del equipo.

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
| [`deploy/MANUAL_ACTIONS_2026-08.md`](deploy/MANUAL_ACTIONS_2026-08.md) | Acciones manuales en el droplet de la auditoría de agosto 2026. |
| [`BUDGET_MODULE.md`](BUDGET_MODULE.md) | Contrato del módulo Budget: schema, endpoints, scoping por departamento. |
| [`PAYMENTS_MODULE.md`](PAYMENTS_MODULE.md) | Análisis del legacy vbills (histórico — la implementación final difiere). |
| [`LSB_LETTER_SPEC.md`](LSB_LETTER_SPEC.md) | La carta de LSB: texto, membrete y por qué difiere de `confirmation`. |
| [`MANUAL_USUARIO.md`](MANUAL_USUARIO.md) | Manual para los usuarios finales (no técnico). |

---

## Stack

- **Frontend:** React 18 + Vite + Tailwind 3 + IBM Plex
- **Backend:** FastAPI (Python 3.11) + gunicorn + uvicorn workers
- **DB / Auth / Storage:** Supabase (PostgreSQL + RLS, Auth, Storage)
- **PDF generation:** docxtpl → LibreOffice headless local (cartas);
  el export de training schedule usa python-docx + CloudConvert
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
│       ├── auth.py           # require_view, require_edit, require_user
│       ├── database.py       # supabase client httpx-based
│       ├── crew.py           # crew del torneo (fee_type = tournament)
│       ├── budget_accounts.py# rol → cuenta de fees / travel
│       ├── routers/          # uno por módulo
│       └── services/         # document_generator, imports de Excel, activity_log
│
├── src/                      # React frontend
│   ├── App.jsx               # shell + router
│   ├── pages/                # uno por ruta
│   ├── components/
│   │   ├── ui/               # Button, Input, Table, …
│   │   ├── brand/            # Logos
│   │   └── ProfileModal.jsx  # "Mi perfil" (foto / avatar)
│   ├── lib/                  # icons, competitions, warRoom, avatars, …
│   ├── contexts/             # Auth, Language
│   └── i18n/                 # ES + EN
│
├── public/                   # estáticos (favicon, logos)
├── scripts/
│   ├── build_letter_templates.py   # regenera los *_TPL.docx de las cartas
│   ├── fiba-security-scan.sh       # scanner horario de logs (corre en droplet)
│   └── fiba-supabase-keepalive.sh  # ping diario a Supabase (anti auto-pause)
├── supabase/migrations/      # schema SQL (se aplican a mano, no en el deploy)
├── templates/                # .docx templates
├── deploy/                   # referencias de nginx / systemd + acciones manuales
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
| Muro (feed)    | `/muro`         | `feed_posts` (+ comments, reactions, poll_votes) |
| Calendar       | `/calendar`     | `competitions`        |
| Nominations    | `/nominations`  | `nominations`         |
| Personnel      | `/personnel`    | `personnel` (TDs/VGOs)|
| Competitions   | `/competitions` | `competitions`        |
| Templates      | `/templates`    | filesystem            |
| Users          | `/users`        | `auth.users` + `user_permissions` |
| Availability   | `/availability` | `availability`        |
| Logística      | `/logistics`    | `logistics_*`, `transport_*` |
| Training       | `/training`     | `training_*`          |
| Games          | `/games`        | `games`               |
| Inventory      | `/inventory`    | `assets`              |
| Loans          | `/loans`        | `loans`               |
| Scan           | `/scan`         | (QR landing)          |
| Employees      | `/employees`    | `employees` (staff interno) |
| Payments       | `/payments`     | `payments` (1:1 con `nominations`) |
| Budget         | `/budget`       | `budget_lines`, `expenses`, … (filtrado por departamento) |
| Reports        | `/reports`      | `competition_reports`  |
| Evaluations    | `/evaluations`  | `staff_evaluations`    |
| Activity       | `/activity`     | `activity_log` (solo superadmin) |

Dentro de **Games** viven además tres paneles con el mismo permiso `games`:
el **Crew del torneo** (`competition_assignments`), el **Staffing Plan**
(`competition_staffing`, empleados FIBA) y el **Control de operación**
(checklists de sede por partido). **Mi perfil** (foto/avatar) no es un
módulo: sale del usuario en el sidebar y usa `/api/me`.

Vistas públicas sin login: `/asset/:id` (QR), `/availability/:token`,
`/logistica/:token` y `/checklist/:token`.

---

## Adding a New Competition Template

1. Coloca el `.docx` template en `templates/`
2. Agregá la `template_key` al CHECK constraint en `competitions.template_key`
3. Agregá el spec en `api/_lib/services/document_generator.py` →
   `TEMPLATE_SPECS` (archivo `_TPL.docx` + contexto/builder)
4. Registralo en `api/_lib/routers/templates.py` → `TEMPLATES` para que
   aparezca en la UI de Templates
5. Actualizá `src/pages/Nominations.jsx` para lógica template-specific

## Adding a Permission / Module

Un permiso nuevo se declara en **tres** lugares, o la grilla de Usuarios y
el backend quedan desincronizados:

1. El CHECK de `user_permissions.module` (nueva migración)
2. `MODULES` en `api/_lib/routers/permissions.py`
3. `MODULES` en `src/pages/Users.jsx`

El resto del checklist (router, mount, página, ruta, icono, i18n) está en
[`DEVELOPMENT.md`](DEVELOPMENT.md).

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
| Rol / Role        | Yes      | `VGO` / `TD` / `REF` / `REF_INSTRUCTOR` / `VIDEO_OPERATOR` |

---

## Estado actual (septiembre 2026)

- ✅ Migración a DigitalOcean droplet completada; el deploy construye a
  `dist.new` y hace rollback solo si el smoke test falla
- ✅ Cartas de nominación con LibreOffice local (CloudConvert queda solo
  para el export de training schedule); la carta de LSB sobre su membrete
- ✅ Pen-test 3 rondas — H1-H9 + N1, N2, N3 cerrados — hardening en julio
  y auditoría del droplet en agosto 2026
- ✅ Design system completo (navy + basketball orange + IBM Plex)
- ✅ Scanner horario de alertas en `/var/log/fiba-security-alerts.log`
- ✅ Módulos: Payments, Reports, Evaluations, Logística (con vista pública),
  Budget (033-041, filtrado por departamento), Staffing Plan, Control de
  operación (checklists de sede con vista pública), Muro (043) y Mi perfil
  con avatar (044)
- ✅ Partidos con `datetime_utc` (039) y competencias con ventana de FIBA
  (040) y tipos Zonal / WC (042)
- ⏳ Manuales pendientes: [`SECURITY_RUNBOOK.md`](SECURITY_RUNBOOK.md) y
  [`deploy/MANUAL_ACTIONS_2026-08.md`](deploy/MANUAL_ACTIONS_2026-08.md)
