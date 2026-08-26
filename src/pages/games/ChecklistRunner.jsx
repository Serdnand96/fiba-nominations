import { useState } from 'react'

// La corrida de un checklist, pintada igual adentro del sistema y afuera en el
// link público. Es un componente tonto a propósito: recibe las corridas ya
// cargadas y devuelve intenciones (marcar ítem, cerrar, reabrir). Quien lo usa
// decide contra qué endpoint van — /checklists/* con JWT, o
// /public/checklists/<token> desde la sede.
//
// Las tres marcas son OK / Falla / N-A. 'Falla' pide nota: sin el "por qué" un
// fail no sirve para nada tres meses después, que es exactamente cuando se lo
// consulta.

const STATUSES = [
  { key: 'ok', es: 'OK', en: 'OK', cls: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-400' },
  { key: 'fail', es: 'Falla', en: 'Fail', cls: 'border-red-500/50 bg-red-500/15 text-red-400' },
  { key: 'na', es: 'N/A', en: 'N/A', cls: 'border-fiba-border bg-fiba-surface text-fiba-muted' },
]

export function runTone(run) {
  if (run.failed > 0) return 'fail'
  if (run.submitted_at) return 'done'
  if (run.done > 0) return 'progress'
  return 'idle'
}

export default function ChecklistRunner({
  t, runs, templates = [], canEdit = true,
  onStart, onSetItem, onSubmit, onReopen, onDelete,
  startLabel,
}) {
  const openable = templates.filter(tpl => !runs.some(r => r.template_id === tpl.id))

  return (
    <div className="space-y-4">
      {runs.length === 0 && openable.length === 0 && (
        <p className="text-sm text-fiba-muted">
          {t('No hay plantillas de checklist activas. Se crean desde Control de operación.',
             'No active checklist templates. They are created from Operations control.')}
        </p>
      )}

      {runs.map(run => (
        <RunBlock key={run.id} t={t} run={run} canEdit={canEdit}
          onSetItem={onSetItem} onSubmit={onSubmit} onReopen={onReopen} onDelete={onDelete} />
      ))}

      {canEdit && openable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[11px] text-fiba-muted">{startLabel || t('Abrir checklist:', 'Open checklist:')}</span>
          {openable.map(tpl => (
            <button key={tpl.id} onClick={() => onStart(tpl)} className="btn-fiba-ghost text-xs px-2.5 py-1">
              + {tpl.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}


function RunBlock({ t, run, canEdit, onSetItem, onSubmit, onReopen, onDelete }) {
  const closed = !!run.submitted_at
  const editable = canEdit && !closed
  const tone = runTone(run)

  return (
    <div className={`border rounded-lg overflow-hidden ${
      tone === 'fail' ? 'border-red-500/40' : closed ? 'border-emerald-500/30' : 'border-fiba-border'
    }`}>
      <div className="flex items-start gap-3 px-3 py-2 bg-fiba-surface/60">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-ink-900 dark:text-white truncate">{run.template_name}</div>
          <div className="text-[11px] text-fiba-muted">
            {run.done}/{run.total}
            {run.failed > 0 && (
              <span className="text-red-400 font-semibold"> · {run.failed} {t('con falla', 'failing')}</span>
            )}
            {closed && (
              <span className="text-emerald-400"> · {t('cerrado por', 'closed by')} {run.signed_name || '—'}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-xs">
          {editable && (
            <button onClick={() => onSubmit(run)} disabled={run.pending_required > 0}
              title={run.pending_required > 0
                ? t(`Faltan ${run.pending_required} ítems obligatorios.`, `${run.pending_required} required items left.`)
                : ''}
              className="btn-fiba text-xs px-2.5 py-1 disabled:opacity-40 disabled:cursor-not-allowed">
              {t('Cerrar', 'Close')}
            </button>
          )}
          {closed && canEdit && onReopen && (
            <button onClick={() => onReopen(run)} className="text-fiba-accent hover:underline">
              {t('Reabrir', 'Reopen')}
            </button>
          )}
          {canEdit && onDelete && (
            <button onClick={() => onDelete(run)} className="text-fiba-muted hover:text-red-400">×</button>
          )}
        </div>
      </div>

      <div className="divide-y divide-fiba-border">
        {(run.items || []).map(item => (
          <ItemRow key={item.id} t={t} item={item} editable={editable} onSetItem={onSetItem} />
        ))}
      </div>
    </div>
  )
}


function ItemRow({ t, item, editable, onSetItem }) {
  // La nota se abre sola en un fail y queda abierta si ya hay algo escrito: es
  // el único lugar donde vive el "por qué".
  const [noteOpen, setNoteOpen] = useState(!!item.notes || item.status === 'fail')
  const [note, setNote] = useState(item.notes || '')

  function pick(status) {
    if (!editable) return
    if (status === 'fail') setNoteOpen(true)
    onSetItem(item, { status: item.status === status ? 'pending' : status })
  }

  function commitNote() {
    if ((item.notes || '') === note) return
    onSetItem(item, { notes: note })
  }

  return (
    <div className="px-3 py-2">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-ink-900 dark:text-white">
            {item.label}
            {!item.required && (
              <span className="ml-1.5 text-[10px] uppercase tracking-wider text-fiba-muted/70">
                {t('opcional', 'optional')}
              </span>
            )}
          </div>
          {item.hint && <div className="text-[11px] text-fiba-muted">{item.hint}</div>}
          {item.checked_by && item.status !== 'pending' && (
            <div className="text-[10px] text-fiba-muted/70">
              {item.checked_by}
              {item.checked_at && ` · ${new Date(item.checked_at).toLocaleString()}`}
            </div>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          {STATUSES.map(s => {
            const on = item.status === s.key
            return (
              <button key={s.key} onClick={() => pick(s.key)} disabled={!editable}
                className={`px-2 py-1 rounded border text-[11px] font-semibold transition-colors ${
                  on ? s.cls : 'border-fiba-border text-fiba-muted hover:text-ink-900 dark:hover:text-white'
                } ${editable ? '' : 'cursor-default opacity-70'}`}>
                {t(s.es, s.en)}
              </button>
            )
          })}
        </div>
      </div>

      {(noteOpen || item.notes) && (
        <div className="mt-1.5">
          {editable ? (
            <input className="fiba-input text-xs" value={note} onChange={e => setNote(e.target.value)}
              onBlur={commitNote}
              placeholder={item.status === 'fail'
                ? t('¿Qué falló? (queda en el registro)', 'What failed? (kept on the record)')
                : t('Nota', 'Note')} />
          ) : (
            item.notes && <p className="text-[11px] text-fiba-muted italic">{item.notes}</p>
          )}
        </div>
      )}
      {!noteOpen && editable && !item.notes && (
        <button onClick={() => setNoteOpen(true)} className="mt-1 text-[10px] text-fiba-muted hover:text-fiba-accent">
          + {t('nota', 'note')}
        </button>
      )}
    </div>
  )
}
