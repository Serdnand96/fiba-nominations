import { useEffect, useMemo, useState } from 'react'
import { getBudgetSummary, getCompetitionCost, getFeeSchedule, applyFeeSchedule } from '../../api/client'
import { Icon } from '../../lib/icons'
import { competitionLabel } from '../../lib/competitions'
import { money, RollupTable } from './shared'

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

/* ──────────────────────────── Resumen ────────────────────────────
 *
 * Presupuestado vs. ejecutado por departamento, cuenta y evento; y el costo
 * total de una competencia juntando las tres fuentes de gasto.
 */

// Año del resumen, recordado entre visitas (mismo patrón que `fiba_dark`).
const YEAR_KEY = 'fiba_budget_year'

// Las opciones del select van de año actual -2 a +4; un año guardado fuera de
// esa ventana (de una visita de hace años) vuelve al actual.
function storedYear() {
  const thisYear = new Date().getFullYear()
  const y = Number(localStorage.getItem(YEAR_KEY))
  return Number.isInteger(y) && y >= thisYear - 2 && y <= thisYear + 4 ? y : thisYear
}

export default function DashboardTab({ t, push, canEdit, departments, competitions }) {
  const thisYear = new Date().getFullYear()
  const [year, setYearState] = useState(storedYear)
  const [department, setDepartment] = useState('')
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [costEvent, setCostEvent] = useState('')
  const [cost, setCost] = useState(null)

  const yearOptions = useMemo(() => Array.from({ length: 7 }, (_, i) => thisYear + 4 - i), [thisYear])

  function setYear(y) {
    setYearState(y)
    localStorage.setItem(YEAR_KEY, String(y))
  }

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
            {competitions.map(c => <option key={c.id} value={c.id}>{competitionLabel(c, t('months.short'))}</option>)}
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
            {competitions.map(c => <option key={c.id} value={c.id}>{competitionLabel(c, t('months.short'))}</option>)}
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
