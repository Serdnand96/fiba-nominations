import { useState, useEffect, useCallback, useRef, useId } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import { useToast } from '../../components/ui/Toast'
import { Button, IconButton } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Table } from '../../components/ui/Table'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Icon } from '../../lib/icons'
import {
  getLogisticsHotelCharges, createLogisticsHotelCharge, updateLogisticsHotelCharge, deleteLogisticsHotelCharge,
  getLogisticsHotelPayments,
} from '../../api/client'
import { DocumentsPanel, TextArea, errorMessage, money, nullify, shortDate } from './opsShared'

// Detalle de un hotel: menús, adicionales y cotizaciones, y lo que FIBA le pagó.
//
// Lo único que vive en Logística son los adicionales y las cotizaciones: es un
// registro operativo, informativo. NO es un gasto de Budget y no suma en ningún
// reporte. Lo pagado sale de los gastos de Budget que apuntan a este hotel y se
// lee tal cual, sin copiarlo ni duplicarlo.

const EMPTY_CHARGE = { kind: 'extra', concept: '', amount: '', currency: 'USD', date: '', notes: '' }

const PAYMENT_STATUS = {
  approved: { tone: 'info', es: 'Aprobado', en: 'Approved' },
  paid: { tone: 'success', es: 'Pagado', en: 'Paid' },
}

function ChargeModal({ initial, onClose, onSave }) {
  const { lang } = useLanguage()
  const t = (es, en) => (lang === 'es' ? es : en)
  const formId = useId()
  const listId = useId()
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const editing = !!initial.id

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    const { id: _id, ...fields } = form
    const payload = nullify(fields)
    payload.amount = form.amount === '' ? null : Number(form.amount)
    payload.currency = (form.currency || 'USD').trim().toUpperCase()
    setSaving(true)
    try { await onSave(payload) } finally { setSaving(false) }
  }

  return (
    // Segundo Modal sobre el detalle del hotel: mismo z-50, pero se monta después
    // en <body> y queda por encima.
    <Modal open onClose={onClose} closeDisabled={saving} closeLabel={t('Cerrar', 'Close')} size="md"
      title={editing ? t('Editar adicional / cotización', 'Edit extra / quote') : t('Nuevo adicional / cotización', 'New extra / quote')}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>{t('Cancelar', 'Cancel')}</Button>
          <Button type="submit" form={formId} disabled={saving}>{editing ? t('Guardar', 'Save') : t('Crear', 'Create')}</Button>
        </>
      )}>
      <form id={formId} onSubmit={submit} className="space-y-3">
        <Select label={t('Tipo', 'Type')} value={form.kind} onChange={(v) => setForm(f => ({ ...f, kind: v }))}
          options={[
            { value: 'extra', label: t('Adicional', 'Extra') },
            { value: 'quote', label: t('Cotización', 'Quote') },
          ]} />
        <Input label={`${t('Concepto', 'Item')} *`} required value={form.concept} onChange={set('concept')}
          placeholder={t('Ej.: sala de reuniones extra, cena de gala', 'e.g. Extra meeting room, gala dinner')} />
        <div className="grid grid-cols-3 gap-3">
          <Input wrapperClass="col-span-2" label={t('Monto', 'Amount')} type="number" step="0.01" min="0"
            value={form.amount} onChange={set('amount')} />
          <Input label={t('Moneda', 'Currency')} list={listId} maxLength={3} value={form.currency} onChange={set('currency')} />
          <datalist id={listId}>{['USD', 'COP', 'MXN', 'ARS', 'BRL', 'CLP', 'PEN'].map(c => <option key={c} value={c} />)}</datalist>
        </div>
        <Input label={t('Fecha', 'Date')} type="date" value={form.date} onChange={set('date')} />
        <TextArea label={t('Notas', 'Notes')} value={form.notes} onChange={set('notes')} />
        <p className="text-xs text-fiba-muted">
          {t('Solo de referencia. No cuenta en Presupuesto.', 'For reference only. Not counted in Budget.')}
        </p>
      </form>
    </Modal>
  )
}

export default function HotelDetail({ hotel, competitionId, canEdit, onClose }) {
  const { lang } = useLanguage()
  const { push } = useToast()
  const t = (es, en) => (lang === 'es' ? es : en)

  const [charges, setCharges] = useState([])
  const [chargesFailed, setChargesFailed] = useState(false)
  const [chargeTarget, setChargeTarget] = useState(null)   // fila al editar, EMPTY_CHARGE al crear
  const [filesChargeId, setFilesChargeId] = useState(null) // cotización con sus archivos abiertos
  const [payments, setPayments] = useState(null)           // null = cargando
  const [paymentsFailed, setPaymentsFailed] = useState(false)
  const chargesReq = useRef(0)
  const paymentsReq = useRef(0)

  const loadCharges = useCallback(async () => {
    const request = ++chargesReq.current
    try {
      const data = await getLogisticsHotelCharges(competitionId, hotel.id)
      if (request === chargesReq.current) { setCharges(data); setChargesFailed(false) }
    } catch (err) {
      if (request !== chargesReq.current) return
      setCharges([]); setChargesFailed(true)
      push({ type: 'error', title: errorMessage(err, t('No se pudieron cargar los adicionales.', 'Could not load the extras.')) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competitionId, hotel.id])

  // Si esto falla, el resto del detalle sigue funcionando: solo este bloque
  // muestra el error y un "Reintentar".
  const loadPayments = useCallback(async () => {
    const request = ++paymentsReq.current
    setPayments(null); setPaymentsFailed(false)
    try {
      const data = await getLogisticsHotelPayments(hotel.id)
      if (request === paymentsReq.current) setPayments(data)
    } catch {
      if (request === paymentsReq.current) { setPayments({ rows: [], total_paid: 0, total_approved: 0 }); setPaymentsFailed(true) }
    }
  }, [hotel.id])

  useEffect(() => { loadCharges() }, [loadCharges])
  useEffect(() => { loadPayments() }, [loadPayments])

  async function saveCharge(payload) {
    try {
      if (chargeTarget.id) await updateLogisticsHotelCharge(chargeTarget.id, payload)
      else await createLogisticsHotelCharge({ ...payload, competition_id: competitionId, hotel_id: hotel.id })
      setChargeTarget(null); await loadCharges()
    } catch (err) { push({ type: 'error', title: errorMessage(err, t('No se pudo guardar el adicional.', 'Could not save the extra.')) }) }
  }

  async function removeCharge(c) {
    if (!confirm(t(`¿Eliminar "${c.concept}"? También se eliminan sus archivos.`, `Delete "${c.concept}"? Its files are deleted too.`))) return
    try {
      await deleteLogisticsHotelCharge(c.id)
      if (filesChargeId === c.id) setFilesChargeId(null)
      await loadCharges()
    } catch (err) { push({ type: 'error', title: errorMessage(err, t('No se pudo eliminar el adicional.', 'Could not delete the extra.')) }) }
  }

  const filesCharge = charges.find(c => c.id === filesChargeId) || null

  const chargeColumns = [
    {
      key: 'kind', label: t('Tipo', 'Type'),
      render: c => <Badge tone={c.kind === 'quote' ? 'info' : 'navy'} size="sm">{c.kind === 'quote' ? t('Cotización', 'Quote') : t('Adicional', 'Extra')}</Badge>,
    },
    { key: 'concept', label: t('Concepto', 'Item'), render: c => <span className="font-medium text-ink-900 dark:text-white">{c.concept}</span> },
    {
      key: 'amount', label: t('Monto', 'Amount'), align: 'right',
      render: c => (c.amount == null
        ? <span className="text-fiba-muted">-</span>
        : <span className="tabular-nums whitespace-nowrap">{money(c.amount)} <span className="text-xs text-fiba-muted">{c.currency}</span></span>),
    },
    { key: 'date', label: t('Fecha', 'Date'), render: c => <span className="text-xs whitespace-nowrap">{shortDate(c.date, lang) || '-'}</span> },
    { key: 'notes', label: t('Notas', 'Notes'), render: c => <span className="text-xs text-fiba-muted">{c.notes || '-'}</span> },
    {
      key: 'actions', label: '', className: 'w-28',
      render: c => (
        <div className="flex justify-end items-center gap-1">
          <IconButton size="sm" icon={<Icon.Doc />} label={t('Archivos', 'Files')}
            className={filesChargeId === c.id ? '!bg-ink-100 dark:!bg-navy-800' : ''}
            onClick={() => setFilesChargeId(id => (id === c.id ? null : c.id))} />
          {canEdit && (
            <>
              <IconButton size="sm" icon={<Icon.Pencil />} label={t('Editar', 'Edit')}
                onClick={() => setChargeTarget({
                  id: c.id, kind: c.kind, concept: c.concept || '', amount: c.amount ?? '',
                  currency: c.currency || 'USD', date: c.date || '', notes: c.notes || '',
                })} />
              <IconButton size="sm" icon={<Icon.Trash />} label={t('Eliminar', 'Delete')} className="hover:!text-danger-600"
                onClick={() => removeCharge(c)} />
            </>
          )}
        </div>
      ),
    },
  ]

  const paymentColumns = [
    { key: 'record_no', label: t('N.º de registro', 'Record #'), render: p => <span className="font-mono text-xs whitespace-nowrap">{p.record_no || '-'}</span> },
    {
      key: 'description', label: t('Descripción', 'Description'),
      render: p => (
        <div>
          <div className="text-ink-900 dark:text-white">{p.description || '-'}</div>
          {p.invoice_no && <div className="text-xs text-fiba-muted">{t('Factura', 'Invoice')} {p.invoice_no}</div>}
        </div>
      ),
    },
    { key: 'vendor_name', label: t('Proveedor', 'Vendor'), render: p => <span className="text-xs">{p.vendor_name || '-'}</span> },
    { key: 'amount', label: t('Monto', 'Amount'), align: 'right', render: p => <span className="tabular-nums whitespace-nowrap">${money(p.amount)}</span> },
    {
      key: 'status', label: t('Estado', 'Status'),
      render: p => {
        const st = PAYMENT_STATUS[p.status]
        return st ? <Badge tone={st.tone} size="sm">{st[lang]}</Badge> : <Badge size="sm">{p.status}</Badge>
      },
    },
    {
      key: 'dates', label: t('Fechas', 'Dates'),
      render: p => (
        <div className="text-xs whitespace-nowrap">
          {p.expense_date && <div><span className="text-fiba-muted">{t('Gasto', 'Expense')}:</span> {shortDate(p.expense_date, lang)}</div>}
          {p.payment_date && <div><span className="text-fiba-muted">{t('Pago', 'Paid')}:</span> {shortDate(p.payment_date, lang)}</div>}
          {!p.expense_date && !p.payment_date && '-'}
        </div>
      ),
    },
  ]

  return (
    <>
      {/* Con el modal de adicionales abierto, el detalle no responde a Escape: los
          dos escuchan el teclado en `document` y se cerrarían juntos. */}
      <Modal open onClose={chargeTarget ? undefined : onClose} size="xl" closeLabel={t('Cerrar', 'Close')}
        title={hotel.name}
        subtitle={[hotel.address, hotel.phone].filter(Boolean).join(' · ') || undefined}
        footer={<Button variant="secondary" onClick={onClose}>{t('Cerrar', 'Close')}</Button>}>
        <div className="space-y-8">
          {/* ── Menús ─────────────────────────────────────────── */}
          <section>
            <h4 className="text-sm font-semibold text-ink-900 dark:text-white mb-2">{t('Menús', 'Menus')}</h4>
            <DocumentsPanel competitionId={competitionId} filters={{ kind: 'menu', hotel_id: hotel.id }} canEdit={canEdit}
              labels={{ empty: t('Todavía no hay menús cargados.', 'No menus uploaded yet.'), upload: t('Subir menú', 'Upload menu') }} />
          </section>

          {/* ── Adicionales y cotizaciones ────────────────────── */}
          <section>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
              <h4 className="text-sm font-semibold text-ink-900 dark:text-white">{t('Adicionales y cotizaciones', 'Extras & quotes')}</h4>
              {canEdit && <Button size="xs" icon={<Icon.Plus />} onClick={() => setChargeTarget(EMPTY_CHARGE)}>{t('Agregar', 'Add')}</Button>}
            </div>
            <div className="flex gap-2 rounded-lg border border-ink-200 bg-ink-50 text-ink-700 dark:border-navy-700 dark:bg-navy-950/40 dark:text-ink-300 px-3 py-2 text-xs mb-3">
              <Icon.Info className="w-4 h-4 flex-shrink-0" />
              <p>{t('Montos de referencia. Lo que FIBA paga se carga en Presupuesto y aparece abajo.',
                    'Reference amounts. What FIBA pays is entered in Budget and shows below.')}</p>
            </div>

            {chargesFailed ? (
              <p className="text-xs text-danger-600">
                {t('No se pudieron cargar los adicionales.', 'Could not load the extras.')}{' '}
                <button onClick={loadCharges} className="underline">{t('Reintentar', 'Retry')}</button>
              </p>
            ) : charges.length === 0 ? (
              <p className="text-xs text-fiba-muted">{t('Todavía no hay adicionales ni cotizaciones.', 'No extras or quotes yet.')}</p>
            ) : (
              <Card padding="p-0" className="overflow-hidden">
                <Table columns={chargeColumns} rows={charges} dense />
              </Card>
            )}

            {filesCharge && (
              <div className="mt-3 rounded-lg border border-fiba-border p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-[13px] font-medium text-ink-700 dark:text-ink-200 truncate">
                    {t('Archivos de', 'Files for')} {filesCharge.concept}
                  </p>
                  <IconButton size="xs" icon={<Icon.X />} label={t('Cerrar', 'Close')} onClick={() => setFilesChargeId(null)} />
                </div>
                <DocumentsPanel key={filesCharge.id} competitionId={competitionId}
                  filters={{ kind: 'quote', hotel_id: hotel.id, charge_id: filesCharge.id }} canEdit={canEdit}
                  labels={{ empty: t('Sin archivos adjuntos.', 'No attached files.'), upload: t('Subir PDF', 'Upload PDF') }} />
              </div>
            )}
          </section>

          {/* ── Pagos de FIBA (Budget, solo lectura) ──────────── */}
          <section>
            <h4 className="text-sm font-semibold text-ink-900 dark:text-white mb-1">{t('Pagos de FIBA', 'FIBA payments')}</h4>
            <p className="text-xs text-fiba-muted mb-3">
              {t('Gastos aprobados y pagados en Presupuesto para este hotel.',
                 'Approved and paid Budget expenses for this hotel.')}
            </p>

            {payments === null ? (
              <p className="text-xs text-fiba-muted">{t('Cargando...', 'Loading...')}</p>
            ) : paymentsFailed ? (
              <p className="text-xs text-danger-600">
                {t('No se pudieron cargar los pagos.', 'Could not load the payments.')}{' '}
                <button onClick={loadPayments} className="underline">{t('Reintentar', 'Retry')}</button>
              </p>
            ) : payments.rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-fiba-border px-4 py-5 text-center">
                <p className="text-sm text-ink-700 dark:text-ink-200">
                  {t('Todavía no hay pagos.', 'No payments yet.')}
                </p>
                <p className="text-xs text-fiba-muted mt-1">
                  {t('Aparecen al cargar en Presupuesto un gasto con este hotel.',
                     'They appear when a Budget expense is entered with this hotel.')}
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="rounded-lg border border-fiba-border px-3 py-2">
                    <div className="text-xs text-fiba-muted">{t('Total pagado', 'Total paid')}</div>
                    <div className="text-base font-semibold tabular-nums text-ink-900 dark:text-white">${money(payments.total_paid)}</div>
                  </div>
                  <div className="rounded-lg border border-fiba-border px-3 py-2">
                    <div className="text-xs text-fiba-muted">{t('Aprobado, sin pagar', 'Approved, unpaid')}</div>
                    <div className="text-base font-semibold tabular-nums text-ink-900 dark:text-white">${money(payments.total_approved)}</div>
                  </div>
                </div>
                <Card padding="p-0" className="overflow-hidden">
                  <Table columns={paymentColumns} rows={payments.rows} rowKey="record_no" dense />
                </Card>
              </>
            )}
          </section>
        </div>
      </Modal>

      {chargeTarget && (
        <ChargeModal key={chargeTarget.id || 'new'} initial={chargeTarget}
          onClose={() => setChargeTarget(null)} onSave={saveCharge} />
      )}
    </>
  )
}
