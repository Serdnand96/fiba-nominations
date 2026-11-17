import { useState, useEffect, useMemo } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import { useToast } from '../../components/ui/Toast'
import {
  getTransportEventByCompetition, getTransportVehicles, getLogisticsHotels,
  createTransportTripsFromMovements,
} from '../../api/client'

// Convierte los grupos del manifest (llegadas y salidas por fecha + aeropuerto)
// en viajes de Transporte, uno por grupo.
//
// El sistema propone y la persona decide: la hora sale de la primera llegada
// (o del primer pick-up en las salidas), el destino del hotel principal, y el
// vehículo hay que elegirlo. Nada se crea hasta confirmar, y un grupo que ya
// tiene traslado no aparece — el backend igual lo saltea si llegara a entrar.

const hhmm = (t) => (t ? String(t).slice(0, 5) : '')

function shortDate(iso, lang) {
  if (!iso) return '—'
  return new Date(iso + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es' : 'en-US', { day: 'numeric', month: 'short' })
}

// Hora propuesta: lo más temprano del grupo entre los tramos sin traslado.
function suggestedTime(group, direction) {
  const field = direction === 'departure' ? 'pickup_time' : 'time'
  const times = group.legs.filter(l => !l.trip_id).map(l => hhmm(l[field])).filter(Boolean).sort()
  return times[0] || ''
}

export default function MovementTrips({ competitionId, audience, movements, onClose, onDone }) {
  const { lang } = useLanguage()
  const { push } = useToast()
  const t = (es, en) => (lang === 'es' ? es : en)

  const [vehicles, setVehicles] = useState(null)   // null = cargando
  const [items, setItems] = useState([])
  const [saving, setSaving] = useState(false)

  const pending = useMemo(() => [
    ...(movements.arrivals || []).map(g => ({ ...g, direction: 'arrival' })),
    ...(movements.departures || []).map(g => ({ ...g, direction: 'departure' })),
  ].filter(g => g.date && !g.covered), [movements])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [event, hotels] = await Promise.all([
          getTransportEventByCompetition(competitionId),
          getLogisticsHotels(competitionId),
        ])
        const fleet = event ? await getTransportVehicles(event.id) : []
        if (cancelled) return
        const hotel = (hotels.find(h => h.is_primary) || hotels[0])?.name || ''
        setVehicles(fleet)
        setItems(pending.map(g => ({
          key: `${g.direction}|${g.date}|${g.airport || ''}`,
          checked: true,
          direction: g.direction,
          date: g.date,
          airport: g.airport || null,
          pax: g.legs.filter(l => !l.trip_id).reduce((n, l) => n + (l.pax || 1), 0),
          people: g.legs.filter(l => !l.trip_id).length,
          vehicle_id: fleet[0]?.id || '',
          departure_time: suggestedTime(g, g.direction),
          origin: g.direction === 'arrival' ? (g.airport || '') : hotel,
          destination: g.direction === 'arrival' ? hotel : (g.airport || ''),
        })))
      } catch (err) {
        if (!cancelled) { setVehicles([]); push({ type: 'error', title: err.response?.data?.detail || 'Error' }) }
      }
    })()
    return () => { cancelled = true }
  }, [competitionId, pending, push])

  const update = (key, patch) => setItems(list => list.map(i => (i.key === key ? { ...i, ...patch } : i)))
  const chosen = items.filter(i => i.checked)
  const incomplete = chosen.some(i => !i.vehicle_id || !i.departure_time || !i.origin.trim() || !i.destination.trim())

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await createTransportTripsFromMovements({
        competition_id: competitionId,
        audience: audience || null,
        trips: chosen.map(({ direction, date, airport, vehicle_id, departure_time, origin, destination }) => (
          { direction, date, airport, vehicle_id, departure_time, origin, destination }
        )),
      })
      push({ type: 'success', title: t(`${res.created.length} traslado(s) creados en Transporte.`,
                                       `${res.created.length} transfer(s) created in Transport.`) })
      onDone?.()
    } catch (err) {
      push({ type: 'error', title: err.response?.data?.detail || 'Error' })
    } finally { setSaving(false) }
  }

  return (
    <div className="fiba-modal-overlay">
      <div className="fiba-modal max-w-5xl p-6">
        <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-1">{t('Generar traslados', 'Generate transfers')}</h3>
        <p className="text-xs text-fiba-muted mb-4">
          {t('Un viaje por grupo de llegadas o salidas. Revisa la hora y el vehículo antes de crear: quedan en Transporte → Viajes por vehículo.',
             'One trip per arrivals or departures group. Check the time and the vehicle before creating: they land in Transport → Trips by vehicle.')}
        </p>

        {vehicles === null ? (
          <div className="py-8 text-center text-sm text-fiba-muted">{t('Cargando...', 'Loading...')}</div>
        ) : vehicles.length === 0 ? (
          <div className="fiba-card p-6 text-center text-fiba-muted text-sm">
            {t('No hay vehículos cargados para esta competencia. Agrégalos en Transporte → Vehículos, choferes y venues.',
               'No vehicles loaded for this competition. Add them in Transport → Vehicles, drivers & venues.')}
          </div>
        ) : items.length === 0 ? (
          <div className="fiba-card p-6 text-center text-fiba-muted text-sm">
            {t('Todos los grupos con fecha ya tienen traslado.', 'Every dated group already has a transfer.')}
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="max-h-[60vh] overflow-auto rounded-xl border border-fiba-border">
              <table className="fiba-table">
                <thead>
                  <tr>
                    <th className="w-8" />
                    <th>{t('Grupo', 'Group')}</th>
                    <th>{t('Hora', 'Time')}</th>
                    <th>{t('Vehículo', 'Vehicle')}</th>
                    <th>{t('Origen', 'Origin')}</th>
                    <th>{t('Destino', 'Destination')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(i => (
                    <tr key={i.key} className={i.checked ? '' : 'opacity-50'}>
                      <td className="px-3 py-1.5">
                        <input type="checkbox" checked={i.checked} onChange={e => update(i.key, { checked: e.target.checked })}
                          aria-label={t('Incluir este grupo', 'Include this group')} />
                      </td>
                      <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                        <span className="font-medium">{i.direction === 'arrival' ? t('Llegada', 'Arrival') : t('Salida', 'Departure')}</span>
                        {' · '}{shortDate(i.date, lang)} · {i.airport || t('sin aeropuerto', 'no airport')}
                        <span className="block text-[11px] text-fiba-muted">{i.people} {t('tramo(s)', 'leg(s)')} · {i.pax} pax</span>
                      </td>
                      <td className="px-3 py-1.5">
                        <input type="time" value={i.departure_time} disabled={!i.checked}
                          onChange={e => update(i.key, { departure_time: e.target.value })} className="fiba-input w-28 text-xs h-8" />
                      </td>
                      <td className="px-3 py-1.5">
                        <select value={i.vehicle_id} disabled={!i.checked}
                          onChange={e => update(i.key, { vehicle_id: e.target.value })} className="fiba-select text-xs h-8">
                          {vehicles.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-1.5">
                        <input value={i.origin} disabled={!i.checked}
                          onChange={e => update(i.key, { origin: e.target.value })} className="fiba-input text-xs h-8" />
                      </td>
                      <td className="px-3 py-1.5">
                        <input value={i.destination} disabled={!i.checked}
                          onChange={e => update(i.key, { destination: e.target.value })} className="fiba-input text-xs h-8" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {incomplete && (
              <p className="text-xs text-amber-500 mt-2">
                {t('Falta la hora, el vehículo, el origen o el destino en algún grupo marcado.',
                   'A checked group is missing its time, vehicle, origin or destination.')}
              </p>
            )}
            <div className="flex justify-end gap-3 pt-4">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-fiba-muted">{t('Cancelar', 'Cancel')}</button>
              <button type="submit" disabled={saving || chosen.length === 0 || incomplete} className="btn-fiba disabled:opacity-50">
                {t(`Crear ${chosen.length} traslado(s)`, `Create ${chosen.length} transfer(s)`)}
              </button>
            </div>
          </form>
        )}

        {(vehicles === null || vehicles.length === 0 || items.length === 0) && (
          <div className="flex justify-end pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-fiba-muted">{t('Cerrar', 'Close')}</button>
          </div>
        )}
      </div>
    </div>
  )
}
