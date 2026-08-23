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
 *
 * Desde la fase 11 el panel también cruza los ingresos contra el gasto y
 * muestra **dos** resultados a propósito (§14.12): `result` es lo que ya pasó
 * —cobrado menos ejecutado— y `projected_result` es cómo termina el evento si
 * todo lo esperado entra y todo lo comprometido sale. Una sola cifra obligaría
 * a elegir entre ser prudente y ser útil; con las dos, la distancia entre ellas
 * es en sí misma la información.
 */
import { useMemo } from 'react'
import { Icon } from '../../lib/icons'
import { money, RollupTable } from './shared'

const REVENUE_STATUS_BADGE = {
  expected:  'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-500',
  received:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
  cancelled: 'bg-ink-100 text-ink-500 dark:bg-navy-800 dark:text-ink-400',
}

/**
 * Una cifra de resultado, con el signo dicho de tres formas.
 *
 * El color solo no alcanza —verde↔rojo es el eje protan/deutan—, así que un
 * resultado negativo lleva además el menos delante del monto, la flecha hacia
 * abajo y la palabra "déficit". Un evento que perdió plata se tiene que ver sin
 * leer la etiqueta de arriba.
 */
function ResultFigure({ label, value, hint, title, t }) {
  const n = Number(value || 0)
  const sign = n < 0 ? -1 : n > 0 ? 1 : 0
  const tone = sign < 0 ? 'text-red-500' : sign > 0 ? 'text-emerald-500' : 'text-ink-900 dark:text-white'
  const Arrow = sign < 0 ? Icon.ArrowDown : Icon.ArrowUp
  return (
    <div className="fiba-stat" title={title}>
      <p className="text-xs text-fiba-muted">{label}</p>
      <p className={`text-xl font-bold ${tone}`}>
        {sign < 0 ? '−' : ''}${money(Math.abs(n))}
      </p>
      {sign !== 0 && (
        <p className={`text-2xs flex items-center gap-1 ${tone}`}>
          <Arrow className="w-3 h-3" aria-hidden="true" />
          {sign < 0 ? t('budget.deficit') : t('budget.surplus')}
        </p>
      )}
      {hint && <p className="text-2xs text-fiba-muted mt-0.5">{hint}</p>}
    </div>
  )
}

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

      {/* ─── Resultado del evento (fase 11) ─────────────────────────────────
          Las dos cifras son distintas a propósito y la pantalla lo dice: si se
          separan mucho, el resultado depende de plata que todavía no se movió. */}
      <section className="rounded-xl border border-fiba-border overflow-hidden mb-6">
        <div className="px-4 py-2.5 bg-fiba-surface/60 border-b border-fiba-border">
          <h3 className="text-sm font-semibold text-ink-900 dark:text-white">{t('budget.eventResult')}</h3>
          <p className="text-2xs text-fiba-muted mt-0.5">{t('budget.eventResultHint')}</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-4">
          <div className="fiba-stat">
            <p className="text-xs text-fiba-muted">{t('budget.revenueReceived')}</p>
            <p className="text-xl font-bold text-ink-900 dark:text-white">${money(cost.totals.revenue_received)}</p>
          </div>
          <div className="fiba-stat">
            <p className="text-xs text-fiba-muted">{t('budget.revenueExpected')}</p>
            <p className="text-xl font-bold text-ink-900 dark:text-white">${money(cost.totals.revenue_expected)}</p>
            <p className="text-2xs text-fiba-muted">{t('budget.revenueExpectedHint')}</p>
          </div>
          <ResultFigure
            t={t} label={t('budget.result')} value={cost.totals.result}
            title={t('budget.resultHint')}
            hint={`${t('budget.executed')}: $${money(cost.totals.executed)}`}
          />
          <ResultFigure
            t={t} label={t('budget.projectedResult')} value={cost.totals.projected_result}
            title={t('budget.projectedResultHint')}
            hint={`${t('budget.committed')}: $${money(cost.totals.committed)}`}
          />
        </div>

        {cost.revenues?.length > 0 ? (
          <div className="overflow-x-auto border-t border-fiba-border">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-fiba-muted border-b border-fiba-border">
                  <th className="px-4 py-2">{t('budget.sourceName')}</th>
                  <th className="px-4 py-2">{t('budget.status')}</th>
                  <th className="px-4 py-2 text-right">{t('budget.amount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-fiba-border">
                {/* Los ingresos vienen sin id (el core solo trae lo que suma),
                    así que la clave es el índice de una lista que no se
                    reordena en el cliente. */}
                {cost.revenues.map((r, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2.5 text-ink-900 dark:text-white">{r.source_name || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${REVENUE_STATUS_BADGE[r.status] || ''}`}>
                        {t(`budget.st_${r.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-900 dark:text-white">
                      ${money(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-4 py-3 border-t border-fiba-border text-xs text-fiba-muted flex items-center gap-1.5">
            <Icon.Info className="w-3.5 h-3.5 flex-shrink-0" /> {t('budget.noRevenuesForEvent')}
          </p>
        )}
      </section>

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
