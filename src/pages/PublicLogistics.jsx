import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  getPublicLogistics, getPublicLogisticsTransport,
  getPublicLogisticsManifest, getPublicLogisticsRooming, getPublicLogisticsSchedules,
} from '../api/client'
import AudienceSwitch, { audienceLabel } from './logistics/audiences'
import { ScheduleDay, groupByDay } from './logistics/ScheduleDay'
import { useLanguage } from '../i18n/LanguageContext'
import { Icon } from '../lib/icons'
import { PublicShell, PublicUnavailable } from '../components/layout/PublicShell'

// Vista pública de logística: el personal — interno o externo — abre un link
// compartido y consulta traslados, hospedaje y vuelos sin tener cuenta.
//
// Se renderiza fuera del shell autenticado (ver el early-return de App.jsx),
// así que trae su propio encabezado. Pensada para celular y para imprimir: en
// el hotel y en la cancha se cuelga en papel.

const MEAL_LABELS = {
  es: { breakfast: 'Desayuno', lunch: 'Almuerzo', dinner: 'Cena', snack: 'Refrigerio' },
  en: { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' },
}

const MODE_ICONS = { flight: Icon.Plane, bus: Icon.Bus, ferry: Icon.Ship, car: Icon.Car }

const hhmm = (t) => (t ? t.slice(0, 5) : '')

// Títulos en tipo oración: el locale español devuelve "miércoles, 12 de noviembre".
function longDate(iso, lang) {
  if (!iso) return ''
  const s = new Date(iso + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es' : 'en-US',
    { weekday: 'long', day: 'numeric', month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function shortDate(iso, lang) {
  if (!iso) return '-'
  return new Date(iso + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es' : 'en-US',
    { day: 'numeric', month: 'short' })
}

function dateRange(start, end, lang) {
  const s = shortDate(start, lang)
  const e = shortDate(end || start, lang)
  if (s === e) return s
  return lang === 'es' ? `${s} al ${e}` : `${s} to ${e}`
}

const blockTitle = 'text-base font-semibold text-navy-900 dark:text-white'

const card = 'rounded-xl border border-ink-200 dark:border-navy-800 bg-white dark:bg-navy-900'

export default function PublicLogistics() {
  const { token } = useParams()
  const { lang } = useLanguage()
  const t = (es, en) => (lang === 'es' ? es : en)

  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)

  const [section, setSection] = useState('transport')
  // Staff / Delegación / VIP: recorta cronogramas, hospedaje y vuelos. '' = todos.
  const [audience, setAudience] = useState('')
  const audienceRef = useRef('')
  const [schedules, setSchedules] = useState(null)
  const [transport, setTransport] = useState(null)
  const [transportDate, setTransportDate] = useState(null)
  const [manifest, setManifest] = useState(null)
  const [rooming, setRooming] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    // Los cronogramas se piden junto con la cabecera: si hay alguno publicado
    // son la pantalla de entrada; si no (o si fallan), se entra por traslados
    // como siempre.
    Promise.all([
      getPublicLogistics(token),
      getPublicLogisticsSchedules(token).catch(() => []),
    ])
      .then(([data, docs]) => {
        if (cancelled) return
        setSchedules(docs)
        if (docs.some(d => d.rows.length > 0)) setSection('schedules')
        setOverview(data); setLoading(false)
      })
      .catch(() => { if (!cancelled) { setInvalid(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [token])

  // Cada sección se pide cuando se abre por primera vez: el visitante casi
  // siempre viene por una sola.
  useEffect(() => {
    if (!overview) return
    if (section === 'transport' && !transport) {
      getPublicLogisticsTransport(token).then(setTransport).catch(() => setTransport({ dates: [], trips: [] }))
    }
    // Hospedaje y vuelos se piden recortados a la audiencia. Una respuesta
    // que llega después de que el visitante cambió de audiencia se descarta.
    const current = (apply) => (data) => { if (audienceRef.current === audience) apply(data) }
    if (section === 'manifest' && !manifest) {
      getPublicLogisticsManifest(token, audience).then(current(setManifest)).catch(current(() => setManifest({ rows: [] })))
    }
    if (section === 'rooming' && !rooming) {
      getPublicLogisticsRooming(token, audience).then(current(setRooming)).catch(current(() => setRooming({ rows: [], dates: [] })))
    }
  }, [section, overview, token, audience, manifest, rooming])

  // Al cambiar de audiencia se descartan y el efecto de arriba los vuelve a traer.
  function pickAudience(next) {
    audienceRef.current = next
    setAudience(next); setManifest(null); setRooming(null)
  }

  function pickDate(date) {
    setTransportDate(date)
    getPublicLogisticsTransport(token, date).then(setTransport).catch(() => {})
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-ink-50 dark:bg-navy-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-basketball-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (invalid) {
    return (
      <PublicUnavailable
        title={t('Este enlace no está disponible', 'This link is not available')}
        message={t('El enlace venció o fue reemplazado. Pide uno nuevo a FIBA Americas.',
                   'The link expired or was replaced. Ask FIBA Americas for a new one.')} />
    )
  }

  const comp = overview.competition
  const SECTIONS = {
    schedules: t('Cronogramas', 'Schedules'),
    transport: t('Traslados', 'Transfers'),
    rooming: t('Hospedaje', 'Hotels'),
    manifest: t('Vuelos', 'Flights'),
  }

  const matches = (text) => !search.trim() || (text || '').toLowerCase().includes(search.trim().toLowerCase())

  return (
    <PublicShell
      title={comp.name}
      context={[comp.location, comp.start_date && dateRange(comp.start_date, comp.end_date, lang)]
        .filter(Boolean).join(' · ')}>
      {/* ── Secciones ───────────────────────────────────────── */}
      <nav className="border-b border-ink-200 dark:border-navy-800 bg-white dark:bg-navy-900 sticky top-0 z-10 print:hidden">
        <div className="max-w-5xl mx-auto px-4 flex overflow-x-auto">
          {Object.entries(SECTIONS).map(([key, label]) => (
            <button key={key} onClick={() => setSection(key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                section === key
                  ? 'border-basketball-500 text-basketball-700 dark:text-basketball-500'
                  : 'border-transparent text-ink-500 dark:text-ink-400 hover:text-ink-900 dark:hover:text-white'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {section !== 'transport' && (
          <div className="print:hidden">
            <AudienceSwitch value={audience} onChange={pickAudience} lang={lang} />
          </div>
        )}

        {/* ── Cronogramas (pick-up / return y comidas) ──────── */}
        {section === 'schedules' && (() => {
          if (!schedules) return <p className="text-sm text-ink-500 dark:text-ink-400">{t('Cargando...', 'Loading...')}</p>
          const shown = schedules.filter(s => (!audience || s.audience === audience) && s.rows.length > 0)
          if (shown.length === 0) {
            return (
              <div className={`${card} p-8 text-center`}>
                <p className="text-sm text-ink-500 dark:text-ink-400">
                  {t('Todavía no hay cronogramas publicados.', 'No schedules published yet.')}
                </p>
              </div>
            )
          }
          return shown.map(s => (
            <section key={s.id} className="space-y-3">
              <div>
                <h2 className={blockTitle}>
                  {s.section === 'transport' ? t('Traslados', 'Transfers') : t('Comidas', 'Meals')}
                  {/* Hay varios cronogramas por audiencia (árbitros, Comunicaciones...): la etiqueta los distingue. */}
                  {s.label ? `: ${s.label}` : ''}
                </h2>
                <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">
                  {[audienceLabel(s.audience, lang), s.title, s.subtitle].filter(Boolean).join(' · ')}
                </p>
              </div>
              {groupByDay(s).map(day => <ScheduleDay key={day.date} day={day} section={s.section} lang={lang} />)}
            </section>
          ))
        })()}

        {/* ── Traslados ─────────────────────────────────────── */}
        {section === 'transport' && (
          <>
            {transport?.dates?.length > 0 && (
              <div className="flex flex-wrap gap-2 print:hidden">
                <button onClick={() => pickDate(null)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    !transportDate ? 'bg-basketball-700 text-white border-basketball-700'
                    : 'border-ink-200 dark:border-navy-700 text-ink-500 dark:text-ink-400'
                  }`}>
                  {t('Todos', 'All')}
                </button>
                {transport.dates.map(d => (
                  <button key={d} onClick={() => pickDate(d)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      transportDate === d ? 'bg-basketball-700 text-white border-basketball-700'
                      : 'border-ink-200 dark:border-navy-700 text-ink-500 dark:text-ink-400'
                    }`}>
                    {shortDate(d, lang)}
                  </button>
                ))}
              </div>
            )}

            {!transport ? (
              <p className="text-sm text-ink-500 dark:text-ink-400">{t('Cargando...', 'Loading...')}</p>
            ) : transport.trips.length === 0 ? (
              <div className={`${card} p-8 text-center`}>
                <p className="text-sm text-ink-500 dark:text-ink-400">
                  {t('Todavía no hay traslados publicados.', 'No transfers published yet.')}
                </p>
              </div>
            ) : (
              Object.entries(
                transport.trips.reduce((acc, trip) => {
                  (acc[trip.date] ||= []).push(trip)
                  return acc
                }, {})
              ).map(([date, trips]) => (
                <section key={date}>
                  <h2 className={`${blockTitle} mb-2`}>
                    {longDate(date, lang)}
                  </h2>
                  <div className={`${card} overflow-x-auto`}>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-ink-500 dark:text-ink-400 border-b border-ink-200 dark:border-navy-800">
                          <th className="px-3 py-2 font-medium">{t('Hora', 'Time')}</th>
                          <th className="px-3 py-2 font-medium">{t('Desde', 'From')}</th>
                          <th className="px-3 py-2 font-medium">{t('Hasta', 'To')}</th>
                          <th className="px-3 py-2 font-medium">{t('Vehículo', 'Vehicle')}</th>
                          <th className="px-3 py-2 font-medium">{t('Partido', 'Game')}</th>
                          <th className="px-3 py-2 font-medium">{t('Notas', 'Notes')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trips.map(trip => (
                          <tr key={trip.id} className="border-b border-ink-100 dark:border-navy-800/60 last:border-0">
                            <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{hhmm(trip.departure_time)}</td>
                            <td className="px-3 py-2">{trip.origin}</td>
                            <td className="px-3 py-2">{trip.destination}</td>
                            <td className="px-3 py-2 text-xs text-ink-500 dark:text-ink-400 whitespace-nowrap">
                              {trip.vehicle?.name}
                              {trip.driver?.name && <div className="text-[11px]">{trip.driver.name}{trip.driver.phone ? ` · ${trip.driver.phone}` : ''}</div>}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {trip.game ? `${trip.game.team_a || '?'} vs ${trip.game.team_b || '?'}` : '-'}
                            </td>
                            <td className="px-3 py-2 text-xs text-ink-500 dark:text-ink-400">{trip.notes || ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))
            )}
          </>
        )}

        {/* ── Hospedaje ─────────────────────────────────────── */}
        {section === 'rooming' && (
          <>
            {overview.hotels.length > 0 && (
              <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {overview.hotels.map(h => (
                  <div key={h.id} className={`${card} p-4`}>
                    <div className="font-semibold">{h.name}</div>
                    {h.address && <div className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">{h.address}</div>}
                    <dl className="text-xs text-ink-500 dark:text-ink-400 mt-2 space-y-0.5">
                      {h.phone && <div>{t('Teléfono', 'Phone')}: {h.phone}</div>}
                      {(h.check_in_time || h.check_out_time) && (
                        <div>Check-in {hhmm(h.check_in_time) || '-'} · Check-out {hhmm(h.check_out_time) || '-'}</div>
                      )}
                      {h.notes && <div>{h.notes}</div>}
                    </dl>
                    {h.map_url && (
                      <a href={h.map_url} target="_blank" rel="noreferrer noopener"
                        className="text-xs text-basketball-700 dark:text-basketball-500 hover:underline mt-2 inline-block">
                        {t('Ver en el mapa', 'View on map')}
                      </a>
                    )}
                  </div>
                ))}
              </section>
            )}

            {overview.meals.length > 0 && (
              <section>
                <h2 className={`${blockTitle} mb-2`}>
                  {t('Horarios de comida', 'Meal times')}
                </h2>
                <div className={`${card} overflow-x-auto`}>
                  <table className="w-full text-sm">
                    <tbody>
                      {overview.meals.map(m => (
                        <tr key={m.id} className="border-b border-ink-100 dark:border-navy-800/60 last:border-0">
                          <td className="px-3 py-2 font-medium">{MEAL_LABELS[lang]?.[m.meal] || m.meal}</td>
                          <td className="px-3 py-2 text-xs text-ink-500 dark:text-ink-400">
                            {m.date ? shortDate(m.date, lang) : t('Todos los días', 'Every day')}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {[hhmm(m.start_time), hhmm(m.end_time)].filter(Boolean).join('-')}
                          </td>
                          <td className="px-3 py-2 text-xs">{m.location || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h2 className={blockTitle}>
                  Rooming list
                </h2>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder={t('Busca tu nombre...', 'Search for your name...')}
                  className="text-xs h-8 px-2.5 rounded-md border border-ink-200 dark:border-navy-700 bg-white dark:bg-navy-950 print:hidden" />
              </div>
              {!rooming ? (
                <p className="text-sm text-ink-500 dark:text-ink-400">{t('Cargando...', 'Loading...')}</p>
              ) : rooming.rows.length === 0 ? (
                <div className={`${card} p-8 text-center`}>
                  <p className="text-sm text-ink-500 dark:text-ink-400">{t('Todavía no hay hospedaje publicado.', 'No rooming list published yet.')}</p>
                </div>
              ) : (
                <div className={`${card} overflow-x-auto`}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-500 dark:text-ink-400 border-b border-ink-200 dark:border-navy-800">
                        <th className="px-3 py-2 font-medium">{t('Nombre', 'Name')}</th>
                        <th className="px-3 py-2 font-medium">{t('Cargo', 'Role')}</th>
                        <th className="px-3 py-2 font-medium">{t('Habitación', 'Room')}</th>
                        <th className="px-3 py-2 font-medium">{t('Comparte con', 'Shares with')}</th>
                        <th className="px-3 py-2 font-medium">Check-in</th>
                        <th className="px-3 py-2 font-medium">Check-out</th>
                        <th className="px-3 py-2 font-medium">{t('Dieta', 'Diet')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rooming.rows.filter(r => matches(r.name)).map(r => (
                        <tr key={r.participant_id} className="border-b border-ink-100 dark:border-navy-800/60 last:border-0">
                          <td className="px-3 py-2 font-medium whitespace-nowrap">{r.name}</td>
                          <td className="px-3 py-2 text-xs text-ink-500 dark:text-ink-400">{r.role || '-'}</td>
                          <td className="px-3 py-2 text-xs">{[r.room_type, r.room_number].filter(Boolean).join(' · ') || '-'}</td>
                          <td className="px-3 py-2 text-xs text-ink-500 dark:text-ink-400">{r.share_with || '-'}</td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap">{shortDate(r.check_in, lang)}</td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap">{shortDate(r.check_out, lang)}</td>
                          <td className="px-3 py-2 text-xs text-ink-500 dark:text-ink-400">{r.dietary_restrictions || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}

        {/* ── Vuelos ────────────────────────────────────────── */}
        {section === 'manifest' && (
          <>
            <div className="flex justify-end print:hidden">
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder={t('Busca tu nombre...', 'Search for your name...')}
                className="text-xs h-8 px-2.5 rounded-md border border-ink-200 dark:border-navy-700 bg-white dark:bg-navy-950" />
            </div>

            {!manifest ? (
              <p className="text-sm text-ink-500 dark:text-ink-400">{t('Cargando...', 'Loading...')}</p>
            ) : manifest.rows.length === 0 ? (
              <div className={`${card} p-8 text-center`}>
                <p className="text-sm text-ink-500 dark:text-ink-400">{t('Todavía no hay vuelos publicados.', 'No flights published yet.')}</p>
              </div>
            ) : (
              <>
                <div className={`${card} overflow-x-auto`}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-500 dark:text-ink-400 border-b border-ink-200 dark:border-navy-800">
                        <th className="px-3 py-2 font-medium">{t('Nombre', 'Name')}</th>
                        <th className="px-3 py-2 font-medium">{t('Cargo', 'Role')}</th>
                        <th className="px-3 py-2 font-medium">{t('Pasaporte', 'Passport')}</th>
                        <th className="px-3 py-2 font-medium">{t('Llegada', 'Arrival')}</th>
                        <th className="px-3 py-2 font-medium">{t('Salida', 'Departure')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manifest.rows.filter(r => matches(r.name)).map(r => (
                        <tr key={r.participant_id} className="border-b border-ink-100 dark:border-navy-800/60 last:border-0">
                          <td className="px-3 py-2 font-medium whitespace-nowrap">
                            {r.name}{r.pax > 1 && <span className="text-ink-500 dark:text-ink-400 text-xs"> ({r.pax} pax)</span>}
                          </td>
                          <td className="px-3 py-2 text-xs text-ink-500 dark:text-ink-400">{r.role || '-'}</td>
                          <td className="px-3 py-2 font-mono text-xs text-ink-500 dark:text-ink-400">{r.passport || '-'}</td>
                          {['arrival', 'departure'].map(dir => {
                            const leg = r[dir]
                            const ModeIcon = leg ? MODE_ICONS[leg.transport_mode] : null
                            return (
                              <td key={dir} className="px-3 py-2 text-xs">
                                {leg ? (
                                  <div className="leading-tight whitespace-nowrap">
                                    <div className="flex items-center gap-1">
                                      {ModeIcon && <ModeIcon className="w-3.5 h-3.5 text-ink-500 dark:text-ink-400 shrink-0" />}
                                      <span>{shortDate(leg.date, lang)} {hhmm(leg.time)}</span>
                                    </div>
                                    <div className="text-[11px] text-ink-500 dark:text-ink-400">
                                      {[leg.flight_number, leg.airport].filter(Boolean).join(' · ')}
                                      {leg.pickup_time && ` · ${t('recogida', 'pick-up')} ${hhmm(leg.pickup_time)}`}
                                    </div>
                                  </div>
                                ) : '-'}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {manifest.arrival_groups?.length > 0 && (
                  <section>
                    <h2 className={`${blockTitle} mb-2`}>
                      {t('Grupos de llegada', 'Arrival groups')}
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {manifest.arrival_groups.map((g, i) => (
                        <div key={i} className={`${card} p-4`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-semibold text-sm">{shortDate(g.date, lang)} · {g.airport || '-'}</span>
                            <span className="text-xs text-ink-500 dark:text-ink-400">{g.pax} pax</span>
                          </div>
                          <ul className="text-xs space-y-0.5">
                            {g.legs.map(leg => (
                              <li key={leg.id} className="flex justify-between gap-3">
                                <span>{leg.participant_name}</span>
                                <span className="text-ink-500 dark:text-ink-400 font-mono shrink-0">{hhmm(leg.time)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </>
        )}
      </main>

      <footer className="max-w-5xl mx-auto px-4 py-6 text-center text-[11px] text-ink-500 dark:text-ink-400">
        {t('Información operativa de FIBA Americas. No la compartas fuera del evento.',
           'FIBA Americas operational information. Do not share it outside the event.')}
      </footer>
    </PublicShell>
  )
}
