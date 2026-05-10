import { useState, useEffect, useMemo, useRef } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'
import CompetitionSearch from '../components/CompetitionSearch'
import {
  getCalendarCompetitions, getPersonnel, getCompetitionAvailability,
  getTrainingSlots, createTrainingSlot, updateTrainingSlot,
  deleteTrainingSlot, createTrainingAssignment, deleteTrainingAssignment,
  importTrainingExcel, previewTrainingExcel, downloadTrainingPdf,
  checkTrainingConflicts,
} from '../api/client'

function formatTime(t) {
  if (!t) return ''
  const parts = t.split(':')
  return `${parts[0]}:${parts[1]}`
}

export default function Training() {
  const { t, lang } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('training')
  const [tab, setTab] = useState('byDay')
  const [competitions, setCompetitions] = useState([])
  const [competitionId, setCompetitionId] = useState('')
  const [loading, setLoading] = useState(true)

  // Shared data
  const [allSlots, setAllSlots] = useState([])
  const [tds, setTds] = useState([])
  const [availData, setAvailData] = useState([])

  // By Day state
  const [selectedDate, setSelectedDate] = useState('')

  // By Team state
  const [selectedTeam, setSelectedTeam] = useState('')

  // By TD state
  const [selectedTd, setSelectedTd] = useState('')

  // Create/Edit Slot modal
  const [showSlotModal, setShowSlotModal] = useState(false)
  const [editingSlot, setEditingSlot] = useState(null)
  const [slotForm, setSlotForm] = useState({
    date: '', start_time: '', end_time: '', venue: 'Estadio', team_label: '', sport: 'Basketball', notes: '',
  })

  // Assignment modal
  const [assignSlot, setAssignSlot] = useState(null)
  const [assignTdId, setAssignTdId] = useState('')
  const [assignSaving, setAssignSaving] = useState(false)
  const [tdConflicts, setTdConflicts] = useState({}) // { personnel_id: conflict_detail | null }

  // Import modal
  const [showImport, setShowImport] = useState(false)
  const [importCompId, setImportCompId] = useState('')
  const [importSport, setImportSport] = useState('Basketball')
  const [importFile, setImportFile] = useState(null)
  const [importPreview, setImportPreview] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef(null)

  // Toast
  const [toast, setToast] = useState(null)

  useEffect(() => { loadCompetitions() }, [])

  useEffect(() => {
    if (competitionId) loadSlots()
  }, [competitionId])

  async function loadCompetitions() {
    try {
      const [comps, pers] = await Promise.all([
        getCalendarCompetitions({}),
        getPersonnel({ role: 'TD' }),
      ])
      setCompetitions(comps)
      setTds(pers.filter(p => p.role === 'TD'))
      if (comps.length > 0) setCompetitionId(comps[0].id)
    } catch (err) { console.error('Load error:', err) }
    setLoading(false)
  }

  async function loadSlots() {
    try {
      const [slots, avail] = await Promise.all([
        getTrainingSlots(competitionId),
        getCompetitionAvailability(competitionId).catch(() => []),
      ])
      setAllSlots(slots)
      setAvailData(avail)
      if (slots.length > 0 && !selectedDate) {
        const d = [...new Set(slots.map(s => s.date))].sort()
        setSelectedDate(d[0])
      }
    } catch (err) { console.error('Slots load error:', err) }
  }

  // Derived data
  const dates = useMemo(() => [...new Set(allSlots.map(s => s.date))].sort(), [allSlots])
  const teams = useMemo(() => [...new Set(allSlots.map(s => s.team_label))].sort(), [allSlots])

  const daySlots = useMemo(() => {
    if (!selectedDate) return { estadio: [], cancha: [] }
    const day = allSlots.filter(s => s.date === selectedDate)
    return {
      estadio: day.filter(s => s.venue === 'Estadio').sort((a, b) => a.start_time.localeCompare(b.start_time)),
      cancha: day.filter(s => s.venue !== 'Estadio').sort((a, b) => a.start_time.localeCompare(b.start_time)),
    }
  }, [allSlots, selectedDate])

  const teamSlots = useMemo(() => {
    if (!selectedTeam) return []
    return allSlots.filter(s => s.team_label === selectedTeam)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time))
  }, [allSlots, selectedTeam])

  const tdSlots = useMemo(() => {
    if (!selectedTd) return []
    return allSlots.filter(s => s.assignments?.some(a => a.personnel_id === selectedTd))
      .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time))
  }, [allSlots, selectedTd])

  const availableTds = useMemo(() => {
    return tds.filter(td => {
      const entry = availData.find(a => a.personnel_id === td.id)
      if (!entry) return true
      return entry.status !== 'unavailable'
    })
  }, [tds, availData])

  // Helper for time overlap
  function toMin(t) { if (!t) return 0; const p = t.split(':'); return parseInt(p[0]) * 60 + parseInt(p[1]) }
  function timeOverlaps(s1, e1, s2, e2) { return toMin(s1) < toMin(e2) && toMin(s2) < toMin(e1) }

  // Compute conflicts: slots that overlap in time at the same venue on the same date
  const overlappingSlotIds = useMemo(() => {
    const ids = new Set()
    for (let i = 0; i < allSlots.length; i++) {
      for (let j = i + 1; j < allSlots.length; j++) {
        const a = allSlots[i], b = allSlots[j]
        if (a.date !== b.date) continue
        if (a.venue !== b.venue) continue
        if (timeOverlaps(a.start_time, a.end_time, b.start_time, b.end_time)) {
          ids.add(a.id)
          ids.add(b.id)
        }
      }
    }
    return ids
  }, [allSlots])

  // Compute per-slot TD conflict map: which TDs have overlapping assignments across slots
  const slotTdConflictMap = useMemo(() => {
    const map = {} // slot_id -> Set of personnel_ids with conflicts
    for (const slot of allSlots) {
      if (!slot.assignments?.length) continue
      const conflictIds = new Set()
      for (const asn of slot.assignments) {
        const pid = asn.personnel_id
        for (const other of allSlots) {
          if (other.id === slot.id) continue
          if (other.date !== slot.date) continue
          if (!other.assignments?.some(a => a.personnel_id === pid)) continue
          if (timeOverlaps(slot.start_time, slot.end_time, other.start_time, other.end_time)) {
            conflictIds.add(pid)
            break
          }
        }
      }
      if (conflictIds.size > 0) map[slot.id] = conflictIds
    }
    return map
  }, [allSlots])

  // ── Handlers ──────────────────────────────────────────────────────────────

  function openCreateSlot() {
    setEditingSlot(null)
    setSlotForm({ date: selectedDate || '', start_time: '', end_time: '', venue: 'Estadio', team_label: '', sport: 'Basketball', notes: '' })
    setShowSlotModal(true)
  }

  function openEditSlot(slot) {
    setEditingSlot(slot)
    setSlotForm({
      date: slot.date, start_time: formatTime(slot.start_time), end_time: formatTime(slot.end_time),
      venue: slot.venue, team_label: slot.team_label, sport: slot.sport || 'Basketball', notes: slot.notes || '',
    })
    setShowSlotModal(true)
  }

  async function handleSlotSubmit(e) {
    e.preventDefault()
    try {
      if (editingSlot) await updateTrainingSlot(editingSlot.id, slotForm)
      else await createTrainingSlot({ ...slotForm, competition_id: competitionId })
      setShowSlotModal(false)
      await loadSlots()
      showToastMsg(editingSlot ? t('training.slotUpdated') : t('training.slotCreated'), 'green')
    } catch (err) { alert(err.response?.data?.detail || 'Error') }
  }

  async function handleDeleteSlot(slot) {
    if (!confirm(lang === 'es' ? '¿Eliminar este slot?' : 'Delete this slot?')) return
    await deleteTrainingSlot(slot.id)
    await loadSlots()
  }

  function handleStartTimeChange(val) {
    setSlotForm(f => {
      const updated = { ...f, start_time: val }
      if (val && val.includes(':')) {
        const [h, m] = val.split(':').map(Number)
        const endMin = h * 60 + m + 90
        updated.end_time = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`
      }
      return updated
    })
  }

  // Compute conflicts for all available TDs against the assignSlot
  const tdConflictsMap = useMemo(() => {
    if (!assignSlot) return {}
    const map = {}
    const targetDate = assignSlot.date
    const targetStart = assignSlot.start_time
    const targetEnd = assignSlot.end_time

    function toMin(t) {
      if (!t) return 0
      const p = t.split(':')
      return parseInt(p[0]) * 60 + parseInt(p[1])
    }
    function overlaps(s1, e1, s2, e2) {
      return toMin(s1) < toMin(e2) && toMin(s2) < toMin(e1)
    }

    for (const td of availableTds) {
      const conflicts = []
      for (const slot of allSlots) {
        if (slot.id === assignSlot.id) continue
        if (slot.date !== targetDate) continue
        if (!slot.assignments?.some(a => a.personnel_id === td.id)) continue
        if (overlaps(slot.start_time, slot.end_time, targetStart, targetEnd)) {
          conflicts.push(`${slot.team_label} (${formatTime(slot.start_time)}-${formatTime(slot.end_time)}) @ ${slot.venue}`)
        }
      }
      if (conflicts.length > 0) map[td.id] = conflicts.join('; ')
    }
    return map
  }, [assignSlot, allSlots, availableTds])

  async function handleAssign() {
    if (!assignTdId) return
    setAssignSaving(true)
    try {
      const result = await createTrainingAssignment({ training_slot_id: assignSlot.id, personnel_id: assignTdId })
      if (result.conflict_warning) showToastMsg(`${t('training.assignedWithConflict')}: ${result.conflict_warning}`, 'yellow')
      else showToastMsg(t('training.tdAssigned'), 'green')
      setAssignTdId('')
      await loadSlots()
      setAssignSlot(null)
    } catch (err) { showToastMsg(err.response?.data?.detail || 'Error', 'red') }
    setAssignSaving(false)
  }

  async function handleRemoveAssignment(assignmentId) {
    await deleteTrainingAssignment(assignmentId)
    await loadSlots()
    showToastMsg(t('training.tdRemoved'), 'green')
    setAssignSlot(null)
  }

  function openImport() {
    setShowImport(true); setImportCompId(competitionId); setImportSport('Basketball')
    setImportFile(null); setImportPreview(null); setImportResult(null)
  }

  async function handlePreviewImport() {
    if (!importFile || !importCompId) return
    setImporting(true)
    try { setImportPreview(await previewTrainingExcel(importFile, importCompId, importSport)) }
    catch (err) { alert(err.response?.data?.detail || 'Error parsing file') }
    setImporting(false)
  }

  async function handleImportConfirm() {
    if (!importFile || !importCompId) return
    setImporting(true)
    try { setImportResult(await importTrainingExcel(importFile, importCompId, importSport)); await loadSlots() }
    catch (err) { alert(err.response?.data?.detail || 'Error importing') }
    setImporting(false)
  }

  function showToastMsg(message, color = 'green') {
    setToast({ message, color })
    setTimeout(() => setToast(null), 3500)
  }

  function prevDate() { const idx = dates.indexOf(selectedDate); if (idx > 0) setSelectedDate(dates[idx - 1]) }
  function nextDate() { const idx = dates.indexOf(selectedDate); if (idx < dates.length - 1) setSelectedDate(dates[idx + 1]) }

  function formatDateLabel(d) {
    if (!d) return ''
    const dt = new Date(d + 'T00:00:00')
    return dt.toLocaleDateString(lang === 'es' ? 'es' : 'en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="flex items-center justify-center py-20"><span className="text-fiba-muted text-sm">{t('common.loading')}</span></div>
  }

  const assignedInModal = assignSlot?.assignments || []

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-ink-900 dark:text-white">{t('training.title')}</h2>
        <div className="flex gap-2">
          {canEdit && (
            <button onClick={openImport} className="btn-fiba-ghost">
              {t('training.importExcel')}
            </button>
          )}
          {canEdit && (
            <button onClick={openCreateSlot} className="btn-fiba">
              {t('training.addSlot')}
            </button>
          )}
        </div>
      </div>

      {/* Competition selector */}
      <div className="mb-4">
        <CompetitionSearch
          competitions={competitions}
          value={competitionId}
          onChange={id => { setCompetitionId(id); setSelectedDate(''); setSelectedTeam(''); setSelectedTd('') }}
          placeholder={t('training.selectCompetition')}
          className="max-w-md"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-fiba-surface rounded-lg p-1 w-fit">
        {[{ key: 'byDay', label: t('training.byDay') }, { key: 'byTeam', label: t('training.byTeam') }, { key: 'byTd', label: t('training.byTd') }].map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === tb.key ? 'bg-fiba-accent text-white' : 'text-fiba-muted hover:text-ink-900 dark:text-white'}`}>
            {tb.label}
          </button>
        ))}
      </div>

      {!competitionId ? (
        <div className="text-center py-12 text-fiba-muted text-sm">{t('training.selectCompetition')}</div>
      ) : (
        <>
          {/* ── TAB: By Day ─────────────────────────────────────────────── */}
          {tab === 'byDay' && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <button onClick={prevDate} disabled={dates.indexOf(selectedDate) <= 0}
                  className="px-3 py-1.5 border border-fiba-border rounded-lg text-sm text-fiba-muted disabled:opacity-30 hover:bg-fiba-surface">&larr;</button>
                <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                  className="fiba-input px-3 py-1.5 text-sm" />
                <span className="text-sm font-medium text-ink-700 dark:text-gray-300">{formatDateLabel(selectedDate)}</span>
                <button onClick={nextDate} disabled={dates.indexOf(selectedDate) >= dates.length - 1}
                  className="px-3 py-1.5 border border-fiba-border rounded-lg text-sm text-fiba-muted disabled:opacity-30 hover:bg-fiba-surface">&rarr;</button>
                <button onClick={() => downloadTrainingPdf('daily', { competition_id: competitionId, date: selectedDate }).catch(err => alert(err.message))}
                  className="ml-auto px-3 py-1.5 border border-fiba-border rounded-lg text-sm text-fiba-accent hover:bg-fiba-surface">
                  {t('training.exportPdf')}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-bold text-fiba-muted mb-2 uppercase">Estadio</h3>
                  {daySlots.estadio.length === 0 ? <p className="text-xs text-fiba-muted">{t('training.noSlots')}</p> : (
                    <div className="space-y-2">
                      {daySlots.estadio.map(slot => (
                        <SlotCard key={slot.id} slot={slot} canEdit={canEdit} t={t}
                          conflictTds={slotTdConflictMap[slot.id]} isOverlapping={overlappingSlotIds.has(slot.id)}
                          onAssign={() => { setAssignSlot(slot); setAssignTdId('') }}
                          onEdit={() => openEditSlot(slot)} onDelete={() => handleDeleteSlot(slot)} />
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-fiba-muted mb-2 uppercase">{t('training.trainingCourt')}</h3>
                  {daySlots.cancha.length === 0 ? <p className="text-xs text-fiba-muted">{t('training.noSlots')}</p> : (
                    <div className="space-y-2">
                      {daySlots.cancha.map(slot => (
                        <SlotCard key={slot.id} slot={slot} canEdit={canEdit} t={t}
                          conflictTds={slotTdConflictMap[slot.id]} isOverlapping={overlappingSlotIds.has(slot.id)}
                          onAssign={() => { setAssignSlot(slot); setAssignTdId('') }}
                          onEdit={() => openEditSlot(slot)} onDelete={() => handleDeleteSlot(slot)} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── TAB: By Team ────────────────────────────────────────────── */}
          {tab === 'byTeam' && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <select value={selectedTeam} onChange={e => setSelectedTeam(e.target.value)}
                  className="fiba-select text-sm max-w-xs">
                  <option value="">{t('training.selectTeam')}</option>
                  {teams.map(team => <option key={team} value={team}>{team}</option>)}
                </select>
                {selectedTeam && (
                  <button onClick={() => downloadTrainingPdf('team', { competition_id: competitionId, team_label: selectedTeam }).catch(err => alert(err.message))}
                    className="ml-auto px-3 py-1.5 border border-fiba-border rounded-lg text-sm text-fiba-accent hover:bg-fiba-surface">
                    {t('training.exportPdf')}
                  </button>
                )}
              </div>
              {!selectedTeam ? (
                <div className="text-center py-8 text-fiba-muted text-sm">{t('training.selectTeam')}</div>
              ) : teamSlots.length === 0 ? (
                <div className="text-center py-8 text-fiba-muted text-sm">{t('training.noSlots')}</div>
              ) : (
                <div className="rounded-xl border border-fiba-border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="fiba-table">
                      <thead>
                        <tr>
                          <th>{t('training.date')}</th>
                          <th>{t('training.start')}</th>
                          <th>{t('training.end')}</th>
                          <th>{t('training.venue')}</th>
                          <th>{t('training.assignedTds')}</th>
                          {canEdit && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {teamSlots.map(slot => (
                          <tr key={slot.id} className={overlappingSlotIds.has(slot.id) ? 'bg-yellow-500/10' : ''}>
                            <td className="px-4 py-2 text-ink-900 dark:text-white">
                              {formatDateLabel(slot.date)}
                              {overlappingSlotIds.has(slot.id) && <span className="ml-1 text-yellow-400 text-xs">&#9888;</span>}
                            </td>
                            <td className="px-4 py-2 text-fiba-muted">{formatTime(slot.start_time)}</td>
                            <td className="px-4 py-2 text-fiba-muted">{formatTime(slot.end_time)}</td>
                            <td className="px-4 py-2 text-fiba-muted">{slot.venue}</td>
                            <td className="px-4 py-2">
                              <div className="flex flex-wrap gap-1">
                                {(slot.assignments || []).length === 0
                                  ? <span className="text-fiba-muted text-xs italic">{t('training.unassigned')}</span>
                                  : slot.assignments.map(a => {
                                    const inConflict = slotTdConflictMap[slot.id]?.has(a.personnel_id)
                                    return (
                                      <span key={a.id} className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${
                                        inConflict ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'
                                      }`} title={inConflict ? t('training.scheduleConflict') : ''}>
                                        {inConflict ? '\u26A0 ' : ''}{a.personnel?.name || 'TD'}
                                      </span>
                                    )
                                  })}
                              </div>
                            </td>
                            {canEdit && (
                              <td className="px-4 py-2 text-right">
                                <button onClick={() => { setAssignSlot(slot); setAssignTdId('') }} className="text-fiba-accent hover:underline text-xs mr-2">{t('training.assign')}</button>
                                <button onClick={() => openEditSlot(slot)} className="text-fiba-muted hover:underline text-xs mr-2">{t('common.edit')}</button>
                                <button onClick={() => handleDeleteSlot(slot)} className="text-red-400 hover:underline text-xs">{t('common.delete')}</button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── TAB: By TD ──────────────────────────────────────────────── */}
          {tab === 'byTd' && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <select value={selectedTd} onChange={e => setSelectedTd(e.target.value)}
                  className="fiba-select text-sm max-w-xs">
                  <option value="">{t('training.selectTd')}</option>
                  {availableTds.map(td => <option key={td.id} value={td.id}>{td.name}{td.country ? ` (${td.country})` : ''}</option>)}
                </select>
                {selectedTd && (
                  <button onClick={() => downloadTrainingPdf('competition', { competition_id: competitionId }).catch(err => alert(err.message))}
                    className="ml-auto px-3 py-1.5 border border-fiba-border rounded-lg text-sm text-fiba-accent hover:bg-fiba-surface">
                    {t('training.exportPdf')}
                  </button>
                )}
              </div>
              {!selectedTd ? (
                <div className="text-center py-8 text-fiba-muted text-sm">{t('training.selectTd')}</div>
              ) : tdSlots.length === 0 ? (
                <div className="text-center py-8 text-fiba-muted text-sm">{t('training.noSlots')}</div>
              ) : (
                <div className="rounded-xl border border-fiba-border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="fiba-table">
                      <thead>
                        <tr>
                          <th>{t('training.date')}</th>
                          <th>{t('training.start')}</th>
                          <th>{t('training.end')}</th>
                          <th>{t('training.venue')}</th>
                          <th>{t('training.team')}</th>
                          {canEdit && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {tdSlots.map(slot => (
                          <tr key={slot.id}>
                            <td className="px-4 py-2 text-ink-900 dark:text-white">{formatDateLabel(slot.date)}</td>
                            <td className="px-4 py-2 text-fiba-muted">{formatTime(slot.start_time)}</td>
                            <td className="px-4 py-2 text-fiba-muted">{formatTime(slot.end_time)}</td>
                            <td className="px-4 py-2 text-fiba-muted">{slot.venue}</td>
                            <td className="px-4 py-2 font-medium text-ink-900 dark:text-white">{slot.team_label}</td>
                            {canEdit && (
                              <td className="px-4 py-2 text-right">
                                <button onClick={() => openEditSlot(slot)} className="text-fiba-muted hover:underline text-xs mr-2">{t('common.edit')}</button>
                                <button onClick={() => handleDeleteSlot(slot)} className="text-red-400 hover:underline text-xs">{t('common.delete')}</button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── Slot Create/Edit Modal ───────────────────────────────────────── */}
      {showSlotModal && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-md p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold text-ink-900 dark:text-white">{editingSlot ? t('training.editSlot') : t('training.addSlot')}</h3>
              <button onClick={() => setShowSlotModal(false)} className="text-fiba-muted hover:text-ink-900 dark:text-white text-xl">&times;</button>
            </div>
            <form onSubmit={handleSlotSubmit} className="space-y-3">
              <div>
                <label className="fiba-label">{t('training.date')}</label>
                <input type="date" required value={slotForm.date}
                  onChange={e => setSlotForm(f => ({ ...f, date: e.target.value }))}
                  className="fiba-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="fiba-label">{t('training.start')}</label>
                  <input type="time" required step="1800" value={slotForm.start_time}
                    onChange={e => handleStartTimeChange(e.target.value)}
                    className="fiba-input" />
                </div>
                <div>
                  <label className="fiba-label">{t('training.end')}</label>
                  <input type="time" required step="1800" value={slotForm.end_time}
                    onChange={e => setSlotForm(f => ({ ...f, end_time: e.target.value }))}
                    className="fiba-input" />
                </div>
              </div>
              <div>
                <label className="fiba-label">{t('training.venue')}</label>
                <select value={slotForm.venue} onChange={e => setSlotForm(f => ({ ...f, venue: e.target.value }))}
                  className="fiba-select">
                  <option value="Estadio">Estadio</option>
                  <option value="Cancha de Entrenamiento">Cancha de Entrenamiento</option>
                </select>
              </div>
              <div>
                <label className="fiba-label">{t('training.team')}</label>
                <input type="text" required value={slotForm.team_label}
                  onChange={e => setSlotForm(f => ({ ...f, team_label: e.target.value }))}
                  className="fiba-input"
                  placeholder="ej. A1 (F), B3 (M)" />
              </div>
              <div>
                <label className="fiba-label">{t('training.sport')}</label>
                <input type="text" value={slotForm.sport}
                  onChange={e => setSlotForm(f => ({ ...f, sport: e.target.value }))}
                  className="fiba-input" />
              </div>
              <div>
                <label className="fiba-label">{t('training.notes')}</label>
                <textarea value={slotForm.notes}
                  onChange={e => setSlotForm(f => ({ ...f, notes: e.target.value }))}
                  className="fiba-input" rows={2}
                  placeholder={t('training.notesPlaceholder')} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowSlotModal(false)} className="px-4 py-2 text-sm text-fiba-muted">{t('common.cancel')}</button>
                <button type="submit" className="btn-fiba">{t('common.save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Assignment Modal ──────────────────────────────────────────── */}
      {assignSlot && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-sm p-6">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="text-sm font-bold text-ink-900 dark:text-white">{t('training.assignTd')}</h3>
                <p className="text-xs text-fiba-muted mt-0.5">
                  {formatDateLabel(assignSlot.date)} | {formatTime(assignSlot.start_time)}-{formatTime(assignSlot.end_time)} | {assignSlot.venue}
                </p>
                <p className="text-xs font-medium text-ink-700 dark:text-gray-300">{assignSlot.team_label}</p>
              </div>
              <button onClick={() => setAssignSlot(null)} className="text-fiba-muted hover:text-ink-900 dark:text-white text-xl">&times;</button>
            </div>
            {assignedInModal.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-medium text-fiba-muted mb-1">{t('training.currentTds')}</p>
                <div className="space-y-1">
                  {assignedInModal.map(a => (
                    <div key={a.id} className="flex items-center justify-between bg-blue-500/20 rounded px-2 py-1">
                      <span className="text-xs font-medium text-blue-400">{a.personnel?.name || 'TD'}</span>
                      {canEdit && (
                        <button onClick={() => handleRemoveAssignment(a.id)} className="text-red-400 hover:text-red-300 text-xs">&times;</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {canEdit && (
              <div>
                <p className="text-xs font-medium text-fiba-muted mb-1">{t('training.addTd')}</p>
                <div className="flex gap-2 mb-2">
                  <select value={assignTdId} onChange={e => setAssignTdId(e.target.value)} className="fiba-select flex-1">
                    <option value="">{t('training.selectTd')}</option>
                    {availableTds.filter(td => !assignedInModal.some(a => a.personnel_id === td.id)).map(td => (
                      <option key={td.id} value={td.id}>
                        {tdConflictsMap[td.id] ? '\u26A0\uFE0F ' : ''}{td.name}{td.country ? ` (${td.country})` : ''}
                      </option>
                    ))}
                  </select>
                  <button onClick={handleAssign} disabled={!assignTdId || assignSaving}
                    className="btn-fiba disabled:opacity-50">
                    {assignSaving ? '...' : t('training.assign')}
                  </button>
                </div>
                {assignTdId && tdConflictsMap[assignTdId] && (
                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
                    <p className="text-xs font-medium text-yellow-400">{t('training.scheduleConflict')}</p>
                    <p className="text-xs text-yellow-400/80 mt-0.5">{tdConflictsMap[assignTdId]}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Import Modal ─────────────────────────────────────────────── */}
      {showImport && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-lg p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold text-ink-900 dark:text-white">{t('training.importExcel')}</h3>
              <button onClick={() => setShowImport(false)} className="text-fiba-muted hover:text-ink-900 dark:text-white text-xl">&times;</button>
            </div>
            {importResult ? (
              <div>
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-4 mb-4">
                  <p className="text-sm font-medium text-emerald-400">
                    {importResult.imported} {t('training.slotsImported')}, {importResult.skipped} {t('training.slotsSkipped')}
                  </p>
                  {importResult.errors?.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs text-red-400 font-medium">{t('training.errors')}:</p>
                      {importResult.errors.map((e, i) => <p key={i} className="text-xs text-red-400">{e.team_label}: {e.error}</p>)}
                    </div>
                  )}
                </div>
                <div className="flex justify-end">
                  <button onClick={() => setShowImport(false)} className="btn-fiba">{t('common.confirm')}</button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="fiba-label">{t('training.selectCompetition')}</label>
                  <select value={importCompId} onChange={e => setImportCompId(e.target.value)} className="fiba-select">
                    {competitions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="fiba-label">{t('training.sport')}</label>
                  <input type="text" value={importSport} onChange={e => setImportSport(e.target.value)} className="fiba-input" />
                </div>
                <div>
                  <label className="fiba-label">{t('training.file')}</label>
                  <div className="border-2 border-dashed border-fiba-border rounded-lg p-6 text-center cursor-pointer hover:border-fiba-accent transition-colors"
                    onClick={() => fileRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); setImportFile(e.dataTransfer.files[0]); setImportPreview(null) }}>
                    <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                      onChange={e => { setImportFile(e.target.files[0]); setImportPreview(null) }} />
                    {importFile
                      ? <p className="text-sm text-emerald-400 font-medium">{importFile.name}</p>
                      : <p className="text-sm text-fiba-muted">{t('training.dragOrClick')}</p>}
                  </div>
                </div>
                {importPreview && (
                  <div className="bg-fiba-surface rounded-lg p-3">
                    <p className="text-xs font-medium text-fiba-muted mb-2">{t('training.preview')}: {importPreview.total} slots</p>
                    <div className="max-h-40 overflow-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="text-fiba-muted"><th className="text-left px-2 py-1">{t('training.date')}</th><th className="text-left px-2 py-1">{t('training.start')}</th><th className="text-left px-2 py-1">{t('training.venue')}</th><th className="text-left px-2 py-1">{t('training.team')}</th></tr></thead>
                        <tbody>
                          {importPreview.preview.map((s, i) => (
                            <tr key={i} className="border-t border-fiba-border text-ink-700 dark:text-gray-300"><td className="px-2 py-1">{s.date}</td><td className="px-2 py-1">{s.start_time}</td><td className="px-2 py-1">{s.venue}</td><td className="px-2 py-1">{s.team_label}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowImport(false)} className="px-4 py-2 text-sm text-fiba-muted">{t('common.cancel')}</button>
                  {!importPreview ? (
                    <button onClick={handlePreviewImport} disabled={!importFile || importing}
                      className="btn-fiba-ghost disabled:opacity-50">
                      {importing ? t('training.parsing') : t('training.preview')}
                    </button>
                  ) : (
                    <button onClick={handleImportConfirm} disabled={importing}
                      className="btn-fiba disabled:opacity-50">
                      {importing ? t('training.importing') : t('training.confirmImport')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-lg shadow-lg text-sm font-medium text-ink-900 dark:text-white ${
          toast.color === 'green' ? 'bg-green-600' : toast.color === 'yellow' ? 'bg-yellow-500' : 'bg-red-600'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  )
}

// ── SlotCard — defined OUTSIDE Training to avoid re-mount on parent re-render ──
function SlotCard({ slot, canEdit, t, conflictTds, isOverlapping, onAssign, onEdit, onDelete }) {
  const assigned = slot.assignments || []
  const hasTdConflicts = conflictTds && conflictTds.size > 0
  const hasAnyConflict = hasTdConflicts || isOverlapping
  return (
    <div className={`bg-fiba-card border-2 rounded-lg p-3 hover:shadow-sm transition-shadow cursor-pointer ${
      hasTdConflicts ? 'border-red-500/50 bg-red-500/5' : isOverlapping ? 'border-yellow-500/50 bg-yellow-500/5' : 'border-fiba-border'
    }`}
      onClick={() => canEdit ? onAssign() : null}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-fiba-accent">
            {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
          </span>
          {isOverlapping && !hasTdConflicts && (
            <span className="text-yellow-400 text-xs font-bold" title={t('training.timeOverlap')}>&#9888; {t('training.timeOverlap')}</span>
          )}
          {hasTdConflicts && (
            <span className="text-red-400 text-xs font-bold" title={t('training.scheduleConflict')}>&#9888; {t('training.scheduleConflict')}</span>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-1">
            <button onClick={e => { e.stopPropagation(); onEdit() }} className="text-fiba-muted hover:text-fiba-accent text-xs px-1">{t('common.edit')}</button>
            <button onClick={e => { e.stopPropagation(); onDelete() }} className="text-fiba-muted hover:text-red-400 text-xs px-1">{t('common.delete')}</button>
          </div>
        )}
      </div>
      <div className="text-sm font-bold text-ink-900 dark:text-white mb-1">{slot.team_label}</div>
      <div className="flex flex-wrap gap-1">
        {assigned.length === 0
          ? <span className="text-[11px] text-fiba-muted italic">{t('training.unassigned')}</span>
          : assigned.map(a => {
            const inConflict = conflictTds?.has(a.personnel_id)
            return (
              <span key={a.id} className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${
                inConflict ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'
              }`} title={inConflict ? t('training.scheduleConflict') : ''}>
                {inConflict ? '\u26A0 ' : ''}{a.personnel?.name || 'TD'}
              </span>
            )
          })}
      </div>
      {slot.notes && <p className="text-[11px] text-fiba-muted mt-1">{slot.notes}</p>}
    </div>
  )
}
