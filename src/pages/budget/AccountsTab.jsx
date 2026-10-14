import { useEffect, useMemo, useState } from 'react'
import { getAccounts, createAccount, updateAccount, remapAccount } from '../../api/client'
import { Drawer } from '../../components/ui/Drawer'
import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { Icon } from '../../lib/icons'
import { Field } from './shared'

/* ──────────────────────────── Plan de cuentas ────────────────────────────
 *
 * Solo admin general (Budget.jsx no monta la pestaña para nadie más, y el
 * backend exige lo mismo en POST/PATCH/remap). La cuenta no pertenece a un
 * departamento: `used_by` se deriva de lo cargado y viene recortado por el
 * scope del caller.
 *
 * Los `COMP-*` son provisorios (`pending_mapping`) hasta que Finance entregue
 * el plan oficial. "Asignar código oficial" los renombra con remap: las FK son
 * ON UPDATE CASCADE, así que líneas, gastos y pagos siguen apuntando bien. Lo
 * que el CASCADE no ve es `api/_lib/budget_accounts.py` (rol → cuenta de fees y
 * de travel de los pagos): para esas el backend responde 409 y la UI ofrece
 * `force` explicando qué queda pendiente.
 */

function detailText(err, fallback) {
  const d = err?.response?.data?.detail
  if (typeof d === 'string') return d
  return d?.message || fallback
}

// El 409 de remap por una cuenta que el código usa menciona budget_accounts.py.
// Cualquier otro 409 (p. ej. el código nuevo ya existe) es un error a secas.
function isMappedInCode(err) {
  if (err?.response?.status !== 409) return false
  return /budget_accounts/i.test(JSON.stringify(err?.response?.data?.detail ?? ''))
}

export default function AccountsTab({ t, push, departments, reloadAccounts }) {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState('')
  const [onlyPending, setOnlyPending] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState(null)
  const [remapping, setRemapping] = useState(null)

  async function load() {
    setLoading(true)
    try { setAccounts(await getAccounts({ include_inactive: true })) }
    catch (e) { console.error(e); push({ type: 'error', title: t('common.error') }) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Un cambio acá tiene que verse en los selects de las otras pestañas.
  function afterChange() {
    load()
    reloadAccounts?.()
  }

  const deptLabel = useMemo(
    () => Object.fromEntries(departments.map(d => [d.code, d.label])),
    [departments],
  )

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase()
    return accounts.filter(a =>
      (showInactive || a.active !== false)
      && (!kind || a.kind === kind)
      && (!onlyPending || a.pending_mapping)
      && (!s || a.code.toLowerCase().includes(s) || (a.label || '').toLowerCase().includes(s)))
  }, [accounts, search, kind, onlyPending, showInactive])

  const pendingCount = useMemo(
    () => accounts.filter(a => a.pending_mapping && a.active !== false).length,
    [accounts],
  )

  return (
    <div>
      <p className="text-xs text-fiba-muted mb-4 flex items-start gap-1.5">
        <Icon.Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        {t('budget.accountsHint')}
      </p>

      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input type="text" placeholder={t('budget.search')} value={search}
          onChange={e => setSearch(e.target.value)} className="fiba-input w-full md:w-72" />
        <select value={kind} onChange={e => setKind(e.target.value)} className="fiba-select !w-auto min-w-[160px]">
          <option value="">{t('budget.accountsAllKinds')}</option>
          <option value="expense">{t('budget.accountsKind_expense')}</option>
          <option value="revenue">{t('budget.accountsKind_revenue')}</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-fiba-muted cursor-pointer">
          <input type="checkbox" checked={onlyPending} onChange={() => setOnlyPending(v => !v)}
            className="rounded border-fiba-border" />
          {t('budget.accountsOnlyPending')}
          {pendingCount > 0 && <span className="text-amber-500 font-medium tabular-nums">({pendingCount})</span>}
        </label>
        <label className="flex items-center gap-2 text-sm text-fiba-muted cursor-pointer">
          <input type="checkbox" checked={showInactive} onChange={() => setShowInactive(v => !v)}
            className="rounded border-fiba-border" />
          {t('budget.accountsShowInactive')}
        </label>
        <button onClick={() => setEditing({})} className="btn-fiba md:ml-auto">{t('budget.accountsNew')}</button>
      </div>

      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-fiba-surface/60 border-b border-fiba-border">
              <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-fiba-muted">
                <th className="px-4 py-2.5">{t('budget.accountsCode')}</th>
                <th className="px-4 py-2.5">{t('budget.accountsLabel')}</th>
                <th className="px-4 py-2.5">{t('budget.accountsKind')}</th>
                <th className="px-4 py-2.5">{t('budget.accountsUsedBy')}</th>
                <th className="px-4 py-2.5 text-right">{t('budget.escalation')}</th>
                <th className="px-4 py-2.5">{t('budget.status')}</th>
                <th className="px-4 py-2.5 text-right">{t('budget.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-fiba-border">
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-fiba-muted">{t('common.loading')}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-fiba-muted">{t('budget.accountsEmpty')}</td></tr>
              ) : rows.map(a => (
                <tr key={a.code} className={`hover:bg-fiba-surface/50 transition-colors ${a.active === false ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`font-mono text-xs ${a.pending_mapping ? 'text-amber-500 font-semibold' : 'text-ink-900 dark:text-white'}`}
                      title={a.pending_mapping ? t('budget.accountsPendingHint') : undefined}>
                      {a.code}{a.pending_mapping ? ' *' : ''}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-900 dark:text-white min-w-[200px]">{a.label}</td>
                  <td className="px-4 py-3 text-fiba-muted whitespace-nowrap">{t(`budget.accountsKind_${a.kind}`)}</td>
                  <td className="px-4 py-3">
                    {(a.used_by || []).length === 0 ? (
                      <span className="text-xs text-fiba-muted italic">{t('budget.accountsUnused')}</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {a.used_by.map(code => (
                          <Badge key={code} tone="navy" size="sm">{deptLabel[code] || code}</Badge>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-fiba-muted tabular-nums">
                    {(Number(a.escalation_pct || 0) * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex flex-wrap gap-1">
                      {a.pending_mapping && <Badge tone="warning" size="sm">{t('budget.accountsPending')}</Badge>}
                      {a.active === false
                        ? <Badge tone="ink" size="sm">{t('budget.accountsInactive')}</Badge>
                        : <Badge tone="success" size="sm">{t('budget.accountsActive')}</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-1">
                      {a.pending_mapping && (
                        <button onClick={() => setRemapping(a)}
                          className="px-2 py-1 rounded text-xs font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10">
                          {t('budget.accountsRemap')}
                        </button>
                      )}
                      <button onClick={() => setEditing(a)} aria-label={t('budget.accountsEdit')} title={t('budget.accountsEdit')}
                        className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-ink-900 dark:hover:text-white">
                        <Icon.Pencil className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <AccountEditor
          account={editing} accounts={accounts} t={t} push={push}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); afterChange() }}
          onRemap={() => { const a = editing; setEditing(null); setRemapping(a) }}
        />
      )}

      {remapping && (
        <RemapModal
          account={remapping} t={t} push={push}
          onClose={() => setRemapping(null)}
          onDone={() => { setRemapping(null); afterChange() }}
        />
      )}
    </div>
  )
}

function AccountEditor({ account, accounts, t, push, onClose, onSaved, onRemap }) {
  const isNew = !account.code
  const [form, setForm] = useState({
    code: account.code || '',
    label: account.label || '',
    kind: account.kind || 'expense',
    parent_code: account.parent_code || '',
    escalation_pct: account.escalation_pct != null ? String(Number(account.escalation_pct) * 100) : '',
    sort: account.sort ?? '',
    pending_mapping: !!account.pending_mapping,
    active: account.active !== false,
    notes: account.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Cuenta padre: solo del mismo tipo, y nunca ella misma.
  const parents = useMemo(
    () => accounts.filter(a => a.kind === form.kind && a.code !== account.code),
    [accounts, form.kind, account.code],
  )

  async function handleSave() {
    if (!form.label.trim() || (isNew && !form.code.trim())) {
      push({ type: 'error', title: t('budget.required') })
      return
    }
    setSaving(true)
    const body = {
      label: form.label.trim(),
      parent_code: form.parent_code || null,
      escalation_pct: form.escalation_pct === '' ? 0 : Number(form.escalation_pct) / 100,
      sort: form.sort === '' ? 0 : Number(form.sort),
      pending_mapping: form.pending_mapping,
      active: form.active,
      notes: form.notes.trim() || null,
    }
    try {
      if (isNew) {
        await createAccount({ ...body, code: form.code.trim(), kind: form.kind })
      } else {
        await updateAccount(account.code, body)
      }
      push({ type: 'success', title: t('budget.saved') })
      onSaved()
    } catch (err) {
      push({ type: 'error', title: detailText(err, t('common.error')) })
    }
    setSaving(false)
  }

  return (
    <Drawer
      title={isNew ? t('budget.accountsNew') : t('budget.accountsEdit')}
      subtitle={isNew ? undefined : account.code}
      onClose={onClose}
      closeLabel={t('budget.cancel')}
      footer={
        <>
          {!isNew && (
            <button onClick={onRemap} className="btn-fiba-ghost mr-auto">{t('budget.accountsRemap')}</button>
          )}
          <button onClick={onClose} className="btn-fiba-ghost">{t('budget.cancel')}</button>
          <button onClick={handleSave} disabled={saving} className="btn-fiba">{t('budget.save')}</button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('budget.accountsCode')}>
          <input className="fiba-input font-mono" value={form.code} disabled={!isNew}
            onChange={e => set('code', e.target.value)} />
        </Field>
        <Field label={t('budget.accountsKind')}>
          {/* El tipo de una cuenta existente no se cambia: las filas que ya la
              usan se validaron contra ese tipo (_check_account). */}
          <select className="fiba-select" value={form.kind} disabled={!isNew}
            onChange={e => { set('kind', e.target.value); set('parent_code', '') }}>
            <option value="expense">{t('budget.accountsKind_expense')}</option>
            <option value="revenue">{t('budget.accountsKind_revenue')}</option>
          </select>
        </Field>
      </div>
      {!isNew && (
        <p className="text-xs text-fiba-muted -mt-2">{t('budget.accountsCodeFixed')}</p>
      )}
      <Field label={t('budget.accountsLabel')}>
        <input className="fiba-input" value={form.label} onChange={e => set('label', e.target.value)} />
      </Field>
      <Field label={t('budget.accountsParent')}>
        <select className="fiba-select" value={form.parent_code} onChange={e => set('parent_code', e.target.value)}>
          <option value="">—</option>
          {parents.map(a => <option key={a.code} value={a.code}>{a.code} — {a.label}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`${t('budget.escalation')} %`}>
          <input type="number" step="0.1" className="fiba-input" value={form.escalation_pct}
            onChange={e => set('escalation_pct', e.target.value)} />
        </Field>
        <Field label={t('budget.accountsSort')}>
          <input type="number" step="1" className="fiba-input" value={form.sort}
            onChange={e => set('sort', e.target.value)} />
        </Field>
      </div>
      <div className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200 cursor-pointer">
          <input type="checkbox" checked={form.pending_mapping} onChange={() => set('pending_mapping', !form.pending_mapping)}
            className="rounded border-fiba-border" />
          {t('budget.accountsPending')}
          <span className="text-xs text-fiba-muted">— {t('budget.accountsPendingHint')}</span>
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200 cursor-pointer">
          <input type="checkbox" checked={form.active} onChange={() => set('active', !form.active)}
            className="rounded border-fiba-border" />
          {t('budget.accountsActive')}
        </label>
      </div>
      <Field label={t('budget.notes')}>
        <textarea rows={3} className="fiba-input !h-auto py-2" value={form.notes}
          onChange={e => set('notes', e.target.value)} />
      </Field>
    </Drawer>
  )
}

function RemapModal({ account, t, push, onClose, onDone }) {
  const [newCode, setNewCode] = useState('')
  const [mapped, setMapped] = useState(false)   // 409: la usa budget_accounts.py
  const [busy, setBusy] = useState(false)

  const target = newCode.trim()
  const valid = target !== '' && target !== account.code

  async function submit(force) {
    if (!valid) return
    setBusy(true)
    try {
      await remapAccount(account.code, { new_code: target, force })
      push({ type: 'success', title: t('budget.accountsRemapDone', { from: account.code, to: target }) })
      onDone()
    } catch (err) {
      if (!force && isMappedInCode(err)) setMapped(true)
      else push({ type: 'error', title: detailText(err, t('common.error')) })
    }
    setBusy(false)
  }

  return (
    <Modal
      open
      onClose={onClose}
      closeDisabled={busy}
      closeLabel={t('budget.cancel')}
      title={mapped ? t('budget.accountsRemapMappedTitle') : t('budget.accountsRemap')}
      subtitle={`${account.code} — ${account.label}`}
      footer={
        <>
          <button onClick={onClose} disabled={busy} className="btn-fiba-ghost">{t('budget.cancel')}</button>
          {mapped ? (
            <button onClick={() => submit(true)} disabled={busy} className="btn-fiba-danger">
              {busy ? t('common.loading') : t('budget.accountsRemapForce')}
            </button>
          ) : (
            <button onClick={() => submit(false)} disabled={busy || !valid} className="btn-fiba">
              {busy ? t('common.loading') : t('budget.accountsRemap')}
            </button>
          )}
        </>
      }
    >
      {mapped ? (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-300 flex gap-2">
          <Icon.Alert className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{t('budget.accountsRemapMappedBody', { code: account.code })}</span>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-fiba-muted">{t('budget.accountsRemapHint', { code: account.code })}</p>
          <Field label={t('budget.accountsNewCode')}>
            <input autoFocus className="fiba-input font-mono" value={newCode}
              onChange={e => setNewCode(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(false) }} />
          </Field>
        </div>
      )}
    </Modal>
  )
}
