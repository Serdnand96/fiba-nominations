import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { getBudgetCashflow, downloadBudgetCashflowXlsx } from '../../api/client'
import { useLanguage } from '../../i18n/LanguageContext'
import { Icon } from '../../lib/icons'
import { Button } from '../../components/ui/Button'
import { Tabs } from '../../components/ui/Tabs'
import { money, storedYear, rememberYear, yearOptions } from './shared'

// recharts vive en el chunk `charts`: se baja recién al abrir esta pestaña.
const CashflowChart = lazy(
  () => import('../../components/charts').then(m => ({ default: m.CashflowChart })),
)

/* ──────────────────────── Flujo de caja ────────────────────────
 *
 * El mismo año que el Resumen, cortado en trimestres y con los ingresos
 * adentro: cuánto salió, cuánto está por salir, cuánto entró y el neto.
 * El backend arma todo desde las mismas filas que el Resumen, así que la
 * columna "Año" coincide con sus tarjetas.
 */

const QUARTERS = [1, 2, 3, 4]

// Filas de la tabla principal. `section` abre un bloque (salidas / ingresos /
// neto); `signed` muestra el signo; el acumulado no tiene total anual porque
// su último trimestre ya lo es.
const ROWS = [
  { key: 'budgeted', label: 'budget.cashflowReference', tone: 'text-fiba-muted' },
  { key: 'executed', label: 'budget.executed', tone: 'text-emerald-400' },
  { key: 'committed', label: 'budget.committed', tone: 'text-blue-400' },
  { key: 'outflow', label: 'budget.cashflowOutflow', strong: true },
  { key: 'revenue_received', label: 'budget.cashflowReceived', section: true },
  { key: 'revenue_expected', label: 'budget.cashflowExpected', tone: 'text-fiba-muted' },
  { key: 'inflow', label: 'budget.cashflowInflow', strong: true },
  { key: 'net', label: 'budget.cashflowNet', strong: true, signed: true, section: true },
  { key: 'net_cumulative', label: 'budget.cashflowNetCumulative', signed: true, noYear: true },
]

const BREAKDOWNS = [
  { key: 'by_department', label: 'budget.byDepartment', header: 'budget.department' },
  { key: 'by_competition', label: 'budget.byCompetition', header: 'budget.competition' },
  { key: 'by_account', label: 'budget.byAccount', header: 'budget.account' },
]

const METRICS = [
  { key: 'outflow', label: 'budget.cashflowMetricOutflow', value: q => q.executed + q.committed },
  { key: 'executed', label: 'budget.executed', value: q => q.executed },
  { key: 'committed', label: 'budget.committed', value: q => q.committed },
  { key: 'inflow', label: 'budget.cashflowMetricInflow', value: q => q.revenue_received + q.revenue_expected },
]

/** 'past' | 'current' | 'future' de un trimestre respecto de hoy. */
function quarterStatus(year, quarter, now = new Date()) {
  const thisYear = now.getFullYear()
  const current = Math.floor(now.getMonth() / 3) + 1
  if (year < thisYear || (year === thisYear && quarter < current)) return 'past'
  return year === thisYear && quarter === current ? 'current' : 'future'
}

function amount(n) {
  const v = Number(n) || 0
  return `${v < 0 ? '-' : ''}$${money(Math.abs(v))}`
}

// En las matrices el cero se muestra como "-": una grilla llena de $0.00 no
// deja ver dónde hay plata.
const cell = (n) => (Number(n) ? amount(n) : '-')

function QuarterTable({ data, t }) {
  const statuses = QUARTERS.map(q => quarterStatus(data.year, q))
  const hasOverdue = data.quarters.some((q, i) => statuses[i] === 'past' && q.committed > 0)
  const highlight = (i) => (statuses[i] === 'current' ? 'bg-fiba-surface/50' : '')

  return (
    <div className="rounded-xl border border-fiba-border overflow-hidden mb-6">
      <div className="px-4 py-2.5 bg-fiba-surface/60 border-b border-fiba-border">
        <h3 className="text-sm font-semibold text-ink-900 dark:text-white">{t('budget.cashflowByQuarter')}</h3>
        <p className="text-xs text-fiba-muted mt-0.5">{t('budget.cashflowHint')}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-2xs font-semibold uppercase tracking-wider text-fiba-muted border-b border-fiba-border">
              <th className="px-4 py-2 text-left"><span className="sr-only">{t('budget.cashflowConcept')}</span></th>
              {QUARTERS.map((q, i) => (
                <th key={q} className={`px-4 py-2 text-right whitespace-nowrap ${highlight(i)}`}>
                  Q{q}
                  {statuses[i] === 'current' && (
                    <span className="ml-1.5 normal-case tracking-normal font-medium text-orange-500">
                      {t('budget.cashflowCurrent')}
                    </span>
                  )}
                </th>
              ))}
              <th className="px-4 py-2 text-right">{t('budget.cashflowYear')}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(row => {
              const weight = row.strong ? 'font-semibold' : ''
              const border = row.section ? 'border-t-2 border-fiba-border' : 'border-t border-fiba-border'
              const tone = (value, overdue) => {
                if (overdue) return 'text-amber-500 font-medium'
                if (row.signed) return value < 0 ? 'text-red-500' : 'text-ink-900 dark:text-white'
                return row.tone || 'text-ink-900 dark:text-white'
              }
              return (
                <tr key={row.key} className={border}>
                  <th scope="row"
                    className={`px-4 py-2.5 text-left font-normal whitespace-nowrap text-ink-900 dark:text-white ${weight}`}>
                    {t(row.label)}
                  </th>
                  {data.quarters.map((q, i) => {
                    const value = q[row.key]
                    const overdue = row.key === 'committed' && statuses[i] === 'past' && value > 0
                    return (
                      <td key={q.quarter} title={overdue ? t('budget.cashflowOverdueCell') : undefined}
                        className={`px-4 py-2.5 text-right tabular-nums whitespace-nowrap ${weight} ${tone(value, overdue)} ${highlight(i)}`}>
                        {amount(value)}
                        {overdue && <span className="sr-only"> ({t('budget.cashflowOverdueCell')})</span>}
                      </td>
                    )
                  })}
                  <td className={`px-4 py-2.5 text-right tabular-nums whitespace-nowrap ${weight} ${tone(data.totals[row.key], false)}`}>
                    {row.noYear ? '-' : amount(data.totals[row.key])}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {hasOverdue && (
        <p className="px-4 py-2 text-xs text-fiba-muted border-t border-fiba-border flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" /> {t('budget.cashflowOverdue')}
        </p>
      )}
    </div>
  )
}

function Breakdown({ data, t }) {
  const [breakdown, setBreakdown] = useState('by_department')
  const [metric, setMetric] = useState('outflow')
  const active = BREAKDOWNS.find(b => b.key === breakdown)

  const rows = useMemo(() => {
    const value = METRICS.find(m => m.key === metric).value
    return (data[breakdown] || [])
      .map(r => {
        const values = r.quarters.map(value)
        return { ...r, values, total: values.reduce((a, b) => a + b, 0) }
      })
      .filter(r => r.values.some(v => v))
      .sort((a, b) => b.total - a.total)
  }, [data, breakdown, metric])

  const sums = QUARTERS.map((_, i) => rows.reduce((acc, r) => acc + r.values[i], 0))

  function name(r) {
    if (r.general) {
      // Sin evento es gasto general; sin departamento o sin cuenta es plata
      // que falta imputar. Mismos rótulos que el Excel.
      const label = breakdown === 'by_competition' ? 'budget.general' : 'budget.cashflowUnallocated'
      return <span className="italic text-fiba-muted">{t(label)}</span>
    }
    return breakdown === 'by_account' ? `${r.key} · ${r.label}` : r.label
  }

  return (
    <div className="rounded-xl border border-fiba-border overflow-hidden mb-6">
      <div className="px-4 pt-2.5 bg-fiba-surface/60 border-b border-fiba-border">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h3 className="text-sm font-semibold text-ink-900 dark:text-white">{t('budget.cashflowBreakdown')}</h3>
          <label className="flex items-center gap-2 text-xs text-fiba-muted">
            {t('budget.cashflowMetric')}
            <select value={metric} onChange={e => setMetric(e.target.value)}
              className="fiba-select !w-auto min-w-[150px] !py-1.5">
              {METRICS.map(m => <option key={m.key} value={m.key}>{t(m.label)}</option>)}
            </select>
          </label>
        </div>
        <Tabs value={breakdown} onChange={setBreakdown} className="-mb-px !border-b-0"
          items={BREAKDOWNS.map(b => ({ key: b.key, label: t(b.label) }))} />
      </div>
      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-fiba-muted">{t('budget.cashflowNoRows')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-2xs font-semibold uppercase tracking-wider text-fiba-muted border-b border-fiba-border">
                <th className="px-4 py-2 text-left">{t(active.header)}</th>
                {QUARTERS.map(q => <th key={q} className="px-4 py-2 text-right">Q{q}</th>)}
                <th className="px-4 py-2 text-right">{t('budget.total')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fiba-border">
              {rows.map(r => (
                <tr key={r.key ?? '__general__'} className="hover:bg-fiba-surface/40 transition-colors">
                  <td className="px-4 py-2.5 text-ink-900 dark:text-white">{name(r)}</td>
                  {r.values.map((v, i) => (
                    <td key={i} className={`px-4 py-2.5 text-right tabular-nums whitespace-nowrap ${v ? 'text-ink-900 dark:text-white' : 'text-fiba-muted'}`}>
                      {cell(v)}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap font-medium text-ink-900 dark:text-white">
                    {amount(r.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-fiba-border font-semibold text-ink-900 dark:text-white">
                <td className="px-4 py-2.5">{t('budget.total')}</td>
                {sums.map((v, i) => (
                  <td key={i} className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">{cell(v)}</td>
                ))}
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                  {amount(sums.reduce((a, b) => a + b, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

function ChartFallback({ t }) {
  return (
    <div aria-busy="true"
      className="h-[360px] mb-6 rounded-xl border border-ink-200 dark:border-navy-800 bg-ink-50 dark:bg-navy-900/60 animate-pulse flex items-center justify-center text-sm text-ink-500 dark:text-ink-400">
      {t('budget.chartLoading')}
    </div>
  )
}

export default function CashflowTab({ t, push, departments }) {
  const [year, setYearState] = useState(storedYear)
  const [department, setDepartment] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [exporting, setExporting] = useState(false)
  const { lang } = useLanguage()
  const years = useMemo(yearOptions, [])

  function setYear(y) {
    setYearState(y)
    rememberYear(y)
  }

  useEffect(() => {
    // Si el usuario cambia de año antes de que llegue la respuesta anterior,
    // la vieja no tiene que pisar a la nueva.
    let stale = false
    setLoading(true)
    setFailed(false)
    getBudgetCashflow(department ? { year, department } : { year })
      .then(d => { if (!stale) setData(d) })
      .catch(e => {
        console.error(e)
        if (stale) return
        // Sin esto quedarían en pantalla los montos del año anterior debajo
        // del selector nuevo, y "Exportar" bajaría otro año que el que se ve.
        setData(null)
        setFailed(true)
        push({ type: 'error', title: t('budget.cashflowLoadError') })
      })
      .finally(() => { if (!stale) setLoading(false) })
    return () => { stale = true }
  }, [year, department])

  // El backend recorta por departamento: un designado de IT exporta solo IT
  // aunque elija "todos".
  async function handleExport() {
    setExporting(true)
    try {
      await downloadBudgetCashflowXlsx({ year, department, lang })
    } catch (e) {
      console.error(e)
      push({ type: 'error', title: t('budget.exportError') })
    } finally {
      setExporting(false)
    }
  }

  const totals = data?.totals
  const empty = !totals || (!totals.budgeted && !totals.outflow && !totals.inflow)

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          aria-label={t('budget.cashflowYear')} className="fiba-select !w-auto min-w-[100px]">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={department} onChange={e => setDepartment(e.target.value)}
          aria-label={t('budget.department')} className="fiba-select !w-auto min-w-[200px]">
          <option value="">{t('budget.allDepartments')}</option>
          {departments.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
        </select>
        <div className="sm:ml-auto">
          <Button variant="secondary" icon={<Icon.Download />} disabled={exporting || empty}
            title={t('budget.exportCashflowHint')} onClick={handleExport}>
            {exporting ? t('budget.exportExporting') : t('budget.exportCashflow')}
          </Button>
        </div>
      </div>

      {loading && !data ? (
        <div className="text-fiba-muted text-sm py-8 text-center">{t('common.loading')}</div>
      ) : failed ? (
        <div className="rounded-xl border border-fiba-border py-12 text-center mb-8" role="alert">
          <p className="font-semibold text-ink-900 dark:text-white">{t('budget.cashflowLoadError')}</p>
        </div>
      ) : empty ? (
        <div className="rounded-xl border border-fiba-border py-12 text-center mb-8">
          <p className="font-semibold text-ink-900 dark:text-white">{t('budget.noSummary')}</p>
        </div>
      ) : (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <QuarterTable data={data} t={t} />
          <Suspense fallback={<ChartFallback t={t} />}>
            <CashflowChart quarters={data.quarters} t={t} />
          </Suspense>
          <Breakdown data={data} t={t} />
        </div>
      )}
    </div>
  )
}
