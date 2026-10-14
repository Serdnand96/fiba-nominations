import { useEffect, useMemo, useState } from 'react'
import { getRevenues, deleteRevenue } from '../../api/client'
import { Icon } from '../../lib/icons'
import RevenueEditor from './editors/RevenueEditor'
import { useBudgetScope } from './scope'
import { money, STATUS_BADGE } from './shared'

// A qué año se imputa un ingreso — la misma regla que `_revenue_year()` del
// backend para /summary: recibido → fecha de cobro, esperado → fecha esperada,
// cancelado o sin fecha → a ninguno.
function revenueYear(r) {
  const d = r.status === 'received' ? r.received_date
    : r.status === 'expected' ? r.expected_date
    : null
  return d ? Number(String(d).slice(0, 4)) : null
}

// Sin fecha y no cancelado: no entra en el resumen de ningún año.
const isUndated = (r) => r.status !== 'cancelled' && revenueYear(r) == null

/* ──────────────────────────── Ingresos ──────────────────────────── */
export default function RevenuesTab({ t, push, canEdit, departments, revenueAccounts, competitions }) {
  const scope = useBudgetScope()
  const thisYear = new Date().getFullYear()
  const [all, setAll] = useState([])
  const [year, setYear] = useState(thisYear)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)

  const yearOptions = useMemo(() => Array.from({ length: 6 }, (_, i) => thisYear + 1 - i), [thisYear])

  const editableDepartments = useMemo(
    () => (canEdit ? departments.filter(d => scope.canEditDept(d.code)) : []),
    [canEdit, departments, scope],
  )
  const canEditRow = (code) => canEdit && scope.canEditDept(code)

  // Se pide sin año y se filtra acá: con `?year=` el backend descarta los que
  // no tienen fecha, que son justamente los que hay que mostrar en ámbar.
  async function load() {
    setLoading(true)
    try { setAll(await getRevenues()) }
    catch (e) { console.error(e); push({ type: 'error', title: t('common.error') }) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Los sin fecha van arriba en cualquier año que se mire: no pertenecen a
  // ninguno y si no se ven nunca se completan.
  const undated = useMemo(() => all.filter(isUndated), [all])
  const rows = useMemo(() => {
    const inYear = all.filter(r => {
      const d = r.received_date || r.expected_date
      return d && String(d).slice(0, 4) === String(year)
    })
    return [...undated, ...inYear]
  }, [all, undated, year])

  // Los totales siguen la regla del summary: solo lo imputado a este año.
  const totals = useMemo(() => {
    const own = all.filter(r => revenueYear(r) === year)
    return {
      received: own.filter(r => r.status === 'received').reduce((s, r) => s + Number(r.amount || 0), 0),
      expected: own.filter(r => r.status === 'expected').reduce((s, r) => s + Number(r.amount || 0), 0),
    }
  }, [all, year])

  async function handleDelete(row) {
    if (!window.confirm(t('budget.confirmDelete'))) return
    try { await deleteRevenue(row.id); push({ type: 'success', title: t('budget.deleted') }); load() }
    catch (e) { push({ type: 'error', title: e?.response?.data?.detail || t('common.error') }) }
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="fiba-stat">
          <p className="text-xs text-fiba-muted">{t('budget.st_received')}</p>
          <p className="text-2xl font-bold text-emerald-400">${money(totals.received)}</p>
        </div>
        <div className="fiba-stat">
          <p className="text-xs text-fiba-muted">{t('budget.st_expected')}</p>
          <p className="text-2xl font-bold text-yellow-500">${money(totals.expected)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="fiba-select !w-auto min-w-[100px]">
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {editableDepartments.length > 0 && (
          <button onClick={() => setEditing({})} className="btn-fiba ml-auto">{t('budget.newRevenue')}</button>
        )}
      </div>

      {undated.length > 0 && (
        <p className="text-xs text-amber-500 mb-3 flex items-start gap-1.5">
          <Icon.Alert className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          {t('budget.revenueNoDateHint', { n: undated.length })}
        </p>
      )}

      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-fiba-surface/60 border-b border-fiba-border">
              <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-fiba-muted">
                <th className="px-4 py-2.5">{t('budget.sourceName')}</th>
                <th className="px-4 py-2.5">{t('budget.department')}</th>
                <th className="px-4 py-2.5">{t('budget.competition')}</th>
                <th className="px-4 py-2.5">{t('budget.date')}</th>
                <th className="px-4 py-2.5 text-right">{t('budget.amount')}</th>
                <th className="px-4 py-2.5">{t('budget.status')}</th>
                <th className="px-4 py-2.5 text-right">{t('budget.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fiba-border">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-fiba-muted">{t('common.loading')}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center">
                  <p className="font-semibold text-ink-900 dark:text-white">{t('budget.noRevenues')}</p>
                  <p className="text-fiba-muted text-sm mt-1">{t('budget.noRevenuesBody')}</p>
                </td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className={`transition-colors ${
                  isUndated(r) ? 'bg-amber-500/5 hover:bg-amber-500/10' : 'hover:bg-fiba-surface/50'
                }`}>
                  <td className="px-4 py-3 text-ink-900 dark:text-white">{r.source_name}</td>
                  <td className="px-4 py-3 text-fiba-muted">{r.department_label || r.department_code}</td>
                  <td className="px-4 py-3 text-fiba-muted">
                    {r.competition_name || <span className="italic">{t('budget.general')}</span>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {isUndated(r) ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-500">
                        <Icon.Alert className="w-3.5 h-3.5" /> {t('budget.revenueNoDate')}
                      </span>
                    ) : (
                      <span className="text-fiba-muted">{r.received_date || r.expected_date || '—'}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-ink-900 dark:text-white">${money(r.amount)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[r.status] || ''}`}>
                      {t(`budget.st_${r.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {canEditRow(r.department_code) && (
                      <div className="inline-flex gap-1">
                        <button onClick={() => setEditing(r)}
                          className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-ink-900 dark:hover:text-white">
                          <Icon.Doc className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(r)}
                          className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-red-500">
                          <Icon.X className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <RevenueEditor revenue={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
          departments={editableDepartments}
          {...{ t, push, revenueAccounts, competitions }} />
      )}
    </div>
  )
}
