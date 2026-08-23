/**
 * El pago de una persona nominada: imputación, montos, aprobación y archivos.
 *
 * Vivía dentro de `Payments.jsx` hasta que la bandeja pasó a mostrar también el
 * gasto operativo del evento (fase 9) y la pantalla se quedó sin lugar para dos
 * editores. El formulario no cambió de forma; lo nuevo es el bloque de
 * aprobación (fase 10) y que el desplegable de departamentos ya no ofrece áreas
 * en las que el usuario no puede gastar.
 */
import { useEffect, useId, useState } from 'react'
import {
  createPayment, updatePayment, deletePayment,
  approvePayment, unapprovePayment,
  getPaymentAttachments, uploadPaymentAttachment, deletePaymentAttachment,
  downloadPaymentAttachment,
} from '../../api/client'
import { Badge } from '../../components/ui/Badge'
import { AccountOptions } from '../../lib/accounts'
import {
  Dialog, Field, fieldProps, DepartmentSelect, canSpendOn,
  PAYMENT_STATUSES, fmt, shortDate,
} from './shared'

export default function PaymentEditor({
  nominee, competitionName, departments, accounts, roleAccounts, editableAll,
  canEdit, deptFilter, t, push, onClose, onSaved,
}) {
  const fieldId = useId()
  // El pago se deriva del nominado abierto en vez de vivir en su propio estado:
  // cuando eran dos copias, la de edición no se refrescaba al guardar y el panel
  // seguía mostrando lo que el usuario había tipeado, no lo que quedó guardado.
  const payment = nominee.payment || null

  // Las dos cuentas salen del rol —el fee de un TD es COMP-11 y su vuelo
  // COMP-12—, así que el formulario es un clic para los cuatro roles que tienen
  // línea. Un rol sin mapeo (VIDEO_OPERATOR) viene vacío y hay que elegirlas:
  // el backend lo rechaza en vez de adivinar.
  const defaults = roleAccounts[nominee.nominee_role] || {}
  const [form, setForm] = useState(() => payment ? {
    department_code: payment.department_code || '',
    account_code: payment.account_code || defaults.fee || '',
    airfare_account_code: payment.airfare_account_code || defaults.airfare || '',
    amount: payment.amount ?? '',
    extra: payment.extra ?? '0',
    airfare: payment.airfare ?? '0',
    comments: payment.comments || '',
    status: payment.status || 'new',
  } : {
    // Vacío a propósito, y no el filtro de la vista: un filtro es una forma de
    // mirar, no una decisión contable. Si prellenara, filtrar por Comms y cargar
    // el pago de un TD lo imputaría a Comms sin que nadie lo eligiera.
    department_code: '',
    account_code: defaults.fee || '',
    airfare_account_code: defaults.airfare || '',
    amount: nominee.nomination_total ?? '',
    extra: '0',
    airfare: '0',
    comments: '',
    status: 'new',
  })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [attachments, setAttachments] = useState([])
  const [attKind, setAttKind] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!payment?.id) { setAttachments([]); return }
    getPaymentAttachments(payment.id)
      .then(setAttachments)
      .catch(e => { console.error(e); setAttachments([]) })
  }, [payment?.id])

  // Un pago ya imputado a un área ajena no se edita: el backend lo rechaza con
  // un 403 sobre el departamento de origen (mover plata de otra área es tan
  // grave como cargarla). Se muestra igual —la bandeja es del evento entero—,
  // en modo lectura y diciendo por qué. Uno SIN departamento sí se puede tocar:
  // es una fila anterior a la 038 y clasificarla es justo lo que hace falta.
  const rowLocked = !!payment?.department_code
    && !canSpendOn(payment.department_code, departments, editableAll)
  const formEnabled = canEdit && !rowLocked

  const approved = !!payment?.approved_at
  // Regla dura del backend: sin aprobación no se puede pasar a `completed`, que
  // es el estado que consume presupuesto, y un pago nuevo no puede nacer
  // completado. La opción se deshabilita con el motivo escrito al lado en vez de
  // dejar que el usuario se coma un 400.
  const completedBlocked = !approved
  const completedReason = payment ? t('payments.approveBeforeCompleting') : t('payments.newCannotBeCompleted')

  function validate() {
    const airfare = Number(form.airfare || 0)
    const found = {}
    if (!form.department_code) found.department_code = t('payments.departmentRequired')
    else if (!canSpendOn(form.department_code, departments, editableAll)) {
      found.department_code = t('payments.departmentNotAllowed')
    }
    if (!form.account_code) found.account_code = t('payments.accountRequired')
    if (airfare > 0 && !form.airfare_account_code) {
      found.airfare_account_code = t('payments.airfareAccountRequired')
    }
    if (form.status === 'completed' && completedBlocked) found.status = completedReason
    setErrors(found)
    const first = Object.keys(found)[0]
    if (first) {
      document.getElementById(`${fieldId}-${FOCUS_TARGET[first]}`)?.focus()
      return false
    }
    return true
  }

  async function handleSave(e) {
    e?.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      const airfare = Number(form.airfare || 0)
      const body = {
        department_code: form.department_code,
        account_code: form.account_code,
        // Solo hay cuenta de viaje si hay pasaje: el backend la limpia cuando el
        // airfare es cero, así que mandarla sería un no-op.
        airfare_account_code: airfare > 0 ? form.airfare_account_code : null,
        amount: Number(form.amount || 0),
        extra: Number(form.extra || 0),
        airfare,
        comments: form.comments || null,
        status: form.status,
      }
      const saved = payment
        ? await updatePayment(payment.id, body)
        : await createPayment({ nomination_id: nominee.nomination_id, ...body })
      // El panel queda abierto sobre el mismo nominado, ahora con lo que el
      // backend devolvió — incluida su normalización (limpiar la cuenta del
      // pasaje cuando el airfare es 0, estampar la fecha al completar).
      onSaved(saved)
      setForm(f => ({ ...f, airfare_account_code: saved.airfare_account_code || f.airfare_account_code }))
      if (deptFilter && saved.department_code !== deptFilter) {
        push({ type: 'info', title: t('payments.movedOutOfFilter') })
      }
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('payments.errorSaving') })
    }
    setSaving(false)
  }

  async function handleApproval(approve) {
    if (!payment) return
    setApproving(true)
    try {
      const saved = approve ? await approvePayment(payment.id) : await unapprovePayment(payment.id)
      // `approve` es idempotente y devuelve la fila tal cual si ya estaba
      // aprobada, así que el merge se hace sobre lo que ya había en pantalla.
      onSaved({ ...payment, ...saved })
      push({ type: 'success', title: approve ? t('payments.approvedOk') : t('payments.unapprovedOk') })
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('payments.errorSaving') })
    }
    setApproving(false)
  }

  async function handleDelete() {
    if (!payment) return
    if (!confirm(t('payments.confirmDelete'))) return
    try {
      await deletePayment(payment.id)
      onSaved(null)
      onClose()
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('payments.errorSaving') })
    }
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !payment) return
    try {
      await uploadPaymentAttachment(payment.id, file, attKind || null)
      setAttKind('')
      setAttachments(await getPaymentAttachments(payment.id))
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('payments.errorUpload') })
    }
  }

  async function handleDownload(att) {
    try {
      // Bucket privado: blob + JWT, nunca un <a href> a una URL pública.
      const blob = await downloadPaymentAttachment(att.id, att.file_name)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = att.file_name || 'attachment'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('payments.errorDownload') })
    }
  }

  async function handleDeleteAttachment(att) {
    if (!confirm(t('payments.confirmDeleteFile'))) return
    try {
      await deletePaymentAttachment(att.id)
      setAttachments(await getPaymentAttachments(payment.id))
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('payments.errorSaving') })
    }
  }

  return (
    <Dialog
      titleId={`${fieldId}-title`}
      title={nominee.nominee_name}
      subtitle={`${competitionName || ''}${payment?.record_no ? ` · ${payment.record_no}` : ''}`}
      badge={payment && !payment.department_code ? <Badge tone="warning">{t('payments.unimputed')}</Badge> : null}
      closeLabel={t('payments.close')}
      onClose={onClose}
    >
      {rowLocked && (
        <p className="rounded-lg border border-warning-500/40 bg-warning-50 dark:bg-warning-500/10 px-3 py-2 text-xs text-warning-700 dark:text-warning-500">
          {t('payments.readOnlyDepartment')}
        </p>
      )}

      {/* ─── Aprobación (fase 10) ───────────────────────────────────────────
          Eje separado del status: el status dice dónde está el trámite
          bancario, la aprobación dice quién dio el OK. */}
      {payment && (
        <div className="rounded-lg border border-fiba-border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Badge tone={approved ? 'success' : 'warning'}>
                {approved ? t('payments.approved') : t('payments.notApproved')}
              </Badge>
              <p className="text-xs text-fiba-muted mt-1.5">
                {approved
                  ? `${t('payments.approvedOn')} ${shortDate(payment.approved_at)}`
                  : t('payments.approvalGate')}
              </p>
              {approved && !payment.approved_by && (
                <p className="text-2xs text-fiba-muted mt-1">{t('payments.approvedNoAuthor')}</p>
              )}
            </div>
            {formEnabled && (
              <div className="flex-shrink-0 text-right">
                {approved ? (
                  <button type="button" onClick={() => handleApproval(false)}
                    disabled={approving || payment.status === 'completed'}
                    aria-describedby={payment.status === 'completed' ? `${fieldId}-approve-note` : undefined}
                    className="px-3 py-1.5 text-sm rounded-lg border border-fiba-border text-ink-700 dark:text-ink-200 hover:bg-fiba-surface disabled:opacity-50 disabled:cursor-not-allowed">
                    {t('payments.unapprove')}
                  </button>
                ) : (
                  <button type="button" onClick={() => handleApproval(true)}
                    disabled={approving || !payment.department_code}
                    aria-describedby={!payment.department_code ? `${fieldId}-approve-note` : undefined}
                    className="btn-fiba disabled:opacity-50 disabled:cursor-not-allowed">
                    {t('payments.approve')}
                  </button>
                )}
              </div>
            )}
          </div>
          {formEnabled && (approved ? payment.status === 'completed' : !payment.department_code) && (
            <p id={`${fieldId}-approve-note`} className="text-2xs text-fiba-muted mt-2">
              {approved ? t('payments.unapproveBlocked') : t('payments.approveNeedsDepartment')}
            </p>
          )}
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        {/* Imputación: de quién es la plata y qué línea consume */}
        <Field id={`${fieldId}-dept`} label={t('payments.department')} error={errors.department_code}
          hint={editableAll ? undefined : t('payments.departmentScopeHint')}>
          <DepartmentSelect
            id={`${fieldId}-dept`} value={form.department_code} onChange={v => set('department_code', v)}
            departments={departments} editableAll={editableAll} disabled={!formEnabled}
            error={errors.department_code} hint={editableAll ? undefined : t('payments.departmentScopeHint')}
            t={t} placeholder={t('payments.selectDepartment')}
          />
        </Field>

        {/* Las cuentas del departamento primero: el plan tiene 34 y subiendo, y
            para pagarle a un TD no sirve ver "Utilities". */}
        <Field id={`${fieldId}-acct`} label={t('payments.feeAccount')} error={errors.account_code}>
          <select {...fieldProps(`${fieldId}-acct`, errors.account_code)} value={form.account_code}
            disabled={!formEnabled} onChange={e => set('account_code', e.target.value)}
            className="fiba-select w-full">
            <option value="">{t('payments.selectAccount')}</option>
            <AccountOptions accounts={accounts} department={form.department_code} t={t} />
          </select>
          {/* Solo mientras siga sin elegirse: un aviso que no se apaga cuando el
              usuario hace lo que pide entrena a ignorarlo. */}
          {!form.account_code && !roleAccounts[nominee.nominee_role] && (
            <p role="status" className="text-xs text-warning-600 dark:text-warning-500 mt-1">
              {t('payments.noRoleDefaults')}
            </p>
          )}
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field id={`${fieldId}-amount`} label={t('payments.amount')}
            hint={`${t('payments.fromNomination')}: ${fmt(nominee.nomination_total)}`}>
            <input {...fieldProps(`${fieldId}-amount`, null, `${t('payments.fromNomination')}`)}
              type="number" step="0.01" value={form.amount} disabled={!formEnabled}
              onChange={e => set('amount', e.target.value)} className="fiba-input w-full" />
          </Field>
          <Field id={`${fieldId}-extra`} label={t('payments.extra')}>
            <input id={`${fieldId}-extra`} type="number" step="0.01" value={form.extra} disabled={!formEnabled}
              onChange={e => set('extra', e.target.value)} className="fiba-input w-full" />
          </Field>
        </div>

        {/* El pasaje no suma al total del pago, pero sí consume su propia línea
            de presupuesto: el fee de un TD es COMP-11 y su vuelo COMP-12. */}
        <div className="rounded-lg border border-fiba-border p-3 space-y-3">
          <Field id={`${fieldId}-airfare`} label={t('payments.airfare')} hint={t('payments.airfareHint')}>
            <input {...fieldProps(`${fieldId}-airfare`, null, t('payments.airfareHint'))}
              type="number" step="0.01" min="0" value={form.airfare} disabled={!formEnabled}
              onChange={e => set('airfare', e.target.value)} className="fiba-input w-full" />
          </Field>
          {/* Se renderiza siempre y se deshabilita sin pasaje, en vez de aparecer
              y desaparecer: mostrarlo condicionalmente empujaba medio formulario
              al tipear el primer dígito, y dejaba invisible una cuenta elegida. */}
          <Field id={`${fieldId}-airfare-acct`} label={t('payments.airfareAccount')}
            error={errors.airfare_account_code}>
            <select {...fieldProps(`${fieldId}-airfare-acct`, errors.airfare_account_code)}
              value={form.airfare_account_code}
              disabled={!formEnabled || !(Number(form.airfare || 0) > 0)}
              onChange={e => set('airfare_account_code', e.target.value)}
              className="fiba-select w-full disabled:opacity-50">
              <option value="">{t('payments.selectAccount')}</option>
              <AccountOptions accounts={accounts} department={form.department_code} t={t} />
            </select>
          </Field>
        </div>

        <Field id={`${fieldId}-comments`} label={t('payments.comments')}>
          <textarea id={`${fieldId}-comments`} rows={3} value={form.comments} disabled={!formEnabled}
            onChange={e => set('comments', e.target.value)} className="fiba-input w-full" />
        </Field>

        <Field id={`${fieldId}-status`} label={t('payments.status')} error={errors.status}
          hint={completedBlocked ? completedReason : undefined}>
          <select {...fieldProps(`${fieldId}-status`, errors.status, completedBlocked ? completedReason : null)}
            value={form.status} disabled={!formEnabled}
            onChange={e => set('status', e.target.value)} className="fiba-select w-full">
            {PAYMENT_STATUSES.map(s => (
              <option key={s} value={s} disabled={s === 'completed' && completedBlocked}>
                {t(`payments.statusLabel.${s}`)}
              </option>
            ))}
          </select>
        </Field>

        {formEnabled && (
          <div className="flex gap-3">
            <button type="submit" disabled={saving} className="btn-fiba">
              {saving ? t('app.loading') : (payment ? t('payments.save') : t('payments.create'))}
            </button>
            {payment && (
              <button type="button" onClick={handleDelete}
                className="px-4 py-2 text-sm text-red-400 hover:underline">
                {t('payments.deletePayment')}
              </button>
            )}
          </div>
        )}
      </form>

      {/* Archivos de control financiero — solo una vez que el pago existe */}
      <div className="pt-4 border-t border-fiba-border">
        <h4 className="text-sm font-semibold text-ink-900 dark:text-white mb-2">{t('payments.attachments')}</h4>
        {!payment ? (
          <p className="text-xs text-fiba-muted/70">{t('payments.saveFirstForFiles')}</p>
        ) : (
          <>
            <div className="space-y-2 mb-3">
              {attachments.map(a => (
                <div key={a.id} className="flex items-center gap-2 text-sm">
                  <button type="button" onClick={() => handleDownload(a)}
                    className="text-fiba-accent hover:underline truncate flex-1 text-left">
                    {a.file_name}
                  </button>
                  {a.kind && <span className="text-xs px-1.5 py-0.5 rounded bg-fiba-surface text-fiba-muted">{a.kind}</span>}
                  {formEnabled && (
                    <button type="button" onClick={() => handleDeleteAttachment(a)}
                      className="text-red-400 hover:underline text-xs">{t('payments.removeFile')}</button>
                  )}
                </div>
              ))}
              {attachments.length === 0 && <p className="text-xs text-fiba-muted/60">{t('payments.noFiles')}</p>}
            </div>
            {formEnabled && (
              <div className="flex items-center gap-2">
                <label htmlFor={`${fieldId}-att-kind`} className="sr-only">{t('payments.fileKindPlaceholder')}</label>
                <input id={`${fieldId}-att-kind`} type="text" value={attKind}
                  onChange={e => setAttKind(e.target.value)}
                  placeholder={t('payments.fileKindPlaceholder')} className="fiba-input flex-1 text-sm" />
                <label className="btn-fiba cursor-pointer whitespace-nowrap">
                  {t('payments.uploadFile')}
                  <input type="file" accept="application/pdf,image/*" onChange={handleUpload} className="hidden" />
                </label>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  )
}

/** Qué campo enfocar cuando falla la validación. */
const FOCUS_TARGET = {
  department_code: 'dept',
  account_code: 'acct',
  airfare_account_code: 'airfare-acct',
  status: 'status',
}
