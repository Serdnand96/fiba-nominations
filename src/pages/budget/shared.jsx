/**
 * Piezas compartidas por las pestañas y editores de Budget: formato de plata,
 * fechas, selects de cuentas por departamento, la tabla de rollup y su barra.
 */
import { useEffect, useMemo } from 'react'

export const EXPENSE_STATUSES = ['draft', 'approved', 'paid', 'rejected', 'cancelled']
export const STATUS_BADGE = {
  draft:     'bg-ink-100 text-ink-700 dark:bg-navy-800 dark:text-ink-300',
  approved:  'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  paid:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
  rejected:  'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
  cancelled: 'bg-ink-100 text-ink-500 dark:bg-navy-800 dark:text-ink-400',
  expected:  'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-500',
  received:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
}

export function money(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function today() {
  return new Date().toISOString().slice(0, 10)
}

export function currentPeriod() {
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

export function accountOption(a) {
  // El asterisco marca el código provisorio (`pending_mapping`): el plan de
  // cuentas oficial de Finance todavía no llegó.
  return (
    <option key={a.code} value={a.code}>
      {a.code} — {a.label}{a.pending_mapping ? ' *' : ''}
    </option>
  )
}

/** Todas las cuentas, con las del departamento primero. Para los editores. */
export function AccountOptions({ accounts, department, t }) {
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
export function useDepartmentAccounts(accounts, department, account, setAccount) {
  const options = useMemo(() => splitAccounts(accounts, department).mine, [accounts, department])
  // Si el filtro de cuenta quedó fuera del departamento nuevo, se limpia: si no
  // la bandeja queda vacía por un filtro que ya no se ve en el desplegable.
  useEffect(() => {
    if (account && !options.some(a => a.code === account)) setAccount('')
  }, [options, account])
  return options
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <div className="text-[13px] font-medium text-ink-700 dark:text-ink-200 mb-1.5">{label}</div>
      {children}
    </label>
  )
}

/** Barra de consumo. Roja al pasarse — el sobregiro se tiene que ver solo. */
export function Bar({ budgeted, executed, committed }) {
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

export function RollupTable({ title, rows, t, onRowClick }) {
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
