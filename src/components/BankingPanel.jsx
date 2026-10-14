/**
 * Ficha bancaria y formulario fiscal (W-8) de una persona nominada
 * (`personnel_banking`, migración 047).
 *
 * - Llega enmascarada (`****1234`). "Mostrar" pide la ficha completa por
 *   `POST …/banking/reveal`, que es POST a propósito para que quede en el
 *   activity_log: cada vez que alguien ve una cuenta completa, queda registrado.
 * - Editar exige `payments:edit` y arranca revelando, para que el formulario no
 *   guarde los valores enmascarados encima de los reales.
 * - El W-8 vive acá, una vez por persona, y no adjunto en cada pago. `exempt`
 *   no lleva archivo. El vencimiento se prellena al 31/12 del tercer año
 *   siguiente a la firma. Bajar el PDF es `POST …/tax-form/download` y exige
 *   `payments:edit`: con solo `payments:view` se ve el estado, no el archivo.
 *
 * Solo se monta para quien tiene `payments:view` (PersonProfilePanel y el
 * drawer de Pagos lo condicionan). Ocultarlo es UX: el backend es el que corta.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getPersonnelBanking, revealPersonnelBanking, updatePersonnelBanking,
  uploadPersonnelTaxForm, downloadPersonnelTaxForm, deletePersonnelTaxForm, saveBlob,
} from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { useToast } from './ui/Toast'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { Icon } from '../lib/icons'
import { TAX_FORM_KINDS, TAX_FORM_TONE, defaultTaxFormExpiry, errorDetail } from '../pages/payments/shared'

const BANK_FIELDS = [
  'account_holder', 'bank_name', 'bank_address', 'account_number',
  'routing_number', 'swift', 'iban', 'currency', 'notes',
]
const PAYMENT_METHODS = ['wire', 'ach', 'other']

function emptyBankForm() {
  return {
    payment_method: 'wire', account_holder: '', bank_name: '', bank_address: '',
    account_number: '', routing_number: '', swift: '', iban: '', currency: 'USD', notes: '',
  }
}

function bankFormFrom(b) {
  const f = emptyBankForm()
  if (!b) return f
  for (const k of Object.keys(f)) f[k] = b[k] ?? f[k] ?? ''
  return f
}

function taxFormFrom(b) {
  return {
    tax_form_kind: b?.tax_form_kind || 'W-8BEN',
    tax_form_signed_at: b?.tax_form_signed_at || '',
    tax_form_expires_at: b?.tax_form_expires_at || '',
    file: null,
  }
}

/**
 * Estado del W-8 como badge. Exportado para la cola y el drawer de Pagos.
 */
export function TaxFormBadge({ status }) {
  const { t } = useLanguage()
  if (!status) return null
  return (
    <Badge tone={TAX_FORM_TONE[status] || 'ink'} size="sm">
      {t(`payments.taxForm.${status}`)}
    </Badge>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs text-fiba-muted mb-1">{label}</label>
      {children}
    </div>
  )
}

export default function BankingPanel({ personnelId, initial, onChange }) {
  const { t } = useLanguage()
  const { push } = useToast()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('payments')

  // undefined = cargando · objeto = ficha (enmascarada o no; `exists: false`
  // si la persona todavía no tiene). null solo si la lectura falló.
  const [banking, setBanking] = useState(initial)
  const [revealed, setRevealed] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState(false)

  const [editingBank, setEditingBank] = useState(false)
  const [bankForm, setBankForm] = useState(emptyBankForm)
  const [editingTax, setEditingTax] = useState(false)
  const [taxForm, setTaxForm] = useState(() => taxFormFrom(null))

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const publish = useCallback((b) => { setBanking(b); onChangeRef.current?.(b) }, [])
  const hasTaxFile = !!(banking?.has_tax_form_file ?? banking?.tax_form_file_name)

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      publish(await getPersonnelBanking(personnelId))
    } catch (err) {
      console.error(err)
      setLoadError(true)
      setBanking(null)
    }
    setRevealed(false)
  }, [personnelId, publish])

  useEffect(() => {
    if (initial === undefined) load()
    // `initial` solo siembra el primer render; después la ficha es nuestra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personnelId])

  async function reveal() {
    setBusy(true)
    try {
      const full = await revealPersonnelBanking(personnelId)
      setBanking(b => ({ ...(b || {}), ...full }))
      setRevealed(true)
      return full
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, t('payments.banking.revealError')) })
      return null
    } finally {
      setBusy(false)
    }
  }

  function hide() {
    // Volver a la versión enmascarada: se pide de nuevo en vez de enmascarar
    // en el cliente, para no quedarse con la cuenta completa en memoria.
    load()
  }

  async function startEditBank() {
    if (banking?.exists) {
      const full = revealed ? banking : await reveal()
      if (!full) return
      setBankForm(bankFormFrom(full))
    } else {
      setBankForm(emptyBankForm())
    }
    setEditingBank(true)
  }

  async function saveBank(e) {
    e.preventDefault()
    setBusy(true)
    try {
      const body = {}
      for (const [k, v] of Object.entries(bankForm)) body[k] = (typeof v === 'string' ? v.trim() : v) || null
      await updatePersonnelBanking(personnelId, body)
      setEditingBank(false)
      await load()
      push({ type: 'success', title: t('payments.banking.saved') })
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, t('payments.banking.saveError')) })
    }
    setBusy(false)
  }

  function startEditTax() {
    setTaxForm(taxFormFrom(banking))
    setEditingTax(true)
  }

  function setSignedAt(value) {
    setTaxForm(f => ({ ...f, tax_form_signed_at: value, tax_form_expires_at: defaultTaxFormExpiry(value) }))
  }

  async function saveTax(e) {
    e.preventDefault()
    const exempt = taxForm.tax_form_kind === 'exempt'
    if (!exempt && !taxForm.file && !hasTaxFile) {
      push({ type: 'error', title: t('payments.banking.fileRequired') })
      return
    }
    setBusy(true)
    try {
      if (!exempt && taxForm.file) {
        // Documento nuevo: el upload guarda tipo, firma y vencimiento junto con
        // el PDF (y crea la ficha si no existía).
        await uploadPersonnelTaxForm(personnelId, taxForm.file, {
          kind: taxForm.tax_form_kind,
          signed_at: taxForm.tax_form_signed_at,
          expires_at: taxForm.tax_form_expires_at,
        })
      } else {
        // Sin archivo nuevo: `exempt`, o corregir tipo/fechas del que ya está.
        await updatePersonnelBanking(personnelId, {
          tax_form_kind: taxForm.tax_form_kind,
          tax_form_signed_at: exempt ? null : (taxForm.tax_form_signed_at || null),
          tax_form_expires_at: exempt ? null : (taxForm.tax_form_expires_at || null),
        })
      }
      setEditingTax(false)
      await load()
      push({ type: 'success', title: t('payments.banking.taxSaved') })
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, t('payments.banking.uploadError')) })
    }
    setBusy(false)
  }

  async function downloadTax() {
    try {
      saveBlob(await downloadPersonnelTaxForm(personnelId), banking?.tax_form_file_name || 'tax-form.pdf')
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, t('payments.errorDownload')) })
    }
  }

  async function deleteTax() {
    if (!confirm(t('payments.banking.taxDeleteConfirm'))) return
    setBusy(true)
    try {
      await deletePersonnelTaxForm(personnelId)
      await load()
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, t('payments.banking.saveError')) })
    }
    setBusy(false)
  }

  if (banking === undefined) {
    return <p className="text-sm text-fiba-muted/60">{t('app.loading')}</p>
  }
  if (loadError) {
    return <p className="text-sm text-danger-600 dark:text-danger-500">{t('payments.banking.loadError')}</p>
  }

  const hasBank = !!banking?.has_bank_info
  const taxStatus = banking?.tax_form_status || 'missing'
  const expiresAt = banking?.tax_form_expires_at || banking?.tax_form_effective_expires_at

  return (
    <div className="space-y-5">
      {/* ── Cuenta bancaria ───────────────────────────────────────────── */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h5 className="text-xs font-semibold uppercase tracking-wider text-fiba-muted">{t('payments.banking.account')}</h5>
          {!editingBank && (
            <div className="flex gap-1">
              {hasBank && canEdit && (
                revealed
                  ? <Button size="xs" variant="ghost" icon={<Icon.Eye />} onClick={hide} disabled={busy}>{t('payments.banking.hide')}</Button>
                  : <Button size="xs" variant="ghost" icon={<Icon.Eye />} onClick={reveal} disabled={busy}>{t('payments.banking.show')}</Button>
              )}
              {canEdit && (
                <Button size="xs" variant="secondary" icon={hasBank ? <Icon.Pencil /> : <Icon.Plus />} onClick={startEditBank} disabled={busy}>
                  {hasBank ? t('payments.banking.edit') : t('payments.banking.add')}
                </Button>
              )}
            </div>
          )}
        </div>

        {editingBank ? (
          <form onSubmit={saveBank} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t('payments.banking.payment_method')}>
                <select value={bankForm.payment_method} onChange={e => setBankForm(f => ({ ...f, payment_method: e.target.value }))} className="fiba-select w-full">
                  {PAYMENT_METHODS.map(m => <option key={m} value={m}>{t(`payments.banking.method.${m}`)}</option>)}
                </select>
              </Field>
              <Field label={t('payments.banking.currency')}>
                <input value={bankForm.currency} maxLength={3}
                  onChange={e => setBankForm(f => ({ ...f, currency: e.target.value.toUpperCase() }))} className="fiba-input w-full" />
              </Field>
            </div>
            {['account_holder', 'bank_name', 'bank_address'].map(k => (
              <Field key={k} label={t(`payments.banking.${k}`)}>
                <input value={bankForm[k]} onChange={e => setBankForm(f => ({ ...f, [k]: e.target.value }))} className="fiba-input w-full" />
              </Field>
            ))}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {['account_number', 'routing_number', 'swift', 'iban'].map(k => (
                <Field key={k} label={t(`payments.banking.${k}`)}>
                  <input value={bankForm[k]} autoComplete="off" spellCheck={false}
                    onChange={e => setBankForm(f => ({ ...f, [k]: e.target.value }))} className="fiba-input w-full font-mono" />
                </Field>
              ))}
            </div>
            <Field label={t('payments.banking.notes')}>
              <textarea rows={2} value={bankForm.notes} onChange={e => setBankForm(f => ({ ...f, notes: e.target.value }))} className="fiba-input w-full" />
            </Field>
            <div className="flex gap-2 justify-end">
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditingBank(false)} disabled={busy}>{t('common.cancel')}</Button>
              <Button type="submit" size="sm" variant="navy" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</Button>
            </div>
          </form>
        ) : !hasBank ? (
          <p className="text-sm text-fiba-muted/70">{t('payments.banking.none')}</p>
        ) : (
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-sm">
            {banking.payment_method && (
              <>
                <dt className="text-fiba-muted">{t('payments.banking.payment_method')}</dt>
                <dd className="text-ink-900 dark:text-white">{t(`payments.banking.method.${banking.payment_method}`)}</dd>
              </>
            )}
            {BANK_FIELDS.filter(k => banking[k]).map(k => (
              <div key={k} className="contents">
                <dt className="text-fiba-muted">{t(`payments.banking.${k}`)}</dt>
                <dd className={`text-ink-900 dark:text-white break-all ${['account_number', 'routing_number', 'swift', 'iban'].includes(k) ? 'font-mono' : ''}`}>
                  {banking[k]}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {hasBank && canEdit && !revealed && !editingBank && (
          <p className="text-[11px] text-fiba-muted/70 mt-2">{t('payments.banking.revealAudit')}</p>
        )}
      </section>

      {/* ── Formulario fiscal (W-8 / W-9 / exento) ───────────────────── */}
      <section className="pt-4 border-t border-fiba-border">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <h5 className="text-xs font-semibold uppercase tracking-wider text-fiba-muted">{t('payments.banking.taxFormTitle')}</h5>
            <TaxFormBadge status={taxStatus} />
          </div>
          {canEdit && !editingTax && (
            <Button size="xs" variant="secondary" icon={<Icon.Upload />} onClick={startEditTax} disabled={busy}>
              {banking?.tax_form_kind ? t('payments.banking.taxUpdate') : t('payments.banking.taxAdd')}
            </Button>
          )}
        </div>

        {editingTax ? (
          <form onSubmit={saveTax} className="space-y-3">
            <Field label={t('payments.banking.taxKind')}>
              <select value={taxForm.tax_form_kind} onChange={e => setTaxForm(f => ({ ...f, tax_form_kind: e.target.value }))} className="fiba-select w-full">
                {TAX_FORM_KINDS.map(k => <option key={k} value={k}>{k === 'exempt' ? t('payments.taxForm.exempt') : k}</option>)}
              </select>
            </Field>
            {taxForm.tax_form_kind === 'exempt' ? (
              <p className="text-xs text-fiba-muted">{t('payments.banking.exemptHint')}</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label={t('payments.banking.taxSignedAt')}>
                    <input type="date" value={taxForm.tax_form_signed_at} onChange={e => setSignedAt(e.target.value)} className="fiba-input w-full" />
                  </Field>
                  <Field label={t('payments.banking.taxExpiresAt')}>
                    <input type="date" value={taxForm.tax_form_expires_at}
                      onChange={e => setTaxForm(f => ({ ...f, tax_form_expires_at: e.target.value }))} className="fiba-input w-full" />
                  </Field>
                </div>
                <p className="text-[11px] text-fiba-muted/70 -mt-1">{t('payments.banking.taxExpiresHint')}</p>
                <Field label={t('payments.banking.taxFile')}>
                  <input type="file" accept="application/pdf"
                    onChange={e => setTaxForm(f => ({ ...f, file: e.target.files?.[0] || null }))}
                    className="block w-full text-sm text-fiba-muted file:mr-3 file:rounded-md file:border-0 file:bg-ink-100 file:px-3 file:py-1.5 file:text-sm file:text-ink-800 dark:file:bg-navy-800 dark:file:text-ink-100" />
                  {hasTaxFile && !taxForm.file && (
                    <p className="text-[11px] text-fiba-muted/70 mt-1">{t('payments.banking.taxKeepFile', { name: banking.tax_form_file_name })}</p>
                  )}
                </Field>
              </>
            )}
            <div className="flex gap-2 justify-end">
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditingTax(false)} disabled={busy}>{t('common.cancel')}</Button>
              <Button type="submit" size="sm" variant="navy" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</Button>
            </div>
          </form>
        ) : !banking?.tax_form_kind ? (
          <p className="text-sm text-fiba-muted/70">{t('payments.banking.taxNone')}</p>
        ) : (
          <div className="space-y-2 text-sm">
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5">
              <dt className="text-fiba-muted">{t('payments.banking.taxKind')}</dt>
              <dd className="text-ink-900 dark:text-white">{banking.tax_form_kind === 'exempt' ? t('payments.taxForm.exempt') : banking.tax_form_kind}</dd>
              {banking.tax_form_signed_at && (
                <>
                  <dt className="text-fiba-muted">{t('payments.banking.taxSignedAt')}</dt>
                  <dd className="text-ink-900 dark:text-white tabular-nums">{banking.tax_form_signed_at}</dd>
                </>
              )}
              {expiresAt && (
                <>
                  <dt className="text-fiba-muted">{t('payments.banking.taxExpiresAt')}</dt>
                  <dd className={`tabular-nums ${taxStatus === 'expired' ? 'text-danger-600 dark:text-danger-500 font-medium' : 'text-ink-900 dark:text-white'}`}>
                    {expiresAt}
                  </dd>
                </>
              )}
            </dl>
            {hasTaxFile && (
              <div className="flex items-center gap-2">
                {canEdit ? (
                  <button type="button" onClick={downloadTax}
                    className="flex-1 min-w-0 inline-flex items-center gap-1.5 text-left text-ink-900 dark:text-white hover:underline">
                    <Icon.Doc className="w-4 h-4 shrink-0 text-fiba-muted" />
                    <span className="truncate">{banking.tax_form_file_name || t('payments.banking.taxFile')}</span>
                  </button>
                ) : (
                  // Sin `payments:edit` el backend no entrega el PDF: se muestra el nombre, sin link.
                  <span className="flex-1 min-w-0 inline-flex items-center gap-1.5 text-ink-700 dark:text-ink-200">
                    <Icon.Doc className="w-4 h-4 shrink-0 text-fiba-muted" />
                    <span className="truncate">{banking.tax_form_file_name || t('payments.banking.taxFile')}</span>
                  </span>
                )}
                {canEdit && (
                  <button type="button" onClick={deleteTax} disabled={busy}
                    title={t('payments.banking.taxDelete')} aria-label={t('payments.banking.taxDelete')}
                    className="p-1 rounded hover:bg-fiba-surface text-fiba-muted hover:text-danger-600">
                    <Icon.Trash className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * Resumen bancario compacto para el drawer de un pago: estado del W-8, si hay
 * cuenta cargada y la cuenta enmascarada. "Ver ficha" despliega el panel
 * completo ahí mismo (no hay ruta propia para la ficha de una persona).
 */
export function BankingSummary({ personnelId, onChange }) {
  const { t } = useLanguage()
  const [banking, setBanking] = useState(undefined)
  const [open, setOpen] = useState(false)
  // onChange en un ref: el drawer pasa una arrow inline y, si fuera dep del
  // efecto, cada render volvería a pedir la ficha.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const publish = useCallback((b) => { setBanking(b); onChangeRef.current?.(b) }, [])

  useEffect(() => {
    let alive = true
    setBanking(undefined)
    setOpen(false)
    getPersonnelBanking(personnelId)
      .then(b => { if (alive) publish(b) })
      .catch(() => { if (alive) publish({ error: true }) })
    return () => { alive = false }
  }, [personnelId, publish])

  if (banking === undefined) return <p className="text-xs text-fiba-muted/60">{t('app.loading')}</p>
  if (banking?.error) return <p className="text-xs text-danger-600 dark:text-danger-500">{t('payments.banking.loadError')}</p>

  const hasBank = !!banking?.has_bank_info
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <TaxFormBadge status={banking?.tax_form_status || 'missing'} />
        {hasBank
          ? <span className="text-sm text-ink-700 dark:text-ink-200">
              {[banking.bank_name, banking.account_number || banking.iban].filter(Boolean).join(' · ') || t('payments.banking.loaded')}
            </span>
          : <Badge tone="warning" size="sm">{t('payments.noBank')}</Badge>}
        <Button size="xs" variant="link" className="ml-auto px-0" onClick={() => setOpen(o => !o)}>
          {open ? t('payments.banking.hideProfile') : t('payments.banking.viewProfile')}
        </Button>
      </div>
      {open && (
        <div className="mt-3 rounded-lg border border-fiba-border p-3">
          <BankingPanel personnelId={personnelId} initial={banking} onChange={publish} />
        </div>
      )}
    </div>
  )
}
