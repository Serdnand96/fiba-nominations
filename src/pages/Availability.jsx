import { useState, useEffect, useMemo } from 'react'
import { getCalendarCompetitions, getPersonnel, getCompetitionAvailability,
  createAvailability, updateAvailability } from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'
import { Card } from '../components/ui/Card'
import { Avatar } from '../components/ui/Avatar'
import { Button } from '../components/ui/Button'

// Raw availability cell treatment — colored blocks, no dots.
const STATUS_STYLES = {
  available:   { cell: 'bg-success-100 dark:bg-success-500/20 hover:bg-success-200/70 dark:hover:bg-success-500/30', dot: 'bg-success-500' },
  unavailable: { cell: 'bg-danger-100 dark:bg-danger-500/20 hover:bg-danger-200/70 dark:hover:bg-danger-500/30',     dot: 'bg-danger-500' },
  restricted:  { cell: 'bg-warning-100 dark:bg-warning-500/20 hover:bg-warning-200/70 dark:hover:bg-warning-500/30', dot: 'bg-warning-500' },
  no_data:     { cell: 'bg-ink-50 dark:bg-navy-950/40 hover:bg-ink-100 dark:hover:bg-navy-900/60',                   dot: 'bg-ink-300 dark:bg-navy-700' },
}

// Nomination workflow overlay — takes precedence over raw availability.
// Maps to design's "assigned" treatment (navy block) for confirmed, basketball for active nominations.
const NOMINATION_STYLES = {
  nominated: { cell: 'bg-basketball-100 dark:bg-basketball-500/25 hover:bg-basketball-200 dark:hover:bg-basketball-500/35', dot: 'bg-basketball-500' },
  confirmed: { cell: 'bg-navy-200 dark:bg-navy-700 hover:bg-navy-300 dark:hover:bg-navy-600',                              dot: 'bg-navy-700 dark:bg-navy-300' },
  declined:  { cell: 'bg-danger-100 dark:bg-danger-500/30 hover:bg-danger-200 dark:hover:bg-danger-500/40 ring-1 ring-danger-500/40', dot: 'bg-danger-600' },
  pending:   { cell: 'bg-basketball-50 dark:bg-basketball-500/10 hover:bg-basketball-100 dark:hover:bg-basketball-500/20 ring-1 ring-basketball-500/40', dot: 'bg-basketball-300' },
}

const COMP_TYPES = ['BCLA', 'WCQ', 'LSB', 'LSBF', 'WBLA', 'AmeriCup', 'U-Series', '3x3']

const isWeekend = (d) => [0, 6].includes(d.getDay())

export default function Availability() {
  const { t, lang } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('availability')
  const [competitions, setCompetitions] = useState([])
  const [tds, setTds] = useState([])
  const [availData, setAvailData] = useState({}) // comp_id -> [{ personnel_id, status, notes, availability_id, nomination_id?, confirmation_status? }]
  const [loading, setLoading] = useState(true)

  const [typeFilter, setTypeFilter] = useState([])
  const [statusFilter, setStatusFilter] = useState('')

  const [modal, setModal] = useState(null)
  const [modalForm, setModalForm] = useState({ status: 'available', notes: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [comps, pers] = await Promise.all([
        getCalendarCompetitions({}),
        getPersonnel({ role: 'TD' }),
      ])
      const now = new Date()
      const cutoff = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
      const upcoming = comps.filter(c => {
        if (c.start_date) return new Date(c.start_date + 'T00:00:00') <= cutoff
        return true
      }).sort((a, b) => (a.start_date || '9999').localeCompare(b.start_date || '9999'))
      setCompetitions(upcoming)
      setTds(pers.filter(p => p.role === 'TD'))
      const avails = await Promise.all(
        upcoming.map(c => getCompetitionAvailability(c.id).catch(() => []))
      )
      const map = {}
      upcoming.forEach((c, i) => { map[c.id] = avails[i] })
      setAvailData(map)
    } catch (err) { console.error('Load error:', err) }
    setLoading(false)
  }

  const filteredComps = useMemo(() => {
    return competitions.filter(c => {
      if (typeFilter.length > 0 && !typeFilter.includes(c.competition_type)) return false
      return true
    })
  }, [competitions, typeFilter])

  function getStatus(tdId, compId) {
    const compAvail = availData[compId] || []
    const entry = compAvail.find(a => a.personnel_id === tdId)
    return entry || { status: 'no_data', notes: '', availability_id: null }
  }

  const filteredTds = useMemo(() => {
    if (!statusFilter) return tds
    return tds.filter(td => filteredComps.some(c => getStatus(td.id, c.id).status === statusFilter))
  }, [tds, statusFilter, filteredComps, availData])

  // Aggregate slot counts across visible cells for the stat cards.
  const totals = useMemo(() => {
    const t = { available: 0, nominated: 0, restricted: 0, unavailable: 0 }
    filteredTds.forEach(td => {
      filteredComps.forEach(comp => {
        const e = getStatus(td.id, comp.id)
        if (e.nomination_id) {
          const cs = e.confirmation_status || 'pending'
          if (cs === 'nominated' || cs === 'pending' || cs === 'confirmed') t.nominated += 1
          else if (cs === 'declined') t.unavailable += 1
        } else if (e.status === 'available')   t.available += 1
        else if (e.status === 'restricted')    t.restricted += 1
        else if (e.status === 'unavailable')   t.unavailable += 1
      })
    })
    return t
  }, [filteredTds, filteredComps, availData])

  function getAvailableCount(compId) {
    return (availData[compId] || []).filter(a => a.status === 'available').length
  }

  function openModal(td, comp) {
    const existing = getStatus(td.id, comp.id)
    setModal({ td, competition: comp, existing: existing.availability_id ? existing : null })
    setModalForm({
      status: existing.status !== 'no_data' ? existing.status : 'available',
      notes: existing.notes || '',
    })
  }

  async function handleModalSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      if (modal.existing?.availability_id) {
        await updateAvailability(modal.existing.availability_id, modalForm)
      } else {
        await createAvailability({
          personnel_id: modal.td.id,
          type: 'event_specific',
          competition_id: modal.competition.id,
          status: modalForm.status,
          notes: modalForm.notes || null,
        })
      }
      const updated = await getCompetitionAvailability(modal.competition.id).catch(() => [])
      setAvailData(prev => ({ ...prev, [modal.competition.id]: updated }))
      setModal(null)
    } catch (err) {
      alert(err.response?.data?.detail || t('availability.errorSaving'))
    }
    setSaving(false)
  }

  function toggleTypeFilter(type) {
    setTypeFilter(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])
  }

  function formatCompDate(comp) {
    if (!comp.start_date) return 'TBD'
    const d = new Date(comp.start_date + 'T00:00:00')
    const locale = lang === 'es' ? 'es' : 'en-US'
    return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  }

  function compIsWeekend(comp) {
    if (!comp.start_date) return false
    return isWeekend(new Date(comp.start_date + 'T00:00:00'))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-ink-500 dark:text-ink-400 text-sm">{t('common.loading')}</span>
      </div>
    )
  }

  const statCards = [
    { key: 'available',   label: t('availability.available'),    count: totals.available,   bar: 'bg-success-500' },
    { key: 'nominated',   label: t('availability.nominated'),    count: totals.nominated,   bar: 'bg-basketball-500' },
    { key: 'restricted',  label: t('availability.restricted'),   count: totals.restricted,  bar: 'bg-warning-500' },
    { key: 'unavailable', label: t('availability.unavailable'),  count: totals.unavailable, bar: 'bg-danger-500' },
  ]

  const legendItems = [
    { dot: STATUS_STYLES.available.dot,        label: t('availability.available') },
    { dot: STATUS_STYLES.restricted.dot,       label: t('availability.restricted') },
    { dot: STATUS_STYLES.unavailable.dot,      label: t('availability.unavailable') },
    { dot: NOMINATION_STYLES.nominated.dot,    label: t('availability.nominated') },
    { dot: NOMINATION_STYLES.confirmed.dot,    label: t('availability.confirmed') },
    { dot: NOMINATION_STYLES.declined.dot,     label: t('availability.declined') },
    { dot: NOMINATION_STYLES.pending.dot,      label: t('availability.pendingNomination') },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-semibold text-navy-900 dark:text-white tracking-tight">{t('availability.title')}</h1>
          <p className="text-sm text-ink-500 dark:text-ink-400 mt-0.5">
            <span className="num font-medium text-ink-700 dark:text-ink-200">{filteredTds.length}</span> TDs · <span className="num font-medium text-ink-700 dark:text-ink-200">{filteredComps.length}</span> {filteredComps.length === 1 ? 'competencia' : 'competencias'}
          </p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map(s => (
          <Card key={s.key} padding="p-4">
            <div className="flex items-center gap-3">
              <div className={`w-1.5 h-10 rounded-full ${s.bar}`} />
              <div>
                <div className="text-[12px] text-ink-500 dark:text-ink-400">{s.label}</div>
                <div className="num text-[22px] font-semibold text-navy-900 dark:text-white leading-tight">
                  {s.count} <span className="text-xs font-normal text-ink-400 dark:text-ink-500">slots</span>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {COMP_TYPES.map(type => {
            const active = typeFilter.includes(type)
            return (
              <button key={type} onClick={() => toggleTypeFilter(type)}
                className={`px-2.5 h-7 rounded-md text-xs font-medium border transition-colors ${
                  active
                    ? 'bg-navy-900 text-white border-navy-900 dark:bg-navy-700 dark:border-navy-700'
                    : 'bg-white dark:bg-navy-900 text-ink-600 dark:text-ink-300 border-ink-200 dark:border-navy-700 hover:bg-ink-50 dark:hover:bg-navy-800'
                }`}>
                {type}
              </button>
            )
          })}
        </div>
        <div className="h-6 w-px bg-ink-200 dark:bg-navy-700 mx-1"/>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="h-8 text-xs leading-none pl-2.5 pr-7 rounded-md border border-ink-200 dark:border-navy-700 bg-white dark:bg-navy-900 text-ink-700 dark:text-ink-200 focus:outline-none focus:ring-2 focus:ring-navy-500/30">
          <option value="">{t('availability.allStatuses')}</option>
          <option value="available">{t('availability.available')}</option>
          <option value="unavailable">{t('availability.unavailable')}</option>
          <option value="restricted">{t('availability.restricted')}</option>
          <option value="no_data">{t('availability.noData')}</option>
        </select>
        {(typeFilter.length > 0 || statusFilter) && (
          <button onClick={() => { setTypeFilter([]); setStatusFilter('') }}
            className="text-xs font-medium text-basketball-600 dark:text-basketball-400 hover:underline ml-1">
            {t('availability.resetFilters')}
          </button>
        )}
      </div>

      {filteredComps.length === 0 ? (
        <Card padding="p-12">
          <div className="text-center text-ink-500 dark:text-ink-400">
            <p className="text-sm">{t('availability.noCompetitions')}</p>
          </div>
        </Card>
      ) : (
        <Card padding="p-0" className="overflow-hidden">
          {/* Card header with inline legend */}
          <div className="px-4 py-3 border-b border-ink-100 dark:border-navy-800 flex items-center justify-between flex-wrap gap-3">
            <h3 className="text-[14px] font-semibold text-navy-900 dark:text-white">{t('availability.matrix')}</h3>
            <div className="flex items-center gap-3 flex-wrap text-xs">
              {legendItems.map((it, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${it.dot}`} />
                  <span className="text-ink-600 dark:text-ink-300">{it.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Matrix */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-ink-50/60 dark:bg-navy-950/40 border-b border-ink-100 dark:border-navy-800">
                  <th className="text-left px-4 py-2.5 font-semibold text-2xs uppercase tracking-wide text-ink-500 dark:text-ink-400 sticky left-0 bg-ink-50/60 dark:bg-navy-950/40 z-10 min-w-[200px] border-r border-ink-100 dark:border-navy-800">
                    Delegate
                  </th>
                  {filteredComps.map(comp => (
                    <th key={comp.id}
                      className={`px-1.5 py-1.5 text-center font-medium min-w-[84px] border-l border-ink-100 dark:border-navy-800 ${
                        compIsWeekend(comp) ? 'bg-ink-100/60 dark:bg-navy-950/60' : ''
                      }`}>
                      <div className="text-[11px] text-ink-700 dark:text-ink-200 font-semibold truncate" title={comp.name}>
                        {comp.short_name || comp.name?.substring(0, 14)}
                      </div>
                      <div className="text-[10px] text-ink-400 dark:text-ink-500 font-normal num leading-tight mt-0.5">
                        {formatCompDate(comp)}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTds.map(td => (
                  <tr key={td.id} className="border-b border-ink-100 dark:border-navy-800 hover:bg-ink-50/40 dark:hover:bg-navy-800/30 group">
                    <td className="px-4 py-2 sticky left-0 bg-white dark:bg-navy-900 group-hover:bg-ink-50/40 dark:group-hover:bg-navy-800/30 z-10 border-r border-ink-100 dark:border-navy-800">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar name={td.name} size="sm" />
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-ink-900 dark:text-white truncate">{td.name}</div>
                          {td.country && (
                            <div className="text-[11px] text-ink-500 dark:text-ink-400 truncate">{td.country}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    {filteredComps.map(comp => {
                      const entry = getStatus(td.id, comp.id)
                      const cs = entry.nomination_id ? (entry.confirmation_status || 'pending') : null
                      const style = cs ? NOMINATION_STYLES[cs] : STATUS_STYLES[entry.status]
                      const ts = entry.confirmation_updated_at
                        ? new Date(entry.confirmation_updated_at).toLocaleString()
                        : null
                      const tip = cs
                        ? `${t(`availability.${cs === 'pending' ? 'pendingNomination' : cs}`)}${ts ? ` · ${t('nominations.confirmationUpdatedAt')}: ${ts}` : ''}`
                        : (entry.notes || t(`availability.${entry.status === 'no_data' ? 'noData' : entry.status}`))
                      const cellBase = `block w-full h-8 transition-colors border-l border-ink-100 dark:border-navy-800 ${style.cell}`
                      return (
                        <td key={comp.id} className="p-0">
                          {canEdit ? (
                            <button onClick={() => openModal(td, comp)} className={cellBase} title={tip} />
                          ) : (
                            <div className={cellBase} title={tip} />
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {/* Summary row */}
                <tr className="bg-ink-50/60 dark:bg-navy-950/40 border-t-2 border-ink-200 dark:border-navy-800">
                  <td className="px-4 py-2.5 text-2xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400 sticky left-0 bg-ink-50/60 dark:bg-navy-950/40 z-10 border-r border-ink-100 dark:border-navy-800">
                    {t('availability.availableTds')}
                  </td>
                  {filteredComps.map(comp => (
                    <td key={comp.id} className="px-1 py-2 text-center text-[11px] border-l border-ink-100 dark:border-navy-800">
                      <span className="num font-semibold text-success-600 dark:text-success-500">{getAvailableCount(comp.id)}</span>
                      <span className="num text-ink-400 dark:text-ink-500"> / {tds.length}</span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Quick-set Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-navy-900 border border-ink-200 dark:border-navy-700 shadow-pop p-6">
            <h3 className="text-[15px] font-semibold text-navy-900 dark:text-white mb-1">
              {modal.existing ? t('availability.editAvailability') : t('availability.newAvailability')}
            </h3>
            <p className="text-xs text-ink-500 dark:text-ink-400 mb-4">
              {modal.td.name} — {modal.competition.short_name || modal.competition.name}
            </p>
            <form onSubmit={handleModalSubmit} className="space-y-3">
              <div>
                <label className="block text-2xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400 mb-1">
                  {t('availability.status')}
                </label>
                <select value={modalForm.status} onChange={e => setModalForm(f => ({ ...f, status: e.target.value }))}
                  className="w-full h-9 px-2.5 rounded-md border border-ink-200 dark:border-navy-700 bg-white dark:bg-navy-950 text-sm text-ink-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-navy-500/30">
                  <option value="available">{t('availability.available')}</option>
                  <option value="unavailable">{t('availability.unavailable')}</option>
                  <option value="restricted">{t('availability.restricted')}</option>
                </select>
              </div>
              <textarea placeholder={t('availability.notesPlaceholder')} value={modalForm.notes}
                onChange={e => setModalForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full px-2.5 py-2 rounded-md border border-ink-200 dark:border-navy-700 bg-white dark:bg-navy-950 text-sm text-ink-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-navy-500/30"
                rows={2} />
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="secondary" size="sm" onClick={() => setModal(null)}>
                  {t('availability.cancel')}
                </Button>
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? t('availability.saving') : t('availability.save')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
