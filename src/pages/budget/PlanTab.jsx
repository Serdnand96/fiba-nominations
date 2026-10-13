import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  getBudgetLines, createBudgetLine, updateBudgetLine, deleteBudgetLine,
  projectBudget, getBudgetSummary,
} from '../../api/client'
import { Drawer } from '../../components/ui/Drawer'
import { Icon } from '../../lib/icons'
import BudgetImport from './BudgetImport'
import BudgetLineEditor from './editors/BudgetLineEditor'
import { money, AccountOptions } from './shared'

const GENERAL = '__general__'   // clave de la columna "sin evento" en la matriz

/* ──────────────────────────── Presupuesto ────────────────────────────
 *
 * Una sola tabla (budget_lines), dos vistas:
 *   Matriz → cuentas × competencias, la forma del Excel de Competitions.
 *            La columna "General" son las líneas con competition_id NULL.
 *   Lista  → líneas agrupadas por cuenta con columnas de años, la forma del
 *            Excel de IT, más la proyección por escalación.
 */
export default function PlanTab({ t, push, canEdit, departments, expenseAccounts, competitions }) {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(thisYear)
  const [department, setDepartment] = useState('')
  const [view, setView] = useState('matrix')
  const [lines, setLines] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [projecting, setProjecting] = useState(false)
  const [editingLine, setEditingLine] = useState(null)
  const [cellDetail, setCellDetail] = useState(null)
  const [importing, setImporting] = useState(false)

  const yearOptions = useMemo(
    () => Array.from({ length: 7 }, (_, i) => thisYear + 2 - i),
    [thisYear],
  )

  async function load() {
    setLoading(true)
    try {
      const params = { year, kind: 'expense' }
      if (department) params.department = department
      const [ls, sum] = await Promise.all([
        getBudgetLines(params),
        getBudgetSummary(department ? { year, department } : { year }),
      ])
      setLines(ls)
      setSummary(sum)
      // La matriz solo se gana su lugar si hay cruce real cuenta × evento.
      // El presupuesto de IT es casi todo overhead sin evento: una sola cuenta
      // ("IT on Events") toca competencias, así que la matriz saldría con 7
      // filas × 8 columnas y 41 celdas vacías. La lista dice lo mismo sin el
      // ruido. Se recalcula al cambiar año o departamento; el toggle manual
      // manda hasta el próximo cambio de filtro.
      const withEvents = new Set(ls.filter(l => l.competition_id).map(l => l.account_code))
      setView(withEvents.size >= 2 ? 'matrix' : 'list')
    } catch (e) {
      console.error(e)
      push({ type: 'error', title: t('common.error') })
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [year, department])

  async function handleProject(overwrite) {
    setProjecting(true)
    try {
      const res = await projectBudget({
        from_year: year,
        to_years: [year + 1, year + 2, year + 3],
        department_code: department || null,
        overwrite,
      })
      push({ type: 'success', title: `${res.created} ${t('budget.projectDone')}` })
      load()
    } catch (e) {
      push({ type: 'error', title: e?.response?.data?.detail || t('common.error') })
    }
    setProjecting(false)
  }

  return (
    <div>
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-2">
          <div className="fiba-stat">
            <p className="text-xs text-fiba-muted">{t('budget.budgeted')}</p>
            <p className="text-2xl font-bold text-ink-900 dark:text-white">${money(summary.totals.budgeted)}</p>
          </div>
          <div className="fiba-stat">
            <p className="text-xs text-fiba-muted">{t('budget.committed')}</p>
            <p className="text-2xl font-bold text-blue-400">${money(summary.totals.committed)}</p>
          </div>
          <div className="fiba-stat">
            <p className="text-xs text-fiba-muted">{t('budget.executed')}</p>
            <p className="text-2xl font-bold text-emerald-400">${money(summary.totals.executed)}</p>
          </div>
          <div className="fiba-stat">
            <p className="text-xs text-fiba-muted">{t('budget.remaining')}</p>
            <p className={`text-2xl font-bold ${summary.totals.remaining < 0 ? 'text-red-500' : 'text-ink-900 dark:text-white'}`}>
              ${money(summary.totals.remaining)}
            </p>
          </div>
        </div>
      )}
      {summary && (
        <div className="mb-6 space-y-1">
          <p className="text-xs text-fiba-muted flex items-center gap-1.5">
            <Icon.Info className="w-3.5 h-3.5 flex-shrink-0" />
            {summary.excludes_person_payments ? t('budget.excludesPayments') : t('budget.includesPayments')}
          </p>
          {/* Los pagos sin departamento no entran en ningún total por área: se
              muestran para que se vea qué falta imputar, no para cuadrar. */}
          {summary.unallocated_payments > 0 && (
            <p className="text-xs text-amber-500 flex items-center gap-1.5"
              title={t('budget.unallocatedHint')}>
              <Icon.Alert className="w-3.5 h-3.5 flex-shrink-0" />
              {t('budget.unallocated')}: ${money(summary.unallocated_payments)}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="fiba-select !w-auto min-w-[100px]">
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={department} onChange={e => setDepartment(e.target.value)}
          className="fiba-select !w-auto min-w-[200px]">
          <option value="">{t('budget.allDepartments')}</option>
          {departments.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
        </select>

        <div className="inline-flex rounded-md border border-fiba-border overflow-hidden">
          {['matrix', 'list'].map(v => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                view === v ? 'bg-fiba-surface text-ink-900 dark:text-white' : 'text-fiba-muted hover:text-ink-900 dark:hover:text-white'
              }`}>
              {t(v === 'matrix' ? 'budget.viewMatrix' : 'budget.viewList')}
            </button>
          ))}
        </div>

        {canEdit && (
          <button onClick={() => setImporting(v => !v)} className="btn-fiba-ghost ml-auto">
            <Icon.Upload className="w-4 h-4 inline mr-1.5" />
            {t('budget.import')}
          </button>
        )}
        {canEdit && lines.length > 0 && (
          <button onClick={() => handleProject(false)} disabled={projecting}
            title={t('budget.projectHint')} className="btn-fiba-ghost">
            {projecting ? t('common.loading') : t('budget.project')}
          </button>
        )}
        {canEdit && (
          <button onClick={() => setEditingLine({})} className="btn-fiba">
            {t('budget.newLine')}
          </button>
        )}
      </div>

      {importing && (
        <BudgetImport
          year={year} department={department} competitions={competitions}
          t={t} push={push}
          onDone={load} onClose={() => setImporting(false)}
        />
      )}

      {loading ? (
        <div className="text-fiba-muted text-sm py-8 text-center">{t('common.loading')}</div>
      ) : lines.length === 0 ? (
        <div className="rounded-xl border border-fiba-border py-12 text-center">
          <p className="font-semibold text-ink-900 dark:text-white">{t('budget.noLines')}</p>
          <p className="text-fiba-muted text-sm mt-1 max-w-md mx-auto">{t('budget.noLinesBody')}</p>
        </div>
      ) : view === 'matrix' ? (
        <MatrixView
          lines={lines} competitions={competitions} expenseAccounts={expenseAccounts}
          department={department} canEdit={canEdit} t={t} push={push}
          onReload={load} onOpenCell={setCellDetail}
        />
      ) : (
        <ListView lines={lines} year={year} t={t} canEdit={canEdit} onEdit={setEditingLine} />
      )}

      {editingLine && (
        <BudgetLineEditor
          line={editingLine} year={year} defaultDepartment={department}
          onClose={() => setEditingLine(null)} onSaved={() => { setEditingLine(null); load() }}
          onDeleted={() => { setEditingLine(null); load() }}
          {...{ t, push, departments, expenseAccounts, competitions, canEdit }}
        />
      )}

      {cellDetail && (
        <Drawer
          title={cellDetail.accountLabel}
          subtitle={cellDetail.competitionName || t('budget.general')}
          onClose={() => setCellDetail(null)}
        >
          {cellDetail.lines.map(l => (
            <div key={l.id} className="flex items-center justify-between py-2 border-b border-fiba-border">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink-900 dark:text-white truncate">{l.description}</p>
                <p className="text-xs text-fiba-muted">{l.department_label}</p>
              </div>
              <span className="font-medium text-ink-900 dark:text-white ml-3">${money(l.amount)}</span>
              {canEdit && (
                <button onClick={() => { setCellDetail(null); setEditingLine(l) }}
                  className="ml-2 p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-ink-900 dark:hover:text-white">
                  <Icon.Doc className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </Drawer>
      )}
    </div>
  )
}

/** Matriz cuentas × competencias, con edición inline de celda. */
function MatrixView({ lines, competitions, expenseAccounts, department, canEdit, t, push, onReload, onOpenCell }) {
  const [extraRows, setExtraRows] = useState([])      // cuentas agregadas sin líneas todavía
  const [extraCols, setExtraCols] = useState([])      // competencias agregadas sin líneas
  const [editing, setEditing] = useState(null)        // 'account|colKey'
  const [draft, setDraft] = useState('')
  const [collapsed, setCollapsed] = useState(true)    // cuentas sin evento, plegadas

  // Editar una celda crea una línea, y una línea necesita departamento. Con
  // "todos" seleccionado la matriz es un consolidado de solo lectura.
  const editable = canEdit && !!department

  const accountRows = useMemo(() => {
    const used = [...new Set(lines.map(l => l.account_code))]
    const all = [...new Set([...used, ...extraRows])]
    const byCode = Object.fromEntries(expenseAccounts.map(a => [a.code, a]))
    return all
      .map(code => byCode[code] || { code, label: code })
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.code.localeCompare(b.code))
  }, [lines, extraRows, expenseAccounts])

  const cols = useMemo(() => {
    const used = [...new Set(lines.filter(l => l.competition_id).map(l => l.competition_id))]
    const ids = [...new Set([...used, ...extraCols])]
    const byId = Object.fromEntries(competitions.map(c => [c.id, c]))
    const comps = ids.map(id => byId[id] || { id, name: id })
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    return [{ id: GENERAL, name: t('budget.general') }, ...comps]
  }, [lines, extraCols, competitions, t])

  // { 'accountCode|colKey': [line, ...] }
  const cells = useMemo(() => {
    const map = {}
    for (const l of lines) {
      const key = `${l.account_code}|${l.competition_id || GENERAL}`
      ;(map[key] ||= []).push(l)
    }
    return map
  }, [lines])

  const cellTotal = (key) => (cells[key] || []).reduce((s, l) => s + Number(l.amount || 0), 0)
  const rowTotal = (code) => cols.reduce((s, c) => s + cellTotal(`${code}|${c.id}`), 0)
  const colTotal = (colId) => accountRows.reduce((s, a) => s + cellTotal(`${a.code}|${colId}`), 0)
  const grandTotal = accountRows.reduce((s, a) => s + rowTotal(a.code), 0)

  // Una cuenta sin ninguna celda de evento no aporta nada al cruce: su única
  // cifra es la de General. Mostrarla como fila entera de guiones es ruido —
  // en IT son 6 de 7 cuentas. Se agrupan y se pueden desplegar; su plata sigue
  // contando en los totales, que se calculan sobre accountRows.
  const hasEventCell = (code) => cols.some(c => c.id !== GENERAL && cellTotal(`${code}|${c.id}`) > 0)
  // Las agregadas a mano quedan siempre visibles: se agregaron para tipear.
  const visibleRows = accountRows.filter(a => hasEventCell(a.code) || extraRows.includes(a.code))
  const generalOnly = accountRows.filter(a => !visibleRows.includes(a))
  const rowsToRender = collapsed ? visibleRows : [...visibleRows, ...generalOnly]

  async function commitCell(account, col) {
    const key = `${account.code}|${col.id}`
    const existing = cells[key] || []
    const value = Number(draft || 0)
    setEditing(null)

    try {
      if (existing.length === 0) {
        if (value <= 0) return
        await createBudgetLine({
          year: lines[0]?.year ?? new Date().getFullYear(),
          department_code: department,
          account_code: account.code,
          competition_id: col.id === GENERAL ? null : col.id,
          description: account.label,
          amount: value,
        })
      } else if (existing.length === 1) {
        if (Number(existing[0].amount) === value) return
        // Vaciar la celda borra la línea: una línea en 0 ensucia el reporte
        // y no significa nada distinto de no tenerla.
        if (value <= 0) await deleteBudgetLine(existing[0].id)
        else await updateBudgetLine(existing[0].id, { amount: value })
      }
      onReload()
    } catch (e) {
      push({ type: 'error', title: e?.response?.data?.detail || t('common.error') })
    }
  }

  const availableAccounts = expenseAccounts.filter(a => !accountRows.some(r => r.code === a.code))
  const availableComps = competitions.filter(c => !cols.some(col => col.id === c.id))

  return (
    <div>
      <p className="text-xs text-fiba-muted mb-3 flex items-center gap-1.5">
        <Icon.Info className="w-3.5 h-3.5 flex-shrink-0" />
        {editable ? t('budget.matrixHint') : t('budget.matrixReadOnly')}
      </p>

      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-fiba-surface/60 border-b border-fiba-border">
              <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-fiba-muted">
                <th className="px-3 py-2.5 sticky left-0 bg-fiba-surface z-10 min-w-[220px]">
                  {t('budget.account')}
                </th>
                {cols.map(c => (
                  <th key={c.id} className="px-3 py-2.5 text-right min-w-[110px] max-w-[160px]">
                    <span className="block truncate" title={c.name}>{c.name}</span>
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right min-w-[110px]">{t('budget.total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fiba-border">
              {rowsToRender.map(a => (
                <tr key={a.code} className="hover:bg-fiba-surface/40 transition-colors">
                  <td className="px-3 py-2 sticky left-0 bg-fiba-card z-10">
                    <span className="text-ink-900 dark:text-white">{a.label}</span>
                    <span className="block text-2xs text-fiba-muted font-mono">
                      {a.code}{a.pending_mapping ? ' ·' : ''}
                    </span>
                  </td>
                  {cols.map(c => {
                    const key = `${a.code}|${c.id}`
                    const group = cells[key] || []
                    const total = cellTotal(key)
                    const isEditing = editing === key

                    if (group.length > 1) {
                      return (
                        <td key={c.id} className="px-3 py-2 text-right">
                          <button onClick={() => onOpenCell({
                            accountLabel: a.label,
                            competitionName: c.id === GENERAL ? null : c.name,
                            lines: group,
                          })} title={t('budget.cellMultiple')}
                            className="text-ink-900 dark:text-white hover:underline">
                            {money(total)}
                            <span className="block text-2xs text-fiba-muted">
                              {group.length} {t('budget.multipleLines')}
                            </span>
                          </button>
                        </td>
                      )
                    }

                    return (
                      <td key={c.id} className="px-3 py-2 text-right">
                        {isEditing ? (
                          <input
                            autoFocus type="number" step="0.01" min="0" value={draft}
                            onChange={e => setDraft(e.target.value)}
                            onBlur={() => commitCell(a, c)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') e.currentTarget.blur()
                              if (e.key === 'Escape') setEditing(null)
                            }}
                            className="fiba-input !h-7 text-right w-24 px-1"
                          />
                        ) : (
                          <button
                            disabled={!editable}
                            onClick={() => { setEditing(key); setDraft(total ? String(total) : '') }}
                            className={`w-full text-right ${
                              total ? 'text-ink-900 dark:text-white' : 'text-fiba-muted/40'
                            } ${editable ? 'hover:bg-fiba-surface rounded px-1' : 'cursor-default'}`}>
                            {total ? money(total) : '—'}
                          </button>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right font-semibold text-ink-900 dark:text-white">
                    {money(rowTotal(a.code))}
                  </td>
                </tr>
              ))}

              {/* Las cuentas que solo tienen General, plegadas en una fila. */}
              {generalOnly.length > 0 && collapsed && (
                <tr className="hover:bg-fiba-surface/40 transition-colors">
                  <td className="px-3 py-2 sticky left-0 bg-fiba-card z-10">
                    <button onClick={() => setCollapsed(false)}
                      className="text-left text-fiba-muted hover:text-ink-900 dark:hover:text-white inline-flex items-center gap-1.5">
                      <Icon.Chevron className="w-3.5 h-3.5" />
                      <span>
                        {t('budget.generalOnlyRows', { n: generalOnly.length })}
                        <span className="block text-2xs text-fiba-muted/70">{t('budget.generalOnlyHint')}</span>
                      </span>
                    </button>
                  </td>
                  {cols.map(c => (
                    <td key={c.id} className="px-3 py-2 text-right text-fiba-muted">
                      {c.id === GENERAL
                        ? money(generalOnly.reduce((s, a) => s + cellTotal(`${a.code}|${GENERAL}`), 0))
                        : '—'}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-semibold text-fiba-muted">
                    {money(generalOnly.reduce((s, a) => s + rowTotal(a.code), 0))}
                  </td>
                </tr>
              )}
              {generalOnly.length > 0 && !collapsed && (
                <tr>
                  <td colSpan={cols.length + 2} className="px-3 py-1.5 sticky left-0">
                    <button onClick={() => setCollapsed(true)}
                      className="text-xs text-fiba-muted hover:text-ink-900 dark:hover:text-white inline-flex items-center gap-1.5">
                      <Icon.ChevronDown className="w-3.5 h-3.5" /> {t('budget.collapseRows')}
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot className="border-t-2 border-fiba-border bg-fiba-surface/60">
              <tr className="font-semibold">
                <td className="px-3 py-2.5 sticky left-0 bg-fiba-surface z-10 text-ink-900 dark:text-white">
                  {t('budget.total')}
                </td>
                {cols.map(c => (
                  <td key={c.id} className="px-3 py-2.5 text-right text-ink-900 dark:text-white">
                    {money(colTotal(c.id))}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-right text-ink-900 dark:text-white">{money(grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {editable && (
        <div className="flex flex-wrap gap-3 mt-4">
          <select value="" onChange={e => e.target.value && setExtraRows(r => [...r, e.target.value])}
            className="fiba-select !w-auto min-w-[220px]">
            <option value="">+ {t('budget.addRow')}</option>
            <AccountOptions accounts={availableAccounts} department={department} t={t} />
          </select>
          <select value="" onChange={e => e.target.value && setExtraCols(c => [...c, e.target.value])}
            className="fiba-select !w-auto min-w-[220px]">
            <option value="">+ {t('budget.addColumn')}</option>
            {availableComps.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

/** Lista agrupada por cuenta con subtotales — la forma del presupuesto de IT. */
function ListView({ lines, year, t, canEdit, onEdit }) {
  const groups = useMemo(() => {
    const map = new Map()
    for (const l of lines) {
      if (!map.has(l.account_code)) {
        map.set(l.account_code, { code: l.account_code, label: l.account_label || l.account_code, lines: [] })
      }
      map.get(l.account_code).lines.push(l)
    }
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code))
  }, [lines])

  const grandTotal = lines.reduce((s, l) => s + Number(l.amount || 0), 0)

  return (
    <div className="rounded-xl border border-fiba-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-fiba-surface/60 border-b border-fiba-border">
            <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-fiba-muted">
              <th className="px-4 py-2.5">{t('budget.lineDescription')}</th>
              <th className="px-4 py-2.5">{t('budget.competition')}</th>
              <th className="px-4 py-2.5 text-right">{t('budget.qty')}</th>
              <th className="px-4 py-2.5 text-right">{t('budget.monthly')}</th>
              <th className="px-4 py-2.5 text-right">{year}</th>
              <th className="px-4 py-2.5 text-right">{t('budget.escalation')}</th>
              <th className="px-4 py-2.5 text-right">{t('budget.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-fiba-border">
            {groups.map(g => (
              <Fragment key={g.code}>
                <tr className="bg-fiba-surface/30">
                  <td colSpan={7} className="px-4 py-2 font-semibold text-ink-900 dark:text-white">
                    <span className="font-mono text-xs text-fiba-muted mr-2">{g.code}</span>{g.label}
                  </td>
                </tr>
                {g.lines.map(l => (
                  <tr key={l.id} className="hover:bg-fiba-surface/40 transition-colors">
                    <td className="px-4 py-2.5 pl-8 text-ink-900 dark:text-white">{l.description}</td>
                    <td className="px-4 py-2.5 text-fiba-muted">
                      {l.competition_name || <span className="italic">{t('budget.general')}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right text-fiba-muted">{l.qty ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right text-fiba-muted">
                      {l.monthly_amount ? money(l.monthly_amount) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-ink-900 dark:text-white">
                      {money(l.amount)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-fiba-muted">
                      {(Number(l.escalation_pct || 0) * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {canEdit && (
                        <button onClick={() => onEdit(l)}
                          className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-ink-900 dark:hover:text-white">
                          <Icon.Doc className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-fiba-border">
                  <td colSpan={4} className="px-4 py-2 text-right text-xs font-semibold text-fiba-muted uppercase">
                    {t('budget.subtotal')}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold text-ink-900 dark:text-white">
                    {money(g.lines.reduce((s, l) => s + Number(l.amount || 0), 0))}
                  </td>
                  <td colSpan={2} />
                </tr>
              </Fragment>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-fiba-border bg-fiba-surface/60">
            <tr className="font-semibold">
              <td colSpan={4} className="px-4 py-2.5 text-right text-ink-900 dark:text-white">
                {t('budget.total')}
              </td>
              <td className="px-4 py-2.5 text-right text-ink-900 dark:text-white">{money(grandTotal)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
