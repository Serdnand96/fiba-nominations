import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  getCalendarCompetitions, getPaymentImputation, getPaymentNominees, getPaymentsSummary,
  createPayment, updatePayment, deletePayment,
  getPaymentAttachments, uploadPaymentAttachment, deletePaymentAttachment,
  downloadPaymentAttachment,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../contexts/AuthContext'
import { roleLabel, roleBadgeClass } from '../lib/roles'
import CompetitionSearch from '../components/CompetitionSearch'
import { Badge } from '../components/ui/Badge'
import { AccountOptions } from '../lib/accounts'

const STATUS_BADGES = {
  new:        'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-500',
  in_process: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  split:      'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400',
  completed:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
}
const STATUSES = ['new', 'in_process', 'split', 'completed']

function fmt(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function Payments() {
  const { t } = useLanguage()
  const { push } = useToast()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('payments')

  const [competitions, setCompetitions] = useState([])
  // Budget imputation catalogues: which department pays and which line each
  // half of the payment consumes (the fee and, separately, the flight).
  const [departments, setDepartments] = useState([])
  const [accounts, setAccounts] = useState([])
  const [roleAccounts, setRoleAccounts] = useState({})
  const [selectedCompId, setSelectedCompId] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [nominees, setNominees] = useState([])
  const [summary, setSummary] = useState({ count: 0, amount: 0, extra: 0, total: 0 })
  const [loading, setLoading] = useState(false)

  // Payment editor
  const [editorNominee, setEditorNominee] = useState(null)   // the nominee row being edited
  // El pago se deriva del nominado abierto en vez de vivir en su propio estado:
  // cuando eran dos copias, la de edición no se refrescaba al guardar y el panel
  // seguía mostrando lo que el usuario había tipeado, no lo que quedó guardado.
  const payment = editorNominee?.payment || null
  const [form, setForm] = useState({
    department_code: '', account_code: '', airfare_account_code: '',
    amount: '', extra: '0', airfare: '0', comments: '', status: 'new',
  })
  const [attachments, setAttachments] = useState([])
  const [attKind, setAttKind] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const fieldId = useId()
  const deptRef = useRef(null)
  const accountRef = useRef(null)
  const airfareAccountRef = useRef(null)
  const panelRef = useRef(null)
  const openerRef = useRef(null)

  useEffect(() => {
    Promise.all([getCalendarCompetitions(), getPaymentImputation()]).then(([comps, imp]) => {
      setCompetitions(comps)
      setDepartments(imp.departments || [])
      setAccounts(imp.accounts || [])
      setRoleAccounts(imp.role_accounts || {})
    }).catch(e => console.error(e))
  }, [])

  async function loadEvent(compId) {
    if (!compId) { setNominees([]); setSummary({ count: 0, amount: 0, extra: 0, total: 0 }); return }
    setLoading(true)
    try {
      const [noms, sum] = await Promise.all([getPaymentNominees(compId), getPaymentsSummary(compId, deptFilter)])
      setNominees(noms)
      setSummary(sum)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { loadEvent(selectedCompId) }, [selectedCompId, deptFilter])

  // El panel es un diálogo: Escape lo cierra y el foco entra adentro. Sin esto
  // el foco se queda en la tabla de atrás, que sigue siendo navegable debajo del
  // overlay.
  useEffect(() => {
    if (!editorNominee) return
    const onKey = e => { if (e.key === 'Escape') closeEditor() }
    document.addEventListener('keydown', onKey)
    panelRef.current?.querySelector('select, input, button')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [editorNominee])

  const deptLabel = (code) => departments.find(d => d.code === code)?.label || code || '—'
  const accountLabel = (code) => {
    const a = accounts.find(x => x.code === code)
    return a ? `${a.code} · ${a.label}` : (code || '—')
  }

  const selectedComp = competitions.find(c => c.id === selectedCompId)

  function openEditor(nominee, event) {
    openerRef.current = event?.currentTarget || null
    setEditorNominee(nominee)
    setErrors({})
    const p = nominee.payment
    // The two accounts default from the nominee's role — a TD's fee is COMP-11
    // and their flight COMP-12 — so the form is one click for the four roles
    // that have a line. A role without a mapping (VIDEO_OPERATOR) comes up
    // empty and has to be picked; the backend rejects it rather than guessing.
    const defaults = roleAccounts[nominee.nominee_role] || {}
    if (p) {
      setForm({
        department_code: p.department_code || '',
        account_code: p.account_code || defaults.fee || '',
        airfare_account_code: p.airfare_account_code || defaults.airfare || '',
        amount: p.amount ?? '',
        extra: p.extra ?? '0',
        airfare: p.airfare ?? '0',
        comments: p.comments || '',
        status: p.status || 'new',
      })
      loadAttachments(p.id)
    } else {
      setForm({
        // Vacío a propósito, y no el filtro de la vista: un filtro es una forma
        // de mirar, no una decisión contable. Si prellenara, filtrar por Comms y
        // cargar el pago de un TD lo imputaría a Comms sin que nadie lo eligiera.
        department_code: '',
        account_code: defaults.fee || '',
        airfare_account_code: defaults.airfare || '',
        amount: nominee.nomination_total ?? '',
        extra: '0',
        airfare: '0',
        comments: '',
        status: 'new',
      })
      setAttachments([])
    }
    setAttKind('')
  }

  function closeEditor() {
    setEditorNominee(null)
    setAttachments([])
    setErrors({})
    // Devolver el foco a lo que abrió el panel: si no, se pierde en el <body> y
    // quien navega por teclado vuelve al principio de la página.
    openerRef.current?.focus?.()
  }

  async function loadAttachments(paymentId) {
    try { setAttachments(await getPaymentAttachments(paymentId)) }
    catch (e) { console.error(e); setAttachments([]) }
  }

  async function handleSave(e) {
    e?.preventDefault()
    const airfare = Number(form.airfare || 0)

    // El error va al lado del campo y no a un toast: el panel scrollea y el
    // botón Guardar está al fondo, así que con adjuntos cargados los selects de
    // imputación quedan fuera de pantalla y el toast no dice cuál de los tres
    // falta. Además se enfoca el primero que falla.
    const found = {}
    if (!form.department_code) found.department_code = t('payments.departmentRequired')
    if (!form.account_code) found.account_code = t('payments.accountRequired')
    if (airfare > 0 && !form.airfare_account_code) {
      found.airfare_account_code = t('payments.airfareAccountRequired')
    }
    setErrors(found)
    if (Object.keys(found).length) {
      const first = found.department_code ? deptRef : found.account_code ? accountRef : airfareAccountRef
      first.current?.focus()
      return
    }
    setSaving(true)
    try {
      const body = {
        department_code: form.department_code,
        account_code: form.account_code,
        // Only travel with a flight attached: the backend clears the account
        // when the airfare is zero, so sending it would be a no-op anyway.
        airfare_account_code: airfare > 0 ? form.airfare_account_code : null,
        amount: Number(form.amount || 0),
        extra: Number(form.extra || 0),
        airfare,
        comments: form.comments || null,
        status: form.status,
      }
      const saved = payment
        ? await updatePayment(payment.id, body)
        : await createPayment({ nomination_id: editorNominee.nomination_id, ...body })
      await loadEvent(selectedCompId)
      // El panel queda abierto sobre el mismo nominado, ahora con lo que el
      // backend devolvió — incluida su normalización (limpiar la cuenta del
      // pasaje cuando el airfare es 0, estampar la fecha al completar).
      setEditorNominee(n => n ? { ...n, payment: saved } : n)
      setForm(f => ({
        ...f,
        airfare_account_code: saved.airfare_account_code || f.airfare_account_code,
      }))
      if (deptFilter && saved.department_code !== deptFilter) {
        push({ type: 'info', title: t('payments.movedOutOfFilter') })
      }
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
      closeEditor()
      await loadEvent(selectedCompId)
    } catch (err) {
      push({ type: 'error', title: err.response?.data?.detail || t('payments.errorSaving') })
    }
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !payment) return
    try {
      await uploadPaymentAttachment(payment.id, file, attKind || null)
      setAttKind('')
      await loadAttachments(payment.id)
    } catch (err) {
      push({ type: 'error', title: err.response?.data?.detail || t('payments.errorUpload') })
    }
  }

  async function handleDownload(att) {
    try {
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

  // With a department filter on, the table and money cards narrow to that
  // department; the Nominated / With payment cards keep counting the whole event.
  const visibleNominees = useMemo(
    () => deptFilter ? nominees.filter(n => n.payment?.department_code === deptFilter) : nominees,
    [nominees, deptFilter]
  )
  const paidCount = useMemo(() => nominees.filter(n => n.payment).length, [nominees])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-ink-900 dark:text-white">{t('nav.payments')}</h1>
      </div>

      {/* Event selector — same searchable + pinnable component as Games/Training/Transport */}
      <div className="flex flex-wrap gap-3 mb-6 items-start">
        <CompetitionSearch
          competitions={competitions}
          value={selectedCompId}
          onChange={setSelectedCompId}
          placeholder={t('payments.selectEvent')}
        />
        {selectedCompId && (
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)} className="fiba-select">
            <option value="">{t('payments.allDepartments')}</option>
            {departments.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
          </select>
        )}
      </div>

      {!selectedCompId ? (
        <div className="text-center py-20 text-fiba-muted/60">{t('payments.pickEventHint')}</div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
            {[
              { label: t('payments.nominated'), value: nominees.length },
              { label: t('payments.withPayment'), value: paidCount },
              { label: t('payments.amount'), value: `$${fmt(summary.amount)}` },
              { label: t('payments.extra'), value: `$${fmt(summary.extra)}` },
              { label: t('payments.total'), value: `$${fmt(summary.total)}` },
              { label: t('payments.airfare'), value: `$${fmt(summary.airfare)}` },
            ].map(s => (
              <div key={s.label} className="fiba-stat">
                <p className="text-xs text-fiba-muted">{s.label}</p>
                <p className="text-2xl font-bold text-ink-900 dark:text-white">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Nominees table */}
          <div className="rounded-xl border border-fiba-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="fiba-table">
                <thead>
                  <tr>
                    <th>{t('payments.nominee')}</th>
                    <th>{t('personnel.role')}</th>
                    <th className="text-right">{t('payments.nominationValue')}</th>
                    <th>{t('payments.department')}</th>
                    <th className="text-right">{t('payments.amount')}</th>
                    <th className="text-right">{t('payments.extra')}</th>
                    <th className="text-right">{t('payments.airfare')}</th>
                    <th>{t('payments.status')}</th>
                    <th>{t('payments.record')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-fiba-muted/60">{t('app.loading')}</td></tr>
                  )}
                  {!loading && visibleNominees.map(n => {
                    const p = n.payment
                    // A payment with no department predates migration 038 and
                    // is invisible to every departmental total — flag it in
                    // amber so it gets classified on the next edit.
                    const unimputed = p && !p.department_code
                    return (
                      <tr key={n.nomination_id}>
                        <td className="px-4 py-3 font-medium">{n.nominee_name}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${roleBadgeClass(n.nominee_role)}`}>{roleLabel(n.nominee_role)}</span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmt(n.nomination_total)}</td>
                        <td className="px-4 py-3">
                          {!p ? '—' : unimputed ? (
                            <span title={t('payments.unimputedHint')}>
                              <Badge tone="warning">{t('payments.unimputed')}</Badge>
                            </span>
                          ) : (
                            <>
                              <span>{deptLabel(p.department_code)}</span>
                              <span className="block text-xs text-fiba-muted">{accountLabel(p.account_code)}</span>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{p ? fmt(p.amount) : '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{p ? fmt(p.extra) : '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{p ? fmt(p.airfare) : '—'}</td>
                        <td className="px-4 py-3">
                          {p
                            ? <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGES[p.status] || ''}`}>{t(`payments.statusLabel.${p.status}`)}</span>
                            : <span className="text-xs text-fiba-muted/60">{t('payments.noPayment')}</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-fiba-muted">{p?.record_no || '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={e => openEditor(n, e)} className="text-fiba-accent hover:underline text-sm">
                            {p ? t('payments.manage') : (canEdit ? t('payments.addPayment') : t('profile.view'))}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {!loading && visibleNominees.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-fiba-muted/60">
                      {deptFilter && nominees.length > 0 ? t('payments.noDepartmentPayments') : t('payments.noNominees')}
                    </td></tr>
                  )}
                </tbody>
                {visibleNominees.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-fiba-border font-semibold">
                      <td className="px-4 py-3" colSpan={4}>{t('payments.total')}</td>
                      <td className="px-4 py-3 text-right tabular-nums">${fmt(summary.amount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">${fmt(summary.extra)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">${fmt(summary.airfare)}</td>
                      <td className="px-4 py-3" colSpan={3}>
                        <span className="text-fiba-accent">{t('payments.grandTotal')}: ${fmt(summary.total)}</span>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </>
      )}

      {/* Payment editor panel */}
      {editorNominee && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={closeEditor} />
          <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={`${fieldId}-title`}
            className="fixed top-0 right-0 h-full w-full max-w-lg bg-fiba-card border-l border-fiba-border z-50 flex flex-col animate-slide-in">
            <div className="flex items-start justify-between p-6 border-b border-fiba-border">
              <div>
                <h3 id={`${fieldId}-title`} className="text-lg font-bold text-ink-900 dark:text-white">
                  {editorNominee.nominee_name}
                </h3>
                <p className="text-sm text-fiba-muted">
                  {selectedComp?.name}{payment?.record_no ? ` · ${payment.record_no}` : ''}
                </p>
                {/* Una fila anterior a la 038 llega sin departamento y el
                    formulario le sugiere una cuenta por rol: sin este aviso, se
                    ve idéntica a una imputada y no hay señal de que falta. */}
                {payment && !payment.department_code && (
                  <div className="mt-2"><Badge tone="warning">{t('payments.unimputed')}</Badge></div>
                )}
              </div>
              <button onClick={closeEditor} aria-label={t('payments.close')}
                className="text-fiba-muted hover:text-ink-900 dark:hover:text-white text-xl leading-none">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <form onSubmit={handleSave} className="space-y-4">
                {/* Budget imputation — whose money it is and which line it consumes */}
                <div>
                  <label htmlFor={`${fieldId}-dept`} className="block text-xs text-fiba-muted mb-1">
                    {t('payments.department')}
                  </label>
                  <select id={`${fieldId}-dept`} ref={deptRef} value={form.department_code} disabled={!canEdit}
                    aria-invalid={!!errors.department_code}
                    aria-describedby={errors.department_code ? `${fieldId}-dept-err` : undefined}
                    onChange={e => setForm(f => ({ ...f, department_code: e.target.value }))}
                    className="fiba-select w-full">
                    <option value="">{t('payments.selectDepartment')}</option>
                    {departments.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
                  </select>
                  {errors.department_code && (
                    <p id={`${fieldId}-dept-err`} className="text-xs text-danger-500 mt-1">{errors.department_code}</p>
                  )}
                </div>

                <div>
                  <label htmlFor={`${fieldId}-acct`} className="block text-xs text-fiba-muted mb-1">
                    {t('payments.feeAccount')}
                  </label>
                  {/* Las cuentas del departamento primero: el plan tiene 34 y
                      subiendo, y para pagarle a un TD no sirve ver "Utilities". */}
                  <select id={`${fieldId}-acct`} ref={accountRef} value={form.account_code} disabled={!canEdit}
                    aria-invalid={!!errors.account_code}
                    aria-describedby={errors.account_code ? `${fieldId}-acct-err` : undefined}
                    onChange={e => setForm(f => ({ ...f, account_code: e.target.value }))}
                    className="fiba-select w-full">
                    <option value="">{t('payments.selectAccount')}</option>
                    <AccountOptions accounts={accounts} department={form.department_code} t={t} />
                  </select>
                  {errors.account_code && (
                    <p id={`${fieldId}-acct-err`} className="text-xs text-danger-500 mt-1">{errors.account_code}</p>
                  )}
                  {/* Solo mientras siga sin elegirse: un aviso que no se apaga
                      cuando el usuario hace lo que pide entrena a ignorarlo. */}
                  {!form.account_code && !roleAccounts[editorNominee.nominee_role] && (
                    <p role="status" className="text-xs text-warning-600 dark:text-warning-500 mt-1">
                      {t('payments.noRoleDefaults')}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-fiba-muted mb-1">{t('payments.amount')}</label>
                    <input type="number" step="0.01" value={form.amount} disabled={!canEdit}
                      onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="fiba-input w-full" />
                    <p className="text-[11px] text-fiba-muted/70 mt-1">{t('payments.fromNomination')}: {fmt(editorNominee.nomination_total)}</p>
                  </div>
                  <div>
                    <label className="block text-xs text-fiba-muted mb-1">{t('payments.extra')}</label>
                    <input type="number" step="0.01" value={form.extra} disabled={!canEdit}
                      onChange={e => setForm(f => ({ ...f, extra: e.target.value }))} className="fiba-input w-full" />
                  </div>
                </div>

                {/* Airfare — not part of the payment total, but its own budget
                    line: a TD's fee is COMP-11 and their flight COMP-12. */}
                <div className="rounded-lg border border-fiba-border p-3 space-y-3">
                  <div>
                    <label htmlFor={`${fieldId}-airfare`} className="block text-xs font-semibold text-ink-900 dark:text-white mb-1">
                      {t('payments.airfare')}
                    </label>
                    <input id={`${fieldId}-airfare`} type="number" step="0.01" min="0" value={form.airfare} disabled={!canEdit}
                      onChange={e => setForm(f => ({ ...f, airfare: e.target.value }))} className="fiba-input w-full" />
                    <p className="text-xs text-fiba-muted mt-1">{t('payments.airfareHint')}</p>
                  </div>
                  {/* Se renderiza siempre y se deshabilita sin pasaje, en vez de
                      aparecer y desaparecer: mostrarlo condicionalmente empujaba
                      medio formulario al tipear el primer dígito del monto, y
                      dejaba invisible una cuenta que seguía elegida. */}
                  <div>
                    <label htmlFor={`${fieldId}-airfare-acct`} className="block text-xs text-fiba-muted mb-1">
                      {t('payments.airfareAccount')}
                    </label>
                    <select id={`${fieldId}-airfare-acct`} ref={airfareAccountRef} value={form.airfare_account_code}
                      disabled={!canEdit || !(Number(form.airfare || 0) > 0)}
                      aria-invalid={!!errors.airfare_account_code}
                      aria-describedby={errors.airfare_account_code ? `${fieldId}-airfare-acct-err` : undefined}
                      onChange={e => setForm(f => ({ ...f, airfare_account_code: e.target.value }))}
                      className="fiba-select w-full disabled:opacity-50">
                      <option value="">{t('payments.selectAccount')}</option>
                      <AccountOptions accounts={accounts} department={form.department_code} t={t} />
                    </select>
                    {errors.airfare_account_code && (
                      <p id={`${fieldId}-airfare-acct-err`} className="text-xs text-danger-500 mt-1">{errors.airfare_account_code}</p>
                    )}
                  </div>
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
                  <>
                    <div className="space-y-2 mb-3">
                      {attachments.map(a => (
                        <div key={a.id} className="flex items-center gap-2 text-sm">
                          <button onClick={() => handleDownload(a)} className="text-fiba-accent hover:underline truncate flex-1 text-left">
                            {a.file_name}
                          </button>
                          {a.kind && <span className="text-xs px-1.5 py-0.5 rounded bg-fiba-surface text-fiba-muted">{a.kind}</span>}
                          {canEdit && (
                            <button onClick={() => handleDeleteAttachment(a)} className="text-red-400 hover:underline text-xs">{t('payments.removeFile')}</button>
                          )}
                        </div>
                      ))}
                      {attachments.length === 0 && <p className="text-xs text-fiba-muted/60">{t('payments.noFiles')}</p>}
                    </div>
                    {canEdit && (
                      <div className="flex items-center gap-2">
                        <input type="text" value={attKind} onChange={e => setAttKind(e.target.value)}
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
            </div>
          </div>
        </>
      )}
    </div>
  )
}
