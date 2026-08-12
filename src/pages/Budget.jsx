/**
 * Budget — gastos por departamento, con o sin evento.
 *
 * Complementa Pagos, que solo paga a personas nominadas. Acá entra todo lo
 * demás: licencias e internet (departamento sin evento) y shipping, branding o
 * seguros (evento sin persona). Ver BUDGET_MODULE.md.
 *
 * Solo el gasto en estado "pagado" consume presupuesto; lo aprobado sin pagar
 * se muestra aparte como comprometido.
 */
import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  getDepartments, getAccounts, getCalendarCompetitions, getEmployees,
  getVendors, createVendor, updateVendor, deleteVendor,
  getExpenses, getExpensesSummary, createExpense, updateExpense, approveExpense, deleteExpense,
  getExpenseAttachments, uploadExpenseAttachment, deleteExpenseAttachment, downloadExpenseAttachment,
  getRecurring, createRecurring, updateRecurring, deleteRecurring,
  getPendingRecurring, generateRecurring,
  getRevenues, createRevenue, updateRevenue, deleteRevenue,
  getBudgetLines, createBudgetLine, updateBudgetLine, deleteBudgetLine,
  projectBudget, getBudgetSummary, getCompetitionCost,
  getFeeSchedule, applyFeeSchedule,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../contexts/AuthContext'
import { Icon } from '../lib/icons'
import BudgetImport from './budget/BudgetImport'

const TABS = ['dashboard', 'plan', 'expenses', 'recurring', 'revenues', 'vendors']
const GENERAL = '__general__'   // clave de la columna "sin evento" en la matriz

// Tipos de evento del sheet `Fees Breakdown`. NO es template_key: son ejes
// distintos — dos competencias con el mismo template pueden pagar distinto.
const EVENT_TYPES = [
  'single_game_mens_qualifiers', 'single_game_other',
  'tournament_6d_youth', 'tournament_6d_senior',
  'tournament_8d_youth', 'tournament_8d_senior',
  'womens_americup', 'americup',
]
const EVENT_TYPE_LABEL = {
  single_game_mens_qualifiers: 'Single game — Men’s Qualifiers',
  single_game_other: 'Single game — otros',
  tournament_6d_youth: 'Torneo ≤6 días (Youth)',
  tournament_6d_senior: 'Torneo ≤6 días (Senior)',
  tournament_8d_youth: 'Torneo ≤8 días (Youth)',
  tournament_8d_senior: 'Torneo ≤8 días (Senior)',
  womens_americup: 'FIBA Women’s AmeriCup',
  americup: 'FIBA AmeriCup',
}
const ROLE_LABEL = { td: 'TD', vgo: 'VGO', ref: 'Árbitro', ref_instructor: 'Ref. Instructor', video_operator: 'Video Op.' }

const EXPENSE_STATUSES = ['draft', 'approved', 'paid', 'rejected', 'cancelled']
const STATUS_BADGE = {
  draft:     'bg-ink-100 text-ink-700 dark:bg-navy-800 dark:text-ink-300',
  approved:  'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  paid:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
  rejected:  'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
  cancelled: 'bg-ink-100 text-ink-500 dark:bg-navy-800 dark:text-ink-400',
  expected:  'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-500',
  received:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
}

function money(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

function currentPeriod() {
  return new Date().toISOString().slice(0, 7)
}

/* ─── Cuentas por departamento ───────────────────────────────────────────────
 *
 * La cuenta no pertenece a un departamento (son dimensiones separadas), pero
 * en la práctica cada área usa las suyas: con IT elegido, las 56 cuentas de
 * Competitions y Comms son ruido. `used_by` viene calculado del backend con lo
 * que hay cargado.
 *
 * En los **filtros** se muestran solo las del departamento: filtrar por una
 * cuenta que el área nunca usó devuelve una tabla vacía y no sirve de nada.
 * En los **editores** se muestran todas, con las del departamento arriba —
 * cargar el primer gasto de una cuenta nueva es legítimo.
 */
function splitAccounts(accounts, department) {
  if (!department) return { mine: accounts, rest: [] }
  const mine = accounts.filter(a => (a.used_by || []).includes(department))
  return { mine, rest: accounts.filter(a => !(a.used_by || []).includes(department)) }
}

function accountOption(a) {
  // El asterisco marca el código provisorio (`pending_mapping`): el plan de
  // cuentas oficial de Finance todavía no llegó.
  return (
    <option key={a.code} value={a.code}>
      {a.code} — {a.label}{a.pending_mapping ? ' *' : ''}
    </option>
  )
}

/** Todas las cuentas, con las del departamento primero. Para los editores. */
function AccountOptions({ accounts, department, t }) {
  const { mine, rest } = splitAccounts(accounts, department)
  if (!department || mine.length === 0) return accounts.map(accountOption)
  return (
    <>
      <optgroup label={t('budget.accountsOfDepartment')}>{mine.map(accountOption)}</optgroup>
      {rest.length > 0 && <optgroup label={t('budget.otherAccounts')}>{rest.map(accountOption)}</optgroup>}
    </>
  )
}

/** Solo las del departamento. Para los filtros de las bandejas. */
function useDepartmentAccounts(accounts, department, account, setAccount) {
  const options = useMemo(() => splitAccounts(accounts, department).mine, [accounts, department])
  // Si el filtro de cuenta quedó fuera del departamento nuevo, se limpia: si no
  // la bandeja queda vacía por un filtro que ya no se ve en el desplegable.
  useEffect(() => {
    if (account && !options.some(a => a.code === account)) setAccount('')
  }, [options, account])
  return options
}

/** Panel lateral reutilizable — mismo patrón que el detalle de viajes en Empleados. */
function Drawer({ title, subtitle, onClose, children, footer }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full max-w-lg bg-fiba-card border-l border-fiba-border z-50 flex flex-col animate-slide-in">
        <div className="flex items-start justify-between p-6 border-b border-fiba-border">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white truncate">{title}</h3>
            {subtitle && <p className="text-xs text-fiba-muted mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Cerrar"
            className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-ink-900 dark:hover:text-white">×</button>
        </div>
        <div className="flex-1 overflow-auto p-6 space-y-4">{children}</div>
        {footer && <div className="p-6 border-t border-fiba-border flex gap-3 justify-end">{footer}</div>}
      </div>
    </>
  )
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-[13px] font-medium text-ink-700 dark:text-ink-200 mb-1.5">{label}</div>
      {children}
    </label>
  )
}

export default function Budget() {
  const { t } = useLanguage()
  const { push } = useToast()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('budget')

  const [tab, setTab] = useState('dashboard')

  // Catálogos, compartidos por todas las pestañas.
  const [departments, setDepartments] = useState([])
  const [expenseAccounts, setExpenseAccounts] = useState([])
  const [revenueAccounts, setRevenueAccounts] = useState([])
  const [competitions, setCompetitions] = useState([])
  const [vendors, setVendors] = useState([])
  const [employees, setEmployees] = useState([])
  const [catalogsReady, setCatalogsReady] = useState(false)

  useEffect(() => {
    Promise.all([
      getDepartments(),
      getAccounts({ kind: 'expense' }),
      getAccounts({ kind: 'revenue' }),
      getCalendarCompetitions(),
      getVendors(),
      getEmployees(),
    ]).then(([deps, accE, accR, comps, vs, emps]) => {
      setDepartments(deps)
      setExpenseAccounts(accE)
      setRevenueAccounts(accR)
      setCompetitions(comps)
      setVendors(vs)
      setEmployees(emps)
    }).catch(e => {
      console.error(e)
      push({ type: 'error', title: t('common.error') })
    }).finally(() => setCatalogsReady(true))
  }, [])

  async function reloadVendors() {
    try { setVendors(await getVendors()) } catch (e) { console.error(e) }
  }

  if (!catalogsReady) return <div className="text-fiba-muted text-sm">{t('common.loading')}</div>

  const shared = {
    t, push, canEdit, departments, expenseAccounts, revenueAccounts,
    competitions, vendors, employees, reloadVendors,
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-ink-900 dark:text-white">{t('budget.title')}</h2>
      </div>

      <div className="flex gap-1 mb-6 border-b border-fiba-border overflow-x-auto">
        {TABS.map(key => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === key
                ? 'border-orange-500 text-ink-900 dark:text-white'
                : 'border-transparent text-fiba-muted hover:text-ink-900 dark:hover:text-white'
            }`}>
            {t(`budget.tab${key.charAt(0).toUpperCase()}${key.slice(1)}`)}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <DashboardTab {...shared} />}
      {tab === 'plan' && <PlanTab {...shared} />}
      {tab === 'expenses' && <ExpensesTab {...shared} />}
      {tab === 'recurring' && <RecurringTab {...shared} />}
      {tab === 'revenues' && <RevenuesTab {...shared} />}
      {tab === 'vendors' && <VendorsTab {...shared} />}
    </div>
  )
}

/* ──────────────────────────── Resumen ────────────────────────────
 *
 * Presupuestado vs. ejecutado por departamento, cuenta y evento; y el costo
 * total de una competencia juntando las tres fuentes de gasto.
 */

/** Barra de consumo. Roja al pasarse — el sobregiro se tiene que ver solo. */
function Bar({ budgeted, executed, committed }) {
  const b = Number(budgeted || 0)
  const e = Number(executed || 0)
  const c = Number(committed || 0)
  // Sin presupuesto cargado no hay porcentaje que mostrar: la barra iría al
  // infinito. Se marca como sobregiro si igual hubo gasto.
  const pct = b > 0 ? Math.min(100, (e / b) * 100) : (e > 0 ? 100 : 0)
  const cPct = b > 0 ? Math.min(100 - pct, (c / b) * 100) : 0
  const over = b > 0 ? e > b : e > 0
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-fiba-surface overflow-hidden flex">
        <div className={over ? 'bg-red-500' : 'bg-emerald-500'} style={{ width: `${pct}%` }} />
        <div className="bg-blue-500/40" style={{ width: `${cPct}%` }} />
      </div>
      <span className={`text-xs tabular-nums w-12 text-right ${over ? 'text-red-500 font-medium' : 'text-fiba-muted'}`}>
        {b > 0 ? `${Math.round((e / b) * 100)}%` : '—'}
      </span>
    </div>
  )
}

function RollupTable({ title, rows, t, onRowClick }) {
  if (!rows?.length) return null
  return (
    <div className="rounded-xl border border-fiba-border overflow-hidden mb-6">
      <div className="px-4 py-2.5 bg-fiba-surface/60 border-b border-fiba-border">
        <h3 className="text-sm font-semibold text-ink-900 dark:text-white">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-fiba-muted border-b border-fiba-border">
              <th className="px-4 py-2">{t('budget.department')}</th>
              <th className="px-4 py-2 text-right">{t('budget.budgeted')}</th>
              <th className="px-4 py-2 text-right">{t('budget.committed')}</th>
              <th className="px-4 py-2 text-right">{t('budget.executed')}</th>
              <th className="px-4 py-2 text-right">{t('budget.remaining')}</th>
              <th className="px-4 py-2 w-40">{t('budget.used')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-fiba-border">
            {rows.map(r => (
              <tr key={r.key ?? r.label}
                onClick={onRowClick && r.key ? () => onRowClick(r) : undefined}
                className={`${onRowClick && r.key ? 'cursor-pointer' : ''} hover:bg-fiba-surface/40 transition-colors`}>
                <td className="px-4 py-2.5 text-ink-900 dark:text-white">
                  {r.general ? <span className="italic text-fiba-muted">{t('budget.general')}</span> : r.label}
                </td>
                <td className="px-4 py-2.5 text-right text-fiba-muted">${money(r.budgeted)}</td>
                <td className="px-4 py-2.5 text-right text-blue-400">${money(r.committed)}</td>
                <td className="px-4 py-2.5 text-right text-emerald-400">${money(r.executed)}</td>
                <td className={`px-4 py-2.5 text-right font-medium ${r.remaining < 0 ? 'text-red-500' : 'text-ink-900 dark:text-white'}`}>
                  ${money(r.remaining)}
                </td>
                <td className="px-4 py-2.5"><Bar {...r} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function DashboardTab({ t, push, canEdit, departments, competitions }) {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(2027)
  const [department, setDepartment] = useState('')
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [costEvent, setCostEvent] = useState('')
  const [cost, setCost] = useState(null)

  const yearOptions = useMemo(() => Array.from({ length: 7 }, (_, i) => thisYear + 4 - i), [thisYear])

  useEffect(() => {
    setLoading(true)
    getBudgetSummary(department ? { year, department } : { year })
      .then(setSummary)
      .catch(e => { console.error(e); push({ type: 'error', title: t('common.error') }) })
      .finally(() => setLoading(false))
  }, [year, department])

  useEffect(() => {
    if (!costEvent) { setCost(null); return }
    getCompetitionCost(costEvent).then(setCost).catch(e => {
      console.error(e); push({ type: 'error', title: t('common.error') })
    })
  }, [costEvent])

  const accountRows = useMemo(
    () => (summary?.by_account || []).filter(r => r.budgeted || r.executed || r.committed).slice(0, 15),
    [summary],
  )

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-6">
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="fiba-select !w-auto min-w-[100px]">
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={department} onChange={e => setDepartment(e.target.value)}
          className="fiba-select !w-auto min-w-[200px]">
          <option value="">{t('budget.allDepartments')}</option>
          {departments.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-fiba-muted text-sm py-8 text-center">{t('common.loading')}</div>
      ) : !summary || (!summary.totals.budgeted && !summary.totals.executed) ? (
        <div className="rounded-xl border border-fiba-border py-12 text-center mb-8">
          <p className="font-semibold text-ink-900 dark:text-white">{t('budget.noSummary')}</p>
        </div>
      ) : (
        <>
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
          <p className="text-xs text-fiba-muted mb-6 flex items-center gap-1.5">
            <Icon.Info className="w-3.5 h-3.5 flex-shrink-0" /> {t('budget.includesPayments')}
          </p>

          <RollupTable title={t('budget.byDepartment')} rows={summary.by_department} t={t} />
          <RollupTable title={t('budget.byCompetition')} rows={summary.by_competition} t={t}
            onRowClick={r => setCostEvent(r.key)} />
          <RollupTable title={t('budget.byAccount')} rows={accountRows} t={t} />
        </>
      )}

      {/* Costo del evento: la vista que junta pagos + pasajes + gastos. */}
      <div className="rounded-xl border border-fiba-border p-5">
        <div className="flex flex-wrap items-center gap-3 mb-1">
          <h3 className="font-semibold text-ink-900 dark:text-white">{t('budget.eventCost')}</h3>
          <select value={costEvent} onChange={e => setCostEvent(e.target.value)}
            className="fiba-select !w-auto min-w-[260px]">
            <option value="">{t('budget.pickEvent')}</option>
            {competitions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <p className="text-xs text-fiba-muted mb-4">{t('budget.eventCostHint')}</p>

        {cost && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <div className="fiba-stat">
                <p className="text-xs text-fiba-muted">{t('budget.personFees')}</p>
                <p className="text-xl font-bold text-ink-900 dark:text-white">${money(cost.totals.person_fees)}</p>
                <p className="text-2xs text-fiba-muted">{cost.totals.people_count} {t('budget.peopleCount')}</p>
              </div>
              <div className="fiba-stat" title={t('budget.airfareApart')}>
                <p className="text-xs text-fiba-muted">{t('budget.airfare')}</p>
                <p className="text-xl font-bold text-ink-900 dark:text-white">${money(cost.totals.airfare)}</p>
              </div>
              <div className="fiba-stat">
                <p className="text-xs text-fiba-muted">{t('budget.eventExpenses')}</p>
                <p className="text-xl font-bold text-ink-900 dark:text-white">${money(cost.totals.event_expenses)}</p>
              </div>
              <div className="fiba-stat">
                <p className="text-xs text-fiba-muted">{t('budget.budgeted')}</p>
                <p className="text-xl font-bold text-ink-900 dark:text-white">${money(cost.totals.budgeted)}</p>
                <p className={`text-2xs ${cost.totals.remaining < 0 ? 'text-red-500' : 'text-fiba-muted'}`}>
                  {t('budget.remaining')}: ${money(cost.totals.remaining)}
                </p>
              </div>
            </div>

            <RollupTable title={t('budget.byDepartment')} rows={cost.by_department} t={t} />

            {cost.people.length > 0 && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-fiba-muted border-b border-fiba-border">
                      <th className="px-3 py-2">{t('budget.peopleCount')}</th>
                      <th className="px-3 py-2 text-right">{t('budget.personFees')}</th>
                      <th className="px-3 py-2 text-right">{t('budget.airfare')}</th>
                      <th className="px-3 py-2">{t('budget.status')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-fiba-border">
                    {cost.people.map((p, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 text-ink-900 dark:text-white">
                          {p.name} <span className="text-2xs text-fiba-muted">{p.role}</span>
                        </td>
                        <td className="px-3 py-2 text-right">${money(p.total)}</td>
                        <td className="px-3 py-2 text-right text-fiba-muted">${money(p.airfare)}</td>
                        <td className="px-3 py-2 text-fiba-muted text-xs">{p.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      <FeesPanel t={t} push={push} canEdit={canEdit} competitions={competitions} />
    </div>
  )
}

/** Tarifario: la grilla oficial y la acción de aplicarla a un evento. */
function FeesPanel({ t, push, canEdit, competitions }) {
  const [fees, setFees] = useState([])
  const [eventType, setEventType] = useState('womens_americup')
  const [target, setTarget] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [applying, setApplying] = useState(false)

  useEffect(() => { getFeeSchedule().then(setFees).catch(e => console.error(e)) }, [])

  const grid = useMemo(() => {
    const roles = [...new Set(fees.map(f => f.role_prefix))]
    return roles.map(r => ({
      role: r,
      row: fees.find(f => f.role_prefix === r && f.event_type === eventType),
    })).filter(x => x.row)
  }, [fees, eventType])

  async function handleApply() {
    if (!target) return
    setApplying(true)
    try {
      const res = await applyFeeSchedule({
        competition_id: target, fee_event_type: eventType, overwrite,
      })
      const done = res.applied.map(a => ROLE_LABEL[a.role] || a.role).join(', ')
      push({
        type: 'success',
        title: res.applied.length
          ? `${t('budget.applied')}: ${done}`
          : `0 — ${res.skipped.length} ${t('budget.alreadySet')}`,
      })
    } catch (e) {
      push({ type: 'error', title: e?.response?.data?.detail || t('common.error') })
    }
    setApplying(false)
  }

  return (
    <div className="rounded-xl border border-fiba-border p-5 mt-6">
      <h3 className="font-semibold text-ink-900 dark:text-white">{t('budget.fees')}</h3>
      <p className="text-xs text-fiba-muted mt-0.5 mb-1">{t('budget.feesHint')}</p>
      <p className="text-xs text-amber-500 mb-4 flex items-center gap-1.5">
        <Icon.Alert className="w-3.5 h-3.5 flex-shrink-0" /> {t('budget.feesPerCity')}
      </p>

      <div className="flex flex-wrap gap-3 mb-4">
        <select value={eventType} onChange={e => setEventType(e.target.value)}
          className="fiba-select !w-auto min-w-[240px]">
          {EVENT_TYPES.map(v => <option key={v} value={v}>{EVENT_TYPE_LABEL[v]}</option>)}
        </select>
      </div>

      <table className="text-sm mb-5">
        <thead>
          <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-fiba-muted border-b border-fiba-border">
            <th className="pr-8 py-2">{t('budget.role')}</th>
            <th className="pr-8 py-2 text-right">{t('budget.fee')}</th>
            <th className="py-2 text-right">{t('budget.incidentals')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-fiba-border">
          {grid.map(g => (
            <tr key={g.role}>
              <td className="pr-8 py-2 text-ink-900 dark:text-white">{ROLE_LABEL[g.role] || g.role}</td>
              <td className="pr-8 py-2 text-right font-medium text-ink-900 dark:text-white">${money(g.row.fee)}</td>
              <td className="py-2 text-right text-fiba-muted">${money(g.row.incidentals)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-fiba-border">
          <select value={target} onChange={e => setTarget(e.target.value)}
            className="fiba-select !w-auto min-w-[260px]">
            <option value="">{t('budget.pickEvent')}</option>
            {competitions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-fiba-muted cursor-pointer">
            <input type="checkbox" checked={overwrite} onChange={() => setOverwrite(v => !v)}
              className="rounded border-fiba-border" />
            {t('budget.overwriteFees')}
          </label>
          <button onClick={handleApply} disabled={!target || applying} className="btn-fiba">
            {applying ? t('common.loading') : t('budget.apply')}
          </button>
        </div>
      )}
    </div>
  )
}

/* ──────────────────────────── Presupuesto ────────────────────────────
 *
 * Una sola tabla (budget_lines), dos vistas:
 *   Matriz → cuentas × competencias, la forma del Excel de Competitions.
 *            La columna "General" son las líneas con competition_id NULL.
 *   Lista  → líneas agrupadas por cuenta con columnas de años, la forma del
 *            Excel de IT, más la proyección por escalación.
 */
function PlanTab({ t, push, canEdit, departments, expenseAccounts, competitions }) {
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

function BudgetLineEditor({
  line, year, defaultDepartment, onClose, onSaved, onDeleted,
  t, push, departments, expenseAccounts, competitions, canEdit,
}) {
  const isNew = !line.id
  const [form, setForm] = useState({
    department_code: line.department_code || defaultDepartment || departments[0]?.code || '',
    account_code: line.account_code || '',
    competition_id: line.competition_id || '',
    description: line.description || '',
    qty: line.qty ?? '',
    monthly_amount: line.monthly_amount ?? '',
    amount: line.amount ?? '',
    escalation_pct: line.escalation_pct != null ? String(Number(line.escalation_pct) * 100) : '',
    notes: line.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Al elegir cuenta en una línea nueva se propone su % de escalación —
  // los códigos de IT ya traen el del Excel (612300 → 6%).
  function pickAccount(code) {
    set('account_code', code)
    if (isNew && !form.escalation_pct) {
      const acc = expenseAccounts.find(a => a.code === code)
      if (acc?.escalation_pct != null) set('escalation_pct', String(Number(acc.escalation_pct) * 100))
    }
    if (isNew && !form.description) {
      const acc = expenseAccounts.find(a => a.code === code)
      if (acc) set('description', acc.label)
    }
  }

  async function handleSave() {
    if (!form.description.trim() || !form.account_code || form.amount === '') {
      push({ type: 'error', title: t('budget.required') })
      return
    }
    setSaving(true)
    try {
      const body = {
        year,
        department_code: form.department_code,
        account_code: form.account_code,
        competition_id: form.competition_id || null,
        description: form.description.trim(),
        qty: form.qty === '' ? null : Number(form.qty),
        monthly_amount: form.monthly_amount === '' ? null : Number(form.monthly_amount),
        amount: Number(form.amount || 0),
        escalation_pct: form.escalation_pct === '' ? null : Number(form.escalation_pct) / 100,
        notes: form.notes || null,
      }
      if (isNew) {
        await createBudgetLine(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)))
      } else {
        const { year: _y, ...patch } = body
        await updateBudgetLine(line.id, patch)
      }
      push({ type: 'success', title: t('budget.saved') })
      onSaved()
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('common.error') })
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!window.confirm(t('budget.confirmDelete'))) return
    try {
      await deleteBudgetLine(line.id)
      push({ type: 'success', title: t('budget.deleted') })
      onDeleted()
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('common.error') })
    }
  }

  return (
    <Drawer
      title={isNew ? t('budget.newLine') : t('budget.editLine')}
      subtitle={String(year)}
      onClose={onClose}
      footer={
        <>
          {!isNew && canEdit && (
            <button onClick={handleDelete} className="btn-fiba-danger mr-auto">{t('common.delete')}</button>
          )}
          <button onClick={onClose} className="btn-fiba-ghost">{t('budget.cancel')}</button>
          <button onClick={handleSave} disabled={saving} className="btn-fiba">{t('budget.save')}</button>
        </>
      }
    >
      <Field label={t('budget.lineDescription')}>
        <input className="fiba-input" value={form.description} onChange={e => set('description', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.department')}>
          <select className="fiba-select" value={form.department_code} onChange={e => set('department_code', e.target.value)}>
            {departments.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
          </select>
        </Field>
        <Field label={`${t('budget.amount')} (${year})`}>
          <input type="number" step="0.01" min="0" className="fiba-input" value={form.amount}
            onChange={e => set('amount', e.target.value)} />
        </Field>
      </div>
      <Field label={t('budget.account')}>
        <select className="fiba-select" value={form.account_code} onChange={e => pickAccount(e.target.value)}>
          <option value="">—</option>
          <AccountOptions accounts={expenseAccounts} department={form.department_code} t={t} />
        </select>
      </Field>
      <Field label={t('budget.competition')}>
        <select className="fiba-select" value={form.competition_id} onChange={e => set('competition_id', e.target.value)}>
          <option value="">{t('budget.general')}</option>
          {competitions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label={t('budget.qty')}>
          <input type="number" step="0.01" className="fiba-input" value={form.qty} onChange={e => set('qty', e.target.value)} />
        </Field>
        <Field label={t('budget.monthly')}>
          <input type="number" step="0.01" className="fiba-input" value={form.monthly_amount}
            onChange={e => set('monthly_amount', e.target.value)} />
        </Field>
        <Field label={`${t('budget.escalation')} %`}>
          <input type="number" step="0.1" className="fiba-input" value={form.escalation_pct}
            onChange={e => set('escalation_pct', e.target.value)} />
        </Field>
      </div>
      <Field label={t('budget.notes')}>
        <textarea rows={3} className="fiba-input !h-auto py-2" value={form.notes} onChange={e => set('notes', e.target.value)} />
      </Field>
    </Drawer>
  )
}

/* ──────────────────────────── Gastos ──────────────────────────── */
function ExpensesTab({ t, push, canEdit, departments, expenseAccounts, competitions, vendors, employees }) {
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
          {competitions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="fiba-select !w-auto min-w-[150px] flex-shrink-0">
          <option value="">{t('budget.allStatuses')}</option>
          {EXPENSE_STATUSES.map(s => <option key={s} value={s}>{t(`budget.st_${s}`)}</option>)}
        </select>
        {canEdit && (
          <button onClick={() => setEditing({})} className="btn-fiba ml-auto">{t('budget.newExpense')}</button>
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
                        <button onClick={() => setEditing(r)} title={t('budget.editExpense')}
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
        <ExpenseEditor expense={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }}
          {...{ t, push, departments, expenseAccounts, competitions, vendors, employees }} />
      )}
    </div>
  )
}

function ExpenseEditor({ expense, onClose, onSaved, t, push, departments, expenseAccounts, competitions, vendors, employees }) {
  const isNew = !expense.id
  const [form, setForm] = useState({
    department_code: expense.department_code || departments[0]?.code || '',
    account_code: expense.account_code || '',
    competition_id: expense.competition_id || '',
    payee_type: expense.payee_type || 'vendor',
    vendor_id: expense.vendor_id || '',
    employee_id: expense.employee_id || '',
    payee_name: expense.payee_name || '',
    description: expense.description || '',
    amount: expense.amount ?? '',
    expense_date: expense.expense_date || today(),
    payment_date: expense.payment_date || '',
    status: expense.status || 'draft',
    invoice_no: expense.invoice_no || '',
    payment_method: expense.payment_method || '',
    bank_confirmation: expense.bank_confirmation || '',
    comments: expense.comments || '',
  })
  const [saving, setSaving] = useState(false)
  const [attachments, setAttachments] = useState([])
  const [attKind, setAttKind] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!expense.id) { setAttachments([]); return }
    getExpenseAttachments(expense.id).then(setAttachments).catch(e => { console.error(e); setAttachments([]) })
  }, [expense.id])

  async function handleSave(e) {
    e?.preventDefault()
    if (!form.description.trim() || !form.account_code || !form.department_code || form.amount === '') {
      push({ type: 'error', title: t('budget.required') })
      return
    }
    setSaving(true)
    try {
      const body = {
        department_code: form.department_code,
        account_code: form.account_code,
        competition_id: form.competition_id || null,
        payee_type: form.payee_type,
        vendor_id: form.payee_type === 'vendor' ? (form.vendor_id || null) : null,
        employee_id: form.payee_type === 'employee' ? (form.employee_id || null) : null,
        payee_name: form.payee_type === 'other' ? form.payee_name : null,
        description: form.description.trim(),
        amount: Number(form.amount || 0),
        expense_date: form.expense_date,
        // El backend exige fecha de pago si y solo si el estado es "pagado".
        payment_date: form.status === 'paid' ? (form.payment_date || today()) : null,
        status: form.status,
        invoice_no: form.invoice_no || null,
        payment_method: form.payment_method || null,
        bank_confirmation: form.bank_confirmation || null,
        comments: form.comments || null,
      }
      // En alta se filtran los null (el default de la columna hace el resto);
      // en edición se manda el body completo, null incluido, porque el PATCH
      // usa exclude_unset y un null explícito es lo que vacía el campo — así
      // se puede pasar un gasto de un evento a general.
      if (isNew) {
        await createExpense(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)))
      } else {
        await updateExpense(expense.id, body)
      }
      push({ type: 'success', title: t('budget.saved') })
      onSaved()
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('common.error') })
    }
    setSaving(false)
  }

  async function handleUpload(file) {
    if (!file) return
    try {
      await uploadExpenseAttachment(expense.id, file, attKind || null)
      setAttachments(await getExpenseAttachments(expense.id))
      setAttKind('')
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('common.error') })
    }
  }

  async function handleDownload(att) {
    try {
      const blob = await downloadExpenseAttachment(att.id, att.file_name)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = att.file_name
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      push({ type: 'error', title: t('common.error') })
    }
  }

  return (
    <Drawer
      title={isNew ? t('budget.newExpense') : t('budget.editExpense')}
      subtitle={expense.record_no}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-fiba-ghost">{t('budget.cancel')}</button>
          <button onClick={handleSave} disabled={saving} className="btn-fiba">
            {saving ? t('common.loading') : t('budget.save')}
          </button>
        </>
      }
    >
      <Field label={t('budget.description')}>
        <input className="fiba-input" value={form.description} onChange={e => set('description', e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.department')}>
          <select className="fiba-select" value={form.department_code} onChange={e => set('department_code', e.target.value)}>
            {departments.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
          </select>
        </Field>
        <Field label={t('budget.amount')}>
          <input type="number" step="0.01" min="0" className="fiba-input" value={form.amount}
            onChange={e => set('amount', e.target.value)} />
        </Field>
      </div>

      <Field label={t('budget.account')}>
        <select className="fiba-select" value={form.account_code} onChange={e => set('account_code', e.target.value)}>
          <option value="">—</option>
          <AccountOptions accounts={expenseAccounts} department={form.department_code} t={t} />
        </select>
      </Field>

      <Field label={t('budget.competition')}>
        <select className="fiba-select" value={form.competition_id} onChange={e => set('competition_id', e.target.value)}>
          <option value="">{t('budget.general')}</option>
          {competitions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>

      <Field label={t('budget.payee')}>
        <select className="fiba-select" value={form.payee_type} onChange={e => set('payee_type', e.target.value)}>
          <option value="vendor">{t('budget.payeeVendor')}</option>
          <option value="employee">{t('budget.payeeEmployee')}</option>
          <option value="other">{t('budget.payeeOther')}</option>
        </select>
      </Field>

      {form.payee_type === 'vendor' && (
        <Field label={t('budget.payeeVendor')}>
          <select className="fiba-select" value={form.vendor_id} onChange={e => set('vendor_id', e.target.value)}>
            <option value="">—</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
      )}
      {form.payee_type === 'employee' && (
        <Field label={t('budget.payeeEmployee')}>
          <select className="fiba-select" value={form.employee_id} onChange={e => set('employee_id', e.target.value)}>
            <option value="">—</option>
            {employees.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
      )}
      {form.payee_type === 'other' && (
        <Field label={t('budget.payeeName')}>
          <input className="fiba-input" value={form.payee_name} onChange={e => set('payee_name', e.target.value)} />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.expenseDate')}>
          <input type="date" className="fiba-input" value={form.expense_date} onChange={e => set('expense_date', e.target.value)} />
        </Field>
        <Field label={t('budget.status')}>
          <select className="fiba-select" value={form.status} onChange={e => set('status', e.target.value)}>
            {EXPENSE_STATUSES.map(s => <option key={s} value={s}>{t(`budget.st_${s}`)}</option>)}
          </select>
        </Field>
      </div>

      {form.status === 'paid' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('budget.paymentDate')}>
            <input type="date" className="fiba-input" value={form.payment_date || today()}
              onChange={e => set('payment_date', e.target.value)} />
          </Field>
          <Field label={t('budget.paymentMethod')}>
            <input className="fiba-input" value={form.payment_method} onChange={e => set('payment_method', e.target.value)} />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.invoiceNo')}>
          <input className="fiba-input" value={form.invoice_no} onChange={e => set('invoice_no', e.target.value)} />
        </Field>
        <Field label={t('budget.bankConfirmation')}>
          <input className="fiba-input" value={form.bank_confirmation} onChange={e => set('bank_confirmation', e.target.value)} />
        </Field>
      </div>

      <Field label={t('budget.comments')}>
        <textarea rows={2} className="fiba-input !h-auto py-2" value={form.comments}
          onChange={e => set('comments', e.target.value)} />
      </Field>

      <div className="pt-2 border-t border-fiba-border">
        <p className="text-[13px] font-medium text-ink-700 dark:text-ink-200 mb-2">{t('budget.attachments')}</p>
        {isNew ? (
          <p className="text-xs text-fiba-muted">{t('budget.saveFirst')}</p>
        ) : (
          <>
            {attachments.map(a => (
              <div key={a.id} className="flex items-center justify-between py-1.5 text-sm">
                <button onClick={() => handleDownload(a)}
                  className="text-left text-ink-900 dark:text-white hover:underline truncate">
                  {a.file_name} {a.kind && <span className="text-fiba-muted text-xs">({a.kind})</span>}
                </button>
                <button onClick={async () => {
                  await deleteExpenseAttachment(a.id)
                  setAttachments(await getExpenseAttachments(expense.id))
                }} className="p-1 rounded hover:bg-fiba-surface text-fiba-muted hover:text-red-500">
                  <Icon.X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <div className="flex gap-2 mt-2">
              <input className="fiba-input flex-1" placeholder={t('budget.attachmentKind')}
                value={attKind} onChange={e => setAttKind(e.target.value)} />
              <label className="btn-fiba-ghost cursor-pointer whitespace-nowrap">
                {t('budget.upload')}
                <input type="file" className="hidden" accept="application/pdf,image/*"
                  onChange={e => handleUpload(e.target.files?.[0])} />
              </label>
            </div>
          </>
        )}
      </div>
    </Drawer>
  )
}

/* ──────────────────────────── Recurrentes ──────────────────────────── */
function RecurringTab({ t, push, canEdit, departments, expenseAccounts, vendors }) {
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

function RecurringEditor({ recurring, onClose, onSaved, t, push, departments, expenseAccounts, vendors }) {
  const isNew = !recurring.id
  const [form, setForm] = useState({
    description: recurring.description || '',
    department_code: recurring.department_code || departments[0]?.code || '',
    account_code: recurring.account_code || '',
    vendor_id: recurring.vendor_id || '',
    amount: recurring.amount ?? '',
    frequency: recurring.frequency || 'monthly',
    day_of_month: recurring.day_of_month ?? 1,
    start_date: recurring.start_date || today(),
    end_date: recurring.end_date || '',
    notes: recurring.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.description.trim() || !form.account_code || form.amount === '') {
      push({ type: 'error', title: t('budget.required') })
      return
    }
    setSaving(true)
    try {
      const body = {
        description: form.description.trim(),
        department_code: form.department_code,
        account_code: form.account_code,
        vendor_id: form.vendor_id || null,
        amount: Number(form.amount || 0),
        frequency: form.frequency,
        day_of_month: Number(form.day_of_month) || 1,
        start_date: form.start_date,
        end_date: form.end_date || null,
        notes: form.notes || null,
      }
      if (isNew) await createRecurring(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)))
      else await updateRecurring(recurring.id, body)
      push({ type: 'success', title: t('budget.saved') })
      onSaved()
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('common.error') })
    }
    setSaving(false)
  }

  return (
    <Drawer
      title={isNew ? t('budget.newRecurring') : t('budget.editRecurring')}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-fiba-ghost">{t('budget.cancel')}</button>
          <button onClick={handleSave} disabled={saving} className="btn-fiba">{t('budget.save')}</button>
        </>
      }
    >
      <Field label={t('budget.description')}>
        <input className="fiba-input" value={form.description} onChange={e => set('description', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.department')}>
          <select className="fiba-select" value={form.department_code} onChange={e => set('department_code', e.target.value)}>
            {departments.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
          </select>
        </Field>
        <Field label={t('budget.amount')}>
          <input type="number" step="0.01" min="0" className="fiba-input" value={form.amount}
            onChange={e => set('amount', e.target.value)} />
        </Field>
      </div>
      <Field label={t('budget.account')}>
        <select className="fiba-select" value={form.account_code} onChange={e => set('account_code', e.target.value)}>
          <option value="">—</option>
          <AccountOptions accounts={expenseAccounts} department={form.department_code} t={t} />
        </select>
      </Field>
      <Field label={t('budget.payeeVendor')}>
        <select className="fiba-select" value={form.vendor_id} onChange={e => set('vendor_id', e.target.value)}>
          <option value="">—</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.frequency')}>
          <select className="fiba-select" value={form.frequency} onChange={e => set('frequency', e.target.value)}>
            <option value="monthly">{t('budget.fq_monthly')}</option>
            <option value="quarterly">{t('budget.fq_quarterly')}</option>
            <option value="annual">{t('budget.fq_annual')}</option>
          </select>
        </Field>
        <Field label={t('budget.dayOfMonth')}>
          <input type="number" min="1" max="28" className="fiba-input" value={form.day_of_month}
            onChange={e => set('day_of_month', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.startDate')}>
          <input type="date" className="fiba-input" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
        </Field>
        <Field label={t('budget.endDate')}>
          <input type="date" className="fiba-input" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
        </Field>
      </div>
      <Field label={t('budget.notes')}>
        <textarea rows={2} className="fiba-input !h-auto py-2" value={form.notes} onChange={e => set('notes', e.target.value)} />
      </Field>
    </Drawer>
  )
}

/* ──────────────────────────── Ingresos ──────────────────────────── */
function RevenuesTab({ t, push, canEdit, departments, revenueAccounts, competitions }) {
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

function RevenueEditor({ revenue, onClose, onSaved, t, push, departments, revenueAccounts, competitions }) {
  const isNew = !revenue.id
  const [form, setForm] = useState({
    source_name: revenue.source_name || '',
    department_code: revenue.department_code || departments[0]?.code || '',
    account_code: revenue.account_code || '',
    competition_id: revenue.competition_id || '',
    amount: revenue.amount ?? '',
    expected_date: revenue.expected_date || '',
    received_date: revenue.received_date || '',
    status: revenue.status || 'expected',
    description: revenue.description || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.source_name.trim() || !form.account_code || form.amount === '') {
      push({ type: 'error', title: t('budget.required') })
      return
    }
    setSaving(true)
    try {
      const body = {
        source_name: form.source_name.trim(),
        department_code: form.department_code,
        account_code: form.account_code,
        competition_id: form.competition_id || null,
        amount: Number(form.amount || 0),
        expected_date: form.expected_date || null,
        received_date: form.status === 'received' ? (form.received_date || today()) : null,
        status: form.status,
        description: form.description || null,
      }
      if (isNew) await createRevenue(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)))
      else await updateRevenue(revenue.id, body)
      push({ type: 'success', title: t('budget.saved') })
      onSaved()
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('common.error') })
    }
    setSaving(false)
  }

  return (
    <Drawer
      title={isNew ? t('budget.newRevenue') : t('budget.editRevenue')}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-fiba-ghost">{t('budget.cancel')}</button>
          <button onClick={handleSave} disabled={saving} className="btn-fiba">{t('budget.save')}</button>
        </>
      }
    >
      <Field label={t('budget.sourceName')}>
        <input className="fiba-input" value={form.source_name} onChange={e => set('source_name', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.department')}>
          <select className="fiba-select" value={form.department_code} onChange={e => set('department_code', e.target.value)}>
            {departments.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
          </select>
        </Field>
        <Field label={t('budget.amount')}>
          <input type="number" step="0.01" min="0" className="fiba-input" value={form.amount}
            onChange={e => set('amount', e.target.value)} />
        </Field>
      </div>
      <Field label={t('budget.account')}>
        <select className="fiba-select" value={form.account_code} onChange={e => set('account_code', e.target.value)}>
          <option value="">—</option>
          <AccountOptions accounts={revenueAccounts} department={form.department_code} t={t} />
        </select>
      </Field>
      <Field label={t('budget.competition')}>
        <select className="fiba-select" value={form.competition_id} onChange={e => set('competition_id', e.target.value)}>
          <option value="">{t('budget.general')}</option>
          {competitions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.expectedDate')}>
          <input type="date" className="fiba-input" value={form.expected_date} onChange={e => set('expected_date', e.target.value)} />
        </Field>
        <Field label={t('budget.status')}>
          <select className="fiba-select" value={form.status} onChange={e => set('status', e.target.value)}>
            <option value="expected">{t('budget.st_expected')}</option>
            <option value="received">{t('budget.st_received')}</option>
            <option value="cancelled">{t('budget.st_cancelled')}</option>
          </select>
        </Field>
      </div>
      {form.status === 'received' && (
        <Field label={t('budget.receivedDate')}>
          <input type="date" className="fiba-input" value={form.received_date || today()}
            onChange={e => set('received_date', e.target.value)} />
        </Field>
      )}
      <Field label={t('budget.description')}>
        <textarea rows={2} className="fiba-input !h-auto py-2" value={form.description}
          onChange={e => set('description', e.target.value)} />
      </Field>
    </Drawer>
  )
}

/* ──────────────────────────── Proveedores ──────────────────────────── */
function VendorsTab({ t, push, canEdit, vendors, reloadVendors }) {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)

  const rows = useMemo(() => {
    if (!search) return vendors
    const s = search.toLowerCase()
    return vendors.filter(v =>
      (v.name || '').toLowerCase().includes(s)
      || (v.tax_id || '').toLowerCase().includes(s)
      || (v.country || '').toLowerCase().includes(s))
  }, [vendors, search])

  async function handleDelete(row) {
    if (!window.confirm(t('budget.confirmDelete'))) return
    try {
      const res = await deleteVendor(row.id)
      push({ type: 'success', title: res.deactivated ? t('budget.vendorDeactivated') : t('budget.deleted') })
      reloadVendors()
    } catch (e) {
      push({ type: 'error', title: e?.response?.data?.detail || t('common.error') })
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <input type="text" placeholder={t('budget.search')} value={search}
          onChange={e => setSearch(e.target.value)} className="fiba-input w-full md:w-80" />
        {canEdit && <button onClick={() => setEditing({})} className="btn-fiba ml-auto">{t('budget.newVendor')}</button>}
      </div>

      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-fiba-surface/60 border-b border-fiba-border">
              <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-fiba-muted">
                <th className="px-4 py-2.5">{t('budget.vendorName')}</th>
                <th className="px-4 py-2.5">{t('budget.taxId')}</th>
                <th className="px-4 py-2.5">{t('budget.country')}</th>
                <th className="px-4 py-2.5">{t('budget.email')}</th>
                <th className="px-4 py-2.5 text-right">{t('budget.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fiba-border">
              {rows.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center">
                  <p className="font-semibold text-ink-900 dark:text-white">{t('budget.noVendors')}</p>
                  <p className="text-fiba-muted text-sm mt-1 max-w-md mx-auto">{t('budget.noVendorsBody')}</p>
                </td></tr>
              ) : rows.map(v => (
                <tr key={v.id} className="hover:bg-fiba-surface/50 transition-colors">
                  <td className="px-4 py-3 text-ink-900 dark:text-white">{v.name}</td>
                  <td className="px-4 py-3 text-fiba-muted">{v.tax_id || '—'}</td>
                  <td className="px-4 py-3 text-fiba-muted">{v.country || '—'}</td>
                  <td className="px-4 py-3 text-fiba-muted">{v.email || '—'}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {canEdit && (
                      <div className="inline-flex gap-1">
                        <button onClick={() => setEditing(v)}
                          className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-ink-900 dark:hover:text-white">
                          <Icon.Doc className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(v)}
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
        <VendorEditor vendor={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reloadVendors() }} {...{ t, push }} />
      )}
    </div>
  )
}

function VendorEditor({ vendor, onClose, onSaved, t, push }) {
  const isNew = !vendor.id
  const [form, setForm] = useState({
    name: vendor.name || '', tax_id: vendor.tax_id || '', country: vendor.country || '',
    email: vendor.email || '', phone: vendor.phone || '',
    bank_info: vendor.bank_info || '', notes: vendor.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.name.trim()) { push({ type: 'error', title: t('budget.required') }); return }
    setSaving(true)
    try {
      const entries = Object.entries({ ...form, name: form.name.trim() })
      if (isNew) {
        await createVendor(Object.fromEntries(entries.filter(([, v]) => v !== '')))
      } else {
        // '' → null: vaciar el campo en la UI tiene que vaciarlo en la base,
        // no guardar un string vacío.
        await updateVendor(vendor.id, Object.fromEntries(entries.map(([k, v]) => [k, v === '' ? null : v])))
      }
      push({ type: 'success', title: t('budget.saved') })
      onSaved()
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('common.error') })
    }
    setSaving(false)
  }

  return (
    <Drawer
      title={isNew ? t('budget.newVendor') : t('budget.editVendor')}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-fiba-ghost">{t('budget.cancel')}</button>
          <button onClick={handleSave} disabled={saving} className="btn-fiba">{t('budget.save')}</button>
        </>
      }
    >
      <Field label={t('budget.vendorName')}>
        <input className="fiba-input" value={form.name} onChange={e => set('name', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.taxId')}>
          <input className="fiba-input" value={form.tax_id} onChange={e => set('tax_id', e.target.value)} />
        </Field>
        <Field label={t('budget.country')}>
          <input className="fiba-input" value={form.country} onChange={e => set('country', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.email')}>
          <input type="email" className="fiba-input" value={form.email} onChange={e => set('email', e.target.value)} />
        </Field>
        <Field label={t('budget.phone')}>
          <input className="fiba-input" value={form.phone} onChange={e => set('phone', e.target.value)} />
        </Field>
      </div>
      <Field label={t('budget.bankInfo')}>
        <textarea rows={3} className="fiba-input !h-auto py-2" value={form.bank_info}
          onChange={e => set('bank_info', e.target.value)} />
      </Field>
      <Field label={t('budget.notes')}>
        <textarea rows={2} className="fiba-input !h-auto py-2" value={form.notes}
          onChange={e => set('notes', e.target.value)} />
      </Field>
    </Drawer>
  )
}
