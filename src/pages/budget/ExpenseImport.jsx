import { useMemo, useRef, useState } from 'react'
import { previewExpenseImport, commitExpenseImport, undoExpenseImport } from '../../api/client'
import { Icon } from '../../lib/icons'
import { competitionLabel } from '../../lib/competitions'
import { money, accountOption } from './shared'

/**
 * Import de gastos desde el ledger de Finanzas, en dos pasos.
 *
 * Los gastos entran **pagados** y un gasto pagado casi no se corrige, así que
 * la vista previa es donde se decide todo: a qué departamento va cada código
 * del archivo, a qué evento cada proyecto, y qué filas quedan afuera. Nada se
 * asigna solo. Lo que el usuario elige viaja igual al preview y al commit, y
 * el commit manda además la cantidad y el total que se vieron: si el backend
 * calcula otra cosa, no escribe.
 *
 * Solo lo ve el admin general de budget (el backend lo vuelve a exigir).
 */

const GENERAL = '__general__'
const EMPTY_MAPPING = { accounts: {}, departments: {}, projects: {}, force: [], skip: [] }

const PILL = {
  import: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-500',
  duplicate: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  error: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  skipped: 'bg-ink-100 text-ink-700 dark:bg-navy-800 dark:text-ink-300',
}

// En qué grupo de la vista previa cae una fila.
function bucketOf(row) {
  if (row.skipped) return 'skipped'
  return row.status === 'new' ? 'import' : row.status
}

function toggled(list, value) {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value]
}

export default function ExpenseImport({ departments, expenseAccounts, competitions, t, push, onDone, onClose }) {
  const inputRef = useRef(null)
  // Cada preview lleva su número: si llega la respuesta de uno viejo (el
  // usuario cambió otra asignación mientras tanto, o limpió), se descarta.
  const requestRef = useRef(0)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [mapping, setMapping] = useState(EMPTY_MAPPING)
  const [filter, setFilter] = useState('all')

  const [undoOpen, setUndoOpen] = useState(false)
  const [undoBatch, setUndoBatch] = useState('')
  const [undoReason, setUndoReason] = useState('')

  const departmentLabel = useMemo(
    () => Object.fromEntries(departments.map(d => [d.code, d.label])),
    [departments],
  )
  const accountLabel = useMemo(
    () => Object.fromEntries(expenseAccounts.map(a => [a.code, a.label])),
    [expenseAccounts],
  )
  // Con el período: las ventanas de una misma competencia comparten nombre.
  const competitionName = useMemo(
    () => Object.fromEntries(competitions.map(c => [c.id, competitionLabel(c, t('months.short'))])),
    [competitions, t],
  )

  function errorText(err) {
    if (err.response?.status === 409) return t('budget.expImpChanged')
    const detail = err.response?.data?.detail
    return typeof detail === 'string' ? detail : t('budget.impFailed')
  }

  function reset() {
    requestRef.current += 1
    setBusy(false)
    setFile(null); setPreview(null); setError(null)
    setSheet(null); setMapping(EMPTY_MAPPING); setFilter('all')
    if (inputRef.current) inputRef.current.value = ''
  }

  async function run(target, nextSheet, nextMapping) {
    if (!target) return
    const request = ++requestRef.current
    setBusy(true); setError(null)
    try {
      const data = await previewExpenseImport(target, { sheet: nextSheet, mapping: nextMapping })
      if (request !== requestRef.current) return
      setPreview(data)
    } catch (err) {
      if (request !== requestRef.current) return
      setError(errorText(err))
      setPreview(null)
    }
    setBusy(false)
  }

  function handleFile(e) {
    const picked = e.target.files?.[0]
    if (!picked) return
    setFile(picked); setResult(null); setSheet(null); setMapping(EMPTY_MAPPING); setFilter('all')
    run(picked, null, EMPTY_MAPPING)
  }

  function changeSheet(value) {
    // Las filas y los códigos son de la hoja: lo asignado no se arrastra.
    setSheet(value); setMapping(EMPTY_MAPPING); setFilter('all')
    run(file, value, EMPTY_MAPPING)
  }

  function remap(next) {
    setMapping(next)
    run(file, sheet, next)
  }

  function assign(kind, code, value) {
    const group = { ...mapping[kind] }
    if (value) group[code] = value
    else delete group[code]
    remap({ ...mapping, [kind]: group })
  }

  async function handleConfirm() {
    if (!file || !preview) return
    setBusy(true); setError(null)
    try {
      const res = await commitExpenseImport(file, { sheet, mapping, expected: preview.expected })
      setResult(res)
      reset()
      push({ type: 'success', title: `${res.created} ${t('budget.expImpDone')}` })
      onDone?.()
    } catch (err) {
      const message = errorText(err)
      if (err.response?.status === 409) {
        // El plan ya no es el que se vio: se vuelve a calcular antes de
        // dejar confirmar otra vez. `run` limpia el error, por eso va después.
        await run(file, sheet, mapping)
        setError(message)
        return
      }
      setError(message)
    }
    setBusy(false)
  }

  async function handleUndo() {
    setBusy(true); setError(null)
    try {
      const res = await undoExpenseImport(undoBatch.trim().toLowerCase(), undoReason.trim())
      push({ type: 'success', title: t('budget.expImpUndone', { count: res.deleted }) })
      if (res.kept.length > 0) {
        push({ type: 'info', title: t('budget.expImpUndoKept', { count: res.kept.length }) })
      }
      setUndoOpen(false); setUndoBatch(''); setUndoReason(''); setResult(null)
      onDone?.()
    } catch (err) {
      const detail = err.response?.data?.detail
      setError(typeof detail === 'string' ? detail : t('budget.expImpUndoFailed'))
    }
    setBusy(false)
  }

  function openUndo(batch = '') {
    setUndoBatch(batch); setUndoReason(''); setUndoOpen(true)
  }

  function rowMessage(row) {
    if (row.status === 'duplicate' && row.duplicate_of?.record_no) {
      return t('budget.expImpExistsAs', { record: row.duplicate_of.record_no })
    }
    if (!row.code) return row.message
    const key = `budget.expImpCode.${row.code}`
    const label = t(key)
    return label === key ? row.message : label
  }

  function warningText(warning) {
    const key = `budget.expImpWarn.${warning.code}`
    const label = t(key, warning.params)
    return label === key ? warning.message : label
  }

  const counts = preview?.counts || {}
  const totals = preview?.totals || {}
  const rows = preview?.rows || []
  const visibleRows = filter === 'all' ? rows : rows.filter(r => bucketOf(r) === filter)
  const canConfirm = !!preview && counts.import > 0 && !busy

  const pills = [
    ['import', counts.import || 0, t('budget.impNew')],
    ['duplicate', counts.duplicate || 0, t('budget.expImpDuplicate')],
    ['error', counts.error || 0, t('budget.impError')],
    ['skipped', counts.skipped || 0, t('budget.expImpSkipped')],
  ]

  return (
    <div className="mb-4 rounded-xl border border-fiba-border bg-fiba-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink-900 dark:text-white">{t('budget.expImpTitle')}</div>
          <div className="text-xs text-fiba-muted mt-0.5 max-w-2xl">{t('budget.expImpHint')}</div>
        </div>
        <div className="flex items-center gap-3">
          {!undoOpen && (
            <button type="button" onClick={() => openUndo()} className="text-xs text-fiba-muted hover:underline">
              {t('budget.expImpUndoPrevious')}
            </button>
          )}
          <button type="button" onClick={onClose} disabled={busy}
            className="text-xs text-fiba-muted hover:underline disabled:opacity-50">
            {t('budget.cancel')}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input ref={inputRef} type="file" accept=".xlsx,.xlsm" onChange={handleFile} disabled={busy}
          aria-label={t('budget.expImpTitle')}
          className="text-xs text-fiba-muted file:mr-2 file:rounded-md file:border-0 file:bg-fiba-surface file:px-3 file:py-1.5 file:text-xs file:text-ink-700 dark:file:text-ink-200" />
        {preview?.sheets?.length > 1 && (
          <label className="text-xs text-fiba-muted flex items-center gap-1.5">
            {t('budget.impSheet')}
            <select value={preview.sheet} onChange={e => changeSheet(e.target.value)} disabled={busy}
              className="fiba-select !w-auto !py-1 text-xs">
              {preview.sheets.map(s => (
                <option key={s.name} value={s.name} disabled={!s.recognized}>{s.name}</option>
              ))}
            </select>
          </label>
        )}
        {(preview || error) && (
          <button type="button" onClick={reset} disabled={busy}
            className="text-xs text-fiba-muted hover:underline disabled:opacity-50">
            {t('budget.impClear')}
          </button>
        )}
      </div>

      {busy && <div className="mt-3 text-xs text-fiba-muted" role="status">{t('common.loading')}</div>}

      {error && (
        <div role="alert" className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-500">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {t('budget.expImpResult', { count: result.created, total: money(result.total), batch: result.batch })}
            </span>
            <button type="button" onClick={() => openUndo(result.batch)} className="underline underline-offset-2">
              {t('budget.expImpUndo')}
            </button>
          </div>
          {result.failed.length > 0 && (
            <div className="mt-1 text-amber-500">{t('budget.expImpFailedRows', { count: result.failed.length })}</div>
          )}
          {result.history_failed > 0 && (
            <div className="mt-1 text-amber-500">{t('budget.expImpHistoryFailed', { count: result.history_failed })}</div>
          )}
        </div>
      )}

      {undoOpen && (
        <div className="mt-3 rounded-lg border border-fiba-border bg-fiba-surface px-3 py-3">
          <div className="text-xs font-medium text-ink-900 dark:text-white">{t('budget.expImpUndo')}</div>
          <p className="text-[11px] text-fiba-muted mt-0.5 mb-2 max-w-2xl">{t('budget.expImpUndoHint')}</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-fiba-muted">
              {t('budget.expImpBatch')}
              <input type="text" value={undoBatch} onChange={e => setUndoBatch(e.target.value)}
                maxLength={12} spellCheck={false} autoComplete="off"
                className="fiba-input mt-1 !w-40 font-mono text-xs" />
            </label>
            <label className="text-xs text-fiba-muted flex-1 min-w-[220px]">
              {t('budget.expImpReason')}
              <input type="text" value={undoReason} onChange={e => setUndoReason(e.target.value)}
                maxLength={2000} className="fiba-input mt-1 text-xs" />
            </label>
            <button type="button" onClick={() => setUndoOpen(false)} className="px-3 py-2 text-xs text-fiba-muted">
              {t('budget.cancel')}
            </button>
            <button type="button" onClick={handleUndo}
              disabled={busy || undoBatch.trim().length !== 12 || !undoReason.trim()}
              className="btn-fiba-ghost text-xs disabled:opacity-50">
              {t('budget.expImpUndoConfirm')}
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div className="mt-4 space-y-4">
          {/* Resumen: las pastillas filtran la tabla de filas */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button type="button" onClick={() => setFilter('all')} aria-pressed={filter === 'all'}
              className={`px-2 py-0.5 rounded border ${filter === 'all' ? 'border-ink-900 text-ink-900 dark:border-white dark:text-white' : 'border-fiba-border text-fiba-muted'}`}>
              {t('budget.expImpAll')} · {rows.length}
            </button>
            {pills.filter(([key, count]) => count > 0 || key === 'import').map(([key, count, label]) => (
              <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key}
                className={`px-2 py-0.5 rounded ${PILL[key]} ${filter === key ? 'ring-1 ring-current' : ''}`}>
                {count} {label}
              </button>
            ))}
            <span className="text-fiba-muted">
              {t('budget.impWillImport')}: <strong className="text-ink-700 dark:text-ink-200">${money(totals.import)}</strong>
            </span>
          </div>

          <p className="text-xs text-amber-500 flex items-center gap-1.5">
            <Icon.Alert className="w-3.5 h-3.5 flex-shrink-0" />
            {t('budget.expImpPaidNote')}
          </p>

          {/* Asignación: departamentos */}
          {preview.departments.length > 0 && (
            <div>
              <div className="text-xs font-medium text-ink-900 dark:text-white mb-1">{t('budget.expImpDepartments')}</div>
              <p className="text-[11px] text-fiba-muted mb-2">{t('budget.expImpDepartmentsHint')}</p>
              <div className="rounded-lg border border-fiba-border divide-y divide-fiba-border">
                {preview.departments.map(item => (
                  <div key={item.code} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                    <span className="text-xs text-ink-700 dark:text-ink-200 min-w-[120px] font-mono">
                      {item.code || t('budget.expImpNoDepartment')}
                    </span>
                    <span className="text-[11px] text-fiba-muted flex-1 min-w-[160px]">
                      {t('budget.expImpRows', { count: item.rows })} · ${money(item.amount)}
                    </span>
                    {item.suggested && !item.mapped && (
                      <span className="text-[11px] text-amber-500 flex flex-wrap items-center gap-2">
                        {item.evidence > 0 && t('budget.expImpEvidence', {
                          count: item.evidence,
                          department: departmentLabel[item.suggested] || item.suggested,
                        })}
                        <button type="button" disabled={busy}
                          onClick={() => assign('departments', item.code, item.suggested)}
                          className="underline underline-offset-2">
                          {t('budget.expImpUse', { department: departmentLabel[item.suggested] || item.suggested })}
                        </button>
                      </span>
                    )}
                    <select value={item.mapped || ''} disabled={busy}
                      aria-label={`${t('budget.department')} ${item.code}`}
                      onChange={e => assign('departments', item.code, e.target.value)}
                      className="fiba-select !w-auto !py-1 text-xs min-w-[200px]">
                      <option value="">{t('budget.expImpChoose')}</option>
                      {departments.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Asignación: proyectos */}
          {preview.projects.length > 0 && (
            <div>
              <div className="text-xs font-medium text-ink-900 dark:text-white mb-1">{t('budget.expImpProjects')}</div>
              <p className="text-[11px] text-fiba-muted mb-2">{t('budget.expImpProjectsHint')}</p>
              <div className="rounded-lg border border-fiba-border divide-y divide-fiba-border">
                {preview.projects.map(item => (
                  <div key={item.code} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                    <span className="text-xs text-ink-700 dark:text-ink-200 min-w-[120px] font-mono">{item.code}</span>
                    <span className="text-[11px] text-fiba-muted flex-1 min-w-[160px]">
                      {t('budget.expImpRows', { count: item.rows })} · ${money(item.amount)}
                    </span>
                    <select value={item.mapped || ''} disabled={busy}
                      aria-label={`${t('budget.competition')} ${item.code}`}
                      onChange={e => assign('projects', item.code, e.target.value)}
                      className="fiba-select !w-auto !py-1 text-xs min-w-[240px] max-w-full">
                      <option value="">{t('budget.expImpChoose')}</option>
                      <option value={GENERAL}>{t('budget.impGeneralColumn')}</option>
                      {competitions.map(c => (
                        <option key={c.id} value={c.id}>{competitionName[c.id]}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Asignación: cuentas que no están en el plan */}
          {preview.accounts.length > 0 && (
            <div>
              <div className="text-xs font-medium text-ink-900 dark:text-white mb-1">{t('budget.expImpAccounts')}</div>
              <p className="text-[11px] text-fiba-muted mb-2">{t('budget.expImpAccountsHint')}</p>
              <div className="rounded-lg border border-fiba-border divide-y divide-fiba-border">
                {preview.accounts.map(item => (
                  <div key={item.code} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                    <span className="text-xs text-ink-700 dark:text-ink-200 min-w-[120px] font-mono">{item.code}</span>
                    <span className="text-[11px] text-fiba-muted flex-1 min-w-[160px]">
                      {t('budget.expImpRows', { count: item.rows })} · ${money(item.amount)}
                    </span>
                    <select value={item.mapped || ''} disabled={busy}
                      aria-label={`${t('budget.account')} ${item.code}`}
                      onChange={e => assign('accounts', item.code, e.target.value)}
                      className="fiba-select !w-auto !py-1 text-xs min-w-[240px] max-w-full">
                      <option value="">{t('budget.expImpChoose')}</option>
                      {expenseAccounts.map(accountOption)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Qué se importa, por departamento, cuenta y evento */}
          {preview.summary.length > 0 && (
            <div>
              <div className="text-xs font-medium text-ink-900 dark:text-white mb-1">{t('budget.expImpSummary')}</div>
              <div className="overflow-x-auto rounded-lg border border-fiba-border">
                <table className="fiba-table">
                  <thead>
                    <tr>
                      <th>{t('budget.department')}</th>
                      <th>{t('budget.account')}</th>
                      <th>{t('budget.competition')}</th>
                      <th className="text-right">{t('budget.impRow')}</th>
                      <th className="text-right">{t('budget.amount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.summary.map((s, i) => (
                      <tr key={i}>
                        <td className="px-4 py-1.5 text-xs">{departmentLabel[s.department_code] || s.department_code}</td>
                        <td className="px-4 py-1.5 text-xs">
                          {s.account_code}{accountLabel[s.account_code] ? ` · ${accountLabel[s.account_code]}` : ''}
                        </td>
                        <td className="px-4 py-1.5 text-xs text-fiba-muted">
                          {s.competition_id ? (competitionName[s.competition_id] || '-') : t('budget.general')}
                        </td>
                        <td className="px-4 py-1.5 text-xs text-right">{s.rows}</td>
                        <td className="px-4 py-1.5 text-xs text-right whitespace-nowrap">${money(s.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview.credits.length > 0 && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
              <div className="text-xs font-medium text-amber-500 mb-1">
                {t('budget.expImpCredits')}: {preview.credits.length} · ${money(totals.credits)}
              </div>
              <ul className="space-y-0.5 text-[11px] text-amber-500/90 max-h-28 overflow-auto">
                {preview.credits.map(c => (
                  <li key={c.row}>{t('budget.impRow')} {c.row}: {c.description || '-'} (${money(c.amount)})</li>
                ))}
              </ul>
            </div>
          )}

          {preview.not_in_file.count > 0 && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
              <div className="text-xs font-medium text-amber-500">
                {t('budget.expImpNotInFile')}: {preview.not_in_file.count} · ${money(preview.not_in_file.amount)}
              </div>
              <p className="text-[11px] text-amber-500/90 mb-1">{t('budget.expImpNotInFileHint')}</p>
              <ul className="space-y-0.5 text-[11px] text-amber-500/90 max-h-28 overflow-auto">
                {preview.not_in_file.rows.map(r => (
                  <li key={r.id}>
                    {r.record_no || '-'} · {r.expense_date} · {r.account_code} · {r.description} (${money(r.amount)})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.warnings.length > 0 && (
            <div className="rounded-lg bg-fiba-surface border border-fiba-border px-3 py-2">
              <div className="text-xs font-medium text-ink-700 dark:text-ink-200 mb-1">
                {preview.warnings.length} {t('budget.impWarnings')}
              </div>
              <ul className="space-y-0.5 text-[11px] text-fiba-muted max-h-28 overflow-auto">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w.row ? `${t('budget.impRow')} ${w.row}: ` : ''}{warningText(w)}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Filas */}
          <div className="max-h-96 overflow-auto rounded-lg border border-fiba-border">
            <table className="fiba-table">
              <thead>
                <tr>
                  <th>{t('budget.impRow')}</th>
                  <th>{t('budget.expenseDate')}</th>
                  <th>{t('budget.account')}</th>
                  <th>{t('budget.description')}</th>
                  <th>{t('budget.payee')}</th>
                  <th className="text-right">{t('budget.amount')}</th>
                  <th>{t('budget.status')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-3 text-xs text-fiba-muted">{t('budget.expImpNoRows')}</td>
                  </tr>
                )}
                {visibleRows.map(row => {
                  const bucket = bucketOf(row)
                  const message = rowMessage(row)
                  return (
                    <tr key={row.row}>
                      <td className="px-4 py-1.5 text-xs text-fiba-muted">{row.row}</td>
                      <td className="px-4 py-1.5 text-xs text-fiba-muted whitespace-nowrap">{row.expense_date || '-'}</td>
                      <td className="px-4 py-1.5 text-xs whitespace-nowrap">{row.account_code || row.file_account || '-'}</td>
                      <td className="px-4 py-1.5 text-xs text-ink-700 dark:text-ink-200 max-w-[260px] truncate" title={row.description || ''}>
                        {row.description || '-'}
                      </td>
                      <td className="px-4 py-1.5 text-xs text-fiba-muted max-w-[160px] truncate" title={row.payee_name || ''}>
                        {row.payee_name || '-'}
                      </td>
                      <td className="px-4 py-1.5 text-xs text-right whitespace-nowrap">
                        {row.amount == null ? '-' : `$${money(row.amount)}`}
                      </td>
                      <td className="px-4 py-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${PILL[bucket]}`}>
                          {pills.find(([key]) => key === bucket)?.[2]}
                        </span>
                        {message && (
                          <span className={`ml-1 text-[10px] ${bucket === 'error' ? 'text-red-400' : 'text-fiba-muted'}`}>
                            {message}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-1.5 text-[11px] text-fiba-muted whitespace-nowrap">
                        {(row.status === 'duplicate' || row.forced) && (
                          <label className="inline-flex items-center gap-1.5">
                            <input type="checkbox" checked={mapping.force.includes(row.row)} disabled={busy}
                              onChange={() => remap({ ...mapping, force: toggled(mapping.force, row.row) })} />
                            {t('budget.expImpForce')}
                          </label>
                        )}
                        {row.status === 'new' && !row.forced && (
                          <label className="inline-flex items-center gap-1.5">
                            <input type="checkbox" checked={mapping.skip.includes(row.row)} disabled={busy}
                              onChange={() => remap({ ...mapping, skip: toggled(mapping.skip, row.row) })} />
                            {t('budget.impDoNotImport')}
                          </label>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-3">
            <button type="button" onClick={reset} disabled={busy}
              className="px-4 py-2 text-sm text-fiba-muted disabled:opacity-50">
              {t('budget.cancel')}
            </button>
            <button type="button" onClick={handleConfirm} disabled={!canConfirm} className="btn-fiba disabled:opacity-50">
              {counts.import > 0 ? t('budget.expImpConfirmCount', { count: counts.import }) : t('budget.impConfirm')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
