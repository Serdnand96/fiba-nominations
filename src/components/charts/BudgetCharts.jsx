/**
 * Gráficos del dashboard de Budget (WP7).
 *
 * Es el único archivo que importa `recharts`. Se carga con React.lazy desde
 * `pages/budget/DashboardTab.jsx`, así recharts queda en el chunk `charts`
 * (vite.config.js) y ninguna otra página lo paga.
 *
 * Tres gráficos, todos sobre el mismo `/budget/summary`:
 *   1. Por departamento: presupuestado vs. ejecutado + comprometido apilados,
 *      con el % ejecutado debajo del nombre.
 *   2. Mensual acumulado: ejecutado (área) vs. presupuesto prorrateado
 *      linealmente (budgeted / 12 × mes) y comprometido (punteado).
 *   3. Top 10 cuentas: barras horizontales, no donut — diez porciones no se
 *      leen.
 *
 * Colores: recharts pinta con atributos SVG, no con clases, así que el modo
 * oscuro se resuelve en JS. Grilla y texto salen de las CSS variables
 * dark-aware del DS (`--c-fiba-border`, `--c-fiba-muted`, ver DESIGN_SYSTEM.md)
 * y las series de los tokens de `tailwind.config.js`. Un MutationObserver
 * sobre la clase de <html> repinta al cambiar de tema.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, Cell, ComposedChart, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { Card } from '../ui/Card'
import { Icon } from '../../lib/icons'
import { money } from '../../pages/budget/shared'

/* ───────────────────────────── Tema ───────────────────────────── */

// Hex de los tokens de tailwind.config.js. Las series usan el mismo código de
// color que la RollupTable: verde ejecutado, azul comprometido, rojo sobregiro.
const SERIES = {
  light: {
    budget: '#cbd2dc',    // ink-300
    executed: '#12b76a',  // success-500
    committed: '#2e90fa', // info-500
    over: '#f04438',      // danger-500
    pace: '#1a3668',      // navy-700
    strong: '#363c4c',    // ink-700
  },
  dark: {
    budget: '#335a9a',    // navy-500
    executed: '#12b76a',  // success-500
    committed: '#2e90fa', // info-500
    over: '#f04438',      // danger-500
    pace: '#cbd2dc',      // ink-300
    strong: '#f1f4f8',    // ink-100
  },
}

// `--c-fiba-*` guarda el triplete "r g b" (para el `/ <alpha-value>` de
// Tailwind); acá se arma el rgb() completo.
function cssRgb(styles, name, fallback) {
  const raw = styles.getPropertyValue(name).trim()
  return raw ? `rgb(${raw.split(/\s+/).join(', ')})` : fallback
}

function readTheme() {
  const root = document.documentElement
  const styles = getComputedStyle(root)
  const dark = root.classList.contains('dark')
  return {
    dark,
    grid: cssRgb(styles, '--c-fiba-border', dark ? '#1a3668' : '#e4e8ee'),
    text: cssRgb(styles, '--c-fiba-muted', dark ? '#9aa3b2' : '#6b7385'),
    ...SERIES[dark ? 'dark' : 'light'],
  }
}

function useChartTheme() {
  const [theme, setTheme] = useState(readTheme)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const next = readTheme()
      setTheme(prev => (prev.dark === next.dark ? prev : next))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return theme
}

// En mobile los nombres largos se comen el ancho de las barras: el eje Y se
// angosta y el texto se recorta (el nombre completo queda en el tooltip).
function useWide(query = '(min-width: 640px)') {
  const [wide, setWide] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setWide(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return wide
}

/* ─────────────────────────── Formato ─────────────────────────── */

function trimNumber(x) {
  return Math.abs(x) >= 100 ? String(Math.round(x)) : String(Number(x.toFixed(1)))
}

/** Eje compacto: $950, $12k, $1.6M. */
export function compactMoney(n) {
  const v = Number(n) || 0
  const a = Math.abs(v)
  if (a >= 1e6) return `$${trimNumber(v / 1e6)}M`
  if (a >= 1e3) return `$${trimNumber(v / 1e3)}k`
  return `$${Math.round(v)}`
}

function clip(text, max) {
  const s = String(text ?? '')
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

const round2 = (n) => Math.round(n * 100) / 100
const num = (n) => Number(n) || 0

/* ─────────────────────────── Datos ─────────────────────────── */

function departmentRows(rows, t) {
  return (rows || [])
    .filter(r => r.budgeted || r.executed || r.committed)
    .map(r => {
      const budgeted = num(r.budgeted)
      const executed = num(r.executed)
      const name = r.general ? t('budget.general') : (r.label || r.key)
      return {
        name,
        full: name,
        budgeted,
        executed,
        committed: num(r.committed),
        // Mismo criterio que `Bar` de shared.jsx: sin presupuesto, cualquier
        // gasto es sobregiro y no hay porcentaje.
        over: budgeted > 0 ? executed > budgeted : executed > 0,
        pct: budgeted > 0 ? Math.round((executed / budgeted) * 100) : null,
      }
    })
}

function monthlyRows(byMonth, budgeted, year, monthsShort) {
  if (!Array.isArray(byMonth) || byMonth.length === 0) return []
  const perMonth = Array.from({ length: 12 }, () => ({ executed: 0, committed: 0 }))
  for (const m of byMonth) {
    const idx = Number(String(m.month || '').slice(5, 7)) - 1
    if (idx < 0 || idx > 11) continue
    perMonth[idx].executed += num(m.executed)
    perMonth[idx].committed += num(m.committed)
  }

  let lastExecuted = -1
  perMonth.forEach((m, i) => { if (m.executed) lastExecuted = i })
  const hasActivity = lastExecuted >= 0 || perMonth.some(m => m.committed)
  if (!hasActivity && !budgeted) return []

  // El área de ejecutado se corta en el mes actual (o en el último mes con
  // gasto, si hay pagos fechados adelante): seguirla plana hasta diciembre se
  // lee como "no se va a gastar nada más". En un año futuro no se dibuja.
  const now = new Date()
  const thisYear = now.getFullYear()
  const executedUntil = year < thisYear ? 11
    : year === thisYear ? Math.max(now.getMonth(), lastExecuted)
    : lastExecuted

  let executedCum = 0
  let committedCum = 0
  return perMonth.map((m, i) => {
    executedCum += m.executed
    committedCum += m.committed
    return {
      name: monthsShort?.[i] ?? String(i + 1),
      executed: i <= executedUntil ? round2(executedCum) : null,
      committed: round2(committedCum),
      pace: round2((budgeted / 12) * (i + 1)),
    }
  })
}

function accountRows(rows, t) {
  return (rows || [])
    .filter(r => r.budgeted || r.executed)
    .map(r => {
      const budgeted = num(r.budgeted)
      const executed = num(r.executed)
      const name = r.general ? t('budget.general') : (r.label || r.key)
      return {
        name,
        full: r.key && !r.general ? `${r.key} — ${name}` : name,
        budgeted,
        executed,
        over: budgeted > 0 ? executed > budgeted : executed > 0,
      }
    })
    // Por ejecutado; en un año sin gasto todavía (presupuesto recién cargado)
    // desempata el presupuestado, así el top sigue diciendo algo.
    .sort((a, b) => b.executed - a.executed || b.budgeted - a.budgeted)
    .slice(0, 10)
}

/* ─────────────────────── Piezas compartidas ─────────────────────── */

function ChartCard({ title, hint, className = '', children }) {
  return (
    <Card padding="p-4 sm:p-5" className={`min-w-0 ${className}`}>
      <h3 className="text-sm font-semibold text-ink-900 dark:text-white">{title}</h3>
      {hint && <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">{hint}</p>}
      <div className="mt-4">{children}</div>
    </Card>
  )
}

function ChartEmpty({ t, height = 200 }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 text-sm text-ink-500 dark:text-ink-400"
      style={{ height }}>
      <Icon.Report className="w-6 h-6 opacity-60" />
      {t('budget.chartEmpty')}
    </div>
  )
}

/** Leyenda en HTML: hereda tipografía y modo oscuro del DS. */
function LegendRow({ items }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-ink-500 dark:text-ink-400">
      {items.map(item => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          {item.line ? (
            <span className="w-4 h-0 border-t-2"
              style={{ borderColor: item.color, borderTopStyle: item.dashed ? 'dashed' : 'solid' }} />
          ) : (
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: item.color }} />
          )}
          {item.label}
        </span>
      ))}
    </div>
  )
}

/** Tooltip con las clases del DS (dark-aware) y montos con money(). */
function ChartTooltip({ active, payload, label, theme, footer }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload || {}
  return (
    <div className="rounded-lg border border-ink-200 dark:border-navy-700 bg-white dark:bg-navy-800 shadow-pop px-3 py-2 text-xs min-w-[180px]">
      <div className="font-semibold text-ink-900 dark:text-white mb-1.5">{row.full || label}</div>
      {payload.filter(p => p.value != null).map(p => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
          <span className="inline-flex items-center gap-1.5 text-ink-500 dark:text-ink-400">
            <span className="w-2 h-2 rounded-sm"
              style={{ background: p.dataKey === 'executed' && row.over ? theme.over : p.color }} />
            {p.name}
          </span>
          <span className="num font-medium text-ink-900 dark:text-white">${money(p.value)}</span>
        </div>
      ))}
      {footer ? footer(row) : null}
    </div>
  )
}

/** Tick del eje Y por departamento: nombre arriba, % ejecutado abajo. */
function DepartmentTick({ x, y, payload, rows, theme, t, maxChars }) {
  const row = rows.find(r => r.name === payload?.value)
  const pctLabel = row?.pct != null ? t('budget.chartPctExecuted', { pct: row.pct }) : t('budget.chartNoBudget')
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={-8} y={0} dy={-3} textAnchor="end" fill={theme.strong} fontSize={12} fontWeight={500}>
        <title>{payload?.value}</title>
        {clip(payload?.value, maxChars)}
      </text>
      <text x={-8} y={0} dy={11} textAnchor="end" fontSize={11}
        fill={row?.over ? theme.over : theme.text} fontWeight={row?.over ? 600 : 400}>
        {pctLabel}
      </text>
    </g>
  )
}

function AccountTick({ x, y, payload, theme, maxChars }) {
  return (
    <text x={x} y={y} dx={-8} dy={4} textAnchor="end" fill={theme.strong} fontSize={12}>
      <title>{payload?.value}</title>
      {clip(payload?.value, maxChars)}
    </text>
  )
}

const axisTick = (theme) => ({ fill: theme.text, fontSize: 11 })

/* ─────────────────────────── Gráficos ─────────────────────────── */

function DepartmentChart({ rows, theme, t, wide }) {
  if (!rows.length) return <ChartEmpty t={t} />
  const height = Math.max(180, rows.length * 60 + 32)
  return (
    <>
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 480, height }}>
        <BarChart data={rows} layout="vertical" barGap={3} barCategoryGap="24%"
          margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid horizontal={false} stroke={theme.grid} />
          <XAxis type="number" tickFormatter={compactMoney} tick={axisTick(theme)}
            axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={wide ? 132 : 100}
            axisLine={false} tickLine={false} interval={0}
            tick={<DepartmentTick rows={rows} theme={theme} t={t} maxChars={wide ? 18 : 13} />} />
          <Tooltip cursor={{ fill: theme.grid, fillOpacity: 0.35 }}
            content={<ChartTooltip theme={theme} footer={row => (
              <div className={`mt-1.5 pt-1.5 border-t border-ink-200 dark:border-navy-700 ${row.over ? 'text-danger-600 dark:text-danger-500 font-semibold' : 'text-ink-500 dark:text-ink-400'}`}>
                {row.pct != null ? t('budget.chartPctExecuted', { pct: row.pct }) : t('budget.chartNoBudget')}
              </div>
            )} />} />
          <Bar dataKey="budgeted" name={t('budget.budgeted')} fill={theme.budget}
            barSize={12} radius={[0, 3, 3, 0]} isAnimationActive={false} />
          <Bar dataKey="executed" name={t('budget.executed')} stackId="used" fill={theme.executed}
            barSize={12} isAnimationActive={false}>
            {rows.map(r => <Cell key={r.name} fill={r.over ? theme.over : theme.executed} />)}
          </Bar>
          <Bar dataKey="committed" name={t('budget.committed')} stackId="used" fill={theme.committed}
            barSize={12} radius={[0, 3, 3, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <LegendRow items={[
        { label: t('budget.budgeted'), color: theme.budget },
        { label: t('budget.executed'), color: theme.executed },
        { label: t('budget.committed'), color: theme.committed },
        { label: t('budget.overBudget'), color: theme.over },
      ]} />
    </>
  )
}

function MonthlyChart({ rows, theme, t }) {
  if (!rows.length) return <ChartEmpty t={t} height={260} />
  const height = 260
  return (
    <>
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 480, height }}>
        <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="budget-executed-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.executed} stopOpacity={theme.dark ? 0.35 : 0.25} />
              <stop offset="100%" stopColor={theme.executed} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={theme.grid} />
          <XAxis dataKey="name" tick={axisTick(theme)} axisLine={{ stroke: theme.grid }} tickLine={false} />
          <YAxis tickFormatter={compactMoney} tick={axisTick(theme)} axisLine={false} tickLine={false} width={52} />
          <Tooltip cursor={{ stroke: theme.text, strokeDasharray: '3 3' }}
            content={<ChartTooltip theme={theme} />} />
          <Area type="monotone" dataKey="executed" name={t('budget.chartExecutedCum')}
            stroke={theme.executed} strokeWidth={2} fill="url(#budget-executed-fill)"
            dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
          <Line type="linear" dataKey="pace" name={t('budget.chartPace')}
            stroke={theme.pace} strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="committed" name={t('budget.chartCommittedCum')}
            stroke={theme.committed} strokeWidth={2} strokeDasharray="5 4"
            dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <LegendRow items={[
        { label: t('budget.chartExecutedCum'), color: theme.executed },
        { label: t('budget.chartPace'), color: theme.pace, line: true },
        { label: t('budget.chartCommittedCum'), color: theme.committed, line: true, dashed: true },
      ]} />
    </>
  )
}

function AccountsChart({ rows, theme, t, wide }) {
  if (!rows.length) return <ChartEmpty t={t} />
  const height = Math.max(180, rows.length * 42 + 32)
  return (
    <>
      <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 720, height }}>
        <BarChart data={rows} layout="vertical" barGap={2} barCategoryGap="22%"
          margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid horizontal={false} stroke={theme.grid} />
          <XAxis type="number" tickFormatter={compactMoney} tick={axisTick(theme)}
            axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={wide ? 200 : 112}
            axisLine={false} tickLine={false} interval={0}
            tick={<AccountTick theme={theme} maxChars={wide ? 28 : 15} />} />
          <Tooltip cursor={{ fill: theme.grid, fillOpacity: 0.35 }}
            content={<ChartTooltip theme={theme} />} />
          <Bar dataKey="budgeted" name={t('budget.budgeted')} fill={theme.budget}
            barSize={10} radius={[0, 3, 3, 0]} isAnimationActive={false} />
          <Bar dataKey="executed" name={t('budget.executed')} fill={theme.executed}
            barSize={10} radius={[0, 3, 3, 0]} isAnimationActive={false}>
            {rows.map(r => <Cell key={r.full} fill={r.over ? theme.over : theme.executed} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <LegendRow items={[
        { label: t('budget.budgeted'), color: theme.budget },
        { label: t('budget.executed'), color: theme.executed },
        { label: t('budget.overBudget'), color: theme.over },
      ]} />
    </>
  )
}

/* ─────────────────────────── Export ─────────────────────────── */

export default function BudgetCharts({ summary, t }) {
  const theme = useChartTheme()
  const wide = useWide()

  const departments = useMemo(() => departmentRows(summary?.by_department, t), [summary, t])
  const months = useMemo(
    () => monthlyRows(summary?.by_month, num(summary?.totals?.budgeted), Number(summary?.year), t('months.short')),
    [summary, t],
  )
  const accounts = useMemo(() => accountRows(summary?.by_account, t), [summary, t])

  // Mobile: una columna. Desktop: departamentos + mensual lado a lado y el
  // top de cuentas abajo a todo el ancho.
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
      <ChartCard title={t('budget.chartByDepartment')}>
        <DepartmentChart rows={departments} theme={theme} t={t} wide={wide} />
      </ChartCard>
      <ChartCard title={t('budget.chartMonthly')} hint={t('budget.chartMonthlyHint')}>
        <MonthlyChart rows={months} theme={theme} t={t} />
      </ChartCard>
      <ChartCard title={t('budget.chartTopAccounts')} className="xl:col-span-2">
        <AccountsChart rows={accounts} theme={theme} t={t} wide={wide} />
      </ChartCard>
    </div>
  )
}
