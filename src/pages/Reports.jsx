import { useEffect, useMemo, useState } from 'react'
import {
  getCalendarCompetitions, getReportTypes, getReportFacets, getReports,
  createReport, updateReport, deleteReport,
  getReportFiles, uploadReportFile, deleteReportFile, downloadReportFile,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'
import { readLastSearch, writeLastSearch } from '../lib/lastSearch'
import CompetitionSearch from '../components/CompetitionSearch'
import { Icon } from '../lib/icons'

const LAST_SEARCH_KEY = 'fiba_reports_last_search'

const TYPE_BADGES = {
  final:      'bg-emerald-500/20 text-emerald-400',
  technical:  'bg-blue-500/20 text-blue-400',
  operations: 'bg-purple-500/20 text-purple-400',
  venue:      'bg-amber-500/20 text-amber-500',
  loc:        'bg-cyan-500/20 text-cyan-400',
  medical:    'bg-red-500/20 text-red-400',
  security:   'bg-orange-500/20 text-orange-400',
  other:      'bg-fiba-surface text-fiba-muted',
}

const EMPTY_FORM = {
  competition_id: '', type_code: 'final', title: '',
  venue: '', loc: '', report_date: '', summary: '',
}

function loadLastSearch() {
  const parsed = readLastSearch(LAST_SEARCH_KEY)
  if (!parsed) return null
  const str = v => (typeof v === 'string' ? v : '')
  return {
    search: str(parsed.search),
    competition: str(parsed.competition),
    type: str(parsed.type),
    venue: str(parsed.venue),
    loc: str(parsed.loc),
  }
}

function fmtSize(bytes) {
  if (!bytes) return ''
  const kb = bytes / 1024
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`
}

export default function Reports() {
  const { t } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('reports')

  const restored = useMemo(loadLastSearch, [])

  const [competitions, setCompetitions] = useState([])
  const [types, setTypes] = useState([])
  const [facets, setFacets] = useState({ venues: [], locs: [] })
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [search, setSearch] = useState(restored?.search || '')
  const [filterComp, setFilterComp] = useState(restored?.competition || '')
  const [filterType, setFilterType] = useState(restored?.type || '')
  const [filterVenue, setFilterVenue] = useState(restored?.venue || '')
  const [filterLoc, setFilterLoc] = useState(restored?.loc || '')

  // Editor panel
  const [editing, setEditing] = useState(null)      // report row, or 'new'
  const [form, setForm] = useState(EMPTY_FORM)
  const [files, setFiles] = useState([])
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    Promise.all([getCalendarCompetitions(), getReportTypes(), getReportFacets()])
      .then(([comps, tps, fac]) => { setCompetitions(comps); setTypes(tps); setFacets(fac) })
      .catch(e => console.error(e))
  }, [])

  useEffect(() => {
    writeLastSearch(LAST_SEARCH_KEY, {
      search, competition: filterComp, type: filterType, venue: filterVenue, loc: filterLoc,
    })
  }, [search, filterComp, filterType, filterVenue, filterLoc])

  async function load() {
    setLoading(true)
    try {
      setReports(await getReports({
        competition_id: filterComp || undefined,
        type_code: filterType || undefined,
        venue: filterVenue || undefined,
        loc: filterLoc || undefined,
        search: search || undefined,
      }))
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  // Debounced so typing in the search box doesn't fire a request per keystroke.
  useEffect(() => {
    const id = setTimeout(load, 250)
    return () => clearTimeout(id)
  }, [search, filterComp, filterType, filterVenue, filterLoc])

  function typeLabel(code) {
    const key = `reports.typeLabel.${code}`
    const translated = t(key)
    if (translated !== key) return translated
    return types.find(x => x.code === code)?.label || code
  }

  function openNew() {
    setEditing('new')
    setForm({ ...EMPTY_FORM, competition_id: filterComp || '' })
    setFiles([])
  }

  function openReport(r) {
    setEditing(r)
    setForm({
      competition_id: r.competition_id || '',
      type_code: r.type_code || 'final',
      title: r.title || '',
      venue: r.venue || '',
      loc: r.loc || '',
      report_date: r.report_date || '',
      summary: r.summary || '',
    })
    getReportFiles(r.id).then(setFiles).catch(() => setFiles([]))
  }

  function closeEditor() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFiles([])
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.title.trim() || !form.competition_id) {
      alert(t('reports.titleRequired'))
      return
    }
    setSaving(true)
    try {
      const payload = { ...form, report_date: form.report_date || null }
      if (editing === 'new') {
        const created = await createReport(payload)
        setEditing(created)
      } else {
        await updateReport(editing.id, payload)
      }
      await load()
      const fac = await getReportFacets()
      setFacets(fac)
    } catch (err) {
      alert(err.response?.data?.detail || t('reports.errorSaving'))
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (editing === 'new' || !confirm(t('reports.confirmDelete'))) return
    try {
      await deleteReport(editing.id)
      closeEditor()
      await load()
    } catch (err) {
      alert(err.response?.data?.detail || t('reports.errorSaving'))
    }
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || editing === 'new') return
    setUploading(true)
    try {
      await uploadReportFile(editing.id, file)
      setFiles(await getReportFiles(editing.id))
      await load()
    } catch (err) {
      alert(err.response?.data?.detail || t('reports.errorUpload'))
    }
    setUploading(false)
  }

  async function handleDeleteFile(f) {
    if (!confirm(t('reports.confirmDeleteFile'))) return
    try {
      await deleteReportFile(f.id)
      setFiles(await getReportFiles(editing.id))
      await load()
    } catch (err) {
      alert(err.response?.data?.detail || t('reports.errorUpload'))
    }
  }

  // Private bucket → authenticated blob, never a public URL.
  async function handleDownload(f) {
    try {
      const blob = await downloadReportFile(f.id, f.file_name)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = f.file_name || 'report'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert(err.response?.data?.detail || t('reports.errorDownload'))
    }
  }

  const hasFilters = search || filterComp || filterType || filterVenue || filterLoc

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink-900 dark:text-white">{t('reports.title')}</h1>
          <p className="text-sm text-fiba-muted mt-1">{t('reports.subtitle')}</p>
        </div>
        {canEdit && (
          <button onClick={openNew} className="btn-fiba">{t('reports.newReport')}</button>
        )}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-6">
        <div className="md:col-span-2">
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('reports.search')} className="fiba-input w-full" />
        </div>
        <CompetitionSearch
          competitions={competitions}
          value={filterComp}
          onChange={setFilterComp}
          placeholder={t('reports.allCompetitions')}
        />
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="fiba-select w-full">
          <option value="">{t('reports.allTypes')}</option>
          {types.map(x => <option key={x.code} value={x.code}>{typeLabel(x.code)}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-3">
          <select value={filterVenue} onChange={e => setFilterVenue(e.target.value)} className="fiba-select w-full">
            <option value="">{t('reports.allVenues')}</option>
            {facets.venues.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={filterLoc} onChange={e => setFilterLoc(e.target.value)} className="fiba-select w-full">
            <option value="">{t('reports.allLocs')}</option>
            {facets.locs.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>

      {/* Reports table */}
      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="fiba-table">
            <thead>
              <tr>
                <th>{t('reports.reportTitle')}</th>
                <th>{t('reports.competition')}</th>
                <th>{t('reports.type')}</th>
                <th>{t('reports.venue')}</th>
                <th>{t('reports.loc')}</th>
                <th>{t('reports.reportDate')}</th>
                <th className="text-right">{t('reports.fileCount')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-fiba-muted/60">{t('app.loading')}</td></tr>
              )}
              {!loading && reports.map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-3 font-medium">{r.title}</td>
                  <td className="px-4 py-3">{r.competition_name || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TYPE_BADGES[r.type_code] || TYPE_BADGES.other}`}>
                      {typeLabel(r.type_code)}
                    </span>
                  </td>
                  <td className="px-4 py-3">{r.venue || '—'}</td>
                  <td className="px-4 py-3">{r.loc || '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{r.report_date || '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{r.file_count ?? 0}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openReport(r)} className="text-fiba-accent hover:underline text-sm">
                      {canEdit ? t('reports.editReport') : t('reports.view')}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && reports.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-fiba-muted/60">
                    {hasFilters ? t('reports.noReportsFiltered') : t('reports.noReports')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Editor panel */}
      {editing && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={closeEditor} />
          <div className="fixed top-0 right-0 h-full w-full max-w-lg bg-fiba-card border-l border-fiba-border z-50 flex flex-col animate-slide-in">
            <div className="flex items-start justify-between p-6 border-b border-fiba-border">
              <div>
                <h3 className="text-lg font-bold text-ink-900 dark:text-white">
                  {editing === 'new' ? t('reports.newReport') : t('reports.editReport')}
                </h3>
                {editing !== 'new' && (
                  <p className="text-sm text-fiba-muted">{editing.competition_name}</p>
                )}
              </div>
              <button onClick={closeEditor} className="text-fiba-muted hover:text-ink-900 dark:hover:text-white text-xl leading-none">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="block text-xs text-fiba-muted mb-1">{t('reports.competition')}</label>
                  {/* CompetitionSearch has no disabled state — for a view-only
                      user render the value as plain text instead. */}
                  {canEdit ? (
                    <CompetitionSearch
                      competitions={competitions}
                      value={form.competition_id}
                      onChange={id => setForm(f => ({ ...f, competition_id: id }))}
                      placeholder={t('reports.selectCompetition')}
                    />
                  ) : (
                    <p className="text-sm text-ink-900 dark:text-white">
                      {competitions.find(c => c.id === form.competition_id)?.name || '—'}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-fiba-muted mb-1">{t('reports.reportTitle')}</label>
                  <input type="text" value={form.title} disabled={!canEdit}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder={t('reports.titlePlaceholder')} className="fiba-input w-full" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-fiba-muted mb-1">{t('reports.type')}</label>
                    <select value={form.type_code} disabled={!canEdit}
                      onChange={e => setForm(f => ({ ...f, type_code: e.target.value }))} className="fiba-select w-full">
                      {types.map(x => <option key={x.code} value={x.code}>{typeLabel(x.code)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-fiba-muted mb-1">{t('reports.reportDate')}</label>
                    <input type="date" value={form.report_date} disabled={!canEdit}
                      onChange={e => setForm(f => ({ ...f, report_date: e.target.value }))} className="fiba-input w-full" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-fiba-muted mb-1">{t('reports.venue')}</label>
                    <input type="text" value={form.venue} disabled={!canEdit} list="report-venues"
                      onChange={e => setForm(f => ({ ...f, venue: e.target.value }))}
                      placeholder={t('reports.venuePlaceholder')} className="fiba-input w-full" />
                    <datalist id="report-venues">
                      {facets.venues.map(v => <option key={v} value={v} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-xs text-fiba-muted mb-1">{t('reports.loc')}</label>
                    <input type="text" value={form.loc} disabled={!canEdit} list="report-locs"
                      onChange={e => setForm(f => ({ ...f, loc: e.target.value }))}
                      placeholder={t('reports.locPlaceholder')} className="fiba-input w-full" />
                    <datalist id="report-locs">
                      {facets.locs.map(v => <option key={v} value={v} />)}
                    </datalist>
                    <p className="text-[11px] text-fiba-muted/70 mt-1">{t('reports.locHint')}</p>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-fiba-muted mb-1">{t('reports.summary')}</label>
                  <textarea rows={3} value={form.summary} disabled={!canEdit}
                    onChange={e => setForm(f => ({ ...f, summary: e.target.value }))}
                    placeholder={t('reports.summaryPlaceholder')} className="fiba-input w-full" />
                </div>

                {canEdit && (
                  <div className="flex gap-3">
                    <button type="submit" disabled={saving} className="btn-fiba">
                      {saving ? t('app.loading') : (editing === 'new' ? t('reports.create') : t('reports.save'))}
                    </button>
                    {editing !== 'new' && (
                      <button type="button" onClick={handleDelete} className="px-4 py-2 text-sm text-red-400 hover:underline">
                        {t('reports.delete')}
                      </button>
                    )}
                  </div>
                )}
              </form>

              {/* Documents — only once the report exists */}
              <div className="pt-4 border-t border-fiba-border">
                <h4 className="text-sm font-semibold text-ink-900 dark:text-white mb-2">{t('reports.files')}</h4>
                {editing === 'new' ? (
                  <p className="text-xs text-fiba-muted/70">{t('reports.saveFirstForFiles')}</p>
                ) : (
                  <>
                    <div className="space-y-2 mb-3">
                      {files.map(f => (
                        <div key={f.id} className="flex items-center gap-2 text-sm">
                          <Icon.Doc className="w-4 h-4 text-fiba-muted shrink-0" />
                          <button onClick={() => handleDownload(f)} className="text-fiba-accent hover:underline truncate flex-1 text-left">
                            {f.file_name}
                          </button>
                          <span className="text-xs text-fiba-muted/70 tabular-nums">{fmtSize(f.size_bytes)}</span>
                          {canEdit && (
                            <button onClick={() => handleDeleteFile(f)} className="text-red-400 hover:underline text-xs">{t('reports.removeFile')}</button>
                          )}
                        </div>
                      ))}
                      {files.length === 0 && <p className="text-xs text-fiba-muted/60">{t('reports.noFiles')}</p>}
                    </div>
                    {canEdit && (
                      <label className="btn-fiba cursor-pointer inline-block">
                        {uploading ? t('reports.uploading') : t('reports.uploadFile')}
                        <input type="file" onChange={handleUpload} disabled={uploading} className="hidden" />
                      </label>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
