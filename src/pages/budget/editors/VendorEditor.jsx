import { useState } from 'react'
import { createVendor, updateVendor } from '../../../api/client'
import { Drawer } from '../../../components/ui/Drawer'
import { Badge } from '../../../components/ui/Badge'
import { Icon } from '../../../lib/icons'
import { useBudgetScope } from '../scope'
import { Field } from '../shared'

// Datos bancarios y fiscales: solo el admin general los ve y los escribe. Un
// no-admin que los mande en el payload —aunque sea en null— recibe 403, así
// que para él se OMITEN del body, no se vacían.
const SENSITIVE = ['bank_info', 'tax_id']

export default function VendorEditor({ vendor, onClose, onSaved, t, push }) {
  const { isGeneralAdmin } = useBudgetScope()
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
        .filter(([k]) => isGeneralAdmin || !SENSITIVE.includes(k))
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
      closeLabel={t('budget.cancel')}
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {isGeneralAdmin && (
          <Field label={t('budget.taxId')}>
            <input className="fiba-input" value={form.tax_id} onChange={e => set('tax_id', e.target.value)} />
          </Field>
        )}
        <Field label={t('budget.country')}>
          <input className="fiba-input" value={form.country} onChange={e => set('country', e.target.value)} />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('budget.email')}>
          <input type="email" className="fiba-input" value={form.email} onChange={e => set('email', e.target.value)} />
        </Field>
        <Field label={t('budget.phone')}>
          <input className="fiba-input" value={form.phone} onChange={e => set('phone', e.target.value)} />
        </Field>
      </div>
      {isGeneralAdmin ? (
        <Field label={t('budget.bankInfo')}>
          <textarea rows={3} className="fiba-input !h-auto py-2" value={form.bank_info}
            onChange={e => set('bank_info', e.target.value)} />
        </Field>
      ) : (
        <div>
          <div className="text-[13px] font-medium text-ink-700 dark:text-ink-200 mb-1.5">{t('budget.bankInfo')}</div>
          {vendor.has_bank_info
            ? <Badge tone="success" dot>{t('budget.vendorBankInfoLoaded')}</Badge>
            : <span className="text-sm text-fiba-muted">{t('budget.vendorBankInfoMissing')}</span>}
          <p className="text-xs text-fiba-muted mt-1.5 flex items-start gap-1.5">
            <Icon.Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            {t('budget.vendorSensitiveAdminOnly')}
          </p>
        </div>
      )}
      <Field label={t('budget.notes')}>
        <textarea rows={2} className="fiba-input !h-auto py-2" value={form.notes}
          onChange={e => set('notes', e.target.value)} />
      </Field>
    </Drawer>
  )
}
