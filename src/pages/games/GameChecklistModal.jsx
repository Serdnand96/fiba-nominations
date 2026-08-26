import { useCallback, useEffect, useState } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import { useToast } from '../../components/ui/Toast'
import {
  getGameChecklists, startGameChecklist, updateChecklistItem,
  submitGameChecklist, reopenGameChecklist, deleteGameChecklist,
} from '../../api/client'
import ChecklistRunner from './ChecklistRunner'

// Los checklists de un partido, desde adentro del sistema.
//
// El mismo dato que carga el VGO en la sede por el link público: acá el desk lo
// ve, lo corrige y lo cierra. Cada marca queda firmada con el email del usuario
// (checked_source = 'admin'), así después se distingue qué se probó en la
// cancha de qué se transcribió desde la oficina.

export default function GameChecklistModal({ game, templates, canEdit, onClose, onChanged }) {
  const { lang } = useLanguage()
  const t = (es, en) => (lang === 'es' ? es : en)
  const { push } = useToast()

  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const rows = await getGameChecklists(game.id)
    setRuns(rows || [])
    onChanged?.()
  }, [game.id, onChanged])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getGameChecklists(game.id)
      .then(rows => { if (!cancelled) setRuns(rows || []) })
      .catch(() => { if (!cancelled) push({ type: 'error', title: t('No se pudieron cargar los checklists.', 'Could not load the checklists.') }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [game.id])

  async function guard(fn) {
    try { await fn(); await reload() }
    catch (err) { push({ type: 'error', title: err.response?.data?.detail || 'Error' }) }
  }

  const handleStart = tpl => guard(() => startGameChecklist(game.id, tpl.id))
  const handleSetItem = (item, patch) => guard(() => updateChecklistItem(item.id, patch))
  const handleSubmit = run => guard(() => submitGameChecklist(run.id))
  const handleReopen = run => guard(() => reopenGameChecklist(run.id))
  const handleDelete = run => {
    if (!confirm(t(`Borrar el checklist "${run.template_name}" de este partido. ¿Continuar?`,
                   `Delete the "${run.template_name}" checklist from this game. Continue?`))) return
    return guard(() => deleteGameChecklist(run.id))
  }

  const matchup = [game.team_a_code || game.team_a, game.team_b_code || game.team_b].filter(Boolean).join(' vs ')
  const where = [game.venue, game.city].filter(Boolean).join(' · ')

  return (
    <div className="fiba-modal-overlay">
      <div className="fiba-modal max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 className="text-lg font-bold text-ink-900 dark:text-white">
            {t('Control de operación', 'Operations control')}
          </h3>
          <button onClick={onClose} className="text-fiba-muted hover:text-ink-700 dark:hover:text-white text-xl leading-none">&times;</button>
        </div>
        <p className="text-xs text-fiba-muted mb-5">
          {matchup}
          {game.date && ` · ${game.date}`}
          {game.time && ` ${game.time}`}
          {where && ` · ${where}`}
        </p>

        {loading ? (
          <div className="py-8 text-center text-sm text-fiba-muted">{t('Cargando...', 'Loading...')}</div>
        ) : (
          <ChecklistRunner
            t={t} runs={runs} templates={templates} canEdit={canEdit}
            onStart={handleStart} onSetItem={handleSetItem}
            onSubmit={handleSubmit} onReopen={handleReopen} onDelete={handleDelete}
          />
        )}

        <div className="flex justify-end pt-5">
          <button onClick={onClose} className="btn-fiba">{t('Listo', 'Done')}</button>
        </div>
      </div>
    </div>
  )
}
