/**
 * Piezas compartidas por la bandeja de pagos.
 *
 * Payments dejó de ser la pantalla de los nominados y pasó a ser la bandeja
 * única del gasto de un evento (BUDGET_MODULE.md §14.10): las personas y el
 * gasto operativo sin persona. Son dos editores distintos sobre dos tablas
 * distintas, pero comparten el diálogo, la semántica de los campos y —lo que
 * importa— el desplegable de departamentos, que es donde se decide de qué área
 * sale la plata.
 */
import { useEffect, useRef } from 'react'

export function fmt(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function today() {
  return new Date().toISOString().slice(0, 10)
}

/** Fecha corta para los sellos de auditoría (aprobado el…). */
export function shortDate(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) : d.toLocaleDateString()
}

/* ─── Estados ────────────────────────────────────────────────────────────────
 *
 * Los dos ciclos siguen siendo distintos y a propósito: un pago a una persona
 * es el trámite bancario del legacy vbills (`new → in_process → split →
 * completed`) y un gasto es `draft → approved → paid`. La aprobación (fase 10)
 * es un eje aparte del status en las dos tablas.
 */
export const PAYMENT_STATUSES = ['new', 'in_process', 'split', 'completed']
export const PAYMENT_STATUS_BADGES = {
  new:        'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-500',
  in_process: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  split:      'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400',
  completed:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
}

export const EXPENSE_STATUSES = ['draft', 'approved', 'paid', 'rejected', 'cancelled']
export const EXPENSE_STATUS_BADGES = {
  draft:     'bg-ink-100 text-ink-700 dark:bg-navy-800 dark:text-ink-300',
  approved:  'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  paid:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
  rejected:  'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
  cancelled: 'bg-ink-100 text-ink-500 dark:bg-navy-800 dark:text-ink-400',
}

/* ─── Diálogo lateral ────────────────────────────────────────────────────────
 *
 * Es el `Drawer` de Budget con la semántica de diálogo que el editor de pagos
 * ya tenía: `role="dialog"`, Escape cierra, el foco entra adentro al abrir y
 * vuelve al control que lo abrió al cerrar. Sin lo último el foco se pierde en
 * el <body> y quien navega por teclado vuelve al principio de la página.
 */
export function Dialog({ titleId, title, subtitle, badge, closeLabel, onClose, children, footer }) {
  const panelRef = useRef(null)
  // `onClose` cambia de identidad en cada render del padre; el efecto corre una
  // sola vez (montar/desmontar), así que se lee por ref para no cerrar con una
  // versión vieja del callback.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const opener = document.activeElement
    const onKey = e => { if (e.key === 'Escape') closeRef.current?.() }
    document.addEventListener('keydown', onKey)
    panelRef.current?.querySelector('select, input, textarea, button')?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [])

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="fixed top-0 right-0 h-full w-full max-w-lg bg-fiba-card border-l border-fiba-border z-50 flex flex-col animate-slide-in">
        <div className="flex items-start justify-between p-6 border-b border-fiba-border">
          <div className="min-w-0">
            <h3 id={titleId} className="text-lg font-bold text-ink-900 dark:text-white truncate">{title}</h3>
            {subtitle && <p className="text-sm text-fiba-muted truncate">{subtitle}</p>}
            {badge && <div className="mt-2">{badge}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label={closeLabel}
            className="text-fiba-muted hover:text-ink-900 dark:hover:text-white text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">{children}</div>
        {footer && <div className="p-6 border-t border-fiba-border flex gap-3">{footer}</div>}
      </div>
    </>
  )
}

/* ─── Campos ─────────────────────────────────────────────────────────────────
 *
 * El error va AL LADO del campo y no a un toast: el panel scrollea y el botón
 * de guardar está al fondo, así que con adjuntos cargados los selects quedan
 * fuera de pantalla y el toast no dice cuál de los tres falta.
 */
export function Field({ id, label, error, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-fiba-muted mb-1">{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className="text-2xs text-fiba-muted mt-1">{hint}</p>}
      {error && <p id={`${id}-err`} className="text-xs text-danger-500 mt-1">{error}</p>}
    </div>
  )
}

/** Props de accesibilidad del control de un `Field` (id + estado de error). */
export function fieldProps(id, error, hint) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(' ')
  return {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
  }
}

/* ─── Departamentos ──────────────────────────────────────────────────────────
 *
 * `/payments/imputation` marca cada departamento con `can_edit` (fase 9): el
 * backend exige `budget_access` con edición sobre el área a la que se imputa, y
 * ofrecer en el desplegable lo que después va a rechazar con un 403 es la peor
 * forma de enterarse. Los que no se pueden usar se muestran igual pero
 * deshabilitados y agrupados aparte — esconderlos haría parecer que el
 * departamento no existe.
 *
 * El que ya está elegido nunca se deshabilita, aunque esté fuera de alcance: un
 * pago heredado tiene que seguir mostrando de dónde sale su plata.
 */
export function DepartmentSelect({
  id, value, onChange, departments, editableAll, disabled, error, hint, t,
  placeholder, className = 'fiba-select w-full',
}) {
  const editable = departments.filter(d => editableAll || d.can_edit)
  const locked = editableAll ? [] : departments.filter(d => !d.can_edit)
  const known = departments.some(d => d.code === value)
  const option = d => (
    <option key={d.code} value={d.code} disabled={!editableAll && !d.can_edit && d.code !== value}>
      {d.label}
    </option>
  )

  return (
    <select {...fieldProps(id, error, hint)} className={className} value={value} disabled={disabled}
      onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {/* Un departamento desactivado no viene en el catálogo, pero el pago
          histórico sigue colgando de él: sin esta opción el select mostraría
          vacío y guardar lo movería de área sin que nadie lo pidiera. */}
      {value && !known && <option value={value}>{value}</option>}
      {locked.length === 0 ? editable.map(option) : (
        <>
          <optgroup label={t('payments.yourDepartments')}>{editable.map(option)}</optgroup>
          <optgroup label={t('payments.lockedDepartments')}>{locked.map(option)}</optgroup>
        </>
      )}
    </select>
  )
}

/** ¿El usuario puede imputar plata a este departamento? */
export function canSpendOn(code, departments, editableAll) {
  if (editableAll) return true
  if (!code) return false
  return !!departments.find(d => d.code === code)?.can_edit
}
