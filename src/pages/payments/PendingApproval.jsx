/**
 * Bandeja de aprobación del evento (fase 10).
 *
 * `GET /payments/pending-approval` ya viene recortado a los departamentos que
 * el usuario puede aprobar: a diferencia del resto de las lecturas de Payments
 * —que muestran el evento entero— esta filtra, porque es una bandeja de trabajo
 * y ver ahí lo que no podés aprobar es solo ruido.
 *
 * Va arriba de la bandeja principal y **plegada**: si tapara la tabla, quien
 * entra a cargar un pago tendría que cerrarla todas las veces. El encabezado
 * dice cuántos y cuánto, que es lo que hace falta para decidir si abrirla.
 */
import { useId, useState } from 'react'
import { approvePayment } from '../../api/client'
import { Icon } from '../../lib/icons'
import { fmt, PAYMENT_STATUS_BADGES } from './shared'

export default function PendingApproval({ pending, departments, canEdit, t, push, onOpenPayment, onChanged }) {
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const listId = useId()

  if (!pending?.count) return null

  async function handleApprove(payment) {
    setBusyId(payment.id)
    try {
      await approvePayment(payment.id)
      push({ type: 'success', title: t('payments.approvedOk') })
      onChanged()
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('payments.errorSaving') })
    }
    setBusyId(null)
  }

  return (
    <section className="rounded-xl border border-warning-500/40 bg-warning-50/70 dark:bg-warning-500/10 mb-6">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Icon.Clock className="w-5 h-5 text-warning-600 dark:text-warning-500 flex-shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900 dark:text-white">
            {t('payments.pendingApprovalTitle')}
          </p>
          <p className="text-xs text-fiba-muted">
            {pending.count} {t('payments.pendingCount')} · ${fmt(pending.total)} · {t('payments.pendingScopeHint')}
          </p>
        </div>
        <button onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls={listId}
          className="ml-auto px-3 py-1.5 text-sm rounded-lg border border-warning-500/50 text-warning-700 dark:text-warning-500 hover:bg-warning-500/10">
          {open ? t('payments.hideList') : t('payments.reviewPending')}
        </button>
      </div>

      {open && (
        <div id={listId} className="border-t border-warning-500/30 divide-y divide-warning-500/20">
          {pending.payments.map(p => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900 dark:text-white truncate">
                  {p.nominee_name || '—'}
                </p>
                <p className="text-2xs text-fiba-muted">
                  {departments?.find(d => d.code === p.department_code)?.label || p.department_code || '—'}
                  {p.record_no ? ` · ${p.record_no}` : ''}
                </p>
              </div>
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${PAYMENT_STATUS_BADGES[p.status] || ''}`}>
                {t(`payments.statusLabel.${p.status}`)}
              </span>
              <span className="tabular-nums text-sm text-ink-900 dark:text-white w-28 text-right">
                ${fmt(Number(p.total || 0) + Number(p.airfare || 0))}
              </span>
              <div className="flex gap-2">
                {onOpenPayment && (
                  <button onClick={() => onOpenPayment(p)}
                    aria-label={`${t('payments.manage')}: ${p.nominee_name || ''}`}
                    className="px-2.5 py-1 text-xs rounded-lg border border-fiba-border text-fiba-muted hover:text-ink-900 dark:hover:text-white">
                    {t('payments.manage')}
                  </button>
                )}
                {canEdit && (
                  <button onClick={() => handleApprove(p)} disabled={busyId === p.id}
                    aria-label={`${t('payments.approve')}: ${p.nominee_name || ''}`}
                    className="px-2.5 py-1 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                    {t('payments.approve')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
