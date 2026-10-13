import { useEffect, useState } from 'react'
import {
  createExpense, updateExpense,
  getExpenseAttachments, uploadExpenseAttachment, deleteExpenseAttachment, downloadExpenseAttachment,
  saveBlob,
} from '../../../api/client'
import { Drawer } from '../../../components/ui/Drawer'
import AttachmentList from '../../../components/AttachmentList'
import { competitionLabel } from '../../../lib/competitions'
import { AccountOptions, Field, today, EXPENSE_STATUSES } from '../shared'

export default function ExpenseEditor({ expense, onClose, onSaved, t, push, canEdit = true, departments, expenseAccounts, competitions, vendors, employees }) {
  const isNew = !expense.id
  const [form, setForm] = useState({
    department_code: expense.department_code || departments[0]?.code || '',
    account_code: expense.account_code || '',
    competition_id: expense.competition_id || '',
    payee_type: expense.payee_type || 'vendor',
    vendor_id: expense.vendor_id || '',
    employee_id: expense.employee_id || '',
    payee_name: expense.payee_name || '',
    description: expense.description || '',
    amount: expense.amount ?? '',
    expense_date: expense.expense_date || today(),
    payment_date: expense.payment_date || '',
    status: expense.status || 'draft',
    invoice_no: expense.invoice_no || '',
    payment_method: expense.payment_method || '',
    bank_confirmation: expense.bank_confirmation || '',
    comments: expense.comments || '',
  })
  const [saving, setSaving] = useState(false)
  const [attachments, setAttachments] = useState([])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!expense.id) { setAttachments([]); return }
    getExpenseAttachments(expense.id).then(setAttachments).catch(e => { console.error(e); setAttachments([]) })
  }, [expense.id])

  async function handleSave(e) {
    e?.preventDefault()
    if (!form.description.trim() || !form.account_code || !form.department_code || form.amount === '') {
      push({ type: 'error', title: t('budget.required') })
      return
    }
    setSaving(true)
    try {
      const body = {
        department_code: form.department_code,
        account_code: form.account_code,
        competition_id: form.competition_id || null,
        payee_type: form.payee_type,
        vendor_id: form.payee_type === 'vendor' ? (form.vendor_id || null) : null,
        employee_id: form.payee_type === 'employee' ? (form.employee_id || null) : null,
        payee_name: form.payee_type === 'other' ? form.payee_name : null,
        description: form.description.trim(),
        amount: Number(form.amount || 0),
        expense_date: form.expense_date,
        // El backend exige fecha de pago si y solo si el estado es "pagado".
        payment_date: form.status === 'paid' ? (form.payment_date || today()) : null,
        status: form.status,
        invoice_no: form.invoice_no || null,
        payment_method: form.payment_method || null,
        bank_confirmation: form.bank_confirmation || null,
        comments: form.comments || null,
      }
      // En alta se filtran los null (el default de la columna hace el resto);
      // en edición se manda el body completo, null incluido, porque el PATCH
      // usa exclude_unset y un null explícito es lo que vacía el campo — así
      // se puede pasar un gasto de un evento a general.
      if (isNew) {
        await createExpense(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)))
      } else {
        await updateExpense(expense.id, body)
      }
      push({ type: 'success', title: t('budget.saved') })
      onSaved()
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('common.error') })
    }
    setSaving(false)
  }

  async function handleUpload(file, kind) {
    try {
      await uploadExpenseAttachment(expense.id, file, kind)
      setAttachments(await getExpenseAttachments(expense.id))
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('common.error') })
      return false
    }
  }

  async function handleDownload(att) {
    try {
      saveBlob(await downloadExpenseAttachment(att.id, att.file_name), att.file_name)
    } catch (err) {
      push({ type: 'error', title: t('common.error') })
    }
  }

  async function handleDeleteAttachment(att) {
    try {
      await deleteExpenseAttachment(att.id)
      setAttachments(await getExpenseAttachments(expense.id))
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('common.error') })
    }
  }

  return (
    <Drawer
      title={isNew ? t('budget.newExpense') : t('budget.editExpense')}
      subtitle={expense.record_no}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-fiba-ghost">{t('budget.cancel')}</button>
          <button onClick={handleSave} disabled={saving} className="btn-fiba">
            {saving ? t('common.loading') : t('budget.save')}
          </button>
        </>
      }
    >
      <Field label={t('budget.description')}>
        <input className="fiba-input" value={form.description} onChange={e => set('description', e.target.value)} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.department')}>
          <select className="fiba-select" value={form.department_code} onChange={e => set('department_code', e.target.value)}>
            {departments.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
          </select>
        </Field>
        <Field label={t('budget.amount')}>
          <input type="number" step="0.01" min="0" className="fiba-input" value={form.amount}
            onChange={e => set('amount', e.target.value)} />
        </Field>
      </div>

      <Field label={t('budget.account')}>
        <select className="fiba-select" value={form.account_code} onChange={e => set('account_code', e.target.value)}>
          <option value="">—</option>
          <AccountOptions accounts={expenseAccounts} department={form.department_code} t={t} />
        </select>
      </Field>

      <Field label={t('budget.competition')}>
        <select className="fiba-select" value={form.competition_id} onChange={e => set('competition_id', e.target.value)}>
          <option value="">{t('budget.general')}</option>
          {competitions.map(c => <option key={c.id} value={c.id}>{competitionLabel(c, t('months.short'))}</option>)}
        </select>
      </Field>

      <Field label={t('budget.payee')}>
        <select className="fiba-select" value={form.payee_type} onChange={e => set('payee_type', e.target.value)}>
          <option value="vendor">{t('budget.payeeVendor')}</option>
          <option value="employee">{t('budget.payeeEmployee')}</option>
          <option value="other">{t('budget.payeeOther')}</option>
        </select>
      </Field>

      {form.payee_type === 'vendor' && (
        <Field label={t('budget.payeeVendor')}>
          <select className="fiba-select" value={form.vendor_id} onChange={e => set('vendor_id', e.target.value)}>
            <option value="">—</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
      )}
      {form.payee_type === 'employee' && (
        <Field label={t('budget.payeeEmployee')}>
          <select className="fiba-select" value={form.employee_id} onChange={e => set('employee_id', e.target.value)}>
            <option value="">—</option>
            {employees.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
      )}
      {form.payee_type === 'other' && (
        <Field label={t('budget.payeeName')}>
          <input className="fiba-input" value={form.payee_name} onChange={e => set('payee_name', e.target.value)} />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.expenseDate')}>
          <input type="date" className="fiba-input" value={form.expense_date} onChange={e => set('expense_date', e.target.value)} />
        </Field>
        <Field label={t('budget.status')}>
          <select className="fiba-select" value={form.status} onChange={e => set('status', e.target.value)}>
            {EXPENSE_STATUSES.map(s => <option key={s} value={s}>{t(`budget.st_${s}`)}</option>)}
          </select>
        </Field>
      </div>

      {form.status === 'paid' && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('budget.paymentDate')}>
            <input type="date" className="fiba-input" value={form.payment_date || today()}
              onChange={e => set('payment_date', e.target.value)} />
          </Field>
          <Field label={t('budget.paymentMethod')}>
            <input className="fiba-input" value={form.payment_method} onChange={e => set('payment_method', e.target.value)} />
          </Field>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.invoiceNo')}>
          <input className="fiba-input" value={form.invoice_no} onChange={e => set('invoice_no', e.target.value)} />
        </Field>
        <Field label={t('budget.bankConfirmation')}>
          <input className="fiba-input" value={form.bank_confirmation} onChange={e => set('bank_confirmation', e.target.value)} />
        </Field>
      </div>

      <Field label={t('budget.comments')}>
        <textarea rows={2} className="fiba-input !h-auto py-2" value={form.comments}
          onChange={e => set('comments', e.target.value)} />
      </Field>

      <div className="pt-2 border-t border-fiba-border">
        <p className="text-[13px] font-medium text-ink-700 dark:text-ink-200 mb-2">{t('budget.attachments')}</p>
        {isNew ? (
          <p className="text-xs text-fiba-muted">{t('budget.saveFirst')}</p>
        ) : (
          <AttachmentList
            items={attachments} canEdit={canEdit}
            onUpload={handleUpload} onDownload={handleDownload} onDelete={handleDeleteAttachment}
            labels={{ kindPlaceholder: t('budget.attachmentKind'), upload: t('budget.upload') }}
          />
        )}
      </div>
    </Drawer>
  )
}
