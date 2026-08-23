/**
 * Costo de un evento: la vista que junta las tres fuentes de gasto que viven
 * separadas —pagos a personas, pasajes y gastos sin persona— contra lo
 * presupuestado.
 *
 * Sirve igual para una competencia del calendario (`/budget/competitions/{id}/cost`)
 * y para un evento presupuestario (`/budget/events/{id}/cost`): el backend
 * devuelve el mismo shape desde `_cost_core`, y duplicar el panel era garantizar
 * que en tres meses las dos pantallas mostraran cifras distintas para la misma
 * plata.
 *
 * Lo único propio de una temporada es `by_phase`: qué aporta cada fase del
 * calendario a un presupuesto que está cargado arriba (LAS TEMPORADAS
 * PRESUPUESTAN, LAS FASES EJECUTAN — BUDGET_MODULE.md §14.2 decisión 9).
 */
import { useMemo } from 'react'
import { Icon } from '../../lib/icons'
import { money, RollupTable } from './shared'

export default function EventCostPanel({ cost, t }) {
  // `by_phase` solo viene en el costo de un evento presupuestario, y solo tiene
  // sentido mostrarlo si la temporada tiene fases colgadas.
  const phaseRows = useMemo(
    () => (cost?.by_phase || []).map(p => ({
      key: p.competition_id,
      label: p.name,
      budgeted: p.budgeted,
      executed: p.executed,
      committed: p.committed,
      remaining: p.remaining,
    })),
    [cost],
  )

  if (!cost) return null

  return (
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
          <p className={`text-2xs ${cost.totals.remaining < 0 ? 'text-red-500' : 'text-fiba-muted'}`}
             title={t('budget.remainingHint')}>
            {t('budget.remaining')}: ${money(cost.totals.remaining)}
          </p>
        </div>
      </div>

      <RollupTable title={t('budget.byDepartment')} rows={cost.by_department} t={t} />

      {phaseRows.length > 0 ? (
        <RollupTable
          title={t('budget.byPhase')} hint={t('budget.byPhaseHint')} label={t('budget.phase')}
          rows={phaseRows} t={t}
        />
      ) : cost.event ? (
        <p className="text-xs text-fiba-muted mb-6 flex items-center gap-1.5">
          <Icon.Info className="w-3.5 h-3.5 flex-shrink-0" /> {t('budget.noPhasesCost')}
        </p>
      ) : null}

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
  )
}
