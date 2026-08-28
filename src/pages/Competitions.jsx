import { useState, useEffect, useMemo, Fragment } from 'react'
import { getCompetitions, createCompetition, updateCompetition, deleteCompetition, getNominations, getTemplates } from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/ui/Toast'
import { readLastSearch, writeLastSearch } from '../lib/lastSearch'
import {
  competitionYear, competitionYears, competitionDateRange, groupCompetitionsByYear,
} from '../lib/competitions'

const TEMPLATE_BADGES = {
  WCQ: 'bg-red-500/20 text-red-400',
  BCLA_F4: 'bg-blue-500/20 text-blue-400',
  BCLA_RS: 'bg-blue-500/20 text-blue-400',
  LSB: 'bg-amber-500/20 text-amber-400',
  GENERIC: 'bg-fiba-surface text-fiba-muted',
}

// Last search (text + template + year filter), persisted across visits — same
// pattern as Games. Restored synchronously as the initial state; los filtros de
// template y año se re-validan contra los datos una vez que cargan.
const LAST_SEARCH_KEY = 'fiba_competitions_last_search'

// El filtro de año usa 'all' para "todos" y `null` para "todavía no se eligió",
// que es lo que dispara el default al año en curso cuando cargan los datos.
const ALL_YEARS = 'all'

function loadLastSearch() {
  const parsed = readLastSearch(LAST_SEARCH_KEY)
  if (!parsed) return null
  return {
    search: typeof parsed.search === 'string' ? parsed.search : '',
    template: typeof parsed.template === 'string' ? parsed.template : '',
    year: parsed.year === ALL_YEARS ? ALL_YEARS
      : (Number.isFinite(parsed.year) ? parsed.year : null),
  }
}

export default function Competitions() {
  const { t } = useLanguage()
  const MONTHS_SHORT = t('months.short')
  const { hasEdit } = useAuth()
  const { push } = useToast()
  const canEdit = hasEdit('competitions')
  const [competitions, setCompetitions] = useState([])
  const [nominations, setNominations] = useState([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', template_key: 'WCQ', year: new Date().getFullYear(), fiba_games_url: '', fiba_window_code: '', fee_type: 'per_game', is_national_team: true })

  // Search & filter — restored from the persisted last search
  const [search, setSearch] = useState(() => loadLastSearch()?.search || '')
  const [filterTemplate, setFilterTemplate] = useState(() => loadLastSearch()?.template || '')
  const [filterYear, setFilterYear] = useState(() => loadLastSearch()?.year ?? null)

  useEffect(() => {
    // `null` es un estado transitorio (todavía no resolvió el default), no una
    // elección: guardarlo haría que la próxima visita vuelva a resolver sola.
    if (filterYear === null) return
    writeLastSearch(LAST_SEARCH_KEY, { search, template: filterTemplate, year: filterYear })
  }, [search, filterTemplate, filterYear])

  // Template types created on the Templates page — the built-ins are listed
  // statically in the select below.
  const [customTemplates, setCustomTemplates] = useState([])
  useEffect(() => {
    getTemplates()
      .then(list => setCustomTemplates(list.filter(x => !x.built_in)))
      .catch(() => setCustomTemplates([]))
  }, [])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [c, n] = await Promise.all([getCompetitions(), getNominations()])
      setCompetitions(c)
      setNominations(n)
      // Drop a restored template filter that no longer matches any competition,
      // so a stale value can't leave the list silently empty.
      setFilterTemplate(ft => (ft && !c.some(x => x.template_key === ft) ? '' : ft))
      // Mismo criterio para el año, más el default: sin elección previa se abre
      // en el año en curso, que es el que se está trabajando. Si ese año no
      // tiene competencias cargadas, cae al más cercano hacia adelante (recién
      // arrancado el año que viene, la lista útil es la del año que viene).
      const years = competitionYears(c)
      setFilterYear(fy => {
        if (fy !== null && fy !== ALL_YEARS && !years.includes(fy)) return ALL_YEARS
        if (fy !== null) return fy
        if (!years.length) return ALL_YEARS
        const current = new Date().getFullYear()
        return years.includes(current) ? current : (years.find(y => y > current) ?? years[years.length - 1])
      })
    } catch (err) {
      console.error('Load error:', err)
      push({ type: 'error', title: t('competitions.errorLoading') })
    } finally {
      setLoading(false)
    }
  }

  function nomCount(compId) {
    return nominations.filter(n => n.competition_id === compId).length
  }

  // Filtered competitions
  const filtered = useMemo(() => {
    return competitions.filter(c => {
      if (filterTemplate && c.template_key !== filterTemplate) return false
      if (filterYear !== null && filterYear !== ALL_YEARS && competitionYear(c) !== filterYear) return false
      if (search) {
        const q = search.toLowerCase()
        return (c.name || '').toLowerCase().includes(q)
          || (c.short_name || '').toLowerCase().includes(q)
          || (c.template_key || '').toLowerCase().includes(q)
          || String(c.year || '').includes(q)
      }
      return true
    })
  }, [competitions, search, filterTemplate, filterYear])

  // Agrupado por año. Con un solo año elegido queda un grupo, pero el
  // encabezado se muestra igual: es lo que dice de qué año es la lista.
  const groups = useMemo(() => groupCompetitionsByYear(filtered), [filtered])

  const templateOptions = useMemo(() =>
    [...new Set(competitions.map(c => c.template_key).filter(Boolean))].sort(),
    [competitions]
  )
  const yearOptions = useMemo(() => competitionYears(competitions), [competitions])

  // Cuántas competencias hay por año, para el contador de cada pill: sirve para
  // ver de un vistazo qué año está cargado y cuál todavía no.
  const countByYear = useMemo(() => {
    const counts = {}
    for (const c of competitions) {
      const y = competitionYear(c)
      if (y) counts[y] = (counts[y] || 0) + 1
    }
    return counts
  }, [competitions])

  function openCreate() {
    setEditing(null)
    setForm({ name: '', template_key: 'WCQ', year: new Date().getFullYear(), fiba_games_url: '', fiba_window_code: '', fee_type: 'per_game', is_national_team: true })
    setShowModal(true)
  }

  function openEdit(comp) {
    setEditing(comp)
    setForm({ name: comp.name, template_key: comp.template_key, year: comp.year || new Date().getFullYear(), fiba_games_url: comp.fiba_games_url || '', fiba_window_code: comp.fiba_window_code || '', fee_type: comp.fee_type || 'per_game', is_national_team: !!comp.is_national_team })
    setShowModal(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (saving) return  // evitar doble submit
    setSaving(true)
    try {
      if (editing) {
        await updateCompetition(editing.id, { ...form, year: parseInt(form.year) })
      } else {
        await createCompetition({ ...form, year: parseInt(form.year) })
      }
      setShowModal(false)
      await load()
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('common.error') })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(comp) {
    if (!confirm(t('competitions.confirmDelete', { name: comp.name }))) return
    try {
      await deleteCompetition(comp.id)
      await load()
    } catch (err) {
      if (err.response?.status === 409) {
        if (confirm(t('competitions.confirmForceDelete', { detail: err.response.data.detail }))) {
          await deleteCompetition(comp.id, true)
          await load()
        }
      } else {
        push({ type: 'error', title: err.response?.data?.detail || t('competitions.errorDeleting') })
      }
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-ink-900 dark:text-white">{t('competitions.title')}</h2>
        {canEdit && (
          <button onClick={openCreate} className="btn-fiba">
            {t('competitions.newCompetition')}
          </button>
        )}
      </div>

      {/* Year filter — arriba de todo porque es el corte principal: hay
          competencias con el mismo nombre en años distintos (LSB – Group A
          existe en 2026 y en 2027) y sin esto la lista las mezclaba. */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xs font-medium text-fiba-muted mr-1">{t('competitions.year')}</span>
        {yearOptions.map(y => (
          <button key={y} onClick={() => setFilterYear(y)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium tabular-nums transition-colors border ${
              filterYear === y
                ? 'bg-basketball-700 text-white border-basketball-700'
                : 'bg-fiba-surface text-fiba-muted border-fiba-border hover:bg-fiba-surface-2'
            }`}>
            {y}
            <span className={`ml-1.5 ${filterYear === y ? 'text-white/70' : 'text-fiba-muted/60'}`}>
              {countByYear[y]}
            </span>
          </button>
        ))}
        <button onClick={() => setFilterYear(ALL_YEARS)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
            filterYear === ALL_YEARS
              ? 'bg-basketball-700 text-white border-basketball-700'
              : 'bg-fiba-surface text-fiba-muted border-fiba-border hover:bg-fiba-surface-2'
          }`}>
          {t('competitions.allYears')}
        </button>
      </div>

      {/* Search & filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fiba-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('common.search') + '...'}
            className="fiba-input pl-10"
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-fiba-muted hover:text-ink-900 dark:text-white">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <select
          value={filterTemplate}
          onChange={e => setFilterTemplate(e.target.value)}
          className="fiba-select !w-auto min-w-[160px] flex-shrink-0"
        >
          <option value="">{t('competitions.allTemplates')}</option>
          {templateOptions.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {(search || filterTemplate || filterYear !== ALL_YEARS) && (
          <span className="text-xs text-fiba-muted/60 self-center">{filtered.length} / {competitions.length}</span>
        )}
      </div>

      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
        <table className="fiba-table">
          <thead>
            <tr>
              <th>{t('competitions.name')}</th>
              <th>{t('competitions.template')}</th>
              <th>{t('competitions.dates')}</th>
              <th>{t('competitions.nominations')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => (
              <Fragment key={g.year ?? 'sin-año'}>
                {/* Encabezado de año. Se muestra aunque haya un solo grupo:
                    es la respuesta a "qué año estoy viendo". */}
                <tr>
                  <td colSpan={5} className="px-4 py-2 bg-fiba-surface border-y border-fiba-border">
                    <span className="text-sm font-bold text-ink-900 dark:text-white tabular-nums">
                      {g.year ?? t('competitions.noYear')}
                    </span>
                    <span className="ml-2 text-xs text-fiba-muted/60">
                      {g.items.length} {g.items.length === 1 ? t('competitions.oneCompetition') : t('competitions.manyCompetitions')}
                    </span>
                  </td>
                </tr>
                {g.items.map(c => (
              <tr key={c.id}>
                <td className="px-4 py-3">
                  <div className="font-medium">{c.name}</div>
                  {c.fiba_games_url && (
                    <div className="text-[11px] text-emerald-400 mt-0.5 flex items-center gap-1">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                      FIBA linked
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TEMPLATE_BADGES[c.template_key] || ''}`}>
                    {c.template_key}
                  </span>
                </td>
                {/* Las fechas llevan el año adentro aunque el grupo ya lo diga:
                    es el único dato que separa "LSB – Group A" de 2026 de la de
                    2027, y no puede depender de hasta dónde llegó el scroll. */}
                <td className="px-4 py-3 whitespace-nowrap text-sm tabular-nums">
                  {competitionDateRange(c, MONTHS_SHORT, { year: true }) || (
                    <span className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium">
                      {c.year ? `TBD ${c.year}` : 'TBD'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">{nomCount(c.id)}</td>
                <td className="px-4 py-3">
                  {canEdit && (
                    <div className="flex gap-3">
                      <button onClick={() => openEdit(c)} className="text-fiba-accent hover:underline text-sm">{t('competitions.edit')}</button>
                      <button onClick={() => handleDelete(c)} className="text-red-400 hover:underline text-sm">{t('competitions.delete')}</button>
                    </div>
                  )}
                </td>
              </tr>
                ))}
              </Fragment>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-fiba-muted/60">
                {search || filterTemplate || filterYear !== ALL_YEARS ? t('competitions.noResults') : t('competitions.noCompetitions')}
              </td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {showModal && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-md p-6">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-4">{editing ? t('competitions.editCompetition') : t('competitions.newCompetitionTitle')}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input required placeholder={t('competitions.name')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="fiba-input" />
              <select value={form.template_key}
                onChange={e => setForm(f => ({ ...f, template_key: e.target.value, is_national_team: e.target.value === 'WCQ' }))}
                className="fiba-select">
                <option value="WCQ">WCQ</option>
                <option value="BCLA_F4">BCLA Final 4</option>
                <option value="BCLA_RS">BCLA Regular Season</option>
                <option value="LSB">LSB</option>
                <option value="GENERIC">GENERIC</option>
                {/* Types created on the Templates page, so a new event can be
                    wired to its own letter without a code change. */}
                {customTemplates.map(tmpl => (
                  <option key={tmpl.key} value={tmpl.key}>{tmpl.label || tmpl.key}</option>
                ))}
              </select>
              <input type="number" placeholder={t('competitions.year')} value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} className="fiba-input" />
              <div>
                <input placeholder={t('games.fibaUrl')} value={form.fiba_games_url} onChange={e => setForm(f => ({ ...f, fiba_games_url: e.target.value }))} className="fiba-input" />
                <p className="text-xs text-fiba-muted/60 mt-1">{t('games.fibaUrlHint')}</p>
              </div>
              {/* Ventana del clasificatorio. Hace falta porque FIBA devuelve el
                  clasificatorio ENTERO por esa misma URL — las seis ventanas —
                  y acá cada ventana es una competencia aparte (migración 040). */}
              <div>
                <label className="text-xs text-fiba-muted block mb-1">{t('competitions.fibaWindow')}</label>
                <select value={form.fiba_window_code}
                  onChange={e => setForm(f => ({ ...f, fiba_window_code: e.target.value }))}
                  className="fiba-select">
                  <option value="">{t('competitions.fibaWindowNone')}</option>
                  {['W1', 'W2', 'W3', 'W4', 'W5', 'W6'].map(w => (
                    <option key={w} value={w}>{w}</option>
                  ))}
                </select>
                <p className="text-xs text-fiba-muted/60 mt-1">{t('competitions.fibaWindowHint')}</p>
              </div>
              <div>
                <label className="text-xs text-fiba-muted block mb-1">Fee type</label>
                <select value={form.fee_type} onChange={e => setForm(f => ({ ...f, fee_type: e.target.value }))} className="fiba-select">
                  <option value="per_game">Per Game Fee</option>
                  <option value="tournament">Tournament Fee</option>
                </select>
                <p className="text-xs text-fiba-muted/60 mt-1">{t('competitions.feeTypeHint')}</p>
              </div>
              <div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={!!form.is_national_team}
                    onChange={e => setForm(f => ({ ...f, is_national_team: e.target.checked }))}
                    className="rounded accent-fiba-accent" />
                  <span className="text-sm text-ink-700 dark:text-gray-300">{t('competitions.nationalTeam')}</span>
                </label>
                <p className="text-xs text-fiba-muted/60 mt-1">{t('competitions.nationalTeamHint')}</p>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-fiba-muted">{t('competitions.cancel')}</button>
                <button type="submit" disabled={saving} className="btn-fiba disabled:opacity-60 disabled:cursor-not-allowed">
                  {saving ? t('common.saving') : (editing ? t('competitions.save') : t('competitions.create'))}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
