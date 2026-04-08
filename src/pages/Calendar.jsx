import { useState, useEffect, useRef } from 'react'
import {
  getCalendarCompetitions, getCalendarCompetition,
  createCalendarEvent, updateCalendarEvent, deleteCalendarEvent,
  assignStaff, removeAssignment, getPersonnel,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'

const COMP_TYPES = [
  { key: 'All', label: 'All' },
  { key: 'BCLA', label: 'BCLA', color: '#185FA5' },
  { key: 'WCQ', label: 'WCQ', color: '#3B6D11' },
  { key: 'LSB', label: 'LSB', color: '#534AB7' },
  { key: 'LSBF', label: 'LSBF', color: '#993556' },
  { key: 'WBLA', label: 'WBLA', color: '#BA7517' },
  { key: 'AmeriCup', label: 'AmeriCup', color: '#993C1D' },
  { key: 'U-Series', label: 'U-Series', color: '#0F6E56' },
  { key: '3x3', label: '3x3', color: '#5F5E5A' },
]
const TYPE_COLORS = Object.fromEntries(COMP_TYPES.filter(t => t.color).map(t => [t.key, t.color]))
function getTypeColor(type) { return TYPE_COLORS[type] || '#6B7280' }

const TEMPLATE_MAP = {
  'BCLA': 'BCLA_RS', 'WCQ': 'WCQ', 'LSB': 'LSB', 'LSBF': 'LSB',
  'WBLA': 'GENERIC', 'AmeriCup': 'GENERIC', 'U-Series': 'GENERIC',
  '3x3': 'GENERIC', 'Other': 'GENERIC',
}

function groupByMonth(events) {
  const months = Array.from({ length: 12 }, () => [])
  events.forEach(ev => {
    const m = ev.month ? ev.month - 1 : (ev.start_date ? new Date(ev.start_date + 'T00:00:00').getMonth() : 0)
    if (m >= 0 && m < 12) months[m].push(ev)
  })
  return months
}

function getDaysInMonth(year, month) { return new Date(year, month + 1, 0).getDate() }
function getFirstDayOfMonth(year, month) { return new Date(year, month, 1).getDay() }

function getEventsForDay(events, year, month, day) {
  const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return events.filter(ev => {
    if (ev.is_tbd || !ev.start_date || !ev.end_date) return false
    return dateStr >= ev.start_date && dateStr <= ev.end_date
  })
}

export default function Calendar() {
  const { t, lang } = useLanguage()
  const MONTHS = t('months.names')
  const MONTHS_SHORT = t('months.short')
  const DAYS = t('months.days')

  const [competitions, setCompetitions] = useState([])
  const [filter, setFilter] = useState('All')
  const [view, setView] = useState('year')
  const [calMonth, setCalMonth] = useState(new Date().getMonth())
  const [calYear, setCalYear] = useState(2026)

  const [selectedEvent, setSelectedEvent] = useState(null)
  const [panelData, setPanelData] = useState(null)
  const [panelLoading, setPanelLoading] = useState(false)
  const [personnel, setPersonnel] = useState([])
  const [staffSearch, setStaffSearch] = useState('')
  const [selectedPerson, setSelectedPerson] = useState(null)
  const [selectedRole, setSelectedRole] = useState('VGO')
  const [assigning, setAssigning] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef(null)

  const [showEventModal, setShowEventModal] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [eventForm, setEventForm] = useState({
    name: '', short_name: '', competition_type: 'BCLA', template_key: 'BCLA_RS',
    year: 2026, month: 1, start_date: '', end_date: '', location: '', is_tbd: false,
  })

  function formatDateRange(ev) {
    if (ev.is_tbd || !ev.start_date) return null
    const s = new Date(ev.start_date + 'T00:00:00'), e = new Date(ev.end_date + 'T00:00:00')
    const sm = MONTHS_SHORT[s.getMonth()], em = MONTHS_SHORT[e.getMonth()]
    if (s.getMonth() === e.getMonth()) return `${sm} ${s.getDate()}–${e.getDate()}`
    return `${sm} ${s.getDate()} – ${em} ${e.getDate()}`
  }

  function formatFullDate(ev) {
    if (ev.is_tbd || !ev.start_date) return t('calendar.tbd')
    const locale = lang === 'es' ? 'es' : 'en-US'
    const opts = { day: 'numeric', month: 'long', year: 'numeric' }
    return `${new Date(ev.start_date + 'T00:00:00').toLocaleDateString(locale, opts)} – ${new Date(ev.end_date + 'T00:00:00').toLocaleDateString(locale, opts)}`
  }

  useEffect(() => { load() }, [filter])

  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function load() {
    try {
      const params = filter !== 'All' ? { type: filter } : {}
      setCompetitions(await getCalendarCompetitions(params))
    } catch { setCompetitions([]) }
  }

  async function openPanel(event) {
    setSelectedEvent(event)
    setPanelLoading(true)
    setStaffSearch(''); setSelectedPerson(null); setSelectedRole('VGO')
    try {
      const [detail, pers] = await Promise.all([
        getCalendarCompetition(event.id),
        personnel.length ? Promise.resolve(personnel) : getPersonnel(),
      ])
      setPanelData(detail)
      if (!personnel.length) setPersonnel(pers)
    } catch { setPanelData(event) }
    setPanelLoading(false)
  }
  function closePanel() { setSelectedEvent(null); setPanelData(null) }

  async function handleAssign() {
    if (!selectedPerson || !panelData) return
    setAssigning(true)
    try {
      await assignStaff(panelData.id, { personnel_id: selectedPerson.id, role: selectedRole })
      setPanelData(await getCalendarCompetition(panelData.id))
      setSelectedPerson(null); setStaffSearch('')
      await load()
    } catch (err) { alert(err.response?.data?.detail || t('calendar.errorAssigning')) }
    setAssigning(false)
  }

  async function handleRemoveAssignment(assignmentId) {
    if (!confirm(t('calendar.confirmRemoveAssignment'))) return
    try {
      await removeAssignment(assignmentId)
      setPanelData(await getCalendarCompetition(panelData.id))
      await load()
    } catch (err) { alert(err.response?.data?.detail || t('common.error')) }
  }

  function openCreateEvent() {
    setEditingEvent(null)
    setEventForm({
      name: '', short_name: '', competition_type: 'BCLA', template_key: 'BCLA_RS',
      year: calYear, month: calMonth + 1, start_date: '', end_date: '', location: '', is_tbd: false,
    })
    setShowEventModal(true)
  }

  function openEditEvent(ev) {
    setEditingEvent(ev)
    setEventForm({
      name: ev.name || '', short_name: ev.short_name || '',
      competition_type: ev.competition_type || 'BCLA',
      template_key: ev.template_key || 'GENERIC',
      year: ev.year || 2026, month: ev.month || 1,
      start_date: ev.start_date || '', end_date: ev.end_date || '',
      location: ev.location || '', is_tbd: ev.is_tbd || false,
    })
    setShowEventModal(true)
  }

  async function handleEventSubmit(e) {
    e.preventDefault()
    const payload = { ...eventForm, year: parseInt(eventForm.year), month: parseInt(eventForm.month) }
    if (payload.is_tbd) { payload.start_date = null; payload.end_date = null }
    try {
      if (editingEvent) {
        await updateCalendarEvent(editingEvent.id, payload)
      } else {
        await createCalendarEvent(payload)
      }
      setShowEventModal(false)
      await load()
    } catch (err) { alert(err.response?.data?.detail || t('calendar.errorSaving')) }
  }

  async function handleDeleteEvent(ev) {
    if (!confirm(`${t('calendar.confirmDelete')} "${ev.name}"?`)) return
    try {
      await deleteCalendarEvent(ev.id)
      closePanel()
      await load()
    } catch (err) { alert(err.response?.data?.detail || t('calendar.errorDeleting')) }
  }

  function handleTypeChange(type) {
    const tmpl = TEMPLATE_MAP[type] || 'GENERIC'
    setEventForm(f => ({ ...f, competition_type: type, template_key: tmpl }))
  }

  const monthGroups = groupByMonth(competitions)
  const filteredPersonnel = personnel.filter(p =>
    (p.name || '').toLowerCase().includes(staffSearch.toLowerCase())
  )

  const daysInMonth = getDaysInMonth(calYear, calMonth)
  const firstDay = getFirstDayOfMonth(calYear, calMonth)
  const calendarDays = []
  for (let i = 0; i < firstDay; i++) calendarDays.push(null)
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d)

  function prevMonth() {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) }
    else setCalMonth(m => m - 1)
  }
  function nextMonth() {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) }
    else setCalMonth(m => m + 1)
  }

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-900">{t('calendar.title')}</h2>
        <div className="flex gap-2">
          <button onClick={openCreateEvent} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            {t('calendar.newEvent')}
          </button>
        </div>
      </div>

      {/* View toggle + filters */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          <button onClick={() => setView('year')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === 'year' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
            {t('calendar.year')}
          </button>
          <button onClick={() => setView('month')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${view === 'month' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
            {t('calendar.month')}
          </button>
        </div>

        {view === 'month' && (
          <div className="flex items-center gap-2">
            <button onClick={prevMonth} className="p-1 rounded hover:bg-gray-100">
              <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <span className="text-sm font-semibold text-gray-700 w-40 text-center">{MONTHS[calMonth]} {calYear}</span>
            <button onClick={nextMonth} className="p-1 rounded hover:bg-gray-100">
              <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-6">
        {COMP_TYPES.map(ct => (
          <button key={ct.key} onClick={() => setFilter(ct.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${filter === ct.key ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
            style={filter === ct.key ? { backgroundColor: ct.color || '#374151', borderColor: ct.color || '#374151' } : {}}>
            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
              style={{ backgroundColor: filter === ct.key ? '#fff' : (ct.color || '#9CA3AF') }} />
            {ct.label}
          </button>
        ))}
      </div>

      {/* ===== YEAR VIEW ===== */}
      {view === 'year' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {MONTHS.map((monthName, idx) => {
            const events = monthGroups[idx] || []
            return (
              <div key={idx} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                  <h3 className="text-sm font-semibold text-gray-700">{monthName}</h3>
                  <span className="text-xs text-gray-400">{events.length} {events.length !== 1 ? t('calendar.events') : t('calendar.event')}</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {events.length === 0 && <div className="px-4 py-6 text-center text-xs text-gray-300">{t('calendar.noEvents')}</div>}
                  {events.map(ev => (
                    <button key={ev.id} onClick={() => openPanel(ev)}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors flex items-center gap-3 group">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getTypeColor(ev.competition_type) }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate group-hover:text-blue-700">{ev.short_name || ev.name}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {formatDateRange(ev) ? (
                            <span className="text-xs text-gray-400">{formatDateRange(ev)}</span>
                          ) : (
                            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">TBD</span>
                          )}
                          {ev.assignment_count > 0 && (
                            <span className="text-xs text-blue-500">{ev.assignment_count} {ev.assignment_count > 1 ? t('calendar.assignedPlural') : t('calendar.assigned')}</span>
                          )}
                        </div>
                      </div>
                      <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ===== MONTH VIEW (Calendar Grid) ===== */}
      {view === 'month' && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-7 border-b border-gray-200">
            {DAYS.map(d => (
              <div key={d} className="px-2 py-2 text-center text-xs font-medium text-gray-500 bg-gray-50">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {calendarDays.map((day, i) => {
              if (day === null) return <div key={`empty-${i}`} className="min-h-[100px] border-b border-r border-gray-100 bg-gray-50/50" />
              const dayEvents = getEventsForDay(competitions, calYear, calMonth, day)
              const today = new Date()
              const isToday = day === today.getDate() && calMonth === today.getMonth() && calYear === today.getFullYear()
              return (
                <div key={day} className="min-h-[100px] border-b border-r border-gray-100 p-1">
                  <div className={`text-xs font-medium mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? 'bg-red-500 text-white' : 'text-gray-500'}`}>
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map(ev => (
                      <button key={ev.id} onClick={() => openPanel(ev)}
                        className="w-full text-left px-1 py-0.5 rounded text-[10px] font-medium truncate hover:opacity-80 transition-opacity text-white"
                        style={{ backgroundColor: getTypeColor(ev.competition_type) }}
                        title={ev.name}>
                        {ev.short_name || ev.name}
                      </button>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[10px] text-gray-400 px-1">+{dayEvents.length - 3} {t('calendar.more')}</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {(() => {
            const tbdEvents = (monthGroups[calMonth] || []).filter(ev => ev.is_tbd)
            if (tbdEvents.length === 0) return null
            return (
              <div className="border-t border-gray-200 px-4 py-3">
                <h4 className="text-xs font-semibold text-gray-500 mb-2">{t('calendar.tbd')}</h4>
                <div className="flex flex-wrap gap-2">
                  {tbdEvents.map(ev => (
                    <button key={ev.id} onClick={() => openPanel(ev)}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border border-gray-200 hover:bg-gray-50 transition-colors">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getTypeColor(ev.competition_type) }} />
                      {ev.short_name || ev.name}
                    </button>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ===== SIDE PANEL ===== */}
      {selectedEvent && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={closePanel} />
          <div className="fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col animate-slide-in">
            <div className="flex items-start justify-between p-6 border-b border-gray-200">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium text-white"
                    style={{ backgroundColor: getTypeColor(panelData?.competition_type || selectedEvent.competition_type) }}>
                    {panelData?.competition_type || selectedEvent.competition_type}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-gray-900">{panelData?.name || selectedEvent.name}</h3>
                <p className="text-sm text-gray-500 mt-1">{formatFullDate(panelData || selectedEvent)}</p>
                {(panelData?.location || selectedEvent.location) && (
                  <p className="text-sm text-gray-400 mt-0.5">{panelData?.location || selectedEvent.location}</p>
                )}
              </div>
              <div className="flex gap-1 ml-4">
                <button onClick={() => { closePanel(); openEditEvent(panelData || selectedEvent) }}
                  className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-blue-600" title={t('calendar.edit')}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                </button>
                <button onClick={() => handleDeleteEvent(panelData || selectedEvent)}
                  className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600" title={t('calendar.delete')}>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
                <button onClick={closePanel}
                  className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            {panelLoading ? (
              <div className="flex-1 flex items-center justify-center"><span className="text-sm text-gray-400">{t('common.loading')}</span></div>
            ) : (
              <div className="flex-1 overflow-auto p-6 space-y-6">
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">{t('calendar.assignedStaff')}</h4>
                  {(!panelData?.assignments || panelData.assignments.length === 0) ? (
                    <p className="text-sm text-gray-400">{t('calendar.noAssignments')}</p>
                  ) : (
                    <div className="space-y-2">
                      {panelData.assignments.map(a => (
                        <div key={a.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-800">{a.personnel?.name || 'Staff'}</span>
                            <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${a.role === 'VGO' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>{a.role}</span>
                          </div>
                          <button onClick={() => handleRemoveAssignment(a.id)}
                            className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600" title={t('common.remove')}>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">{t('calendar.addStaff')}</h4>
                  <div className="space-y-3">
                    <div className="relative" ref={dropdownRef}>
                      <input type="text" placeholder={t('calendar.searchPersonnel')}
                        value={selectedPerson ? selectedPerson.name : staffSearch}
                        onChange={e => { setStaffSearch(e.target.value); setSelectedPerson(null); setShowDropdown(true) }}
                        onFocus={() => setShowDropdown(true)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      {showDropdown && staffSearch && !selectedPerson && (
                        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-auto">
                          {filteredPersonnel.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-gray-400">{t('calendar.noResults')}</div>
                          ) : filteredPersonnel.slice(0, 20).map(p => (
                            <button key={p.id} onClick={() => { setSelectedPerson(p); setStaffSearch(''); setShowDropdown(false) }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex justify-between">
                              <span>{p.name}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded ${p.role === 'VGO' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>{p.role}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <select value={selectedRole} onChange={e => setSelectedRole(e.target.value)}
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                        <option value="VGO">VGO</option>
                        <option value="TD">TD</option>
                      </select>
                      <button onClick={handleAssign} disabled={!selectedPerson || assigning}
                        className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                        {assigning ? t('calendar.adding') : t('calendar.add')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="p-6 border-t border-gray-200">
              <button onClick={() => window.location.href = `/nominations?competition=${panelData?.id || selectedEvent.id}`}
                className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800">
                {t('calendar.generateNominations')}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ===== EVENT MODAL ===== */}
      {showEventModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-bold mb-4">{editingEvent ? t('calendar.editEvent') : t('calendar.newEventTitle')}</h3>
            <form onSubmit={handleEventSubmit} className="space-y-3">
              <input required placeholder={t('calendar.eventName')} value={eventForm.name}
                onChange={e => setEventForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm" />
              <input placeholder={t('calendar.shortName')} value={eventForm.short_name}
                onChange={e => setEventForm(f => ({ ...f, short_name: e.target.value }))}
                className="w-full px-3 py-2 border rounded-lg text-sm" />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('calendar.competitionType')}</label>
                  <select value={eventForm.competition_type} onChange={e => handleTypeChange(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    {COMP_TYPES.filter(ct => ct.key !== 'All').map(ct => (
                      <option key={ct.key} value={ct.key}>{ct.label}</option>
                    ))}
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('calendar.template')}</label>
                  <select value={eventForm.template_key} onChange={e => setEventForm(f => ({ ...f, template_key: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="WCQ">WCQ</option>
                    <option value="BCLA_F4">BCLA Final 4</option>
                    <option value="BCLA_RS">BCLA Regular Season</option>
                    <option value="LSB">LSB</option>
                    <option value="GENERIC">GENERIC</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('calendar.month')}</label>
                  <select value={eventForm.month} onChange={e => setEventForm(f => ({ ...f, month: parseInt(e.target.value) }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm">
                    {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('calendar.year')}</label>
                  <input type="number" value={eventForm.year} onChange={e => setEventForm(f => ({ ...f, year: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{t('calendar.location')}</label>
                  <input placeholder={t('calendar.city')} value={eventForm.location}
                    onChange={e => setEventForm(f => ({ ...f, location: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={eventForm.is_tbd}
                  onChange={e => setEventForm(f => ({ ...f, is_tbd: e.target.checked }))}
                  className="rounded" />
                {t('calendar.tbdCheckbox')}
              </label>

              {!eventForm.is_tbd && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('calendar.startDate')}</label>
                    <input type="date" value={eventForm.start_date}
                      onChange={e => setEventForm(f => ({ ...f, start_date: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{t('calendar.endDate')}</label>
                    <input type="date" value={eventForm.end_date}
                      onChange={e => setEventForm(f => ({ ...f, end_date: e.target.value }))}
                      className="w-full px-3 py-2 border rounded-lg text-sm" />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowEventModal(false)} className="px-4 py-2 text-sm text-gray-600">{t('calendar.cancel')}</button>
                <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
                  {editingEvent ? t('calendar.save') : t('calendar.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .animate-slide-in { animation: slideIn 0.25s ease-out; }
      `}</style>
    </div>
  )
}
