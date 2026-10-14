import { useState } from 'react'
import { createRecurring, updateRecurring } from '../../../api/client'
import { Drawer } from '../../../components/ui/Drawer'
import { AccountOptions, Field, today } from '../shared'

export default function RecurringEditor({ recurring, onClose, onSaved, t, push, departments, expenseAccounts, vendors }) {
  const isNew = !recurring.id
  const [form, setForm] = useState({
    description: recurring.description || '',
    department_code: recurring.department_code || departments[0]?.code || '',
    account_code: recurring.account_code || '',
    vendor_id: recurring.vendor_id || '',
    amount: recurring.amount ?? '',
    frequency: recurring.frequency || 'monthly',
    day_of_month: recurring.day_of_month ?? 1,
    start_date: recurring.start_date || today(),
    end_date: recurring.end_date || '',
    notes: recurring.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.description.trim() || !form.account_code || form.amount === '') {
      push({ type: 'error', title: t('budget.required') })
      return
    }
    setSaving(true)
    try {
      const body = {
        description: form.description.trim(),
        department_code: form.department_code,
        account_code: form.account_code,
        vendor_id: form.vendor_id || null,
        amount: Number(form.amount || 0),
        frequency: form.frequency,
        day_of_month: Number(form.day_of_month) || 1,
        start_date: form.start_date,
        end_date: form.end_date || null,
        notes: form.notes || null,
      }
      if (isNew) await createRecurring(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)))
      else await updateRecurring(recurring.id, body)
      push({ type: 'success', title: t('budget.saved') })
      onSaved()
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('common.error') })
    }
    setSaving(false)
  }

  return (
    <Drawer
      title={isNew ? t('budget.newRecurring') : t('budget.editRecurring')}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-fiba-ghost">{t('budget.cancel')}</button>
          <button onClick={handleSave} disabled={saving} className="btn-fiba">{t('budget.save')}</button>
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
      <Field label={t('budget.payeeVendor')}>
        <select className="fiba-select" value={form.vendor_id} onChange={e => set('vendor_id', e.target.value)}>
          <option value="">—</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.frequency')}>
          <select className="fiba-select" value={form.frequency} onChange={e => set('frequency', e.target.value)}>
            <option value="monthly">{t('budget.fq_monthly')}</option>
            <option value="quarterly">{t('budget.fq_quarterly')}</option>
            <option value="annual">{t('budget.fq_annual')}</option>
          </select>
        </Field>
        <Field label={t('budget.dayOfMonth')}>
          <input type="number" min="1" max="28" className="fiba-input" value={form.day_of_month}
            onChange={e => set('day_of_month', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.startDate')}>
          <input type="date" className="fiba-input" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
        </Field>
        <Field label={t('budget.endDate')}>
          <input type="date" className="fiba-input" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
        </Field>
      </div>
      <Field label={t('budget.notes')}>
        <textarea rows={2} className="fiba-input !h-auto py-2" value={form.notes} onChange={e => set('notes', e.target.value)} />
      </Field>
    </Drawer>
  )
}
