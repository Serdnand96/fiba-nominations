import { useMemo, useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'

// Workload matrix: one row per official (TD/VGO), month columns across the top,
// and nomination / game-day totals next to the name. Cells are heat-shaded by
// how many nominations landed in that month.
//
// - A nomination is bucketed into the month of its earliest valid game date
//   (falling back to arrival_date, then letter_date).
// - "Game days" per nomination = number of valid entries in its game_dates array
//   (the actual days officiated). Nominations without game_dates count as 0 days.
//
// Reuses the data already loaded by the Nominations page — no extra API calls.

const ymKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`
const DATE_RE = /^\d{4}-\d{2}-\d{2}/

function validGameDates(n) {
  const arr = Array.isArray(n.game_dates) ? n.game_dates : []
  return arr
    .map(g => g && g.date)
    .filter(d => typeof d === 'string' && DATE_RE.test(d))
    .sort()
}

export default function NominationsMatrix({ nominations, personnel }) {
  const { t, lang } = useLanguage()

  const now = new Date()
  const [mode, setMode] = useState('rolling') // 'rolling' | 'calendar'
  const [year, setYear] = useState(now.getFullYear())
  const [roleFilter, setRoleFilter] = useState('') // '' | 'TD' | 'VGO'
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const locale = lang === 'es' ? 'es-ES' : 'en-US'
  const monthLabel = (y, m) =>
    new Date(y, m - 1, 1).toLocaleString(locale, { month: 'short' })

  // Pre-compute per-nomination bucket info once.
  const nomInfo = useMemo(() => nominations.map(n => {
    const gd = validGameDates(n)
    const primary = gd[0] || n.arrival_date || n.letter_date || null
    return {
      personnel_id: n.personnel_id,
      primary,
      days: gd.length,
      monthKey: primary ? primary.slice(0, 7) : null,
    }
  }), [nominations])

  // Years present in the data (for the calendar-year selector).
  const years = useMemo(() => {
    const s = new Set([now.getFullYear()])
    nomInfo.forEach(i => { if (i.primary) s.add(Number(i.primary.slice(0, 4))) })
    return [...s].sort((a, b) => b - a)
  }, [nomInfo])

  // Column definitions ({ y, m }) for the selected window.
  const columns = useMemo(() => {
    if (mode === 'calendar') {
      return Array.from({ length: 12 }, (_, i) => ({ y: year, m: i + 1 }))
    }
    // Rolling: the 12 months ending with the current month.
    const cy = now.getFullYear()
    const cm = now.getMonth() + 1
    const cols = []
    for (let i = 11; i >= 0; i--) {
      let m = cm - i
      let y = cy
      while (m <= 0) { m += 12; y -= 1 }
      cols.push({ y, m })
    }
    return cols
  }, [mode, year])

  const colKeys = useMemo(() => columns.map(c => ymKey(c.y, c.m)), [columns])
  const colKeySet = useMemo(() => new Set(colKeys), [colKeys])

  // Build one row per matching official.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const built = personnel
      .filter(p => !roleFilter || p.role === roleFilter)
      .filter(p => !q || (p.name || '').toLowerCase().includes(q))
      .map(p => {
        const cells = {} // monthKey -> { noms, days }
        let noms = 0
        let days = 0
        for (const info of nomInfo) {
          if (info.personnel_id !== p.id) continue
          if (!info.monthKey || !colKeySet.has(info.monthKey)) continue
          noms += 1
          days += info.days
          const c = cells[info.monthKey] || { noms: 0, days: 0 }
          c.noms += 1
          c.days += info.days
          cells[info.monthKey] = c
        }
        return { id: p.id, name: p.name, role: p.role, cells, noms, days }
      })
      .filter(r => showInactive || r.noms > 0)
    built.sort((a, b) => b.noms - a.noms || b.days - a.days || a.name.localeCompare(b.name))
    return built
  }, [personnel, nomInfo, colKeySet, roleFilter, search, showInactive])

  // Heatmap scaling + footer totals.
  const { maxCell, colTotals, grand } = useMemo(() => {
    let maxCell = 1
    const colTotals = colKeys.map(() => ({ noms: 0, days: 0 }))
    const grand = { noms: 0, days: 0 }
    rows.forEach(r => {
      grand.noms += r.noms
      grand.days += r.days
      colKeys.forEach((k, idx) => {
        const c = r.cells[k]
        if (!c) return
        if (c.noms > maxCell) maxCell = c.noms
        colTotals[idx].noms += c.noms
        colTotals[idx].days += c.days
      })
    })
    return { maxCell, colTotals, grand }
  }, [rows, colKeys])

  function cellStyle(count) {
    if (!count) return undefined
    const intensity = count / maxCell
    const alpha = 0.14 + 0.56 * intensity
    return { backgroundColor: `rgba(245, 124, 42, ${alpha.toFixed(3)})` }
  }

  const roleTabs = [
    { key: '', label: t('nominations.matrixRoleAll') },
    { key: 'TD', label: 'TD' },
    { key: 'VGO', label: 'VGO' },
  ]

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* Window mode */}
        <div className="inline-flex rounded-lg border border-fiba-border overflow-hidden">
          {[
            { key: 'rolling', label: t('nominations.matrixRolling') },
            { key: 'calendar', label: t('nominations.matrixCalendar') },
          ].map(o => (
            <button key={o.key} onClick={() => setMode(o.key)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === o.key
                  ? 'bg-fiba-accent text-white'
                  : 'text-fiba-muted hover:text-ink-900 dark:hover:text-white'
              }`}>
              {o.label}
            </button>
          ))}
        </div>

        {mode === 'calendar' && (
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="fiba-select !w-auto">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        )}

        {/* Role filter */}
        <div className="inline-flex rounded-lg border border-fiba-border overflow-hidden">
          {roleTabs.map(o => (
            <button key={o.key} onClick={() => setRoleFilter(o.key)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                roleFilter === o.key
                  ? 'bg-fiba-accent text-white'
                  : 'text-fiba-muted hover:text-ink-900 dark:hover:text-white'
              }`}>
              {o.label}
            </button>
          ))}
        </div>

        <input type="text" placeholder={t('nominations.searchPerson')} value={search}
          onChange={e => setSearch(e.target.value)} className="fiba-input w-full md:w-56" />

        <label className="flex items-center gap-2 text-sm text-fiba-muted cursor-pointer">
          <input type="checkbox" checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)} className="rounded" />
          {t('nominations.matrixShowInactive')}
        </label>
      </div>

      {/* Matrix */}
      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-navy-50 dark:bg-navy-800 text-navy-900 dark:text-ink-100">
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wider font-semibold min-w-[160px]">
                  {t('nominations.name')}
                </th>
                <th className="px-2 py-3 text-center text-xs uppercase tracking-wider font-semibold border-l border-fiba-border" title={t('nominations.matrixNoms')}>
                  {t('nominations.matrixNomsShort')}
                </th>
                <th className="px-2 py-3 text-center text-xs uppercase tracking-wider font-semibold border-r border-fiba-border" title={t('nominations.matrixDays')}>
                  {t('nominations.matrixDaysShort')}
                </th>
                {columns.map(c => (
                  <th key={ymKey(c.y, c.m)} className="px-1 py-2 text-center text-[11px] font-semibold w-12">
                    <div className="capitalize">{monthLabel(c.y, c.m)}</div>
                    <div className="text-fiba-muted font-normal">'{String(c.y).slice(-2)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-ink-100 dark:border-navy-800 hover:bg-ink-50 dark:hover:bg-navy-800/40 transition-colors">
                  <td className="px-4 py-2 text-ink-900 dark:text-ink-100">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${r.role === 'VGO' ? 'bg-purple-400' : 'bg-emerald-400'}`} />
                      <span className="truncate">{r.name}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-center font-semibold text-ink-900 dark:text-white border-l border-fiba-border">
                    {r.noms}
                  </td>
                  <td className="px-2 py-2 text-center font-semibold text-ink-900 dark:text-white border-r border-fiba-border">
                    {r.days}
                  </td>
                  {colKeys.map(k => {
                    const c = r.cells[k]
                    return (
                      <td key={k} style={cellStyle(c?.noms)}
                        title={c ? t('nominations.matrixCellTitle', { noms: c.noms, days: c.days }) : ''}
                        className="px-1 py-2 text-center text-ink-900 dark:text-ink-100">
                        {c ? c.noms : ''}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3 + columns.length} className="px-4 py-8 text-center text-fiba-muted/60">
                    {t('nominations.matrixEmpty')}
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-fiba-border bg-navy-50/60 dark:bg-navy-800/60 font-semibold text-ink-900 dark:text-white">
                  <td className="px-4 py-2">{t('nominations.matrixTotalsRow')}</td>
                  <td className="px-2 py-2 text-center border-l border-fiba-border">{grand.noms}</td>
                  <td className="px-2 py-2 text-center border-r border-fiba-border">{grand.days}</td>
                  {colTotals.map((ct, idx) => (
                    <td key={colKeys[idx]} className="px-1 py-2 text-center text-fiba-muted">
                      {ct.noms || ''}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
