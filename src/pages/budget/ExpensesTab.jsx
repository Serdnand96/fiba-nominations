import { useEffect, useMemo, useState } from 'react'
import { getExpenses, getExpensesSummary, approveExpense, deleteExpense } from '../../api/client'
import { useOpenParam } from '../../components/ui/Drawer'
import { Icon } from '../../lib/icons'
import { competitionLabel } from '../../lib/competitions'
import ExpenseEditor from './editors/ExpenseEditor'
import { money, accountOption, useDepartmentAccounts, EXPENSE_STATUSES, STATUS_BADGE } from './shared'

/* ──────────────────────────── Gastos ──────────────────────────── */
export default function ExpensesTab({ t, push, canEdit, departments, expenseAccounts, competitions, vendors, employees }) {
  const thisYear = new Date().getFullYear()
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState({ paid: 0, committed: 0, draft: 0, total: 0, count: 0 })
  const [loading, setLoading] = useState(true)

  const [year, setYear] = useState(thisYear)
  const [department, setDepartment] = useState('')
  const [account, setAccount] = useState('')
  const [competition, setCompetition] = useState('')   // '' | 'general' | <uuid>
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')

  const [editing, setEditing] = useState(null)
  // `?open=<id>` abre el gasto en el editor (links de notificaciones). Solo si
  // está en la lista cargada con los filtros actuales; si no, se descarta.
  const [openId, setOpenId] = useOpenParam()

  const accountOptions = useDepartmentAccounts(expenseAccounts, department, account, setAccount)

  const yearOptions = useMemo(
    () => Array.from({ length: 6 }, (_, i) => thisYear + 1 - i),
    [thisYear],
  )

  const params = useMemo(() => {
    const p = { year }
    if (department) p.department = department
    if (account) p.account = account
    if (status) p.status = status
    if (search) p.search = search
    if (competition === 'general') p.general_only = true
    else if (competition) p.competition_id = competition
    return p
  }, [year, department, account, status, search, competition])

  async function load() {
    setLoading(true)
    try {
      // El summary no recibe `search`: los totales del encabezado son del
      // filtro, no del texto tipeado — si no, cambian mientras se escribe.
      const { search: _omit, ...sumParams } = params
      const [list, sum] = await Promise.all([getExpenses(params), getExpensesSummary(sumParams)])
      setRows(list)
      setSummary(sum)
    } catch (e) {
      console.error(e)
      push({ type: 'error', title: t('common.error') })
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [params])

  useEffect(() => {
    if (loading || !openId) return
    if (editing?.id && String(editing.id) === openId) return
    // Sin edición el editor no se abre desde la bandeja; tampoco desde la URL.
    const row = canEdit ? rows.find(r => String(r.id) === openId) : null
    if (row) setEditing(row)
    else setOpenId(null)
  }, [openId, rows, loading])

  function openEditor(row) {
    setEditing(row)
    setOpenId(row.id || null)
  }

  function closeEditor() {
    setEditing(null)
    setOpenId(null)
  }

  async function handleApprove(row) {
    try {
      await approveExpense(row.id)
      push({ type: 'success', title: t('budget.approved') })
      load()
    } catch (e) {
      push({ type: 'error', title: e?.response?.data?.detail || t('common.error') })
    }
  }

  async function handleDelete(row) {
    if (!window.confirm(t('budget.confirmDelete'))) return
    try {
      await deleteExpense(row.id)
      push({ type: 'success', title: t('budget.deleted') })
      load()
    } catch (e) {
      push({ type: 'error', title: e?.response?.data?.detail || t('common.error') })
    }
  }

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="fiba-stat" title={t('budget.executedHint')}>
          <p className="text-xs text-fiba-muted">{t('budget.executed')}</p>
          <p className="text-2xl font-bold text-emerald-400">${money(summary.paid)}</p>
        </div>
        <div className="fiba-stat" title={t('budget.executedHint')}>
          <p className="text-xs text-fiba-muted">{t('budget.committed')}</p>
          <p className="text-2xl font-bold text-blue-400">${money(summary.committed)}</p>
        </div>
        <div className="fiba-stat">
          <p className="text-xs text-fiba-muted">{t('budget.draftTotal')}</p>
          <p className="text-2xl font-bold text-ink-900 dark:text-white">${money(summary.draft)}</p>
        </div>
        <div className="fiba-stat">
          <p className="text-xs text-fiba-muted">{t('budget.total')}</p>
          <p className="text-2xl font-bold text-ink-900 dark:text-white">${money(summary.total)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input type="text" placeholder={t('budget.search')} value={search}
          onChange={e => setSearch(e.target.value)} className="fiba-input w-full md:w-72" />
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="fiba-select !w-auto min-w-[100px] flex-shrink-0">
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={department} onChange={e => setDepartment(e.target.value)}
          className="fiba-select !w-auto min-w-[180px] flex-shrink-0">
          <option value="">{t('budget.allDepartments')}</option>
          {departments.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
        </select>
        <select value={account} onChange={e => setAccount(e.target.value)}
          className="fiba-select !w-auto min-w-[200px] flex-shrink-0">
          <option value="">{department ? t('budget.allAccountsOfDepartment') : t('budget.allAccounts')}</option>
          {accountOptions.map(accountOption)}
        </select>
        <select value={competition} onChange={e => setCompetition(e.target.value)}
          className="fiba-select !w-auto min-w-[200px] flex-shrink-0">
          <option value="">{t('budget.allEvents')}</option>
          <option value="general">{t('budget.generalOnly')}</option>
          {competitions.map(c => <option key={c.id} value={c.id}>{competitionLabel(c, t('months.short'))}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="fiba-select !w-auto min-w-[150px] flex-shrink-0">
          <option value="">{t('budget.allStatuses')}</option>
          {EXPENSE_STATUSES.map(s => <option key={s} value={s}>{t(`budget.st_${s}`)}</option>)}
        </select>
        {canEdit && (
          <button onClick={() => openEditor({})} className="btn-fiba ml-auto">{t('budget.newExpense')}</button>
        )}
      </div>

      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-fiba-surface/60 border-b border-fiba-border">
              <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-fiba-muted">
                <th className="px-4 py-2.5">#</th>
                <th className="px-4 py-2.5">{t('budget.description')}</th>
                <th className="px-4 py-2.5">{t('budget.department')}</th>
                <th className="px-4 py-2.5">{t('budget.account')}</th>
                <th className="px-4 py-2.5">{t('budget.competition')}</th>
                <th className="px-4 py-2.5">{t('budget.payee')}</th>
                <th className="px-4 py-2.5">{t('budget.date')}</th>
                <th className="px-4 py-2.5 text-right">{t('budget.amount')}</th>
                <th className="px-4 py-2.5">{t('budget.status')}</th>
                <th className="px-4 py-2.5 text-right">{t('budget.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fiba-border">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-fiba-muted">{t('common.loading')}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center">
                  <p className="font-semibold text-ink-900 dark:text-white">{t('budget.noExpenses')}</p>
                  <p className="text-fiba-muted text-sm mt-1 max-w-md mx-auto">{t('budget.noExpensesBody')}</p>
                </td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className="hover:bg-fiba-surface/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-fiba-muted">{r.record_no}</td>
                  <td className="px-4 py-3 text-ink-900 dark:text-white">{r.description}</td>
                  <td className="px-4 py-3 text-fiba-muted">{r.department_label || r.department_code}</td>
                  <td className="px-4 py-3 text-fiba-muted text-xs">{r.account_code}</td>
                  <td className="px-4 py-3 text-fiba-muted">
                    {r.competition_name || <span className="italic">{t('budget.general')}</span>}
                  </td>
                  <td className="px-4 py-3 text-fiba-muted">{r.payee_display || '—'}</td>
                  <td className="px-4 py-3 text-fiba-muted whitespace-nowrap">{r.expense_date}</td>
                  <td className="px-4 py-3 text-right font-medium text-ink-900 dark:text-white whitespace-nowrap">
                    ${money(r.amount)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[r.status]}`}>
                      {t(`budget.st_${r.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {canEdit && (
                      <div className="inline-flex gap-1">
                        {r.status === 'draft' && (
                          <button onClick={() => handleApprove(r)} title={t('budget.approve')}
                            className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-emerald-500">
                            <Icon.Check className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => openEditor(r)} title={t('budget.editExpense')}
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
        <ExpenseEditor expense={editing} onClose={closeEditor} onSaved={() => { closeEditor(); load() }}
          {...{ t, push, canEdit, departments, expenseAccounts, competitions, vendors, employees }} />
      )}
    </div>
  )
}
