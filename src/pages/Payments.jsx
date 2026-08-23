/**
 * Payments — la bandeja única del gasto de un evento.
 *
 * Hasta la fase 9 esta pantalla era "la de los nominados": mostraba las personas
 * de una competencia y su pago. El gasto de operar el evento —shipping,
 * branding, seguros, proveedores— vivía en otra pantalla y detrás de otro
 * permiso, así que quien opera un evento necesitaba `budget` para ver la mitad
 * de lo que gasta. Ahora `/payments/event` devuelve las dos cosas juntas y esta
 * página las muestra en un solo lugar (BUDGET_MODULE.md §14.10).
 *
 * POR QUÉ PESTAÑAS Y NO DOS TABLAS APILADAS. Las personas y el gasto operativo
 * tienen columnas distintas (valor de nominación, rol y pasaje contra
 * proveedor, factura y fecha) y ninguna de las dos entra sin scroll horizontal
 * si se las pone una arriba de la otra. Las cards de totales y la bandeja de
 * aprobación quedan FUERA de las pestañas, porque son del evento entero: lo que
 * se reparte es el detalle, no la cifra.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  getCalendarCompetitions, getPaymentImputation, getPaymentEvent,
  getPendingApprovalPayments,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../contexts/AuthContext'
import { roleLabel, roleBadgeClass } from '../lib/roles'
import CompetitionSearch from '../components/CompetitionSearch'
import { Badge } from '../components/ui/Badge'
import PendingApproval from './payments/PendingApproval'
import { fmt, PAYMENT_STATUS_BADGES } from './payments/shared'

// Los dos editores son diálogos: no hacen falta hasta que alguien abre una fila.
const PaymentEditor = lazy(() => import('./payments/PaymentEditor'))
const EventExpenses = lazy(() => import('./payments/EventExpenses'))

const EMPTY_EVENT = { people: [], expenses: [], totals: {} }

export default function Payments() {
  const { t } = useLanguage()
  const { push } = useToast()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('payments')

  const [competitions, setCompetitions] = useState([])
  // Catálogos de imputación: qué departamento paga y qué línea consume cada
  // mitad del pago (el fee y, por separado, el vuelo). `can_edit` por
  // departamento y `editable_all` salen del recorte de la fase 9.
  const [departments, setDepartments] = useState([])
  const [accounts, setAccounts] = useState([])
  const [roleAccounts, setRoleAccounts] = useState({})
  const [editableAll, setEditableAll] = useState(false)
  // `null` = el catálogo no está disponible para este usuario (vive detrás de
  // otro permiso). No es lo mismo que una lista vacía.
  const [vendors, setVendors] = useState(null)
  const [employees, setEmployees] = useState(null)

  const [selectedCompId, setSelectedCompId] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [tab, setTab] = useState('people')
  const [event, setEvent] = useState(EMPTY_EVENT)
  const [pending, setPending] = useState(null)
  const [loading, setLoading] = useState(false)
  const [editorNominee, setEditorNominee] = useState(null)

  useEffect(() => {
    Promise.all([getCalendarCompetitions(), getPaymentImputation()]).then(([comps, imp]) => {
      setCompetitions(comps)
      setDepartments(imp.departments || [])
      setAccounts(imp.accounts || [])
      setRoleAccounts(imp.role_accounts || {})
      setEditableAll(!!imp.editable_all)
      // Proveedores y empleados vienen en el mismo catálogo: sus tablas están
      // detrás de `budget` y `employees`, y pedirlas aparte hacía que cargar un
      // gasto operativo exigiera tres permisos en vez de uno.
      setVendors(imp.vendors || [])
      setEmployees(imp.employees || [])
    }).catch(e => console.error(e))
  }, [])

  // Cambiar de evento rápido dispara dos cargas; sin este número de secuencia la
  // respuesta más lenta pisa a la más nueva y la bandeja termina mostrando el
  // evento anterior con el nombre del actual.
  const requestSeq = useRef(0)

  async function loadEvent(compId) {
    if (!compId) { setEvent(EMPTY_EVENT); setPending(null); return }
    const seq = ++requestSeq.current
    setLoading(true)
    try {
      const [data, approvals] = await Promise.all([
        getPaymentEvent(compId),
        // La bandeja de aprobación es accesoria: si falla, el gasto del evento
        // se muestra igual.
        getPendingApprovalPayments(compId).catch(() => null),
      ])
      if (seq !== requestSeq.current) return
      setEvent({ people: data.people || [], expenses: data.expenses || [], totals: data.totals || {} })
      setPending(approvals)
    } catch (e) {
      console.error(e)
      if (seq === requestSeq.current) push({ type: 'error', title: t('common.error') })
    }
    if (seq === requestSeq.current) setLoading(false)
  }

  useEffect(() => { loadEvent(selectedCompId) }, [selectedCompId])

  const selectedComp = competitions.find(c => c.id === selectedCompId)
  const totals = event.totals || {}

  const deptLabel = (code) => departments.find(d => d.code === code)?.label || code || '—'
  const accountLabel = (code) => {
    const a = accounts.find(x => x.code === code)
    return a ? `${a.code} · ${a.label}` : (code || '—')
  }

  // Con un departamento elegido, las tablas se recortan a ese departamento; las
  // cards siguen mostrando el evento entero, que es de lo que la bandeja habla.
  const visiblePeople = useMemo(
    () => deptFilter ? event.people.filter(n => n.payment?.department_code === deptFilter) : event.people,
    [event.people, deptFilter],
  )
  const peopleSubtotal = useMemo(() => visiblePeople.reduce((acc, n) => ({
    amount: acc.amount + Number(n.payment?.amount || 0),
    extra: acc.extra + Number(n.payment?.extra || 0),
    airfare: acc.airfare + Number(n.payment?.airfare || 0),
    total: acc.total + Number(n.payment?.total || 0),
  }), { amount: 0, extra: 0, airfare: 0, total: 0 }), [visiblePeople])

  function handlePaymentSaved(saved) {
    // `null` = el pago se borró; el editor se cierra solo.
    setEditorNominee(n => n ? { ...n, payment: saved } : n)
    loadEvent(selectedCompId)
  }

  function openPendingRow(row) {
    const nominee = event.people.find(n => n.nomination_id === row.nomination_id)
    if (nominee) setEditorNominee(nominee)
  }

  const stats = [
    { key: 'nominated', label: t('payments.nominated'), value: totals.nominated ?? event.people.length },
    { key: 'withPayment', label: t('payments.withPayment'), value: totals.with_payment ?? 0 },
    { key: 'fees', label: t('payments.personFees'), value: `$${fmt(totals.person_fees)}` },
    { key: 'airfare', label: t('payments.airfare'), value: `$${fmt(totals.airfare)}` },
    {
      key: 'expenses', label: t('payments.eventExpenses'), value: `$${fmt(totals.event_expenses)}`,
      note: `${t('budget.st_paid')}: $${fmt(totals.expenses_paid)}`,
    },
    { key: 'grand', label: t('payments.grandTotal'), value: `$${fmt(totals.grand_total)}`, accent: true },
  ]

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-ink-900 dark:text-white">{t('nav.payments')}</h1>
      </div>

      {/* Selector de evento — el mismo componente buscable que Games/Training */}
      <div className="flex flex-wrap gap-3 mb-6 items-start">
        <CompetitionSearch
          competitions={competitions}
          value={selectedCompId}
          onChange={setSelectedCompId}
          placeholder={t('payments.selectEvent')}
        />
        {selectedCompId && (
          <>
            <label htmlFor="payments-dept-filter" className="sr-only">{t('payments.department')}</label>
            <select id="payments-dept-filter" value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)} className="fiba-select">
              <option value="">{t('payments.allDepartments')}</option>
              {departments.map(d => <option key={d.code} value={d.code}>{d.label}</option>)}
            </select>
          </>
        )}
      </div>

      {!selectedCompId ? (
        <div className="text-center py-20 text-fiba-muted/60">{t('payments.pickEventHint')}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-2">
            {stats.map(s => (
              <div key={s.key} className="fiba-stat">
                <p className="text-xs text-fiba-muted">{s.label}</p>
                <p className={`text-2xl font-bold ${s.accent ? 'text-fiba-accent' : 'text-ink-900 dark:text-white'}`}>
                  {s.value}
                </p>
                {s.note && <p className="text-2xs text-fiba-muted mt-0.5">{s.note}</p>}
              </div>
            ))}
          </div>
          <p className="text-2xs text-fiba-muted mb-6">{t('payments.totalsAreWholeEvent')}</p>

          <PendingApproval
            pending={pending} departments={departments} canEdit={canEdit} t={t} push={push}
            onOpenPayment={openPendingRow}
            onChanged={() => loadEvent(selectedCompId)}
          />

          <div className="flex gap-1 mb-4 border-b border-fiba-border overflow-x-auto">
            {[
              { key: 'people', label: t('payments.tabPeople'), count: event.people.length },
              { key: 'expenses', label: t('payments.tabExpenses'), count: event.expenses.length },
            ].map(item => (
              // Botones de alternancia y no `role="tab"`: el patrón ARIA de
              // pestañas exige navegación con flechas y tabindex rotativo, y una
              // implementación a medias confunde más que no tenerla.
              <button key={item.key} onClick={() => setTab(item.key)}
                aria-pressed={tab === item.key}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
                  tab === item.key
                    ? 'border-orange-500 text-ink-900 dark:text-white'
                    : 'border-transparent text-fiba-muted hover:text-ink-900 dark:hover:text-white'
                }`}>
                {item.label} <span className="text-2xs text-fiba-muted">({item.count})</span>
              </button>
            ))}
          </div>

          {loading ? (
            <div className="py-16 text-center text-fiba-muted/60">{t('app.loading')}</div>
          ) : tab === 'people' ? (
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
                    {visiblePeople.map(n => {
                      const p = n.payment
                      // Un pago sin departamento es anterior a la 038 y no suma
                      // en ningún total por área — se marca en ámbar para que se
                      // clasifique en la próxima edición.
                      const unimputed = p && !p.department_code
                      return (
                        <tr key={n.nomination_id}>
                          <td className="px-4 py-3 font-medium">{n.nominee_name}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${roleBadgeClass(n.nominee_role)}`}>
                              {roleLabel(n.nominee_role)}
                            </span>
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
                            {p ? (
                              <>
                                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${PAYMENT_STATUS_BADGES[p.status] || ''}`}>
                                  {t(`payments.statusLabel.${p.status}`)}
                                </span>
                                {/* La aprobación es un eje aparte del status
                                    (fase 10) y sin ella el pago no puede
                                    pasar a Completado. */}
                                <span className={`block text-2xs mt-0.5 ${p.approved_at ? 'text-emerald-500' : 'text-warning-600 dark:text-warning-500'}`}>
                                  {p.approved_at ? t('payments.approved') : t('payments.notApproved')}
                                </span>
                              </>
                            ) : (
                              <span className="text-xs text-fiba-muted/60">{t('payments.noPayment')}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-fiba-muted">{p?.record_no || '—'}</td>
                          <td className="px-4 py-3 text-right">
                            <button onClick={() => setEditorNominee(n)}
                              className="text-fiba-accent hover:underline text-sm">
                              {p ? t('payments.manage') : (canEdit ? t('payments.addPayment') : t('profile.view'))}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                    {visiblePeople.length === 0 && (
                      <tr><td colSpan={10} className="px-4 py-8 text-center text-fiba-muted/60">
                        {deptFilter && event.people.length > 0
                          ? t('payments.noDepartmentPayments')
                          : t('payments.noNominees')}
                      </td></tr>
                    )}
                  </tbody>
                  {visiblePeople.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-fiba-border font-semibold">
                        <td className="px-4 py-3" colSpan={4}>
                          {deptFilter ? t('payments.filteredSubtotal') : t('payments.total')}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">${fmt(peopleSubtotal.amount)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">${fmt(peopleSubtotal.extra)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">${fmt(peopleSubtotal.airfare)}</td>
                        <td className="px-4 py-3" colSpan={3}>
                          <span className="text-fiba-accent">
                            {t('payments.personFees')}: ${fmt(peopleSubtotal.total)}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          ) : (
            <Suspense fallback={<div className="py-16 text-center text-fiba-muted/60">{t('app.loading')}</div>}>
              <EventExpenses
                expenses={event.expenses}
                competitionId={selectedCompId} competitionName={selectedComp?.name}
                departments={departments} accounts={accounts} editableAll={editableAll}
                vendors={vendors} employees={employees} canEdit={canEdit} deptFilter={deptFilter}
                t={t} push={push} onChanged={() => loadEvent(selectedCompId)}
              />
            </Suspense>
          )}
        </>
      )}

      {editorNominee && (
        <Suspense fallback={null}>
          <PaymentEditor
            // Abrir otro nominado sin cerrar el panel (pasa desde la bandeja de
            // aprobación) tiene que reiniciar el formulario, no heredar el del
            // anterior.
            key={editorNominee.nomination_id}
            nominee={editorNominee} competitionName={selectedComp?.name}
            departments={departments} accounts={accounts} roleAccounts={roleAccounts}
            editableAll={editableAll} canEdit={canEdit} deptFilter={deptFilter}
            t={t} push={push}
            onClose={() => setEditorNominee(null)}
            onSaved={handlePaymentSaved}
          />
        </Suspense>
      )}
    </div>
  )
}
