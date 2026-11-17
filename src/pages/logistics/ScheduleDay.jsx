// Piezas del cronograma que no dependen de la sesión: las usan el panel
// interno (SchedulePanel) y la página pública, que no tiene ni toasts ni JWT.

export const hhmm = (t) => (t ? String(t).slice(0, 5) : '')

// Columnas propias de cada sección; el resto de la fila es igual en las dos.
export const SECTION_COLUMNS = {
  transport: [
    { key: 'pickup_time', es: 'Pick up hotel', en: 'Pick up hotel', time: true },
    { key: 'return_time', es: 'Return hotel', en: 'Return hotel', time: true },
  ],
  meals: [
    { key: 'lunch', es: 'Almuerzo', en: 'Lunch' },
    { key: 'snack', es: 'Merienda', en: 'Snack' },
    { key: 'dinner', es: 'Cena', en: 'Dinner' },
  ],
}

export function longDate(iso, lang) {
  if (!iso) return '—'
  return new Date(iso + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es' : 'en-US',
    { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

// Agrupa las filas por día, con el rótulo y las notas que trae el documento.
export function groupByDay(schedule) {
  const meta = Object.fromEntries((schedule.days || []).map(d => [d.date, d]))
  const dates = [...new Set([...(schedule.days || []).map(d => d.date), ...schedule.rows.map(r => r.date)])].sort()
  return dates.map(date => ({
    date,
    label: meta[date]?.label || '',
    notes: meta[date]?.notes || '',
    trainings: schedule.rows.filter(r => r.date === date && r.kind === 'training'),
    games: schedule.rows.filter(r => r.date === date && r.kind === 'game'),
  }))
}

export function cellValue(row, col) {
  return col.time ? hhmm(row[col.key]) : (row[col.key] || '')
}

// Tabla de un día. La comparten la vista interna, el preview del import y la
// página pública; `onEdit`/`onDelete` solo llegan cuando se puede editar.
export function ScheduleDay({ day, section, lang, onEdit, onDelete }) {
  const t = (es, en) => (lang === 'es' ? es : en)
  const cols = SECTION_COLUMNS[section]
  const editable = !!onEdit
  const span = cols.length + 3 + (editable ? 1 : 0)

  const actions = (row) => editable && (
    <td className="px-2 py-1.5 text-right whitespace-nowrap">
      <button onClick={() => onEdit(row)} className="text-xs text-fiba-accent hover:underline mr-2">{t('Editar', 'Edit')}</button>
      <button onClick={() => onDelete(row)} className="text-xs text-red-400 hover:underline">{t('Quitar', 'Remove')}</button>
    </td>
  )

  return (
    <div className="bg-fiba-card rounded-xl border border-fiba-border overflow-hidden">
      <div className="bg-fiba-surface px-4 py-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink-900 dark:text-white">
          {longDate(day.date, lang)}{day.label ? ` · ${day.label}` : ''}
        </span>
        {day.notes && <span className="text-xs text-fiba-muted italic">{day.notes}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="fiba-table">
          <thead>
            <tr>
              {cols.map(c => <th key={c.key}>{t(c.es, c.en)}</th>)}
              <th>{t('Comienzo', 'Start')}</th>
              <th>{t('Final', 'End')}</th>
              <th>{t('Equipo', 'Team')}</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {day.trainings.map((row, i) => (
              <tr key={row.id ?? `t${i}`}>
                {cols.map(c => <td key={c.key} className="px-4 py-1.5 text-xs font-mono font-semibold">{cellValue(row, c) || '—'}</td>)}
                <td className="px-4 py-1.5 text-xs font-mono">{hhmm(row.start_time) || '—'}</td>
                <td className="px-4 py-1.5 text-xs font-mono">{hhmm(row.end_time) || '—'}</td>
                <td className="px-4 py-1.5 text-xs font-medium">
                  {row.team || '—'}
                  {row.notes && <span className="block text-[11px] font-normal text-fiba-muted">{row.notes}</span>}
                </td>
                {actions(row)}
              </tr>
            ))}
            {day.games.length > 0 && (
              <tr>
                <td colSpan={span} className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-600 dark:text-amber-500">
                  {t('Partidos', 'Games')}
                </td>
              </tr>
            )}
            {day.games.map((row, i) => (
              <tr key={row.id ?? `g${i}`}>
                {cols.map(c => <td key={c.key} className="px-4 py-1.5 text-xs font-mono font-semibold">{cellValue(row, c) || '—'}</td>)}
                <td className="px-4 py-1.5 text-xs font-mono font-semibold" colSpan={2}>{hhmm(row.start_time) || '—'}</td>
                <td className="px-4 py-1.5 text-xs font-medium">
                  {row.team || '?'} <span className="text-fiba-muted font-normal">vs</span> {row.team_b || '?'}
                  {row.notes && <span className="block text-[11px] font-normal text-fiba-muted">{row.notes}</span>}
                </td>
                {actions(row)}
              </tr>
            ))}
            {day.trainings.length === 0 && day.games.length === 0 && (
              <tr><td colSpan={span} className="px-4 py-3 text-xs text-center text-fiba-muted">{t('Sin filas este día.', 'No rows this day.')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
