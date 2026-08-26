import { useState } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import { updateGame } from '../../api/client'

// Qué hizo el último sync con FIBA.
//
// Antes esto era una línea que decía "84 actualizados" y se borraba sola a los
// 6 segundos. El problema no era el conteo: era que un partido podía moverse de
// horario o quedar con el local y el visitante al revés y nadie se enteraba
// hasta abrir la web de FIBA al lado del calendario.
//
// Dos bloques, en orden de urgencia:
//   1. Lo que el sync NO tocó porque lo decide una persona (equipos invertidos).
//      Cambiar quién es local mueve la sede y el texto de las cartas.
//   2. Lo que sí cambió solo (horario, sede, ciudad), con el antes y el después,
//      porque arrastra traslados, crew y checklists.

const FIELD_LABELS = {
  date: { es: 'Fecha', en: 'Date' },
  time: { es: 'Hora', en: 'Time' },
  venue: { es: 'Sede', en: 'Venue' },
  city: { es: 'Ciudad', en: 'City' },
  country: { es: 'País', en: 'Country' },
  group_label: { es: 'Grupo', en: 'Group' },
  game_number: { es: 'Nº', en: 'No.' },
}

export default function SyncReport({ report, onClose, onApplied, canEdit }) {
  const { lang } = useLanguage()
  const t = (es, en) => (lang === 'es' ? es : en)
  const label = f => (FIELD_LABELS[f] ? FIELD_LABELS[f][lang === 'es' ? 'es' : 'en'] : f)

  const [showChanges, setShowChanges] = useState(false)
  const [applying, setApplying] = useState(null)
  const [applied, setApplied] = useState([])
  const [error, setError] = useState(null)

  const mismatches = (report.mismatches || []).filter(m => !applied.includes(m.game_id))
  const rescheduled = report.rescheduled || []

  async function applyFiba(m) {
    setError(null)
    setApplying(m.game_id)
    try {
      await updateGame(m.game_id, m.fiba)
      setApplied(a => [...a, m.game_id])
      await onApplied?.()
    } catch (err) {
      setError(err.response?.data?.detail || t('No se pudo aplicar.', 'Could not apply.'))
    } finally {
      setApplying(null)
    }
  }

  const quiet = mismatches.length === 0 && rescheduled.length === 0

  return (
    <div className="mb-4 rounded-lg border border-fiba-border bg-fiba-card">
      <div className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink-900 dark:text-white">
            {t('Sincronizado con FIBA', 'Synced with FIBA')}
          </div>
          <div className="text-xs text-fiba-muted">
            {t(
              `${report.synced} actualizados · ${report.created} creados`,
              `${report.synced} updated · ${report.created} created`,
            )}
            {quiet && ` · ${t('sin cambios', 'no changes')}`}
          </div>
          {/* FIBA devuelve el clasificatorio entero por una sola URL. Sin esta
              línea, "84 en FIBA / 12 importados" se lee como que se perdieron
              72 partidos, cuando es exactamente lo correcto. */}
          {report.window_applied ? (
            <div className="text-[11px] text-fiba-muted/80 mt-0.5">
              {t(
                `Ventana ${report.window_code}: ${report.imported_from_window} de los ${report.total_from_fiba} partidos que devuelve FIBA. Los otros ${report.skipped_other_windows} son de otras ventanas.`,
                `Window ${report.window_code}: ${report.imported_from_window} of the ${report.total_from_fiba} games FIBA returns. The other ${report.skipped_other_windows} belong to other windows.`,
              )}
            </div>
          ) : (
            <div className="text-[11px] text-fiba-muted/80 mt-0.5">
              {t(`${report.total_from_fiba} partidos en FIBA`, `${report.total_from_fiba} games on FIBA`)}
            </div>
          )}
        </div>
        <button onClick={onClose}
          className="text-fiba-muted hover:text-ink-900 dark:hover:text-white text-lg leading-none shrink-0">&times;</button>
      </div>

      {error && (
        <div className="mx-4 mb-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">{error}</div>
      )}

      {/* 1 — lo que necesita una decisión humana */}
      {mismatches.length > 0 && (
        <div className="border-t border-fiba-border px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-500 mb-2">
            {t(`${mismatches.length} necesitan tu atención`, `${mismatches.length} need your attention`)}
          </div>
          <p className="text-[11px] text-fiba-muted mb-2">
            {t('El sync no cambia los equipos solo: quién es local define la sede y el texto de las cartas.',
               'The sync does not change teams on its own: who plays at home drives the venue and the letter text.')}
          </p>
          <div className="divide-y divide-fiba-border border border-fiba-border rounded-lg">
            {mismatches.map(m => (
              <div key={m.game_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="font-mono text-[10px] text-fiba-muted/80 shrink-0">{m.game_number || '—'}</span>
                <span className="text-xs text-fiba-muted shrink-0">{m.date}</span>
                <span className="text-sm text-ink-900 dark:text-white min-w-0">
                  <span className="line-through decoration-red-400/70 opacity-70">
                    {m.ours.team_a_code} vs {m.ours.team_b_code}
                  </span>
                  <span className="mx-1.5 text-fiba-muted">→</span>
                  <span className="font-semibold">{m.fiba.team_a_code} vs {m.fiba.team_b_code}</span>
                </span>
                {m.kind === 'differs' && (
                  <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500 border border-amber-500/40 rounded px-1">
                    {t('cruce distinto', 'different fixture')}
                  </span>
                )}
                {canEdit && (
                  <button onClick={() => applyFiba(m)} disabled={applying === m.game_id}
                    className="btn-fiba text-xs px-2.5 py-1 ml-auto disabled:opacity-50">
                    {applying === m.game_id
                      ? t('Aplicando...', 'Applying...')
                      : t('Aplicar FIBA', 'Apply FIBA')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2 — lo que el sync ya cambió */}
      {rescheduled.length > 0 && (
        <div className="border-t border-fiba-border px-4 py-3">
          <button onClick={() => setShowChanges(v => !v)}
            className="flex items-center gap-2 text-left w-full group">
            <span className="text-[10px] font-bold uppercase tracking-wider text-fiba-muted/70">
              {t(`${rescheduled.length} cambiaron de horario o sede`, `${rescheduled.length} changed time or venue`)}
            </span>
            <span className="text-[10px] text-fiba-muted group-hover:text-fiba-accent ml-auto">
              {showChanges ? t('ocultar', 'hide') : t('ver', 'show')}
            </span>
          </button>
          {showChanges && (
            <div className="divide-y divide-fiba-border border border-fiba-border rounded-lg mt-2">
              {rescheduled.map(r => (
                <div key={r.game_id} className="px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-[10px] text-fiba-muted/80 shrink-0">{r.game_number || '—'}</span>
                    <span className="text-sm text-ink-900 dark:text-white truncate">{r.game}</span>
                    <span className="text-xs text-fiba-muted shrink-0 ml-auto">{r.date}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
                    {Object.entries(r.changes).map(([field, v]) => (
                      <span key={field} className="text-[11px] text-fiba-muted">
                        {label(field)}:{' '}
                        <span className="line-through opacity-60">{v.before || '—'}</span>
                        {' → '}
                        <span className="text-ink-700 dark:text-gray-300">{v.after || '—'}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
