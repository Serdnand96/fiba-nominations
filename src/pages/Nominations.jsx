import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  getNominations, getPersonnel, getCompetitions,
  createNomination, createBulkNominations, generateNomination,
  bulkGenerateNominations, deleteNomination, bulkDeleteNominations,
  getDownloadUrl,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'

const BCLA_F4_ROUNDS = ['Semifinals', '3rd Place', 'Final']

export default function Nominations() {
  const { t } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('nominations')
  const [searchParams, setSearchParams] = useSearchParams()
  const [nominations, setNominations] = useState([])
  const [personnel, setPersonnel] = useState([])
  const [competitions, setCompetitions] = useState([])
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(null)

  const [form, setForm] = useState({
    personnel_ids: [], competition_id: '', letter_date: '', location: '',
    venue: '', arrival_date: '', departure_date: '', game_dates: [],
    window_fee: '', incidentals: '', confirmation_deadline: '',
  })

  const [selectedIds, setSelectedIds] = useState(new Set())
  const [preselectedHandled, setPreselectedHandled] = useState(false)

  useEffect(() => { load() }, [])

  // Auto-open form when arriving from calendar with ?competition=ID
  useEffect(() => {
    const compId = searchParams.get('competition')
    if (compId && competitions.length > 0 && !preselectedHandled) {
      // Pre-select the competition and open form
      const comp = competitions.find(c => c.id === compId)
      if (comp) {
        const tk = comp.template_key || ''
        let gameDates = []
        if (tk === 'BCLA_F4') {
          gameDates = BCLA_F4_ROUNDS.map(label => ({ label, date: '' }))
        }
        setForm(f => ({ ...f, competition_id: compId, game_dates: gameDates }))
        setShowForm(true)
      }
      setPreselectedHandled(true)
      setSearchParams({}, { replace: true })
    }
  }, [competitions, searchParams])

  async function load() {
    const [n, p, c] = await Promise.all([getNominations(), getPersonnel(), getCompetitions()])
    setNominations(n)
    setPersonnel(p)
    setCompetitions(c)
  }

  const selectedComp = competitions.find(c => c.id === form.competition_id)
  const templateKey = selectedComp?.template_key || ''
  const showLocationFields = ['BCLA_F4', 'BCLA_RS', 'LSB'].includes(templateKey)
  const showDeadline = ['WCQ', 'GENERIC'].includes(templateKey)

  const total = useMemo(() => {
    const w = parseFloat(form.window_fee) || 0
    const i = parseFloat(form.incidentals) || 0
    return (w + i).toFixed(2)
  }, [form.window_fee, form.incidentals])

  const stats = useMemo(() => {
    const generated = nominations.filter(n => n.status === 'generated').length
    const draft = nominations.filter(n => n.status === 'draft').length
    const comps = new Set(nominations.map(n => n.competition_id)).size
    return { total: nominations.length, generated, draft, comps }
  }, [nominations])

  const filtered = useMemo(() => {
    if (!search) return nominations
    const q = search.toLowerCase()
    return nominations.filter(n =>
      n.personnel?.name?.toLowerCase().includes(q) ||
      n.competitions?.name?.toLowerCase().includes(q)
    )
  }, [nominations, search])

  function handleCompChange(competition_id) {
    const comp = competitions.find(c => c.id === competition_id)
    const tk = comp?.template_key || ''
    let gameDates = []
    if (tk === 'BCLA_F4') {
      gameDates = BCLA_F4_ROUNDS.map(label => ({ label, date: '' }))
    }
    setForm(f => ({ ...f, competition_id, game_dates: gameDates }))
  }

  function addGameDate() {
    setForm(f => {
      const idx = f.game_dates.length + 1
      const label = templateKey === 'LSB' ? `Gameday ${idx}` : ''
      return { ...f, game_dates: [...f.game_dates, { label, date: '' }] }
    })
  }

  function removeGameDate(idx) {
    setForm(f => ({ ...f, game_dates: f.game_dates.filter((_, i) => i !== idx) }))
  }

  function updateGameDate(idx, field, value) {
    setForm(f => {
      const gd = [...f.game_dates]
      gd[idx] = { ...gd[idx], [field]: value }
      return { ...f, game_dates: gd }
    })
  }

  function togglePerson(id) {
    setForm(f => {
      const ids = new Set(f.personnel_ids)
      if (ids.has(id)) ids.delete(id)
      else ids.add(id)
      return { ...f, personnel_ids: [...ids] }
    })
  }

  function selectAllFiltered() {
    setForm(f => ({ ...f, personnel_ids: filteredPersonnel.map(p => p.id) }))
  }

  function clearSelection() {
    setForm(f => ({ ...f, personnel_ids: [] }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = {
        ...form,
        window_fee: parseFloat(form.window_fee) || 0,
        incidentals: parseFloat(form.incidentals) || 0,
      }
      if (!showLocationFields) {
        delete payload.location
        delete payload.venue
        delete payload.arrival_date
        delete payload.departure_date
      }
      if (!showDeadline) {
        delete payload.confirmation_deadline
      }

      let createdIds = []

      if (form.personnel_ids.length > 1) {
        const result = await createBulkNominations(payload)
        createdIds = result.nominations.map(n => n.id)
        if (result.errors?.length) {
          alert(`${t('nominations.generated')}: ${result.created}. ${t('personnel.errors')}: ${result.errors.length}`)
        }
      } else if (form.personnel_ids.length === 1) {
        const result = await createNomination({
          ...payload,
          personnel_id: form.personnel_ids[0],
        })
        createdIds = [result.id]
      }

      setShowForm(false)
      setForm({
        personnel_ids: [], competition_id: '', letter_date: '', location: '',
        venue: '', arrival_date: '', departure_date: '', game_dates: [],
        window_fee: '', incidentals: '', confirmation_deadline: '',
      })

      if (createdIds.length > 0) {
        let successCount = 0
        let errorCount = 0
        setBulkProgress({ total: createdIds.length, done: 0 })

        const conversionErrors = []
        for (let i = 0; i < createdIds.length; i++) {
          setBulkProgress({ total: createdIds.length, done: i, current: `${i + 1} / ${createdIds.length}` })
          try {
            const result = await generateNomination(createdIds[i])
            if (result.status === 'generated') {
              successCount++
              if (result.conversion_error) {
                conversionErrors.push(result.conversion_error)
              }
              await downloadFile(result.pdf_path, result.format, createdIds[i], result.filename)
              await new Promise(resolve => setTimeout(resolve, 500))
            } else {
              errorCount++
            }
          } catch (e) {
            errorCount++
            console.error(`Generate [${i+1}] error:`, e)
          }
        }

        setBulkProgress(null)
        let msg = t('nominations.generatedCount', { success: successCount, total: createdIds.length })
        if (conversionErrors.length > 0) {
          msg += `\n\nPDF conversion failed: ${conversionErrors[0]}`
        }
        if (errorCount > 0) {
          msg += `\n${t('nominations.errorsCount', { count: errorCount })}`
        }
        alert(msg)
      }

      await load()
    } finally {
      setLoading(false)
    }
  }

  async function handleGenerate(id) {
    setLoading(true)
    try {
      const result = await generateNomination(id)

      if (result.error || result.status === 'error') {
        alert(`${t('nominations.errorGenerating')}:\n${result.error}`)
        return
      }

      await load()

      if (result.conversion_error) {
        alert(`${t('nominations.conversionNote')}\nError: ${result.conversion_error}`)
      }

      if (result.pdf_path) {
        downloadFile(result.pdf_path, result.format, id, result.filename)
      }
    } catch (err) {
      alert(`Error: ${err.message}`)
      console.error('Generate error:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleBulkGenerate() {
    const ids = [...selectedIds]
    if (ids.length === 0) return

    setLoading(true)
    let successCount = 0
    let errorCount = 0

    for (let i = 0; i < ids.length; i++) {
      setBulkProgress({ total: ids.length, done: i, current: `${i + 1} / ${ids.length}` })
      try {
        const result = await generateNomination(ids[i])
        if (result.status === 'generated') {
          successCount++
          await downloadFile(result.pdf_path, result.format, ids[i], result.filename)
          await new Promise(resolve => setTimeout(resolve, 500))
        } else {
          errorCount++
        }
      } catch {
        errorCount++
      }
    }

    setBulkProgress(null)
    await load()
    setSelectedIds(new Set())
    alert(t('nominations.generatedCount', { success: successCount, total: ids.length }) + (errorCount > 0 ? `\n${t('nominations.errorsCount', { count: errorCount })}` : ''))
    setLoading(false)
  }

  async function handleDeleteNomination(nom) {
    if (!confirm(t('nominations.confirmDelete', { name: nom.personnel?.name }))) return
    try {
      await deleteNomination(nom.id)
      await load()
    } catch (err) {
      alert(t('nominations.errorDeleting') + ': ' + (err.response?.data?.detail || err.message))
    }
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    if (!confirm(t('nominations.confirmBulkDelete', { count: ids.length }))) return
    try {
      await bulkDeleteNominations(ids)
      setSelectedIds(new Set())
      await load()
    } catch (err) {
      alert(t('nominations.errorDeletingBulk') + ': ' + (err.response?.data?.detail || err.message))
    }
  }

  async function downloadFile(url, format, id, filename) {
    const defaultName = filename || `nomination.${format === 'pdf' ? 'pdf' : 'docx'}`
    const proxyUrl = `/api/nominations/${id}/download?filename=${encodeURIComponent(defaultName)}`
    const link = document.createElement('a')
    link.href = proxyUrl
    link.download = defaultName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  function toggleTableSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(n => n.id)))
    }
  }

  const [personSearch, setPersonSearch] = useState('')
  const filteredPersonnel = personnel.filter(p =>
    p.name.toLowerCase().includes(personSearch.toLowerCase())
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">{t('nominations.title')}</h2>
        {canEdit && (
          <div className="flex gap-2">
            {selectedIds.size > 0 && (
              <>
                <button onClick={handleBulkDelete} disabled={loading}
                  className="btn-fiba-danger disabled:opacity-50">
                  {t('nominations.deleteCount', { count: selectedIds.size })}
                </button>
                <button onClick={handleBulkGenerate} disabled={loading}
                  className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
                  {loading && bulkProgress
                    ? t('nominations.generatingProgress', { current: bulkProgress.current })
                    : t('nominations.generateCount', { count: selectedIds.size })}
                </button>
              </>
            )}
            <button onClick={() => setShowForm(true)}
              className="btn-fiba">
              {t('nominations.newNomination')}
            </button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: t('nominations.total'), value: stats.total },
          { label: t('nominations.generated'), value: stats.generated },
          { label: t('nominations.draft'), value: stats.draft },
          { label: t('nominations.competitions'), value: stats.comps },
        ].map(s => (
          <div key={s.label} className="fiba-stat">
            <p className="text-xs text-fiba-muted">{s.label}</p>
            <p className="text-2xl font-bold text-white">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <input type="text" placeholder={t('nominations.searchNominations')} value={search}
        onChange={e => setSearch(e.target.value)} className="fiba-input w-full md:w-80 mb-4" />

      {/* Table */}
      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <table className="fiba-table">
          <thead>
            <tr>
              <th className="px-4 py-3 w-10">
                <input type="checkbox" checked={filtered.length > 0 && selectedIds.size === filtered.length}
                  onChange={toggleSelectAll} className="rounded" />
              </th>
              <th>{t('nominations.name')}</th>
              <th>{t('nominations.role')}</th>
              <th>{t('nominations.competition')}</th>
              <th>{t('nominations.letterDate')}</th>
              <th>{t('nominations.status')}</th>
              <th>{t('nominations.action')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(n => (
              <tr key={n.id} className={selectedIds.has(n.id) ? 'bg-fiba-accent/10' : ''}>
                <td className="px-4 py-3">
                  <input type="checkbox" checked={selectedIds.has(n.id)} onChange={() => toggleTableSelect(n.id)} className="rounded" />
                </td>
                <td className="px-4 py-3">{n.personnel?.name}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${n.personnel?.role === 'VGO' ? 'bg-purple-500/20 text-purple-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                    {n.personnel?.role}
                  </span>
                </td>
                <td className="px-4 py-3">{n.competitions?.name}</td>
                <td className="px-4 py-3">{n.letter_date || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${n.status === 'generated' ? 'bg-blue-500/20 text-blue-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                    {n.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {n.status === 'generated' && (
                      <a href={n.pdf_path?.startsWith('http') ? n.pdf_path : getDownloadUrl(n.id)}
                        target="_blank" rel="noreferrer" className="text-fiba-accent hover:underline text-sm">
                        {t('nominations.download')}
                      </a>
                    )}
                    {canEdit && (
                      <>
                        {n.status === 'generated' ? (
                          <button onClick={() => handleGenerate(n.id)} disabled={loading}
                            className="text-fiba-muted hover:text-fiba-accent hover:underline text-sm">
                            {t('nominations.regenerate')}
                          </button>
                        ) : (
                          <button onClick={() => handleGenerate(n.id)} disabled={loading}
                            className="text-fiba-accent hover:underline text-sm">
                            {t('nominations.generate')}
                          </button>
                        )}
                        <button onClick={() => handleDeleteNomination(n)} className="text-red-400 hover:underline text-sm">
                          {t('nominations.delete')}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-fiba-muted/60">{t('nominations.noNominations')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Creation Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-start justify-center pt-16 z-50">
          <div className="fiba-modal max-w-2xl max-h-[80vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-white">{t('nominations.newNominationTitle')}</h3>
              <button onClick={() => setShowForm(false)} className="text-fiba-muted hover:text-white text-xl">&times;</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Multi-person select */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  {t('nominations.persons')} ({form.personnel_ids.length} {t('nominations.selected')})
                </label>
                <input type="text" placeholder={t('nominations.searchPerson')} value={personSearch}
                  onChange={e => setPersonSearch(e.target.value)} className="fiba-input mb-1" />
                <div className="flex gap-2 mb-2">
                  <button type="button" onClick={selectAllFiltered} className="text-fiba-accent hover:underline text-xs">
                    {t('nominations.selectAll')}
                  </button>
                  <button type="button" onClick={clearSelection} className="text-fiba-muted hover:underline text-xs">
                    {t('nominations.clear')}
                  </button>
                </div>
                <div className="border border-fiba-border rounded-lg max-h-48 overflow-y-auto">
                  {filteredPersonnel.map(p => (
                    <label key={p.id}
                      className={`flex items-center gap-2 px-3 py-2 hover:bg-fiba-surface cursor-pointer text-sm ${form.personnel_ids.includes(p.id) ? 'bg-fiba-accent/10' : ''}`}>
                      <input type="checkbox" checked={form.personnel_ids.includes(p.id)} onChange={() => togglePerson(p.id)} className="rounded" />
                      <span>{p.name}</span>
                      <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${p.role === 'VGO' ? 'bg-purple-500/20 text-purple-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{p.role}</span>
                    </label>
                  ))}
                  {filteredPersonnel.length === 0 && (
                    <p className="px-3 py-4 text-center text-fiba-muted/60 text-sm">{t('nominations.noPersonsFound')}</p>
                  )}
                </div>
              </div>

              {/* Competition select */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">{t('nominations.competition')}</label>
                <select required value={form.competition_id} onChange={e => handleCompChange(e.target.value)}
                  className="fiba-select">
                  <option value="">{t('nominations.selectCompetition')}</option>
                  {competitions.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.template_key})</option>
                  ))}
                </select>
              </div>

              {/* Letter date */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">{t('nominations.letterDate')}</label>
                <input type="date" value={form.letter_date} onChange={e => setForm(f => ({ ...f, letter_date: e.target.value }))}
                  className="fiba-input" />
              </div>

              {/* Location & Venue */}
              {showLocationFields && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">Location</label>
                      <input type="text" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                        className="fiba-input" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">{t('nominations.venue')}</label>
                      <input type="text" value={form.venue} onChange={e => setForm(f => ({ ...f, venue: e.target.value }))}
                        className="fiba-input" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">{t('nominations.arrivalDate')}</label>
                      <input type="date" value={form.arrival_date} onChange={e => setForm(f => ({ ...f, arrival_date: e.target.value }))}
                        className="fiba-input" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-1">{t('nominations.departureDate')}</label>
                      <input type="date" value={form.departure_date} onChange={e => setForm(f => ({ ...f, departure_date: e.target.value }))}
                        className="fiba-input" />
                    </div>
                  </div>
                </>
              )}

              {/* Game Dates */}
              {templateKey && templateKey !== 'BCLA_RS' && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">{t('nominations.gameDates')}</label>
                  {form.game_dates.map((gd, idx) => (
                    <div key={idx} className="flex gap-2 mb-2 items-center">
                      {templateKey === 'BCLA_F4' ? (
                        <span className="text-sm text-fiba-muted w-28">{gd.label}</span>
                      ) : (
                        <input type="text" value={gd.label} onChange={e => updateGameDate(idx, 'label', e.target.value)}
                          placeholder="Label" className="fiba-input w-32" readOnly={templateKey === 'LSB'} />
                      )}
                      <input type="date" value={gd.date} onChange={e => updateGameDate(idx, 'date', e.target.value)}
                        className="fiba-input flex-1" />
                      {templateKey !== 'BCLA_F4' && (
                        <button type="button" onClick={() => removeGameDate(idx)} className="text-red-400 hover:text-red-300 text-lg">&times;</button>
                      )}
                    </div>
                  ))}
                  {templateKey !== 'BCLA_F4' && (
                    <button type="button" onClick={addGameDate} className="text-fiba-accent hover:underline text-sm">
                      {t('nominations.addDate')}
                    </button>
                  )}
                </div>
              )}

              {/* Confirmation Deadline */}
              {showDeadline && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">{t('nominations.confirmationDeadline')}</label>
                  <input type="date" value={form.confirmation_deadline}
                    onChange={e => setForm(f => ({ ...f, confirmation_deadline: e.target.value }))}
                    className="fiba-input" />
                </div>
              )}

              {/* Fees */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    {showDeadline ? t('nominations.perGameFee') : t('nominations.windowFee')}
                  </label>
                  <input type="number" step="0.01" value={form.window_fee}
                    onChange={e => setForm(f => ({ ...f, window_fee: e.target.value }))}
                    className="fiba-input" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">{t('nominations.incidentals')}</label>
                  <input type="number" step="0.01" value={form.incidentals}
                    onChange={e => setForm(f => ({ ...f, incidentals: e.target.value }))}
                    className="fiba-input" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">Total</label>
                  <input type="text" value={total} readOnly className="fiba-input bg-fiba-surface" />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-fiba-muted hover:text-white">
                  {t('nominations.cancel')}
                </button>
                <button type="submit" disabled={loading || form.personnel_ids.length === 0}
                  className="btn-fiba disabled:opacity-50">
                  {loading ? t('nominations.saving') : form.personnel_ids.length > 1
                    ? t('nominations.createCount', { count: form.personnel_ids.length })
                    : t('nominations.createOne')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
