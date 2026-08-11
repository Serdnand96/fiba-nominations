import { useRef, useState } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import {
  previewLogisticsManifest, commitLogisticsManifest,
  previewLogisticsRooming, commitLogisticsRooming,
} from '../../api/client'

// Importador de las planillas de FIBA en dos pasos.
//
// El preview no escribe nada: muestra a quién reconoció contra el padrón, a
// quién va a crear nuevo y qué celdas no pudo interpretar. Recién después se
// confirma. Las planillas vienen escritas a mano y con typos, así que la
// alternativa —importar de una y arreglar después— significa limpiar datos ya
// mezclados con los buenos.

const ENDPOINTS = {
  manifest: { preview: previewLogisticsManifest, commit: commitLogisticsManifest },
  rooming: { preview: previewLogisticsRooming, commit: commitLogisticsRooming },
}

const STATUS_STYLES = {
  matched: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-500',
  review: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-500',
  new: 'bg-fiba-surface text-fiba-muted',
}

export default function SheetImport({ kind, competitionId, onDone }) {
  const { lang } = useLanguage()
  const t = (es, en) => (lang === 'es' ? es : en)
  const inputRef = useRef(null)

  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  const STATUS_LABELS = {
    matched: t('vinculado', 'linked'),
    review: t('revisar', 'review'),
    new: t('nuevo', 'new'),
  }

  function reset() {
    setFile(null); setPreview(null); setError(null); setResult(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleFile(e) {
    const picked = e.target.files?.[0]
    if (!picked) return
    setFile(picked); setError(null); setResult(null); setBusy(true)
    try {
      setPreview(await ENDPOINTS[kind].preview(competitionId, picked))
    } catch (err) {
      setError(err.response?.data?.detail || t('No se pudo leer el archivo.', 'Could not read the file.'))
      setPreview(null)
    } finally { setBusy(false) }
  }

  async function handleConfirm() {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const res = await ENDPOINTS[kind].commit(competitionId, file)
      setResult(res); setPreview(null); setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      onDone?.()
    } catch (err) {
      setError(err.response?.data?.detail || t('No se pudo importar.', 'Import failed.'))
    } finally { setBusy(false) }
  }

  const title = kind === 'manifest'
    ? t('Importar Flight Manifest', 'Import Flight Manifest')
    : t('Importar Rooming List', 'Import Rooming List')

  return (
    <div className="mb-4 rounded-xl border border-fiba-border bg-fiba-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-ink-900 dark:text-white">{title}</div>
          <div className="text-xs text-fiba-muted mt-0.5">
            {t('Archivo .xlsx. Se muestra un resumen antes de guardar nada.',
               '.xlsx file. You get a summary before anything is saved.')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input ref={inputRef} type="file" accept=".xlsx,.xlsm" onChange={handleFile} disabled={busy}
            className="text-xs text-fiba-muted file:mr-2 file:rounded-md file:border-0 file:bg-fiba-surface file:px-3 file:py-1.5 file:text-xs file:text-ink-700 dark:file:text-ink-200" />
          {(preview || result || error) && (
            <button onClick={reset} className="text-xs text-fiba-muted hover:underline">{t('Limpiar', 'Clear')}</button>
          )}
        </div>
      </div>

      {busy && <div className="mt-3 text-xs text-fiba-muted">{t('Procesando...', 'Processing...')}</div>}

      {error && (
        <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">{error}</div>
      )}

      {result && (
        <div className="mt-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-500">
          {kind === 'manifest'
            ? t(`Importado: ${result.participants_total} personas, ${result.legs} tramos de viaje.`,
                `Imported: ${result.participants_total} people, ${result.legs} travel legs.`)
            : t(`Importado: ${result.stays} estadías, ${result.total_nights} noches de habitación.`,
                `Imported: ${result.stays} stays, ${result.total_nights} room nights.`)}
        </div>
      )}

      {preview && (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
            <span className="text-fiba-muted">{t('Filas leídas', 'Rows read')}: <strong className="text-ink-700 dark:text-ink-200">{preview.total}</strong></span>
            <span className={`px-2 py-0.5 rounded ${STATUS_STYLES.matched}`}>{preview.matched} {t('vinculadas', 'linked')}</span>
            <span className={`px-2 py-0.5 rounded ${STATUS_STYLES.review}`}>{preview.review} {t('a revisar', 'to review')}</span>
            <span className={`px-2 py-0.5 rounded ${STATUS_STYLES.new}`}>{preview.new} {t('nuevas', 'new')}</span>
            {kind === 'rooming' && (
              <span className="text-fiba-muted">· {preview.total_nights} {t('noches de habitación', 'room nights')}</span>
            )}
          </div>

          {preview.warnings?.length > 0 && (
            <div className="mb-3 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
              <div className="text-xs font-medium text-amber-500 mb-1">
                {t(`${preview.warnings.length} cosa(s) que conviene mirar`, `${preview.warnings.length} thing(s) worth checking`)}
              </div>
              <ul className="space-y-0.5 text-[11px] text-amber-500/90">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{t('Fila', 'Row')} {w.row}: {w.message}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="max-h-72 overflow-auto rounded-lg border border-fiba-border">
            <table className="fiba-table">
              <thead>
                <tr>
                  <th>{t('Nombre en la planilla', 'Name in the sheet')}</th>
                  <th>{t('Rol', 'Role')}</th>
                  <th>{t('Estado', 'Status')}</th>
                  <th>{t('Se vincula con', 'Links to')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i}>
                    <td className="px-4 py-1.5 text-xs font-medium whitespace-nowrap">
                      {[row.first_name, row.last_name].filter(Boolean).join(' ')}
                      {row.pax > 1 && <span className="text-fiba-muted"> ({row.pax} pax)</span>}
                    </td>
                    <td className="px-4 py-1.5 text-xs text-fiba-muted">{row.role || '—'}</td>
                    <td className="px-4 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_STYLES[row.match.status]}`}>
                        {STATUS_LABELS[row.match.status]}
                      </span>
                    </td>
                    <td className="px-4 py-1.5 text-xs text-fiba-muted">
                      {row.match.matched_name
                        ? `${row.match.matched_name} (${Math.round(row.match.score * 100)}%)`
                        : t('Se crea nuevo', 'Created new')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-3 mt-3">
            <button onClick={reset} className="px-4 py-2 text-sm text-fiba-muted">{t('Cancelar', 'Cancel')}</button>
            <button onClick={handleConfirm} disabled={busy} className="btn-fiba disabled:opacity-50">
              {t('Confirmar importación', 'Confirm import')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
