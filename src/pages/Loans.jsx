import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getLoans, returnLoan, deleteLoan } from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'

export default function Loans() {
  const { t } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('loans')

  const [loans, setLoans] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('active')
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      setLoans(await getLoans())
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    return loans.filter(l => {
      if (statusFilter && l.status !== statusFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return (l.assigned_to || '').toLowerCase().includes(q)
          || (l.asset_name || '').toLowerCase().includes(q)
          || (l.asset_serial_number || '').toLowerCase().includes(q)
      }
      return true
    })
  }, [loans, statusFilter, search])

  const stats = useMemo(() => ({
    total: loans.length,
    active: loans.filter(l => l.status === 'active').length,
    overdue: loans.filter(l => l.status === 'active' && l.expected_return && new Date(l.expected_return) < new Date()).length,
  }), [loans])

  async function handleReturn(loan) {
    if (!confirm(t('loans.confirmReturn'))) return
    try {
      await returnLoan(loan.id)
      await load()
    } catch (err) {
      alert(err.response?.data?.detail || err.message)
    }
  }

  async function handleDelete(loan) {
    if (!confirm(t('loans.confirmDelete'))) return
    try {
      await deleteLoan(loan.id)
      await load()
    } catch (err) {
      alert(err.response?.data?.detail || err.message)
    }
  }

  if (loading) return <div className="text-fiba-muted text-sm">{t('common.loading')}</div>

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">{t('loans.title')}</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="fiba-stat"><p className="text-xs text-fiba-muted">{t('loans.total')}</p><p className="text-2xl font-bold text-white">{stats.total}</p></div>
        <div className="fiba-stat"><p className="text-xs text-fiba-muted">{t('loans.active')}</p><p className="text-2xl font-bold text-blue-400">{stats.active}</p></div>
        <div className="fiba-stat"><p className="text-xs text-fiba-muted">{t('loans.overdue')}</p><p className="text-2xl font-bold text-red-400">{stats.overdue}</p></div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input type="text" placeholder={t('loans.searchPlaceholder')} value={search}
          onChange={e => setSearch(e.target.value)} className="fiba-input w-full md:w-80" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="fiba-select !w-auto min-w-[160px] flex-shrink-0">
          <option value="">{t('loans.allStatuses')}</option>
          <option value="active">{t('loans.active')}</option>
          <option value="returned">{t('loans.returned')}</option>
        </select>
      </div>

      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
        <table className="fiba-table">
          <thead>
            <tr>
              <th>{t('loans.asset')}</th>
              <th>{t('loans.assignedTo')}</th>
              <th>{t('loans.loanDate')}</th>
              <th>{t('loans.expectedReturn')}</th>
              <th>{t('loans.actualReturn')}</th>
              <th>{t('common.status')}</th>
              <th>{t('common.action')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(l => {
              const overdue = l.status === 'active' && l.expected_return && new Date(l.expected_return) < new Date()
              return (
                <tr key={l.id} className={overdue ? 'bg-red-500/5' : ''}>
                  <td className="px-4 py-3">
                    <Link to={`/inventory/${l.asset_id}`} className="text-fiba-accent hover:underline">{l.asset_name}</Link>
                    <div className="text-[11px] text-fiba-muted font-mono">{l.asset_serial_number || '—'}</div>
                  </td>
                  <td className="px-4 py-3">{l.assigned_to}</td>
                  <td className="px-4 py-3 text-sm">{fmtDate(l.loan_date)}</td>
                  <td className={`px-4 py-3 text-sm ${overdue ? 'text-red-400 font-medium' : ''}`}>
                    {l.expected_return || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm">{fmtDate(l.actual_return) || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${l.status === 'active' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                      {t(`loans.${l.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {canEdit && l.status === 'active' && (
                      <button onClick={() => handleReturn(l)} className="text-fiba-accent hover:underline mr-3">{t('loans.markReturned')}</button>
                    )}
                    {canEdit && (
                      <button onClick={() => handleDelete(l)} className="text-red-400 hover:underline">{t('common.delete')}</button>
                    )}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-fiba-muted">{t('loans.noLoans')}</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}

function fmtDate(d) {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString() } catch { return d }
}
