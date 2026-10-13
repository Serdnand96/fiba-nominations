/**
 * Pagos por evento: los nominados de una competencia y el pago de cada uno.
 *
 * `?open=<id>` abre el editor del nominado cuyo pago (o nominación) tiene ese
 * id, si está en el evento cargado.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  getCalendarCompetitions, getPaymentBudgets, getPaymentNominees, getPaymentsSummary,
} from '../../api/client'
import { useLanguage } from '../../i18n/LanguageContext'
import { useAuth } from '../../contexts/AuthContext'
import { useOpenParam } from '../../components/ui/Drawer'
import { roleLabel, roleBadgeClass } from '../../lib/roles'
import CompetitionSearch from '../../components/CompetitionSearch'
import PaymentDrawer from './PaymentDrawer'
import { STATUS_BADGES, fmt } from './shared'

// Un nominado se abre por el id de su pago o, si todavía no tiene, por el de
// su nominación.
const openKey = (n) => String(n.payment?.id ?? n.nomination_id)
const matchesOpen = (n, id) => String(n.payment?.id) === id || String(n.nomination_id) === id

export default function EventTab() {
  const { t } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('payments')

  const [competitions, setCompetitions] = useState([])
  const [budgets, setBudgets] = useState([])
  const [selectedCompId, setSelectedCompId] = useState('')
  const [budgetFilter, setBudgetFilter] = useState('')
  const [nominees, setNominees] = useState([])
  const [summary, setSummary] = useState({ count: 0, amount: 0, extra: 0, total: 0 })
  const [loading, setLoading] = useState(false)
  const [loadedCompId, setLoadedCompId] = useState('')   // evento cuyos nominados están en `nominees`

  // Payment editor
  const [editorNominee, setEditorNominee] = useState(null)   // the nominee row being edited
  const [openId, setOpenId] = useOpenParam()

  useEffect(() => {
    Promise.all([getCalendarCompetitions(), getPaymentBudgets()]).then(([comps, buds]) => {
      setCompetitions(comps)
      setBudgets(buds)
    }).catch(e => console.error(e))
  }, [])

  async function loadEvent(compId) {
    if (!compId) { setNominees([]); setSummary({ count: 0, amount: 0, extra: 0, total: 0 }); setLoadedCompId(''); return }
    setLoading(true)
    try {
      const [noms, sum] = await Promise.all([getPaymentNominees(compId), getPaymentsSummary(compId, budgetFilter)])
      setNominees(noms)
      setSummary(sum)
      setLoadedCompId(compId)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { loadEvent(selectedCompId) }, [selectedCompId, budgetFilter])

  // `?open=` se resuelve contra el evento ya cargado; si el id no está ahí, se
  // descarta. Sin evento elegido se espera: no hay lista contra la cual mirar.
  useEffect(() => {
    if (!openId || loading || !selectedCompId || loadedCompId !== selectedCompId) return
    if (editorNominee && matchesOpen(editorNominee, openId)) return
    const n = nominees.find(x => matchesOpen(x, openId))
    if (n) setEditorNominee(n)
    else setOpenId(null)
  }, [openId, nominees, loading, selectedCompId, loadedCompId])

  const selectedComp = competitions.find(c => c.id === selectedCompId)

  function openEditor(nominee) {
    setEditorNominee(nominee)
    setOpenId(openKey(nominee))
  }

  function closeEditor() {
    setEditorNominee(null)
    setOpenId(null)
  }

  // With a budget filter on, the table and money cards narrow to that budget;
  // the Nominated / With payment cards keep counting the whole event.
  const visibleNominees = useMemo(
    () => budgetFilter ? nominees.filter(n => n.payment?.budget_code === budgetFilter) : nominees,
    [nominees, budgetFilter]
  )
  const paidCount = useMemo(() => nominees.filter(n => n.payment).length, [nominees])

  return (
    <div>
      {/* Event selector — same searchable + pinnable component as Games/Training/Transport */}
      <div className="flex flex-wrap gap-3 mb-6 items-start">
        <CompetitionSearch
          competitions={competitions}
          value={selectedCompId}
          onChange={setSelectedCompId}
          placeholder={t('payments.selectEvent')}
        />
        {selectedCompId && (
          <select value={budgetFilter} onChange={e => setBudgetFilter(e.target.value)} className="fiba-select">
            <option value="">{t('payments.allBudgets')}</option>
            {budgets.map(b => <option key={b.code} value={b.code}>{b.label}</option>)}
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
                    <th>{t('payments.budget')}</th>
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
                        <td className="px-4 py-3 text-right tabular-nums">{p ? fmt(p.airfare) : '—'}</td>
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
                  {!loading && visibleNominees.length === 0 && (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-fiba-muted/60">
                      {budgetFilter && nominees.length > 0 ? t('payments.noBudgetPayments') : t('payments.noNominees')}
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
        <PaymentDrawer
          key={editorNominee.nomination_id}
          nominee={editorNominee}
          competitionName={selectedComp?.name}
          budgets={budgets}
          canEdit={canEdit}
          onClose={closeEditor}
          onSaved={async (saved) => {
            await loadEvent(selectedCompId)
            // keep editor open on the same nominee, now with the saved payment
            setEditorNominee(n => n ? { ...n, payment: saved } : n)
            setOpenId(saved.id)
          }}
          onDeleted={async () => {
            closeEditor()
            await loadEvent(selectedCompId)
          }}
        />
      )}
    </div>
  )
}
