/**
 * Editor del pago de un nominado: monto, extra, pasaje, estado y adjuntos.
 *
 * El drawer es dueño de su formulario. Al crear un pago se queda abierto sobre
 * el pago recién guardado, para poder adjuntar archivos sin reabrirlo.
 */
import { useEffect, useState } from 'react'
import {
  createPayment, updatePayment, deletePayment,
  getPaymentAttachments, uploadPaymentAttachment, deletePaymentAttachment,
  downloadPaymentAttachment, saveBlob,
} from '../../api/client'
import { useLanguage } from '../../i18n/LanguageContext'
import { useToast } from '../../components/ui/Toast'
import { Drawer } from '../../components/ui/Drawer'
import AttachmentList from '../../components/AttachmentList'
import { STATUSES, fmt } from './shared'

function initialForm(nominee, budgets) {
  const p = nominee.payment
  if (p) {
    return {
      budget_code: p.budget_code || '',
      amount: p.amount ?? '',
      extra: p.extra ?? '0',
      airfare: p.airfare ?? '0',
      comments: p.comments || '',
      status: p.status || 'new',
    }
  }
  return {
    budget_code: budgets[0]?.code || '',
    amount: nominee.nomination_total ?? '',
    extra: '0',
    airfare: '0',
    comments: '',
    status: 'new',
  }
}

export default function PaymentDrawer({ nominee, competitionName, budgets, canEdit, onClose, onSaved, onDeleted }) {
  const { t } = useLanguage()
  const { push } = useToast()

  const [payment, setPayment] = useState(nominee.payment || null)   // null = pago nuevo
  const [form, setForm] = useState(() => initialForm(nominee, budgets))
  const [attachments, setAttachments] = useState([])
  const [saving, setSaving] = useState(false)

  const paymentId = payment?.id

  useEffect(() => {
    if (!paymentId) { setAttachments([]); return }
    loadAttachments(paymentId)
  }, [paymentId])

  async function loadAttachments(id) {
    try { setAttachments(await getPaymentAttachments(id)) }
    catch (e) { console.error(e); setAttachments([]) }
  }

  async function handleSave(e) {
    e?.preventDefault()
    if (!form.budget_code) { push({ type: 'error', title: t('payments.budgetRequired') }); return }
    setSaving(true)
    try {
      const body = {
        budget_code: form.budget_code,
        amount: Number(form.amount || 0),
        extra: Number(form.extra || 0),
        airfare: Number(form.airfare || 0),
        comments: form.comments || null,
        status: form.status,
      }
      let saved
      if (payment) {
        saved = await updatePayment(payment.id, body)
      } else {
        saved = await createPayment({ nomination_id: nominee.nomination_id, ...body })
      }
      // El editor sigue abierto sobre el pago guardado (ya se le pueden adjuntar archivos).
      setPayment(saved)
      await onSaved?.(saved)
    } catch (err) {
      push({ type: 'error', title: err.response?.data?.detail || t('payments.errorSaving') })
    }
    setSaving(false)
  }

  async function handleDeletePayment() {
    if (!payment) return
    if (!confirm(t('payments.confirmDelete'))) return
    try {
      await deletePayment(payment.id)
      await onDeleted?.()
    } catch (err) {
      push({ type: 'error', title: err.response?.data?.detail || t('payments.errorSaving') })
    }
  }

  async function handleUpload(file, kind) {
    if (!payment) return false
    try {
      await uploadPaymentAttachment(payment.id, file, kind)
      await loadAttachments(payment.id)
    } catch (err) {
      push({ type: 'error', title: err.response?.data?.detail || t('payments.errorUpload') })
      return false
    }
  }

  async function handleDownload(att) {
    try {
      saveBlob(await downloadPaymentAttachment(att.id, att.file_name), att.file_name || 'attachment')
    } catch (err) {
      push({ type: 'error', title: err.response?.data?.detail || t('payments.errorDownload') })
    }
  }

  async function handleDeleteAttachment(att) {
    if (!confirm(t('payments.confirmDeleteFile'))) return
    try {
      await deletePaymentAttachment(att.id)
      await loadAttachments(payment.id)
    } catch (err) {
      push({ type: 'error', title: err.response?.data?.detail || t('payments.errorSaving') })
    }
  }

  return (
    <Drawer
      title={nominee.nominee_name}
      subtitle={`${competitionName || ''}${payment?.record_no ? ` · ${payment.record_no}` : ''}`}
      onClose={onClose}
      closeLabel={t('common.close')}
    >
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="block text-xs text-fiba-muted mb-1">{t('payments.budget')}</label>
          <select value={form.budget_code} disabled={!canEdit}
            onChange={e => setForm(f => ({ ...f, budget_code: e.target.value }))} className="fiba-select w-full">
            <option value="">{t('payments.selectBudget')}</option>
            {budgets.map(b => <option key={b.code} value={b.code}>{b.label}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-fiba-muted mb-1">{t('payments.amount')}</label>
            <input type="number" step="0.01" value={form.amount} disabled={!canEdit}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="fiba-input w-full" />
            <p className="text-[11px] text-fiba-muted/70 mt-1">{t('payments.fromNomination')}: {fmt(nominee.nomination_total)}</p>
          </div>
          <div>
            <label className="block text-xs text-fiba-muted mb-1">{t('payments.extra')}</label>
            <input type="number" step="0.01" value={form.extra} disabled={!canEdit}
              onChange={e => setForm(f => ({ ...f, extra: e.target.value }))} className="fiba-input w-full" />
          </div>
        </div>

        {/* Airfare — tracked apart, does not add to the payment total */}
        <div className="rounded-lg border border-fiba-border p-3">
          <label className="block text-xs font-semibold text-ink-900 dark:text-white mb-1">{t('payments.airfare')}</label>
          <input type="number" step="0.01" value={form.airfare} disabled={!canEdit}
            onChange={e => setForm(f => ({ ...f, airfare: e.target.value }))} className="fiba-input w-full" />
          <p className="text-[11px] text-fiba-muted/70 mt-1">{t('payments.airfareHint')}</p>
        </div>

        <div>
          <label className="block text-xs text-fiba-muted mb-1">{t('payments.comments')}</label>
          <textarea rows={3} value={form.comments} disabled={!canEdit}
            onChange={e => setForm(f => ({ ...f, comments: e.target.value }))} className="fiba-input w-full" />
        </div>

        <div>
          <label className="block text-xs text-fiba-muted mb-1">{t('payments.status')}</label>
          <select value={form.status} disabled={!canEdit}
            onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="fiba-select w-full">
            {STATUSES.map(s => <option key={s} value={s}>{t(`payments.statusLabel.${s}`)}</option>)}
          </select>
        </div>

        {canEdit && (
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="btn-fiba">
              {saving ? t('app.loading') : (payment ? t('payments.save') : t('payments.create'))}
            </button>
            {payment && (
              <button type="button" onClick={handleDeletePayment} className="px-4 py-2 text-sm text-red-400 hover:underline">
                {t('payments.deletePayment')}
              </button>
            )}
          </div>
        )}
      </form>

      {/* Attachments — only once the payment exists */}
      <div className="pt-4 border-t border-fiba-border">
        <h4 className="text-sm font-semibold text-ink-900 dark:text-white mb-2">{t('payments.attachments')}</h4>
        {!payment ? (
          <p className="text-xs text-fiba-muted/70">{t('payments.saveFirstForFiles')}</p>
        ) : (
          <AttachmentList
            items={attachments}
            canEdit={canEdit}
            onUpload={handleUpload}
            onDownload={handleDownload}
            onDelete={handleDeleteAttachment}
            labels={{
              empty: t('payments.noFiles'),
              upload: t('payments.uploadFile'),
              remove: t('payments.removeFile'),
              kindPlaceholder: t('payments.fileKindPlaceholder'),
            }}
          />
        )}
      </div>
    </Drawer>
  )
}
