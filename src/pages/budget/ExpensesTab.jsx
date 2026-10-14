import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getExpenses, getExpensesSummary, deleteExpense } from '../../api/client'
import { useOpenParam } from '../../components/ui/Drawer'
import { useAuth } from '../../contexts/AuthContext'
import { Icon } from '../../lib/icons'
import { competitionLabel } from '../../lib/competitions'
import ExpenseEditor from './editors/ExpenseEditor'
import { ExpenseActionButtons, errorDetail, expenseActions, useExpenseTransitions } from './ExpenseActionModals'
import { useBudgetScope } from './scope'
import { money, accountOption, useDepartmentAccounts, EXPENSE_STATUSES, STATUS_BADGE } from './shared'

// Vistas de la bandeja. `pending` = lo que el usuario puede aprobar (el backend
// ya excluye lo propio); `mine` = lo que cargó él.
const VIEWS = ['all', 'pending', 'mine']
// Estados que el backend deja borrar. Lo aprobado o pagado se reabre o anula.
const DELETABLE = new Set(['draft', 'rejected', 'cancelled'])

/* ──────────────────────────── Gastos ──────────────────────────── */
export default function ExpensesTab({ t, push, canEdit, departments, expenseAccounts, competitions, vendors, employees }) {
  const scope = useBudgetScope()
  const { user } = useAuth()
  const userId = user?.id

  const thisYear = new Date().getFullYear()
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState({ paid: 0, committed: 0, draft: 0, total: 0, count: 0 })
  const [loading, setLoading] = useState(true)
  const [pendingCount, setPendingCount] = useState(null)

  // La vista arranca de `?status=` para que los links de la campana
  // (`/budget?tab=expenses&status=pending_approval`) abran la bandeja correcta.
  const [searchParams, setSearchParams] = useSearchParams()
  const initialView = searchParams.get('status') === 'pending_approval' ? 'pending'
    : searchParams.get('status') === 'mine' ? 'mine' : 'all'
  const [view, setViewState] = useState(initialView)
  const setView = (v) => {
    setViewState(v)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (v === 'pending') next.set('status', 'pending_approval')
      else if (v === 'mine') next.set('status', 'mine')
      else next.delete('status')
      return next
    }, { replace: true })
  }
  const [year, setYear] = useState(thisYear)
  const [department, setDepartment] = useState('')
  const [account, setAccount] = useState('')
  const [competition, setCompetition] = useState('')   // '' | 'general' | <uuid>
  const [status, setStatus] = useState('')
  const [vendor, setVendor] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
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

  // Derechos por departamento (scope) además del permiso de módulo. Solo UX:
  // el backend revalida cada alta, edición, borrado y transición.
  const canApproveAny = scope.isSuperadmin || scope.approve === null || scope.approve.length > 0
  const canCreate = canEdit && (scope.isSuperadmin || scope.edit === null || scope.edit.length > 0)
  const hasDates = !!(dateFrom || dateTo)
  const isPending = view === 'pending'

  const params = useMemo(() => {
    const p = {}
    if (department) p.department = department
    if (account) p.account = account
    if (vendor) p.vendor_id = vendor
    if (search) p.search = search
    if (competition === 'general') p.general_only = true
    else if (competition) p.competition_id = competition
    if (isPending) {
      // La bandeja de pendientes es una cola, no un período: todos los años.
      p.status = 'pending_approval'
      return p
    }
    if (status) p.status = status
    if (view === 'mine') p.mine = 1
    // Con rango de fechas no se manda el año: el backend usa el año solo en el
    // extremo que falte, y mezclar los dos da rangos difíciles de leer.
    if (hasDates) {
      if (dateFrom) p.date_from = dateFrom
      if (dateTo) p.date_to = dateTo
    } else {
      p.year = year
    }
    return p
  }, [view, isPending, year, department, account, vendor, status, search, competition, hasDates, dateFrom, dateTo])

  // Los totales del encabezado son del período y del recorte por departamento,
  // cuenta y evento — no del texto tipeado, la vista, el estado ni el proveedor.
  const summaryParams = useMemo(() => {
    const p = {}
    if (hasDates) {
      if (dateFrom) p.date_from = dateFrom
      if (dateTo) p.date_to = dateTo
    } else {
      p.year = year
    }
    if (department) p.department = department
    if (account) p.account = account
    if (competition === 'general') p.general_only = true
    else if (competition) p.competition_id = competition
    return p
  }, [year, hasDates, dateFrom, dateTo, department, account, competition])

  async function load() {
    setLoading(true)
    try {
      const [list, sum] = await Promise.all([getExpenses(params), getExpensesSummary(summaryParams)])
      setRows(list)
      setSummary(sum)
    } catch (e) {
      console.error(e)
      push({ type: 'error', title: t('common.error') })
    }
    setLoading(false)
  }

  // El contador del chip no lleva filtros: es "cuánto me espera", total.
  async function loadPendingCount() {
    if (!canApproveAny) { setPendingCount(null); return }
    try {
      const list = await getExpenses({ status: 'pending_approval' })
      setPendingCount(Array.isArray(list) ? list.length : 0)
    } catch (e) {
      console.error(e)
      setPendingCount(null)
    }
  }

  useEffect(() => { load() }, [params, summaryParams])
  useEffect(() => { loadPendingCount() }, [canApproveAny])

  function reloadAll() {
    load()
    loadPendingCount()
  }

  useEffect(() => {
    if (loading || !openId) return
    if (editing?.id && String(editing.id) === openId) return
    // El detalle se abre para cualquiera con vista: el aprobador que llega por
    // una notificación lo necesita, aunque no edite el departamento.
    const row = rows.find(r => String(r.id) === openId)
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

  const { run, dialog, busyId } = useExpenseTransitions({ t, push, onDone: reloadAll })

  async function handleDelete(row) {
    if (!window.confirm(t('budget.confirmDelete'))) return
    try {
      await deleteExpense(row.id)
      push({ type: 'success', title: t('budget.deleted') })
      reloadAll()
    } catch (e) {
      push({ type: 'error', title: errorDetail(e, t) })
    }
  }

  const views = VIEWS.filter(v => v !== 'pending' || canApproveAny)
  const viewLabel = {
    all: t('budget.approvalViewAll'),
    pending: t('budget.approvalViewPending'),
    mine: t('budget.approvalViewMine'),
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

      {/* Vistas: todos / pendientes de aprobación / mis gastos */}
      <div role="group" aria-label={t('budget.approvalViewsLabel')} className="flex flex-wrap items-center gap-2 mb-4">
        {views.map(v => {
          const active = view === v
          const count = v === 'pending' ? pendingCount : null
          return (
            <button key={v} type="button" aria-pressed={active} onClick={() => setView(v)}
              className={`inline-flex items-center gap-2 h-8 px-3 rounded-full border text-[13px] font-medium transition-colors ${
                active
                  ? 'bg-navy-900 text-white border-navy-900 dark:bg-white dark:text-navy-900 dark:border-white'
                  : 'bg-white text-ink-700 border-ink-200 hover:bg-ink-50 dark:bg-navy-900 dark:text-ink-200 dark:border-navy-700 dark:hover:bg-navy-800'
              }`}>
              {viewLabel[v]}
              {count != null && (
                <span className={`min-w-[20px] h-5 px-1.5 inline-flex items-center justify-center rounded-full text-2xs font-semibold tabular-nums ${
                  count > 0
                    ? 'bg-warning-100 text-warning-700 dark:bg-warning-500/20 dark:text-warning-500'
                    : 'bg-ink-100 text-ink-500 dark:bg-navy-800 dark:text-ink-400'
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input type="text" placeholder={t('budget.search')} value={search}
          onChange={e => setSearch(e.target.value)} className="fiba-input w-full md:w-72" />
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          disabled={isPending || hasDates}
          title={isPending ? t('budget.approvalPendingAllYears') : hasDates ? t('budget.expenseFilterDatesOverrideYear') : undefined}
          aria-label={t('budget.year')}
          className="fiba-select !w-auto min-w-[100px] flex-shrink-0 disabled:opacity-50">
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={department} onChange={e => setDepartment(e.target.value)}
          aria-label={t('budget.department')}
          className="fiba-select !w-auto min-w-[180px] flex-shrink-0">
          <option value="">{t('budget.allDepartments')}</option>
          {departments.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
        </select>
        <select value={account} onChange={e => setAccount(e.target.value)}
          aria-label={t('budget.account')}
          className="fiba-select !w-auto min-w-[200px] flex-shrink-0">
          <option value="">{department ? t('budget.allAccountsOfDepartment') : t('budget.allAccounts')}</option>
          {accountOptions.map(accountOption)}
        </select>
        <select value={competition} onChange={e => setCompetition(e.target.value)}
          aria-label={t('budget.competition')}
          className="fiba-select !w-auto min-w-[200px] flex-shrink-0">
          <option value="">{t('budget.allEvents')}</option>
          <option value="general">{t('budget.generalOnly')}</option>
          {competitions.map(c => <option key={c.id} value={c.id}>{competitionLabel(c, t('months.short'))}</option>)}
        </select>
        <select value={vendor} onChange={e => setVendor(e.target.value)}
          aria-label={t('budget.payeeVendor')}
          className="fiba-select !w-auto min-w-[180px] flex-shrink-0">
          <option value="">{t('budget.expenseFilterVendor')}</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <select value={isPending ? '' : status} onChange={e => setStatus(e.target.value)}
          disabled={isPending}
          aria-label={t('budget.status')}
          className="fiba-select !w-auto min-w-[150px] flex-shrink-0 disabled:opacity-50">
          <option value="">{t('budget.allStatuses')}</option>
          {EXPENSE_STATUSES.map(s => <option key={s} value={s}>{t(`budget.st_${s}`)}</option>)}
        </select>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-fiba-muted">
            {t('budget.expenseFilterFrom')}
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              disabled={isPending} max={dateTo || undefined}
              className="fiba-input !w-auto disabled:opacity-50" />
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-fiba-muted">
            {t('budget.expenseFilterTo')}
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              disabled={isPending} min={dateFrom || undefined}
              className="fiba-input !w-auto disabled:opacity-50" />
          </label>
          {hasDates && !isPending && (
            <button type="button" onClick={() => { setDateFrom(''); setDateTo('') }}
              className="text-xs text-fiba-muted hover:text-ink-900 dark:hover:text-white underline-offset-2 hover:underline">
              {t('budget.expenseFilterClearDates')}
            </button>
          )}
        </div>
        {canCreate ? (
          <button onClick={() => openEditor({})} className="btn-fiba ml-auto">{t('budget.newExpense')}</button>
        ) : canEdit ? (
          <p className="ml-auto self-center text-xs text-fiba-muted">{t('budget.approvalNoEditableDepts')}</p>
        ) : null}
      </div>

      {isPending && (
        <p className="text-xs text-fiba-muted mb-3">{t('budget.approvalPendingAllYears')}</p>
      )}

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
                  <p className="font-semibold text-ink-900 dark:text-white">
                    {isPending ? t('budget.approvalPendingEmpty') : t('budget.noExpenses')}
                  </p>
                  <p className="text-fiba-muted text-sm mt-1 max-w-md mx-auto">
                    {isPending ? t('budget.approvalPendingEmptyBody') : t('budget.noExpensesBody')}
                  </p>
                </td></tr>
              ) : rows.map(r => {
                const editable = canEdit && scope.canEditDept(r.department_code)
                const actions = expenseActions(r, { scope, canEdit, userId })
                const busy = busyId === r.id
                return (
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
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[r.status]}`}
                        title={r.status === 'rejected' && r.rejection_reason ? r.rejection_reason
                          : r.status === 'cancelled' && r.cancel_reason ? r.cancel_reason : undefined}>
                        {t(`budget.st_${r.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1">
                        <ExpenseActionButtons compact actions={actions} disabled={busy} t={t}
                          onRun={a => run(a, r)} />
                        <button type="button" onClick={() => openEditor(r)}
                          title={editable ? t('budget.editExpense') : t('budget.approvalView')}
                          aria-label={editable ? t('budget.editExpense') : t('budget.approvalView')}
                          className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-ink-900 dark:hover:text-white">
                          {editable ? <Icon.Pencil className="w-4 h-4" /> : <Icon.Eye className="w-4 h-4" />}
                        </button>
                        {editable && DELETABLE.has(r.status) && (
                          <button type="button" onClick={() => handleDelete(r)} disabled={busy}
                            title={t('common.delete')} aria-label={t('common.delete')}
                            className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-red-500 disabled:opacity-40">
                            <Icon.Trash className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {dialog}

      {editing && (
        <ExpenseEditor expense={editing} onClose={closeEditor} onSaved={() => { closeEditor(); reloadAll() }}
          onChanged={updated => { setEditing(prev => ({ ...prev, ...updated })); reloadAll() }}
          {...{ t, push, canEdit, departments, expenseAccounts, competitions, vendors, employees }} />
      )}
    </div>
  )
}
