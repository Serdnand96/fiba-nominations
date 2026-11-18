import { useState, useEffect, useMemo, useRef } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'
import CompetitionSearch from '../components/CompetitionSearch'
import { readLastSearch, writeLastSearch } from '../lib/lastSearch'
import { getCalendarCompetitions, downloadLogisticsBriefing } from '../api/client'
import { useToast } from '../components/ui/Toast'
import { Button } from '../components/ui/Button'
import { Icon } from '../lib/icons'
import TransportTab from './logistics/TransportTab'
import HousingTab from './logistics/HousingTab'
import ManifestTab from './logistics/ManifestTab'
import ServicesTab from './logistics/ServicesTab'
import { errorMessage } from './logistics/opsShared'
import SharePanel from './logistics/SharePanel'
import AudienceSwitch, { AUDIENCE_KEYS } from './logistics/audiences'

// Módulo Logística: la competencia se elige una vez acá arriba y las cuatro
// secciones (transporte, hospedaje, manifiesto y servicios) la comparten. Antes esto era el módulo Transporte, que solo cubría
// vehículos y viajes; el hospedaje y el manifiesto vivían en planillas sueltas.

const LAST_SEARCH_KEY = 'fiba_logistics_last_search'
const TAB_KEYS = ['transport', 'housing', 'manifest', 'services']

function loadLastSearch() {
  const parsed = readLastSearch(LAST_SEARCH_KEY)
  if (!parsed) return null
  return {
    compId: typeof parsed.compId === 'string' ? parsed.compId : '',
    tab: TAB_KEYS.includes(parsed.tab) ? parsed.tab : '',
    date: typeof parsed.date === 'string' ? parsed.date : '',
    audience: AUDIENCE_KEYS.includes(parsed.audience) ? parsed.audience : '',
  }
}

export default function Logistics() {
  const { lang } = useLanguage()
  const { hasEdit } = useAuth()
  const { push } = useToast()
  const canEdit = hasEdit('logistics')
  const t = (es, en) => (lang === 'es' ? es : en)

  const lastSearchRef = useRef(loadLastSearch())
  const [tab, setTab] = useState(() => lastSearchRef.current?.tab || 'transport')
  const [competitions, setCompetitions] = useState([])
  const [competitionId, setCompetitionId] = useState('')
  const [showShare, setShowShare] = useState(false)
  const [briefingBusy, setBriefingBusy] = useState(false)
  // Staff / Delegación / VIP: la división la comparten las tres secciones,
  // así que se elige una vez acá. '' = Todos.
  const [audience, setAudience] = useState(() => lastSearchRef.current?.audience || '')
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
    writeLastSearch(LAST_SEARCH_KEY, { compId: competitionId, tab, date: transportDate, audience })
  }, [competitionId, tab, transportDate, audience])

  // PDF general para las delegaciones: sin datos personales. Si el servidor no
  // pudo convertirlo, baja el .docx (la extensión la decide el content-type).
  async function handleBriefing() {
    if (briefingBusy) return
    setBriefingBusy(true)
    try {
      const slug = (selectedComp?.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      await downloadLogisticsBriefing(competitionId, slug ? `delegaciones-${slug}` : 'delegaciones')
    } catch (err) {
      push({ type: 'error', title: errorMessage(err, t('No se pudo generar el PDF de delegaciones.', 'Could not generate the delegations PDF.')) })
    } finally { setBriefingBusy(false) }
  }

  const TAB_LABELS = {
    transport: t('Transporte', 'Transport'),
    housing: t('Hospedaje', 'Hotels'),
    manifest: t('Manifiesto de viaje', 'Travel manifest'),
    services: t('Servicios', 'Services'),
  }

  if (competitions.length === 0) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-ink-900 dark:text-white mb-6">{t('Logística', 'Logistics')}</h2>
        <div className="text-center py-16 text-fiba-muted">
          <p className="text-sm">{t('No hay competencias disponibles.', 'No competitions available.')}</p>
          <p className="text-xs mt-1">{t('Primero crea una competencia en Calendario.', 'Create a competition in Calendar first.')}</p>
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
        {competitionId && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" icon={<Icon.Download />} onClick={handleBriefing} disabled={briefingBusy}
              title={t('PDF para los equipos con hoteles, horarios, salones y contactos.',
                       'PDF for the teams with hotels, schedules, rooms and contacts.')}>
              {briefingBusy ? t('Generando...', 'Generating...') : t('PDF delegaciones', 'Delegations PDF')}
            </Button>
            {canEdit && (
              <button onClick={() => setShowShare(true)} className="btn-fiba-ghost whitespace-nowrap">
                {t('Compartir', 'Share')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Secciones del módulo */}
      <div className="flex border-b border-fiba-border mb-4 overflow-x-auto">
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
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <span className="text-xs text-fiba-muted">{t('Ver', 'Show')}</span>
          <AudienceSwitch value={audience} onChange={setAudience} lang={lang} />
        </div>
      )}

      {competitionId && (
        <>
          {tab === 'transport' && (
            <TransportTab
              competitionId={competitionId}
              selectedComp={selectedComp}
              canEdit={canEdit}
              audience={audience}
              savedDate={lastSearchRef.current?.compId === competitionId ? lastSearchRef.current?.date : ''}
              onDateChange={setTransportDate}
            />
          )}
          {tab === 'housing' && <HousingTab competitionId={competitionId} competitionName={selectedComp?.name} canEdit={canEdit} audience={audience} />}
          {tab === 'manifest' && <ManifestTab competitionId={competitionId} canEdit={canEdit} audience={audience} />}
          {tab === 'services' && <ServicesTab competitionId={competitionId} canEdit={canEdit} audience={audience} />}
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
