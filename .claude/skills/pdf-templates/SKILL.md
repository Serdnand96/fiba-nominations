---
name: pdf-templates
description: Estructura de generación de documentos en fiba-nominations — templates .docx con placeholders docxtpl (Jinja2-en-Word), tags simples `{{ campo }}` + alias en español para plantillas subidas desde la UI (LetterTemplate), fuentes de marca vía fonts/fonts.conf + fonts_report, conversión a PDF con LibreOffice headless (soffice), los dos caminos de PDF (cartas de nominación vs export de training schedule) y el export Excel del Game & Practice Schedule (openpyxl, sin conversión). Usar al tocar templates o formato de documentos generados.
---

# Generación de documentos / PDFs (fiba-nominations)

> ⚠️ **El stack NO es WeasyPrint.** No hay templates HTML ni WeasyPrint en el
> repo. La generación real es **python-docx + docxtpl** (placeholders estilo
> Jinja2 embebidos en archivos `.docx`) y la conversión a PDF la hace
> **LibreOffice headless** (`soffice --headless --convert-to pdf`) en el
> droplet. CloudConvert quedó como fallback opcional (deshabilitado para las
> cartas). Dependencias reales: `python-docx`, `docxtpl` (ver
> `requirements.txt`).

Hay **dos caminos de PDF completamente separados**, más un **tercer camino que
genera Excel** (no PDF) para el Game & Practice Schedule.

---

## Camino 1 — Cartas de nominación/confirmación

Código: `api/_lib/services/document_generator.py`. Es el camino principal y el
más elaborado.

### Templates

- Archivos `.docx` en `templates/`: `WCQ`, `GENERIC`, `BCLA`, `LSB`.
  - Las variantes **`*_TPL.docx`** son las de placeholders `docxtpl`
    (preferidas). Las `.docx` "planas" son el membrete de origen, del que
    `scripts/build_letter_templates.py` genera la `_TPL`; los builders
    posicionales legacy quedan solo como fallback.
  - **`GENERIC_CONFIRMATION_TPL.docx` no es una carta de nadie.** Es el punto de
    partida que se le entrega a un tipo `confirmation` creado desde la UI
    (`STARTER_FOR_KIND` en `routers/templates.py`). Es papel en blanco a
    propósito: hasta agosto 2026 el starter era el de LSB, y desde que LSB tiene
    membrete propio eso le estamparía el logo de la Liga Sudamericana —y la
    firma de Gino Rullo— a la competencia de otro.
- `TEMPLATE_SPECS` mapea `template_key → {file, context}`. `spec_for(key)`
  resuelve primero los built-in y después **tipos custom** creados desde la UI
  (tabla `letter_templates`, con `.docx` subido a Storage).

### Cómo se arma una carta

- `generate_nomination(data)` → `_build_doc()` despacha por `template_key`:
  - WCQ/GENERIC → `_render_template(path, _letter_context(...))` si hay `_TPL`,
    si no cae al builder posicional (`_build_wcq_letter`, etc.).
  - BCLA (variantes `F4`/`RS`) → `_bcla_context`; LSB → `_lsb_context`.
  - `_lsb_context` sirve **dos** casos: la carta de LSB, que pasa
    `signature=False` porque su membrete ya trae el bloque de firma, y los tipos
    `confirmation` creados desde la UI, que sí reciben `signature` y además
    `signature_line` con su propio firmante.
- Los **context builders** (`_letter_context`, `_bcla_context`, `_lsb_context`)
  producen el diccionario que se inyecta en el template. Valores posibles:
  - **strings planos** → tag `{{ campo }}`
  - **`RichText`** (runs con color/negrita/fuente/tamaño) → tag `{{r campo }}`
  - **listas** (p.ej. `game_dates`, `payment_lines`) → loop
    `{%p for item in campo %}{{r item }}{%p endfor %}`
- `_render_template()` usa `docxtpl.DocxTemplate(path).render(context)` y
  devuelve algo con `.save(path)`, igual que un `Document`.
- **La carta de nominación tiene dos formas, según `fee_type`** (flag
  `is_tournament` en el contexto; los `*_TPL.docx` de WCQ/GENERIC traen ambas
  ramas con `{%p if is_tournament %}`):
  - **per_game** → la forma histórica: lista de juegos centrada en rojo +
    línea de sede, fees a la izquierda tras dos líneas en blanco, cierre
    "...of your assignment.", 5 blancos antes de la firma.
  - **tournament** → espeja las cartas manuales de Competitions: línea de
    asunto en negrita (`subject`), UNA oración de intro con sede y rango de
    fechas del torneo en negrita (`intro_paragraph`, rango = min/max de
    `game_dates` vía `_fmt_date_range`, sin lista de juegos), rol
    "FIBA Technical Delegate" en la confirmación, párrafo de viajes con
    "at least 3 days before the game" + contacto de
    logistics.americas@fiba.basketball (`travel_paragraph`), fees centradas
    tras un blanco, cierre "...of your mission." (`closing_paragraph`) y la
    firma pegada al cierre.
  Los párrafos de intro/viajes/cierre ya no son texto fijo del `.docx`: son
  placeholders que resuelve `_letter_context`. El email de confirmación de TD
  es `competitions.americas@fiba.basketball` (con punto — el guion viejo era
  un typo).
- **Aliases legacy:** `LEGACY_FIELD_ALIASES` + `with_legacy_aliases()` mantienen
  funcionando nombres viejos de placeholders (`dear_line → greeting`, etc.), así
  un `.docx` descargado con nombres antiguos sigue renderizando. Un `.docx`
  subido con la forma vieja (texto fijo + loop de juegos) sigue renderizando
  igual que antes — las ramas nuevas solo existen en los built-ins hasta que
  se re-suba.
- **WCQ no repite el título en modo torneo.** `WCQ_TEMPLATE.docx`'s párrafo
  `[0]` ya trae fijo "Nomination for the FIBA World Cup 2027 Qualifiers" sobre
  el logo; `scripts/build_letter_templates.py::nomination_body(subject=False)`
  para WCQ omite el bloque `{%p if is_tournament %}{{r subject }}…{%p endif %}`
  que las demás cartas sí llevan (GENERIC no tiene título fijo propio, así que
  mantiene `subject=True`). Si volvés a generar los `_TPL` y ves un cambio en
  algo que no sea WCQ, pará: la comparación párrafo a párrafo de
  GENERIC/BCLA/LSB/GENERIC_CONFIRMATION contra `HEAD` tiene que dar idéntica.

### Tags simples y alias en español (para plantillas subidas desde la UI)

Diseñar una plantilla a mano en Word — saber cuándo hace falta `{{r x }}` en
vez de `{{ x }}`, armar el loop `{%p for %}` de una lista — es la parte que un
usuario sin contexto técnico no puede hacer. Dos mecanismos lo evitan:

- **`{{ campo }}` alcanza para todo, incluidos los valores styled.**
  `LetterTemplate` (subclase de `DocxTemplate`, definida en
  `document_generator.py`) sobreescribe `patch_xml()`: corre las dos primeras
  regexes de `DocxTemplate.patch_xml` de docxtpl 0.20.2 (las que dejan un tag
  partido por Word como una cadena limpia), reescribe cada `{{ nombre }}`
  suelto —resuelto por `_template_name_map()`— a `{{r nombre_real }}` cuando el
  valor es `RichText`, o a `{{ nombre_real }}` cuando es plano, y recién ahí
  llama a `super().patch_xml()` (que es la que convierte `{{r x }}` en el
  empalme de XML `<w:r>` que RichText necesita). `{{r campo }}` y los
  `{%p for %}` existentes siguen funcionando igual: esto solo agrega la forma
  simple, nunca saca la avanzada. `_render_template()` calcula
  `richtext_names` y el name-map del contexto ya con alias antes de instanciar
  `LetterTemplate`; `validate_template()` hace lo mismo para que `used`
  (`get_undeclared_template_variables()`) ya vea nombres normalizados.
- **`FRIENDLY_ALIASES`** (dict en español → nombre real: `saludo→greeting`,
  `partidos→game_list`, `honorarios→fees_block`, `firma→signature`, etc.) se
  suma a `with_legacy_aliases()` — mismo mecanismo que `LEGACY_FIELD_ALIASES`
  pero pensado para mostrarse en la UI (`placeholders_for()`'s `"aliases"`),
  no solo para tolerar uploads viejos.
- **`game_list` / `fees_block` / `details_block`**: además de las listas de
  siempre (`game_dates`, `payment_lines` — loop `{%p for %}`), los tres
  contextos (`_letter_context`, `_bcla_context`, `_lsb_context`) exponen la
  versión "una sola línea de texto con el field completo": un único `RichText`
  con todas las líneas separadas por `"\n"` — docxtpl convierte ese `\n`
  literal en `<w:br/>` al renderizar (`resolve_listing()` en
  `docxtpl/template.py`, corre siempre, no solo con un filtro `listing`), así
  que el resultado son varias líneas dentro del mismo párrafo del usuario, con
  la alineación que ese párrafo ya tenga. `game_list`/`fees_block` existen en
  los tres; `details_block` (Location/Venue/Arrival/Departure, solo las líneas
  no vacías) solo en `_bcla_context`/`_lsb_context`, porque `_letter_context`
  no tiene esos campos. `_richtext_block()` es el helper compartido.

### Contexto unificado para tipos creados desde la UI

`spec_for()` para una key que no es built-in ya no separa el contexto por
`kind`: siempre arma `{**_lsb_context(d, font), **_letter_context(d, font)}`
(letter pisa lo compartido) más `heading` (que solo trae lsb) y
`signature_line` (el firmante propio del tipo, distinto de `signature`, que
queda como fallback genérico de FIBA Americas). `kind` (`nomination` /
`confirmation`) ya **no** limita qué placeholders existen — solo decide la
fuente (`FONT_GENERIC` / `FONT_WCQ`) y qué starter le entrega
`STARTER_FOR_KIND` a un tipo recién creado. Antes de este cambio un tipo
`nomination` no tenía `location`/`venue` y uno `confirmation` no tenía
`subject`/`travel_paragraph`, sin que la UI explicara por qué.

### Constantes de marca (respetalas)

- Colores: `COLOR_DARK = #2A2A2A`, `COLOR_RED = #ED0000` (`RED_HEX`/`DARK_HEX`).
- Fuentes: **IBM Plex Sans** (WCQ), **Univers** (GENERIC/BCLA/LSB).
- `ROLE_LABELS` (TD→"Technical Delegate", VGO→"Video Graphic Operator", …),
  `CONFIRMATION_EMAIL` (por rol) y `SIGNATORIES` (por template_key).
- Fechas: `_fmt_date` ("17 April 2026"), `_fmt_deadline` ("January 18th, 2026").
- Fees: `_fee_lines()` respeta `fee_type` (`per_game` × nº de juegos, o
  `tournament`) + incidentals.

### Fuentes: ninguna está instalada en el droplet

Univers, IBM Plex Sans, Cochocib Script Latin Pro y Titillium no existen en el
sistema del droplet — sin nada más, `fc-match` cae en DejaVu Sans (más ancha:
títulos partidos, firma en cuatro líneas, footer cortado). Arreglado a nivel
fontconfig, no de código:

- `fonts/` tiene TTFs libres (IBM Plex Sans, IBM Plex Sans Condensed, Alex
  Brush, Titillium Web) y `fonts/fonts.conf` con `<alias>` que mapean cada
  fuente de marca a su sustituto libre (`Univers → Nimbus Sans`, `Cochocib
  Script Latin Pro → Alex Brush`, etc. — comentado ahí mismo). `fonts/private/`
  (gitignored) es donde irían las fuentes con licencia si FIBA las entrega
  algún día; como llevan `<accept>` y no `<prefer>`, ganan solas si aparecen.
- `_convert_to_pdf_libreoffice()` le pasa `FONTCONFIG_FILE=<repo>/fonts/fonts.conf`
  al `subprocess.run` de `soffice` cuando ese archivo existe — la sustitución
  queda scopeada a esa conversión, no toca fontconfig del sistema ni depende
  del `HOME` del usuario del servicio.
- `fonts_report(docx_bytes_or_path) -> list[dict]` (nuevo): lee las familias
  declaradas (`w:rFonts w:ascii` de document.xml/styles.xml/headers/footers,
  ignorando Symbol/Wingdings/Courier/Times New Roman) y para cada una corre
  `fc-match -f '%{family}' "<familia>"` con el mismo `FONTCONFIG_FILE`.
  Devuelve `{"family", "status": "ok"|"substituted"|"missing"|"unknown",
  "substitute"}` — `substituted` si `fonts.conf` tiene un `<alias>` deliberado
  para esa familia (se eligió el reemplazo), `missing` si cae en otra cosa
  (nadie lo eligió), `unknown` si `fc-match` no existe (Mac de desarrollo) sin
  romper nada. Cacheado por familia con `functools.lru_cache`.
  `GET /templates` lo expone como `"fonts"` por template (built-in o custom
  con archivo activo; `[]` si un custom no tiene archivo), y
  `POST /{key}/upload` lo devuelve para el archivo recién subido, antes de
  activarlo.
- La fuente del `.docx` sigue importando igual: es lo que ve quien lo abre en
  Word. `fonts_report` es sobre el PDF que sale del droplet, no sobre eso.

### Conversión a PDF

- `_convert_to_pdf(docx_path)`:
  - Si `USE_LOCAL_LIBREOFFICE=1` → intenta `_convert_to_pdf_libreoffice()`
    (`soffice`/`libreoffice`, perfil de usuario por-llamada para evitar locks,
    timeout 90s, `FONTCONFIG_FILE` seteado — ver arriba). En el droplet esta es
    la vía real.
  - Si falla y hay `CLOUDCONVERT_API_KEY` → fallback a CloudConvert; si no,
    devuelve el error.
- Si la conversión falla, el pipeline devuelve el **`.docx`** y un
  `conversion_error` (tupla `(path, storage_url, conversion_error)`). No lo
  silencies: el frontend informa el fallback.

### Upload

- La carta generada se sube al bucket **privado** `nominations` y se referencia
  como `storage://nominations/...` (ver skill `api-conventions` para el manejo
  de storage). Nunca se sirve por URL pública.

### Soporte de la UI de Templates

- `validate_template(key, bytes)` → chequea que un `.docx` subido renderiza
  (detecta errores de sintaxis Jinja y placeholders desconocidos), usando
  `LetterTemplate` (no `DocxTemplate` a secas) para que `used` ya vea nombres
  normalizados por alias.
- `generate_preview(key)` / `generate_preview_from_bytes()` → renderizan una
  carta de muestra (`PREVIEW_SAMPLE`) sin tocar DB ni Storage.
  `generate_preview_for_data(data)` es la versión de la que ambas son un caso
  particular: recibe un dict de letter-data ya armado (no necesariamente de
  `PREVIEW_SAMPLE`) y usa `data["template_key"]` para decidir el render.
- `placeholders_for(key)` → lista los placeholders disponibles: `{"name",
  "kind": "styled"|"plain"|"list", "tag": "{{ name }}", "aliases": [...],
  "example", "advanced": bool}`. El `tag` de un valor styled o plano es
  **siempre** `{{ name }}` — la `r` la agrega `LetterTemplate` al renderizar,
  no hace falta pedirla. Las listas (`game_dates`, `payment_lines`) llevan
  `tag`/`tag_extra` de loop y `advanced: true`; `signature_gap` no se lista
  (solo importa su longitud). Orden: primero un conjunto fijo de campos no
  avanzados (fecha, título, saludo, cuerpo, fees, firma — ver
  `_PLACEHOLDER_ORDER`), después el resto alfabético, después los avanzados.
- `POST /{key}/duplicate` (`require_edit`, en `routers/templates.py`): crea un
  tipo nuevo copiando el `.docx` **activo** de otro (built-in o custom) como
  archivo activo del nuevo — sin paso de staging, porque el archivo copiado ya
  es una carta real que funciona. `kind` sale del origen, no del body; el
  firmante es el del body si se manda algo, si no el del origen (elección
  entera, no campo por campo). Pensado para "quiero esta misma carta para otro
  firmante" sin escribir tags desde cero.
- `GET /{key}/preview?nomination_id=<uuid>`: en vez de `PREVIEW_SAMPLE`, trae
  una fila real de `nominations` (join `personnel(name, role, email),
  competitions(name, template_key, year, fee_type)`), la pasa por
  `letter_data_for()` (`routers/nominations.py`) y le pisa `template_key` con
  la `key` de la URL antes de renderizar — "cómo se vería la carta de esta
  persona con esta otra plantilla". No sube nada a Storage ni toca la
  nominación. Exige además `nominations:view` (chequeado con `has_view()`, no
  `require_view()`, porque solo gobierna esta rama del endpoint, no
  `templates:view` del resto).

### Gotchas

- Los **builders posicionales** (`_build_wcq_letter`, `_build_generic_letter`,
  `_build_bcla_letter`) direccionan párrafos por índice (`paras[2]`, `paras[4]`…)
  y **descartan contenido en silencio** si el `.docx` cambia de layout. Preferí
  siempre los `_TPL` con placeholders.
- Los párrafos que mezclan tintas (el saludo "Dear <nombre>," con el nombre en
  rojo, la línea de confirmación) se arman como `RichText` en el código, **no**
  como texto en el `.docx`, porque docxtpl parte el run alrededor del insert.

---

## Camino 2 — Export de training schedule

Código: `api/_lib/routers/training.py::_generate_schedule_pdf`.

- Arma un documento con **python-docx desde cero** (título + una tabla con
  Date/Start/End/Venue/Team/Assigned TDs), no usa templates.
- Convierte con un **`_convert_to_pdf` propio del router que usa CloudConvert
  ÚNICAMENTE** (`engine: libreoffice` del lado de CloudConvert). Si no hay
  `CLOUDCONVERT_API_KEY`, **sirve el `.docx`** en vez del PDF.
- ⚠️ Este camino **no** tiene la rama `USE_LOCAL_LIBREOFFICE` del camino 1: es
  una inconsistencia conocida. Si querés PDF local acá, hay que portar la lógica
  de `document_generator._convert_to_pdf`.

---

## Camino 3 — Game & Practice Schedule (Excel, sin conversión)

Código: `api/_lib/services/schedule_workbook.py`, servido por
`training.py::export_schedule_xlsx` (`GET /training/export/schedule-xlsx`).

- Genera el **cronograma combinado de partidos + entrenamientos** replicando el
  template Excel oficial de FIBA (bloques por día, columnas Estadio / Sede de
  Entrenamiento, divisor PARTIDOS ámbar, labels "DÍA DE PARTIDO ±N" /
  "DÍA DE DESCANSO" / sufijos de fase, columna COMENTARIOS alimentada con los
  `notes` de los slots).
- **Escribe `.xlsx` directo con openpyxl** y lo sirve como bytes — no pasa
  por LibreOffice ni CloudConvert. (No es el único Excel del backend:
  Logística exporta manifest y rooming con openpyxl también —
  `logistics_import.py::export_manifest_xlsx` / `export_rooming_xlsx`.)
  Importante: el `soffice` del droplet **no tiene el filtro de Calc**
  (solo convierte `.docx`), así que cualquier futuro xlsx→pdf requeriría
  instalar `libreoffice-calc`.
- Dos capas puras y testeables sin DB: `build_schedule_header()` +
  `build_schedule_days()` arman la representación intermedia desde filas de
  `competitions`/`game_schedule`/`training_slots`, y
  `build_schedule_workbook()` la renderiza a bytes.
- Permisos: el endpoint cuelga del router training (`require_view("training")`)
  **y además** declara `require_view("games")` porque cruza datos del módulo
  games.
- i18n: `lang=es|en` (labels en `LABELS`); los overrides `main_venue` /
  `training_venue` completan las cajas SEDE del header.

---

## Al modificar una carta — checklist

1. Editá el `.docx` `_TPL` con los tags. En los `_TPL` del repo seguí usando
   `{{ }}` / `{{r }}` / `{%p for %}` explícitos, como hasta ahora — la
   reescritura automática de `LetterTemplate` es para lo que sube un usuario
   desde la UI, no cambia cómo se mantienen estos archivos versionados.
2. Agregá/ajustá el valor en el context builder correspondiente
   (`_letter_context`/`_bcla_context`/`_lsb_context`) — si es un campo nuevo
   que tiene sentido en más de un contexto, considerá agregarlo a los tres.
3. Registrá keys nuevos en `TEMPLATE_SPECS` si aplica. Si agregás un alias en
   español, sumalo a `FRIENDLY_ALIASES` (no solo a `LEGACY_FIELD_ALIASES`,
   que es para nombres viejos, no nuevos).
4. Validá con `generate_preview(template_key)` y revisá el PDF resultante
   (membrete, firma al pie, colores de marca, fechas en formato largo). Si
   tocaste `scripts/build_letter_templates.py`, comparé párrafo a párrafo
   contra `HEAD` los `_TPL` que NO debían cambiar — un cambio inesperado ahí
   es un bug, no una curiosidad.
5. Si tocás nombres de placeholder, actualizá `LEGACY_FIELD_ALIASES` para no
   romper `.docx` ya subidos.
