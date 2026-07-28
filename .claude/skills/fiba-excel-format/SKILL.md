---
name: fiba-excel-format
description: Mapeo de columnas y reglas de parsing/matching de los imports de planilla de fiba-nominations — el formato Excel multi-sport de FIBA del Training Schedule (training.py), el import de roster de personnel (bulk_import.py) y los imports de logística, flight manifest y rooming list (logistics_import.py). Usar para cualquier cambio de parsing/validación de Excel o CSV.
---

# Formatos de import — Excel/CSV (fiba-nominations)

Hay **tres importers distintos**. No los confundas: viven en archivos separados,
tienen formatos distintos y alimentan tablas distintas.

| Import | Código | Endpoint | Tabla destino |
|--------|--------|----------|---------------|
| Training Schedule (multi-sport FIBA) | `api/_lib/routers/training.py::_parse_fiba_schedule` | `POST /api/training/import/excel` y `/import/preview` | `training_slots` |
| Roster de personnel | `api/_lib/services/bulk_import.py::process_bulk_import` | `POST /api/personnel/import` | `personnel` |
| Logística (flight manifest + rooming list) | `api/_lib/services/logistics_import.py` | `POST /api/logistics/import/{manifest,rooming}/{preview,commit}` | `logistics_participants`, `logistics_travel_legs`, `logistics_stays` |

---

## 1) Training Schedule — planillas FIBA (el principal)

Soporta **dos layouts** de FIBA (2026-07): el **multi-sport** clásico y el
**Game & Practice Schedule** (p.ej. AmeriCup SA Qualifier). Se parsea con
`openpyxl` (`load_workbook(..., data_only=True)`, hoja activa) recorriendo las
filas con estado `current_date` + `in_partidos`.

### Reglas de parsing (fila por fila)

1. **Fila de fecha (header):** si alguna de las **primeras 3 columnas** contiene
   el texto `"FECHA"` (case-insensitive, trim):
   - **Layout multi-sport:** la fecha está en la siguiente celda no vacía de
     `i+1 .. i+4`, como `datetime` o string parseable (`%Y-%m-%d`, `%d/%m/%Y`,
     `%d-%m-%Y`, `%d/%m/%y`). Strings que NO parsean como fecha se ignoran (ya
     no se usan "tal cual" — antes metían labels como fecha).
   - **Layout Game & Practice:** si la fila FECHA no trae fecha, se busca un
     valor fecha en la **columna A de las 2 filas siguientes** (ahí vive la
     fecha del bloque en ese template).
   - La fila FECHA además **resetea la sección PARTIDOS** (ver punto 3).
   - Las filas antes de la primera fecha resuelta se ignoran.
2. **Hora de inicio:** columna C (índice 2). Acepta `datetime`,
   **`datetime.time`** (celdas de hora reales — así vienen en el Game &
   Practice) y strings `HH:MM`/`HH:MM:SS` (`0 ≤ h ≤ 23`, `0 ≤ m ≤ 59`). Celdas
   vacías o no-hora (`"Comienza"`, headers) saltean la fila.
3. **Sección PARTIDOS:** una celda `"PARTIDOS"` en columna C activa
   `in_partidos` y **se saltea todo hasta la próxima fila FECHA** — esas filas
   son partidos (van al módulo games), no entrenamientos. Antes solo se
   salteaba la fila divisoria y los partidos podían colarse como slots.
4. **Hora de fin:** se lee de la **columna E (índice 4)** si parsea como hora y
   es mayor que el inicio; si no, fallback **inicio + 90 min** (con wrap
   módulo 24 h: `23:30 → 01:00`, nunca `25:00`).
5. **Labels de equipo / cancha:** por índice de columna:
   - **Venue `"Estadio"`:** columnas índice **5 o 7** (el índice 6 se omite a
     propósito: en el template Game & Practice esa columna suele arrastrar
     equipos basura de torneos anteriores).
   - **Venue `"Cancha de Entrenamiento"`:** columna índice **8**.
   - Se **excluyen** los valores que son headers/ruido:
     `"Estadio"`, `"Cancha de Entrenamiento"`, `"PARTIDOS"`, `"Comienza"`.
     Los `"TBC"` **sí** se importan (slot con equipo a confirmar).
   - Cada celda con un label válido genera un slot (una fila puede producir
     varios slots: Estadio y Cancha).

### Slot resultante

```python
{
  "competition_id": <str>,   # viene del form, no de la planilla
  "date": current_date,      # "YYYY-MM-DD" (siempre fecha real parseada)
  "start_time": "HH:MM",
  "end_time": "HH:MM",       # col E si existe; si no inicio + 90 min
  "venue": "Estadio" | "Cancha de Entrenamiento",
  "team_label": <str>,       # el texto de la celda
  "sport": <str>,            # del form, default "Basketball"
}
```

### Import vs. dedup

- Límites: solo `.xlsx`/`.xls`, **máx 5 MB** (413), `require_edit("training")`.
- Dedup al insertar (en `import_excel`): clave
  **`(competition_id, date, start_time, team_label)`**.
  - Si existe → `update` de `end_time`, `venue`, `sport`, `updated_at`
    (cuenta como `skipped`).
  - Si no existe → `insert` (cuenta como `imported`).
- `/import/preview` corre **el mismo** `_parse_fiba_schedule` sin insertar y
  devuelve `{ total, preview: slots[:10] }`.

### Gotchas al modificar

- `import_excel` y `preview_excel` **comparten** `_parse_fiba_schedule`: un
  cambio en el parser afecta a ambos — verificá los dos.
- Los índices de columna están **hardcodeados**; un off-by-one rompe el import
  en silencio (no tira error, simplemente no genera slots). Corré una planilla
  real de ejemplo antes/después de tocar índices.
- La hora de fin sale de la col E con fallback a inicio + 90 min: si FIBA
  cambia la duración por defecto, es acá.
- El parser es tolerante a errores por diseño: si `_parse_fiba_schedule` lanza,
  el endpoint devuelve 400 con un mensaje genérico (no filtra detalles del
  archivo).

---

## 2) Roster de personnel — CSV/XLSX simple (`bulk_import.py`)

Import genérico de oficiales. Detecta CSV vs XLSX por extensión.

### Mapeo de columnas (`COLUMN_MAP`, headers normalizados a lower/trim)

| Header (ES/EN) | Campo |
|----------------|-------|
| `nombre` / `name` | `name` |
| `email` | `email` |
| `país` / `pais` / `country` | `country` |
| `teléfono` / `telefono` / `phone` | `phone` |
| `pasaporte` / `passport` | `passport` |
| `rol` / `role` | `role` |

### Validación y matching

- Columnas **requeridas**: `name`, `email`, `role` (si falta alguna → error de
  columna faltante para todo el archivo).
- `email` debe matchear `EMAIL_REGEX`.
- `role` (upper) debe ser uno de:
  `VGO`, `TD`, `REF`, `REF_INSTRUCTOR`, `VIDEO_OPERATOR`.
- **Dedup por email** (case-insensitive) contra los emails ya existentes en
  `personnel` → los duplicados se cuentan como `skipped`.
- `country_code` se deriva del país libre con `name_to_code()` (los checks de
  neutralidad de árbitros matchean por este código; nombres no reconocidos
  quedan `NULL`).
- Filas con `name`/`email` vacío o `"nan"` → van a `errors` con el nº de fila
  (1-indexed + header).

Respuesta: `{ total, imported, skipped, errors: [{row, email, reason}] }`.

---

## 3) Logística — Flight Manifest y Rooming List (`logistics_import.py`)

Importers del módulo Logística (`api/_lib/services/logistics_import.py`),
expuestos en `api/_lib/routers/logistics.py`:

- `POST /api/logistics/import/manifest/preview` → `read_manifest()`
- `POST /api/logistics/import/manifest/commit` → `commit_manifest()`
- `POST /api/logistics/import/rooming/preview` → `read_rooming()`
- `POST /api/logistics/import/rooming/commit` → `commit_rooming()`

Reglas de diseño (distintas de los otros dos importers):

- **Dos pasos siempre**: el preview devuelve las filas clasificadas
  (*vinculado* / *revisar* / *nuevo*) y el commit recién escribe. El
  importador **nunca adivina**: un nombre dudoso se importa sin vincular y
  se reporta como warning (las planillas reales traen typos —
  `Guyo`/`Juyo`, `BUELVAS`/`Vuelvas` — y `Names`/`Last Name` invertidos en
  varias filas).
- **Matching difuso** contra `personnel` y `employees`
  (`_similarity` / `_possible_duplicate`).
- **Parseo tolerante** de fechas y horas (`parse_date` / `parse_time`).
- Alimenta `logistics_participants` (padrón), `logistics_travel_legs`
  (llegadas/salidas) y `logistics_stays` (hospedaje).
- También exporta: `export_manifest_xlsx()` / `export_rooming_xlsx()`
  (openpyxl directo, `GET /api/logistics/export/{manifest,rooming}.xlsx`).

El mapeo fino de columnas vive en `logistics_import.py` — **leelo antes de
tocar nada**; este resumen no reemplaza el código.
