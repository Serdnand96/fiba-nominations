import { useMemo, useState } from 'react'
import { deleteVendor } from '../../api/client'
import { Badge } from '../../components/ui/Badge'
import { Icon } from '../../lib/icons'
import VendorEditor from './editors/VendorEditor'
import { useBudgetScope } from './scope'

/* ──────────────────────────── Proveedores ────────────────────────────
 *
 * Un proveedor no es de un departamento, así que no hay derecho por fila: dar
 * de alta y editar los datos de contacto lo hace cualquier editor de budget.
 * Lo que sí se recorta (backend, `_VENDOR_SENSITIVE`): `bank_info` y `tax_id`
 * los ve y escribe solo el admin general, igual que la baja. El resto ve
 * `has_bank_info` para saber si falta cargarlo, sin el dato.
 */
export default function VendorsTab({ t, push, canEdit, vendors, reloadVendors }) {
  const { isGeneralAdmin } = useBudgetScope()
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)

  const rows = useMemo(() => {
    if (!search) return vendors
    const s = search.toLowerCase()
    return vendors.filter(v =>
      (v.name || '').toLowerCase().includes(s)
      || (v.tax_id || '').toLowerCase().includes(s)
      || (v.country || '').toLowerCase().includes(s))
  }, [vendors, search])

  async function handleDelete(row) {
    if (!window.confirm(t('budget.confirmDelete'))) return
    try {
      const res = await deleteVendor(row.id)
      push({ type: 'success', title: res.deactivated ? t('budget.vendorDeactivated') : t('budget.deleted') })
      reloadVendors()
    } catch (e) {
      push({ type: 'error', title: e?.response?.data?.detail || t('common.error') })
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        <input type="text" placeholder={t('budget.search')} value={search}
          onChange={e => setSearch(e.target.value)} className="fiba-input w-full md:w-80" />
        {canEdit && <button onClick={() => setEditing({})} className="btn-fiba ml-auto">{t('budget.newVendor')}</button>}
      </div>

      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-fiba-surface/60 border-b border-fiba-border">
              <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-fiba-muted">
                <th className="px-4 py-2.5">{t('budget.vendorName')}</th>
                {isGeneralAdmin && <th className="px-4 py-2.5">{t('budget.taxId')}</th>}
                <th className="px-4 py-2.5">{t('budget.country')}</th>
                <th className="px-4 py-2.5">{t('budget.email')}</th>
                <th className="px-4 py-2.5">{t('budget.bankInfo')}</th>
                <th className="px-4 py-2.5 text-right">{t('budget.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fiba-border">
              {rows.length === 0 ? (
                <tr><td colSpan={isGeneralAdmin ? 6 : 5} className="px-4 py-10 text-center">
                  <p className="font-semibold text-ink-900 dark:text-white">{t('budget.noVendors')}</p>
                  <p className="text-fiba-muted text-sm mt-1 max-w-md mx-auto">{t('budget.noVendorsBody')}</p>
                </td></tr>
              ) : rows.map(v => (
                <tr key={v.id} className="hover:bg-fiba-surface/50 transition-colors">
                  <td className="px-4 py-3 text-ink-900 dark:text-white">{v.name}</td>
                  {isGeneralAdmin && <td className="px-4 py-3 text-fiba-muted">{v.tax_id || '—'}</td>}
                  <td className="px-4 py-3 text-fiba-muted">{v.country || '—'}</td>
                  <td className="px-4 py-3 text-fiba-muted">{v.email || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {v.has_bank_info
                      ? <Badge tone="success" size="sm" dot>{t('budget.vendorBankInfoLoaded')}</Badge>
                      : <span className="text-xs text-fiba-muted">{t('budget.vendorBankInfoMissing')}</span>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {canEdit && (
                      <div className="inline-flex gap-1">
                        <button onClick={() => setEditing(v)}
                          className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-ink-900 dark:hover:text-white">
                          <Icon.Doc className="w-4 h-4" />
                        </button>
                        {/* La baja saca al proveedor del alta de gastos de
                            todos los departamentos: solo admin general. */}
                        {isGeneralAdmin && (
                          <button onClick={() => handleDelete(v)}
                            className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-red-500">
                            <Icon.X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <VendorEditor vendor={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reloadVendors() }} {...{ t, push }} />
      )}
    </div>
  )
}
