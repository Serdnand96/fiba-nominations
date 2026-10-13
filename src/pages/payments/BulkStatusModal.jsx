/**
 * Cambio de estado en lote desde la cola de pagos
 * (`POST /payments/bulk-status`).
 *
 * El backend valida cada pago por separado y nunca aborta el lote: los que no
 * cumplen (sin fecha, sin W-8, CM pendiente, pago propio…) quedan como estaban
 * y vuelven en `failed[]`. Por eso el modal no se cierra al terminar: muestra
 * qué pasó y qué no, fila por fila, y el caller refresca la cola.
 */
import { useState } from 'react'
import { bulkPaymentStatus } from '../../api/client'
import { useLanguage } from '../../i18n/LanguageContext'
import { useAuth } from '../../contexts/AuthContext'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Icon } from '../../lib/icons'
import { STATUSES, STATUS_TONE, today, errorDetail, errorText } from './shared'

export default function BulkStatusModal({ ids, onClose, onDone }) {
  const { t } = useLanguage()
  const { isSuperadmin, hasView } = useAuth()
  const canApprove = isSuperadmin || hasView('payments_approve')

  // Destinos que el usuario puede llegar a pedir (el modal solo se abre con
  // `payments:edit`). `completed` exige además el permiso de aprobación. El
  // backend igual valida cada pago.
  const targets = STATUSES.filter(s => s !== 'completed' || canApprove)

  const [form, setForm] = useState(() => ({
    status: targets.includes('in_process') ? 'in_process' : (targets[0] || ''),
    payment_date: today(),
    bank_confirmation: '',
    reason: '',
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)    // { ok: [{id, record_no, status, warnings}], failed: [{id, record_no, error}] }

  const isCompleted = form.status === 'completed'
  const reasonRequired = form.status === 'cancelled'

  async function submit(e) {
    e.preventDefault()
    if (!form.status) return
    if (reasonRequired && !form.reason.trim()) { setError(t('payments.reasonRequired')); return }
    if (isCompleted && !form.payment_date) { setError(t('payments.dateRequired')); return }
    setBusy(true)
    setError('')
    try {
      const body = { ids, status: form.status }
      if (form.reason.trim()) body.reason = form.reason.trim()
      if (isCompleted) {
        body.payment_date = form.payment_date
        if (form.bank_confirmation.trim()) body.bank_confirmation = form.bank_confirmation.trim()
      }
      const res = await bulkPaymentStatus(body)
      setResult({ ok: res?.ok || [], failed: res?.failed || [] })
      await onDone?.(res)
    } catch (err) {
      setError(errorDetail(err, t('payments.transitionError')))
    }
    setBusy(false)
  }

  const footer = result ? (
    <Button variant="navy" onClick={onClose}>{t('common.close')}</Button>
  ) : (
    <>
      <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
      <Button type="submit" form="payments-bulk-status" variant={form.status === 'cancelled' ? 'danger' : 'navy'}
        disabled={busy || !form.status}>
        {busy ? t('common.saving') : t('payments.bulkApply', { count: ids.length })}
      </Button>
    </>
  )

  return (
    <Modal open onClose={onClose} closeDisabled={busy} size="md"
      title={t('payments.bulkTitle', { count: ids.length })}
      closeLabel={t('common.close')}
      footer={footer}>
      {result ? (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone="success" icon={<Icon.Check />}>{t('payments.bulkOk', { count: result.ok.length })}</Badge>
            {result.failed.length > 0 && (
              <Badge tone="danger" icon={<Icon.Alert />}>{t('payments.bulkFailed', { count: result.failed.length })}</Badge>
            )}
          </div>
          {result.failed.length > 0 && (
            <div className="rounded-lg border border-fiba-border overflow-hidden">
              <div className="overflow-x-auto max-h-72">
                <table className="fiba-table">
                  <thead>
                    <tr>
                      <th>{t('payments.record')}</th>
                      <th>{t('payments.bulkError')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.failed.map(f => (
                      <tr key={f.id}>
                        <td className="font-mono text-xs whitespace-nowrap">{f.record_no || f.id}</td>
                        <td className="text-sm text-danger-700 dark:text-danger-500">
                          {errorText(f.error)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {result.failed.length > 0 && <p className="text-xs text-fiba-muted">{t('payments.bulkFailedHint')}</p>}
          {result.ok.some(o => (o.warnings || []).length > 0) && (
            <p className="text-xs text-warning-700 dark:text-warning-500 flex gap-1.5">
              <Icon.Alert className="w-4 h-4 shrink-0" />
              {t('payments.bulkTaxWarnings', { count: result.ok.filter(o => (o.warnings || []).length > 0).length })}
            </p>
          )}
        </div>
      ) : (
        <form id="payments-bulk-status" onSubmit={submit} className="space-y-4">
          <p className="text-sm text-fiba-muted">{t('payments.bulkHint')}</p>
          <div>
            <label className="block text-xs text-fiba-muted mb-1">{t('payments.targetStatus')}</label>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('payments.targetStatus')}>
              {targets.map(s => {
                const active = form.status === s
                return (
                  <button key={s} type="button" role="radio" aria-checked={active}
                    onClick={() => { setForm(f => ({ ...f, status: s })); setError('') }}
                    className={`rounded-md border px-2.5 py-1.5 transition-colors ${active
                      ? 'border-navy-500 bg-navy-50 dark:border-navy-400 dark:bg-navy-800'
                      : 'border-ink-200 dark:border-navy-700 hover:bg-ink-50 dark:hover:bg-navy-800/60'}`}>
                    <Badge tone={STATUS_TONE[s]} size="sm">{t(`payments.statusLabel.${s}`)}</Badge>
                  </button>
                )
              })}
            </div>
          </div>

          {isCompleted && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-fiba-muted mb-1">{t('payments.paymentDate')} *</label>
                <input type="date" required value={form.payment_date}
                  onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))} className="fiba-input w-full" />
              </div>
              <div>
                <label className="block text-xs text-fiba-muted mb-1">{t('payments.bankConfirmation')}</label>
                <input value={form.bank_confirmation}
                  onChange={e => setForm(f => ({ ...f, bank_confirmation: e.target.value }))} className="fiba-input w-full" />
              </div>
              <p className="sm:col-span-2 text-[11px] text-fiba-muted/70 -mt-1">{t('payments.bulkPaidHint')}</p>
            </div>
          )}

          <div>
            <label className="block text-xs text-fiba-muted mb-1">
              {t('payments.reason')}{reasonRequired ? ' *' : ` (${t('payments.optional')})`}
            </label>
            <textarea rows={3} value={form.reason} required={reasonRequired}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} className="fiba-input w-full" />
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger-600 dark:text-danger-500 flex gap-1.5">
              <Icon.Alert className="w-4 h-4 shrink-0 mt-0.5" />{error}
            </p>
          )}
        </form>
      )}
    </Modal>
  )
}
