import { useState, useEffect, useRef } from 'react'
import { getCalendarCompetitions, getCalendarCompetition, assignStaff, removeAssignment, getPersonnel } from '../api/client'

const MONTHS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

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

const TYPE_COLORS = Object.fromEntries(
  COMP_TYPES.filter(t => t.color).map(t => [t.key, t.color])
)

function getTypeColor(type) {
  return TYPE_COLORS[type] || '#6B7280'
}

function formatDateRange(event) {
  if (event.is_tbd) return null
  const start = new Date(event.start_date)
  const end = new Date(event.end_date)
  const startDay = start.getDate()
  const endDay = end.getDate()
  const startMonth = MONTHS[start.getMonth()]?.slice(0, 3)
  const endMonth = MONTHS[end.getMonth()]?.slice(0, 3)
  if (start.getMonth() === end.getMonth()) {
    return `${startMonth} ${startDay}\u2013${endDay}`
  }
  return `${startMonth} ${startDay} \u2013 ${endMonth} ${endDay}`
}

function formatFullDate(event) {
  if (event.is_tbd) return 'Fechas por confirmar'
  const start = new Date(event.start_date)
  const end = new Date(event.end_date)
  const opts = { day: 'numeric', month: 'long', year: 'numeric' }
  return `${start.toLocaleDateString('es', opts)} \u2013 ${end.toLocaleDateString('es', opts)}`
}

function groupByMonth(events) {
  const months = Array.from({ length: 12 }, () => [])
  events.forEach(ev => {
    if (ev.is_tbd) {
      // Put TBD events in month 0 (Enero) as fallback — or skip
      // We'll show them in a special way
      months[0].push(ev)
      return
    }
    const m = new Date(ev.start_date).getMonth()
    months[m].push(ev)
  })
  return months
}

function assignmentChips(event) {
  if (!event.assignments || event.assignments.length === 0) return null
  const counts = {}
  event.assignments.forEach(a => {
    const role = a.role || 'Staff'
    counts[role] = (counts[role] || 0) + 1
  })
  return Object.entries(counts).map(([role, count]) => `${count} ${role}`).join(' \u00B7 ')
}

export default function Calendar() {
  const [competitions, setCompetitions] = useState([])
  const [filter, setFilter] = useState('All')
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

  useEffect(() => { load() }, [filter])

  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function load() {
    try {
      const params = filter !== 'All' ? { type: filter } : {}
      const data = await getCalendarCompetitions(params)
      setCompetitions(data)
    } catch {
      setCompetitions([])
    }
  }

  async function openPanel(event) {
    setSelectedEvent(event)
    setPanelLoading(true)
    setStaffSearch('')
    setSelectedPerson(null)
    setSelectedRole('VGO')
    try {
      const [detail, pers] = await Promise.all([
        getCalendarCompetition(event.id),
        personnel.length ? Promise.resolve(personnel) : getPersonnel(),
      ])
      setPanelData(detail)
      if (!personnel.length) setPersonnel(pers)
    } catch {
      setPanelData(event)
    }
    setPanelLoading(false)
  }

  function closePanel() {
    setSelectedEvent(null)
    setPanelData(null)
  }

  async function handleAssign() {
    if (!selectedPerson || !panelData) return
    setAssigning(true)
    try {
      await assignStaff(panelData.id, {
        personnel_id: selectedPerson.id,
        role: selectedRole,
      })
      const detail = await getCalendarCompetition(panelData.id)
      setPanelData(detail)
      setSelectedPerson(null)
      setStaffSearch('')
      await load()
    } catch (err) {
      alert(err.response?.data?.detail || 'Error asignando staff')
    }
    setAssigning(false)
  }

  async function handleRemove(assignmentId) {
    if (!confirm('¿Remover esta asignación?')) return
    try {
      await removeAssignment(assignmentId)
      const detail = await getCalendarCompetition(panelData.id)
      setPanelData(detail)
      await load()
    } catch (err) {
      alert(err.response?.data?.detail || 'Error removiendo asignación')
    }
  }

  const monthGroups = groupByMonth(competitions)

  const filteredPersonnel = personnel.filter(p => {
    const q = staffSearch.toLowerCase()
    const name = `${p.first_name || ''} ${p.last_name || ''}`.toLowerCase()
    return name.includes(q)
  })

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Calendario</h2>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-6">
        {COMP_TYPES.map(t => (
          <button
            key={t.key}
            onClick={() => setFilter(t.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
              filter === t.key
                ? 'text-white border-transparent'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
            style={filter === t.key ? { backgroundColor: t.color || '#374151', borderColor: t.color || '#374151' } : {}}
          >
            {t.key === 'All' && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400 mr-1.5 align-middle" />
            )}
            {t.key !== 'All' && (
              <span
                className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
                style={{ backgroundColor: filter === t.key ? '#fff' : t.color }}
              />
            )}
            {t.label}
          </button>
        ))}
      </div>

      {/* 12-month grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {MONTHS.map((monthName, idx) => {
          const events = monthGroups[idx] || []
          return (
            <div
              key={idx}
              className="bg-white rounded-lg border border-gray-200 overflow-hidden"
            >
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700">{monthName}</h3>
              </div>
              <div className="divide-y divide-gray-100">
                {events.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs text-gray-300">
                    Sin eventos
                  </div>
                )}
                {events.map(ev => {
                  const color = getTypeColor(ev.type)
                  const chips = assignmentChips(ev)
                  const dateStr = formatDateRange(ev)
                  return (
                    <button
                      key={ev.id}
                      onClick={() => openPanel(ev)}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 transition-colors flex items-center gap-3 group"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate group-hover:text-blue-700 transition-colors">
                          {ev.short_name || ev.name}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {dateStr ? (
                            <span className="text-xs text-gray-400">{dateStr}</span>
                          ) : (
                            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">TBD</span>
                          )}
                          {chips && (
                            <span className="text-xs text-gray-400">{chips}</span>
                          )}
                        </div>
                      </div>
                      <svg className="w-4 h-4 text-gray-300 group-hover:text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Side panel overlay */}
      {selectedEvent && (
        <>
          <div
            className="fixed inset-0 bg-black/40 z-40 transition-opacity"
            onClick={closePanel}
          />
          <div className="fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col animate-slide-in">
            {/* Panel header */}
            <div className="flex items-start justify-between p-6 border-b border-gray-200">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="inline-block px-2 py-0.5 rounded text-xs font-medium text-white"
                    style={{ backgroundColor: getTypeColor(panelData?.type || selectedEvent.type) }}
                  >
                    {panelData?.type || selectedEvent.type}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-gray-900 truncate">
                  {panelData?.name || selectedEvent.name}
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  {formatFullDate(panelData || selectedEvent)}
                </p>
              </div>
              <button
                onClick={closePanel}
                className="ml-4 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {panelLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <span className="text-sm text-gray-400">Cargando...</span>
              </div>
            ) : (
              <div className="flex-1 overflow-auto p-6 space-y-6">
                {/* Staff Asignado */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Staff Asignado</h4>
                  {(!panelData?.assignments || panelData.assignments.length === 0) ? (
                    <p className="text-sm text-gray-400">Sin asignaciones</p>
                  ) : (
                    <div className="space-y-2">
                      {panelData.assignments.map(a => (
                        <div
                          key={a.id}
                          className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-800">
                              {a.personnel_name || `${a.first_name || ''} ${a.last_name || ''}`.trim() || 'Staff'}
                            </span>
                            <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                              {a.role}
                            </span>
                          </div>
                          <button
                            onClick={() => handleRemove(a.id)}
                            className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 transition-colors"
                            title="Remover"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Agregar Staff */}
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Agregar Staff</h4>
                  <div className="space-y-3">
                    {/* Searchable dropdown */}
                    <div className="relative" ref={dropdownRef}>
                      <input
                        type="text"
                        placeholder="Buscar personal..."
                        value={selectedPerson ? `${selectedPerson.first_name} ${selectedPerson.last_name}` : staffSearch}
                        onChange={e => {
                          setStaffSearch(e.target.value)
                          setSelectedPerson(null)
                          setShowDropdown(true)
                        }}
                        onFocus={() => setShowDropdown(true)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      {showDropdown && staffSearch && !selectedPerson && (
                        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-auto">
                          {filteredPersonnel.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-gray-400">Sin resultados</div>
                          ) : (
                            filteredPersonnel.slice(0, 20).map(p => (
                              <button
                                key={p.id}
                                onClick={() => {
                                  setSelectedPerson(p)
                                  setStaffSearch('')
                                  setShowDropdown(false)
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors"
                              >
                                {p.first_name} {p.last_name}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>

                    {/* Role selector + Agregar button */}
                    <div className="flex gap-2">
                      <select
                        value={selectedRole}
                        onChange={e => setSelectedRole(e.target.value)}
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="VGO">VGO</option>
                        <option value="TD">TD</option>
                      </select>
                      <button
                        onClick={handleAssign}
                        disabled={!selectedPerson || assigning}
                        className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {assigning ? 'Agregando...' : 'Agregar'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Bottom action */}
            <div className="p-6 border-t border-gray-200">
              <button
                onClick={() => {
                  // Navigate or trigger bulk nomination flow
                  // This links to the existing nominations bulk generation
                  window.location.href = `/nominations?competition=${panelData?.id || selectedEvent.id}`
                }}
                className="w-full bg-gray-900 text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
              >
                Generar Nominaciones
              </button>
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in {
          animation: slideIn 0.25s ease-out;
        }
      `}</style>
    </div>
  )
}
