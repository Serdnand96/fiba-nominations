# Módulo Payments — análisis de FIBA Hub y plan de implementación

> Análisis del sistema legacy `apps.fibahub.com/app_events/vbills.asp`
> ("Events Payment") y propuesta para replicarlo dentro de
> `fiba-nominations`.
>
> Relevado: 21/07/2026, con sesión autenticada del usuario.

---

## 1. Qué es el sistema actual

App clásica en **ASP** (`.asp`, VBScript, postbacks a la misma página)
hosteada en `apps.fibahub.com`, dentro del "Apps Hub" de FIBA
(`/myapps.asp`). Sirve para registrar **pagos a personas y proveedores
asociados a un evento**: árbitros, technical delegates, instructores,
video graphics, staff, vendors, etc.

Dos pestañas:

| Tab | URL | Qué hace |
|-----|-----|----------|
| **Payments** | `vbills.asp` | Grilla de pagos filtrada por evento |
| **Events** | `events.asp` | ABM del catálogo de eventos |

Detalle / alta de un pago: `payment.asp?r=<id>` (o `?r=new&r2=<payee>&torneo=<event>`).
Detalle de evento: `event.asp?r=<id>`.

---

## 2. Modelo de datos observado

### 2.1 Evento (`events.asp` / `event.asp`)

| Campo | Tipo | Notas |
|-------|------|-------|
| Event name | texto | ej. "BCL Americas Season 7 - Quarterfinals" |
| From / To | fecha | rango del evento |
| Order | entero | orden manual en el listado |
| Active | Y/N | los inactivos no aparecen en el selector |
| Subzone | enum | `AMERICAS`, `CONSUBASQUET`, (COCABA / CBC aparecen en nombres) |
| Color | hex | `#FFCC00`, etc. — pinta la fila y el header del reporte |

Hay ~190 eventos cargados, desde 2019 hasta hoy. Incluye tanto
competencias reales como "eventos administrativos": `REFEREE DEVELOPMENT
PROGRAM - JULY 2026`, `IT GENERAL BUDGET`, `Competitions General
Expenses 2022`, `TD Workshop`, `AmeriCup 2023 - Draw`.

**Esto es clave:** el catálogo de eventos de vbills **no es** el catálogo
de competencias — es un superset que incluye bolsas de gasto mensuales y
generales.

### 2.2 Payee (directorio de personas/empresas)

El botón **Add Payment** abre un buscador de payees con: foto, nombre,
tipo, IOC (bandera del país). Hay un botón **New** para dar de alta uno
nuevo. Es un directorio **plano y compartido** que mezcla personas
físicas y empresas:

- Personas: `ANSELMO KRIVOKAPICH, Franco` (ARG, Referee)
- Empresas: `Badges & Medals`, `Hilton San Salvador`, `Metalvest
  (Trophies)`, `TPS Publicidad` (Vendor / Photographer)

Campos del payee (visibles en el form de pago):
`LASTNAME`, `FIRSTNAME`, `COUNTRY` (código IOC de 3 letras — 43 países
de las Américas), `COMPANY / DBA` (opcional), `EMAIL`, `PHOTO`.

### 2.3 Pago (`payment.asp`)

| Campo UI | Tipo | Valores |
|----------|------|---------|
| `BUDGET` | enum | Comms, Competitions, Administration, Referees, BCLA, IT |
| `AMOUNT` | numeric | honorario base |
| `TYPE` | enum | `ACH Payment`, `Wire Transfer` |
| `PAYEE` | enum (rol) | Photographer, Referee, Technical Delegate, Video Graphics, Videographer, LDA TV, Vendor, Staff, Referee Instructor, Coordinator, Extra, Game Manager |
| `DATE` | fecha | fecha del registro |
| `Date Bank Doc Received` | fecha | recepción de la documentación bancaria |
| `Bank Doc Sent to Finance` | fecha | envío a finanzas |
| `AIRFARE` | numeric | pasaje |
| `EXTRA` | numeric | extras |
| `COMMENTS` | texto largo | típicamente el detalle de partidos asignados |
| `PAYMENT` | numeric | monto efectivamente pagado |
| `Payment Date` | fecha | |
| `BANK CONFIRMATION` | texto | nº de confirmación del banco |
| `STATUS` | enum | `NEW`, `In Process`, `Split Payment`, `Completed` |
| `Anejo` + `Descripción Anejo` | archivos | N adjuntos con etiqueta |

**Adjuntos:** cada pago tiene 0..N PDFs, cada uno con una descripción
libre que en la práctica funciona como categoría. Las que se ven en uso:

- `EXPENSES` — planilla de gastos firmada
- `W8` — formulario fiscal US (W-8BEN para no residentes)
- `BANK INFO` — receiving account statement

Se guardan en `/files/docs/<uuid>.pdf` (nombre opaco, nombre original
preservado aparte para mostrar).

**Numeración:** cada pago tiene un correlativo visible `EP-05261`
(`EP-` + 5 dígitos, secuencial global, hoy en ~5518).

### 2.4 Grilla de pagos

Columnas: `#`, `Photo`, `Name`, `IOC` (bandera), `Budget`, `Amount`,
`Balance`, `Payee Type`, `Airfare/Extra`, `Payment`, `Days`, `Comments`,
`Created`, `Record` (correlativo + iconos PDF), `Status`.

- Header con el nombre del evento pintado del color del evento + rango
  de fechas del evento a la derecha.
- Fila coloreada según status (`Completed` en gris, `NEW` en blanco).
- Footer con **PAYMENT TOTAL** (suma de Amount, suma de Airfare/Extra,
  suma de Payment) y **GRAND TOTAL**.
- Ordenamiento por columna vía `fsort(n)` (postback, no client-side).

**Filtros** (form `demo1`, POST a sí misma):
`tevent` (evento), `xbuscar` (texto libre), `tdept` (budget/departamento),
`tstatus` (status), `f1`/`f2` (rango de fechas), botón `Buscar`.

**Exports:** dos iconos → `fprint()` (vista imprimible) y `fprint2()`
(export a Excel).

### 2.5 Cosas sin aclarar

- **`Balance`**: columna numérica en color, distinta de Amount y sin
  relación obvia con el evento (ej. amount 900 / balance 8.061). Podría
  ser el acumulado anual del payee, o el saldo de la línea de
  presupuesto. **Hay que preguntarle al usuario de negocio.**
- **`Days`**: casi siempre vacía, en algunas filas dice `128`. Parece un
  bug de render del legacy más que un dato real.
- `Split Payment` como status sugiere que un pago puede dividirse en
  varios, pero no se ve UI de splits — probablemente se resuelve
  cargando dos registros manualmente.

---

## 3. Mapeo a `fiba-nominations`

### 3.1 Qué ya tenemos y no hay que duplicar

| FIBA Hub | fiba-nominations | Decisión |
|----------|------------------|----------|
| Events (tab + ABM) | `competitions` (109 filas, alimentada desde el iCal de TeamUp) | **Reusar `competitions`**, no crear tabla de eventos |
| Payee persona (TD/VGO) | `personnel` | FK opcional |
| Payee staff FIBA | `employees` | FK opcional |
| Payee árbitro / vendor | — | **no existe**, hay que crearlo |
| Adjuntos PDF | bucket privado `nominations` + `storage://` | mismo patrón |
| Foto del payee | `personnel.photo` (migración 008) | reusar |

**El problema del catálogo de eventos.** `competitions` viene del iCal y
sólo tiene competencias reales; vbills además necesita bolsas tipo
"REFEREE DEVELOPMENT PROGRAM - JULY 2026" o "IT GENERAL BUDGET". Dos
salidas:

- **(A recomendada)** agregar `competitions.kind` (`competition` |
  `budget_bucket`) y permitir alta manual para los buckets, dejando el
  sync de TeamUp tocando sólo las de `kind='competition'`.
- (B) tabla `payment_events` aparte → duplica catálogo, se desincroniza.
  No.

**El problema del payee.** `personnel` es TD/VGO, `employees` es staff
interno, y no hay dónde poner árbitros ni proveedores. Propuesta: tabla
`payees` como directorio unificado de "a quién le pagamos", con FK
*opcional* a `personnel` / `employees` para no romper la regla del
proyecto de no mezclar esas dos tablas.

### 3.2 Schema propuesto

```sql
-- supabase/migrations/011_payments.sql

-- Bolsas de gasto que no son competencias reales
ALTER TABLE competitions
  ADD COLUMN kind text NOT NULL DEFAULT 'competition'
    CHECK (kind IN ('competition', 'budget_bucket')),
  ADD COLUMN color text;               -- hex, para el header del reporte

-- Directorio de destinatarios de pago
CREATE TABLE payees (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    last_name     text,
    first_name    text,
    company       text,                -- DBA, para vendors
    country       text,                -- código IOC 3 letras
    email         text,
    photo_path    text,                -- storage://nominations/...
    -- vínculos opcionales; a lo sumo uno de los dos
    personnel_id  uuid REFERENCES personnel(id) ON DELETE SET NULL,
    employee_id   uuid REFERENCES employees(id) ON DELETE SET NULL,
    active        boolean NOT NULL DEFAULT true,
    created_at    timestamptz DEFAULT now(),
    CHECK (personnel_id IS NULL OR employee_id IS NULL),
    CHECK (COALESCE(last_name, company) IS NOT NULL)
);

CREATE SEQUENCE payment_record_seq START 1;

CREATE TABLE payments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    record_no           text NOT NULL UNIQUE
                          DEFAULT 'EP-' || lpad(nextval('payment_record_seq')::text, 5, '0'),
    competition_id      uuid NOT NULL REFERENCES competitions(id),
    payee_id            uuid NOT NULL REFERENCES payees(id),
    budget              text NOT NULL CHECK (budget IN
                          ('comms','competitions','administration','referees','bcla','it')),
    payee_type          text NOT NULL,      -- referee, technical_delegate, vendor, …
    payment_method      text NOT NULL DEFAULT 'ach' CHECK (payment_method IN ('ach','wire')),
    record_date         date NOT NULL DEFAULT current_date,
    amount              numeric(12,2) NOT NULL DEFAULT 0,
    airfare             numeric(12,2) NOT NULL DEFAULT 0,
    extra               numeric(12,2) NOT NULL DEFAULT 0,
    paid_amount         numeric(12,2) NOT NULL DEFAULT 0,
    payment_date        date,
    bank_doc_received   date,
    bank_doc_sent       date,
    bank_confirmation   text,
    comments            text,
    status              text NOT NULL DEFAULT 'new'
                          CHECK (status IN ('new','in_process','split','completed')),
    created_at          timestamptz DEFAULT now(),
    created_by          uuid,
    updated_at          timestamptz DEFAULT now()
);

CREATE INDEX idx_payments_competition ON payments(competition_id);
CREATE INDEX idx_payments_payee       ON payments(payee_id);
CREATE INDEX idx_payments_status      ON payments(status);

CREATE TABLE payment_attachments (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id   uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    storage_path text NOT NULL,          -- storage://nominations/payments/<uuid>.pdf
    file_name    text NOT NULL,          -- nombre original para mostrar
    kind         text,                   -- EXPENSES | W8 | BANK INFO | …
    uploaded_at  timestamptz DEFAULT now()
);

CREATE INDEX idx_payment_attachments_payment ON payment_attachments(payment_id);

-- RLS: habilitada sin policies — se accede sólo vía backend con service_role,
-- igual que game_assignments (migración 006).
ALTER TABLE payees              ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attachments ENABLE ROW LEVEL SECURITY;
```

Notas de diseño:

- `payee_type` como texto libre con catálogo en el frontend, no enum SQL:
  la lista del legacy ya creció a 12 valores y va a seguir creciendo.
- `record_no` con `DEFAULT` sobre secuencia → correlativo automático sin
  lógica en Python, y compatible con importar los EP existentes si se
  ajusta el `setval`.
- No hay campo `balance`: hasta entender qué significa, no se modela.
- `total` no se genera en SQL (a diferencia de `nominations.total`)
  porque la relación entre amount/airfare/extra/paid no es una suma
  simple — se calcula en el reporte.

### 3.3 Backend

Router nuevo `api/_lib/routers/payments.py`, montado en `api/index.py`
con `prefix="/api"`, protegido con `require_view("payments")` a nivel de
router y `require_edit("payments")` en los mutadores — mismo patrón que
`loans.py`.

```
GET    /api/payments                 ?competition_id&budget&status&q&from&to
POST   /api/payments
GET    /api/payments/{id}
PATCH  /api/payments/{id}
DELETE /api/payments/{id}            → borra adjuntos de Storage primero
GET    /api/payments/summary         totales por evento/budget (footer del reporte)
GET    /api/payments/export.xlsx     equivalente a fprint2()

POST   /api/payments/{id}/attachments        multipart, sube al bucket privado
DELETE /api/payments/attachments/{att_id}
GET    /api/payments/attachments/{att_id}/download   → blob autenticado

GET    /api/payees                   ?q  (buscador del modal "Add Payment")
POST   /api/payees
PATCH  /api/payees/{id}
```

Cuidados heredados del proyecto:

- Los adjuntos van al bucket **privado** `nominations` bajo el prefijo
  `payments/`; el frontend nunca construye URLs públicas — descarga por
  blob + JWT como `downloadNominationBlob` en `src/api/client.js`.
- El borrado de un pago tiene que pasar por el endpoint que limpia
  Storage (patrón `_delete_pdf_from_storage`), nunca por SQL directo.
- Los endpoints de download **requieren auth** (regla del pen-test N1).

### 3.4 Frontend

- `src/pages/Payments.jsx` — lazy-loaded, envuelta en
  `<PermissionGuard module="payments">`, ruta en `App.jsx`, icono en el
  map `moduleIcon`.
- Barra de filtros: selector de competencia (reusar el patrón de
  competencias pineadas de Games), búsqueda, budget, status, rango de
  fechas.
- Tabla con `src/components/ui/Table`, orden **client-side** (el legacy
  hace postback; nosotros no).
- Fila expandible o panel lateral para el detalle en vez de navegar a
  otra página — coherente con el profile panel que ya se hizo.
- Footer sticky con los totales.
- i18n ES + EN en `src/i18n/`.
- Permiso `payments` en `user_permissions` (176 filas hoy; hay que
  sembrar el módulo para los usuarios existentes).

### 3.5 Fases sugeridas

1. **Migración + payees.** Schema, seed de `payee_type`, ABM de payees y
   vinculación con `personnel` existente.
2. **CRUD de pagos + grilla filtrable.** Sin adjuntos. Es lo que da el
   90% del valor.
3. **Adjuntos.** Upload/download por blob, categorías EXPENSES/W8/BANK
   INFO.
4. **Reportes.** Totales, vista imprimible, export XLSX.
5. **Migración de datos.** Import de los ~5.500 pagos históricos desde
   el legacy (hay export a Excel, así que es viable) + `setval` de la
   secuencia.

---

## 4. Preguntas para el usuario antes de codear

1. **¿Qué es la columna `Balance`?** Es la única pieza del modelo que no
   se puede inferir. Todo lo demás está resuelto.
2. **¿Se migra el histórico** (~5.500 registros, 2019→hoy) o se arranca
   de cero desde una fecha de corte?
3. **¿Quién puede ver pagos?** Es información sensible (montos, datos
   bancarios, W8). ¿Módulo restringido a un puñado de usuarios, o
   `can_view` amplio + `can_edit` restringido?
4. **¿El vínculo con `game_assignments`?** Los comentarios del legacy son
   texto plano con la lista de partidos ("Belo Horizonte, BRA / Sunday,
   March 8 / MINAS FRANCA"). Nosotros ya tenemos esos partidos
   estructurados en `game_schedule` + `game_assignments` — se podría
   autogenerar ese detalle y hasta pre-calcular el monto por cantidad de
   partidos. Es la mejora más grande sobre el sistema original.
5. **¿Se reusa `competitions` con `kind='budget_bucket'`** para las
   bolsas mensuales (Referee Development Program, IT General Budget), o
   se prefiere un catálogo aparte?
