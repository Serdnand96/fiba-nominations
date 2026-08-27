# LSB — texto y formato de la carta de confirmación

> Qué texto lleva la carta de LSB, sobre qué papel, y por qué el starter de los
> tipos `confirmation` dejó de ser el suyo.
>
> Fuentes (27 agosto 2026, entregadas por el usuario):
> - `LSB-format.docx` → **`templates/LSB_TEMPLATE.docx`** (el membrete)
> - `text-format.pdf` → **`templates/LSB_LETTER_REFERENCE.pdf`** (el texto aprobado)

---

## TL;DR

El **texto nunca estuvo mal**: ya salía palabra por palabra igual al PDF que
aprobó el cliente. Lo que faltaba era el **contenedor**. Hasta agosto 2026 LSB era
el único template que se armaba *desde cero* en código y salía sobre papel en
blanco: sin membrete, sin footer y con la firma como una línea de texto plano.

Ahora se genera desde `LSB_TEMPLATE.docx` —logos de Liga Sudamericana y FIBA en
el header, footer gráfico, y el bloque de firma de Gino Rullo dentro del
archivo— con el cuerpo en Univers.

Efecto colateral que hay que tener presente: esa `_TPL` era también el punto de
partida de todo tipo `confirmation` creado desde la UI. Ese rol pasó a
`GENERIC_CONFIRMATION_TPL.docx` (papel en blanco), porque si no cada tipo nuevo
arrancaría con el logo de la Liga Sudamericana encima. Ver 3.3.

---

## 1. El texto, bloque por bloque

Transcripción literal de `LSB_LETTER_REFERENCE.pdf` (los valores concretos son
del caso de ejemplo: Fabio Ramón Martinez Acevedo, TD, LSB – Group A).

| # | Bloque | Texto renderizado | Formato | Placeholder en el `.docx` | Origen del valor |
|---|--------|-------------------|---------|---------------------------|------------------|
| 1 | Título | `Confirmation – LSB – Group A 2027` | negrita, ~14pt, izquierda | `{{ heading }}` | `f"Confirmation – {competition_name} {competition_year}"` |
| 2 | — | *(línea en blanco)* | | | |
| 3 | Saludo | `Dear ` + `Fabio Ramón Martinez Acevedo` + `,` | "Dear"/"," en tinta, **el nombre en rojo** `#ED0000` | `{{r greeting }}` | `_dear_line(data, font, size=10)` |
| 4 | — | *(línea en blanco)* | | | |
| 5 | Intro | `This letter confirms your assignment as Technical Delegate for the LSB – Group A.` | tinta, izquierda | texto fijo + `{{ role }}` + `{{ competition }}` | `_role_label(role)` / `competition_name` |
| 6 | — | *(línea en blanco)* | | | |
| 7 | Bullets | `  •  Location: Oliva, Argentina`<br>`  •  Venue: Polideportivo Independiente DSC`<br>`  •  Arrival Date: 29 September 2026`<br>`  •  Departure Date: 5 October 2026` | tinta; viñeta **literal** (`"  •  "` en el texto, no lista de Word) | 4 bloques `{%p if X %}` / `  •  Label: {{ X }}` / `{%p endif %}` | `location`, `venue`, `arrival_date`, `departure_date` — fechas por `_fmt_date` (`29 September 2026`) |
| 8 | — | *(línea en blanco)* | | | |
| 9 | Gamedays | `Gameday 1: 2 October 2026`<br>`Gameday 2: 3 October 2026`<br>`Gameday 3: 4 October 2026` | **centrado, rojo `#ED0000`, negrita, 10pt** | `{%p for game in game_dates %}` / `{{r game }}` / `{%p endfor %}` | `game_dates[].label` + `_fmt_date(date)` |
| 10 | — | *(línea en blanco)* | | | |
| 11 | Intro de pago | `Below list the details of payment you will receive as Technical Delegate assigned to the competition listed above:` | tinta, izquierda | texto fijo + `{{ role }}` | — |
| 12 | — | *(línea en blanco)* | | | |
| 13 | Fees | `Per Game Fee: $800`<br>`Incidentals: $100`<br>**`Total: $2500`** | **rojo `#ED0000`**, izquierda; sólo el `Total` en negrita | `{%p for fee in payment_lines %}` / `{{r fee }}` / `{%p endfor %}` | `_fee_lines(data)` — labels por default (`Per Game Fee`/`Tournament Fee`, `Incidentals`, `Total`) |
| 14 | — | *(línea en blanco)* | | | |
| 15 | Cierre | `Thank you for your commitment and professionalism.` | tinta, izquierda | texto fijo | — |
| 16 | Firma | `Respectfully,` + la firma manuscrita + `Gino Rullo` / `Head of Operations` / `Club Competitions – FIBA Americas` / `+1 305 393-6646` / el mail | 12pt; la firma en *Cochocib Script Latin Pro* 36pt azul | **ninguno** — está en el `.docx` | el membrete |

**Cosas que la carta NO lleva** (y no es un olvido): no hay línea de fecha
arriba a la derecha (a diferencia de WCQ/GENERIC/BCLA), no hay párrafo de
travel y no hay párrafo bancario. El `Respectfully,` no sale de ningún
placeholder: viene con el membrete.

La fila 16 es la única que cambió respecto del PDF de referencia, y es una
mejora: ahí la firma era una línea de texto plano, `Gino Rullo Head of
Operations Club Competitions – FIBA Americas`, todo seguido.

### La etiqueta del fee depende de `fee_type`

`_fee_label()` imprime `Per Game Fee` cuando `competitions.fee_type = 'per_game'`
y `Tournament Fee` cuando es `'tournament'`. El PDF de referencia es un caso
`per_game` con 3 gamedays: `$800 × 3 + $100 = $2500`. **No hardcodear "Per Game
Fee"** al mover el texto.

---

## 2. El membrete: `templates/LSB_TEMPLATE.docx`

Estructura real del archivo (41 párrafos, 1 sección, sin tablas):

| Párrafos | Contenido |
|---|---|
| `[0]`–`[32]` | **33 párrafos vacíos** — el hueco donde va el cuerpo |
| `[33]` | `Respectfully,` (12pt) |
| `[34]` | vacío |
| `[35]` | ` Gino Rullo` — firma manuscrita, **Cochocib Script Latin Pro 36pt**, azul |
| `[36]`–`[40]` | `Gino Rullo` / `Head of Operations` / `Club Competitions – FIBA Americas` / `+1 305 393-6646` / `gino.rullo@bclamericas.basketball` (hyperlink `mailto:`) |

- **Header** con logo **Liga Sudamericana de Baloncesto** + logo **FIBA** (`image1.png`,
  `image2.png`, `image3.png`, en `header2.xml` / `header3.xml`).
- **Footer** con banda gráfica y `p. <PAGE>`.
- Fondo con estrellas amarillas al margen izquierdo.
- Fuente base del membrete: **Univers 12pt** (la firma manuscrita aparte).

---

## 3. Qué se hizo (27 agosto 2026 — implementado)

Las tres decisiones del usuario: **Univers**, **starter fuera de LSB**, y
**corregir el comentario que mentía**. Están las tres.

### 3.1 LSB dejó de armarse desde cero

`SPECS["LSB"]` en `scripts/build_letter_templates.py` pasó de
`{"scratch": True}` a un spec con archivo base: `LSB_TEMPLATE.docx`,
`body_start: 0`, `LSB_BODY`. El camino `build()` sobreescribe la franja de
párrafos entre el arranque del cuerpo y la firma, y **borra los blancos
sobrantes** — de los 33 vacíos del membrete se usaron 32.

El cuerpo es el de la sección 1, sin cambiarle una palabra, y **sin
`{{ signature }}`**: el bloque de firma (Respectfully, + la firma manuscrita +
las líneas de contacto) ya viene en el `.docx`.

Dos ajustes a `build()`, que hasta ahora sólo servía a WCQ y GENERIC:

- **`sig_start()`**, extraída como función. Localizaba el bloque de firma por la
  última imagen del cuerpo; LSB no tiene ninguna (la firma es texto en *Cochocib
  Script Latin Pro* y los logos viven en el header), así que ahora acepta un
  `sig_marker` con el texto de la línea donde frenar. Sin esto el script muere
  con `no signature image found after the body start`.
- **negrita**, para el título. Se prende **sólo** cuando la línea está en el
  `bold` del spec: asignar `run.bold = False` escribiría un `<w:b w:val="0">`
  explícito en cada run, pisando el estilo en vez de heredarlo, y reescribiría
  WCQ y GENERIC sin motivo.

Las otras tres `_TPL.docx` se regeneran **byte por byte idénticas** a lo que
había — está verificado comparando entrada por entrada del zip contra `HEAD`.

### 3.2 Univers

`_lsb_context(data, font)` recibe `FONT_GENERIC` en los dos puntos de entrada de
LSB (`_build_lsb` y `TEMPLATE_SPECS["LSB"]`), y el `.docx` se construye con
`"font": "Univers"`. Cuerpo 10pt, título 14pt bold, el bloque de firma del
membrete intacto en sus 12pt.

**`spec_for()` quedó en `FONT_WCQ` a propósito**: esa rama es la de los tipos
`confirmation` creados desde la UI, que imprimen en su propio membrete. Cambiarles
la fuente habría sido un efecto colateral que nadie pidió.

> **Dato incómodo que apareció verificando:** el droplet **no tiene ninguna de
> las dos fuentes**. `fc-match` de "Univers" y de "IBM Plex Sans" cae en DejaVu
> Sans, así que el PDF que recibe el nominado sale en la fallback — con Univers y
> con IBM Plex por igual, y desde antes de este cambio. La fuente del `.docx`
> igual importa: es lo que ve quien lo abre en Word. Si alguna vez importa que el
> PDF salga en la tipografía de marca, hay que instalar las fuentes en el droplet;
> es un tema aparte de esto.

### 3.3 El starter salió de LSB

Un tipo `confirmation` creado desde la UI se renderiza con **`_lsb_context`**, así
que sus placeholders son los de esta carta. Por eso el starter **no podía ser
BCLA**, que lleva otros tags (`payment_intro`, `banking_paragraph`, `letter_date`):
habría dado una carta con la mitad de los campos vacíos.

El starter nuevo es **`templates/GENERIC_CONFIRMATION_TPL.docx`**: exactamente la
forma que tenía `LSB_TEMPLATE_TPL.docx` antes de este cambio — papel en blanco,
mismos tags— generada por la misma función de siempre, ahora llamada
`build_confirmation_starter()`. Queda simétrico con `GENERIC_TEMPLATE_TPL.docx`,
el starter de las nominaciones.

**Bug que se arregló de paso:** el starter escribía `{{ signature }}`, pero
`spec_for()` pasa el firmante del tipo custom como `signature_line`, y
`with_legacy_aliases` no pisa una clave ya presente. Resultado: **todo tipo custom
de confirmación firmaba "Gino Rullo Head of Operations Club Competitions – FIBA
Americas"**, ignorando el firmante cargado por el usuario. El starter ahora escribe
`{{ signature_line }}`.

Para que LSB no siga ofreciendo en la UI un placeholder que ya no usa,
`_lsb_context` tomó un parámetro `signature: bool = True`; LSB lo llama con
`signature=False`. Los tipos custom lo siguen recibiendo.

### 3.4 Cómo se verificó

- `python scripts/build_letter_templates.py` regenera las cinco.
- `validate_template()` sobre las cuatro cartas: las cuatro `ok=True`, y LSB sin
  `unknown` ni `unused` (o sea: no quedó ningún tag sin dato ni ningún dato sin
  tag).
- Se renderizó **el caso exacto de `LSB_LETTER_REFERENCE.pdf`** (Fabio Ramón
  Martinez Acevedo, TD, LSB – Group A, 3 gamedays, $800 + $100 = $2500) y se
  comparó run por run: texto idéntico, nombre y fees en `ED0000`, gamedays
  centrados en rojo bold, el resto en `2A2A2A`.
- Sobrevive el membrete: las 3 imágenes, los 3 headers, los 3 footers, el
  hyperlink `mailto:` y las 8 líneas del bloque de firma.
- **La conversión final se probó con el LibreOffice del droplet**, que es el mismo
  que corre en producción (`soffice` 24.2.7.2) — Quick Look sirve para mirar pero
  ignora el margen superior y hace creer que el título pisa el logo. Con `soffice`
  entra en una página, con el título limpio debajo del logo. Los temporales del
  droplet se borraron; no se tocó el servicio.

---

## 4. Archivos

| Archivo | |
|---|---|
| `templates/LSB_TEMPLATE.docx` | **nuevo** — el membrete (era `~/Downloads/LSB-format.docx`) |
| `templates/LSB_TEMPLATE_TPL.docx` | **regenerado** — ahora sobre el membrete |
| `templates/GENERIC_CONFIRMATION_TPL.docx` | **nuevo** — starter de `confirmation`, papel en blanco |
| `templates/LSB_LETTER_REFERENCE.pdf` | **nuevo** — la carta de referencia del cliente |
| `scripts/build_letter_templates.py` | `LSB_BODY`, spec de LSB, `sig_start()`, negrita, `build_confirmation_starter()` |
| `api/_lib/services/document_generator.py` | Univers + `signature=False` en LSB; comentarios viejos corregidos |
| `api/_lib/routers/templates.py` | `STARTER_FOR_KIND["confirmation"]` + el comentario que mentía |
| `.claude/skills/pdf-templates/SKILL.md` | el starter y los dos usos de `_lsb_context` |
| `.claude/agents/pdf-specialist.md` | fuentes por template + la fallback del droplet |
| `CLAUDE.md`, `LSB_LETTER_SPEC.md` | esto |

`BCLA_TEMPLATE_TPL.docx`, `GENERIC_TEMPLATE_TPL.docx` y `WCQ_TEMPLATE_TPL.docx`
**no** aparecen en el diff: se regeneran idénticas y se restauraron desde `HEAD`
para no ensuciar el PR con metadata de zip.
