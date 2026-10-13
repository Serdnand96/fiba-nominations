/**
 * Cola de pagos: todos los pagos de todos los eventos, filtrables, con
 * selección múltiple y acciones en lote. Es la pestaña por defecto de Pagos.
 *
 * Los filtros viven en la URL (`?status=&year=&budget=&missing_docs=1&stale=1
 * &q=&page=`), igual que el pago abierto (`?open=<id>`): es lo que permite que
 * un link de la campana ("Pagos sin documentación") caiga en la vista filtrada.
 *
 * El backend arma cada fila ya aplanada, con los avisos calculados
 * (`tax_form_status`, `has_bank_info`, `stale_amount`, `cm_approved`,
 * `confirmation_status`): acá solo se pintan.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  getPaymentsQueue, getPaymentBudgets, getPayment, syncPaymentAmounts, downloadPaymentsXlsx,
} from '../../api/client'
import { useLanguage } from '../../i18n/LanguageContext'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/ui/Toast'
import { useOpenParam } from '../../components/ui/Drawer'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Empty } from '../../components/ui/Empty'
import { Tooltip } from '../../components/ui/Tooltip'
import { Icon } from '../../lib/icons'
import { roleLabel, roleBadgeClass } from '../../lib/roles'
import { TaxFormBadge } from '../../components/BankingPanel'
import PaymentDrawer from './PaymentDrawer'
import BulkStatusModal from './BulkStatusModal'
import { STATUSES, STATUS_TONE, PAGE_SIZE, fmt, errorDetail } from './shared'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: CURRENT_YEAR + 2 - 2024 }, (_, i) => CURRENT_YEAR + 1 - i)

// Filtros ↔ URL. Un filtro vacío se saca de la URL; cambiar cualquier filtro
// vuelve a la página 1 y cierra el pago abierto.
function useQueueFilters() {
  const [sp, setSp] = useSearchParams()
  const filters = {
    status: STATUSES.includes(sp.get('status')) ? sp.get('status') : '',
    year: sp.get('year') || '',
    budget: sp.get('budget') || '',
    missing_docs: sp.get('missing_docs') === '1',
    stale: sp.get('stale') === '1',
    q: sp.get('q') || '',
    page: Math.max(1, parseInt(sp.get('page') || '1', 10) || 1),
  }
  const setFilters = useCallback((patch) => {
    setSp(prev => {
      const next = new URLSearchParams(prev)
      for (const [k, v] of Object.entries(patch)) {
        if (v === '' || v == null || v === false || (k === 'page' && v === 1)) next.delete(k)
        else next.set(k, v === true ? '1' : String(v))
      }
      if (!('page' in patch)) next.delete('page')
      next.delete('open')
      return next
    }, { replace: true })
  }, [setSp])
  return [filters, setFilters]
}

function queueParams(f) {
  const p = {}
  if (f.status) p.status = f.status
  if (f.year) p.year = f.year
  if (f.budget) p.budget = f.budget
  if (f.missing_docs) p.missing_docs = 1
  if (f.stale) p.stale = 1
  if (f.q) p.search = f.q
  return p
}

// La fila de la cola tiene todo lo que el drawer necesita saber de la persona.
function toNominee(item) {
  return {
    nomination_id: item.nomination_id,
    nominee_name: item.nominee_name,
    nominee_role: item.nominee_role,
    nomination_total: item.nomination_total,
    personnel_id: item.personnel_id,
    cm_approved: item.cm_approved,
    confirmation_status: item.confirmation_status,
    tax_form_status: item.tax_form_status,
    payment: item,
  }
}

function RowAlerts({ item }) {
  const { t } = useLanguage()
  return (
    <div className="flex flex-wrap gap-1">
      <TaxFormBadge status={item.tax_form_status} />
      {item.has_bank_info === false && <Badge tone="warning" size="sm">{t('payments.noBank')}</Badge>}
      {item.stale_amount && (
        <Tooltip label={t('payments.staleTooltip', { amount: fmt(item.nomination_total) })}>
          <span className="inline-flex"><Badge tone="warning" size="sm">{t('payments.staleBadge')}</Badge></span>
        </Tooltip>
      )}
      {item.cm_approved === false && <Badge tone="warning" size="sm">{t('payments.cmPending')}</Badge>}
      {item.confirmation_status === 'declined' && <Badge tone="danger" size="sm">{t('payments.declined')}</Badge>}
    </div>
  )
}

export default function QueueTab() {
  const { t, lang } = useLanguage()
  const { push } = useToast()
  const { hasEdit } = useAuth()
  // Toda transición (también completar) pasa por require_edit('payments');
  // payments_approve se suma encima, no lo reemplaza.
  const canEdit = hasEdit('payments')

  const [filters, setFilters] = useQueueFilters()
  const [openId, setOpenId] = useOpenParam()

  const [budgets, setBudgets] = useState([])
  const [data, setData] = useState({ items: [], total: 0, totals: {} })
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(() => new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [drawerItem, setDrawerItem] = useState(null)

  // Búsqueda con debounce. `lastQ` distingue lo que escribimos nosotros en la
  // URL de un cambio que llegó de afuera (un link), para no pisar lo que el
  // usuario está tipeando.
  const [search, setSearch] = useState(filters.q)
  const lastQ = useRef(filters.q)
  useEffect(() => {
    if (filters.q !== lastQ.current) { lastQ.current = filters.q; setSearch(filters.q) }
  }, [filters.q])
  useEffect(() => {
    const q = search.trim()
    if (q === filters.q) return
    const id = setTimeout(() => { lastQ.current = q; setFilters({ q }) }, 350)
    return () => clearTimeout(id)
  }, [search, filters.q, setFilters])

  useEffect(() => {
    getPaymentBudgets().then(setBudgets).catch(e => console.error(e))
  }, [])

  const params = useMemo(() => queueParams(filters),
    [filters.status, filters.year, filters.budget, filters.missing_docs, filters.stale, filters.q])
  const queryKey = JSON.stringify(params)
  const offset = (filters.page - 1) * PAGE_SIZE

  // Solo la última respuesta gana: si el usuario cambia de filtro rápido, una
  // respuesta vieja no puede pisar la nueva.
  const reqId = useRef(0)
  const load = useCallback(async () => {
    const id = ++reqId.current
    setLoading(true)
    try {
      const res = await getPaymentsQueue({ ...params, limit: PAGE_SIZE, offset })
      if (id !== reqId.current) return
      setData({ items: res?.items || [], total: res?.total ?? 0, totals: res?.totals || {} })
    } catch (err) {
      if (id !== reqId.current) return
      console.error(err)
      setData({ items: [], total: 0, totals: {} })
      push({ type: 'error', title: errorDetail(err, t('payments.queueLoadError')) })
    }
    if (id === reqId.current) setLoading(false)
  }, [queryKey, offset])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  // La selección pertenece a la consulta: cambiar filtros o página la limpia.
  useEffect(() => { setSelected(new Set()) }, [queryKey, offset])

  // `?open=<id>` → drawer. Si el pago no está en la página cargada (link de una
  // notificación, o salió del filtro después de una transición) se pide solo
  // ese (`GET /payments/{id}`); si no existe, se descarta el parámetro.
  useEffect(() => {
    if (!openId) { setDrawerItem(null); return }
    if (loading) return
    const found = data.items.find(i => String(i.id) === openId)
    if (found) { setDrawerItem(found); return }
    if (drawerItem && String(drawerItem.id) === openId) return
    let alive = true
    getPayment(openId)
      .then(p => {
        if (!alive) return
        if (p) setDrawerItem(p)
        else setOpenId(null)
      })
      .catch(() => { if (alive) setOpenId(null) })
    return () => { alive = false }
  }, [openId, data.items, loading])   // eslint-disable-line react-hooks/exhaustive-deps

  const drawerNominee = useMemo(() => (drawerItem ? toNominee(drawerItem) : null), [drawerItem])

  const items = data.items
  const pageIds = useMemo(() => items.map(i => i.id), [items])
  const allOnPage = pageIds.length > 0 && pageIds.every(id => selected.has(id))
  const someOnPage = pageIds.some(id => selected.has(id))
  const selectedIds = useMemo(() => [...selected], [selected])

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected(allOnPage ? new Set() : new Set(pageIds))
  }

  async function handleSync() {
    setWorking(true)
    try {
      const res = await syncPaymentAmounts(selectedIds)
      push({ type: 'success', title: t('payments.syncDone', { count: (res?.updated || []).length }) })
      const skipped = (res?.skipped || []).length
      if (skipped) push({ type: 'info', title: t('payments.syncSkipped', { count: skipped }) })
      await load()
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, t('payments.syncError')) })
    }
    setWorking(false)
  }

  async function handleExport() {
    setWorking(true)
    try {
      await downloadPaymentsXlsx({ ...params, lang })
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, t('payments.exportError')) })
    }
    setWorking(false)
  }

  const budgetLabel = (code) => budgets.find(b => b.code === code)?.label || code || '—'
  const hasFilters = !!(params.status || params.year || params.budget || params.missing_docs || params.stale || params.search)
  const from = data.total === 0 ? 0 : offset + 1
  const to = Math.min(offset + items.length, data.total)
  const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  const totals = data.totals || {}

  return (
    <div>
      {/* ── Filtros ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <div className="relative w-full sm:w-64">
          <Icon.Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-fiba-muted pointer-events-none" />
          <input type="search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('payments.searchPlaceholder')} aria-label={t('payments.searchPlaceholder')}
            className="fiba-input w-full !pl-9" />
        </div>
        <select value={filters.status} onChange={e => setFilters({ status: e.target.value })}
          aria-label={t('payments.status')} className="fiba-select">
          <option value="">{t('payments.allStatuses')}</option>
          {STATUSES.map(s => <option key={s} value={s}>{t(`payments.statusLabel.${s}`)}</option>)}
        </select>
        <select value={filters.year} onChange={e => setFilters({ year: e.target.value })}
          aria-label={t('payments.year')} className="fiba-select">
          <option value="">{t('payments.allYears')}</option>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={filters.budget} onChange={e => setFilters({ budget: e.target.value })}
          aria-label={t('payments.budget')} className="fiba-select">
          <option value="">{t('payments.allBudgets')}</option>
          {budgets.map(b => <option key={b.code} value={b.code}>{b.label}</option>)}
        </select>
        <label className="inline-flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200 px-1 cursor-pointer">
          <input type="checkbox" checked={filters.missing_docs} onChange={e => setFilters({ missing_docs: e.target.checked })}
            className="rounded border-ink-300 dark:border-navy-600" />
          {t('payments.filterMissingDocs')}
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-ink-700 dark:text-ink-200 px-1 cursor-pointer">
          <input type="checkbox" checked={filters.stale} onChange={e => setFilters({ stale: e.target.checked })}
            className="rounded border-ink-300 dark:border-navy-600" />
          {t('payments.filterStale')}
        </label>
        <div className="sm:ml-auto">
          <Button size="sm" variant="secondary" icon={<Icon.Download />} onClick={handleExport} disabled={working}>
            {t('payments.exportXlsx')}
          </Button>
        </div>
      </div>

      {/* ── Barra de acciones de la selección ─────────────────────────── */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 rounded-lg border border-navy-200 bg-navy-50 dark:border-navy-700 dark:bg-navy-800/60 px-3 py-2">
          <span className="text-sm font-medium text-navy-900 dark:text-white">{t('payments.selectedCount', { count: selected.size })}</span>
          <Button size="xs" variant="link" onClick={() => setSelected(new Set())}>{t('payments.clearSelection')}</Button>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            {canEdit && (
              <>
                <Button size="sm" variant="navy" onClick={() => setBulkOpen(true)} disabled={working}>{t('payments.changeStatus')}</Button>
                <Button size="sm" variant="secondary" onClick={handleSync} disabled={working}>{t('payments.syncAmount')}</Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Tabla ─────────────────────────────────────────────────────── */}
      {!loading && items.length === 0 ? (
        <div className="rounded-xl border border-fiba-border">
          <Empty
            icon={<Icon.Wallet />}
            title={t('payments.queueEmptyTitle')}
            body={hasFilters ? t('payments.queueEmptyFiltered') : t('payments.queueEmptyBody')}
            action={hasFilters ? (
              <Button size="sm" variant="secondary" onClick={() => { lastQ.current = ''; setSearch(''); setFilters({ status: '', year: '', budget: '', missing_docs: false, stale: false, q: '' }) }}>
                {t('payments.clearFilters')}
              </Button>
            ) : null}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-fiba-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="fiba-table min-w-[1100px]">
              <thead>
                <tr>
                  <th className="w-10 !pr-0">
                    <input type="checkbox" checked={allOnPage} aria-label={t('payments.selectPage')}
                      ref={el => { if (el) el.indeterminate = someOnPage && !allOnPage }}
                      onChange={toggleAll} className="rounded border-ink-300 dark:border-navy-600" />
                  </th>
                  <th>{t('payments.record')}</th>
                  <th>{t('payments.nominee')}</th>
                  <th>{t('payments.competition')}</th>
                  <th>{t('payments.budget')}</th>
                  <th className="text-right">{t('payments.total')}</th>
                  <th className="text-right">{t('payments.airfare')}</th>
                  <th className="text-right">{t('payments.paid')}</th>
                  <th>{t('payments.status')}</th>
                  <th>{t('payments.alerts')}</th>
                  <th>{t('payments.paymentDate')}</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={11} className="px-4 py-8 text-center text-fiba-muted/60">{t('app.loading')}</td></tr>
                )}
                {!loading && items.map(item => {
                  const isSel = selected.has(item.id)
                  const partial = item.is_partial ?? (item.status === 'in_process' && Number(item.paid_amount || 0) > 0)
                  return (
                    <tr key={item.id} onClick={() => setOpenId(item.id)}
                      className={`cursor-pointer ${isSel ? '!bg-navy-50 dark:!bg-navy-800/60' : ''}`}>
                      <td className="!pr-0" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isSel} onChange={() => toggle(item.id)}
                          aria-label={t('payments.selectRow', { name: item.nominee_name || item.record_no || '' })}
                          className="rounded border-ink-300 dark:border-navy-600" />
                      </td>
                      <td className="font-mono text-xs whitespace-nowrap">{item.record_no || '—'}</td>
                      <td>
                        <button type="button" onClick={e => { e.stopPropagation(); setOpenId(item.id) }}
                          className="font-medium text-ink-900 dark:text-white hover:underline text-left">
                          {item.nominee_name || '—'}
                        </button>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {item.nominee_role && (
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${roleBadgeClass(item.nominee_role)}`}>{roleLabel(item.nominee_role)}</span>
                          )}
                          {item.nominee_country && <span className="text-xs text-fiba-muted">{item.nominee_country}</span>}
                        </div>
                      </td>
                      <td>
                        <span className="text-ink-900 dark:text-white">{item.competition_name || '—'}</span>
                        {item.competition_year && <span className="text-xs text-fiba-muted ml-1">({item.competition_year})</span>}
                      </td>
                      <td className="whitespace-nowrap">{budgetLabel(item.budget_code)}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">{fmt(item.total)}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">{fmt(item.airfare)}</td>
                      <td className="text-right tabular-nums whitespace-nowrap">{item.paid_amount != null ? fmt(item.paid_amount) : '—'}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <Badge tone={STATUS_TONE[item.status] || 'ink'} size="sm">{t(`payments.statusLabel.${item.status}`)}</Badge>
                          {partial && <Badge tone="info" size="sm">{t('payments.partial')}</Badge>}
                        </div>
                      </td>
                      <td><RowAlerts item={item} /></td>
                      <td className="tabular-nums whitespace-nowrap text-xs">{item.payment_date || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
              {!loading && items.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-fiba-border font-semibold text-ink-900 dark:text-white">
                    <td className="px-4 py-3" colSpan={5}>{t('payments.totalsFiltered', { count: data.total })}</td>
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">${fmt(totals.total ?? totals.amount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">${fmt(totals.airfare)}</td>
                    <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">${fmt(totals.paid_amount)}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ── Paginación ───────────────────────────────────────────────── */}
      {data.total > PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3 text-sm text-fiba-muted">
          <span>{t('payments.pageInfo', { from, to, total: data.total })}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={loading || filters.page <= 1}
              onClick={() => setFilters({ page: filters.page - 1 })}>{t('payments.prevPage')}</Button>
            <Button size="sm" variant="secondary" disabled={loading || filters.page >= lastPage}
              onClick={() => setFilters({ page: filters.page + 1 })}>{t('payments.nextPage')}</Button>
          </div>
        </div>
      )}

      {bulkOpen && (
        <BulkStatusModal
          ids={selectedIds}
          onClose={() => setBulkOpen(false)}
          onDone={async (res) => {
            await load()
            // Quedan seleccionados solo los que fallaron, para reintentar.
            setSelected(new Set((res?.failed || []).map(f => f.id)))
          }}
        />
      )}

      {drawerNominee && (
        <PaymentDrawer
          key={drawerItem.id}
          nominee={drawerNominee}
          competitionName={drawerItem.competition_name}
          budgets={budgets}
          canEdit={canEdit}
          onClose={() => setOpenId(null)}
          onSaved={() => load()}
          onDeleted={async () => { setOpenId(null); await load() }}
        />
      )}
    </div>
  )
}
