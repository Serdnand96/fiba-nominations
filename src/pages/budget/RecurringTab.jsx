import { useEffect, useState } from 'react'
import { getRecurring, deleteRecurring, getPendingRecurring, generateRecurring } from '../../api/client'
import { Icon } from '../../lib/icons'
import RecurringEditor from './editors/RecurringEditor'
import { money, currentPeriod } from './shared'

/* ──────────────────────────── Recurrentes ──────────────────────────── */
export default function RecurringTab({ t, push, canEdit, departments, expenseAccounts, vendors }) {
  const [rows, setRows] = useState([])
  const [pending, setPending] = useState([])
  const [period, setPeriod] = useState(currentPeriod())
  const [selected, setSelected] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const [list, pend] = await Promise.all([getRecurring(), getPendingRecurring(period)])
      setRows(list)
      setPending(pend)
      setSelected(pend.map(p => p.recurring_id))   // por defecto, todos marcados
    } catch (e) {
      console.error(e)
      push({ type: 'error', title: t('common.error') })
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [period])

  async function handleGenerate() {
    const items = pending.filter(p => selected.includes(p.recurring_id))
      .map(p => ({ recurring_id: p.recurring_id, period: p.period }))
    if (!items.length) return
    try {
      const res = await generateRecurring(items)
      push({ type: 'success', title: `${res.created.length} ${t('budget.generated')}` })
      load()
    } catch (e) {
      push({ type: 'error', title: e?.response?.data?.detail || t('common.error') })
    }
  }

  async function handleDelete(row) {
    if (!window.confirm(t('budget.confirmDelete'))) return
    try {
      const res = await deleteRecurring(row.id)
      push({ type: 'success', title: res.deactivated ? t('budget.recurringDeactivated') : t('budget.deleted') })
      load()
    } catch (e) {
      push({ type: 'error', title: e?.response?.data?.detail || t('common.error') })
    }
  }

  return (
    <div>
      <div className="rounded-xl border border-fiba-border p-5 mb-6 bg-fiba-surface/40">
        <div className="flex flex-wrap items-center gap-3 mb-1">
          <h3 className="font-semibold text-ink-900 dark:text-white">{t('budget.pendingThisMonth')}</h3>
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
            className="fiba-input !w-auto" />
          {canEdit && pending.length > 0 && (
            <button onClick={handleGenerate} className="btn-fiba ml-auto">
              {t('budget.confirmSelected')} ({selected.length})
            </button>
          )}
        </div>
        <p className="text-xs text-fiba-muted mb-3">{t('budget.pendingHint')}</p>

        {pending.length === 0 ? (
          <p className="text-sm text-fiba-muted">{t('budget.nothingPending')}</p>
        ) : pending.map(p => (
          <label key={p.recurring_id} className="flex items-center gap-3 py-1.5 text-sm cursor-pointer">
            <input type="checkbox" checked={selected.includes(p.recurring_id)}
              onChange={() => setSelected(s => s.includes(p.recurring_id)
                ? s.filter(x => x !== p.recurring_id)
                : [...s, p.recurring_id])}
              className="rounded border-ink-300" />
            <span className="text-ink-900 dark:text-white flex-1">{p.description}</span>
            <span className="text-fiba-muted text-xs">{p.department_label} · {p.account_code}</span>
            <span className="font-medium text-ink-900 dark:text-white">${money(p.amount)}</span>
          </label>
        ))}
      </div>

      <div className="flex justify-end mb-4">
        {canEdit && <button onClick={() => setEditing({})} className="btn-fiba">{t('budget.newRecurring')}</button>}
      </div>

      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-fiba-surface/60 border-b border-fiba-border">
              <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-fiba-muted">
                <th className="px-4 py-2.5">{t('budget.description')}</th>
                <th className="px-4 py-2.5">{t('budget.department')}</th>
                <th className="px-4 py-2.5">{t('budget.account')}</th>
                <th className="px-4 py-2.5">{t('budget.payeeVendor')}</th>
                <th className="px-4 py-2.5">{t('budget.frequency')}</th>
                <th className="px-4 py-2.5 text-right">{t('budget.amount')}</th>
                <th className="px-4 py-2.5 text-right">{t('budget.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fiba-border">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-fiba-muted">{t('common.loading')}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center">
                  <p className="font-semibold text-ink-900 dark:text-white">{t('budget.noRecurring')}</p>
                  <p className="text-fiba-muted text-sm mt-1 max-w-md mx-auto">{t('budget.noRecurringBody')}</p>
                </td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className="hover:bg-fiba-surface/50 transition-colors">
                  <td className="px-4 py-3 text-ink-900 dark:text-white">{r.description}</td>
                  <td className="px-4 py-3 text-fiba-muted">{r.department_label || r.department_code}</td>
                  <td className="px-4 py-3 text-fiba-muted text-xs">{r.account_code}</td>
                  <td className="px-4 py-3 text-fiba-muted">{r.vendor_name || '—'}</td>
                  <td className="px-4 py-3 text-fiba-muted">{t(`budget.fq_${r.frequency}`)}</td>
                  <td className="px-4 py-3 text-right font-medium text-ink-900 dark:text-white">${money(r.amount)}</td>
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
        <RecurringEditor recurring={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
          {...{ t, push, departments, expenseAccounts, vendors }} />
      )}
    </div>
  )
}
