import { useState } from 'react'
import { createRevenue, updateRevenue } from '../../../api/client'
import { Drawer } from '../../../components/ui/Drawer'
import { competitionLabel } from '../../../lib/competitions'
import { AccountOptions, Field, today } from '../shared'

export default function RevenueEditor({ revenue, onClose, onSaved, t, push, departments, revenueAccounts, competitions }) {
  const isNew = !revenue.id
  const [form, setForm] = useState({
    source_name: revenue.source_name || '',
    department_code: revenue.department_code || departments[0]?.code || '',
    account_code: revenue.account_code || '',
    competition_id: revenue.competition_id || '',
    amount: revenue.amount ?? '',
    expected_date: revenue.expected_date || '',
    received_date: revenue.received_date || '',
    status: revenue.status || 'expected',
    description: revenue.description || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.source_name.trim() || !form.account_code || form.amount === '') {
      push({ type: 'error', title: t('budget.required') })
      return
    }
    setSaving(true)
    try {
      const body = {
        source_name: form.source_name.trim(),
        department_code: form.department_code,
        account_code: form.account_code,
        competition_id: form.competition_id || null,
        amount: Number(form.amount || 0),
        expected_date: form.expected_date || null,
        received_date: form.status === 'received' ? (form.received_date || today()) : null,
        status: form.status,
        description: form.description || null,
      }
      if (isNew) await createRevenue(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)))
      else await updateRevenue(revenue.id, body)
      push({ type: 'success', title: t('budget.saved') })
      onSaved()
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('common.error') })
    }
    setSaving(false)
  }

  return (
    <Drawer
      title={isNew ? t('budget.newRevenue') : t('budget.editRevenue')}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-fiba-ghost">{t('budget.cancel')}</button>
          <button onClick={handleSave} disabled={saving} className="btn-fiba">{t('budget.save')}</button>
        </>
      }
    >
      <Field label={t('budget.sourceName')}>
        <input className="fiba-input" value={form.source_name} onChange={e => set('source_name', e.target.value)} />
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
          <AccountOptions accounts={revenueAccounts} department={form.department_code} t={t} />
        </select>
      </Field>
      <Field label={t('budget.competition')}>
        <select className="fiba-select" value={form.competition_id} onChange={e => set('competition_id', e.target.value)}>
          <option value="">{t('budget.general')}</option>
          {competitions.map(c => <option key={c.id} value={c.id}>{competitionLabel(c, t('months.short'))}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.expectedDate')}>
          <input type="date" className="fiba-input" value={form.expected_date} onChange={e => set('expected_date', e.target.value)} />
        </Field>
        <Field label={t('budget.status')}>
          <select className="fiba-select" value={form.status} onChange={e => set('status', e.target.value)}>
            <option value="expected">{t('budget.st_expected')}</option>
            <option value="received">{t('budget.st_received')}</option>
            <option value="cancelled">{t('budget.st_cancelled')}</option>
          </select>
        </Field>
      </div>
      {form.status === 'received' && (
        <Field label={t('budget.receivedDate')}>
          <input type="date" className="fiba-input" value={form.received_date || today()}
            onChange={e => set('received_date', e.target.value)} />
        </Field>
      )}
      <Field label={t('budget.description')}>
        <textarea rows={2} className="fiba-input !h-auto py-2" value={form.description}
          onChange={e => set('description', e.target.value)} />
      </Field>
    </Drawer>
  )
}
