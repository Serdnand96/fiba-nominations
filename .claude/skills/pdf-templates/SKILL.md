---
name: pdf-templates
description: Estructura de generación de documentos y PDFs en fiba-nominations — templates .docx con placeholders docxtpl (Jinja2-en-Word), conversión a PDF con LibreOffice headless (soffice), y los dos caminos separados (cartas de nominación vs export de training schedule). Usar al tocar templates o formato de documentos generados.
---

# Generación de documentos / PDFs (fiba-nominations)

> ⚠️ **El stack NO es WeasyPrint.** No hay templates HTML ni WeasyPrint en el
> repo. La generación real es **python-docx + docxtpl** (placeholders estilo
> Jinja2 embebidos en archivos `.docx`) y la conversión a PDF la hace
> **LibreOffice headless** (`soffice --headless --convert-to pdf`) en el
> droplet. CloudConvert quedó como fallback opcional (deshabilitado para las
> cartas). Dependencias reales: `python-docx`, `docxtpl` (ver
> `requirements.txt`).

Hay **dos caminos de PDF completamente separados**.

---

## Camino 1 — Cartas de nominación/confirmación

Código: `api/_lib/services/document_generator.py`. Es el camino principal y el
más elaborado.

### Templates

- Archivos `.docx` en `templates/`: `WCQ`, `GENERIC`, `BCLA`, `LSB`.
  - Las variantes **`*_TPL.docx`** son las de placeholders `docxtpl`
    (preferidas). Las `.docx` "planas" son para los builders posicionales
    legacy (fallback).
- `TEMPLATE_SPECS` mapea `template_key → {file, context}`. `spec_for(key)`
  resuelve primero los built-in y después **tipos custom** creados desde la UI
  (tabla `letter_templates`, con `.docx` subido a Storage).

### Cómo se arma una carta

- `generate_nomination(data)` → `_build_doc()` despacha por `template_key`:
  - WCQ/GENERIC → `_render_template(path, _letter_context(...))` si hay `_TPL`,
    si no cae al builder posicional (`_build_wcq_letter`, etc.).
  - BCLA (variantes `F4`/`RS`) → `_bcla_context`; LSB → `_lsb_context`.
- Los **context builders** (`_letter_context`, `_bcla_context`, `_lsb_context`)
  producen el diccionario que se inyecta en el template. Valores posibles:
  - **strings planos** → tag `{{ campo }}`
  - **`RichText`** (runs con color/negrita/fuente/tamaño) → tag `{{r campo }}`
  - **listas** (p.ej. `game_dates`, `payment_lines`) → loop
    `{%p for item in campo %}{{r item }}{%p endfor %}`
- `_render_template()` usa `docxtpl.DocxTemplate(path).render(context)` y
  devuelve algo con `.save(path)`, igual que un `Document`.
- **Aliases legacy:** `LEGACY_FIELD_ALIASES` + `with_legacy_aliases()` mantienen
  funcionando nombres viejos de placeholders (`dear_line → greeting`, etc.), así
  un `.docx` descargado con nombres antiguos sigue renderizando.

### Constantes de marca (respetalas)

- Colores: `COLOR_DARK = #2A2A2A`, `COLOR_RED = #ED0000` (`RED_HEX`/`DARK_HEX`).
- Fuentes: **IBM Plex Sans** (WCQ), **Univers** (GENERIC/BCLA).
- `ROLE_LABELS` (TD→"Technical Delegate", VGO→"Video Graphic Operator", …),
  `CONFIRMATION_EMAIL` (por rol) y `SIGNATORIES` (por template_key).
- Fechas: `_fmt_date` ("17 April 2026"), `_fmt_deadline` ("January 18th, 2026").
- Fees: `_fee_lines()` respeta `fee_type` (`per_game` × nº de juegos, o
  `tournament`) + incidentals.

### Conversión a PDF

- `_convert_to_pdf(docx_path)`:
  - Si `USE_LOCAL_LIBREOFFICE=1` → intenta `_convert_to_pdf_libreoffice()`
    (`soffice`/`libreoffice`, perfil de usuario por-llamada para evitar locks,
    timeout 90s). En el droplet esta es la vía real.
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
  (detecta errores de sintaxis Jinja y placeholders desconocidos).
- `generate_preview(key)` / `generate_preview_from_bytes()` → renderizan una
  carta de muestra (`PREVIEW_SAMPLE`) sin tocar DB ni Storage.
- `placeholders_for(key)` → lista los placeholders disponibles con su tag exacto
  y un ejemplo, para mostrar en la UI.

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

## Al modificar una carta — checklist

1. Editá el `.docx` `_TPL` con los tags (`{{ }}`, `{{r }}`, `{%p for %}`).
2. Agregá/ajustá el valor en el context builder correspondiente.
3. Registrá keys nuevos en `TEMPLATE_SPECS` si aplica.
4. Validá con `generate_preview(template_key)` y revisá el PDF resultante
   (membrete, firma al pie, colores de marca, fechas en formato largo).
5. Si tocás nombres de placeholder, actualizá `LEGACY_FIELD_ALIASES` para no
   romper `.docx` ya subidos.
