import { useState } from 'react'
import { createVendor, updateVendor } from '../../../api/client'
import { Drawer } from '../../../components/ui/Drawer'
import { Field } from '../shared'

export default function VendorEditor({ vendor, onClose, onSaved, t, push }) {
  const isNew = !vendor.id
  const [form, setForm] = useState({
    name: vendor.name || '', tax_id: vendor.tax_id || '', country: vendor.country || '',
    email: vendor.email || '', phone: vendor.phone || '',
    bank_info: vendor.bank_info || '', notes: vendor.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.name.trim()) { push({ type: 'error', title: t('budget.required') }); return }
    setSaving(true)
    try {
      const entries = Object.entries({ ...form, name: form.name.trim() })
      if (isNew) {
        await createVendor(Object.fromEntries(entries.filter(([, v]) => v !== '')))
      } else {
        // '' → null: vaciar el campo en la UI tiene que vaciarlo en la base,
        // no guardar un string vacío.
        await updateVendor(vendor.id, Object.fromEntries(entries.map(([k, v]) => [k, v === '' ? null : v])))
      }
      push({ type: 'success', title: t('budget.saved') })
      onSaved()
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('common.error') })
    }
    setSaving(false)
  }

  return (
    <Drawer
      title={isNew ? t('budget.newVendor') : t('budget.editVendor')}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-fiba-ghost">{t('budget.cancel')}</button>
          <button onClick={handleSave} disabled={saving} className="btn-fiba">{t('budget.save')}</button>
        </>
      }
    >
      <Field label={t('budget.vendorName')}>
        <input className="fiba-input" value={form.name} onChange={e => set('name', e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.taxId')}>
          <input className="fiba-input" value={form.tax_id} onChange={e => set('tax_id', e.target.value)} />
        </Field>
        <Field label={t('budget.country')}>
          <input className="fiba-input" value={form.country} onChange={e => set('country', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('budget.email')}>
          <input type="email" className="fiba-input" value={form.email} onChange={e => set('email', e.target.value)} />
        </Field>
        <Field label={t('budget.phone')}>
          <input className="fiba-input" value={form.phone} onChange={e => set('phone', e.target.value)} />
        </Field>
      </div>
      <Field label={t('budget.bankInfo')}>
        <textarea rows={3} className="fiba-input !h-auto py-2" value={form.bank_info}
          onChange={e => set('bank_info', e.target.value)} />
      </Field>
      <Field label={t('budget.notes')}>
        <textarea rows={2} className="fiba-input !h-auto py-2" value={form.notes}
          onChange={e => set('notes', e.target.value)} />
      </Field>
    </Drawer>
  )
}
