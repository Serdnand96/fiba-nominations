import { useState, useEffect, useMemo, useRef } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'
import CompetitionSearch from '../components/CompetitionSearch'
import { readLastSearch, writeLastSearch } from '../lib/lastSearch'
import { getCalendarCompetitions } from '../api/client'
import TransportTab from './logistics/TransportTab'
import HousingTab from './logistics/HousingTab'
import ManifestTab from './logistics/ManifestTab'
import SharePanel from './logistics/SharePanel'

// Módulo Logística: la competencia se elige una vez acá arriba y las tres
// secciones la comparten. Antes esto era el módulo Transporte, que solo cubría
// vehículos y viajes; el hospedaje y el manifiesto vivían en planillas sueltas.

const LAST_SEARCH_KEY = 'fiba_logistics_last_search'
const TAB_KEYS = ['transport', 'housing', 'manifest']

function loadLastSearch() {
  const parsed = readLastSearch(LAST_SEARCH_KEY)
  if (!parsed) return null
  return {
    compId: typeof parsed.compId === 'string' ? parsed.compId : '',
    tab: TAB_KEYS.includes(parsed.tab) ? parsed.tab : '',
    date: typeof parsed.date === 'string' ? parsed.date : '',
  }
}

export default function Logistics() {
  const { lang } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('logistics')
  const t = (es, en) => (lang === 'es' ? es : en)

  const lastSearchRef = useRef(loadLastSearch())
  const [tab, setTab] = useState(() => lastSearchRef.current?.tab || 'transport')
  const [competitions, setCompetitions] = useState([])
  const [competitionId, setCompetitionId] = useState('')
  const [showShare, setShowShare] = useState(false)
  // La fecha la maneja la sección de transporte; el shell solo la recuerda.
  const [transportDate, setTransportDate] = useState(lastSearchRef.current?.date || '')

  useEffect(() => {
    getCalendarCompetitions().then(comps => {
      setCompetitions(comps)
      const saved = lastSearchRef.current
      if (saved?.compId && comps.some(c => c.id === saved.compId)) {
        setCompetitionId(saved.compId)
      } else {
        lastSearchRef.current = null // la competencia guardada ya no está
        if (comps.length > 0) setCompetitionId(comps[0].id)
      }
    }).catch(() => {})
  }, [])

  // Se resuelve durante el render y no en un efecto: si no, hay un instante en
  // que competitionId ya está pero selectedComp todavía es null, y la sección
  // de transporte corre dos veces su "buscá o creá el evento" — dos veces en
  // paralelo significa dos transport_events para la misma competencia.
  const selectedComp = useMemo(
    () => competitions.find(c => c.id === competitionId) || null,
    [competitions, competitionId],
  )

  // Persistir la búsqueda actual. En pausa mientras hay una restauración
  // pendiente, para que los defaults no pisen lo guardado.
  useEffect(() => {
    if (!competitionId || lastSearchRef.current) return
    writeLastSearch(LAST_SEARCH_KEY, { compId: competitionId, tab, date: transportDate })
  }, [competitionId, tab, transportDate])

  const TAB_LABELS = {
    transport: t('Transporte', 'Transport'),
    housing: t('Hoteles y alimentación', 'Hotels & meals'),
    manifest: t('Travel Manifest', 'Travel Manifest'),
  }

  if (competitions.length === 0) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-ink-900 dark:text-white mb-6">{t('Logística', 'Logistics')}</h2>
        <div className="text-center py-16 text-fiba-muted">
          <p className="text-sm">{t('No hay competencias disponibles.', 'No competitions available.')}</p>
          <p className="text-xs mt-1">{t('Crea una competencia en el Calendario primero.', 'Create a competition in Calendar first.')}</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4">
          <h2 className="text-2xl font-bold text-ink-900 dark:text-white">{t('Logística', 'Logistics')}</h2>
          <CompetitionSearch
            competitions={competitions}
            value={competitionId}
            onChange={setCompetitionId}
            placeholder={t('Buscar competencia...', 'Search competition...')}
          />
        </div>
        {canEdit && competitionId && (
          <button onClick={() => setShowShare(true)} className="btn-fiba-ghost whitespace-nowrap">
            {t('Compartir', 'Share')}
          </button>
        )}
      </div>

      {/* Secciones del módulo */}
      <div className="flex border-b border-fiba-border mb-6 overflow-x-auto">
        {Object.entries(TAB_LABELS).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === key ? 'border-fiba-accent text-fiba-accent' : 'border-transparent text-fiba-muted hover:text-ink-700 dark:text-gray-300'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {competitionId && (
        <>
          {tab === 'transport' && (
            <TransportTab
              competitionId={competitionId}
              selectedComp={selectedComp}
              canEdit={canEdit}
              savedDate={lastSearchRef.current?.compId === competitionId ? lastSearchRef.current?.date : ''}
              onDateChange={setTransportDate}
            />
          )}
          {tab === 'housing' && <HousingTab competitionId={competitionId} canEdit={canEdit} />}
          {tab === 'manifest' && <ManifestTab competitionId={competitionId} canEdit={canEdit} />}
        </>
      )}

      {showShare && (
        <SharePanel
          competitionId={competitionId}
          competitionName={selectedComp?.name}
          onClose={() => setShowShare(false)}
        />
      )}
    </div>
  )
}
