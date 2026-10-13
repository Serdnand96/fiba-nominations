/**
 * Aprobación de gastos: qué transiciones ofrecer y los modales que las piden.
 *
 * Lo usan la bandeja (`ExpensesTab`, acciones por fila) y el detalle
 * (`ExpenseEditor`, cuando se llega por una notificación). Las dos pantallas
 * comparten `expenseActions()` para no decidir distinto qué botón mostrar.
 *
 * Es solo UX: el backend (`check_expense_transition` en budget.py) es el que
 * manda. Si la UI ofrece algo que el backend no acepta, el 400/403/409 llega
 * con `detail` de texto y se muestra tal cual.
 *
 * Transiciones (plan WP4):
 *   draft     → approved   approver del depto, no el creador (superadmin propio: motivo)
 *   draft     → rejected   approver, motivo
 *   draft     → cancelled  editor, motivo
 *   approved  → paid       editor, fecha (+ medio y confirmación opcionales)
 *   approved  → draft      approver o superadmin
 *   rejected/cancelled → draft   editor
 *   paid      → approved   solo superadmin, motivo
 */
import { useState } from 'react'
import { transitionExpense } from '../../api/client'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Icon } from '../../lib/icons'
import { Field, money, today } from './shared'

/** Texto del error del backend, o el genérico si `detail` no es un string. */
export function errorDetail(err, t) {
  const d = err?.response?.data?.detail
  return typeof d === 'string' && d ? d : t('common.error')
}

/**
 * Acciones disponibles para un gasto, en el orden en que se dibujan.
 *
 * `canEdit` es el permiso de módulo (`budget:edit`); el derecho por
 * departamento sale del scope. Aprobar no exige `budget:edit`: el aprobador
 * puede no cargar gastos.
 */
export function expenseActions(row, { scope, canEdit, userId }) {
  if (!row?.id) return []
  const dept = row.department_code
  const approver = scope.canApproveDept(dept)
  const editor = !!canEdit && scope.canEditDept(dept)
  const own = !!userId && row.created_by === userId
  const out = []
  switch (row.status) {
    case 'draft':
      // Lo propio no se aprueba ni se rechaza: para eso está "Anular". El
      // superadmin puede aprobarlo igual, con motivo y marca de override.
      if (approver && !own) out.push('approve', 'reject')
      else if (own && scope.isSuperadmin) out.push('approveOverride')
      if (editor) out.push('cancel')
      break
    case 'approved':
      if (editor) out.push('pay')
      if (approver) out.push('reopen')
      break
    case 'rejected':
    case 'cancelled':
      if (editor) out.push('reopen')
      break
    case 'paid':
      if (scope.isSuperadmin) out.push('reopenPaid')
      break
    default:
      break
  }
  return out
}

// Acción → presentación. `primary` = va como botón con texto también en la
// fila compacta; el resto queda como icono en la fila y con texto en el detalle.
const ACTION_UI = {
  approve:         { label: 'budget.approve',        icon: Icon.Check,   primary: true,  hover: 'hover:text-success-600' },
  approveOverride: { label: 'budget.approve',        icon: Icon.Alert,   primary: true,  hover: 'hover:text-warning-600' },
  pay:             { label: 'budget.approvalPay',    icon: Icon.Wallet,  primary: true,  hover: 'hover:text-success-600' },
  reject:          { label: 'budget.approvalReject', icon: Icon.X,       primary: false, hover: 'hover:text-danger-600' },
  cancel:          { label: 'budget.approvalCancel', icon: Icon.Minus,   primary: false, hover: 'hover:text-danger-600' },
  reopen:          { label: 'budget.approvalReopen', icon: Icon.History, primary: false, hover: 'hover:text-ink-900 dark:hover:text-white' },
  reopenPaid:      { label: 'budget.approvalReopen', icon: Icon.History, primary: false, hover: 'hover:text-warning-600' },
}

/**
 * Botones de transición. `compact` es la variante de la fila de la tabla:
 * las acciones principales con texto, las secundarias como icono.
 */
export function ExpenseActionButtons({ actions, onRun, disabled = false, compact = false, t }) {
  if (!actions.length) return null
  return (
    <div className={`inline-flex flex-wrap items-center gap-1 ${compact ? 'justify-end' : ''}`}>
      {actions.map(a => {
        const ui = ACTION_UI[a]
        const Ico = ui.icon
        const label = t(ui.label)
        if (compact && !ui.primary) {
          return (
            <button key={a} type="button" onClick={() => onRun(a)} disabled={disabled}
              title={label} aria-label={label}
              className={`p-1.5 rounded hover:bg-fiba-surface text-fiba-muted disabled:opacity-40 ${ui.hover}`}>
              <Ico className="w-4 h-4" />
            </button>
          )
        }
        return (
          <Button key={a} type="button" size="xs"
            variant={ui.primary ? 'secondary' : 'ghost'}
            icon={<Ico />} onClick={() => onRun(a)} disabled={disabled}
            title={a === 'approveOverride' ? t('budget.approvalOverrideTitle') : undefined}>
            {label}
          </Button>
        )
      })}
    </div>
  )
}

/**
 * Orquesta una transición: las que no piden nada se ejecutan directo
 * (aprobar) o con un confirm (reabrir a borrador); las demás abren su modal.
 *
 *   const { run, dialog, busyId } = useExpenseTransitions({ t, push, onDone })
 *   …onRun={a => run(a, row)}…
 *   {dialog}
 *
 * `onDone(updated)` recibe el gasto que devuelve el backend.
 */
export function useExpenseTransitions({ t, push, onDone }) {
  const [pending, setPending] = useState(null)   // { action, row }
  const [busyId, setBusyId] = useState(null)

  async function submit(row, payload) {
    setBusyId(row.id)
    try {
      const updated = await transitionExpense(row.id, payload)
      push({ type: 'success', title: t(`budget.approvalDone_${payload.status}`) })
      setPending(null)
      onDone?.(updated && typeof updated === 'object' ? updated : { ...row, status: payload.status })
      return true
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, t) })
      return false
    } finally {
      setBusyId(null)
    }
  }

  function run(action, row) {
    if (action === 'approve') return submit(row, { status: 'approved' })
    if (action === 'reopen') {
      if (!window.confirm(t('budget.approvalConfirmReopen'))) return
      return submit(row, { status: 'draft' })
    }
    setPending({ action, row })
  }

  let dialog = null
  if (pending) {
    const { action, row } = pending
    const close = () => { if (busyId == null) setPending(null) }
    const busy = busyId === row.id
    if (action === 'pay') {
      dialog = <PayModal expense={row} t={t} busy={busy} onClose={close}
        onSubmit={payload => submit(row, { status: 'paid', ...payload })} />
    } else {
      const Comp = REASON_MODALS[action]
      dialog = Comp
        ? <Comp expense={row} t={t} busy={busy} onClose={close} onSubmit={payload => submit(row, payload)} />
        : null
    }
  }

  return { run, dialog, busyId }
}

/* ─── Modales ──────────────────────────────────────────────────────────────── */

function ExpenseSummary({ expense, t }) {
  return (
    <div className="rounded-lg bg-ink-50 dark:bg-navy-950/40 border border-ink-200 dark:border-navy-800 px-3 py-2 mb-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-ink-900 dark:text-white truncate">{expense.description}</p>
        <p className="text-sm font-semibold text-ink-900 dark:text-white tabular-nums whitespace-nowrap">${money(expense.amount)}</p>
      </div>
      <p className="text-xs text-fiba-muted mt-0.5 truncate">
        <span className="font-mono">{expense.record_no}</span>
        {' · '}{expense.department_label || expense.department_code}
        {' · '}{expense.competition_name || t('budget.general')}
      </p>
    </div>
  )
}

function Notice({ warning = false, children }) {
  const cls = warning
    ? 'border-warning-500/40 bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-500'
    : 'border-ink-200 bg-ink-50 text-ink-700 dark:border-navy-700 dark:bg-navy-950/40 dark:text-ink-300'
  return (
    <div className={`flex gap-2 rounded-lg border px-3 py-2 text-[13px] mb-4 ${cls}`}>
      {warning ? <Icon.Alert className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <Icon.Info className="w-4 h-4 flex-shrink-0 mt-0.5" />}
      <p>{children}</p>
    </div>
  )
}

/** Modal genérico de motivo obligatorio: rechazar, anular, autoaprobar, reabrir pagado. */
function ReasonModal({ expense, t, busy, onClose, onSubmit, status, title, hint, confirm, variant = 'primary', warning = false }) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const missing = !reason.trim()

  function handleSubmit(e) {
    e?.preventDefault()
    setTouched(true)
    if (missing) return
    onSubmit({ status, reason: reason.trim() })
  }

  return (
    <Modal open onClose={onClose} title={t(title)} closeLabel={t('common.close')} closeDisabled={busy}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>{t('budget.cancel')}</Button>
          <Button type="submit" form="expense-reason-form" variant={variant} disabled={busy}>
            {busy ? t('common.loading') : t(confirm)}
          </Button>
        </>
      }>
      <form id="expense-reason-form" onSubmit={handleSubmit}>
        <ExpenseSummary expense={expense} t={t} />
        <Notice warning={warning}>{t(hint)}</Notice>
        <Field label={`${t('budget.approvalReason')} *`}>
          <textarea rows={3} className="fiba-input !h-auto py-2" value={reason} required
            aria-invalid={touched && missing}
            onChange={e => setReason(e.target.value)} onBlur={() => setTouched(true)} />
        </Field>
        {touched && missing && (
          <p className="text-xs text-danger-600 dark:text-danger-500 mt-1">{t('budget.approvalReasonRequired')}</p>
        )}
      </form>
    </Modal>
  )
}

export function RejectModal(props) {
  return <ReasonModal {...props} status="rejected" title="budget.approvalRejectTitle"
    hint="budget.approvalRejectHint" confirm="budget.approvalReject" variant="danger" />
}

export function CancelModal(props) {
  return <ReasonModal {...props} status="cancelled" title="budget.approvalCancelTitle"
    hint="budget.approvalCancelHint" confirm="budget.approvalCancel" variant="danger" />
}

/** Superadmin aprobando un gasto propio: confirm ámbar con motivo obligatorio. */
export function SelfApproveModal(props) {
  return <ReasonModal {...props} status="approved" title="budget.approvalOverrideTitle"
    hint="budget.approvalOverrideHint" confirm="budget.approve" variant="primary" warning />
}

/** paid → approved, solo superadmin. */
export function ReopenPaidModal(props) {
  return <ReasonModal {...props} status="approved" title="budget.approvalReopenPaidTitle"
    hint="budget.approvalReopenPaidHint" confirm="budget.approvalReopen" variant="secondary" warning />
}

const REASON_MODALS = {
  reject: RejectModal,
  cancel: CancelModal,
  approveOverride: SelfApproveModal,
  reopenPaid: ReopenPaidModal,
}

/** approved → paid: fecha obligatoria, medio y confirmación opcionales. */
export function PayModal({ expense, t, busy, onClose, onSubmit }) {
  const [form, setForm] = useState({
    payment_date: today(),
    payment_method: expense.payment_method || '',
    bank_confirmation: expense.bank_confirmation || '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function handleSubmit(e) {
    e?.preventDefault()
    if (!form.payment_date) return
    onSubmit({
      payment_date: form.payment_date,
      ...(form.payment_method.trim() ? { payment_method: form.payment_method.trim() } : {}),
      ...(form.bank_confirmation.trim() ? { bank_confirmation: form.bank_confirmation.trim() } : {}),
    })
  }

  return (
    <Modal open onClose={onClose} title={t('budget.approvalPayTitle')} closeLabel={t('common.close')} closeDisabled={busy}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>{t('budget.cancel')}</Button>
          <Button type="submit" form="expense-pay-form" disabled={busy || !form.payment_date}>
            {busy ? t('common.loading') : t('budget.approvalPay')}
          </Button>
        </>
      }>
      <form id="expense-pay-form" onSubmit={handleSubmit} className="space-y-3">
        <ExpenseSummary expense={expense} t={t} />
        <Notice>{t('budget.approvalPayHint')}</Notice>
        <Field label={`${t('budget.paymentDate')} *`}>
          <input type="date" required className="fiba-input" value={form.payment_date}
            onChange={e => set('payment_date', e.target.value)} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t('budget.paymentMethod')}>
            <input className="fiba-input" value={form.payment_method}
              onChange={e => set('payment_method', e.target.value)} />
          </Field>
          <Field label={t('budget.bankConfirmation')}>
            <input className="fiba-input" value={form.bank_confirmation}
              onChange={e => set('bank_confirmation', e.target.value)} />
          </Field>
        </div>
      </form>
    </Modal>
  )
}
