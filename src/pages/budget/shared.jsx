/**
 * Piezas compartidas por las pestañas de Budget.
 *
 * Estaban inline en `Budget.jsx` hasta que la pestaña de Eventos
 * presupuestarios (fase 8) necesitó las mismas: el panel de costo de un evento
 * es el mismo cálculo para una competencia del calendario y para una temporada,
 * así que el markup vive una sola vez y no dos que se van despegando.
 */

/** Clave de la columna/opción "sin evento" — ni competencia ni evento presup. */
export const GENERAL = '__general__'

export function money(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Panel lateral reutilizable — mismo patrón que el detalle de viajes en Empleados. */
export function Drawer({ title, subtitle, onClose, children, footer }) {
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
  //
  // "Usado" = ejecutado + comprometido, lo mismo que descuenta el restante
  // (fase 7). Sin esto una fila con restante negativo en rojo podía tener la
  // barra verde al lado: el sobregiro lo causaba lo comprometido y la barra
  // solo miraba lo ejecutado. Los dos segmentos siguen separados — verde lo
  // que ya salió, azul lo que está reservado.
  const used = e + c
  // Sin presupuesto pero con plata gastada la barra va llena y en rojo: antes
  // quedaba vacía al lado de un restante negativo, que es justo la
  // contradicción que la fase 7 vino a eliminar.
  const over = b > 0 ? used > b : used > 0
  const pct = b > 0 ? Math.min(100, (e / b) * 100) : (e > 0 ? 100 : 0)
  const cPct = b > 0 ? Math.min(100 - pct, (c / b) * 100) : (used > 0 && e <= 0 ? 100 : 0)
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-fiba-surface overflow-hidden flex">
        {/* Los dos segmentos se separan con un borde y el reservado va rayado:
            verde/azul contra el fondo dan 1.52:1 entre sí en tema claro —por
            debajo del 3:1 que pide WCAG 1.4.11— y verde↔rojo es el eje
            protan/deutan, así que el color solo no alcanza para distinguirlos. */}
        <div className={over ? 'bg-red-500' : 'bg-emerald-500'} style={{ width: `${pct}%` }} />
        <div
          className={`${over ? 'bg-red-500/70' : 'bg-blue-500/70'} ${cPct > 0 && pct > 0 ? 'border-l border-fiba-card' : ''}`}
          style={{
            width: `${cPct}%`,
            backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,.35) 0 2px, transparent 2px 4px)',
          }}
        />
      </div>
      <span className={`text-xs tabular-nums w-12 text-right ${over ? 'text-red-500 font-medium' : 'text-fiba-muted'}`}>
        {b > 0 ? `${Math.round((used / b) * 100)}%` : '—'}
      </span>
    </div>
  )
}

/**
 * Tabla de rollup: presupuestado / comprometido / ejecutado / restante.
 *
 * `label` cambia el encabezado de la primera columna — la misma tabla sirve
 * para departamentos, cuentas y fases de una temporada.
 */
export function RollupTable({ title, hint, rows, t, onRowClick, label }) {
  if (!rows?.length) return null
  return (
    <div className="rounded-xl border border-fiba-border overflow-hidden mb-6">
      <div className="px-4 py-2.5 bg-fiba-surface/60 border-b border-fiba-border">
        <h3 className="text-sm font-semibold text-ink-900 dark:text-white">{title}</h3>
        {hint && <p className="text-2xs text-fiba-muted mt-0.5">{hint}</p>}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-fiba-muted border-b border-fiba-border">
              <th className="px-4 py-2">{label || t('budget.department')}</th>
              <th className="px-4 py-2 text-right">{t('budget.budgeted')}</th>
              <th className="px-4 py-2 text-right">{t('budget.committed')}</th>
              <th className="px-4 py-2 text-right">{t('budget.executed')}</th>
              <th className="px-4 py-2 text-right" title={t('budget.remainingHint')}>{t('budget.remaining')}</th>
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

/* ─── Destino de una fila: competencia XOR evento presupuestario ─────────────
 *
 * Una línea o un gasto cuelga de UNA competencia del calendario o de UN evento
 * presupuestario, nunca de los dos: lo rechaza el backend con un 400 y lo
 * impide el CHECK de la migración 039. Por eso acá hay **un solo desplegable**
 * con las dos familias agrupadas, y no dos que se puedan llenar a la vez: la
 * combinación inválida no se puede ni tipear.
 *
 * El valor es una clave con prefijo (`comp:<uuid>` / `event:<uuid>`, vacío =
 * general) que `targetBody()` vuelve a partir en las dos columnas.
 */

/** La clave de destino de una fila que viene del backend. */
export function targetKey(row) {
  if (row?.competition_id) return `comp:${row.competition_id}`
  if (row?.budget_event_id) return `event:${row.budget_event_id}`
  return ''
}

/** La clave de vuelta en las dos columnas, con null explícito en la que no va. */
export function targetBody(value) {
  return {
    competition_id: value?.startsWith('comp:') ? value.slice(5) : null,
    budget_event_id: value?.startsWith('event:') ? value.slice(6) : null,
  }
}

/** Los filtros de los listados: general_only, competition_id o budget_event_id. */
export function targetParams(value) {
  if (value === GENERAL) return { general_only: true }
  const { competition_id, budget_event_id } = targetBody(value)
  if (competition_id) return { competition_id }
  if (budget_event_id) return { budget_event_id }
  return {}
}

/**
 * Un desplegable para las dos familias de destino.
 *
 * `fallbackLabel` cubre el caso del destino que no está en las listas —un
 * evento desactivado, o de un departamento fuera del alcance del usuario—: sin
 * esa opción el select mostraría "General" y guardar movería la fila de evento
 * sin que nadie lo pidiera.
 */
export function TargetSelect({
  value, onChange, competitions, budgetEvents, t,
  generalLabel, extraOption, fallbackLabel, className = 'fiba-select',
}) {
  const events = budgetEvents || []
  const known = value === '' || value === extraOption?.value
    || competitions.some(c => `comp:${c.id}` === value)
    || events.some(e => `event:${e.id}` === value)

  return (
    <select className={className} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{generalLabel ?? t('budget.general')}</option>
      {extraOption && <option value={extraOption.value}>{extraOption.label}</option>}
      {!known && <option value={value}>{fallbackLabel || t('budget.unknownTarget')}</option>}
      <optgroup label={t('budget.competitionsGroup')}>
        {competitions.map(c => <option key={c.id} value={`comp:${c.id}`}>{c.name}</option>)}
      </optgroup>
      {events.length > 0 && (
        <optgroup label={t('budget.budgetEventsGroup')}>
          {events.map(e => (
            <option key={e.id} value={`event:${e.id}`}>{e.name} ({e.year})</option>
          ))}
        </optgroup>
      )}
    </select>
  )
}
