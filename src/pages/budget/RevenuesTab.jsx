import { useEffect, useMemo, useState } from 'react'
import { getRevenues, deleteRevenue } from '../../api/client'
import { Icon } from '../../lib/icons'
import RevenueEditor from './editors/RevenueEditor'
import { money, STATUS_BADGE } from './shared'

/* ──────────────────────────── Ingresos ──────────────────────────── */
export default function RevenuesTab({ t, push, canEdit, departments, revenueAccounts, competitions }) {
  const thisYear = new Date().getFullYear()
  const [rows, setRows] = useState([])
  const [year, setYear] = useState(thisYear)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)

  const yearOptions = useMemo(() => Array.from({ length: 6 }, (_, i) => thisYear + 1 - i), [thisYear])

  async function load() {
    setLoading(true)
    try { setRows(await getRevenues({ year })) }
    catch (e) { console.error(e); push({ type: 'error', title: t('common.error') }) }
    setLoading(false)
  }

  useEffect(() => { load() }, [year])

  const totals = useMemo(() => ({
    received: rows.filter(r => r.status === 'received').reduce((s, r) => s + Number(r.amount || 0), 0),
    expected: rows.filter(r => r.status === 'expected').reduce((s, r) => s + Number(r.amount || 0), 0),
  }), [rows])

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
        {canEdit && <button onClick={() => setEditing({})} className="btn-fiba ml-auto">{t('budget.newRevenue')}</button>}
      </div>

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
                <tr key={r.id} className="hover:bg-fiba-surface/50 transition-colors">
                  <td className="px-4 py-3 text-ink-900 dark:text-white">{r.source_name}</td>
                  <td className="px-4 py-3 text-fiba-muted">{r.department_label || r.department_code}</td>
                  <td className="px-4 py-3 text-fiba-muted">
                    {r.competition_name || <span className="italic">{t('budget.general')}</span>}
                  </td>
                  <td className="px-4 py-3 text-fiba-muted whitespace-nowrap">
                    {r.received_date || r.expected_date || '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-ink-900 dark:text-white">${money(r.amount)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[r.status] || ''}`}>
                      {t(`budget.st_${r.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {canEdit && (
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
          {...{ t, push, departments, revenueAccounts, competitions }} />
      )}
    </div>
  )
}
