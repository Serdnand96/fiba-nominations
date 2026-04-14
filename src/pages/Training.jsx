import { useState, useEffect, useMemo, useRef } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'
import {
  getCalendarCompetitions, getPersonnel, getCompetitionAvailability,
  getTrainingSlots, createTrainingSlot, updateTrainingSlot,
  deleteTrainingSlot, createTrainingAssignment, deleteTrainingAssignment,
  importTrainingExcel, previewTrainingExcel, getTrainingPdfUrl,
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

  // Compute per-slot conflict map: which TDs in each slot have overlapping assignments
  const slotConflictMap = useMemo(() => {
    const map = {} // slot_id -> Set of personnel_ids with conflicts
    function toMin(t) { const p = t.split(':'); return parseInt(p[0]) * 60 + parseInt(p[1]) }
    function overlaps(s1, e1, s2, e2) { return toMin(s1) < toMin(e2) && toMin(s2) < toMin(e1) }

    for (const slot of allSlots) {
      if (!slot.assignments?.length) continue
      const conflictIds = new Set()
      for (const asn of slot.assignments) {
        const pid = asn.personnel_id
        // Check if this TD has other overlapping slots on same date
        for (const other of allSlots) {
          if (other.id === slot.id) continue
          if (other.date !== slot.date) continue
          if (!other.assignments?.some(a => a.personnel_id === pid)) continue
          if (overlaps(slot.start_time, slot.end_time, other.start_time, other.end_time)) {
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
    return <div className="flex items-center justify-center py-20"><span className="text-gray-400 text-sm">{t('common.loading')}</span></div>
  }

  const assignedInModal = assignSlot?.assignments || []

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">{t('training.title')}</h2>
        <div className="flex gap-2">
          {canEdit && (
            <button onClick={openImport} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">
              {t('training.importExcel')}
            </button>
          )}
          {canEdit && (
            <button onClick={openCreateSlot} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
              {t('training.addSlot')}
            </button>
          )}
        </div>
      </div>

      {/* Competition selector */}
      <div className="mb-4">
        <select value={competitionId} onChange={e => { setCompetitionId(e.target.value); setSelectedDate(''); setSelectedTeam(''); setSelectedTd('') }}
          className="px-3 py-2 border rounded-lg text-sm w-full max-w-md">
          <option value="">{t('training.selectCompetition')}</option>
          {competitions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {[{ key: 'byDay', label: t('training.byDay') }, { key: 'byTeam', label: t('training.byTeam') }, { key: 'byTd', label: t('training.byTd') }].map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === tb.key ? 'bg-white shadow text-blue-700' : 'text-gray-600 hover:text-gray-900'}`}>
            {tb.label}
          </button>
        ))}
      </div>

      {!competitionId ? (
        <div className="text-center py-12 text-gray-400 text-sm">{t('training.selectCompetition')}</div>
      ) : (
        <>
          {/* ── TAB: By Day ─────────────────────────────────────────────── */}
          {tab === 'byDay' && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <button onClick={prevDate} disabled={dates.indexOf(selectedDate) <= 0}
                  className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-30 hover:bg-gray-50">&larr;</button>
                <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
                  className="px-3 py-1.5 border rounded-lg text-sm" />
                <span className="text-sm font-medium text-gray-700">{formatDateLabel(selectedDate)}</span>
                <button onClick={nextDate} disabled={dates.indexOf(selectedDate) >= dates.length - 1}
                  className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-30 hover:bg-gray-50">&rarr;</button>
                <a href={getTrainingPdfUrl('daily', { competition_id: competitionId, date: selectedDate })}
                  target="_blank" rel="noopener noreferrer"
                  className="ml-auto px-3 py-1.5 border rounded-lg text-sm text-blue-600 hover:bg-blue-50">
                  {t('training.exportPdf')}
                </a>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-bold text-gray-600 mb-2 uppercase">Estadio</h3>
                  {daySlots.estadio.length === 0 ? <p className="text-xs text-gray-400">{t('training.noSlots')}</p> : (
                    <div className="space-y-2">
                      {daySlots.estadio.map(slot => (
                        <SlotCard key={slot.id} slot={slot} canEdit={canEdit} t={t}
                          conflictTds={slotConflictMap[slot.id]}
                          onAssign={() => { setAssignSlot(slot); setAssignTdId('') }}
                          onEdit={() => openEditSlot(slot)} onDelete={() => handleDeleteSlot(slot)} />
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-600 mb-2 uppercase">{t('training.trainingCourt')}</h3>
                  {daySlots.cancha.length === 0 ? <p className="text-xs text-gray-400">{t('training.noSlots')}</p> : (
                    <div className="space-y-2">
                      {daySlots.cancha.map(slot => (
                        <SlotCard key={slot.id} slot={slot} canEdit={canEdit} t={t}
                          conflictTds={slotConflictMap[slot.id]}
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
                  className="px-3 py-2 border rounded-lg text-sm max-w-xs">
                  <option value="">{t('training.selectTeam')}</option>
                  {teams.map(team => <option key={team} value={team}>{team}</option>)}
                </select>
                {selectedTeam && (
                  <a href={getTrainingPdfUrl('team', { competition_id: competitionId, team_label: selectedTeam })}
                    target="_blank" rel="noopener noreferrer"
                    className="ml-auto px-3 py-1.5 border rounded-lg text-sm text-blue-600 hover:bg-blue-50">
                    {t('training.exportPdf')}
                  </a>
                )}
              </div>
              {!selectedTeam ? (
                <div className="text-center py-8 text-gray-400 text-sm">{t('training.selectTeam')}</div>
              ) : teamSlots.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">{t('training.noSlots')}</div>
              ) : (
                <div className="bg-white rounded-lg border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('training.date')}</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('training.start')}</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('training.end')}</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('training.venue')}</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('training.assignedTds')}</th>
                          {canEdit && <th className="px-4 py-2"></th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {teamSlots.map(slot => (
                          <tr key={slot.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-800">{formatDateLabel(slot.date)}</td>
                            <td className="px-4 py-2 text-gray-600">{formatTime(slot.start_time)}</td>
                            <td className="px-4 py-2 text-gray-600">{formatTime(slot.end_time)}</td>
                            <td className="px-4 py-2 text-gray-600">{slot.venue}</td>
                            <td className="px-4 py-2">
                              <div className="flex flex-wrap gap-1">
                                {(slot.assignments || []).length === 0
                                  ? <span className="text-gray-400 text-xs italic">{t('training.unassigned')}</span>
                                  : slot.assignments.map(a => {
                                    const inConflict = slotConflictMap[slot.id]?.has(a.personnel_id)
                                    return (
                                      <span key={a.id} className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${
                                        inConflict ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-50 text-blue-700'
                                      }`} title={inConflict ? t('training.scheduleConflict') : ''}>
                                        {inConflict ? '\u26A0 ' : ''}{a.personnel?.name || 'TD'}
                                      </span>
                                    )
                                  })}
                              </div>
                            </td>
                            {canEdit && (
                              <td className="px-4 py-2 text-right">
                                <button onClick={() => { setAssignSlot(slot); setAssignTdId('') }} className="text-blue-600 hover:underline text-xs mr-2">{t('training.assign')}</button>
                                <button onClick={() => openEditSlot(slot)} className="text-gray-500 hover:underline text-xs mr-2">{t('common.edit')}</button>
                                <button onClick={() => handleDeleteSlot(slot)} className="text-red-500 hover:underline text-xs">{t('common.delete')}</button>
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
                  className="px-3 py-2 border rounded-lg text-sm max-w-xs">
                  <option value="">{t('training.selectTd')}</option>
                  {availableTds.map(td => <option key={td.id} value={td.id}>{td.name}{td.country ? ` (${td.country})` : ''}</option>)}
                </select>
                {selectedTd && (
                  <a href={getTrainingPdfUrl('competition', { competition_id: competitionId })}
                    target="_blank" rel="noopener noreferrer"
                    className="ml-auto px-3 py-1.5 border rounded-lg text-sm text-blue-600 hover:bg-blue-50">
                    {t('training.exportPdf')}
                  </a>
                )}
              </div>
              {!selectedTd ? (
                <div className="text-center py-8 text-gray-400 text-sm">{t('training.selectTd')}</div>
              ) : tdSlots.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-sm">{t('training.noSlots')}</div>
              ) : (
                <div className="bg-white rounded-lg border overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('training.date')}</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('training.start')}</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('training.end')}</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('training.venue')}</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{t('training.team')}</th>
                          {canEdit && <th className="px-4 py-2"></th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {tdSlots.map(slot => (
                          <tr key={slot.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-800">{formatDateLabel(slot.date)}</td>
                            <td className="px-4 py-2 text-gray-600">{formatTime(slot.start_time)}</td>
                            <td className="px-4 py-2 text-gray-600">{formatTime(slot.end_time)}</td>
                            <td className="px-4 py-2 text-gray-600">{slot.venue}</td>
                            <td className="px-4 py-2 font-medium text-gray-800">{slot.team_label}</td>
                            {canEdit && (
                              <td className="px-4 py-2 text-right">
                                <button onClick={() => openEditSlot(slot)} className="text-gray-500 hover:underline text-xs mr-2">{t('common.edit')}</button>
                                <button onClick={() => handleDeleteSlot(slot)} className="text-red-500 hover:underline text-xs">{t('common.delete')}</button>
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold">{editingSlot ? t('training.editSlot') : t('training.addSlot')}</h3>
              <button onClick={() => setShowSlotModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <form onSubmit={handleSlotSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('training.date')}</label>
                <input type="date" required value={slotForm.date}
                  onChange={e => setSlotForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('training.start')}</label>
                  <input type="time" required step="1800" value={slotForm.start_time}
                    onChange={e => handleStartTimeChange(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('training.end')}</label>
                  <input type="time" required step="1800" value={slotForm.end_time}
                    onChange={e => setSlotForm(f => ({ ...f, end_time: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('training.venue')}</label>
                <select value={slotForm.venue} onChange={e => setSlotForm(f => ({ ...f, venue: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm">
                  <option value="Estadio">Estadio</option>
                  <option value="Cancha de Entrenamiento">Cancha de Entrenamiento</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('training.team')}</label>
                <input type="text" required value={slotForm.team_label}
                  onChange={e => setSlotForm(f => ({ ...f, team_label: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  placeholder="ej. A1 (F), B3 (M)" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('training.sport')}</label>
                <input type="text" value={slotForm.sport}
                  onChange={e => setSlotForm(f => ({ ...f, sport: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('training.notes')}</label>
                <textarea value={slotForm.notes}
                  onChange={e => setSlotForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 border rounded-lg text-sm" rows={2}
                  placeholder={t('training.notesPlaceholder')} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowSlotModal(false)} className="px-4 py-2 text-sm text-gray-600">{t('common.cancel')}</button>
                <button type="submit" className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">{t('common.save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Assignment Modal ──────────────────────────────────────────── */}
      {assignSlot && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="text-sm font-bold text-gray-900">{t('training.assignTd')}</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  {formatDateLabel(assignSlot.date)} | {formatTime(assignSlot.start_time)}-{formatTime(assignSlot.end_time)} | {assignSlot.venue}
                </p>
                <p className="text-xs font-medium text-gray-700">{assignSlot.team_label}</p>
              </div>
              <button onClick={() => setAssignSlot(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            {assignedInModal.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-medium text-gray-500 mb-1">{t('training.currentTds')}</p>
                <div className="space-y-1">
                  {assignedInModal.map(a => (
                    <div key={a.id} className="flex items-center justify-between bg-blue-50 rounded px-2 py-1">
                      <span className="text-xs font-medium text-blue-800">{a.personnel?.name || 'TD'}</span>
                      {canEdit && (
                        <button onClick={() => handleRemoveAssignment(a.id)} className="text-red-400 hover:text-red-600 text-xs">&times;</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {canEdit && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">{t('training.addTd')}</p>
                <div className="flex gap-2 mb-2">
                  <select value={assignTdId} onChange={e => setAssignTdId(e.target.value)} className="flex-1 px-3 py-2 border rounded-lg text-sm">
                    <option value="">{t('training.selectTd')}</option>
                    {availableTds.filter(td => !assignedInModal.some(a => a.personnel_id === td.id)).map(td => (
                      <option key={td.id} value={td.id}>
                        {tdConflictsMap[td.id] ? '\u26A0\uFE0F ' : ''}{td.name}{td.country ? ` (${td.country})` : ''}
                      </option>
                    ))}
                  </select>
                  <button onClick={handleAssign} disabled={!assignTdId || assignSaving}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {assignSaving ? '...' : t('training.assign')}
                  </button>
                </div>
                {assignTdId && tdConflictsMap[assignTdId] && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                    <p className="text-xs font-medium text-yellow-800">{t('training.scheduleConflict')}</p>
                    <p className="text-xs text-yellow-700 mt-0.5">{tdConflictsMap[assignTdId]}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Import Modal ─────────────────────────────────────────────── */}
      {showImport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold">{t('training.importExcel')}</h3>
              <button onClick={() => setShowImport(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            {importResult ? (
              <div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                  <p className="text-sm font-medium text-green-800">
                    {importResult.imported} {t('training.slotsImported')}, {importResult.skipped} {t('training.slotsSkipped')}
                  </p>
                  {importResult.errors?.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs text-red-600 font-medium">{t('training.errors')}:</p>
                      {importResult.errors.map((e, i) => <p key={i} className="text-xs text-red-500">{e.team_label}: {e.error}</p>)}
                    </div>
                  )}
                </div>
                <div className="flex justify-end">
                  <button onClick={() => setShowImport(false)} className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">{t('common.confirm')}</button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('training.selectCompetition')}</label>
                  <select value={importCompId} onChange={e => setImportCompId(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                    {competitions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('training.sport')}</label>
                  <input type="text" value={importSport} onChange={e => setImportSport(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('training.file')}</label>
                  <div className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 transition-colors"
                    onClick={() => fileRef.current?.click()}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); setImportFile(e.dataTransfer.files[0]); setImportPreview(null) }}>
                    <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
                      onChange={e => { setImportFile(e.target.files[0]); setImportPreview(null) }} />
                    {importFile
                      ? <p className="text-sm text-green-700 font-medium">{importFile.name}</p>
                      : <p className="text-sm text-gray-400">{t('training.dragOrClick')}</p>}
                  </div>
                </div>
                {importPreview && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs font-medium text-gray-600 mb-2">{t('training.preview')}: {importPreview.total} slots</p>
                    <div className="max-h-40 overflow-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="text-gray-500"><th className="text-left px-2 py-1">{t('training.date')}</th><th className="text-left px-2 py-1">{t('training.start')}</th><th className="text-left px-2 py-1">{t('training.venue')}</th><th className="text-left px-2 py-1">{t('training.team')}</th></tr></thead>
                        <tbody>
                          {importPreview.preview.map((s, i) => (
                            <tr key={i} className="border-t"><td className="px-2 py-1">{s.date}</td><td className="px-2 py-1">{s.start_time}</td><td className="px-2 py-1">{s.venue}</td><td className="px-2 py-1">{s.team_label}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowImport(false)} className="px-4 py-2 text-sm text-gray-600">{t('common.cancel')}</button>
                  {!importPreview ? (
                    <button onClick={handlePreviewImport} disabled={!importFile || importing}
                      className="bg-gray-700 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50">
                      {importing ? t('training.parsing') : t('training.preview')}
                    </button>
                  ) : (
                    <button onClick={handleImportConfirm} disabled={importing}
                      className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
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
        <div className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-lg shadow-lg text-sm font-medium text-white ${
          toast.color === 'green' ? 'bg-green-600' : toast.color === 'yellow' ? 'bg-yellow-500' : 'bg-red-600'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  )
}

// ── SlotCard — defined OUTSIDE Training to avoid re-mount on parent re-render ──
function SlotCard({ slot, canEdit, t, conflictTds, onAssign, onEdit, onDelete }) {
  const assigned = slot.assignments || []
  const hasConflicts = conflictTds && conflictTds.size > 0
  return (
    <div className={`bg-white border rounded-lg p-3 hover:shadow-sm transition-shadow cursor-pointer ${hasConflicts ? 'border-yellow-400' : ''}`}
      onClick={() => canEdit ? onAssign() : null}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-blue-600">
            {formatTime(slot.start_time)} – {formatTime(slot.end_time)}
          </span>
          {hasConflicts && (
            <span className="text-yellow-600 text-xs" title={t('training.scheduleConflict')}>&#9888;</span>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-1">
            <button onClick={e => { e.stopPropagation(); onEdit() }} className="text-gray-400 hover:text-blue-600 text-xs px-1">{t('common.edit')}</button>
            <button onClick={e => { e.stopPropagation(); onDelete() }} className="text-gray-400 hover:text-red-600 text-xs px-1">{t('common.delete')}</button>
          </div>
        )}
      </div>
      <div className="text-sm font-bold text-gray-900 mb-1">{slot.team_label}</div>
      <div className="flex flex-wrap gap-1">
        {assigned.length === 0
          ? <span className="text-[11px] text-gray-400 italic">{t('training.unassigned')}</span>
          : assigned.map(a => {
            const inConflict = conflictTds?.has(a.personnel_id)
            return (
              <span key={a.id} className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${
                inConflict ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-50 text-blue-700'
              }`} title={inConflict ? t('training.scheduleConflict') : ''}>
                {inConflict ? '\u26A0 ' : ''}{a.personnel?.name || 'TD'}
              </span>
            )
          })}
      </div>
      {slot.notes && <p className="text-[11px] text-gray-400 mt-1">{slot.notes}</p>}
    </div>
  )
}
