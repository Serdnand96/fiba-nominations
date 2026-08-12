import { useRef, useState } from 'react'
import { previewBudgetImport, commitBudgetImport, downloadBudgetLinesXlsx } from '../../api/client'
import { Icon } from '../../lib/icons'

/**
 * Import del presupuesto desde Excel, en dos pasos.
 *
 * El preview no escribe nada: muestra qué línea se crea, cuál se actualiza
 * contra la que ya está cargada, qué cuentas habría que abrir y —lo importante—
 * qué columna de la planilla no matchea ninguna competencia.
 *
 * Esas columnas **no se importan solas**. En la planilla real de Competitions
 * los 18 encabezados traen typos ("2018" por 2028) y agrupaciones que no
 * coinciden con cómo la base modela las fases: adivinar sería imputarle el
 * gasto a otro evento. El usuario las resuelve acá con un desplegable y esa
 * decisión viaja al commit.
 */

const SKIP = '__skip__'
const GENERAL = '__general__'

const STATUS_STYLES = {
  new: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-500',
  update: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  error: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
}

function money(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

export default function BudgetImport({ year, department, competitions, kind = 'expense', t, push, onDone, onClose }) {
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  // Lo que el usuario decidió sobre la planilla; viaja igual al preview y al
  // commit, para que lo que se confirma sea exactamente lo que se vio.
  const [sheet, setSheet] = useState(null)
  const [mapping, setMapping] = useState({})
  const [defaultCompetitionId, setDefaultCompetitionId] = useState('')
  const [createAccounts, setCreateAccounts] = useState(true)
  const [replace, setReplace] = useState(false)

  const options = (extra = {}) => ({
    year, department, kind, sheet, mapping, defaultCompetitionId,
    createAccounts, replace, ...extra,
  })

  function reset() {
    setFile(null); setPreview(null); setError(null); setResult(null)
    setSheet(null); setMapping({}); setDefaultCompetitionId('')
    setCreateAccounts(true); setReplace(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function run(nextFile, extra = {}) {
    const target = nextFile || file
    if (!target) return
    setBusy(true); setError(null); setResult(null)
    try {
      setPreview(await previewBudgetImport(target, options(extra)))
    } catch (err) {
      setError(err.response?.data?.detail || t('budget.impFailed'))
      setPreview(null)
    }
    setBusy(false)
  }

  async function handleFile(e) {
    const picked = e.target.files?.[0]
    if (!picked) return
    setFile(picked); setSheet(null); setMapping({}); setDefaultCompetitionId('')
    run(picked, { sheet: null, mapping: {}, defaultCompetitionId: '' })
  }

  function setOption(setter, key, value) {
    setter(value)
    run(null, { [key]: value })
  }

  function remap(label, value) {
    const next = { ...mapping, [label]: value }
    setMapping(next)
    run(null, { mapping: next })
  }

  async function handleConfirm() {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const res = await commitBudgetImport(file, options())
      setResult(res)
      setPreview(null); setFile(null)
      if (inputRef.current) inputRef.current.value = ''
      push({ type: 'success', title: `${res.created + res.updated} ${t('budget.impDone')}` })
      onDone?.()
    } catch (err) {
      setError(err.response?.data?.detail || t('budget.impFailed'))
    }
    setBusy(false)
  }

  // Las competencias del año elegido primero: son las que casi siempre se buscan.
  const sortedCompetitions = [...competitions].sort((a, b) => {
    const ay = a.year === year ? 0 : 1
    const by = b.year === year ? 0 : 1
    return ay - by || (a.name || '').localeCompare(b.name || '')
  })

  const currentValue = (column) => {
    if (mapping[column.label] !== undefined) return mapping[column.label]
    if (column.status === 'general') return GENERAL
    if (column.competition_id) return column.competition_id
    return SKIP
  }

  const counts = preview?.counts || {}
  const totals = preview?.totals || {}
  const canConfirm = preview && (counts.new || counts.update)

  if (!department) {
    return (
      <div className="mb-4 rounded-xl border border-fiba-border bg-fiba-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-ink-900 dark:text-white">{t('budget.impTitle')}</div>
            <div className="text-xs text-amber-500 mt-1 flex items-center gap-1.5">
              <Icon.Alert className="w-3.5 h-3.5 flex-shrink-0" />
              {t('budget.impPickDepartment')}
            </div>
          </div>
          <button onClick={onClose} className="text-xs text-fiba-muted hover:underline">{t('budget.cancel')}</button>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-4 rounded-xl border border-fiba-border bg-fiba-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink-900 dark:text-white">{t('budget.impTitle')}</div>
          <div className="text-xs text-fiba-muted mt-0.5 max-w-2xl">{t('budget.impHint')}</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadBudgetLinesXlsx({ year, kind, ...(department ? { department } : {}) })}
            className="btn-fiba-ghost text-xs">
            <Icon.Download className="w-3.5 h-3.5 inline mr-1" />
            {t('budget.impTemplate')}
          </button>
          <button onClick={onClose} className="text-xs text-fiba-muted hover:underline">{t('budget.cancel')}</button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input ref={inputRef} type="file" accept=".xlsx,.xlsm" onChange={handleFile} disabled={busy}
          className="text-xs text-fiba-muted file:mr-2 file:rounded-md file:border-0 file:bg-fiba-surface file:px-3 file:py-1.5 file:text-xs file:text-ink-700 dark:file:text-ink-200" />
        {preview?.sheets?.length > 1 && (
          <label className="text-xs text-fiba-muted flex items-center gap-1.5">
            {t('budget.impSheet')}
            <select value={preview.sheet} onChange={e => setOption(setSheet, 'sheet', e.target.value)}
              className="fiba-select !w-auto !py-1 text-xs">
              {preview.sheets.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
        {(preview || result || error) && (
          <button onClick={reset} className="text-xs text-fiba-muted hover:underline">{t('budget.impClear')}</button>
        )}
      </div>

      {busy && <div className="mt-3 text-xs text-fiba-muted">{t('common.loading')}</div>}

      {error && (
        <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">{error}</div>
      )}

      {result && (
        <div className="mt-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-500">
          {t('budget.impCreated')}: {result.created} · {t('budget.impUpdated')}: {result.updated}
          {result.deleted > 0 && <> · {t('budget.impDeleted')}: {result.deleted}</>}
          {result.accounts_created.length > 0 && <> · {t('budget.impAccountsNew')}: {result.accounts_created.join(', ')}</>}
        </div>
      )}

      {preview && (
        <div className="mt-4 space-y-4">
          {/* Resumen */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`px-2 py-0.5 rounded ${STATUS_STYLES.new}`}>{counts.new || 0} {t('budget.impNew')}</span>
            <span className={`px-2 py-0.5 rounded ${STATUS_STYLES.update}`}>{counts.update || 0} {t('budget.impUpdate')}</span>
            {counts.error > 0 && (
              <span className={`px-2 py-0.5 rounded ${STATUS_STYLES.error}`}>{counts.error} {t('budget.impError')}</span>
            )}
            <span className="text-fiba-muted">
              {t('budget.impWillImport')}: <strong className="text-ink-700 dark:text-ink-200">${money(totals.import)}</strong>
            </span>
            {totals.skipped > 0 && (
              <span className="text-amber-500">{t('budget.impNotImported')}: ${money(totals.skipped)}</span>
            )}
          </div>

          {/* Mapeo de columnas — el punto de decisión del import */}
          {preview.competitions.length > 0 && (
            <div>
              <div className="text-xs font-medium text-ink-900 dark:text-white mb-1">{t('budget.impColumns')}</div>
              <p className="text-[11px] text-fiba-muted mb-2">{t('budget.impColumnsHint')}</p>
              <div className="max-h-64 overflow-auto rounded-lg border border-fiba-border divide-y divide-fiba-border">
                {preview.competitions.map(column => (
                  <div key={column.label} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                    <span className="text-xs text-ink-700 dark:text-ink-200 flex-1 min-w-[180px] truncate" title={column.label}>
                      {column.label}
                    </span>
                    {column.status === 'review' && currentValue(column) === SKIP && (
                      <span className="text-[11px] text-amber-500 truncate max-w-[220px]">
                        ¿{column.name}? ({Math.round((column.score || 0) * 100)}%)
                      </span>
                    )}
                    <select value={currentValue(column)} onChange={e => remap(column.label, e.target.value)}
                      className="fiba-select !w-auto !py-1 text-xs min-w-[220px]">
                      <option value={SKIP}>{t('budget.impDoNotImport')}</option>
                      <option value={GENERAL}>{t('budget.impGeneralColumn')}</option>
                      {sortedCompetitions.map(c => (
                        <option key={c.id} value={c.id}>{c.name}{c.year !== year ? ` (${c.year})` : ''}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Planilla de un solo evento: no hay dimensión de competencia */}
          {preview.competitions.length === 0 && (
            <label className="flex flex-wrap items-center gap-2 text-xs text-fiba-muted">
              {t('budget.impAssignAll')}
              <select value={defaultCompetitionId}
                onChange={e => setOption(setDefaultCompetitionId, 'defaultCompetitionId', e.target.value)}
                className="fiba-select !w-auto !py-1 text-xs min-w-[240px]">
                <option value="">{t('budget.impGeneralColumn')}</option>
                {sortedCompetitions.map(c => (
                  <option key={c.id} value={c.id}>{c.name}{c.year !== year ? ` (${c.year})` : ''}</option>
                ))}
              </select>
            </label>
          )}

          {/* Cuentas a crear */}
          {preview.new_accounts.length > 0 && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
              <div className="text-xs font-medium text-amber-500 mb-1">
                {preview.new_accounts.length} {t('budget.impNewAccounts')}
              </div>
              <ul className="space-y-0.5 text-[11px] text-amber-500/90 max-h-28 overflow-auto">
                {preview.new_accounts.map(a => (
                  <li key={a.code}>{a.code} — {a.label} (${money(a.amount)})</li>
                ))}
              </ul>
            </div>
          )}

          {/* Avisos */}
          {preview.warnings.length > 0 && (
            <div className="rounded-lg bg-fiba-surface border border-fiba-border px-3 py-2">
              <div className="text-xs font-medium text-ink-700 dark:text-ink-200 mb-1">
                {preview.warnings.length} {t('budget.impWarnings')}
              </div>
              <ul className="space-y-0.5 text-[11px] text-fiba-muted max-h-28 overflow-auto">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w.row ? `${t('budget.impRow')} ${w.row}: ` : ''}{w.message}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Opciones */}
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <label className="flex items-center gap-1.5 text-fiba-muted">
              <input type="checkbox" checked={createAccounts}
                onChange={e => setOption(setCreateAccounts, 'createAccounts', e.target.checked)} />
              {t('budget.impCreateAccounts')}
            </label>
            <label className="flex items-center gap-1.5 text-fiba-muted" title={t('budget.impReplaceHint')}>
              <input type="checkbox" checked={replace}
                onChange={e => setOption(setReplace, 'replace', e.target.checked)} />
              {t('budget.impReplace')}
            </label>
          </div>

          {replace && preview.deletions.length > 0 && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
              <div className="text-xs font-medium text-red-400 mb-1">
                {t('budget.impWillDelete')}: {totals.delete}
              </div>
              <ul className="space-y-0.5 text-[11px] text-red-400/90 max-h-28 overflow-auto">
                {preview.deletions.map(d => (
                  <li key={d.id}>{d.year} · {d.account_code} · {d.description}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Filas */}
          <div className="max-h-72 overflow-auto rounded-lg border border-fiba-border">
            <table className="fiba-table">
              <thead>
                <tr>
                  <th>{t('budget.impRow')}</th>
                  <th>{t('budget.year')}</th>
                  <th>{t('budget.account')}</th>
                  <th>{t('budget.lineDescription')}</th>
                  <th>{t('budget.competition')}</th>
                  <th className="text-right">{t('budget.amount')}</th>
                  <th>{t('budget.status')}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i}>
                    <td className="px-4 py-1.5 text-xs text-fiba-muted">{row.row}</td>
                    <td className="px-4 py-1.5 text-xs text-fiba-muted">{row.year}</td>
                    <td className="px-4 py-1.5 text-xs whitespace-nowrap">
                      {row.account_code}
                      {row.account_new && <span className="ml-1 text-amber-500">•</span>}
                    </td>
                    <td className="px-4 py-1.5 text-xs text-ink-700 dark:text-ink-200 max-w-[280px] truncate" title={row.description}>
                      {row.description}
                    </td>
                    <td className="px-4 py-1.5 text-xs text-fiba-muted max-w-[200px] truncate">
                      {row.competition_label || (row.competition_id ? '' : t('budget.general'))}
                    </td>
                    <td className="px-4 py-1.5 text-xs text-right whitespace-nowrap">${money(row.amount)}</td>
                    <td className="px-4 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_STYLES[row.status]}`}>
                        {t(`budget.imp${row.status === 'new' ? 'New' : row.status === 'update' ? 'Update' : 'Error'}`)}
                      </span>
                      {row.message && <span className="ml-1 text-[10px] text-red-400">{row.message}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.truncated && (
            <p className="text-[11px] text-fiba-muted">{t('budget.impTruncated')}</p>
          )}

          <div className="flex justify-end gap-3">
            <button onClick={reset} className="px-4 py-2 text-sm text-fiba-muted">{t('budget.cancel')}</button>
            <button onClick={handleConfirm} disabled={busy || !canConfirm} className="btn-fiba disabled:opacity-50">
              {t('budget.impConfirm')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
