import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  getPublicLogistics, getPublicLogisticsTransport,
  getPublicLogisticsManifest, getPublicLogisticsRooming,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { LogoMonogram } from '../components/brand/Logo'

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

const MODE_ICONS = { flight: '✈', bus: '🚌', ferry: '⛴', car: '🚗', other: '•' }

const hhmm = (t) => (t ? t.slice(0, 5) : '')

function longDate(iso, lang) {
  if (!iso) return ''
  return new Date(iso + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es' : 'en-US',
    { weekday: 'long', day: 'numeric', month: 'long' })
}

function shortDate(iso, lang) {
  if (!iso) return '—'
  return new Date(iso + 'T12:00:00').toLocaleDateString(lang === 'es' ? 'es' : 'en-US',
    { day: 'numeric', month: 'short' })
}

const card = 'rounded-xl border border-ink-200 dark:border-navy-800 bg-white dark:bg-navy-900'

export default function PublicLogistics() {
  const { token } = useParams()
  const { lang, setLang } = useLanguage()
  const t = (es, en) => (lang === 'es' ? es : en)

  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)

  const [section, setSection] = useState('transport')
  const [transport, setTransport] = useState(null)
  const [transportDate, setTransportDate] = useState(null)
  const [manifest, setManifest] = useState(null)
  const [rooming, setRooming] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    getPublicLogistics(token)
      .then(data => { if (!cancelled) { setOverview(data); setLoading(false) } })
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
    if (section === 'manifest' && !manifest) {
      getPublicLogisticsManifest(token).then(setManifest).catch(() => setManifest({ rows: [] }))
    }
    if (section === 'rooming' && !rooming) {
      getPublicLogisticsRooming(token).then(setRooming).catch(() => setRooming({ rows: [], dates: [] }))
    }
  }, [section, overview, token])

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
      <div className="min-h-screen bg-ink-50 dark:bg-navy-950 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="flex justify-center mb-4"><LogoMonogram size={48} /></div>
          <h1 className="text-lg font-semibold text-ink-900 dark:text-white mb-1">
            {t('Este link no está disponible', 'This link is not available')}
          </h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            {t('Puede haber vencido o haber sido reemplazado. Pídele uno nuevo a la organización.',
               'It may have expired or been replaced. Ask the organisers for a new one.')}
          </p>
        </div>
      </div>
    )
  }

  const comp = overview.competition
  const SECTIONS = {
    transport: t('Traslados', 'Transfers'),
    rooming: t('Hospedaje', 'Housing'),
    manifest: t('Vuelos', 'Flights'),
  }

  const matches = (text) => !search.trim() || (text || '').toLowerCase().includes(search.trim().toLowerCase())

  return (
    <div className="min-h-screen bg-ink-50 dark:bg-navy-950 text-ink-900 dark:text-white">
      {/* ── Encabezado ──────────────────────────────────────── */}
      <header className="border-b border-ink-200 dark:border-navy-800 bg-white dark:bg-navy-900">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="shrink-0"><LogoMonogram size={36} /></div>
            <div className="leading-tight">
              <h1 className="text-base sm:text-lg font-semibold">{comp.name}</h1>
              <p className="text-xs text-ink-500 dark:text-ink-400">
                {[comp.location, comp.start_date && `${shortDate(comp.start_date, lang)} – ${shortDate(comp.end_date || comp.start_date, lang)}`]
                  .filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <button onClick={() => setLang(lang === 'es' ? 'en' : 'es')}
            className="text-xs text-ink-500 dark:text-ink-400 hover:text-ink-900 dark:hover:text-white border border-ink-200 dark:border-navy-700 rounded-md px-2 py-1 shrink-0 print:hidden">
            {lang === 'es' ? 'EN' : 'ES'}
          </button>
        </div>
      </header>

      {/* ── Secciones ───────────────────────────────────────── */}
      <nav className="border-b border-ink-200 dark:border-navy-800 bg-white dark:bg-navy-900 sticky top-0 z-10 print:hidden">
        <div className="max-w-5xl mx-auto px-4 flex overflow-x-auto">
          {Object.entries(SECTIONS).map(([key, label]) => (
            <button key={key} onClick={() => setSection(key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                section === key
                  ? 'border-basketball-500 text-basketball-500'
                  : 'border-transparent text-ink-500 dark:text-ink-400 hover:text-ink-900 dark:hover:text-white'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* ── Traslados ─────────────────────────────────────── */}
        {section === 'transport' && (
          <>
            {transport?.dates?.length > 0 && (
              <div className="flex flex-wrap gap-2 print:hidden">
                <button onClick={() => pickDate(null)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    !transportDate ? 'bg-basketball-500 text-white border-basketball-500'
                    : 'border-ink-200 dark:border-navy-700 text-ink-500 dark:text-ink-400'
                  }`}>
                  {t('Todos', 'All')}
                </button>
                {transport.dates.map(d => (
                  <button key={d} onClick={() => pickDate(d)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      transportDate === d ? 'bg-basketball-500 text-white border-basketball-500'
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
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400 mb-2">
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
                              {trip.game ? `${trip.game.team_a || '?'} vs ${trip.game.team_b || '?'}` : '—'}
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
                        <div>Check-in {hhmm(h.check_in_time) || '—'} · Check-out {hhmm(h.check_out_time) || '—'}</div>
                      )}
                      {h.notes && <div>{h.notes}</div>}
                    </dl>
                    {h.map_url && (
                      <a href={h.map_url} target="_blank" rel="noreferrer noopener"
                        className="text-xs text-basketball-500 hover:underline mt-2 inline-block">
                        {t('Ver en el mapa', 'View on map')}
                      </a>
                    )}
                  </div>
                ))}
              </section>
            )}

            {overview.meals.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400 mb-2">
                  {t('Alimentación', 'Meals')}
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
                            {[hhmm(m.start_time), hhmm(m.end_time)].filter(Boolean).join(' – ')}
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
                <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400">
                  Rooming list
                </h2>
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder={t('Buscar tu nombre...', 'Search your name...')}
                  className="text-xs h-8 px-2.5 rounded-md border border-ink-200 dark:border-navy-700 bg-white dark:bg-navy-950 print:hidden" />
              </div>
              {!rooming ? (
                <p className="text-sm text-ink-500 dark:text-ink-400">{t('Cargando...', 'Loading...')}</p>
              ) : rooming.rows.length === 0 ? (
                <div className={`${card} p-8 text-center`}>
                  <p className="text-sm text-ink-500 dark:text-ink-400">{t('Todavía no hay hospedaje publicado.', 'No housing published yet.')}</p>
                </div>
              ) : (
                <div className={`${card} overflow-x-auto`}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-ink-500 dark:text-ink-400 border-b border-ink-200 dark:border-navy-800">
                        <th className="px-3 py-2 font-medium">{t('Nombre', 'Name')}</th>
                        <th className="px-3 py-2 font-medium">{t('Rol', 'Role')}</th>
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
                          <td className="px-3 py-2 text-xs text-ink-500 dark:text-ink-400">{r.role || '—'}</td>
                          <td className="px-3 py-2 text-xs">{[r.room_type, r.room_number].filter(Boolean).join(' · ') || '—'}</td>
                          <td className="px-3 py-2 text-xs text-ink-500 dark:text-ink-400">{r.share_with || '—'}</td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap">{shortDate(r.check_in, lang)}</td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap">{shortDate(r.check_out, lang)}</td>
                          <td className="px-3 py-2 text-xs text-ink-500 dark:text-ink-400">{r.dietary_restrictions || '—'}</td>
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
                placeholder={t('Buscar tu nombre...', 'Search your name...')}
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
                        <th className="px-3 py-2 font-medium">{t('Rol', 'Role')}</th>
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
                          <td className="px-3 py-2 text-xs text-ink-500 dark:text-ink-400">{r.role || '—'}</td>
                          <td className="px-3 py-2 font-mono text-xs text-ink-500 dark:text-ink-400">{r.passport || '—'}</td>
                          {['arrival', 'departure'].map(dir => {
                            const leg = r[dir]
                            return (
                              <td key={dir} className="px-3 py-2 text-xs">
                                {leg ? (
                                  <div className="leading-tight whitespace-nowrap">
                                    <div>{MODE_ICONS[leg.transport_mode] || ''} {shortDate(leg.date, lang)} {hhmm(leg.time)}</div>
                                    <div className="text-[11px] text-ink-500 dark:text-ink-400">
                                      {[leg.flight_number, leg.airport].filter(Boolean).join(' · ')}
                                      {leg.pickup_time && ` · pick-up ${hhmm(leg.pickup_time)}`}
                                    </div>
                                  </div>
                                ) : '—'}
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
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400 mb-2">
                      {t('Grupos de llegada', 'Arrival groups')}
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {manifest.arrival_groups.map((g, i) => (
                        <div key={i} className={`${card} p-4`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-semibold text-sm">{shortDate(g.date, lang)} · {g.airport || '—'}</span>
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
        FIBA Americas · {t('Información operativa. No la compartas fuera del equipo del evento.',
                           'Operational information. Do not share outside the event team.')}
      </footer>
    </div>
  )
}
