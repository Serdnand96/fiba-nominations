// Piezas compartidas por las pestañas de Pagos.
//
// Los estados salen de la migración 047: `split` dejó de existir (lo reemplaza
// `paid_amount` + el badge "parcial" en `in_process`) y aparece `cancelled`.

export const STATUSES = ['new', 'in_process', 'completed', 'cancelled']

// Tono de <Badge> por estado. Badge ya es dark-aware; mismo criterio que
// StatusHistory para que la fila y la timeline hablen el mismo color.
export const STATUS_TONE = {
  new:        'ink',
  in_process: 'warning',
  completed:  'success',
  cancelled:  'outline',
}

// Documento fiscal de la persona (`tax_form_status` del backend).
export const TAX_FORM_TONE = {
  ok:      'success',
  missing: 'warning',
  expired: 'danger',
  exempt:  'ink',
}

export const TAX_FORM_KINDS = ['W-8BEN', 'W-8BEN-E', 'W-9', 'exempt']

// Etiquetas cerradas de los adjuntos de un pago (CHECK de la migración 047).
export const ATTACHMENT_KINDS = ['EXPENSES', 'W8', 'BANK_INFO', 'INVOICE', 'RECEIPT', 'OTHER']

export const PAGE_SIZE = 50

/**
 * Transiciones que se ofrecen como botón desde un estado.
 *
 * Es la tabla de la máquina de estados del backend
 * (`check_payment_transition`), solo para decidir qué botones mostrar: el
 * backend vuelve a validar todo y su respuesta es la que manda.
 *
 * `needs` dice qué pide el modal de confirmación:
 *   reason → motivo obligatorio · date → fecha de pago · paid → monto pagado
 *   y confirmación bancaria.
 * `override` marca a un superadmin completando un pago que cargó él mismo:
 * se permite, pero con motivo obligatorio (queda en el historial).
 *
 * Todo endpoint de transición exige `payments:edit`; completar exige además
 * `payments_approve` (o superadmin). Con plata ya pagada (`paidSoFar > 0`) un
 * pago en proceso no vuelve a `new` ni se cancela: se completa con lo pagado.
 */
export function validTransitions(status, { canEdit, canApprove, isSuperadmin, isOwn, paidSoFar = 0 }) {
  const out = []
  if (!canEdit) return out
  switch (status) {
    case 'new':
      out.push({ to: 'in_process', key: 'start', variant: 'navy', needs: {} })
      out.push({ to: 'cancelled', key: 'cancel', variant: 'secondary', needs: { reason: true } })
      break
    case 'in_process':
      if (canApprove && (!isOwn || isSuperadmin)) {
        const override = isOwn && isSuperadmin
        out.push({ to: 'completed', key: 'complete', variant: 'primary', needs: { date: true, paid: true, reason: override }, override })
      }
      if (!(paidSoFar > 0)) {
        out.push({ to: 'new', key: 'backToNew', variant: 'secondary', needs: {} })
        out.push({ to: 'cancelled', key: 'cancel', variant: 'secondary', needs: { reason: true } })
      }
      break
    case 'cancelled':
      out.push({ to: 'new', key: 'reopen', variant: 'secondary', needs: {} })
      break
    case 'completed':
      if (isSuperadmin) out.push({ to: 'in_process', key: 'revert', variant: 'secondary', needs: { reason: true } })
      break
    default:
      break
  }
  return out
}

// Vencimiento por defecto de un W-8: 31/12 del tercer año calendario
// siguiente a la firma (firmado el 2026-03-10 → vence 2029-12-31).
export function defaultTaxFormExpiry(signedAt) {
  const year = Number(String(signedAt || '').slice(0, 4))
  if (!year) return ''
  return `${year + 3}-12-31`
}

export function today() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Texto de un error que llegó dentro de un resultado por ítem (`failed[].error`):
// suele ser el `detail` de un HTTPException, string o dict.
export function errorText(e) {
  if (e == null) return ''
  if (typeof e === 'string') return e
  return e.message || e.code || JSON.stringify(e)
}

// Traduce un código del backend (`reason` de skipped, `error` de failed,
// `warnings[]`) si hay clave; si no, muestra el texto tal cual llegó.
export function translateCode(t, prefix, code) {
  if (!code) return ''
  const key = `${prefix}.${code}`
  const label = t(key)
  return label === key ? code : label
}

// Mensaje de error de axios: `detail` puede ser string o dict (p. ej. 422 con
// `{code, ...}`), o una lista de errores de validación de FastAPI.
export function errorDetail(err, fallback) {
  const d = err?.response?.data?.detail
  if (!d) return fallback
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map(x => x?.msg || String(x)).join(' · ')
  return d.message || d.code || fallback
}

export function fmt(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
