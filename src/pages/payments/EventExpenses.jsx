/**
 * El gasto operativo del evento: lo que cuesta operar la competencia sin que
 * haya una persona nominada detrás — shipping, branding, seguros, proveedores.
 *
 * Vive en la misma tabla `expenses` que la pestaña Gastos de Budget y se edita
 * con el mismo body, pero desde acá se carga con el permiso `payments` y el
 * gasto SIEMPRE cuelga del evento seleccionado (BUDGET_MODULE.md §14.10): sin
 * esa regla, la bandeja sería una puerta lateral para cargar el overhead anual
 * de un departamento sin tener el permiso `budget`.
 */
import { useId, useState } from 'react'
import { createEventExpense, updateEventExpense, deleteEventExpense } from '../../api/client'
import { Icon } from '../../lib/icons'
import { AccountOptions } from '../../lib/accounts'
import {
  Dialog, Field, fieldProps, DepartmentSelect, canSpendOn,
  EXPENSE_STATUSES, EXPENSE_STATUS_BADGES, fmt, today,
} from './shared'

export default function EventExpenses({
  expenses, competitionId, competitionName, departments, accounts, editableAll,
  vendors, employees, canEdit, deptFilter, t, push, onChanged,
}) {
  const [editing, setEditing] = useState(null)   // {} = alta

  const rows = deptFilter ? expenses.filter(e => e.department_code === deptFilter) : expenses
  const subtotal = rows.reduce((acc, r) => acc + Number(r.amount || 0), 0)

  async function handleDelete(row) {
    if (!confirm(t('payments.confirmDeleteExpense'))) return
    try {
      await deleteEventExpense(row.id)
      push({ type: 'success', title: t('payments.expenseDeleted') })
      onChanged()
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('payments.errorSaving') })
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <p className="text-xs text-fiba-muted flex items-center gap-1.5">
          <Icon.Info className="w-3.5 h-3.5 flex-shrink-0" />
          {t('payments.expensesScopeHint')}
        </p>
        {canEdit && (
          <button onClick={() => setEditing({})} className="btn-fiba">{t('payments.newExpense')}</button>
        )}
      </div>

      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="fiba-table">
            <thead>
              <tr>
                <th>{t('payments.record')}</th>
                <th>{t('budget.description')}</th>
                <th>{t('payments.department')}</th>
                <th>{t('budget.account')}</th>
                <th>{t('budget.payee')}</th>
                <th>{t('budget.date')}</th>
                <th className="text-right">{t('budget.amount')}</th>
                <th>{t('payments.status')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const editable = canEdit && canSpendOn(r.department_code, departments, editableAll)
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-mono text-xs text-fiba-muted">{r.record_no || '—'}</td>
                    <td className="px-4 py-3 font-medium text-ink-900 dark:text-white">{r.description}</td>
                    <td className="px-4 py-3">{r.department_label || r.department_code || '—'}</td>
                    <td className="px-4 py-3 text-xs text-fiba-muted">
                      {r.account_code}
                      {r.account_label && <span className="block">{r.account_label}</span>}
                    </td>
                    <td className="px-4 py-3">{r.payee_display || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-fiba-muted">{r.expense_date}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmt(r.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${EXPENSE_STATUS_BADGES[r.status] || ''}`}>
                        {t(`budget.st_${r.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="inline-flex gap-1">
                        <button onClick={() => setEditing(r)}
                          aria-label={`${editable ? t('budget.editExpense') : t('profile.view')}: ${r.description}`}
                          className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-ink-900 dark:hover:text-white">
                          <Icon.Doc className="w-4 h-4" />
                        </button>
                        {editable && (
                          <button onClick={() => handleDelete(r)}
                            aria-label={`${t('payments.deleteExpense')}: ${r.description}`}
                            className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-red-500">
                            <Icon.X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-10 text-center">
                  <p className="font-semibold text-ink-900 dark:text-white">{t('payments.noEventExpenses')}</p>
                  <p className="text-fiba-muted text-sm mt-1 max-w-md mx-auto">{t('payments.noEventExpensesBody')}</p>
                </td></tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-fiba-border font-semibold">
                  <td className="px-4 py-3" colSpan={6}>
                    {deptFilter ? t('payments.filteredSubtotal') : t('payments.total')}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">${fmt(subtotal)}</td>
                  <td className="px-4 py-3" colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {editing && (
        <ExpenseEditor
          expense={editing}
          competitionId={competitionId} competitionName={competitionName}
          departments={departments} accounts={accounts} editableAll={editableAll}
          vendors={vendors} employees={employees} canEdit={canEdit} t={t} push={push}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged() }}
        />
      )}
    </>
  )
}

/* ─── Editor ─────────────────────────────────────────────────────────────────
 *
 * Mismos campos que el editor de Budget, con una diferencia deliberada: el
 * destino NO es elegible. Un gasto cargado desde acá pertenece al evento
 * abierto, y el backend lo exige (`_event_expense_target`).
 */
function ExpenseEditor({
  expense, competitionId, competitionName, departments, accounts, editableAll,
  vendors, employees, canEdit, t, push, onClose, onSaved,
}) {
  const fieldId = useId()
  const isNew = !expense.id
  // El catálogo de proveedores y el de empleados viven detrás de otros permisos
  // (`budget` y `employees`). Quien solo tiene `payments` puede cargar el gasto
  // igual, con el destinatario escrito a mano — que es lo que el backend acepta
  // como `payee_type = 'other'`.
  const hasVendors = Array.isArray(vendors)
  const hasEmployees = Array.isArray(employees)

  const [form, setForm] = useState(() => ({
    department_code: expense.department_code || '',
    account_code: expense.account_code || '',
    payee_type: expense.payee_type || (hasVendors ? 'vendor' : 'other'),
    vendor_id: expense.vendor_id || '',
    employee_id: expense.employee_id || '',
    payee_name: expense.payee_name || '',
    description: expense.description || '',
    amount: expense.amount ?? '',
    expense_date: expense.expense_date || today(),
    payment_date: expense.payment_date || '',
    status: expense.status || 'draft',
    invoice_no: expense.invoice_no || '',
    payment_method: expense.payment_method || '',
    comments: expense.comments || '',
  }))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Igual que en el editor de pagos: un gasto de un área ajena se ve, no se
  // toca. El backend responde 403 sobre el departamento de la fila.
  const rowLocked = !isNew && !canSpendOn(expense.department_code, departments, editableAll)
  const formEnabled = canEdit && !rowLocked

  function validate() {
    const found = {}
    if (!form.description.trim()) found.description = t('payments.descriptionRequired')
    if (!form.department_code) found.department_code = t('payments.departmentRequired')
    else if (!canSpendOn(form.department_code, departments, editableAll)) {
      found.department_code = t('payments.departmentNotAllowed')
    }
    if (!form.account_code) found.account_code = t('payments.accountRequired')
    if (form.amount === '' || Number(form.amount) < 0) found.amount = t('payments.amountRequired')
    if (!form.expense_date) found.expense_date = t('payments.dateRequired')
    if (form.payee_type === 'vendor' && !form.vendor_id) found.payee = t('payments.vendorRequired')
    if (form.payee_type === 'employee' && !form.employee_id) found.payee = t('payments.employeeRequired')
    if (form.payee_type === 'other' && !form.payee_name.trim()) found.payee = t('payments.payeeNameRequired')
    setErrors(found)
    const first = Object.keys(found)[0]
    if (first) {
      // El destinatario tiene tres controles posibles según el tipo elegido.
      const target = first === 'payee'
        ? { vendor: 'vendor', employee: 'employee', other: 'payee-name' }[form.payee_type]
        : EXPENSE_FOCUS[first]
      document.getElementById(`${fieldId}-${target}`)?.focus()
      return false
    }
    return true
  }

  async function handleSave(e) {
    e?.preventDefault()
    if (!validate()) return
    setSaving(true)
    try {
      const body = {
        department_code: form.department_code,
        account_code: form.account_code,
        // El destino es el evento abierto, siempre. `budget_event_id` va en null
        // explícito porque una fila cuelga de UNO de los dos, nunca de los dos.
        competition_id: competitionId,
        budget_event_id: null,
        payee_type: form.payee_type,
        vendor_id: form.payee_type === 'vendor' ? (form.vendor_id || null) : null,
        employee_id: form.payee_type === 'employee' ? (form.employee_id || null) : null,
        payee_name: form.payee_type === 'other' ? form.payee_name.trim() : null,
        description: form.description.trim(),
        amount: Number(form.amount || 0),
        expense_date: form.expense_date,
        // El backend exige fecha de pago si y solo si el estado es "pagado".
        payment_date: form.status === 'paid' ? (form.payment_date || today()) : null,
        status: form.status,
        invoice_no: form.invoice_no || null,
        payment_method: form.payment_method || null,
        comments: form.comments || null,
      }
      // En alta se filtran los null (el default de la columna hace el resto); en
      // edición se manda el body completo, null incluido, porque el PATCH usa
      // exclude_unset y un null explícito es lo que vacía el campo.
      if (isNew) {
        await createEventExpense(Object.fromEntries(Object.entries(body).filter(([, v]) => v !== null)))
      } else {
        await updateEventExpense(expense.id, body)
      }
      push({ type: 'success', title: t('budget.saved') })
      onSaved()
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('payments.errorSaving') })
    }
    setSaving(false)
  }

  return (
    <Dialog
      titleId={`${fieldId}-title`}
      title={isNew ? t('payments.newExpense') : t('budget.editExpense')}
      subtitle={`${competitionName || ''}${expense.record_no ? ` · ${expense.record_no}` : ''}`}
      closeLabel={t('payments.close')}
      onClose={onClose}
      footer={formEnabled ? (
        <>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-fiba-muted hover:underline">
            {t('budget.cancel')}
          </button>
          <button type="submit" form={`${fieldId}-form`} disabled={saving} className="btn-fiba">
            {saving ? t('app.loading') : t('budget.save')}
          </button>
        </>
      ) : null}
    >
      {rowLocked && (
        <p className="rounded-lg border border-warning-500/40 bg-warning-50 dark:bg-warning-500/10 px-3 py-2 text-xs text-warning-700 dark:text-warning-500">
          {t('payments.readOnlyDepartment')}
        </p>
      )}

      <form id={`${fieldId}-form`} onSubmit={handleSave} className="space-y-4">
        <Field id={`${fieldId}-desc`} label={t('budget.description')} error={errors.description}>
          <input {...fieldProps(`${fieldId}-desc`, errors.description)} className="fiba-input w-full"
            value={form.description} disabled={!formEnabled}
            onChange={e => set('description', e.target.value)} />
        </Field>

        {/* El evento no se elige: un gasto cargado desde la bandeja pertenece al
            evento abierto. Se muestra para que no haya dudas de dónde cae. */}
        <div className="rounded-lg border border-fiba-border px-3 py-2">
          <p className="text-xs text-fiba-muted">{t('budget.competition')}</p>
          <p className="text-sm font-medium text-ink-900 dark:text-white">{competitionName}</p>
          <p className="text-2xs text-fiba-muted mt-0.5">{t('payments.expenseBelongsToEvent')}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field id={`${fieldId}-dept`} label={t('payments.department')} error={errors.department_code}
            hint={editableAll ? undefined : t('payments.departmentScopeHint')}>
            <DepartmentSelect
              id={`${fieldId}-dept`} value={form.department_code} onChange={v => set('department_code', v)}
              departments={departments} editableAll={editableAll} disabled={!formEnabled}
              error={errors.department_code} hint={editableAll ? undefined : t('payments.departmentScopeHint')}
              t={t} placeholder={t('payments.selectDepartment')}
            />
          </Field>
          <Field id={`${fieldId}-amount`} label={t('budget.amount')} error={errors.amount}>
            <input {...fieldProps(`${fieldId}-amount`, errors.amount)} type="number" step="0.01" min="0"
              className="fiba-input w-full" value={form.amount} disabled={!formEnabled}
              onChange={e => set('amount', e.target.value)} />
          </Field>
        </div>

        <Field id={`${fieldId}-acct`} label={t('budget.account')} error={errors.account_code}>
          <select {...fieldProps(`${fieldId}-acct`, errors.account_code)} className="fiba-select w-full"
            value={form.account_code} disabled={!formEnabled}
            onChange={e => set('account_code', e.target.value)}>
            <option value="">{t('payments.selectAccount')}</option>
            <AccountOptions accounts={accounts} department={form.department_code} t={t} />
          </select>
        </Field>

        <Field id={`${fieldId}-payee-type`} label={t('budget.payee')}>
          <select id={`${fieldId}-payee-type`} className="fiba-select w-full" value={form.payee_type}
            disabled={!formEnabled} onChange={e => set('payee_type', e.target.value)}>
            <option value="vendor" disabled={!hasVendors && form.payee_type !== 'vendor'}>{t('budget.payeeVendor')}</option>
            <option value="employee" disabled={!hasEmployees && form.payee_type !== 'employee'}>{t('budget.payeeEmployee')}</option>
            <option value="other">{t('budget.payeeOther')}</option>
          </select>
          {(!hasVendors || !hasEmployees) && (
            <p className="text-2xs text-fiba-muted mt-1">{t('payments.payeeCatalogueHint')}</p>
          )}
        </Field>

        {form.payee_type === 'vendor' && (
          <Field id={`${fieldId}-vendor`} label={t('budget.payeeVendor')} error={errors.payee}>
            {hasVendors ? (
              <select {...fieldProps(`${fieldId}-vendor`, errors.payee)} className="fiba-select w-full"
                value={form.vendor_id} disabled={!formEnabled}
                onChange={e => set('vendor_id', e.target.value)}>
                <option value="">—</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            ) : (
              <input {...fieldProps(`${fieldId}-vendor`, errors.payee)} className="fiba-input w-full" disabled
                value={expense.vendor_name || expense.payee_display || '—'} readOnly />
            )}
          </Field>
        )}
        {form.payee_type === 'employee' && (
          <Field id={`${fieldId}-employee`} label={t('budget.payeeEmployee')} error={errors.payee}>
            {hasEmployees ? (
              <select {...fieldProps(`${fieldId}-employee`, errors.payee)} className="fiba-select w-full"
                value={form.employee_id} disabled={!formEnabled}
                onChange={e => set('employee_id', e.target.value)}>
                <option value="">—</option>
                {employees.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            ) : (
              <input {...fieldProps(`${fieldId}-employee`, errors.payee)} className="fiba-input w-full" disabled
                value={expense.employee_name || expense.payee_display || '—'} readOnly />
            )}
          </Field>
        )}
        {form.payee_type === 'other' && (
          <Field id={`${fieldId}-payee-name`} label={t('budget.payeeName')} error={errors.payee}>
            <input {...fieldProps(`${fieldId}-payee-name`, errors.payee)} className="fiba-input w-full"
              value={form.payee_name} disabled={!formEnabled}
              onChange={e => set('payee_name', e.target.value)} />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field id={`${fieldId}-date`} label={t('budget.expenseDate')} error={errors.expense_date}>
            <input {...fieldProps(`${fieldId}-date`, errors.expense_date)} type="date" className="fiba-input w-full"
              value={form.expense_date} disabled={!formEnabled}
              onChange={e => set('expense_date', e.target.value)} />
          </Field>
          <Field id={`${fieldId}-status`} label={t('payments.status')} hint={t('payments.expenseStatusHint')}>
            <select {...fieldProps(`${fieldId}-status`, null, t('payments.expenseStatusHint'))}
              className="fiba-select w-full" value={form.status} disabled={!formEnabled}
              onChange={e => set('status', e.target.value)}>
              {EXPENSE_STATUSES.map(s => <option key={s} value={s}>{t(`budget.st_${s}`)}</option>)}
            </select>
          </Field>
        </div>

        {form.status === 'paid' && (
          <div className="grid grid-cols-2 gap-3">
            <Field id={`${fieldId}-paid-date`} label={t('budget.paymentDate')}>
              <input id={`${fieldId}-paid-date`} type="date" className="fiba-input w-full"
                value={form.payment_date || today()} disabled={!formEnabled}
                onChange={e => set('payment_date', e.target.value)} />
            </Field>
            <Field id={`${fieldId}-method`} label={t('budget.paymentMethod')}>
              <input id={`${fieldId}-method`} className="fiba-input w-full" value={form.payment_method}
                disabled={!formEnabled} onChange={e => set('payment_method', e.target.value)} />
            </Field>
          </div>
        )}

        <Field id={`${fieldId}-invoice`} label={t('budget.invoiceNo')}>
          <input id={`${fieldId}-invoice`} className="fiba-input w-full" value={form.invoice_no}
            disabled={!formEnabled} onChange={e => set('invoice_no', e.target.value)} />
        </Field>

        <Field id={`${fieldId}-comments`} label={t('budget.comments')}>
          <textarea id={`${fieldId}-comments`} rows={2} className="fiba-input w-full !h-auto py-2"
            value={form.comments} disabled={!formEnabled}
            onChange={e => set('comments', e.target.value)} />
        </Field>

        {!isNew && (
          <p className="text-2xs text-fiba-muted">{t('payments.expenseAttachmentsHint')}</p>
        )}
      </form>
    </Dialog>
  )
}

/** Qué campo enfocar cuando falla la validación. */
const EXPENSE_FOCUS = {
  description: 'desc',
  department_code: 'dept',
  account_code: 'acct',
  amount: 'amount',
  expense_date: 'date',
}
