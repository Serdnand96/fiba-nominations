import { useEffect, useState } from 'react'
import { discoverFibaCompetitions } from '../../api/client'
import { useLanguage } from '../../i18n/LanguageContext'
import { competitionDateRange } from '../../lib/competitions'

// Competencias de FIBA Americas (GDAP) que ninguna de las nuestras tiene
// vinculadas. Solo lista: "Dar de alta" abre el formulario prellenado y una
// persona decide la plantilla, el fee y si se divide en ventanas o grupos.
//
// Una competencia que acá se divide (WCQ por ventanas, LSB por grupos) aparece
// una vez: con dar de alta la primera y vincular las demás al mismo ID alcanza.

export default function FibaDiscoverModal({ onClose, onPick }) {
  const { t } = useLanguage()
  const MONTHS_SHORT = t('months.short')
  const thisYear = new Date().getFullYear()
  const [season, setSeason] = useState(thisYear)
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setItems(null)
    setError(null)
    discoverFibaCompetitions({ from_season: season, to_season: season + 1 })
      .then(list => { if (alive) setItems(list) })
      .catch(err => { if (alive) setError(err.response?.data?.detail || t('common.error')) })
    return () => { alive = false }
  }, [season])

  return (
    <div className="fiba-modal-overlay" onClick={onClose}>
      <div className="fiba-modal max-w-3xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 className="text-lg font-bold text-ink-900 dark:text-white">{t('competitions.fibaDiscoverTitle')}</h3>
          <button onClick={onClose} aria-label={t('competitions.cancel')}
            className="text-fiba-muted hover:text-ink-900 dark:hover:text-white text-xl leading-none">&times;</button>
        </div>
        <p className="text-xs text-fiba-muted mb-4">{t('competitions.fibaDiscoverHint')}</p>

        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-fiba-muted">{t('competitions.fibaSeasons')}</span>
          {[thisYear - 1, thisYear, thisYear + 1].map(y => (
            <button key={y} onClick={() => setSeason(y)}
              className={`px-3 py-1 rounded-full text-xs font-medium tabular-nums border transition-colors ${
                season === y
                  ? 'bg-basketball-700 text-white border-basketball-700'
                  : 'bg-fiba-surface text-fiba-muted border-fiba-border hover:bg-fiba-surface-2'
              }`}>
              {y}–{y + 1}
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400 mb-3">{error}</div>
        )}
        {!items && !error && <div className="py-8 text-center text-sm text-fiba-muted">{t('common.loading')}</div>}
        {items && items.length === 0 && (
          <div className="py-8 text-center text-sm text-fiba-muted">{t('competitions.fibaDiscoverEmpty')}</div>
        )}
        {items && items.length > 0 && (
          <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-fiba-border divide-y divide-fiba-border">
            {items.map(it => (
              <div key={it.fiba_competition_id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink-900 dark:text-white">{it.name}</div>
                  <div className="text-[11px] text-fiba-muted">
                    <span className="font-mono">#{it.fiba_competition_id}</span>
                    {' · '}{it.zone}
                    {(it.host_city || it.host_country) && ` · ${[it.host_city, it.host_country].filter(Boolean).join(', ')}`}
                    {it.status && ` · ${it.status}`}
                  </div>
                </div>
                <div className="text-xs tabular-nums text-fiba-muted whitespace-nowrap">
                  {competitionDateRange({ start_date: it.start, end_date: it.end }, MONTHS_SHORT, { year: true }) || 'TBD'}
                </div>
                <button onClick={() => onPick(it)} className="btn-fiba text-xs px-2.5 py-1">
                  {t('competitions.fibaDiscoverAdd')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
