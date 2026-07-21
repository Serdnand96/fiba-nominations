import { useEffect, useMemo, useState } from 'react'
import {
  getCompetitions, getPaymentBudgets, getPaymentNominees, getPaymentsSummary,
  createPayment, updatePayment, deletePayment,
  getPaymentAttachments, uploadPaymentAttachment, deletePaymentAttachment,
  downloadPaymentAttachment,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'
import { roleLabel, roleBadgeClass } from '../lib/roles'

const STATUS_BADGES = {
  new:        'bg-yellow-500/20 text-yellow-500',
  in_process: 'bg-blue-500/20 text-blue-400',
  split:      'bg-purple-500/20 text-purple-400',
  completed:  'bg-emerald-500/20 text-emerald-400',
}
const STATUSES = ['new', 'in_process', 'split', 'completed']

function fmt(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function Payments() {
  const { t } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('payments')

  const [competitions, setCompetitions] = useState([])
  const [budgets, setBudgets] = useState([])
  const [selectedCompId, setSelectedCompId] = useState('')
  const [nominees, setNominees] = useState([])
  const [summary, setSummary] = useState({ count: 0, amount: 0, extra: 0, total: 0 })
  const [loading, setLoading] = useState(false)

  // Payment editor
  const [editorNominee, setEditorNominee] = useState(null)   // the nominee row being edited
  const [payment, setPayment] = useState(null)               // existing payment (or null = new)
  const [form, setForm] = useState({ budget_code: '', amount: '', extra: '0', comments: '', status: 'new' })
  const [attachments, setAttachments] = useState([])
  const [attKind, setAttKind] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([getCompetitions(), getPaymentBudgets()]).then(([comps, buds]) => {
      setCompetitions(comps)
      setBudgets(buds)
    }).catch(e => console.error(e))
  }, [])

  async function loadEvent(compId) {
    if (!compId) { setNominees([]); setSummary({ count: 0, amount: 0, extra: 0, total: 0 }); return }
    setLoading(true)
    try {
      const [noms, sum] = await Promise.all([getPaymentNominees(compId), getPaymentsSummary(compId)])
      setNominees(noms)
      setSummary(sum)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { loadEvent(selectedCompId) }, [selectedCompId])

  const selectedComp = competitions.find(c => c.id === selectedCompId)

  function openEditor(nominee) {
    setEditorNominee(nominee)
    const p = nominee.payment
    setPayment(p || null)
    if (p) {
      setForm({
        budget_code: p.budget_code || '',
        amount: p.amount ?? '',
        extra: p.extra ?? '0',
        comments: p.comments || '',
        status: p.status || 'new',
      })
      loadAttachments(p.id)
    } else {
      setForm({
        budget_code: budgets[0]?.code || '',
        amount: nominee.nomination_total ?? '',
        extra: '0',
        comments: '',
        status: 'new',
      })
      setAttachments([])
    }
    setAttKind('')
  }

  function closeEditor() {
    setEditorNominee(null)
    setPayment(null)
    setAttachments([])
  }

  async function loadAttachments(paymentId) {
    try { setAttachments(await getPaymentAttachments(paymentId)) }
    catch (e) { console.error(e); setAttachments([]) }
  }

  async function handleSave(e) {
    e?.preventDefault()
    if (!form.budget_code) { alert(t('payments.budgetRequired')); return }
    setSaving(true)
    try {
      const body = {
        budget_code: form.budget_code,
        amount: Number(form.amount || 0),
        extra: Number(form.extra || 0),
        comments: form.comments || null,
        status: form.status,
      }
      let saved
      if (payment) {
        saved = await updatePayment(payment.id, body)
      } else {
        saved = await createPayment({ nomination_id: editorNominee.nomination_id, ...body })
        setPayment(saved)   // switch editor to edit mode so files can be attached
      }
      await loadEvent(selectedCompId)
      // keep editor open on the same nominee, now with the saved payment
      setEditorNominee(n => n ? { ...n, payment: saved } : n)
    } catch (err) {
      alert(err.response?.data?.detail || t('payments.errorSaving'))
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
      alert(err.response?.data?.detail || t('payments.errorSaving'))
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
      alert(err.response?.data?.detail || t('payments.errorUpload'))
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
      alert(err.response?.data?.detail || t('payments.errorDownload'))
    }
  }

  async function handleDeleteAttachment(att) {
    if (!confirm(t('payments.confirmDeleteFile'))) return
    try {
      await deletePaymentAttachment(att.id)
      await loadAttachments(payment.id)
    } catch (err) {
      alert(err.response?.data?.detail || t('payments.errorSaving'))
    }
  }

  const paidCount = useMemo(() => nominees.filter(n => n.payment).length, [nominees])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-ink-900 dark:text-white">{t('nav.payments')}</h1>
      </div>

      {/* Event selector */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select value={selectedCompId} onChange={e => setSelectedCompId(e.target.value)} className="fiba-select w-96 max-w-full">
          <option value="">{t('payments.selectEvent')}</option>
          {competitions.map(c => (
            <option key={c.id} value={c.id}>{c.name}{c.year ? ` — ${c.year}` : ''}</option>
          ))}
        </select>
      </div>

      {!selectedCompId ? (
        <div className="text-center py-20 text-fiba-muted/60">{t('payments.pickEventHint')}</div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
            {[
              { label: t('payments.nominated'), value: nominees.length },
              { label: t('payments.withPayment'), value: paidCount },
              { label: t('payments.amount'), value: `$${fmt(summary.amount)}` },
              { label: t('payments.extra'), value: `$${fmt(summary.extra)}` },
              { label: t('payments.total'), value: `$${fmt(summary.total)}` },
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
                    <th>{t('payments.budget')}</th>
                    <th className="text-right">{t('payments.amount')}</th>
                    <th className="text-right">{t('payments.extra')}</th>
                    <th>{t('payments.status')}</th>
                    <th>{t('payments.record')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-fiba-muted/60">{t('app.loading')}</td></tr>
                  )}
                  {!loading && nominees.map(n => {
                    const p = n.payment
                    const budgetLabel = p ? (budgets.find(b => b.code === p.budget_code)?.label || p.budget_code) : '—'
                    return (
                      <tr key={n.nomination_id}>
                        <td className="px-4 py-3 font-medium">{n.nominee_name}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${roleBadgeClass(n.nominee_role)}`}>{roleLabel(n.nominee_role)}</span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmt(n.nomination_total)}</td>
                        <td className="px-4 py-3">{budgetLabel}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{p ? fmt(p.amount) : '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{p ? fmt(p.extra) : '—'}</td>
                        <td className="px-4 py-3">
                          {p
                            ? <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGES[p.status] || ''}`}>{t(`payments.statusLabel.${p.status}`)}</span>
                            : <span className="text-xs text-fiba-muted/60">{t('payments.noPayment')}</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-fiba-muted">{p?.record_no || '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => openEditor(n)} className="text-fiba-accent hover:underline text-sm">
                            {p ? t('payments.manage') : (canEdit ? t('payments.addPayment') : t('profile.view'))}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {!loading && nominees.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-fiba-muted/60">{t('payments.noNominees')}</td></tr>
                  )}
                </tbody>
                {nominees.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-fiba-border font-semibold">
                      <td className="px-4 py-3" colSpan={4}>{t('payments.total')}</td>
                      <td className="px-4 py-3 text-right tabular-nums">${fmt(summary.amount)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">${fmt(summary.extra)}</td>
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
          <div className="fixed top-0 right-0 h-full w-full max-w-lg bg-fiba-card border-l border-fiba-border z-50 flex flex-col animate-slide-in">
            <div className="flex items-start justify-between p-6 border-b border-fiba-border">
              <div>
                <h3 className="text-lg font-bold text-ink-900 dark:text-white">{editorNominee.nominee_name}</h3>
                <p className="text-sm text-fiba-muted">
                  {selectedComp?.name}{payment?.record_no ? ` · ${payment.record_no}` : ''}
                </p>
              </div>
              <button onClick={closeEditor} className="text-fiba-muted hover:text-ink-900 dark:hover:text-white text-xl leading-none">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <label className="block text-xs text-fiba-muted mb-1">{t('payments.budget')}</label>
                  <select value={form.budget_code} disabled={!canEdit}
                    onChange={e => setForm(f => ({ ...f, budget_code: e.target.value }))} className="fiba-select w-full">
                    <option value="">{t('payments.selectBudget')}</option>
                    {budgets.map(b => <option key={b.code} value={b.code}>{b.label}</option>)}
                  </select>
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
