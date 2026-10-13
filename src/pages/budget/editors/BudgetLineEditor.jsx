import { useState } from 'react'
import { createBudgetLine, updateBudgetLine, deleteBudgetLine } from '../../../api/client'
import { Drawer } from '../../../components/ui/Drawer'
import { competitionLabel } from '../../../lib/competitions'
import { AccountOptions, Field } from '../shared'

export default function BudgetLineEditor({
  line, year, defaultDepartment, onClose, onSaved, onDeleted,
  t, push, departments, expenseAccounts, competitions, canEdit,
}) {
  const isNew = !line.id
  const [form, setForm] = useState({
    department_code: line.department_code || defaultDepartment || departments[0]?.code || '',
    account_code: line.account_code || '',
    competition_id: line.competition_id || '',
    description: line.description || '',
    qty: line.qty ?? '',
    monthly_amount: line.monthly_amount ?? '',
    amount: line.amount ?? '',
    escalation_pct: line.escalation_pct != null ? String(Number(line.escalation_pct) * 100) : '',
    notes: line.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Al elegir cuenta en una línea nueva se propone su % de escalación —
  // los códigos de IT ya traen el del Excel (612300 → 6%).
  function pickAccount(code) {
    set('account_code', code)
    if (isNew && !form.escalation_pct) {
      const acc = expenseAccounts.find(a => a.code === code)
      if (acc?.escalation_pct != null) set('escalation_pct', String(Number(acc.escalation_pct) * 100))
    }
    if (isNew && !form.description) {
      const acc = expenseAccounts.find(a => a.code === code)
      if (acc) set('description', acc.label)
    }
  }

  async function handleSave() {
    if (!form.description.trim() || !form.account_code || form.amount === '') {
      push({ type: 'error', title: t('budget.required') })
      return
    }
    setSaving(true)
    try {
      const body = {
        year,
        department_code: form.department_code,
        account_code: form.account_code,
        competition_id: form.competition_id || null,
        description: form.description.trim(),
        qty: form.qty === '' ? null : Number(form.qty),
        monthly_amount: form.monthly_amount === '' ? null : Number(form.monthly_amount),
        amount: Number(form.amount || 0),
        escalation_pct: form.escalation_pct === '' ? null : Number(form.escalation_pct) / 100,
        notes: form.notes || null,
      }
      if (isNew) {
        await createBudgetLine(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)))
      } else {
        const { year: _y, ...patch } = body
        await updateBudgetLine(line.id, patch)
      }
      push({ type: 'success', title: t('budget.saved') })
      onSaved()
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('common.error') })
    }
    setSaving(false)
  }

  async function handleDelete() {
    if (!window.confirm(t('budget.confirmDelete'))) return
    try {
      await deleteBudgetLine(line.id)
      push({ type: 'success', title: t('budget.deleted') })
      onDeleted()
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('common.error') })
    }
  }

  return (
    <Drawer
      title={isNew ? t('budget.newLine') : t('budget.editLine')}
      subtitle={String(year)}
      onClose={onClose}
      footer={
        <>
          {!isNew && canEdit && (
            <button onClick={handleDelete} className="btn-fiba-danger mr-auto">{t('common.delete')}</button>
          )}
          <button onClick={onClose} className="btn-fiba-ghost">{t('budget.cancel')}</button>
          <button onClick={handleSave} disabled={saving} className="btn-fiba">{t('budget.save')}</button>
        </>
      }
    >
      <Field label={t('budget.lineDescription')}>
        <input className="fiba-input" value={form.description} onChange={e => set('description', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.department')}>
          <select className="fiba-select" value={form.department_code} onChange={e => set('department_code', e.target.value)}>
            {departments.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
          </select>
        </Field>
        <Field label={`${t('budget.amount')} (${year})`}>
          <input type="number" step="0.01" min="0" className="fiba-input" value={form.amount}
            onChange={e => set('amount', e.target.value)} />
        </Field>
      </div>
      <Field label={t('budget.account')}>
        <select className="fiba-select" value={form.account_code} onChange={e => pickAccount(e.target.value)}>
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
      <div className="grid grid-cols-3 gap-3">
        <Field label={t('budget.qty')}>
          <input type="number" step="0.01" className="fiba-input" value={form.qty} onChange={e => set('qty', e.target.value)} />
        </Field>
        <Field label={t('budget.monthly')}>
          <input type="number" step="0.01" className="fiba-input" value={form.monthly_amount}
            onChange={e => set('monthly_amount', e.target.value)} />
        </Field>
        <Field label={`${t('budget.escalation')} %`}>
          <input type="number" step="0.1" className="fiba-input" value={form.escalation_pct}
            onChange={e => set('escalation_pct', e.target.value)} />
        </Field>
      </div>
      <Field label={t('budget.notes')}>
        <textarea rows={3} className="fiba-input !h-auto py-2" value={form.notes} onChange={e => set('notes', e.target.value)} />
      </Field>
    </Drawer>
  )
}
