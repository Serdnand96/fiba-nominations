# CLAUDE.md — Onboarding para sesiones de IA

> Leé este archivo primero si arrancás una sesión nueva sobre este repo.
> Acá está el contexto crítico para no caminar a tientas.

---

## TL;DR

Sistema admin de FIBA Americas para nominaciones de oficiales (TDs, VGOs),
training, logística, inventory, etc. Stack:

- **Frontend:** React + Vite + Tailwind, deployado como SPA estático
- **Backend:** FastAPI (Python 3.11) con gunicorn + uvicorn workers
- **DB + Auth + Storage:** Supabase (proyecto `mckaplalscnvaanukrmz`)
- **Hosting:** **DigitalOcean droplet** (NO Vercel — ver más abajo)
- **CI/CD:** GitHub Actions → SSH deploy al droplet

Dominio prod: **https://www.fibaapp.com** (con redirect 301 desde el
legacy `fibaamericascloud.com`).

---

## ⚠️ Cosas que confunden a sesiones nuevas

1. **NO está en Vercel.** `vercel.json` ya no existe (a lo sumo queda un
   `.vercel/` local, gitignoreado). El deploy real es al droplet DO.
   La migración a DO se completó en abril 2026.

2. **Los PDFs se generan con python-docx + docxtpl → LibreOffice**, no
   WeasyPrint ni templates HTML. Las cartas de nominación
   (`api/_lib/services/document_generator.py`) renderizan templates `.docx`
   con placeholders `docxtpl` y los convierten a PDF con `soffice` local
   (`USE_LOCAL_LIBREOFFICE=1`); CloudConvert quedó como fallback
   deshabilitado. **Ojo:** el export de training schedule
   (`api/_lib/routers/training.py`) es un camino aparte — arma la tabla con
   python-docx y todavía convierte vía CloudConvert únicamente (si no hay
   API key, sirve el `.docx`). Las fuentes de la conversión salen de `fonts/`
   (punto 20).

3. **Hay dos tablas distintas para personas:**
   - `personnel` → TDs / VGOs (oficiales que se nominan)
   - `employees` → staff interno de FIBA (no se nomina, solo aparece en
     inventario para asignar activos)

   El módulo **Evaluations** ("external staff") evalúa a `personnel`, no a
   `employees` — el "externo" es respecto de FIBA, no del sistema.

4. **`storage://nominations/X` paths** son una convención propia para
   referirse a objects en el bucket privado `nominations` de Supabase
   Storage. El backend los convierte a URLs autenticadas; el frontend
   nunca debe construir URLs públicas porque el bucket es privado.

5. **El frontend descarga PDFs vía blob + JWT**, no via `<a href>` con
   URL pública. La función está en `src/api/client.js`
   (`downloadNominationBlob`, `downloadTrainingPdf`).

6. **CSS variables hacen los tokens `fiba-*` dark-aware.** No es
   Tailwind nativo — ver `DESIGN_SYSTEM.md`. Si tocás colores, leelo
   primero.

7. **Transport ya no es un módulo: es una sección de Logística.** Desde la
   migración 025 el permiso se llama `logistics` (`transport` no existe más
   en `user_permissions`) y el módulo tiene tres secciones:
   - **Transporte** — vehículos, choferes, viajes. Sigue viviendo en
     `api/_lib/routers/transport.py` con prefijo `/api/transport/*`: la URL
     quedó igual porque es interna, solo cambió el permiso que exige.
   - **Hospedaje** — hoteles, rooming list y comidas.
   - **Travel Manifest** — llegadas y salidas de cada persona.

   Las dos últimas viven en `api/_lib/routers/logistics.py`. Todo cuelga de
   `logistics_participants`, el padrón de quién viene a la competencia
   (oficiales de `personnel`, staff de `employees`, VIPs y delegaciones sin
   vínculo). **No hay "Supabase Auth standalone"** ni sandbox separado:
   revisalo con el mismo checklist de permisos que cualquier otro módulo.

   Ojo con dos cosas que se ven raras y son correctas:
   - Las **noches** de la rooming list se derivan de `check_in`/`check_out`;
     la grilla `1`/`OUT` del Excel es una vista, no una tabla. El total que
     se le manda al hotel cuenta **habitaciones**, no personas: de una pareja
     que comparte cuarto, solo una fila suma (`is_room_holder`).
   - Los importadores de Excel (`services/logistics_import.py`) son de **dos
     pasos** (preview → commit) y nunca adivinan: un nombre dudoso se importa
     sin vincular y se reporta como warning. Las planillas vienen con typos
     reales (`Guyo`/`Juyo`, `BUELVAS`/`Vuelvas`) y con `Names`/`Last Name`
     invertidos en varias filas.

8. **Hay una vista pública de logística, sin auth.** `/logistica/<token>`
   (frontend) → `/api/public/logistics/<token>` (backend). Un link secreto por
   competencia, rotable y desactivable desde el panel "Compartir".
   **Publica los datos completos, número de pasaporte incluido** — fue una
   decisión explícita del cliente. Si alguna vez hay que recortar, el único
   lugar es `_redact()` en `public_logistics.py`.

9. **Hay dos formas de asignar personal, y las decide `competitions.fee_type`:**
   - `per_game` → asignación **por partido** en `game_assignments` (un cargo
     por juego), solo para templates WCQ/BCLA/LSB.
   - `tournament` → el **crew del torneo** en `competition_assignments`
     (helper: `api/_lib/crew.py`) cubre **todos** los partidos y todos los
     slots de training, sin importar el template. Las filas por partido pasan
     a ser un *override* opcional (quién estuvo realmente en la mesa) y ahí
     sí puede haber más de una persona en el mismo cargo.
   `sync-nominations` sale del crew en modo torneo y de `game_assignments` en
   modo per-game. El crew se edita desde Games y desde el panel de Calendar.

10. **El "Staffing Plan" NO es el crew.** `competition_staffing` (migración
    029, router `staffing.py`, panel en Games) registra a los **empleados FIBA**
    que trabajan un evento — `employees`, no `personnel`. Está deliberadamente
    fuera de `competition_assignments` porque esa tabla alimenta
    `sync-nominations`, las cartas y los fees: **un empleado FIBA no se nomina
    ni cobra window fee**. Si algún día hay que cruzarlos, el puente correcto es
    sembrar `logistics_participants` con `category = 'fiba_staff'`, no unificar
    las tablas. Permiso: `games`. El picker sale de `/staffing/candidates` y no
    de `/employees`, para no exigir el permiso `employees` a quien planifica.

    **Los viajes por año del empleado son derivados, no guardados.** La columna
    "Viajes" de Empleados (`/employees/trip-counts` y `/employees/{id}/trips`)
    se calcula al leer, sumando `competition_staffing` **y**
    `logistics_participants` y deduplicando por competencia: **un viaje = una
    competencia**, aunque la persona cubra dos funciones en el mismo evento. No
    agregar una columna contador a `employees` — habría que recalcularla en
    cada alta, baja y cambio de año. La columna "Días comp." sale del mismo
    cálculo: sábados y domingos **dentro del tramo** de cada viaje, base de los
    compensatorios. **Los feriados no se cuentan** (no hay calendario de
    feriados y varía por país de la persona).

    Los días compensatorios llevan **permiso propio `comp_days`** (migración
    030). No corresponde a una página: no tiene ruta ni entrada de sidebar,
    gobierna una columna dentro de Employees y solo usa `can_view`. El backend
    recorta `weekend_days` de la respuesta con `has_view()` (la variante de
    `auth.py` que devuelve bool en vez de tirar 403, para permisos que recortan
    datos en lugar de cerrar un endpoint).

    Hay un **segundo** permiso no-página: **`payments_approve`** (migración
    047). Tampoco tiene ruta; solo usa `can_view` y habilita pasar un pago a
    `completed` (punto 14). Los dos están en `VIEW_ONLY_MODULES` de `Users.jsx`,
    que les deshabilita la casilla de edición.

    Al agregar un permiso hay que tocar **tres** lugares: el CHECK de
    `user_permissions.module`, `MODULES` en `permissions.py` y `MODULES` en
    `src/pages/Users.jsx` (y `VIEW_ONLY_MODULES` si no es una página).

11. **Los checklists de sede son datos, no código** (migración 038,
    `checklists.py` + `public_checklists.py`). "El VGO llega a la sede y prueba
    reloj, fill & key, software, GFX y stats" es *una* plantilla
    (`checklist_templates`), editable desde el panel **Control de operación** en
    Games. Agregar la del TD o la del médico no toca el backend.

    - La corrida se engancha al **partido**, no a la sede ni al día.
    - Abrir una corrida **copia** los ítems de la plantilla a
      `game_checklist_items`. Editar la plantilla en octubre no reescribe lo que
      se firmó en agosto — por eso hay `label` duplicado, no es un descuido.
    - **El estado no se guarda.** `pending` / en curso / cerrado / con falla se
      derivan de los ítems en `run_state()`. No agregar una columna `status`.
    - Permiso `games`, el mismo del crew y del staffing plan. No es una página.
    - Hay una **tercera vista pública**, `/checklist/<token>` →
      `/api/public/checklists/<token>`. A diferencia de logística y
      availability, esta **escribe**: cada PATCH revalida la cadena ítem →
      corrida → partido → competencia contra el token, y una corrida cerrada es
      de solo lectura desde afuera (reabrirla exige permiso `games`). La firma
      se pide una vez al abrir la corrida, no ítem por ítem; `checked_source`
      distingue lo cargado en la cancha (`self`) de lo transcripto en la oficina
      (`admin`).

12. **`date`/`time` de un partido son hora LOCAL de la sede.** No UTC, no hora
    de Argentina, no la del navegador. Es lo que ve el TD en el gimnasio y lo
    que muestra la web de FIBA. El ancla para convertir a cualquier otra zona
    es `game_schedule.datetime_utc` (migración 039), que sale de
    `gameDateTimeUTC` de FIBA.

    - **Nunca sumes un offset a la hora local.** La competencia toca 16 zonas
      IANA que cambian de horario de verano en fechas distintas, y algunas no
      cambian. Convertí desde `datetime_utc`.
    - Cuidado con la fecha: México juega 20:10 local y eso es **02:10 UTC del
      día siguiente**. `datetime_utc` es timestamptz justamente por eso, y la
      card marca `+1`/`-1` cuando en la zona destino el partido cae otro día.
    - `NULL` significa que FIBA todavía no fijó horario
      (`hasTimeGameDateTime=false`); la UI muestra `--:--` en vez de inventar.
      `'00:00'` en `time` es lo mismo: relleno, no medianoche.
    - La hora del war room (Miami) vive en `src/lib/warRoom.js`, con la zona en
      una sola constante `WAR_ROOM_TZ`.

13. **La API de FIBA no devuelve una ventana: devuelve el clasificatorio
    entero.** `getgdapgamesbycompetitionid` para el WC 2027 Americas Qualifiers
    trae los **84 partidos de las seis ventanas**, de noviembre 2025 a marzo
    2027, por la misma URL. Acá, en cambio, cada ventana es una **competencia
    aparte** con su crew, sus nominaciones y sus fees.

    Por eso existe `competitions.fiba_window_code` (W1..W6, migración 040): si
    está seteado, `sync-results` importa solo los partidos con ese `windowCode`.
    `NULL` = sin filtro, que es lo correcto para una competencia no dividida en
    ventanas (AmeriCup, CentroBasket) — la mayoría.

    - **No filtres por el rango de fechas de la competencia.** Window 3 de FIBA
      termina el 2026-07-08 y la competencia declara hasta el 07-07: ese filtro
      se come un partido, y en el caso real ese partido tenía TD y VGO
      asignados. Los bordes de una ventana no coinciden con las fechas que
      carga el equipo, que incluyen viaje.
    - El filtro **falla del lado seguro**: si la competencia declara ventana
      pero ningún partido del feed trae `windowCode`, no filtra nada. Un feed
      sin ventanas tiene que devolver sus partidos, no cero.
    - Sin esto (hasta agosto 2026) W3 y W4 tenían 84 filas cada una, de las
      cuales 17 y 12 eran suyas; los partidos de agosto se veían dentro de la
      ventana de julio. Se limpiaron 139 filas.

14. **Hay DOS tablas de gasto y el reporte suma las dos.** No son alternativas
    ni una reemplaza a la otra:
    - `payments` (migración 012) → pago a **una persona nominada a un evento**.
      `nomination_id` es NOT NULL UNIQUE: sin nominación no hay pago. De ahí
      salen los fees de TDs, VGOs y árbitros.
    - `expenses` (migración 034) → **todo lo demás**: gasto de departamento sin
      evento (licencias, internet, leasing) y gasto de evento sin persona
      (shipping, branding, seguros).

    `/budget/summary` suma las dos fuentes. Un gasto cuenta como ejecutado con
    `paid` y como comprometido con `approved`. Un pago (`new` / `in_process` /
    `completed` / `cancelled` desde la migración 047 — **`split` ya no
    existe**) es ejecutado en `completed` y comprometido en `new`; el pago
    parcial es un `in_process` con `paid_amount`, que cuenta lo pagado como
    ejecutado y el resto (`total − paid_amount`) como comprometido
    (`_payment_buckets`). `cancelled` no cuenta. Lo comprometido no descuenta
    del restante.

    El **año** de un pago no es el de cualquier fecha: `completed` → año de
    `payment_date` (o de la competencia si no tiene); abierto → año de la
    competencia (`_payment_fiscal_year`). Un ingreso, por `received_date` o
    `expected_date` según su estado (`_revenue_year`). Ver BUDGET_MODULE.md §8.

    **No metas un `nomination_id` nullable en `payments`** para unificarlas: eso
    volvería condicional el prefill desde `nominations.total`, la lógica de
    W8/bank info y el bloqueo de borrado de la migración 028.

    El contrato completo del módulo está en `BUDGET_MODULE.md` y se actualiza en
    el mismo PR que el código.

15. **La imputación de un pago al presupuesto es derivada, y son DOS.**
    `payments.department_code` / `account_code` (migración 036) no se piden en
    el formulario: salen del `budget_code` que el usuario ya eligió y del rol de
    la persona nominada. Y un pago aporta **dos** imputaciones, no una:

    | Concepto | Va a la cuenta | Mapeo |
    |---|---|---|
    | fee (`total` = amount + extra) | de **fees** del rol | `api/_lib/budget_accounts.py` |
    | pasaje (`airfare`, migración 013) | de **travel** del rol | el mismo archivo |
    | (departamento) | — | columna `payment_budgets.department_code` (migración **041**) |

    - **Nunca imputes el pasaje a la cuenta del fee.** Infla una línea y deja la
      otra en cero, y encima parece correcto. El plan de cuentas viene apareado:
      TD 11/12, VGO 13/14, REF 10/07, REF_INSTRUCTOR 08/09, VIDEO_OPERATOR
      29/30 (las dos últimas las crea la migración 045; antes sus pagos nacían
      sin imputar).
    - El departamento es **dato, no código**: agregar un `payment_budgets` sin
      mapear manda esos pagos a `unallocated_payments` (el ámbar del dashboard).
      El backend loguea un warning cuando pasa, pero es lo único que avisa.
    - Un valor sin mapear queda en `NULL` **a propósito**: se reporta como sin
      imputar en vez de esconderse dentro del total de un área ajena.

16. **Budget es el único módulo con filtrado por FILA.** En todos los demás un
    permiso abre o cierra el endpoint entero: quien tiene `logistics` ve toda la
    logística. Acá no alcanza — el designado de IT ve los gastos de IT y no los
    de Competitions.

    Y **no se resuelve con RLS**: el backend pega con el `service_role`, que la
    bypassa por diseño. El recorte vive en el código, en **cada** query del
    router, vía `_scoped()` (`budget.py`) contra la tabla `budget_access`.

    - Una query de budget sin `_scoped()` es un agujero **P0**, igual que un
      endpoint sin `require_view`.
    - `_scoped()` resuelve el scope y el filtro que pidió el usuario en **un
      solo** `.eq`/`.in_`: el query builder guarda un filtro por columna, así que
      encadenar dos pisa el scope en silencio. Eso sería el bypass.
    - `/budget/access/{user_id}` es **solo superadmin**: quién ve qué plata no lo
      decide alguien que ya tiene el módulo.
    - Son **tres** acciones, no dos: `_departments_for(request, action)` acepta
      `'view'` / `'edit'` / `'approve'` (columnas `can_view` / `can_edit` /
      `can_approve` de `budget_access`, la última de la migración 048).
      `can_approve` **no** se deduce de `can_edit` (el que carga y el que aprueba
      son roles distintos) y sí implica `can_view`. Nadie aprueba un gasto que
      cargó (`created_by`) ni uno cuyo último cambio de plata hizo él
      (`last_financial_edit_by`, migración 050); el superadmin puede, con
      motivo, y queda como override en el historial. Por eso `POST /budget/expenses/{id}/transition`
      y `/approve` no llevan `require_edit` en el decorador: el permiso lo decide
      la transición (punto 23).
    - Lo que no es de ningún departamento no se puede recortar por fila y queda
      para el **admin general** (superadmin o fila `'*'` con `can_edit`,
      `_assert_general_admin()`): el plan de cuentas (`POST`/`PATCH` y `remap`
      de `/budget/accounts`), borrar proveedores o cambiarles `name` / `active`,
      y leer o escribir `bank_info` / `tax_id` de un proveedor (el resto ve
      `has_bank_info`). El headcount y los supuestos exigen en cambio el
      departamento **Competitions**, que es lo que alimentan: verlo para los
      GET, editarlo para los PUT.

17. **Las migraciones de Budget NO van en el deploy automático.** Son la
    **033-037**, la **041** y la **045-050** (las 038-040 son de otros módulos:
    checklists, hora UTC de los partidos, ventanas FIBA). Se aplican a mano
    contra Supabase **antes** de pushear el código que las usa — si no, el
    deploy encuentra una columna que no existe. Cada archivo lo dice en su
    cabecera. El resto del schema sigue la misma convención, pero acá es
    especialmente fácil olvidarlo porque son muchas y van en orden: la 045-050
    (flujo de finanzas, octubre 2026) son cuentas del Video Operator, historial
    de estados, pipeline de pagos + `personnel_banking` + `payments_approve`,
    aprobación de gastos, notificaciones y `last_financial_edit_by/at` (quién
    tocó la plata por última vez).

    **Estado hoy (octubre 2026):** el presupuesto está cargado ($1.627.431
    para 2027, entre IT, Competitions y Comms; $280.111 para 2026, solo IT). El
    **ejecutado** tiene los 129 gastos de IT de enero a julio 2026
    (`scripts/import_it_2026.py`, $41.667) y 1 pago; sigue sin gastos de
    Competitions ni Comms y sin proveedores. Si el dashboard 2027 te da el
    ejecutado en cero, es el dato y no un bug. `personnel_banking` arranca
    vacía, nadie tiene `payments_approve` por defecto y `can_approve` solo lo
    recibe la fila `'*'` con `can_edit` (backfill de la 048): hasta que un
    superadmin los asigne en Usuarios, completar pagos y aprobar gastos queda en
    manos del superadmin.

18. **El Muro (`feed`) es el único permiso donde `can_view` ESCRIBE.** Es el
    feed interno a lo Facebook (`api/_lib/routers/feed.py`, página
    `src/pages/Feed.jsx`, ruta `/muro`, migración 043): novedades de los
    compañeros, eventos, avisos de RRHH, encuestas, reacciones y comentarios.
    Es deliberadamente el módulo menos formal del sistema, y por eso el permiso
    no sigue la regla "toda escritura lleva `require_edit`" (la otra excepción
    a esa regla es aprobar un gasto, que pide `budget:view` más `can_approve`
    del departamento en vez de `budget:edit` — punto 16):

    | Permiso | Qué habilita |
    |---|---|
    | `feed:view` | **participar**: leer, publicar, reaccionar, comentar, votar y editar/borrar lo propio |
    | `feed:edit` | **moderar**: fijar arriba, marcar una publicación como oficial, borrar ajeno |

    - Las escrituras sobre contenido propio van con el `require_view` del
      router más `_assert_can_manage()` (autor o moderador, vía `has_edit()` de
      `auth.py`, la hermana bool de `has_view()`). Lo que solo modera sí lleva
      `require_edit`. Un `require_edit` en `POST /feed/posts` dejaría el muro
      mudo para casi todos: no lo "arregles".
    - Las fotos van al bucket **público** `inventory` bajo `feed/`, como las de
      personnel. El muro no lleva documentos.
    - `author_name` es una foto al publicar (sale de `employees` por email o
      del email mismo). Renombrar al empleado no reescribe el muro.
    - La barra lateral (`/feed/sidebar`) muestra competencias próximas y quién
      viaja (`competition_staffing`) a quien tenga `feed` aunque no tenga
      `calendar`, `games` ni `employees`. Solo nombres, fechas y ciudades: es
      información de pasillo. Si alguna vez hay que recortar, es ahí.
    - Si el usuario tiene `feed`, el Muro es su página de entrada (va primero
      en `allNavItems`).

19. **El avatar del usuario vive en `user_profiles.avatar_url`** (migración
    044, router `profile.py`, prefijo `/api/me`). Es la foto de perfil de quien
    usa la plataforma: se ve en el sidebar, como autor en el Muro y en la lista
    de Usuarios. Se edita desde el modal "Mi perfil" (clic en el usuario del
    sidebar, `src/components/ProfileModal.jsx`).

    - `/me` **no lleva permiso de módulo**: es lo propio del logueado, con
      `require_user` (401 sin usuario, falla cerrado). Cada uno sube y borra
      **solo su** foto; no hay endpoint para cambiar la de otro.
    - `user_profiles` tenía fila solo para superadmins. Subir un avatar crea la
      fila del usuario **sin tocar `is_superadmin`** (queda en `false`). No usar
      esa tabla como "existe el usuario".
    - La imagen va al bucket público `inventory` bajo `avatars/<user_id>.<ext>`,
      como personnel y el muro. La URL guardada lleva `?v=<timestamp>` porque la
      key es siempre la misma y si no el navegador muestra la foto anterior.
    - En el muro la foto **no se congela** como `author_name`: se lee en vivo por
      `author_id` con `avatars_for()` (batch, sin N+1). Cambiar el avatar se ve
      en lo ya publicado.
    - El frontend recorta en cuadrado y baja a 512px (canvas) antes de subir; el
      backend igual valida tipo (sin SVG) y tamaño (2 MB).
    - **La pestaña "Avatar" no es otro camino:** genera un dibujo con DiceBear
      (`src/lib/avatars.js`, cargado con `import()` para no engordar el bundle),
      lo pasa a PNG con canvas y lo sube por el **mismo** endpoint. El backend
      no sabe si fue foto o avatar, y el bucket sigue sin SVG. Los estilos son
      MIT o "free for commercial use"; no agregar uno que exija atribución.

20. **Las cartas se convierten a PDF con las fuentes de `fonts/`, no con las
    del sistema.** El droplet no tiene Univers, IBM Plex Sans, Cochocib Script ni
    Titillium, y hasta septiembre 2026 LibreOffice las reemplazaba por DejaVu
    Sans: títulos partidos, firma de WCQ en cuatro líneas, "Gino Rullo" en texto
    plano gigante, footer de GENERIC cortado a mitad de palabra. Ahora
    `_convert_to_pdf_libreoffice()` lanza `soffice` con
    `FONTCONFIG_FILE=<repo>/fonts/fonts.conf`: las fuentes libres viven en el
    repo y los alias (`Univers → Nimbus Sans`, `Cochocib Script → Alex Brush`,
    `Calibri → Carlito`, …) viven en ese archivo. No hay nada que instalar en
    el sistema ni depende del HOME del servicio.

    - Las fuentes con licencia van a `fonts/private/` (gitignoreado) si FIBA
      las entrega; al estar presentes ganan sobre el sustituto porque los alias
      usan `<accept>`, no `<prefer>`.
    - `fonts_report()` compara las familias de un `.docx` contra `fc-match` y
      Templates lo muestra por plantilla (ok / sustituida / falta). Es el único
      aviso: la conversión "termina bien" aunque falte la fuente.
    - Las cajas de texto del footer de GENERIC ("@FIBA", "FIBA.basketball")
      llevan `Calibri` explícito en el `.docx` fuente porque LibreOffice no les
      aplica la fuente del tema de Word y con cualquier otra se parten. Si se
      reemplaza el membrete, hay que repetir ese parche.
    - Firma de BCLA y LSB: sigue siendo texto en una script (Alex Brush como
      sustituto). Una imagen escaneada sería mejor; pedirla al cliente.

21. **Generar una nominación: el sistema rellena, el usuario corrige.** Desde
    septiembre 2026 el formulario de Nominaciones prellena desde
    `GET /nominations/prefill`: defaults de la competencia, tarifa por cargo,
    fechas de partido de la competencia o de la persona (misma derivación que
    `sync-nominations`, importada de `games.py`, no duplicada). Si `window_fee`
    llega `null` al crear, el backend aplica la tarifa del cargo de cada persona.

    - **La carta no se genera con huecos.** `required_fields_for(competition)`
      exige `letter_date` y `window_fee` siempre, `confirmation_deadline` en
      cartas de nominación (WCQ/GENERIC/custom `nomination`) y al menos un
      `game_dates` en `per_game`. `POST /{id}/generate` responde **422** con
      `detail = {code: "missing_fields", missing: [...]}` (un dict, a
      propósito); bulk y `generate-pdfs` lo reportan por ítem. La vista previa
      sí renderiza igual, con header `X-Missing-Fields`, para ver qué falta.
    - Existe `PATCH /nominations/{id}` (editar) y dos previews sin persistir:
      `POST /nominations/{id}/preview` y `POST /nominations/preview` (payload
      del formulario). Ninguno toca Storage ni `status`.
    - `letter_data_for(nom)` es la única forma de armar el dict que consume
      `generate_nomination()`; lo usan nominations.py, games.py y el preview de
      Templates con nominación real. No lo vuelvas a copiar a mano.
    - Descarga en lote: `POST /nominations/download-zip`.

22. **Las plantillas subidas usan tags simples.** El usuario escribe siempre
    `{{ campo }}`: `LetterTemplate.patch_xml()` en `document_generator.py` le
    pone la `r` a los valores `RichText` antes de que docxtpl los procese, y
    resuelve alias en español (`{{ saludo }}`, `{{ partidos }}`,
    `{{ honorarios }}`, en `FRIENDLY_ALIASES`). Las listas llegan armadas en un
    solo valor multilínea (`game_list`, `fees_block`, `details_block`); los
    bucles `{%p for %}` siguen funcionando pero la UI los marca como avanzados.
    Un tipo creado desde la UI recibe el contexto **unificado** (nomination ∪
    confirmation): `kind` solo elige el starter, ya no limita los campos.
    Se puede duplicar una plantilla (`POST /templates/{key}/duplicate`) y
    previsualizar con una nominación real (`?nomination_id=`).

23. **En gastos y pagos el `status` no se edita por PATCH/PUT.** Solo cambia por
    `POST /budget/expenses/{id}/transition` y `POST /payments/{id}/transition`
    (más `/payments/bulk-status`, que aplica la misma regla ítem por ítem). Un
    PATCH/PUT con `status` es 400, y un alta nace `draft` / `new`.

    - Cada máquina es una **función pura** (`check_expense_transition` en
      `budget.py`, `check_payment_transition` en `payments.py`): recibe la fila,
      el destino, el body y los derechos del caller ya resueltos, y devuelve qué
      escribir o levanta 400 (falta un dato) / 403 (no te toca) / 409 (no existe
      esa transición). Las tablas están en BUDGET_MODULE.md §14 y en un test
      (`test_transition_table_is_the_documented_one`) que falla si cambian sin
      actualizarlo.
    - El endpoint escribe con `.eq("status", <el validado>)` (lock optimista:
      si alguien lo movió en el medio, 409), deja traza con
      `record_transition()` (`services/finance_history.py`, tabla
      `finance_status_history`, migración 046) y avisa con `notify()`.
    - Separación de funciones: nadie aprueba un gasto ni completa un pago que
      **creó o cuyo último cambio de plata hizo** (`created_by` y
      `last_financial_edit_by`, migración 050); el superadmin sí, **con
      motivo**, y queda `meta.override`. Completar un pago exige
      `payments:edit` **más** `payments_approve`, fecha, nominación no
      declinada, el CM aprobado, W-8 vigente y datos bancarios, y paga **el
      total** (`paid_amount` distinto del total → 400).
    - El pago parcial no es un estado ni un campo del PUT: es
      `POST /payments/{id}/record-partial {paid_amount, reason?}`, con el mismo
      gating que completar. El PUT ya no acepta `paid_amount`.
    - Las **ediciones de plata** (PUT de un pago con `amount` / `extra` /
      `airfare` / `budget_code`, PATCH de un gasto con campos financieros,
      `sync-amount`) y los **DELETE** también quedan en el historial: con el
      mismo status y `meta.edit`, o con `to_status = 'deleted'`.
    - No hay `approved → cancelled` en gastos ni `completed → cancelled` en
      pagos: primero se reabre. Un pago con `paid_amount > 0` no vuelve a `new`
      ni se cancela (desaparecería del ejecutado).

24. **Las notificaciones son in-app y no tienen cron ni email.** La campana
    (`src/components/NotificationsBell.jsx`) lee de `/api/me/notifications`
    (router `notifications.py`), que como `/me` va bajo **`require_user`** y sin
    permiso de módulo: **toda** query filtra por `user_id = caller`, incluido el
    UPDATE de marcar leída (una ajena da 404). Dos cosas distintas:
    - **Novedades** → tabla `notifications` (migración 049). Las escribe
      `notify()` (`services/notify.py`) en el mismo handler que produce el
      evento; es best-effort y nunca rompe el request.
    - **Pendientes** → `GET /me/notifications/pending`, **calculados en vivo**
      según los permisos del caller (gastos por aprobar, pagos sin W-8 o sin
      banco, pagos esperando al CM, recurrentes del mes). No se guardan; no
      agregues una tabla para eso.
    El front hace poll cada 60 s y al volver a la pestaña. Quién recibe qué:
    BUDGET_MODULE.md §15.

25. **`personnel_banking` vive SOLO en el router `payments`.** Es la ficha
    bancaria y el W-8/W-9 de cada persona (migración 047), bajo
    `/api/payments/personnel/{id}/banking`: hereda `require_view("payments")`,
    así que quien tiene `personnel` sin `payments` no la ve. **Nunca** la
    expongas por `personnel.py`.
    - El GET devuelve los números **enmascarados** (`****1234`) y, si la persona
      no tiene ficha, `exists: false` (no 404).
    - `POST …/banking/reveal` muestra los números completos y es **POST a
      propósito**: el middleware del `activity_log` audita POST/PUT/PATCH/DELETE,
      no los GET. No lo pases a GET.
    - Bajar el PDF del W-8 también es **POST** (`…/tax-form/download`, con
      `payments:edit`), por la misma razón.
    - El W-8 **bloquea** `completed` y `record-partial` (tiene que estar `ok` o
      `exempt`), igual que no tener datos bancarios; en `new → in_process` solo
      **advierte**. Un W-8 sin fecha de vencimiento vence el 31/12 del tercer
      año posterior a la firma; uno sin PDF cuenta como faltante. El PDF va al
      bucket privado `nominations` bajo `banking/`.
    - El export de pagos no lleva números de cuenta.

---

## 🗺️ Mapa del repo

```
fiba-nominations/
├── CLAUDE.md                  ← este archivo
├── README.md                  ← overview general
├── ARCHITECTURE.md            ← sistema completo
├── DEPLOYMENT.md              ← GH Actions → droplet
├── DEVELOPMENT.md             ← correr local
├── DESIGN_SYSTEM.md           ← tokens / componentes UI
├── SECURITY_RUNBOOK.md        ← acciones manuales pendientes (Supabase, DNS)
├── PAYMENTS_MODULE.md         ← análisis del legacy vbills (histórico; la
│                                 implementación final difiere — ver nota adentro)
├── BUDGET_MODULE.md           ← contrato del módulo Budget (schema, endpoints,
│                                 scoping por departamento, datos cargados)
├── LSB_LETTER_SPEC.md         ← la carta de LSB: su texto, su membrete y por qué
│                                 el starter de `confirmation` no es el de LSB
├── .claude/                   ← subagentes + skills para sesiones de IA (ver abajo)
│
├── api/                       ← FastAPI backend
│   ├── index.py               ← entry, middleware, mounting routers
│   └── _lib/
│       ├── auth.py            ← require_view, require_edit, require_user, has_view/has_edit
│       ├── database.py        ← lightweight supabase client (httpx)
│       ├── budget_accounts.py ← rol → cuenta de fees / de travel (payments ↔ budget)
│       ├── finance_years.py   ← a qué año cae un pago (budget y la cola de payments)
│       ├── routers/           ← uno por módulo (nominations, training, …) + notifications (/me)
│       └── services/
│           ├── document_generator.py  ← docx (docxtpl) → pdf (LibreOffice)
│           ├── finance_history.py     ← record_transition / history_for (punto 23)
│           ├── notify.py              ← notify(), budget_approvers_for, module_editors (punto 24)
│           └── xlsx_utils.py          ← helpers de los exports .xlsx nuevos
│
├── src/                       ← React frontend
│   ├── App.jsx                ← shell (sidebar + topbar + router)
│   ├── pages/                 ← una por ruta
│   │   ├── budget/            ← pestañas de Budget, editores, scope.jsx (BudgetScopeContext)
│   │   └── payments/          ← Cola, Por evento, PaymentDrawer, BulkStatusModal
│   ├── components/
│   │   ├── ui/                ← Button, Input, Table, Tabs, Drawer, … (DS primitivos)
│   │   ├── charts/            ← BudgetCharts (recharts, chunk `charts`, solo con React.lazy)
│   │   └── brand/             ← Logo.jsx (Monogram, Wordmark, …)
│   ├── lib/icons.jsx          ← Tabler icons
│   ├── contexts/              ← Auth, Language
│   └── i18n/                  ← ES + EN
│
├── public/favicon.png         ← monograma F + basketball seam
├── fonts/                     ← fuentes libres + fonts.conf para LibreOffice (punto 20)
├── scripts/
│   ├── build_letter_templates.py  ← regenera los *_TPL.docx (correr si cambia el membrete)
│   ├── fiba-security-scan.sh      ← scanner horario de nginx logs (corre en droplet)
│   └── fiba-supabase-keepalive.sh ← ping diario a Supabase (evita el auto-pause del Free)
├── supabase/migrations/       ← schema SQL
├── tests/                     ← pytest sin red ni base (ver DEVELOPMENT.md → Tests)
├── verify_security.sh         ← smoke test post-deploy
├── .github/workflows/deploy.yml  ← CI/CD
└── tailwind.config.js         ← tokens del DS
```

---

## 🤖 Subagentes y skills (para sesiones de Claude Code)

En `.claude/` hay subagentes y skills con las convenciones **reales** del
repo, para no reconstruirlas de cero en cada sesión:

- **Agentes** (`.claude/agents/`): `explorer` (read-only, entender un módulo
  antes de tocarlo), `frontend-implementer`, `api-implementer`,
  `pdf-specialist`, `excel-import-specialist` y `code-reviewer`. Flujo
  sugerido: explorer → implementer(s) → code-reviewer.
- **Skills** (`.claude/skills/`, se auto-cargan según el contexto):
  `api-conventions`, `frontend-conventions`, `fiba-excel-format`,
  `pdf-templates`, `security-checklist`.

⚠️ Son una **foto del código**: si refactorizás auth, la generación de PDF o
el import de Excel, actualizá el skill correspondiente en el mismo PR — un
skill desactualizado es peor que ninguno.

---

## 🔑 Cuentas / dónde están las cosas

| Servicio        | Dónde                                                              |
|-----------------|--------------------------------------------------------------------|
| Repo            | `Serdnand96/fiba-nominations` (GitHub)                             |
| Droplet         | `ssh fiba` (alias en `~/.ssh/config`) → `64.227.19.67`             |
| Code en droplet | `/opt/fiba-nominations` (owner: `fiba` user)                       |
| Supabase        | proyecto `mckaplalscnvaanukrmz`                                    |
| Domain          | GoDaddy (DNS), Let's Encrypt (TLS)                                 |
| GH Actions secrets | `DROPLET_SSH_KEY`, `DROPLET_HOST`                                |
| Service prod    | `systemctl status fiba-api` (gunicorn → 127.0.0.1:8000)            |
| nginx config    | `/etc/nginx/sites-available/fiba-nominations`                      |

---

## 🚀 Comandos clave

```bash
# ── Deploy (es automático en push a main, pero también manual): ──
git push origin main
# → GH Actions tira ssh fiba, git pull, pip install, npm build, restart fiba-api

# ── Ver el deploy en marcha: ──
gh run watch                # último workflow

# ── Smoke test después de un deploy: ──
bash verify_security.sh

# ── Logs del API: ──
ssh fiba sudo journalctl -u fiba-api -n 100 --no-pager

# ── Logs de nginx: ──
ssh fiba sudo tail -f /var/log/nginx/access.log
ssh fiba sudo tail -f /var/log/nginx/error.log

# ── Alertas de seguridad: ──
ssh fiba sudo tail -f /var/log/fiba-security-alerts.log

# ── Restart manual: ──
ssh fiba sudo systemctl restart fiba-api && sleep 2 && \
  ssh fiba sudo systemctl is-active fiba-api

# ── Dev local (frontend + backend): ──
npm run dev                 # vite
# y aparte:
./venv/bin/uvicorn api.index:app --reload --port 8000
```

---

## 🧭 Convenciones del proyecto

### Backend (FastAPI)

- **Auth middleware** (en `api/index.py`) valida JWT contra Supabase
  `/auth/v1/user`. Bypasses solo para: OPTIONS, `/api`, `/api/public/*`.
  Endpoints `/download` y `/export/pdf` **requieren auth** (pen-test N1).

- **Autorización a nivel de app (NO RLS).** El backend pega a Supabase con
  el `service_role` key (`api/_lib/database.py`), que **bypassa Row Level
  Security**. Por eso el control de acceso vive en el código: cada router
  declara `require_view("X")` a nivel `APIRouter` y cada escritura agrega
  `require_edit("X")` (de `api/_lib/auth.py`). Los permisos salen de
  `user_permissions` (`can_view`/`can_edit`); el flag `is_superadmin` sale
  de `user_profiles` y se cachea por request en
  `request.state._is_superadmin`. RLS existe solo como defensa en
  profundidad en algunas tablas (migraciones 006/007), no como control
  principal. **Un endpoint sin dependency de permiso = agujero P0.**

- **Storage path normalization** (`api/_lib/routers/nominations.py` →
  `_extract_storage_key()`) maneja 3 formatos: `storage://nominations/X`,
  `/storage/v1/object/public/nominations/X`, `/storage/v1/object/nominations/X`.

### Frontend (React)

- **Lazy-load todas las pages**: `const X = lazy(() => import('./pages/X'))`.
  Vite genera un chunk por pagina.

- **Vendor chunking** definido en `vite.config.js`: `react-vendor`,
  `supabase`, `qrcode-scan`, `http`.

- **Permission guards** envuelven cada ruta: `<PermissionGuard module="X">`
  redirige a 403 si no hay `can_view`.

- **i18n** vía `useLanguage()` (ES por default, switch en sidebar).

- **Modo oscuro** vía `.dark` en `<html>`, persistido en
  `localStorage.fiba_dark`. Default actual: dark (ver
  `DESIGN_SYSTEM.md` para por qué).

### Git / commits

- Convención: **type prefix** (`feat:`, `fix:`, `docs:`, `design:`,
  `ops:`, `security:`) + descripción corta + cuerpo opcional con
  detalles. Ver `git log` para el patrón.

- **No amend** — siempre commits nuevos (pre-commit hooks pueden
  fallar y dejar el repo en estado raro).

- **No push --force a main.** Si hay que reescribir historia, en
  branch nuevo.

---

## 🩺 Cómo está la salud del sistema

Pen-test cerrado en mayo 2026 (3 rondas). H1-H9 + N1, N2, N3 cerrados.
Pendientes manuales (ver `SECURITY_RUNBOOK.md`):

- **N4** (HTTP 500 → 400 en filter de dominio) — necesita Supabase Pro
- **N5/N6** (SPF/DMARC/CAA en `fibaamericascloud.com`) — pendiente
- **N7** (Cloudflare WAF + ocultar IP origen) — decisión pendiente
- **N8** (rate limits en Supabase Auth) — pendiente

Hay scanner horario corriendo en `/var/log/fiba-security-alerts.log`
(via cron `/etc/cron.d/fiba-security-scan`).

---

## 🎨 Trabajo de UI / diseño

Hay un **design system completo** activo desde mayo 2026:
- Navy (`#0c2340`) + basketball orange (`#F57C2A`) + ink neutrals
- IBM Plex Sans + IBM Plex Mono
- Componentes en `src/components/{ui,layout,brand}/`
- Iconos Tabler en `src/lib/icons.jsx`

**Antes de tocar colores/clases, leer `DESIGN_SYSTEM.md`.** Tiene la
explicación del truco de CSS variables para los aliases legacy
`fiba-*` que los hace dark-aware sin tocar JSX.

---

## 🎯 Si te piden algo

- **"Agregá un módulo nuevo"** → router en `api/_lib/routers/X.py`,
  mount en `api/index.py`, página en `src/pages/X.jsx`, ruta en
  `App.jsx`, icono en el map `moduleIcon`, permiso en `user_permissions`.

- **"Tocá el Muro"** (feed) → punto 18: `can_view` publica, `can_edit`
  modera. No le pongas `require_edit` a publicar/comentar/reaccionar.

- **"Tocá algo de plata"** (budget, payments, fees) → leé `BUDGET_MODULE.md`
  primero: es el contrato del módulo y se actualiza en el mismo PR. Checklist
  corto: `_scoped()` en toda query nueva de budget, la migración aplicada a mano
  ANTES del push, y si tocás la imputación de un pago acordate de que son dos
  (fee y pasaje, puntos 15 a 17). Además:
  - Un cambio de estado nuevo es una **fila en la tabla de transiciones** de la
    función pura (`check_expense_transition` / `check_payment_transition`), con
    su test y su fila en BUDGET_MODULE.md §14 — nunca un `status` en un
    PATCH/PUT (punto 23).
  - Si el evento le importa a alguien, `notify()` en el mismo handler
    (best-effort, con el autor en `exclude`); si es "algo que espera una
    acción", va como pendiente calculado en `notifications.py`, no como fila
    (punto 24).
  - Todo export de budget sale de la misma función que la pantalla y pasa por
    `_scoped()`: el Excel no puede traer nada que la tabla no muestre. Los
    `.xlsx` nuevos usan `services/xlsx_utils.py` (`safe_text` contra fórmulas,
    `no-store`).

- **"Cambiá el deploy"** → modificá `.github/workflows/deploy.yml`. Hay
  un user en el droplet llamado `fiba` con clave SSH agregada via
  `DROPLET_SSH_KEY` secret.

- **"Probá un cambio en el droplet"** → `ssh fiba`, navegá a
  `/opt/fiba-nominations`, podés correr el venv directamente con
  `./venv/bin/python` o reiniciar el servicio.

- **"Hay algo lento"** → `ssh fiba sudo journalctl -u fiba-api`,
  buscar P99 en gunicorn logs. La DB es Supabase Free → puede tener
  rate limits.

---

## 🚫 Cosas que NO hacer

- ❌ Asumir que está en Vercel (ya no — droplet DO).
- ❌ Llamar al bucket `nominations` como público (es privado, siempre
  vía service_role en el backend).
- ❌ Generar las cartas de nominación vía CloudConvert (deshabilitado;
  usar LibreOffice local via `document_generator.py`). El único uso vivo
  de CloudConvert hoy es el export de training schedule (`training.py`).
- ❌ Borrar registros directamente con SQL si tocan storage — usar
  el endpoint que llama a Storage API (`_delete_pdf_from_storage`).
- ❌ Confundir `personnel` con `employees` (TDs/VGOs vs staff interno).
- ❌ Escribir una query en `budget.py` sin `_scoped()` — es un P0 (punto 16).
- ❌ "Corregir" el Muro poniéndole `require_edit` a publicar o comentar: ahí
  `can_view` participa y `can_edit` modera, a propósito (punto 18).
- ❌ Imputar el pasaje de un pago a la cuenta de fees (punto 15).
- ❌ Pushear código que usa una migración de Budget sin haberla aplicado antes
  a mano en Supabase (punto 17).
- ❌ Cambiar el `status` de un gasto o de un pago por PATCH/PUT, o aceptar un
  alta que no nazca `draft` / `new`: solo por `/transition` (punto 23).
- ❌ "Corregir" `/budget/expenses/{id}/transition` o `/approve` agregándoles
  `require_edit`: el aprobador puede no tener `can_edit`, y el permiso lo
  decide la transición (punto 16).
- ❌ Exponer `personnel_banking` por `personnel.py`, o pasar `/reveal` o la
  descarga del W-8 a GET (dejarían de quedar en el activity log) (punto 25).
- ❌ Mandarle `bank_info` / `tax_id` de un proveedor a alguien que no es admin
  general de budget, ni en un GET ni en la respuesta de un PATCH (punto 16).
