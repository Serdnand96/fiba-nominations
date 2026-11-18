import { useState, useEffect, useCallback, useMemo } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import { useToast } from '../../components/ui/Toast'
import {
  getLogisticsParticipants, createLogisticsParticipant, updateLogisticsParticipant,
  deleteLogisticsParticipant, seedLogisticsFromCrew,
  getLogisticsMovements, createLogisticsTravelLeg, updateLogisticsTravelLeg,
  downloadLogisticsXlsx,
} from '../../api/client'
import SheetImport from './SheetImport'
import MovementTrips from './MovementTrips'
import { DEFAULT_CATEGORY } from './audiences'
import { DocumentsPanel } from './opsShared'
import { Icon } from '../../lib/icons'

// Sección Travel Manifest: el padrón de quién viene, y con qué vuelo llega y se
// va cada uno.
//
// La vista "Grupos" es la que se usa para operar: nadie manda una combi por
// persona, se juntan los que caen en el mismo aeropuerto el mismo día. Es la
// hoja suelta que la organización arma a mano en cada evento.

const CATEGORY_LABELS = {
  es: { official: 'Oficial', fiba_staff: 'Personal FIBA', vip: 'VIP', team: 'Delegación', guest: 'Invitado' },
  en: { official: 'Official', fiba_staff: 'FIBA staff', vip: 'VIP', team: 'Team', guest: 'Guest' },
}

const CATEGORY_STYLES = {
  official: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-500',
  fiba_staff: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  vip: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400',
  team: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-500',
  guest: 'bg-fiba-surface text-fiba-muted',
}

const MODE_ICONS = { flight: Icon.Plane, bus: Icon.Bus, ferry: Icon.Ship, car: Icon.Car }

const EMPTY_PARTICIPANT = {
  first_name: '', last_name: '', role: '', category: 'official', team: '',
  passport: '', nationality: '', phone: '', email: '', dietary_restrictions: '', pax: 1, notes: '',
}

const EMPTY_LEG = {
  direction: 'arrival', date: '', time: '', pickup_time: '',
  flight_number: '', airport: '', transport_mode: 'flight', comments: '',
}

function shortDate(iso, lang) {
  if (!iso) return '-'
  return new Date(iso + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es' : 'en-US', { day: 'numeric', month: 'short' })
}

const hhmm = (t) => (t ? t.slice(0, 5) : '')

// Definida FUERA de ManifestTab: adentro se redefinía en cada render y, como el
// buscador cambia estado en cada tecla, React remontaba las celdas de vuelo de
// toda la tabla (perdiendo foco). MODE_ICONS/shortDate/hhmm son module-level.
function LegCell({ participant, direction, lang, canEdit, openLeg }) {
  const leg = direction === 'arrival' ? participant.arrival : participant.departure
  const ModeIcon = leg ? MODE_ICONS[leg.transport_mode] : null
  const content = leg ? (
    <div className="leading-tight">
      <div className="text-xs whitespace-nowrap">
        {ModeIcon && <ModeIcon className="w-3.5 h-3.5 inline-block mr-1 align-[-2px]" />}
        {shortDate(leg.date, lang)} {hhmm(leg.time)}
      </div>
      <div className="text-[10px] text-fiba-muted whitespace-nowrap">
        {[leg.flight_number, leg.airport].filter(Boolean).join(' · ') || '-'}
        {leg.pickup_time && ` · ${lang === 'es' ? 'recogida' : 'pick-up'} ${hhmm(leg.pickup_time)}`}
      </div>
    </div>
  ) : <span className="text-fiba-muted text-xs">-</span>

  if (!canEdit) return content
  return (
    <button onClick={() => openLeg(participant, direction)} className="text-left hover:opacity-70 w-full">
      {content}
    </button>
  )
}

export default function ManifestTab({ competitionId, canEdit, audience }) {
  const { lang } = useLanguage()
  const { push } = useToast()
  const t = (es, en) => (lang === 'es' ? es : en)

  const [view, setView] = useState('people')
  const [participants, setParticipants] = useState([])
  const [movements, setMovements] = useState({ arrivals: [], departures: [] })
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  const [showPersonModal, setShowPersonModal] = useState(false)
  const [editingPerson, setEditingPerson] = useState(null)
  const [personForm, setPersonForm] = useState(EMPTY_PARTICIPANT)

  const [legTarget, setLegTarget] = useState(null)   // { participant, direction, leg }
  const [showTrips, setShowTrips] = useState(false)
  const [legForm, setLegForm] = useState(EMPTY_LEG)

  const load = useCallback(async () => {
    if (!competitionId) return
    setLoading(true)
    try {
      const [p, m] = await Promise.all([
        getLogisticsParticipants(competitionId, audience),
        getLogisticsMovements(competitionId, audience),
      ])
      setParticipants(p); setMovements(m)
    } catch (err) { console.error('Manifest load error:', err) }
    finally { setLoading(false) }
  }, [competitionId, audience])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return participants
    return participants.filter(p =>
      [p.first_name, p.last_name, p.role, p.passport].filter(Boolean).join(' ').toLowerCase().includes(q))
  }, [participants, search])

  function openCreatePerson() {
    // Quien se carga desde la pestaña de una audiencia nace en esa audiencia.
    setEditingPerson(null)
    setPersonForm({ ...EMPTY_PARTICIPANT, category: DEFAULT_CATEGORY[audience || ''] })
    setShowPersonModal(true)
  }

  function openEditPerson(p) {
    setEditingPerson(p)
    setPersonForm({
      first_name: p.first_name || '', last_name: p.last_name || '', role: p.role || '',
      category: p.category || 'official', team: p.team || '', passport: p.passport || '', nationality: p.nationality || '',
      phone: p.phone || '', email: p.email || '', dietary_restrictions: p.dietary_restrictions || '',
      pax: p.pax || 1, notes: p.notes || '',
    })
    setShowPersonModal(true)
  }

  async function handlePersonSubmit(e) {
    e.preventDefault()
    const payload = Object.fromEntries(
      Object.entries(personForm).map(([k, v]) => [k, v === '' ? null : v])
    )
    payload.first_name = personForm.first_name
    payload.pax = Number(personForm.pax) || 1
    try {
      if (editingPerson) await updateLogisticsParticipant(editingPerson.id, payload)
      else await createLogisticsParticipant({ ...payload, competition_id: competitionId })
      setShowPersonModal(false); await load()
    } catch (err) { push({ type: 'error', title: err.response?.data?.detail || t('No se pudo guardar la persona.', 'Could not save the person.') }) }
  }

  async function handleDeletePerson(p) {
    const name = [p.first_name, p.last_name].filter(Boolean).join(' ')
    if (!confirm(t(`¿Quitar a ${name}? También se eliminan sus vuelos y su estadía.`,
                   `Remove ${name}? Their flights and stay are deleted too.`))) return
    await deleteLogisticsParticipant(p.id); await load()
  }

  async function handleSeedFromCrew() {
    try {
      const res = await seedLogisticsFromCrew(competitionId)
      if (res.created === 0) {
        push({ type: 'info', title: t('No hay oficiales asignados nuevos para agregar.', 'No new assigned officials to add.') })
      }
      await load()
    } catch (err) { push({ type: 'error', title: err.response?.data?.detail || t('No se pudieron agregar los oficiales.', 'Could not add the officials.') }) }
  }

  function openLeg(participant, direction) {
    const leg = direction === 'arrival' ? participant.arrival : participant.departure
    setLegTarget({ participant, direction, leg })
    setLegForm(leg ? {
      direction,
      date: leg.date || '', time: hhmm(leg.time), pickup_time: hhmm(leg.pickup_time),
      flight_number: leg.flight_number || '', airport: leg.airport || '',
      transport_mode: leg.transport_mode || 'flight', comments: leg.comments || '',
    } : { ...EMPTY_LEG, direction })
  }

  async function handleLegSubmit(e) {
    e.preventDefault()
    const payload = Object.fromEntries(
      Object.entries(legForm).map(([k, v]) => [k, v === '' ? null : v])
    )
    payload.direction = legForm.direction
    payload.transport_mode = legForm.transport_mode
    try {
      if (legTarget.leg) await updateLogisticsTravelLeg(legTarget.leg.id, payload)
      else await createLogisticsTravelLeg({ ...payload, participant_id: legTarget.participant.id })
      setLegTarget(null); await load()
    } catch (err) {
      const fallback = legTarget.direction === 'arrival'
        ? t('No se pudo guardar la llegada.', 'Could not save the arrival.')
        : t('No se pudo guardar la salida.', 'Could not save the departure.')
      push({ type: 'error', title: err.response?.data?.detail || fallback })
    }
  }

  const VIEW_LABELS = {
    people: t('Por persona', 'By person'),
    groups: t('Por grupo', 'By group'),
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex">
          {Object.entries(VIEW_LABELS).map(([key, label]) => (
            <button key={key} onClick={() => setView(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                view === key ? 'border-fiba-accent text-fiba-accent' : 'border-transparent text-fiba-muted hover:text-ink-700 dark:text-gray-300'
              }`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Buscar persona...', 'Search person...')}
            className="fiba-input w-auto text-xs h-8" />
          <button onClick={() => downloadLogisticsXlsx('manifest', competitionId, audience)} className="btn-fiba-ghost text-xs px-3 py-1.5">
            {t('Exportar Excel', 'Export Excel')}
          </button>
          {canEdit && (
            <>
              {view === 'groups' && (
                <button onClick={() => setShowTrips(true)} className="btn-fiba-ghost text-xs px-3 py-1.5">
                  {t('Generar traslados', 'Generate transfers')}
                </button>
              )}
              {/* El crew son oficiales: no tiene sentido traerlo a Delegación o VIP. */}
              {(!audience || audience === 'staff') && (
                <button onClick={handleSeedFromCrew} className="btn-fiba-ghost text-xs px-3 py-1.5">
                  {t('Agregar oficiales asignados', 'Add assigned officials')}
                </button>
              )}
              <button onClick={openCreatePerson} className="btn-fiba text-xs px-3 py-1.5">+ {t('Persona', 'Person')}</button>
            </>
          )}
        </div>
      </div>

      {/* La key descarta el preview al cambiar de competencia o de audiencia:
          si no, "Confirmar" importaría en un lugar distinto del que se previsualizó. */}
      {canEdit && (
        <SheetImport key={`${competitionId}-${audience}`} kind="manifest"
          competitionId={competitionId} audience={audience} onDone={load} />
      )}

      {loading ? (
        <div className="text-center py-8 text-fiba-muted text-sm">{t('Cargando...', 'Loading...')}</div>
      ) : participants.length === 0 ? (
        <div className="fiba-card p-8 text-center text-fiba-muted">
          <p className="text-sm">{t('Todavía no hay personas.', 'No people yet.')}</p>
          <p className="text-xs mt-1">
            {t('Importa el manifiesto de vuelos o agrega personas.',
               'Import the flight manifest or add people.')}
          </p>
        </div>
      ) : view === 'people' ? (
        <div className="rounded-xl border border-fiba-border overflow-x-auto">
          <table className="fiba-table">
            <thead>
              <tr>
                <th>{t('Nombre', 'Name')}</th>
                <th>{t('Cargo', 'Role')}</th>
                <th>{t('Categoría', 'Category')}</th>
                {audience === 'delegation' && <th>{t('Equipo', 'Team')}</th>}
                <th>{t('Pasaporte', 'Passport')}</th>
                <th>{t('Llegada', 'Arrival')}</th>
                <th>{t('Salida', 'Departure')}</th>
                {canEdit && <th className="w-20"></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id}>
                  <td className="px-4 py-2 font-medium whitespace-nowrap">
                    {[p.first_name, p.last_name].filter(Boolean).join(' ')}
                    {p.pax > 1 && <span className="text-fiba-muted text-xs"> ({p.pax} pax)</span>}
                  </td>
                  <td className="px-4 py-2 text-xs text-fiba-muted whitespace-nowrap">{p.role || '-'}</td>
                  <td className="px-4 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${CATEGORY_STYLES[p.category] || ''}`}>
                      {CATEGORY_LABELS[lang]?.[p.category] || p.category}
                    </span>
                  </td>
                  {audience === 'delegation' && <td className="px-4 py-2 text-xs whitespace-nowrap">{p.team || '-'}</td>}
                  <td className="px-4 py-2 font-mono text-xs text-fiba-muted">{p.passport || '-'}</td>
                  <td className="px-4 py-2"><LegCell participant={p} direction="arrival" lang={lang} canEdit={canEdit} openLeg={openLeg} /></td>
                  <td className="px-4 py-2"><LegCell participant={p} direction="departure" lang={lang} canEdit={canEdit} openLeg={openLeg} /></td>
                  {canEdit && (
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <button onClick={() => openEditPerson(p)} className="text-fiba-accent hover:underline text-xs">{t('Editar', 'Edit')}</button>
                        <button onClick={() => handleDeletePerson(p)} className="text-red-400 hover:underline text-xs">{t('Quitar', 'Remove')}</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={(canEdit ? 7 : 6) + (audience === 'delegation' ? 1 : 0)} className="px-4 py-6 text-center text-fiba-muted/60 text-xs">
                  {t('Nadie coincide con la búsqueda.', 'Nobody matches the search.')}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[
            { key: 'arrivals', title: t('Llegadas', 'Arrivals') },
            { key: 'departures', title: t('Salidas', 'Departures') },
          ].map(({ key, title }) => (
            <div key={key}>
              <h3 className="text-lg font-semibold text-ink-900 dark:text-white mb-3">{title}</h3>
              {(movements[key] || []).length === 0 ? (
                <div className="fiba-card p-6 text-center text-fiba-muted text-sm">
                  {t('Sin movimientos cargados.', 'No movements loaded.')}
                </div>
              ) : (
                <div className="space-y-3">
                  {movements[key].map((group, i) => (
                    <div key={i} className="bg-fiba-card rounded-xl border border-fiba-border overflow-hidden">
                      <div className="bg-fiba-surface px-4 py-2 flex items-center justify-between">
                        <span className="text-sm font-semibold text-ink-900 dark:text-white">
                          {shortDate(group.date, lang)} · {group.airport || t('Sin aeropuerto', 'No airport')}
                        </span>
                        <span className="flex items-center gap-2 text-xs text-fiba-muted">
                          {group.covered && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-500">
                              {t('con traslado', 'transfer booked')}
                            </span>
                          )}
                          {group.pax} pax
                        </span>
                      </div>
                      <table className="fiba-table">
                        <tbody>
                          {group.legs.map(leg => (
                            <tr key={leg.id}>
                              <td className="px-4 py-1.5 text-xs font-mono w-16">{hhmm(leg.time) || '-'}</td>
                              <td className="px-4 py-1.5 text-xs font-medium whitespace-nowrap">{leg.participant_name}</td>
                              <td className="px-4 py-1.5 text-xs text-fiba-muted">{leg.participant_role || ''}</td>
                              <td className="px-4 py-1.5 text-xs text-fiba-muted">{leg.flight_number || ''}</td>
                              <td className="px-4 py-1.5 text-xs text-fiba-muted">
                                {leg.pickup_time ? `${t('recogida', 'pick-up')} ${hhmm(leg.pickup_time)}` : ''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showTrips && (
        <MovementTrips competitionId={competitionId} audience={audience} movements={movements}
          onClose={() => setShowTrips(false)}
          onDone={async () => { setShowTrips(false); await load() }} />
      )}

      {/* ── Modal de persona ────────────────────────────────── */}
      {showPersonModal && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-lg p-6">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-4">
              {editingPerson ? t('Editar persona', 'Edit person') : t('Nueva persona', 'New person')}
            </h3>
            <form onSubmit={handlePersonSubmit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="fiba-label">{t('Nombre', 'First name')}</label>
                  <input required value={personForm.first_name} onChange={e => setPersonForm(f => ({ ...f, first_name: e.target.value }))} className="fiba-input" /></div>
                <div><label className="fiba-label">{t('Apellido', 'Last name')}</label>
                  <input value={personForm.last_name} onChange={e => setPersonForm(f => ({ ...f, last_name: e.target.value }))} className="fiba-input" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="fiba-label">{t('Cargo', 'Role')}</label>
                  <input placeholder={t('Ej.: Delegado técnico', 'e.g. Technical Delegate')} value={personForm.role} onChange={e => setPersonForm(f => ({ ...f, role: e.target.value }))} className="fiba-input" /></div>
                <div><label className="fiba-label">{t('Categoría', 'Category')}</label>
                  <select value={personForm.category} onChange={e => setPersonForm(f => ({ ...f, category: e.target.value }))} className="fiba-select">
                    {Object.entries(CATEGORY_LABELS[lang] || CATEGORY_LABELS.en).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div><label className="fiba-label">{t('Equipo / delegación', 'Team / delegation')}</label>
                <input placeholder={t('Ej.: Argentina', 'e.g. Argentina')} value={personForm.team} onChange={e => setPersonForm(f => ({ ...f, team: e.target.value }))} className="fiba-input" /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="fiba-label">{t('Pasaporte', 'Passport')}</label>
                  <input value={personForm.passport} onChange={e => setPersonForm(f => ({ ...f, passport: e.target.value }))} className="fiba-input" /></div>
                <div><label className="fiba-label">{t('Nacionalidad', 'Nationality')}</label>
                  <input value={personForm.nationality} onChange={e => setPersonForm(f => ({ ...f, nationality: e.target.value }))} className="fiba-input" /></div>
                <div><label className="fiba-label">{t('Personas (pax)', 'People (pax)')}</label>
                  <input type="number" min={1} value={personForm.pax} onChange={e => setPersonForm(f => ({ ...f, pax: e.target.value }))} className="fiba-input" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="fiba-label">{t('Teléfono', 'Phone')}</label>
                  <input value={personForm.phone} onChange={e => setPersonForm(f => ({ ...f, phone: e.target.value }))} className="fiba-input" /></div>
                <div><label className="fiba-label">{t('Correo electrónico', 'Email')}</label>
                  <input type="email" value={personForm.email} onChange={e => setPersonForm(f => ({ ...f, email: e.target.value }))} className="fiba-input" /></div>
              </div>
              <div><label className="fiba-label">{t('Restricciones alimentarias', 'Dietary restrictions')}</label>
                <input value={personForm.dietary_restrictions} onChange={e => setPersonForm(f => ({ ...f, dietary_restrictions: e.target.value }))} className="fiba-input" /></div>
              <div><label className="fiba-label">{t('Notas', 'Notes')}</label>
                <textarea rows={2} value={personForm.notes} onChange={e => setPersonForm(f => ({ ...f, notes: e.target.value }))} className="fiba-input" /></div>
              {/* Solo al editar: el archivo cuelga de una persona que ya existe. Los
                  escaneos son privados y no salen en el link público. */}
              {editingPerson && (
                <div className="pt-3 border-t border-fiba-border">
                  <label className="fiba-label">{t('Escaneo del pasaporte', 'Passport scan')}</label>
                  <DocumentsPanel competitionId={competitionId}
                    filters={{ kind: 'passport', participant_id: editingPerson.id }} canEdit={canEdit}
                    labels={{ empty: t('Sin escaneo de pasaporte cargado.', 'No passport scan uploaded.'), upload: t('Subir escaneo', 'Upload scan') }} />
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowPersonModal(false)} className="px-4 py-2 text-sm text-fiba-muted">{t('Cancelar', 'Cancel')}</button>
                <button type="submit" className="btn-fiba">{editingPerson ? t('Guardar', 'Save') : t('Crear', 'Create')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal de tramo ──────────────────────────────────── */}
      {legTarget && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-lg p-6">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-1">
              {legTarget.direction === 'arrival' ? t('Llegada', 'Arrival') : t('Salida', 'Departure')}
            </h3>
            <p className="text-xs text-fiba-muted mb-4">
              {[legTarget.participant.first_name, legTarget.participant.last_name].filter(Boolean).join(' ')}
            </p>
            <form onSubmit={handleLegSubmit} className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div><label className="fiba-label">{t('Medio', 'Mode')}</label>
                  <select value={legForm.transport_mode} onChange={e => setLegForm(f => ({ ...f, transport_mode: e.target.value }))} className="fiba-select">
                    <option value="flight">{t('Vuelo', 'Flight')}</option>
                    <option value="bus">{t('Bus', 'Bus')}</option>
                    <option value="ferry">{t('Ferry', 'Ferry')}</option>
                    <option value="car">{t('Auto', 'Car')}</option>
                    <option value="other">{t('Otro', 'Other')}</option>
                  </select>
                </div>
                <div><label className="fiba-label">{t('Fecha', 'Date')}</label>
                  <input type="date" value={legForm.date} onChange={e => setLegForm(f => ({ ...f, date: e.target.value }))} className="fiba-input" /></div>
                <div><label className="fiba-label">{legTarget.direction === 'arrival' ? t('Hora de llegada', 'Arrival time') : t('Hora del vuelo', 'Flight time')}</label>
                  <input type="time" value={legForm.time} onChange={e => setLegForm(f => ({ ...f, time: e.target.value }))} className="fiba-input" /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="fiba-label">{t('N.º de vuelo', 'Flight #')}</label>
                  <input value={legForm.flight_number} onChange={e => setLegForm(f => ({ ...f, flight_number: e.target.value }))} className="fiba-input" /></div>
                <div><label className="fiba-label">{t('Aeropuerto / terminal', 'Airport / terminal')}</label>
                  <input placeholder="EZE" value={legForm.airport} onChange={e => setLegForm(f => ({ ...f, airport: e.target.value }))} className="fiba-input" /></div>
                <div><label className="fiba-label">{t('Hora de recogida', 'Pick-up time')}</label>
                  <input type="time" value={legForm.pickup_time} onChange={e => setLegForm(f => ({ ...f, pickup_time: e.target.value }))} className="fiba-input" /></div>
              </div>
              <div><label className="fiba-label">{t('Comentarios', 'Comments')}</label>
                <textarea rows={2} value={legForm.comments} onChange={e => setLegForm(f => ({ ...f, comments: e.target.value }))} className="fiba-input" /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setLegTarget(null)} className="px-4 py-2 text-sm text-fiba-muted">{t('Cancelar', 'Cancel')}</button>
                <button type="submit" className="btn-fiba">{t('Guardar', 'Save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
