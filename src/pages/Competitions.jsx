import { useState, useEffect, useMemo } from 'react'
import { getCompetitions, createCompetition, updateCompetition, deleteCompetition, getNominations } from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'

const TEMPLATE_BADGES = {
  WCQ: 'bg-red-500/20 text-red-400',
  BCLA_F4: 'bg-blue-500/20 text-blue-400',
  BCLA_RS: 'bg-blue-500/20 text-blue-400',
  LSB: 'bg-amber-500/20 text-amber-400',
  GENERIC: 'bg-fiba-surface text-fiba-muted',
}

export default function Competitions() {
  const { t } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('competitions')
  const [competitions, setCompetitions] = useState([])
  const [nominations, setNominations] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', template_key: 'WCQ', year: new Date().getFullYear(), fiba_games_url: '', fee_type: 'per_game' })

  // Search & filter
  const [search, setSearch] = useState('')
  const [filterTemplate, setFilterTemplate] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const [c, n] = await Promise.all([getCompetitions(), getNominations()])
    setCompetitions(c)
    setNominations(n)
  }

  function nomCount(compId) {
    return nominations.filter(n => n.competition_id === compId).length
  }

  // Filtered competitions
  const filtered = useMemo(() => {
    return competitions.filter(c => {
      if (filterTemplate && c.template_key !== filterTemplate) return false
      if (search) {
        const q = search.toLowerCase()
        return (c.name || '').toLowerCase().includes(q)
          || (c.template_key || '').toLowerCase().includes(q)
          || String(c.year || '').includes(q)
      }
      return true
    })
  }, [competitions, search, filterTemplate])

  const templateOptions = useMemo(() =>
    [...new Set(competitions.map(c => c.template_key).filter(Boolean))].sort(),
    [competitions]
  )

  function openCreate() {
    setEditing(null)
    setForm({ name: '', template_key: 'WCQ', year: new Date().getFullYear(), fiba_games_url: '', fee_type: 'per_game' })
    setShowModal(true)
  }

  function openEdit(comp) {
    setEditing(comp)
    setForm({ name: comp.name, template_key: comp.template_key, year: comp.year || new Date().getFullYear(), fiba_games_url: comp.fiba_games_url || '', fee_type: comp.fee_type || 'per_game' })
    setShowModal(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (editing) {
      await updateCompetition(editing.id, { ...form, year: parseInt(form.year) })
    } else {
      await createCompetition({ ...form, year: parseInt(form.year) })
    }
    setShowModal(false)
    await load()
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
        alert(err.response?.data?.detail || t('competitions.errorDeleting'))
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

      {/* Search & filter bar */}
      <div className="flex gap-3 mb-4">
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
          <option value="">All templates</option>
          {templateOptions.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        {(search || filterTemplate) && (
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
              <th>{t('competitions.year')}</th>
              <th>{t('competitions.nominations')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
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
                <td className="px-4 py-3">{c.year || '--'}</td>
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
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-fiba-muted/60">
                {search || filterTemplate ? 'No results' : t('competitions.noCompetitions')}
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
              <select value={form.template_key} onChange={e => setForm(f => ({ ...f, template_key: e.target.value }))} className="fiba-select">
                <option value="WCQ">WCQ</option>
                <option value="BCLA_F4">BCLA Final 4</option>
                <option value="BCLA_RS">BCLA Regular Season</option>
                <option value="LSB">LSB</option>
                <option value="GENERIC">GENERIC</option>
              </select>
              <input type="number" placeholder={t('competitions.year')} value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} className="fiba-input" />
              <div>
                <input placeholder={t('games.fibaUrl')} value={form.fiba_games_url} onChange={e => setForm(f => ({ ...f, fiba_games_url: e.target.value }))} className="fiba-input" />
                <p className="text-xs text-fiba-muted/60 mt-1">{t('games.fibaUrlHint')}</p>
              </div>
              <div>
                <label className="text-xs text-fiba-muted block mb-1">Fee type</label>
                <select value={form.fee_type} onChange={e => setForm(f => ({ ...f, fee_type: e.target.value }))} className="fiba-select">
                  <option value="per_game">Per Game Fee</option>
                  <option value="tournament">Tournament Fee</option>
                </select>
                <p className="text-xs text-fiba-muted/60 mt-1">Determina el texto de honorarios en la nominación.</p>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-fiba-muted">{t('competitions.cancel')}</button>
                <button type="submit" className="btn-fiba">
                  {editing ? t('competitions.save') : t('competitions.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
