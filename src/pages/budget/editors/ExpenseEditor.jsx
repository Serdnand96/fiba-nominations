import { useEffect, useMemo, useState } from 'react'
import {
  createExpense, updateExpense, getExpenseHistory, getBudgetLines,
  getExpenseAttachments, uploadExpenseAttachment, deleteExpenseAttachment, downloadExpenseAttachment,
  saveBlob,
} from '../../../api/client'
import { Drawer } from '../../../components/ui/Drawer'
import AttachmentList from '../../../components/AttachmentList'
import StatusHistory from '../../../components/StatusHistory'
import { useAuth } from '../../../contexts/AuthContext'
import { useLanguage } from '../../../i18n/LanguageContext'
import { Icon } from '../../../lib/icons'
import { competitionLabel } from '../../../lib/competitions'
import { AccountOptions, Field, today, money, STATUS_BADGE } from '../shared'
import { useBudgetScope } from '../scope'
import { ExpenseActionButtons, errorDetail, expenseActions, useExpenseTransitions } from '../ExpenseActionModals'

// Campos que el backend bloquea en `approved` (409 "reabrir primero").
const FINANCIAL = [
  'department_code', 'account_code', 'competition_id', 'payee_type',
  'vendor_id', 'employee_id', 'payee_name', 'amount', 'expense_date',
]
// En `paid` solo se editan estos dos.
const PAID_EDITABLE = new Set(['invoice_no', 'comments'])

// Normaliza para comparar contra lo guardado: '' y undefined valen null.
const norm = (v) => (v === '' || v === undefined ? null : v)

function formatStamp(value, lang) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString(lang === 'en' ? 'en-US' : 'es-AR', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function ExpenseEditor({
  expense, onClose, onSaved, onChanged, t, push, canEdit = true,
  departments, expenseAccounts, competitions, vendors, employees,
}) {
  const scope = useBudgetScope()
  const { user } = useAuth()
  const { lang } = useLanguage()
  const isNew = !expense.id

  // El gasto tal como está guardado. Se actualiza tras una transición desde el
  // propio detalle, para que los bloqueos y los sellos sigan al estado nuevo.
  const [current, setCurrent] = useState(expense)
  const status = current.status || 'draft'

  // Alta: solo a departamentos que el usuario edita. Edición: el del gasto.
  const editableDepartments = useMemo(
    () => departments.filter(d => scope.canEditDept(d.code)),
    [departments, scope],
  )
  const readOnly = !canEdit || (!isNew && !scope.canEditDept(current.department_code))
  const lockFinancial = readOnly || status === 'approved' || status === 'paid'
  const lockedField = (k) => readOnly || (status === 'paid' && !PAID_EDITABLE.has(k))
    || (status === 'approved' && FINANCIAL.includes(k))

  const [form, setForm] = useState({
    department_code: expense.department_code || editableDepartments[0]?.code || '',
    account_code: expense.account_code || '',
    budget_line_id: expense.budget_line_id || '',
    competition_id: expense.competition_id || '',
    payee_type: expense.payee_type || 'vendor',
    vendor_id: expense.vendor_id || '',
    employee_id: expense.employee_id || '',
    payee_name: expense.payee_name || '',
    description: expense.description || '',
    amount: expense.amount ?? '',
    expense_date: expense.expense_date || today(),
    invoice_no: expense.invoice_no || '',
    comments: expense.comments || '',
    // Solo alta, solo admin general: carga histórica de algo ya pagado.
    historic: false,
    payment_date: today(),
    payment_method: '',
    bank_confirmation: '',
  })
  const [saving, setSaving] = useState(false)
  const [attachments, setAttachments] = useState([])
  const [history, setHistory] = useState([])
  const [lines, setLines] = useState([])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!expense.id) { setAttachments([]); return }
    getExpenseAttachments(expense.id).then(setAttachments).catch(e => { console.error(e); setAttachments([]) })
  }, [expense.id])

  // Se recarga con cada cambio de estado: la transición agrega una fila.
  useEffect(() => {
    if (!current.id) { setHistory([]); return }
    let alive = true
    getExpenseHistory(current.id)
      .then(data => { if (alive) setHistory(Array.isArray(data) ? data : []) })
      .catch(e => { console.error(e); if (alive) setHistory([]) })
    return () => { alive = false }
  }, [current.id, current.status])

  // Líneas de presupuesto elegibles: mismo año, departamento y cuenta (lo que
  // el backend valida). Si la elegida deja de calzar, se limpia.
  const lineYear = /^\d{4}/.test(form.expense_date || '') ? Number(form.expense_date.slice(0, 4)) : null
  useEffect(() => {
    if (!lineYear || !form.department_code || !form.account_code) { setLines([]); return }
    let alive = true
    getBudgetLines({ year: lineYear, department: form.department_code, account: form.account_code })
      .then(data => {
        if (!alive) return
        const list = Array.isArray(data) ? data : []
        setLines(list)
        if (!readOnly) {
          setForm(f => (f.budget_line_id && !list.some(l => String(l.id) === String(f.budget_line_id))
            ? { ...f, budget_line_id: '' } : f))
        }
      })
      .catch(e => { console.error(e); if (alive) setLines([]) })
    return () => { alive = false }
  }, [lineYear, form.department_code, form.account_code, readOnly])

  const transitions = useExpenseTransitions({
    t, push,
    onDone: (updated) => {
      setCurrent(c => ({ ...c, ...updated }))
      onChanged?.(updated)
    },
  })
  const actions = isNew ? [] : expenseActions(current, { scope, canEdit, userId: user?.id })

  function buildBody() {
    return {
      department_code: form.department_code,
      account_code: form.account_code,
      budget_line_id: form.budget_line_id || null,
      competition_id: form.competition_id || null,
      payee_type: form.payee_type,
      vendor_id: form.payee_type === 'vendor' ? (form.vendor_id || null) : null,
      employee_id: form.payee_type === 'employee' ? (form.employee_id || null) : null,
      payee_name: form.payee_type === 'other' ? (form.payee_name || null) : null,
      description: form.description.trim(),
      amount: Number(form.amount || 0),
      expense_date: form.expense_date,
      invoice_no: form.invoice_no || null,
      comments: form.comments || null,
    }
  }

  async function handleSave(e) {
    e?.preventDefault()
    if (readOnly) return
    if (!form.description.trim() || !form.account_code || !form.department_code || form.amount === '') {
      push({ type: 'error', title: t('budget.required') })
      return
    }
    setSaving(true)
    try {
      const body = buildBody()
      if (isNew) {
        // Nace borrador. `paid` directo solo para el admin general (carga
        // histórica); `approved` en el alta el backend lo rechaza. En alta se
        // filtran los null: el default de la columna hace el resto.
        const historic = form.historic && scope.isGeneralAdmin
        const record = {
          ...body,
          status: historic ? 'paid' : 'draft',
          ...(historic ? {
            payment_date: form.payment_date || today(),
            payment_method: form.payment_method || null,
            bank_confirmation: form.bank_confirmation || null,
          } : {}),
        }
        await createExpense(Object.fromEntries(Object.entries(record).filter(([, v]) => v !== null)))
      } else {
        // Solo lo que cambió: el PATCH devuelve 409 si un gasto aprobado o
        // pagado recibe un campo bloqueado, aunque venga con el mismo valor.
        // Un null explícito sigue siendo lo que vacía un campo (exclude_unset),
        // así un gasto de un evento puede pasar a general.
        const changes = Object.fromEntries(Object.entries(body).filter(([k, v]) => {
          if (k === 'amount') return Number(v) !== Number(current.amount ?? 0)
          return String(norm(v)) !== String(norm(current[k]))
        }))
        if (Object.keys(changes).length > 0) await updateExpense(current.id, changes)
      }
      push({ type: 'success', title: t('budget.saved') })
      onSaved()
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, t) })
    }
    setSaving(false)
  }

  async function handleUpload(file, kind) {
    try {
      await uploadExpenseAttachment(expense.id, file, kind)
      setAttachments(await getExpenseAttachments(expense.id))
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, t) })
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
      push({ type: 'error', title: errorDetail(err, t) })
    }
  }

  // Quién firmó cada sello: `*_by` es un uuid, el email sale del historial
  // (la transición más reciente a ese estado). Si fue el propio usuario, su email.
  function stampUser(byId, toStatus) {
    if (byId && user?.id && byId === user.id) return user.email
    const row = history.find(h => h.to_status === toStatus)
    return row?.changed_by_email || null
  }

  const stamps = [
    current.approved_at && {
      key: 'approved', label: t('budget.approvalStampApproved'), at: current.approved_at,
      user: stampUser(current.approved_by, 'approved'), tone: 'text-blue-500 dark:text-blue-400',
    },
    current.paid_at && {
      key: 'paid', label: t('budget.approvalStampPaid'), at: current.paid_at,
      user: stampUser(current.paid_by, 'paid'), tone: 'text-emerald-600 dark:text-emerald-400',
      extra: [current.payment_date, current.payment_method, current.bank_confirmation].filter(Boolean).join(' · '),
    },
    current.rejected_at && {
      key: 'rejected', label: t('budget.approvalStampRejected'), at: current.rejected_at,
      user: stampUser(current.rejected_by, 'rejected'), tone: 'text-red-600 dark:text-red-400',
      reason: current.rejection_reason,
    },
    current.cancelled_at && {
      key: 'cancelled', label: t('budget.approvalStampCancelled'), at: current.cancelled_at,
      user: stampUser(current.cancelled_by, 'cancelled'), tone: 'text-ink-500 dark:text-ink-400',
      reason: current.cancel_reason,
    },
  ].filter(Boolean)

  const departmentOptions = isNew || !lockFinancial
    ? editableDepartments.some(d => d.code === form.department_code)
      ? editableDepartments
      : [...departments.filter(d => d.code === form.department_code), ...editableDepartments]
    : departments

  return (
    <Drawer
      title={isNew ? t('budget.newExpense') : readOnly ? t('budget.approvalView') : t('budget.editExpense')}
      subtitle={current.record_no}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={readOnly ? (
        <button onClick={onClose} className="btn-fiba-ghost">{t('common.close')}</button>
      ) : (
        <>
          <button onClick={onClose} className="btn-fiba-ghost">{t('budget.cancel')}</button>
          <button onClick={handleSave} disabled={saving} className="btn-fiba">
            {saving ? t('common.loading') : t('budget.save')}
          </button>
        </>
      )}
    >
      {!isNew && (
        <div className="rounded-lg border border-fiba-border p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[status]}`}>
                {t(`budget.st_${status}`)}
              </span>
              <span className="text-sm font-semibold text-ink-900 dark:text-white tabular-nums">${money(current.amount)}</span>
            </div>
            <ExpenseActionButtons actions={actions} t={t}
              disabled={transitions.busyId === current.id}
              onRun={a => transitions.run(a, current)} />
          </div>
          {stamps.length > 0 && (
            <ul className="space-y-1">
              {stamps.map(s => (
                <li key={s.key} className="text-xs text-fiba-muted">
                  <span className={`font-medium ${s.tone}`}>{s.label}</span>
                  {' · '}{formatStamp(s.at, lang)}
                  {s.user && <> {' · '}<span className="break-all">{t('common.historyBy', { user: s.user })}</span></>}
                  {s.extra && <span className="block">{s.extra}</span>}
                  {s.reason && (
                    <span className="block text-ink-700 dark:text-ink-200 whitespace-pre-wrap break-words">
                      <span className="font-medium">{t('budget.approvalReason')}:</span> {s.reason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {readOnly ? (
        !isNew && <Hint>{t('budget.approvalReadOnly')}</Hint>
      ) : status === 'approved' ? (
        <Hint>{t('budget.approvalLockedApproved')}</Hint>
      ) : status === 'paid' && !isNew ? (
        <Hint>{t('budget.approvalLockedPaid')}</Hint>
      ) : isNew ? (
        <Hint>{t('budget.approvalNewIsDraft')}</Hint>
      ) : null}

      <Field label={t('budget.description')}>
        <input className="fiba-input" value={form.description} disabled={lockedField('description')}
          onChange={e => set('description', e.target.value)} />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('budget.department')}>
          <select className="fiba-select" value={form.department_code} disabled={lockFinancial}
            onChange={e => set('department_code', e.target.value)}>
            {departmentOptions.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
          </select>
        </Field>
        <Field label={t('budget.amount')}>
          <input type="number" step="0.01" min="0" className="fiba-input" value={form.amount} disabled={lockFinancial}
            onChange={e => set('amount', e.target.value)} />
        </Field>
      </div>

      <Field label={t('budget.account')}>
        <select className="fiba-select" value={form.account_code} disabled={lockFinancial}
          onChange={e => set('account_code', e.target.value)}>
          <option value="">—</option>
          <AccountOptions accounts={expenseAccounts} department={form.department_code} t={t} />
        </select>
      </Field>

      <Field label={t('budget.approvalBudgetLine')}>
        <select className="fiba-select" value={form.budget_line_id}
          disabled={lockedField('budget_line_id') || !form.department_code || !form.account_code}
          onChange={e => set('budget_line_id', e.target.value)}>
          <option value="">{form.department_code && form.account_code
            ? t('budget.approvalBudgetLineNone') : t('budget.approvalBudgetLinePick')}</option>
          {lines.map(l => (
            <option key={l.id} value={l.id}>
              {l.description || l.account_label || l.account_code} — {l.competition_name || t('budget.general')} · ${money(l.amount)}
            </option>
          ))}
        </select>
        <p className="text-xs text-fiba-muted mt-1">{t('budget.approvalBudgetLineHint')}</p>
      </Field>

      <Field label={t('budget.competition')}>
        <select className="fiba-select" value={form.competition_id} disabled={lockFinancial}
          onChange={e => set('competition_id', e.target.value)}>
          <option value="">{t('budget.general')}</option>
          {competitions.map(c => <option key={c.id} value={c.id}>{competitionLabel(c, t('months.short'))}</option>)}
        </select>
      </Field>

      <Field label={t('budget.payee')}>
        <select className="fiba-select" value={form.payee_type} disabled={lockFinancial}
          onChange={e => set('payee_type', e.target.value)}>
          <option value="vendor">{t('budget.payeeVendor')}</option>
          <option value="employee">{t('budget.payeeEmployee')}</option>
          <option value="other">{t('budget.payeeOther')}</option>
        </select>
      </Field>

      {form.payee_type === 'vendor' && (
        <Field label={t('budget.payeeVendor')}>
          <select className="fiba-select" value={form.vendor_id} disabled={lockFinancial}
            onChange={e => set('vendor_id', e.target.value)}>
            <option value="">—</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
      )}
      {form.payee_type === 'employee' && (
        <Field label={t('budget.payeeEmployee')}>
          <select className="fiba-select" value={form.employee_id} disabled={lockFinancial}
            onChange={e => set('employee_id', e.target.value)}>
            <option value="">—</option>
            {employees.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
      )}
      {form.payee_type === 'other' && (
        <Field label={t('budget.payeeName')}>
          <input className="fiba-input" value={form.payee_name} disabled={lockFinancial}
            onChange={e => set('payee_name', e.target.value)} />
        </Field>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('budget.expenseDate')}>
          <input type="date" className="fiba-input" value={form.expense_date} disabled={lockFinancial}
            onChange={e => set('expense_date', e.target.value)} />
        </Field>
        <Field label={t('budget.invoiceNo')}>
          <input className="fiba-input" value={form.invoice_no} disabled={lockedField('invoice_no')}
            onChange={e => set('invoice_no', e.target.value)} />
        </Field>
      </div>

      {isNew && scope.isGeneralAdmin && (
        <div className="rounded-lg border border-fiba-border p-3 space-y-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5 rounded border-fiba-border" checked={form.historic}
              onChange={e => set('historic', e.target.checked)} />
            <span>
              <span className="block text-[13px] font-medium text-ink-700 dark:text-ink-200">{t('budget.approvalHistoric')}</span>
              <span className="block text-xs text-fiba-muted">{t('budget.approvalHistoricHint')}</span>
            </span>
          </label>
          {form.historic && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label={t('budget.paymentDate')}>
                <input type="date" className="fiba-input" value={form.payment_date}
                  onChange={e => set('payment_date', e.target.value)} />
              </Field>
              <Field label={t('budget.paymentMethod')}>
                <input className="fiba-input" value={form.payment_method}
                  onChange={e => set('payment_method', e.target.value)} />
              </Field>
              <Field label={t('budget.bankConfirmation')}>
                <input className="fiba-input" value={form.bank_confirmation}
                  onChange={e => set('bank_confirmation', e.target.value)} />
              </Field>
            </div>
          )}
        </div>
      )}

      <Field label={t('budget.comments')}>
        <textarea rows={2} className="fiba-input !h-auto py-2" value={form.comments} disabled={lockedField('comments')}
          onChange={e => set('comments', e.target.value)} />
      </Field>

      <div className="pt-2 border-t border-fiba-border">
        <p className="text-[13px] font-medium text-ink-700 dark:text-ink-200 mb-2">{t('budget.attachments')}</p>
        {isNew ? (
          <p className="text-xs text-fiba-muted">{t('budget.saveFirst')}</p>
        ) : (
          <AttachmentList
            items={attachments} canEdit={!readOnly}
            onUpload={handleUpload} onDownload={handleDownload} onDelete={handleDeleteAttachment}
            labels={{ kindPlaceholder: t('budget.attachmentKind'), upload: t('budget.upload') }}
          />
        )}
      </div>

      {!isNew && (
        <div className="pt-2 border-t border-fiba-border">
          <p className="text-[13px] font-medium text-ink-700 dark:text-ink-200 mb-3">{t('common.historyTitle')}</p>
          <StatusHistory items={history} />
        </div>
      )}

      {transitions.dialog}
    </Drawer>
  )
}

function Hint({ children }) {
  return (
    <div className="flex gap-2 rounded-lg border border-ink-200 bg-ink-50 text-ink-700 dark:border-navy-700 dark:bg-navy-950/40 dark:text-ink-300 px-3 py-2 text-[13px]">
      <Icon.Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <p>{children}</p>
    </div>
  )
}
