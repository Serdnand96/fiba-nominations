---
name: fiba-excel-format
description: Mapeo de columnas y reglas de parsing/matching de los imports de planilla de fiba-nominations — el formato Excel multi-sport de FIBA del Training Schedule (training.py) y el import de roster de personnel (bulk_import.py). Usar para cualquier cambio de parsing/validación de Excel o CSV.
---

# Formatos de import — Excel/CSV (fiba-nominations)

Hay **dos importers distintos**. No los confundas: viven en archivos separados,
tienen formatos distintos y alimentan tablas distintas.

| Import | Código | Endpoint | Tabla destino |
|--------|--------|----------|---------------|
| Training Schedule (multi-sport FIBA) | `api/_lib/routers/training.py::_parse_fiba_schedule` | `POST /api/training/import/excel` y `/import/preview` | `training_slots` |
| Roster de personnel | `api/_lib/services/bulk_import.py::process_bulk_import` | `POST /api/personnel/import` | `personnel` |

---

## 1) Training Schedule — formato multi-sport de FIBA (el principal)

Formato **específico de FIBA multi-sport**, NO un Excel genérico. Se parsea con
`openpyxl` (`load_workbook(..., data_only=True)`, hoja activa) recorriendo las
filas con un estado `current_date` que se va actualizando.

### Reglas de parsing (fila por fila)

1. **Fila de fecha (header):** si alguna de las **primeras 3 columnas** contiene
   el texto `"FECHA"` (case-insensitive, trim), la fecha es la **siguiente celda
   no vacía** dentro de las columnas `i+1 .. i+4`.
   - `datetime` → se formatea `%Y-%m-%d`.
   - `str` → se usa tal cual (trim).
   - Las filas **antes** de la primera fila `FECHA` se ignoran (`current_date`
     todavía es `None`).
2. **Hora de inicio:** se lee de la **columna C (índice 2)**.
   - `datetime` → `%H:%M`.
   - `str` → se parsea `HH:MM` o `HH:MM:SS`, validando `0 ≤ h ≤ 23` y
     `0 ≤ m ≤ 59`.
   - Se saltean celdas vacías, filas con `"PARTIDOS"`, y cualquier valor que no
     parsee como hora (`"Comienza"`, `"DIA"`, headers, etc.).
3. **Hora de fin:** calculada como **inicio + 90 minutos** (no se lee de la
   planilla).
4. **Labels de equipo / cancha:** se leen por índice de columna, tolerando
   varios layouts:
   - **Venue `"Estadio"`:** columnas índice **5 o 7**.
   - **Venue `"Cancha de Entrenamiento"`:** columna índice **8**.
   - Se **excluyen** los valores que son headers/ruido:
     `"Estadio"`, `"Cancha de Entrenamiento"`, `"PARTIDOS"`, `"Comienza"`.
   - Cada celda con un label válido genera un slot (una fila puede producir
     varios slots: Estadio y Cancha).

### Slot resultante

```python
{
  "competition_id": <str>,   # viene del form, no de la planilla
  "date": current_date,      # "YYYY-MM-DD"
  "start_time": "HH:MM",
  "end_time": "HH:MM",       # inicio + 90 min
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
- Las horas de fin son fijas (90 min): si FIBA cambia la duración, es acá.
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
