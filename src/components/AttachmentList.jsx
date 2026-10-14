/**
 * Adjuntos de un registro financiero (pago o gasto): lista, descarga, borrado
 * y subida con etiqueta.
 *
 * No sabe de qué bucket viene nada: el caller pasa los handlers, y la descarga
 * va por blob + JWT (`downloadXAttachment` + `saveBlob` de api/client) porque
 * los buckets son privados. Nunca un <a href> a una URL pública.
 *
 * - `kinds`: si es un array, la etiqueta se elige de una lista cerrada; si no,
 *   es texto libre (el comportamiento histórico de Pagos y Gastos).
 * - `onUpload(file, kind)` puede devolver `false` para indicar que falló (el
 *   caller ya avisó con un toast) y que no hay que limpiar la etiqueta.
 * - `labels`: textos ya traducidos por el caller, para que cada módulo use sus
 *   propias claves de i18n.
 */
import { useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import { Icon } from '../lib/icons'

export default function AttachmentList({
  items = [], kinds, onUpload, onDownload, onDelete, canEdit = false, labels = {},
  accept = 'application/pdf,image/*',
}) {
  const { t } = useLanguage()
  const [kind, setKind] = useState('')
  const [uploading, setUploading] = useState(false)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''   // permite volver a subir el mismo archivo
    if (!file || !onUpload) return
    setUploading(true)
    try {
      const ok = await onUpload(file, kind || null)
      if (ok !== false) setKind('')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <div className="space-y-1">
        {items.map(a => (
          <div key={a.id} className="flex items-center gap-2 py-1 text-sm">
            <button type="button" onClick={() => onDownload?.(a)}
              className="flex-1 min-w-0 text-left text-ink-900 dark:text-white hover:underline truncate">
              {a.file_name}
            </button>
            {a.kind && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-fiba-surface text-fiba-muted whitespace-nowrap">{a.kind}</span>
            )}
            {canEdit && onDelete && (
              <button type="button" onClick={() => onDelete(a)}
                title={labels.remove || t('common.remove')} aria-label={labels.remove || t('common.remove')}
                className="p-1 rounded hover:bg-fiba-surface text-fiba-muted hover:text-red-500">
                <Icon.X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        {items.length === 0 && labels.empty && (
          <p className="text-xs text-fiba-muted/60">{labels.empty}</p>
        )}
      </div>

      {canEdit && onUpload && (
        <div className="flex items-center gap-2 mt-3">
          {Array.isArray(kinds) ? (
            <select value={kind} onChange={e => setKind(e.target.value)} className="fiba-select flex-1 text-sm">
              <option value="">{labels.kindPlaceholder || '—'}</option>
              {kinds.map(k => (
                <option key={typeof k === 'string' ? k : k.value} value={typeof k === 'string' ? k : k.value}>
                  {typeof k === 'string' ? k : k.label}
                </option>
              ))}
            </select>
          ) : (
            <input type="text" value={kind} onChange={e => setKind(e.target.value)}
              placeholder={labels.kindPlaceholder} className="fiba-input flex-1 text-sm" />
          )}
          <label className={`btn-fiba-ghost whitespace-nowrap ${uploading ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}`}>
            {uploading ? t('common.uploading') : labels.upload}
            <input type="file" className="hidden" accept={accept} onChange={handleFile} disabled={uploading} />
          </label>
        </div>
      )}
    </div>
  )
}
