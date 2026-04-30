import { useState, useEffect, useMemo } from 'react'
import { getCalendarCompetitions, getPersonnel, getCompetitionAvailability,
  createAvailability, updateAvailability } from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'

const STATUS_STYLES = {
  available: { bg: 'bg-green-500', cell: 'bg-emerald-500/10 hover:bg-emerald-500/20', text: 'text-emerald-400' },
  unavailable: { bg: 'bg-red-500', cell: 'bg-red-500/10 hover:bg-red-500/20', text: 'text-red-400' },
  restricted: { bg: 'bg-yellow-500', cell: 'bg-yellow-500/10 hover:bg-yellow-500/20', text: 'text-yellow-400' },
  no_data: { bg: 'bg-gray-500', cell: 'bg-fiba-surface hover:bg-fiba-surface-2', text: 'text-fiba-muted' },
}

// Nomination workflow takes precedence over raw availability
const NOMINATION_STYLES = {
  nominated: { bg: 'bg-fiba-accent shadow-[0_0_6px_rgba(242,254,90,0.6)]', cell: 'bg-fiba-accent/10 hover:bg-fiba-accent/20' },
  confirmed: { bg: 'bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.6)]', cell: 'bg-blue-500/10 hover:bg-blue-500/20' },
  declined: { bg: 'bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.6)]', cell: 'bg-orange-500/10 hover:bg-orange-500/20' },
  pending: { bg: 'bg-transparent border-2 border-fiba-accent/60', cell: 'bg-fiba-accent/5 hover:bg-fiba-accent/10' },
}

const COMP_TYPES = ['BCLA', 'WCQ', 'LSB', 'LSBF', 'WBLA', 'AmeriCup', 'U-Series', '3x3']

export default function Availability() {
  const { t, lang } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('availability')
  const [competitions, setCompetitions] = useState([])
  const [tds, setTds] = useState([])
  const [availData, setAvailData] = useState({}) // comp_id -> [{ personnel_id, status, notes, availability_id }]
  const [loading, setLoading] = useState(true)

  // Filters
  const [typeFilter, setTypeFilter] = useState([])
  const [statusFilter, setStatusFilter] = useState('')

  // Modal
  const [modal, setModal] = useState(null) // { td, competition, existing? }
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

      // Filter to upcoming competitions (next 12 months)
      const now = new Date()
      const cutoff = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())
      const upcoming = comps.filter(c => {
        if (c.start_date) return new Date(c.start_date + 'T00:00:00') <= cutoff
        return true // include TBD
      }).sort((a, b) => (a.start_date || '9999').localeCompare(b.start_date || '9999'))

      setCompetitions(upcoming)
      setTds(pers.filter(p => p.role === 'TD'))

      // Fetch availability for all competitions in parallel
      const avails = await Promise.all(
        upcoming.map(c => getCompetitionAvailability(c.id).catch(() => []))
      )
      const map = {}
      upcoming.forEach((c, i) => { map[c.id] = avails[i] })
      setAvailData(map)
    } catch (err) { console.error('Load error:', err) }
    setLoading(false)
  }

  // Filtered competitions
  const filteredComps = useMemo(() => {
    return competitions.filter(c => {
      if (typeFilter.length > 0 && !typeFilter.includes(c.competition_type)) return false
      return true
    })
  }, [competitions, typeFilter])

  // Build matrix: for each TD, get status per competition
  function getStatus(tdId, compId) {
    const compAvail = availData[compId] || []
    const entry = compAvail.find(a => a.personnel_id === tdId)
    return entry || { status: 'no_data', notes: '', availability_id: null }
  }

  // Filter TDs by status if needed
  const filteredTds = useMemo(() => {
    if (!statusFilter) return tds
    return tds.filter(td => {
      return filteredComps.some(c => getStatus(td.id, c.id).status === statusFilter)
    })
  }, [tds, statusFilter, filteredComps, availData])

  // Summary counts
  function getAvailableCount(compId) {
    const compAvail = availData[compId] || []
    return compAvail.filter(a => a.status === 'available').length
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
      // Refresh availability for this competition
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-fiba-muted text-sm">{t('common.loading')}</span>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">{t('availability.title')}</h2>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex flex-wrap gap-1.5">
          {COMP_TYPES.map(type => (
            <button key={type} onClick={() => toggleTypeFilter(type)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                typeFilter.includes(type) ? 'bg-fiba-accent text-fiba-dark border-fiba-accent' : 'bg-fiba-surface text-fiba-muted border-fiba-border hover:bg-fiba-surface-2'
              }`}>
              {type}
            </button>
          ))}
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="fiba-select text-xs px-3 py-1.5">
          <option value="">{t('availability.allStatuses')}</option>
          <option value="available">{t('availability.available')}</option>
          <option value="unavailable">{t('availability.unavailable')}</option>
          <option value="restricted">{t('availability.restricted')}</option>
          <option value="no_data">{t('availability.noData')}</option>
        </select>
        {(typeFilter.length > 0 || statusFilter) && (
          <button onClick={() => { setTypeFilter([]); setStatusFilter('') }}
            className="text-xs text-fiba-accent hover:underline">
            {t('availability.resetFilters')}
          </button>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 mb-4 text-[11px] text-fiba-muted">
        <span className="font-medium">{t('availability.legend')}:</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" />{t('availability.available')}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" />{t('availability.unavailable')}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-500" />{t('availability.restricted')}</span>
        <span className="text-fiba-muted/40">|</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-fiba-accent shadow-[0_0_6px_rgba(242,254,90,0.6)]" />{t('availability.nominated')}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.6)]" />{t('availability.confirmed')}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-500 shadow-[0_0_6px_rgba(249,115,22,0.6)]" />{t('availability.declined')}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-full border-2 border-fiba-accent/60" />{t('availability.pendingNomination')}</span>
      </div>

      {filteredComps.length === 0 ? (
        <div className="text-center py-12 text-fiba-muted">
          <p className="text-sm">{t('availability.noCompetitions')}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-fiba-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-fiba-surface border-b border-fiba-border">
                  <th className="text-left px-3 py-2 font-medium text-fiba-muted sticky left-0 bg-fiba-surface z-10 min-w-[180px]">
                    TD
                  </th>
                  {filteredComps.map(comp => (
                    <th key={comp.id} className="px-2 py-2 text-center font-medium text-fiba-muted min-w-[80px]">
                      <div className="truncate max-w-[80px]" title={comp.name}>
                        {comp.short_name || comp.name?.substring(0, 10)}
                      </div>
                      <div className="text-[10px] text-fiba-muted/60 font-normal">{formatCompDate(comp)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredTds.map(td => (
                  <tr key={td.id} className="border-t border-fiba-border">
                    <td className="px-3 py-2 font-medium text-white sticky left-0 bg-fiba-card z-10 border-r border-fiba-border">
                      <div className="flex items-center gap-1.5">
                        <span>{td.name}</span>
                        {td.country && <span className="text-[10px] text-fiba-muted/60">{td.country}</span>}
                      </div>
                    </td>
                    {filteredComps.map(comp => {
                      const entry = getStatus(td.id, comp.id)
                      // Nomination workflow takes precedence
                      const cs = entry.nomination_id ? (entry.confirmation_status || 'pending') : null
                      const style = cs ? NOMINATION_STYLES[cs] : STATUS_STYLES[entry.status]
                      const ts = entry.confirmation_updated_at
                        ? new Date(entry.confirmation_updated_at).toLocaleString()
                        : null
                      const tip = cs
                        ? `${t(`availability.${cs === 'pending' ? 'pendingNomination' : cs}`)}${ts ? ` · ${t('nominations.confirmationUpdatedAt')}: ${ts}` : ''}`
                        : (entry.notes || t(`availability.${entry.status === 'no_data' ? 'noData' : entry.status}`))
                      return (
                        <td key={comp.id} className="px-1 py-1 text-center">
                          {canEdit ? (
                            <button onClick={() => openModal(td, comp)}
                              className={`w-full py-1.5 rounded ${style.cell} transition-colors`}
                              title={tip}>
                              <span className={`inline-block w-2.5 h-2.5 rounded-full ${style.bg}`} />
                            </button>
                          ) : (
                            <div className={`w-full py-1.5 rounded ${style.cell}`}
                              title={tip}>
                              <span className={`inline-block w-2.5 h-2.5 rounded-full ${style.bg}`} />
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {/* Summary row */}
                <tr className="bg-fiba-surface border-t-2 border-fiba-border font-medium">
                  <td className="px-3 py-2 text-fiba-muted sticky left-0 bg-fiba-surface z-10 border-r border-fiba-border">
                    {t('availability.availableTds')}
                  </td>
                  {filteredComps.map(comp => (
                    <td key={comp.id} className="px-2 py-2 text-center text-fiba-muted">
                      <span className="text-emerald-400">{getAvailableCount(comp.id)}</span>
                      <span className="text-fiba-muted/60"> / {tds.length}</span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick-set Modal */}
      {modal && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-sm p-6">
            <h3 className="text-sm font-bold mb-1 text-white">
              {modal.existing ? t('availability.editAvailability') : t('availability.newAvailability')}
            </h3>
            <p className="text-xs text-fiba-muted mb-4">
              {modal.td.name} — {modal.competition.short_name || modal.competition.name}
            </p>
            <form onSubmit={handleModalSubmit} className="space-y-3">
              <div>
                <label className="fiba-label">{t('availability.status')}</label>
                <select value={modalForm.status} onChange={e => setModalForm(f => ({ ...f, status: e.target.value }))}
                  className="fiba-select">
                  <option value="available">{t('availability.available')}</option>
                  <option value="unavailable">{t('availability.unavailable')}</option>
                  <option value="restricted">{t('availability.restricted')}</option>
                </select>
              </div>
              <textarea placeholder={t('availability.notesPlaceholder')} value={modalForm.notes}
                onChange={e => setModalForm(f => ({ ...f, notes: e.target.value }))}
                className="fiba-input" rows={2} />
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setModal(null)} className="px-4 py-2 text-sm text-fiba-muted">
                  {t('availability.cancel')}
                </button>
                <button type="submit" disabled={saving}
                  className="btn-fiba disabled:opacity-50">
                  {saving ? t('availability.saving') : t('availability.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
