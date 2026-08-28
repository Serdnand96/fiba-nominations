// Identidad y orden de una competencia.
//
// El nombre solo NO alcanza para identificarla. En la base conviven seis pares
// de competencias con el `name` literalmente idéntico, que sólo se distinguen
// por el año:
//
//   LSB – Group A   → 2026 y 2027   (mismo short_name: "LSB Gr.A")
//   LSB – Group B/C/D, LSB – Finals, LSBF – Finals → idem
//
// Son competencias distintas de verdad: crew distinto, nominaciones distintas,
// fees distintos. Pero los ocho `<select>` que hay repartidos por la app
// (Budget ×6, Training, Nominations) renderizaban `{c.name}` pelado, así que
// mostraban dos renglones indistinguibles. En Budget eso significa imputar un
// pago al año equivocado sin que nada avise.
//
// El parche que existía era manual y a medias: a UNA fila le habían escrito
// "LSB Finals 27" a mano en el short_name. Por eso la desambiguación se deriva
// acá, de datos que ya están en la fila, en vez de pedirle a quien carga las
// competencias que le meta el año al nombre.

// ── Tipos de competencia ────────────────────────────────────────────────────
//
// Registro único. Antes esta lista estaba duplicada y hardcodeada en dos
// pantallas —Calendar.jsx y Availability.jsx— y las dos habían quedado
// desactualizadas: ninguna incluía 'Other', pese a que el modal de alta del
// calendario sí lo ofrecía con un <option> suelto. Resultado: 12 de las 74
// competencias no se podían filtrar en ningún lado y se pintaban con el gris
// de fallback.
//
// Tiene que coincidir con el CHECK de competitions.competition_type
// (migración 042). Un tipo que exista en la base y no esté acá vuelve a caer
// en el mismo agujero.
export const COMPETITION_TYPES = [
  { key: 'BCLA', label: 'BCLA', color: '#185FA5' },
  { key: 'WCQ', label: 'WCQ', color: '#3B6D11' },
  { key: 'LSB', label: 'LSB', color: '#534AB7' },
  { key: 'LSBF', label: 'LSBF', color: '#993556' },
  { key: 'WBLA', label: 'WBLA', color: '#BA7517' },
  { key: 'AmeriCup', label: 'AmeriCup', color: '#993C1D' },
  { key: 'U-Series', label: 'U-Series', color: '#0F6E56' },
  // Campeonatos de zona: Centrobasket, Sudamericano, CBC, COCABA. No son el
  // clasificatorio de AmeriCup, pero tampoco son misceláneos.
  { key: 'Zonal', label: 'Zonal', color: '#0E6C8C' },
  // El Mundial de mayores en sí. WCQ significa Qualifiers: es el camino, no el
  // torneo.
  { key: 'WC', label: 'WC', color: '#7B2D8E' },
  // Lo que de verdad no entra en ninguna familia. Neutro a propósito: son 3 y
  // no tienen por qué competir por atención con los demás.
  { key: 'Other', label: 'Other', color: '#5A6270' },
  // El CHECK lo permite desde antes, pero hoy no lo usa ninguna competencia:
  // va sin pill para no dejar un filtro permanentemente vacío. El color se
  // define igual, así que si algún día aparece una no sale en gris.
  { key: '3x3', label: '3x3', color: '#6B7A12', hidden: true },
]

/** Los que se ofrecen en filtros y en el alta. */
export const SELECTABLE_COMPETITION_TYPES = COMPETITION_TYPES.filter(t => !t.hidden)

const TYPE_COLORS = Object.fromEntries(COMPETITION_TYPES.map(t => [t.key, t.color]))

/** Color del tipo. Gris neutro si es uno que este build no conoce. */
export function competitionTypeColor(type) {
  return TYPE_COLORS[type] || '#6B7280'
}

// Fallback en inglés. Las pantallas pasan `t('months.short')` para que la
// etiqueta siga el idioma activo; los pocos usos sin contexto de i18n (tests,
// helpers) caen acá.
const MONTHS_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Las fechas de la fila son 'YYYY-MM-DD' sin zona. `new Date('2026-10-02')` las
// interpreta como UTC y en zonas negativas devuelve el día anterior; con el
// 'T00:00:00' se parsean como hora local, que es lo que ya hace Calendar.jsx.
function parseDay(iso) {
  if (!iso) return null
  const d = new Date(iso + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * El año de la competencia. `year` es la columna autoritativa (una competencia
 * TBD la tiene aunque no tenga fechas); `start_date` es sólo el respaldo.
 * @returns {number|null}
 */
export function competitionYear(comp) {
  if (!comp) return null
  if (comp.year) return Number(comp.year)
  const d = parseDay(comp.start_date)
  return d ? d.getFullYear() : null
}

/**
 * Período compacto, para colgar del nombre en un selector: "Oct 2026".
 *
 * Contempla los tres casos que hay en los datos:
 *   - un solo mes            → "Oct 2026"
 *   - dos meses del mismo año → "Jun–Jul 2026"
 *   - a caballo de dos años   → "Dec 2026 – Jan 2027"  (BCLA Season 8 arranca
 *     en diciembre y sigue en enero; mostrar sólo "2026" ahí confunde más de
 *     lo que aclara)
 *
 * @param {object} comp
 * @param {string[]} [monthsShort] nombres de mes abreviados (t('months.short'))
 * @returns {string|null}
 */
export function competitionPeriod(comp, monthsShort = MONTHS_SHORT_EN) {
  if (!comp) return null
  const year = competitionYear(comp)
  const start = parseDay(comp.start_date)

  // Sin fechas confirmadas el año sigue siendo el dato útil: es lo que separa
  // la LSB de 2026 de la de 2027.
  if (comp.is_tbd || !start) return year ? `TBD ${year}` : 'TBD'

  const end = parseDay(comp.end_date) || start
  const sy = start.getFullYear()
  const ey = end.getFullYear()
  const sm = monthsShort[start.getMonth()]
  const em = monthsShort[end.getMonth()]

  if (sy !== ey) return `${sm} ${sy} – ${em} ${ey}`
  if (start.getMonth() !== end.getMonth()) return `${sm}–${em} ${sy}`
  return `${sm} ${sy}`
}

/**
 * Rango de días: "2–4 Oct" o, con `{ year: true }`, "2–4 Oct 2026".
 *
 * El año se incluye igual aunque haya un encabezado de grupo arriba: es
 * justamente el dato que separa dos filas por lo demás idénticas, y no puede
 * depender de hasta dónde scrolleó quien mira.
 *
 * @returns {string|null} null si la competencia es TBD
 */
export function competitionDateRange(comp, monthsShort = MONTHS_SHORT_EN, { year = false } = {}) {
  if (!comp) return null
  const start = parseDay(comp.start_date)
  if (comp.is_tbd || !start) return null
  const end = parseDay(comp.end_date) || start
  const sm = monthsShort[start.getMonth()]
  const em = monthsShort[end.getMonth()]
  const sy = start.getFullYear()
  const ey = end.getFullYear()

  // A caballo de dos años hay que poner los dos, o "9 Dec – 14 Jan 2027" se
  // lee como si el 9 de diciembre fuera de 2027.
  if (sy !== ey) {
    return year
      ? `${start.getDate()} ${sm} ${sy} – ${end.getDate()} ${em} ${ey}`
      : `${start.getDate()} ${sm} – ${end.getDate()} ${em}`
  }

  const suffix = year ? ` ${sy}` : ''
  if (start.getMonth() === end.getMonth()) {
    return start.getDate() === end.getDate()
      ? `${start.getDate()} ${sm}${suffix}`
      : `${start.getDate()}–${end.getDate()} ${sm}${suffix}`
  }
  return `${start.getDate()} ${sm} – ${end.getDate()} ${em}${suffix}`
}

/**
 * Etiqueta desambiguada, la que va en todo `<option>` y en cualquier lugar
 * donde una competencia se nombre fuera de su contexto de año.
 *   "LSB – Group A · Oct 2026"
 */
export function competitionLabel(comp, monthsShort = MONTHS_SHORT_EN) {
  if (!comp) return ''
  const name = comp.name || comp.short_name || '—'
  const period = competitionPeriod(comp, monthsShort)
  return period ? `${name} · ${period}` : name
}

/**
 * Orden cronológico. El endpoint ya ordena así, pero las listas que se arman o
 * se concatenan en el cliente necesitan el mismo criterio para no alternar
 * entre dos órdenes distintos según de dónde vengan los datos.
 */
export function compareCompetitions(a, b) {
  const ya = competitionYear(a) ?? 9999
  const yb = competitionYear(b) ?? 9999
  if (ya !== yb) return ya - yb

  const ma = a?.month || 13
  const mb = b?.month || 13
  if (ma !== mb) return ma - mb

  // Lo TBD va al final de su mes, no al principio: ordenando los strings con el
  // null adelante, lo indefinido quedaba arriba de lo ya confirmado.
  const sa = a?.start_date || '9999-99-99'
  const sb = b?.start_date || '9999-99-99'
  if (sa !== sb) return sa < sb ? -1 : 1

  return (a?.name || '').localeCompare(b?.name || '')
}

/** Copia ordenada cronológicamente. No muta el array recibido. */
export function sortCompetitions(list) {
  return [...(list || [])].sort(compareCompetitions)
}

/** Años presentes en la lista, de menor a mayor. Sin los que no tienen año. */
export function competitionYears(list) {
  const years = new Set()
  for (const c of list || []) {
    const y = competitionYear(c)
    if (y) years.add(y)
  }
  return [...years].sort((a, b) => a - b)
}

/**
 * Agrupa por año, ya ordenado. Devuelve [{ year, items }].
 * Las competencias sin año caen en un grupo `year: null` al final.
 */
export function groupCompetitionsByYear(list) {
  const groups = new Map()
  for (const c of sortCompetitions(list)) {
    const y = competitionYear(c)
    if (!groups.has(y)) groups.set(y, [])
    groups.get(y).push(c)
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] ?? 9999) - (b[0] ?? 9999))
    .map(([year, items]) => ({ year, items }))
}
