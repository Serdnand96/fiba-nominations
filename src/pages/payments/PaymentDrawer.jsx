/**
 * Detalle/editor del pago de un nominado: montos, transiciones de estado,
 * ficha bancaria, adjuntos e historial.
 *
 * - El estado NO se edita en el formulario: cambia solo con los botones de
 *   transición (`POST /payments/{id}/transition`). Los botones que se muestran
 *   salen de `validTransitions` (la tabla de la máquina de estados), pero el
 *   backend vuelve a validar y su respuesta es la que manda.
 * - En `completed` solo se editan comentarios, confirmación bancaria y monto
 *   pagado; en `cancelled`, nada (se reabre primero).
 * - Al crear un pago el drawer queda abierto sobre el pago recién guardado,
 *   para poder adjuntar archivos sin reabrirlo.
 *
 * `nominee` trae lo que la vista conoce de la persona: { nomination_id,
 * nominee_name, nominee_role, nomination_total, personnel_id?, cm_approved?,
 * confirmation_status?, tax_form_status?, payment }. Desde la cola viene
 * completo; desde "Por evento" falta `personnel_id`, así que con el pago ya
 * creado se completa con `GET /payments/{id}` (la fila aplanada de la cola).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  createPayment, updatePayment, deletePayment, transitionPayment, getPaymentHistory, getPayment,
  syncPaymentAmounts, getPaymentAttachments, uploadPaymentAttachment, deletePaymentAttachment,
  downloadPaymentAttachment, saveBlob,
} from '../../api/client'
import { useLanguage } from '../../i18n/LanguageContext'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/ui/Toast'
import { Drawer } from '../../components/ui/Drawer'
import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../lib/icons'
import AttachmentList from '../../components/AttachmentList'
import StatusHistory from '../../components/StatusHistory'
import { BankingSummary } from '../../components/BankingPanel'
import {
  ATTACHMENT_KINDS, STATUS_TONE, validTransitions, today, fmt, errorDetail, translateCode,
} from './shared'

const num = (v) => (v === '' || v == null ? null : Number(v))

function initialForm(nominee, budgets) {
  const p = nominee.payment
  if (p) {
    return {
      budget_code: p.budget_code || '',
      amount: p.amount ?? '',
      extra: p.extra ?? '0',
      airfare: p.airfare ?? '0',
      comments: p.comments || '',
      bank_confirmation: p.bank_confirmation || '',
      paid_amount: p.paid_amount ?? '',
    }
  }
  return {
    budget_code: budgets[0]?.code || '',
    amount: nominee.nomination_total ?? '',
    extra: '0',
    airfare: '0',
    comments: '',
    bank_confirmation: '',
    paid_amount: '',
  }
}

// Lo que cada estado deja mandar por PUT. Mandar un campo bloqueado haría que
// el backend rechace el guardado entero (409 en `completed`).
function updateBody(status, form) {
  const body = {
    comments: form.comments || null,
  }
  if (status === 'new' || status === 'in_process') {
    Object.assign(body, {
      budget_code: form.budget_code,
      amount: Number(form.amount || 0),
      extra: Number(form.extra || 0),
      airfare: Number(form.airfare || 0),
    })
  }
  if (status === 'in_process' || status === 'completed') {
    body.bank_confirmation = form.bank_confirmation || null
    if (form.paid_amount !== '' && form.paid_amount != null) body.paid_amount = Number(form.paid_amount)
  }
  return body
}

/**
 * Confirmación de una transición: pide lo que la transición necesita (motivo,
 * fecha de pago, monto pagado, confirmación bancaria) y avisa de antemano lo
 * que el backend va a rechazar.
 */
function TransitionModal({ action, payment, precheck, onClose, onDone }) {
  const { t } = useLanguage()
  const { push } = useToast()
  const needs = action.needs || {}
  const [form, setForm] = useState(() => ({
    reason: '',
    payment_date: payment.payment_date || today(),
    paid_amount: payment.paid_amount ?? payment.total ?? '',
    bank_confirmation: payment.bank_confirmation || '',
  }))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (needs.reason && !form.reason.trim()) { setError(t('payments.reasonRequired')); return }
    if (needs.date && !form.payment_date) { setError(t('payments.dateRequired')); return }
    setBusy(true)
    setError('')
    try {
      const body = { status: action.to }
      if (form.reason.trim()) body.reason = form.reason.trim()
      if (needs.date) body.payment_date = form.payment_date
      if (needs.paid) {
        if (form.bank_confirmation.trim()) body.bank_confirmation = form.bank_confirmation.trim()
        const paid = num(form.paid_amount)
        if (paid != null) body.paid_amount = paid
      }
      const res = await transitionPayment(payment.id, body)
      for (const w of res?.warnings || []) {
        push({ type: 'info', title: translateCode(t, 'payments.warning', w) })
      }
      await onDone(res?.payment || res)
    } catch (err) {
      const msg = errorDetail(err, t('payments.transitionError'))
      setError(msg)
      setBusy(false)
    }
  }

  const warnings = []
  if (action.override) warnings.push(t('payments.overrideWarning'))
  if (action.to === 'completed') {
    if (precheck.cmPending) warnings.push(t('payments.precheck.cmPending'))
    if (precheck.taxStatus === 'missing' || precheck.taxStatus === 'expired') warnings.push(t('payments.precheck.taxBlocks'))
  }
  if (action.to === 'in_process' && payment.status === 'new') {
    if (precheck.declined) warnings.push(t('payments.precheck.declined'))
    if (precheck.taxStatus === 'missing' || precheck.taxStatus === 'expired') warnings.push(t('payments.precheck.taxWarns'))
  }

  return (
    <Modal open onClose={onClose} closeDisabled={busy} size="sm"
      title={t(`payments.transition.${action.key}`)}
      subtitle={payment.record_no || undefined}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" form="payment-transition-form" variant={action.to === 'cancelled' ? 'danger' : 'navy'} disabled={busy}>
            {busy ? t('common.saving') : t('payments.transitionConfirm')}
          </Button>
        </>
      }>
      <form id="payment-transition-form" onSubmit={submit} className="space-y-3">
        {warnings.length > 0 && (
          <ul className="rounded-md border border-warning-500/40 bg-warning-50 dark:bg-warning-500/10 px-3 py-2 text-sm text-warning-700 dark:text-warning-500 space-y-1">
            {warnings.map(w => <li key={w} className="flex gap-1.5"><Icon.Alert className="w-4 h-4 shrink-0 mt-0.5" />{w}</li>)}
          </ul>
        )}
        {needs.date && (
          <div>
            <label className="block text-xs text-fiba-muted mb-1">{t('payments.paymentDate')} *</label>
            <input type="date" required value={form.payment_date}
              onChange={e => setForm(f => ({ ...f, payment_date: e.target.value }))} className="fiba-input w-full" />
          </div>
        )}
        {needs.paid && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-fiba-muted mb-1">{t('payments.paidAmount')}</label>
              <input type="number" step="0.01" min="0" value={form.paid_amount}
                onChange={e => setForm(f => ({ ...f, paid_amount: e.target.value }))} className="fiba-input w-full" />
              <p className="text-[11px] text-fiba-muted/70 mt-1">{t('payments.paidAmountHint')}</p>
            </div>
            <div>
              <label className="block text-xs text-fiba-muted mb-1">{t('payments.bankConfirmation')}</label>
              <input value={form.bank_confirmation}
                onChange={e => setForm(f => ({ ...f, bank_confirmation: e.target.value }))} className="fiba-input w-full" />
            </div>
          </div>
        )}
        <div>
          <label className="block text-xs text-fiba-muted mb-1">
            {t('payments.reason')}{needs.reason ? ' *' : ` (${t('payments.optional')})`}
          </label>
          <textarea rows={3} value={form.reason} required={!!needs.reason}
            onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} className="fiba-input w-full" />
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger-600 dark:text-danger-500 flex gap-1.5">
            <Icon.Alert className="w-4 h-4 shrink-0 mt-0.5" />{error}
          </p>
        )}
      </form>
    </Modal>
  )
}

export default function PaymentDrawer({ nominee, competitionName, budgets, canEdit, onClose, onSaved, onDeleted }) {
  const { t } = useLanguage()
  const { push } = useToast()
  const { user, isSuperadmin, hasView } = useAuth()
  const canApprove = isSuperadmin || hasView('payments_approve')

  const [payment, setPayment] = useState(nominee.payment || null)   // null = pago nuevo
  const [form, setForm] = useState(() => initialForm(nominee, budgets))
  const [attachments, setAttachments] = useState([])
  const [history, setHistory] = useState([])
  const [saving, setSaving] = useState(false)
  const [action, setAction] = useState(null)          // transición en curso (modal)
  const [taxStatus, setTaxStatus] = useState(nominee.tax_form_status || null)
  // Lo que se sabe de la persona y la nominación (badges, precheck, ficha).
  const [info, setInfo] = useState(() => ({
    personnel_id: nominee.personnel_id || null,
    cm_approved: nominee.cm_approved,
    confirmation_status: nominee.confirmation_status,
  }))

  const paymentId = payment?.id
  const status = payment?.status || 'new'

  // Abierto desde "Por evento": falta personnel_id. Con el pago ya guardado,
  // la fila de la cola lo trae (y el estado del W-8 de paso).
  useEffect(() => {
    if (!paymentId || info.personnel_id) return
    let alive = true
    getPayment(paymentId)
      .then(item => {
        if (!alive || !item) return
        setInfo(i => ({
          personnel_id: item.personnel_id || i.personnel_id,
          cm_approved: item.cm_approved ?? i.cm_approved,
          confirmation_status: item.confirmation_status ?? i.confirmation_status,
        }))
        if (item.tax_form_status) setTaxStatus(s => s || item.tax_form_status)
      })
      .catch(e => console.error(e))
    return () => { alive = false }
  }, [paymentId, info.personnel_id])

  const loadAttachments = useCallback(async (id) => {
    try { setAttachments(await getPaymentAttachments(id)) }
    catch (e) { console.error(e); setAttachments([]) }
  }, [])

  const loadHistory = useCallback(async (id) => {
    try { setHistory(await getPaymentHistory(id)) }
    catch (e) { console.error(e); setHistory([]) }
  }, [])

  useEffect(() => {
    if (!paymentId) { setAttachments([]); setHistory([]); return }
    loadAttachments(paymentId)
    loadHistory(paymentId)
  }, [paymentId, loadAttachments, loadHistory])

  const onBankingChange = useCallback((b) => {
    setTaxStatus(b && !b.error ? (b.tax_form_status || 'missing') : 'missing')
  }, [])

  // Qué se puede tocar en cada estado (UX; el backend aplica lo mismo).
  const readOnly = !canEdit || status === 'cancelled'
  const financialLocked = readOnly || status === 'completed'
  const isOwn = !!(payment?.created_by && user?.id && payment.created_by === user.id)
  const paidSoFar = Number(payment?.paid_amount || 0)
  const transitions = payment ? validTransitions(status, { canEdit, canApprove, isSuperadmin, isOwn, paidSoFar }) : []
  const ownBlocked = payment && status === 'in_process' && canEdit && canApprove && isOwn && !isSuperadmin

  const nominationTotal = nominee.nomination_total
  // Mismo criterio que `stale_amount` del backend: solo importa con el pago abierto.
  const isOpen = status === 'new' || status === 'in_process'
  const stale = !!payment && isOpen && nominationTotal != null
    && Math.abs(Number(payment.amount || 0) - Number(nominationTotal)) > 0.005
  const canSync = stale && canEdit
  const partial = status === 'in_process' && paidSoFar > 0

  async function handleSave(e) {
    e?.preventDefault()
    if (!form.budget_code) { push({ type: 'error', title: t('payments.budgetRequired') }); return }
    setSaving(true)
    try {
      let saved
      if (payment) {
        saved = await updatePayment(payment.id, updateBody(status, form))
      } else {
        saved = await createPayment({
          nomination_id: nominee.nomination_id,
          budget_code: form.budget_code,
          amount: Number(form.amount || 0),
          extra: Number(form.extra || 0),
          airfare: Number(form.airfare || 0),
          comments: form.comments || null,
        })
      }
      // El editor sigue abierto sobre el pago guardado (ya se le pueden adjuntar archivos).
      setPayment(p => ({ ...(p || {}), ...saved }))
      await onSaved?.(saved)
      push({ type: 'success', title: t('payments.saved') })
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, t('payments.errorSaving')) })
    }
    setSaving(false)
  }

  async function handleTransitionDone(row) {
    const next = { ...payment, ...(row || {}) }
    setPayment(next)
    setForm(f => ({
      ...f,
      bank_confirmation: next.bank_confirmation || '',
      paid_amount: next.paid_amount ?? '',
    }))
    setAction(null)
    loadHistory(next.id)
    push({ type: 'success', title: t('payments.transitionDone', { status: t(`payments.statusLabel.${next.status}`) }) })
    await onSaved?.(next)
  }

  async function handleSync() {
    try {
      const res = await syncPaymentAmounts([payment.id])
      const done = (res?.updated || []).find(u => u.id === payment.id)
      if (!done) {
        const skip = (res?.skipped || []).find(u => u.id === payment.id)
        push({ type: 'info', title: translateCode(t, 'payments.syncSkip', skip?.reason) || t('payments.syncError') })
        return
      }
      const amount = Number(done.new_amount ?? nominationTotal)
      const next = { ...payment, amount, total: amount + Number(payment.extra || 0) }
      setPayment(next)
      setForm(f => ({ ...f, amount }))
      await onSaved?.(next)
      push({ type: 'success', title: t('payments.syncDone', { count: 1 }) })
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, t('payments.syncError')) })
    }
  }

  async function handleDeletePayment() {
    if (!payment) return
    if (!confirm(t('payments.confirmDelete'))) return
    try {
      await deletePayment(payment.id)
      await onDeleted?.()
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, t('payments.errorSaving')) })
    }
  }

  async function handleUpload(file, kind) {
    if (!payment) return false
    try {
      await uploadPaymentAttachment(payment.id, file, kind)
      await loadAttachments(payment.id)
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, t('payments.errorUpload')) })
      return false
    }
  }

  async function handleDownload(att) {
    try {
      saveBlob(await downloadPaymentAttachment(att.id, att.file_name), att.file_name || 'attachment')
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, t('payments.errorDownload')) })
    }
  }

  async function handleDeleteAttachment(att) {
    if (!confirm(t('payments.confirmDeleteFile'))) return
    try {
      await deletePaymentAttachment(att.id)
      await loadAttachments(payment.id)
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, t('payments.errorSaving')) })
    }
  }

  const kindOptions = ATTACHMENT_KINDS.map(k => ({ value: k, label: t(`payments.attachmentKind.${k}`) }))
  const showSave = canEdit && status !== 'cancelled'
  const canDelete = canEdit && payment && (status === 'new' || status === 'cancelled')

  return (
    <Drawer
      title={nominee.nominee_name}
      subtitle={`${competitionName || ''}${payment?.record_no ? ` · ${payment.record_no}` : ''}`}
      onClose={onClose}
      closeLabel={t('common.close')}
    >
      {/* ── Estado + transiciones ─────────────────────────────────────── */}
      {payment && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={STATUS_TONE[status] || 'ink'}>{t(`payments.statusLabel.${status}`)}</Badge>
            {partial && <Badge tone="info" size="sm">{t('payments.partial')}</Badge>}
            {info.confirmation_status === 'declined' && <Badge tone="danger" size="sm">{t('payments.declined')}</Badge>}
            {info.cm_approved === false && <Badge tone="warning" size="sm">{t('payments.cmPending')}</Badge>}
            {stale && <Badge tone="warning" size="sm">{t('payments.staleBadge')}</Badge>}
          </div>

          {transitions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {transitions.map(a => (
                <Button key={a.key} size="sm" variant={a.variant} onClick={() => setAction(a)}>
                  {t(`payments.transition.${a.key}`)}
                </Button>
              ))}
            </div>
          )}
          {ownBlocked && <p className="text-xs text-fiba-muted">{t('payments.ownPaymentHint')}</p>}
          {status === 'in_process' && !canApprove && canEdit && (
            <p className="text-xs text-fiba-muted">{t('payments.needsApproveHint')}</p>
          )}
          {status === 'completed' && canEdit && (
            <p className="text-xs text-fiba-muted">{t('payments.completedLocked')}</p>
          )}
          {status === 'cancelled' && (
            <p className="text-xs text-fiba-muted">
              {t('payments.cancelledReadOnly')}
              {payment.cancel_reason && <><br /><span className="font-medium">{t('common.historyReason')}:</span> {payment.cancel_reason}</>}
            </p>
          )}
        </div>
      )}

      {/* ── Formulario ────────────────────────────────────────────────── */}
      <form onSubmit={handleSave} className={`space-y-4 ${payment ? 'pt-4 border-t border-fiba-border' : ''}`}>
        <div>
          <label className="block text-xs text-fiba-muted mb-1">{t('payments.budget')}</label>
          <select value={form.budget_code} disabled={financialLocked}
            onChange={e => setForm(f => ({ ...f, budget_code: e.target.value }))} className="fiba-select w-full">
            <option value="">{t('payments.selectBudget')}</option>
            {budgets.map(b => <option key={b.code} value={b.code}>{b.label}</option>)}
            {/* Un budget desactivado sigue mostrándose en los pagos que ya lo usan. */}
            {form.budget_code && !budgets.some(b => b.code === form.budget_code) && (
              <option value={form.budget_code}>{form.budget_code}</option>
            )}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-fiba-muted mb-1">{t('payments.amount')}</label>
            <input type="number" step="0.01" min="0" value={form.amount} disabled={financialLocked}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="fiba-input w-full" />
            <p className="text-[11px] text-fiba-muted/70 mt-1">
              {t('payments.fromNomination')}: {fmt(nominationTotal)}
              {canSync && (
                <button type="button" onClick={handleSync} className="ml-2 text-fiba-accent hover:underline">
                  {t('payments.syncThis')}
                </button>
              )}
            </p>
          </div>
          <div>
            <label className="block text-xs text-fiba-muted mb-1">{t('payments.extra')}</label>
            <input type="number" step="0.01" min="0" value={form.extra} disabled={financialLocked}
              onChange={e => setForm(f => ({ ...f, extra: e.target.value }))} className="fiba-input w-full" />
          </div>
        </div>

        {/* Airfare — tracked apart, does not add to the payment total */}
        <div className="rounded-lg border border-fiba-border p-3">
          <label className="block text-xs font-semibold text-ink-900 dark:text-white mb-1">{t('payments.airfare')}</label>
          <input type="number" step="0.01" min="0" value={form.airfare} disabled={financialLocked}
            onChange={e => setForm(f => ({ ...f, airfare: e.target.value }))} className="fiba-input w-full" />
          <p className="text-[11px] text-fiba-muted/70 mt-1">{t('payments.airfareHint')}</p>
        </div>

        {(status === 'in_process' || status === 'completed') && payment && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-fiba-muted mb-1">{t('payments.paidAmount')}</label>
              <input type="number" step="0.01" min="0" value={form.paid_amount} disabled={readOnly}
                onChange={e => setForm(f => ({ ...f, paid_amount: e.target.value }))} className="fiba-input w-full" />
              <p className="text-[11px] text-fiba-muted/70 mt-1">{t('payments.total')}: {fmt(payment.total)}</p>
            </div>
            <div>
              <label className="block text-xs text-fiba-muted mb-1">{t('payments.bankConfirmation')}</label>
              <input value={form.bank_confirmation} disabled={readOnly}
                onChange={e => setForm(f => ({ ...f, bank_confirmation: e.target.value }))} className="fiba-input w-full" />
            </div>
          </div>
        )}

        {payment?.payment_date && (
          <p className="text-sm text-ink-700 dark:text-ink-200">
            <span className="text-xs text-fiba-muted">{t('payments.paymentDate')}:</span>{' '}
            <span className="tabular-nums">{payment.payment_date}</span>
          </p>
        )}

        <div>
          <label className="block text-xs text-fiba-muted mb-1">{t('payments.comments')}</label>
          <textarea rows={3} value={form.comments} disabled={readOnly}
            onChange={e => setForm(f => ({ ...f, comments: e.target.value }))} className="fiba-input w-full" />
        </div>

        {(showSave || canDelete) && (
          <div className="flex flex-wrap gap-3">
            {showSave && (
              <Button type="submit" variant="navy" disabled={saving}>
                {saving ? t('common.saving') : (payment ? t('payments.save') : t('payments.create'))}
              </Button>
            )}
            {canDelete && (
              <Button type="button" variant="ghost" onClick={handleDeletePayment}
                className="!text-danger-600 dark:!text-danger-500">
                {t('payments.deletePayment')}
              </Button>
            )}
          </div>
        )}
      </form>

      {/* ── Ficha bancaria de la persona ──────────────────────────────── */}
      {info.personnel_id && (
        <div className="pt-4 border-t border-fiba-border">
          <h4 className="text-sm font-semibold text-ink-900 dark:text-white mb-2">{t('payments.banking.title')}</h4>
          <BankingSummary personnelId={info.personnel_id} onChange={onBankingChange} />
        </div>
      )}

      {/* ── Adjuntos (solo con el pago guardado) ──────────────────────── */}
      <div className="pt-4 border-t border-fiba-border">
        <h4 className="text-sm font-semibold text-ink-900 dark:text-white mb-2">{t('payments.attachments')}</h4>
        {!payment ? (
          <p className="text-xs text-fiba-muted/70">{t('payments.saveFirstForFiles')}</p>
        ) : (
          <AttachmentList
            items={attachments}
            kinds={kindOptions}
            canEdit={canEdit && status !== 'cancelled'}
            onUpload={handleUpload}
            onDownload={handleDownload}
            onDelete={handleDeleteAttachment}
            labels={{
              empty: t('payments.noFiles'),
              upload: t('payments.uploadFile'),
              remove: t('payments.removeFile'),
              kindPlaceholder: t('payments.attachmentKindPlaceholder'),
            }}
          />
        )}
      </div>

      {/* ── Historial de estados ─────────────────────────────────────── */}
      {payment && (
        <div className="pt-4 border-t border-fiba-border">
          <h4 className="text-sm font-semibold text-ink-900 dark:text-white mb-3">{t('common.historyTitle')}</h4>
          <StatusHistory items={history} />
        </div>
      )}

      {action && payment && (
        <TransitionModal
          action={action}
          payment={payment}
          precheck={{
            cmPending: info.cm_approved === false,
            declined: info.confirmation_status === 'declined',
            taxStatus,
          }}
          onClose={() => setAction(null)}
          onDone={handleTransitionDone}
        />
      )}
    </Drawer>
  )
}
