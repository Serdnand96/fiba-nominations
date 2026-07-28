import { useState, useEffect, useMemo, useRef } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import {
  getTransportVehicles, getTransportDrivers,
  getTransportTrips, getTransportTripDates, createTransportTrip, updateTransportTrip, deleteTransportTrip,
  createTransportVehicle, updateTransportVehicle, deleteTransportVehicle,
  createTransportDriver, updateTransportDriver, deleteTransportDriver,
  assignTransportDriver, getTransportConflicts,
  getTransportVenues, createTransportVenue, deleteTransportVenue,
  getTransportEventByCompetition, createTransportEvent,
} from '../../api/client'

// Sección Transporte del módulo Logística. La competencia la elige el shell
// (Logistics.jsx) y baja por props, porque las tres secciones miran siempre la
// misma competencia.

function formatTime(t) {
  if (!t) return ''
  const parts = t.split(':')
  return `${parts[0]}:${parts[1]}`
}

// "Venezuela vs Chile" — los equipos salen de game_schedule, así que los
// placeholders del bracket ("CF #1", "Equipo A SF#1") se vuelven equipos reales
// solos cuando se resuelven los cruces.
function gameLabel(game) {
  if (!game) return ''
  return `${game.team_a || '?'} vs ${game.team_b || '?'}`
}

function gamePhase(game) {
  if (!game) return ''
  return [game.phase, game.group_label && `${game.group_label}`].filter(Boolean).join(' ')
}

const EMPTY_TRIPS = { vehicles: [], trips: [], vehicle_drivers: [], games: [] }

// Una fila de la planilla de logística ("PICK UP … RETURN HOTEL") son dos
// tramos del mismo partido: la ida y la vuelta.
const TRIP_TYPE_LABELS = {
  es: { pickup: 'Pick up', return: 'Retorno', transfer: 'Viaje' },
  en: { pickup: 'Pick up', return: 'Return', transfer: 'Trip' },
}

export default function TransportTab({ competitionId, selectedComp, canEdit, savedDate, onDateChange }) {
  const { lang } = useLanguage()
  const [tab, setTab] = useState('schedule')

  const [eventId, setEventId] = useState(null)
  const [eventLoading, setEventLoading] = useState(false)
  const [date, setDate] = useState('')

  const [vehicles, setVehicles] = useState([])
  const [drivers, setDrivers] = useState([])
  const [tripData, setTripData] = useState(EMPTY_TRIPS)
  const [conflicts, setConflicts] = useState([])
  const [venues, setVenues] = useState([])
  // Fechas que tienen viajes. La competencia suele arrancar con un día de
  // llegadas sin traslados, así que abrir en start_date muestra un día vacío
  // y parece que no hay nada cargado.
  const [tripDates, setTripDates] = useState([])
  const autoJumpRef = useRef(false)
  const savedDateRef = useRef(savedDate)

  const [showTripModal, setShowTripModal] = useState(false)
  const [editingTrip, setEditingTrip] = useState(null)
  const [tripForm, setTripForm] = useState({
    vehicle_id: '', trip_number: 1, departure_time: '', arrival_time: '',
    origin: '', destination: '', equipment: '', contact: '',
    game_id: '', trip_type: 'transfer', notes: '',
  })

  const [showVehicleModal, setShowVehicleModal] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState(null)
  const [vehicleForm, setVehicleForm] = useState({ name: '', vehicle_type: '' })

  const [showDriverModal, setShowDriverModal] = useState(false)
  const [editingDriver, setEditingDriver] = useState(null)
  const [driverForm, setDriverForm] = useState({ name: '', phone: '' })

  const [showVenueModal, setShowVenueModal] = useState(false)
  const [venueForm, setVenueForm] = useState({ name: '', type: 'venue' })

  const [assigningVehicle, setAssigningVehicle] = useState(null)
  const [assignDriverId, setAssignDriverId] = useState('')

  useEffect(() => {
    if (!competitionId) return
    const comp = selectedComp
    // Restauración de una sola vez de la fecha guardada, solo si cae dentro
    // del rango de la competencia.
    const saved = savedDateRef.current
    savedDateRef.current = null
    const savedOk = saved
      && (!comp?.start_date || saved >= comp.start_date)
      && (!comp?.end_date || saved <= comp.end_date)
    if (savedOk) setDate(saved)
    else if (comp?.start_date) setDate(comp.start_date)
    else setDate(new Date().toISOString().split('T')[0])

    setEventLoading(true)
    getTransportEventByCompetition(competitionId)
      .then(evt => {
        if (evt) { setEventId(evt.id) }
        else {
          return createTransportEvent({
            name: comp?.name || 'Transport', competition_id: competitionId,
            start_date: comp?.start_date || null, end_date: comp?.end_date || null,
          }).then(newEvt => setEventId(newEvt.id))
        }
      })
      .catch(() => setEventId(null))
      .finally(() => setEventLoading(false))
  }, [competitionId, selectedComp])

  useEffect(() => {
    autoJumpRef.current = false
    if (!eventId) {
      setVehicles([]); setDrivers([]); setVenues([])
      setTripData(EMPTY_TRIPS); setConflicts([]); setTripDates([])
      return
    }
    loadAll()
  }, [eventId])

  useEffect(() => { if (eventId && date) loadTrips() }, [date, eventId])
  useEffect(() => { if (date) onDateChange?.(date) }, [date])

  // Si la fecha en la que abrimos no tiene viajes, saltar a la primera que sí
  // tenga. Una sola vez por evento, para no pelearle al usuario si después
  // navega a propósito a un día vacío.
  useEffect(() => {
    if (!tripDates.length || autoJumpRef.current) return
    autoJumpRef.current = true
    if (!tripDates.some(d => d.date === date)) setDate(tripDates[0].date)
  }, [tripDates])

  async function loadAll() {
    if (!eventId) return
    try {
      const [v, d, ven, dates] = await Promise.all([
        getTransportVehicles(eventId), getTransportDrivers(eventId),
        getTransportVenues(eventId), getTransportTripDates(eventId),
      ])
      setVehicles(v); setDrivers(d); setVenues(ven); setTripDates(dates)
      if (date) await loadTrips()
    } catch (err) { console.error('Load error:', err) }
  }

  async function loadTrips() {
    if (!eventId || !date) return
    try {
      const data = await getTransportTrips(eventId, date)
      setTripData(data)
      const c = await getTransportConflicts(eventId, date)
      setConflicts(c)
    } catch (err) { console.error('Trip load error:', err) }
  }

  // Tras crear/borrar viajes el set de fechas con viajes puede cambiar.
  async function refreshTripDates() {
    if (!eventId) return
    try { setTripDates(await getTransportTripDates(eventId)) } catch { /* no-op */ }
  }

  const minDate = selectedComp?.start_date || ''
  const maxDate = selectedComp?.end_date || ''

  function changeDate(delta) {
    setDate(d => {
      const dt = new Date(d + 'T12:00:00')
      dt.setDate(dt.getDate() + delta)
      const next = dt.toISOString().split('T')[0]
      if (minDate && next < minDate) return minDate
      if (maxDate && next > maxDate) return maxDate
      return next
    })
  }

  const tripsByVehicle = useMemo(() => {
    const map = {}
    for (const v of tripData.vehicles) { map[v.id] = { vehicle: v, trips: [], driver: null } }
    for (const trip of tripData.trips) { if (map[trip.vehicle_id]) map[trip.vehicle_id].trips.push(trip) }
    for (const vd of tripData.vehicle_drivers) { if (map[vd.vehicle_id]) map[vd.vehicle_id].driver = vd.driver }
    Object.values(map).forEach(g => g.trips.sort((a, b) => a.departure_time?.localeCompare(b.departure_time)))
    return map
  }, [tripData])

  const conflictTripIds = useMemo(() => {
    const ids = new Set()
    conflicts.forEach(c => { ids.add(c.trip_a); ids.add(c.trip_b) })
    return ids
  }, [conflicts])

  const hotelVenues = useMemo(() => venues.filter(v => v.type === 'hotel').map(v => v.name), [venues])
  const venueNames = useMemo(() => venues.map(v => v.name), [venues])

  function openCreateTrip(vehicleId) {
    const existingTrips = tripsByVehicle[vehicleId]?.trips || []
    setEditingTrip(null)
    setTripForm({ vehicle_id: vehicleId, trip_number: existingTrips.length + 1, departure_time: '', arrival_time: '', origin: '', destination: '', equipment: '', contact: '', game_id: '', trip_type: 'transfer', notes: '' })
    setShowTripModal(true)
  }

  function openEditTrip(trip) {
    setEditingTrip(trip)
    setTripForm({ vehicle_id: trip.vehicle_id, trip_number: trip.trip_number, departure_time: formatTime(trip.departure_time), arrival_time: formatTime(trip.arrival_time) || '', origin: trip.origin, destination: trip.destination, equipment: trip.equipment || '', contact: trip.contact || '', game_id: trip.game_id || '', trip_type: trip.trip_type || 'transfer', notes: trip.notes || '' })
    setShowTripModal(true)
  }

  async function handleTripSubmit(e) {
    e.preventDefault()
    // game_id must go as null (not '') so the backend can clear the link.
    const payload = { ...tripForm, date, game_id: tripForm.game_id || null }
    try {
      if (editingTrip) { const { vehicle_id, ...updates } = payload; await updateTransportTrip(editingTrip.id, updates) }
      else { await createTransportTrip(payload) }
      setShowTripModal(false); await loadTrips(); await refreshTripDates()
    } catch (err) { alert(err.response?.data?.detail || 'Error') }
  }

  // Picking the game pre-fills the leg: pickup leaves the hotel for the venue,
  // return does the opposite. Times stay manual — the offsets logistics uses
  // vary by day (they stagger the crews).
  function selectTripGame(gameId) {
    setTripForm(f => {
      const game = (tripData.games || []).find(g => g.id === gameId)
      const next = { ...f, game_id: gameId }
      if (!game) return next
      const venue = game.venue || venueNames.find(n => venues.find(v => v.name === n && v.type === 'venue')) || ''
      const hotel = hotelVenues[0] || ''
      if (f.trip_type === 'pickup' && !f.origin && !f.destination) { next.origin = hotel; next.destination = venue }
      if (f.trip_type === 'return' && !f.origin && !f.destination) { next.origin = venue; next.destination = hotel }
      return next
    })
  }

  async function handleDeleteTrip(trip) {
    if (!confirm(lang === 'es' ? '¿Eliminar este viaje?' : 'Delete this trip?')) return
    await deleteTransportTrip(trip.id); await loadTrips(); await refreshTripDates()
  }

  async function handleAssignDriver(vehicleId, driverId) {
    if (!driverId) return
    await assignTransportDriver({ vehicle_id: vehicleId, driver_id: driverId, date })
    setAssigningVehicle(null); setAssignDriverId(''); await loadTrips()
  }

  function openCreateVehicle() { setEditingVehicle(null); setVehicleForm({ name: '', vehicle_type: '' }); setShowVehicleModal(true) }
  function openEditVehicle(v) { setEditingVehicle(v); setVehicleForm({ name: v.name, vehicle_type: v.vehicle_type || '' }); setShowVehicleModal(true) }

  async function handleVehicleSubmit(e) {
    e.preventDefault()
    if (editingVehicle) await updateTransportVehicle(editingVehicle.id, vehicleForm)
    else await createTransportVehicle({ ...vehicleForm, event_id: eventId })
    setShowVehicleModal(false); await loadAll()
  }

  async function handleDeleteVehicle(v) {
    if (!confirm(lang === 'es' ? `¿Eliminar ${v.name}?` : `Delete ${v.name}?`)) return
    await deleteTransportVehicle(v.id); await loadAll()
  }

  function openCreateDriver() { setEditingDriver(null); setDriverForm({ name: '', phone: '' }); setShowDriverModal(true) }
  function openEditDriver(d) { setEditingDriver(d); setDriverForm({ name: d.name, phone: d.phone || '' }); setShowDriverModal(true) }

  async function handleDriverSubmit(e) {
    e.preventDefault()
    if (editingDriver) await updateTransportDriver(editingDriver.id, driverForm)
    else await createTransportDriver({ ...driverForm, event_id: eventId })
    setShowDriverModal(false); await loadAll()
  }

  async function handleDeleteDriver(d) {
    if (!confirm(lang === 'es' ? `¿Eliminar ${d.name}?` : `Delete ${d.name}?`)) return
    await deleteTransportDriver(d.id); await loadAll()
  }

  async function handleVenueSubmit(e) {
    e.preventDefault()
    await createTransportVenue({ ...venueForm, event_id: eventId })
    setShowVenueModal(false); setVenueForm({ name: '', type: 'venue' })
    setVenues(await getTransportVenues(eventId))
  }

  async function handleDeleteVenue(v) {
    await deleteTransportVenue(v.id); setVenues(await getTransportVenues(eventId))
  }

  function exportPDF() {
    // Escape any value that ends up inside the raw HTML string below. These are
    // free-text fields (vehicle/driver names, origins, event name) that would
    // otherwise allow HTML/script injection into the printed document — which
    // has access to this origin's session.
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ))
    const dateLabel = new Date(date + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es' : 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    const eventTitle = selectedComp?.name || 'Transport'
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Transporte - ${esc(eventTitle)} - ${dateLabel}</title><style>* { margin: 0; padding: 0; box-sizing: border-box; } body { font-family: Arial, sans-serif; font-size: 10px; padding: 15px; } .header { text-align: center; margin-bottom: 12px; } .header h1 { font-size: 16px; } .header h2 { font-size: 12px; font-weight: normal; color: #555; } .vehicle-block { margin-bottom: 10px; } .vehicle-header { background: #1e3a5f; color: white; padding: 4px 8px; font-weight: bold; font-size: 11px; } .trip-table { width: 100%; border-collapse: collapse; } .trip-table th { background: #e5e7eb; padding: 3px 6px; text-align: left; font-size: 9px; border: 1px solid #ccc; } .trip-table td { padding: 3px 6px; border: 1px solid #ccc; font-size: 9px; } .conflict { background: #fee2e2 !important; } @media print { body { padding: 5px; } }</style></head><body><div class="header"><h1>TRANSPORTE - ${esc(eventTitle.toUpperCase())}</h1><h2>${dateLabel}</h2></div>`
    const orderedVehicles = Object.values(tripsByVehicle)
    for (const group of orderedVehicles) {
      const { vehicle, trips, driver } = group
      const driverName = driver?.name || ''
      html += `<div class="vehicle-block"><div class="vehicle-header">${esc(vehicle.name)}${driverName ? ` — ${esc(driverName)}` : ''}</div><table class="trip-table"><thead><tr><th>${lang === 'es' ? 'Viaje' : 'Trip'}</th><th>${lang === 'es' ? 'Hora' : 'Time'}</th><th>${lang === 'es' ? 'Partida' : 'Origin'}</th><th>${lang === 'es' ? 'Destino' : 'Destination'}</th><th>${lang === 'es' ? 'Partido' : 'Game'}</th><th>${lang === 'es' ? 'Equipo' : 'Equipment'}</th><th>${lang === 'es' ? 'Contacto' : 'Contact'}</th><th>${lang === 'es' ? 'Comentarios' : 'Comments'}</th></tr></thead><tbody>`
      if (trips.length === 0) html += `<tr><td colspan="8" style="text-align:center;color:#999;">${lang === 'es' ? 'Sin viajes' : 'No trips'}</td></tr>`
      for (const trip of trips) {
        const cls = conflictTripIds.has(trip.id) ? ' class="conflict"' : ''
        const label = TRIP_TYPE_LABELS[lang]?.[trip.trip_type] || (lang === 'es' ? 'Viaje' : 'Trip')
        const game = trip.game
          ? `${gameLabel(trip.game)}${trip.game.time ? ` (${formatTime(trip.game.time)})` : ''}`
          : ''
        html += `<tr${cls}><td>${esc(label)} ${trip.trip_number}</td><td>${formatTime(trip.departure_time)}</td><td>${esc(trip.origin)}</td><td>${esc(trip.destination)}</td><td>${esc(game)}</td><td>${esc(trip.equipment || '')}</td><td>${esc(trip.contact || '')}</td><td>${esc(trip.notes || '')}</td></tr>`
      }
      html += `</tbody></table></div>`
    }
    html += `</body></html>`
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const win = window.open(url, '_blank')
    if (!win) {
      URL.revokeObjectURL(url)
      alert(lang === 'es'
        ? 'El navegador bloqueó la ventana emergente. Habilita los popups para exportar el PDF.'
        : 'The browser blocked the popup window. Enable popups to export the PDF.')
      return
    }
    setTimeout(() => { win.print(); URL.revokeObjectURL(url) }, 600)
  }

  const TAB_LABELS = {
    schedule: lang === 'es' ? 'Cronograma' : 'Schedule',
    config: lang === 'es' ? 'Vehículos, choferes y venues' : 'Vehicles, drivers & venues',
  }

  if (eventLoading) {
    return <div className="text-center py-8 text-fiba-muted text-sm">{lang === 'es' ? 'Cargando...' : 'Loading...'}</div>
  }
  if (!eventId) return null

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-fiba-border mb-6">
        <div className="flex">
          {Object.entries(TAB_LABELS).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === key ? 'border-fiba-accent text-fiba-accent' : 'border-transparent text-fiba-muted hover:text-ink-700 dark:text-gray-300'
              }`}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'schedule' && (
          <button onClick={exportPDF} className="btn-fiba-ghost mb-1.5">
            {lang === 'es' ? 'Exportar PDF' : 'Export PDF'}
          </button>
        )}
      </div>

      {/* SCHEDULE */}
      {tab === 'schedule' && (
        <div>
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <button onClick={() => changeDate(-1)} disabled={minDate && date <= minDate}
              className="p-1 rounded hover:bg-fiba-surface disabled:opacity-30 disabled:cursor-not-allowed">
              <svg className="w-5 h-5 text-fiba-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <input type="date" value={date} min={minDate} max={maxDate} onChange={e => setDate(e.target.value)}
              className="fiba-input w-auto" />
            <button onClick={() => changeDate(1)} disabled={maxDate && date >= maxDate}
              className="p-1 rounded hover:bg-fiba-surface disabled:opacity-30 disabled:cursor-not-allowed">
              <svg className="w-5 h-5 text-fiba-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
            <span className="text-sm text-fiba-muted">
              {date && new Date(date + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </span>
            {conflicts.length > 0 && (
              <span className="bg-red-500/20 text-red-400 px-3 py-1 rounded-full text-xs font-medium">
                {conflicts.length} {lang === 'es' ? 'conflicto(s)' : 'conflict(s)'}
              </span>
            )}
          </div>

          {/* Jornadas con viajes: sin esto, caer en un día vacío se lee
              como "no hay nada cargado". */}
          {tripDates.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mb-6">
              <span className="text-xs text-fiba-muted">{lang === 'es' ? 'Jornadas con viajes:' : 'Days with trips:'}</span>
              {tripDates.map(d => (
                <button key={d.date} onClick={() => setDate(d.date)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    d.date === date
                      ? 'bg-fiba-accent text-white border-fiba-accent'
                      : 'border-fiba-border text-fiba-muted hover:text-ink-700 dark:hover:text-gray-200'
                  }`}>
                  {new Date(d.date + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es' : 'en-US', { day: 'numeric', month: 'short' })}
                  <span className="opacity-60 ml-1">({d.count})</span>
                </button>
              ))}
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-2">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <span className="font-bold text-red-400 text-sm">
                  {lang === 'es' ? `${conflicts.length} conflicto(s) de desplazamiento detectado(s)` : `${conflicts.length} schedule conflict(s) detected`}
                </span>
              </div>
              <ul className="space-y-1 text-xs text-red-400">
                {conflicts.map((c, idx) => {
                  const tripA = tripData.trips.find(t => t.id === c.trip_a)
                  const tripB = tripData.trips.find(t => t.id === c.trip_b)
                  const vehicleA = tripData.vehicles.find(v => v.id === tripA?.vehicle_id)
                  const vehicleB = tripData.vehicles.find(v => v.id === tripB?.vehicle_id)
                  const driverObj = drivers.find(d => d.id === c.driver_id)
                  return (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 shrink-0" />
                      <span>
                        {c.type === 'vehicle_overlap' ? (
                          lang === 'es'
                            ? <><strong>{vehicleA?.name}</strong>: Viaje {tripA?.trip_number} ({formatTime(tripA?.departure_time)}) se solapa con Viaje {tripB?.trip_number} ({formatTime(tripB?.departure_time)}){driverObj ? `. Chofer: ${driverObj.name}` : ''}</>
                            : <><strong>{vehicleA?.name}</strong>: Trip {tripA?.trip_number} ({formatTime(tripA?.departure_time)}) overlaps with Trip {tripB?.trip_number} ({formatTime(tripB?.departure_time)}){driverObj ? `. Driver: ${driverObj.name}` : ''}</>
                        ) : (
                          lang === 'es'
                            ? <>Chofer <strong>{driverObj?.name || '?'}</strong>: Viaje en {vehicleA?.name} ({formatTime(tripA?.departure_time)}) se solapa con viaje en {vehicleB?.name} ({formatTime(tripB?.departure_time)})</>
                            : <>Driver <strong>{driverObj?.name || '?'}</strong>: Trip on {vehicleA?.name} ({formatTime(tripA?.departure_time)}) overlaps with trip on {vehicleB?.name} ({formatTime(tripB?.departure_time)})</>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          <div className="space-y-4">
            {Object.entries(tripsByVehicle).map(([vid, group]) => {
              const { vehicle, trips, driver } = group
              return (
                <div key={vid} className="bg-fiba-card rounded-xl border border-fiba-border overflow-hidden">
                  <div className="bg-blue-900 text-ink-900 dark:text-white px-4 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-sm">{vehicle.name}</span>
                      {driver ? (
                        <span className="text-blue-200 text-xs">{lang === 'es' ? 'Chofer' : 'Driver'}: {driver.name} {driver.phone ? `(${driver.phone})` : ''}</span>
                      ) : canEdit ? (
                        <button onClick={() => setAssigningVehicle(assigningVehicle === vid ? null : vid)} className="text-blue-200 hover:text-ink-900 dark:text-white text-xs underline">
                          {lang === 'es' ? 'Asignar chofer' : 'Assign driver'}
                        </button>
                      ) : null}
                    </div>
                    {canEdit && (
                      <div className="flex gap-2">
                        {driver && <button onClick={() => setAssigningVehicle(assigningVehicle === vid ? null : vid)} className="text-blue-200 hover:text-ink-900 dark:text-white text-xs">{lang === 'es' ? 'Cambiar' : 'Change'}</button>}
                        <button onClick={() => openCreateTrip(vid)} className="bg-basketball-700 hover:bg-basketball-800 text-white px-3 py-1 rounded text-xs font-medium">+ {lang === 'es' ? 'Viaje' : 'Trip'}</button>
                      </div>
                    )}
                  </div>

                  {assigningVehicle === vid && (
                    <div className="bg-fiba-accent/5 px-4 py-2 flex items-center gap-2 border-b border-fiba-border">
                      <select value={assignDriverId} onChange={e => setAssignDriverId(e.target.value)} className="fiba-select flex-1">
                        <option value="">{lang === 'es' ? 'Seleccionar chofer...' : 'Select driver...'}</option>
                        {drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                      <button onClick={() => handleAssignDriver(vid, assignDriverId)} disabled={!assignDriverId}
                        className="btn-fiba text-xs px-3 py-1 disabled:opacity-50">{lang === 'es' ? 'Asignar' : 'Assign'}</button>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                  <table className="fiba-table">
                    <thead>
                      <tr>
                        <th className="w-24">{lang === 'es' ? 'Viaje' : 'Trip'}</th>
                        <th className="w-16">{lang === 'es' ? 'Hora' : 'Time'}</th>
                        <th>{lang === 'es' ? 'Partida' : 'Origin'}</th>
                        <th>{lang === 'es' ? 'Destino' : 'Dest.'}</th>
                        <th>{lang === 'es' ? 'Partido' : 'Game'}</th>
                        <th>{lang === 'es' ? 'Equipo' : 'Equip.'}</th>
                        <th>{lang === 'es' ? 'Contacto' : 'Contact'}</th>
                        <th>{lang === 'es' ? 'Comentarios' : 'Comments'}</th>
                        <th className="w-20"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {trips.length === 0 && (
                        <tr><td colSpan={9} className="px-4 py-4 text-center text-fiba-border text-xs">
                          {lang === 'es' ? 'Sin viajes programados' : 'No scheduled trips'}
                        </td></tr>
                      )}
                      {trips.map(trip => (
                        <tr key={trip.id} className={conflictTripIds.has(trip.id) ? 'bg-red-500/10' : ''}>
                          <td className="px-4 py-2 font-medium">
                            {conflictTripIds.has(trip.id) && <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1.5" title={lang === 'es' ? 'Conflicto' : 'Conflict'} />}
                            {TRIP_TYPE_LABELS[lang]?.[trip.trip_type] || (lang === 'es' ? 'Viaje' : 'Trip')} {trip.trip_number}
                          </td>
                          <td className="px-4 py-2 font-mono text-xs">{formatTime(trip.departure_time)}</td>
                          <td className="px-4 py-2">{trip.origin}</td>
                          <td className="px-4 py-2">{trip.destination}</td>
                          <td className="px-4 py-2">
                            {trip.game ? (
                              <div className="leading-tight">
                                <div className="text-xs">{gameLabel(trip.game)}</div>
                                <div className="text-[10px] text-fiba-muted">
                                  {[formatTime(trip.game.time), gamePhase(trip.game)].filter(Boolean).join(' · ')}
                                </div>
                              </div>
                            ) : <span className="text-fiba-muted text-xs">—</span>}
                          </td>
                          <td className="px-4 py-2">
                            {trip.equipment && <span className="bg-fiba-surface text-fiba-muted px-1.5 py-0.5 rounded text-xs">{trip.equipment}</span>}
                          </td>
                          <td className="px-4 py-2 text-xs text-fiba-muted">{trip.contact}</td>
                          <td className="px-4 py-2 text-xs text-fiba-muted max-w-[16rem]">{trip.notes}</td>
                          <td className="px-4 py-2">
                            {canEdit && (
                              <div className="flex gap-2">
                                <button onClick={() => openEditTrip(trip)} className="text-fiba-accent hover:underline text-xs">{lang === 'es' ? 'Editar' : 'Edit'}</button>
                                <button onClick={() => handleDeleteTrip(trip)} className="text-red-400 hover:underline text-xs">{lang === 'es' ? 'Eliminar' : 'Delete'}</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              )
            })}
            {Object.keys(tripsByVehicle).length === 0 && (
              <div className="text-center py-12 text-fiba-muted">
                <p className="text-sm">{lang === 'es' ? 'No hay vehículos configurados para esta competencia.' : 'No vehicles configured for this competition.'}</p>
                <p className="text-xs mt-1">{lang === 'es' ? 'Ve a la pestaña "Vehículos, choferes y venues" para agregar.' : 'Go to the "Vehicles, drivers & venues" tab to add.'}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CONFIG */}
      {tab === 'config' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-ink-900 dark:text-white">{lang === 'es' ? 'Vehículos' : 'Vehicles'}</h3>
              {canEdit && <button onClick={openCreateVehicle} className="btn-fiba text-xs px-3 py-1.5">+ {lang === 'es' ? 'Agregar' : 'Add'}</button>}
            </div>
            <div className="rounded-xl border border-fiba-border overflow-x-auto">
              <table className="fiba-table">
                <thead><tr><th>{lang === 'es' ? 'Nombre' : 'Name'}</th><th>{lang === 'es' ? 'Tipo' : 'Type'}</th>{canEdit && <th className="w-20"></th>}</tr></thead>
                <tbody>
                  {vehicles.map(v => (
                    <tr key={v.id}>
                      <td className="px-4 py-2 font-medium">{v.name}</td>
                      <td className="px-4 py-2 text-fiba-muted">{v.vehicle_type || '—'}</td>
                      {canEdit && <td className="px-4 py-2"><div className="flex gap-2"><button onClick={() => openEditVehicle(v)} className="text-fiba-accent hover:underline text-xs">{lang === 'es' ? 'Editar' : 'Edit'}</button><button onClick={() => handleDeleteVehicle(v)} className="text-red-400 hover:underline text-xs">{lang === 'es' ? 'Eliminar' : 'Delete'}</button></div></td>}
                    </tr>
                  ))}
                  {vehicles.length === 0 && <tr><td colSpan={canEdit ? 3 : 2} className="px-4 py-6 text-center text-fiba-muted/60 text-xs">{lang === 'es' ? 'Sin vehículos' : 'No vehicles'}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-ink-900 dark:text-white">{lang === 'es' ? 'Choferes' : 'Drivers'}</h3>
              {canEdit && <button onClick={openCreateDriver} className="btn-fiba text-xs px-3 py-1.5">+ {lang === 'es' ? 'Agregar' : 'Add'}</button>}
            </div>
            <div className="rounded-xl border border-fiba-border overflow-x-auto">
              <table className="fiba-table">
                <thead><tr><th>{lang === 'es' ? 'Nombre' : 'Name'}</th><th>{lang === 'es' ? 'Teléfono' : 'Phone'}</th>{canEdit && <th className="w-20"></th>}</tr></thead>
                <tbody>
                  {drivers.map(d => (
                    <tr key={d.id}>
                      <td className="px-4 py-2 font-medium">{d.name}</td>
                      <td className="px-4 py-2 text-fiba-muted">{d.phone || '—'}</td>
                      {canEdit && <td className="px-4 py-2"><div className="flex gap-2"><button onClick={() => openEditDriver(d)} className="text-fiba-accent hover:underline text-xs">{lang === 'es' ? 'Editar' : 'Edit'}</button><button onClick={() => handleDeleteDriver(d)} className="text-red-400 hover:underline text-xs">{lang === 'es' ? 'Eliminar' : 'Delete'}</button></div></td>}
                    </tr>
                  ))}
                  {drivers.length === 0 && <tr><td colSpan={canEdit ? 3 : 2} className="px-4 py-6 text-center text-fiba-muted/60 text-xs">{lang === 'es' ? 'Sin choferes' : 'No drivers'}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-ink-900 dark:text-white">Venues</h3>
              {canEdit && <button onClick={() => setShowVenueModal(true)} className="btn-fiba text-xs px-3 py-1.5">+ {lang === 'es' ? 'Agregar' : 'Add'}</button>}
            </div>
            <div className="rounded-xl border border-fiba-border overflow-x-auto">
              <table className="fiba-table">
                <thead><tr><th>{lang === 'es' ? 'Nombre' : 'Name'}</th><th>{lang === 'es' ? 'Tipo' : 'Type'}</th>{canEdit && <th className="w-12"></th>}</tr></thead>
                <tbody>
                  {venues.map(v => (
                    <tr key={v.id}>
                      <td className="px-4 py-2 font-medium">{v.name}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${v.type === 'hotel' ? 'bg-purple-500/20 text-purple-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{v.type}</span>
                      </td>
                      {canEdit && <td className="px-4 py-2"><button onClick={() => handleDeleteVenue(v)} className="text-red-400 hover:underline text-xs">{lang === 'es' ? 'Eliminar' : 'Delete'}</button></td>}
                    </tr>
                  ))}
                  {venues.length === 0 && <tr><td colSpan={canEdit ? 3 : 2} className="px-4 py-6 text-center text-fiba-muted/60 text-xs">{lang === 'es' ? 'Sin venues' : 'No venues'}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODALS */}
      {showTripModal && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-lg p-6">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-4">{editingTrip ? (lang === 'es' ? 'Editar Viaje' : 'Edit Trip') : (lang === 'es' ? 'Nuevo Viaje' : 'New Trip')}</h3>
            <form onSubmit={handleTripSubmit} className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div><label className="fiba-label">{lang === 'es' ? 'Tipo' : 'Type'}</label>
                  <select value={tripForm.trip_type} onChange={e => setTripForm(f => ({ ...f, trip_type: e.target.value }))} className="fiba-select">
                    <option value="pickup">{TRIP_TYPE_LABELS[lang]?.pickup || 'Pick up'}</option>
                    <option value="return">{TRIP_TYPE_LABELS[lang]?.return || 'Return'}</option>
                    <option value="transfer">{TRIP_TYPE_LABELS[lang]?.transfer || 'Transfer'}</option>
                  </select>
                </div>
                <div><label className="fiba-label">{lang === 'es' ? 'N° Viaje' : 'Trip #'}</label><input type="number" min={1} value={tripForm.trip_number} onChange={e => setTripForm(f => ({ ...f, trip_number: parseInt(e.target.value) || 1 }))} className="fiba-input" /></div>
                <div><label className="fiba-label">{lang === 'es' ? 'Hora salida' : 'Departure time'}</label><input type="time" required value={tripForm.departure_time} onChange={e => setTripForm(f => ({ ...f, departure_time: e.target.value }))} className="fiba-input" /></div>
              </div>
              <div>
                <label className="fiba-label">{lang === 'es' ? 'Partido' : 'Game'}</label>
                <select value={tripForm.game_id} onChange={e => selectTripGame(e.target.value)} className="fiba-select">
                  <option value="">{lang === 'es' ? 'Sin partido (traslado general)' : 'No game (general transfer)'}</option>
                  {(tripData.games || []).map(g => (
                    <option key={g.id} value={g.id}>
                      {[formatTime(g.time), gameLabel(g), gamePhase(g)].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </select>
                {(tripData.games || []).length === 0 && (
                  <p className="text-xs text-fiba-muted mt-1">{lang === 'es' ? 'No hay partidos cargados para esta fecha.' : 'No games loaded for this date.'}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="fiba-label">{lang === 'es' ? 'Partida' : 'Origin'}</label><input required list="venue-list" value={tripForm.origin} onChange={e => setTripForm(f => ({ ...f, origin: e.target.value }))} className="fiba-input" /></div>
                <div><label className="fiba-label">{lang === 'es' ? 'Destino' : 'Destination'}</label><input required list="venue-list" value={tripForm.destination} onChange={e => setTripForm(f => ({ ...f, destination: e.target.value }))} className="fiba-input" /></div>
              </div>
              <datalist id="venue-list">{venueNames.map(n => <option key={n} value={n} />)}</datalist>
              <div><label className="fiba-label">{lang === 'es' ? 'Equipo' : 'Equipment'}</label><input placeholder="REM1 + IBC2" value={tripForm.equipment} onChange={e => setTripForm(f => ({ ...f, equipment: e.target.value }))} className="fiba-input" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="fiba-label">{lang === 'es' ? 'Contacto' : 'Contact'}</label><input value={tripForm.contact} onChange={e => setTripForm(f => ({ ...f, contact: e.target.value }))} className="fiba-input" /></div>
                <div><label className="fiba-label">{lang === 'es' ? 'Hora llegada (est.)' : 'Arrival time (est.)'}</label><input type="time" value={tripForm.arrival_time} onChange={e => setTripForm(f => ({ ...f, arrival_time: e.target.value }))} className="fiba-input" /></div>
              </div>
              <div><label className="fiba-label">{lang === 'es' ? 'Comentarios' : 'Comments'}</label><textarea rows={2} value={tripForm.notes} onChange={e => setTripForm(f => ({ ...f, notes: e.target.value }))} className="fiba-input" /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowTripModal(false)} className="px-4 py-2 text-sm text-fiba-muted">{lang === 'es' ? 'Cancelar' : 'Cancel'}</button>
                <button type="submit" className="btn-fiba">{editingTrip ? (lang === 'es' ? 'Guardar' : 'Save') : (lang === 'es' ? 'Crear' : 'Create')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showVehicleModal && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-sm p-6">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-4">{editingVehicle ? (lang === 'es' ? 'Editar Vehículo' : 'Edit Vehicle') : (lang === 'es' ? 'Nuevo Vehículo' : 'New Vehicle')}</h3>
            <form onSubmit={handleVehicleSubmit} className="space-y-3">
              <input required placeholder={lang === 'es' ? 'Nombre (ej: Movilidad 1)' : 'Name (e.g. Mobility 1)'} value={vehicleForm.name} onChange={e => setVehicleForm(f => ({ ...f, name: e.target.value }))} className="fiba-input" />
              <input placeholder={lang === 'es' ? 'Tipo (ej: Van, SUV)' : 'Type (e.g. Van, SUV)'} value={vehicleForm.vehicle_type} onChange={e => setVehicleForm(f => ({ ...f, vehicle_type: e.target.value }))} className="fiba-input" />
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowVehicleModal(false)} className="px-4 py-2 text-sm text-fiba-muted">{lang === 'es' ? 'Cancelar' : 'Cancel'}</button>
                <button type="submit" className="btn-fiba">{editingVehicle ? (lang === 'es' ? 'Guardar' : 'Save') : (lang === 'es' ? 'Crear' : 'Create')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDriverModal && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-sm p-6">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-4">{editingDriver ? (lang === 'es' ? 'Editar Chofer' : 'Edit Driver') : (lang === 'es' ? 'Nuevo Chofer' : 'New Driver')}</h3>
            <form onSubmit={handleDriverSubmit} className="space-y-3">
              <input required placeholder={lang === 'es' ? 'Nombre completo' : 'Full name'} value={driverForm.name} onChange={e => setDriverForm(f => ({ ...f, name: e.target.value }))} className="fiba-input" />
              <input placeholder={lang === 'es' ? 'Teléfono' : 'Phone'} value={driverForm.phone} onChange={e => setDriverForm(f => ({ ...f, phone: e.target.value }))} className="fiba-input" />
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowDriverModal(false)} className="px-4 py-2 text-sm text-fiba-muted">{lang === 'es' ? 'Cancelar' : 'Cancel'}</button>
                <button type="submit" className="btn-fiba">{editingDriver ? (lang === 'es' ? 'Guardar' : 'Save') : (lang === 'es' ? 'Crear' : 'Create')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showVenueModal && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-sm p-6">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-4">{lang === 'es' ? 'Agregar Venue' : 'Add Venue'}</h3>
            <form onSubmit={handleVenueSubmit} className="space-y-3">
              <input required placeholder={lang === 'es' ? 'Nombre' : 'Name'} value={venueForm.name} onChange={e => setVenueForm(f => ({ ...f, name: e.target.value }))} className="fiba-input" />
              <select value={venueForm.type} onChange={e => setVenueForm(f => ({ ...f, type: e.target.value }))} className="fiba-select">
                <option value="venue">Venue</option>
                <option value="hotel">Hotel</option>
              </select>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowVenueModal(false)} className="px-4 py-2 text-sm text-fiba-muted">{lang === 'es' ? 'Cancelar' : 'Cancel'}</button>
                <button type="submit" className="btn-fiba">{lang === 'es' ? 'Agregar' : 'Add'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
