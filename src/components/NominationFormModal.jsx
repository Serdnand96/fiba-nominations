import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '../i18n/LanguageContext'
import { useToast } from './ui/Toast'
import { Icon } from '../lib/icons'
import { ROLES, roleLabel, roleBadgeClass } from '../lib/roles'
import { countryName } from '../lib/countries'
import { competitionLabel } from '../lib/competitions'
import { refereeCompetitionConflicts } from '../lib/refereeNeutrality'
import {
  getNominationPrefill, createNomination, createBulkNominations, updateNomination,
  generateNomination, previewNominationDraft, getGames,
} from '../api/client'

const BCLA_F4_ROUNDS = ['Semifinals', '3rd Place', 'Final']

function todayISO() {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

// Reads a backend error — a plain string, or the structured
// {code:'missing_fields', missing:[...], message} the generate endpoints send
// on 422 — into a string ready to show in a toast. Exported so Nominations.jsx
// can reuse it for the row-level Generate/Regenerate actions.
export function describeNominationError(err, t) {
  const detail = err?.response?.data?.detail
  if (detail == null) return err?.message || String(err)
  if (typeof detail === 'string') return detail
  if (detail.code === 'missing_fields') {
    const names = (detail.missing || []).map(f => t(`nominations.field.${f}`)).join(', ')
    return t('nominations.missingFieldsError', { fields: names })
  }
  return detail.message || JSON.stringify(detail)
}

function emptyForm(initialCompetitionId = '') {
  return {
    competition_id: initialCompetitionId, personnel_ids: [],
    letter_date: '', location: '', venue: '', arrival_date: '', departure_date: '',
    game_dates: [], window_fee: '', incidentals: '', confirmation_deadline: '',
  }
}

/**
 * Create/edit modal for a nomination. Talks to `/nominations/prefill` so the
 * form starts with what the system already knows (competition defaults +,
 * once exactly one person is picked, that person's own crew dates) instead of
 * asking for everything by hand. See CLAUDE.md point 9 for tournament vs
 * per-game crew, and the fee_type note below for the Total calculation.
 */
export default function NominationFormModal({
  mode, nomination, initialCompetitionId, competitions, personnel,
  onClose, onCreated, onUpdated,
}) {
  const { t } = useLanguage()
  const { push } = useToast()
  const isEdit = mode === 'edit'

  const [form, setForm] = useState(() => isEdit ? {
    competition_id: nomination.competition_id,
    personnel_ids: [nomination.personnel_id],
    letter_date: nomination.letter_date || '',
    location: nomination.location || '',
    venue: nomination.venue || '',
    arrival_date: nomination.arrival_date || '',
    departure_date: nomination.departure_date || '',
    game_dates: nomination.game_dates || [],
    window_fee: nomination.window_fee ?? '',
    incidentals: nomination.incidentals ?? '',
    confirmation_deadline: nomination.confirmation_deadline || '',
  } : emptyForm(initialCompetitionId))

  // Fields the user edited by hand. Auto-fill from prefill only touches a
  // field that's both empty AND not in this set — so re-fetching the
  // single-person prefill after the competition-level one already filled
  // something in doesn't clobber a manual edit.
  const touchedRef = useRef(new Set())
  const markTouched = (f) => touchedRef.current.add(f)

  const [prefill, setPrefill] = useState(null)
  const [assignedOnly, setAssignedOnly] = useState(false)
  const [roleFilter, setRoleFilter] = useState('')
  const [personSearch, setPersonSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  const selectedComp = competitions.find(c => c.id === form.competition_id)
  const templateKey = selectedComp?.template_key || prefill?.competition?.template_key || ''
  const feeType = selectedComp?.fee_type || prefill?.competition?.fee_type || 'tournament'
  const showLocationFields = ['BCLA', 'BCLA_F4', 'BCLA_RS', 'LSB'].includes(templateKey)
  const showDeadline = ['WCQ', 'GENERIC'].includes(templateKey)

  // Referee neutrality — informative only, competition-level nominations
  // never block (the restriction is enforced game by game, in Games).
  const [compGames, setCompGames] = useState([])
  useEffect(() => {
    if (!form.competition_id) { setCompGames([]); return }
    let cancelled = false
    getGames(form.competition_id)
      .then(g => { if (!cancelled) setCompGames(g || []) })
      .catch(() => { if (!cancelled) setCompGames([]) })
    return () => { cancelled = true }
  }, [form.competition_id])

  const refereeNotices = useMemo(() => {
    if (compGames.length === 0) return []
    const isNationalTeam = !!selectedComp?.is_national_team
    const notices = []
    for (const pid of form.personnel_ids) {
      const person = personnel.find(p => p.id === pid)
      if (!person || (person.role !== 'REF' && person.role !== 'REF_INSTRUCTOR')) continue
      const conflict = refereeCompetitionConflicts(person, compGames, isNationalTeam)
      if (conflict) notices.push({ person, ...conflict })
    }
    return notices
  }, [form.personnel_ids, personnel, compGames, selectedComp?.is_national_team])

  // Competition-level prefill — refetched every time the competition changes.
  useEffect(() => {
    if (!form.competition_id) { setPrefill(null); return }
    let cancelled = false
    getNominationPrefill(form.competition_id).then(data => {
      if (cancelled) return
      setPrefill(data)
      setAssignedOnly((data.assigned_personnel_ids || []).length > 0)
      if (!isEdit) {
        setForm(f => {
          const d = data.defaults || {}
          const next = { ...f }
          if (!touchedRef.current.has('letter_date') && !next.letter_date) next.letter_date = d.letter_date || todayISO()
          if (!touchedRef.current.has('confirmation_deadline') && !next.confirmation_deadline) next.confirmation_deadline = d.confirmation_deadline || ''
          if (!touchedRef.current.has('location') && !next.location) next.location = d.location || ''
          if (!touchedRef.current.has('venue') && !next.venue) next.venue = d.venue || ''
          if (!touchedRef.current.has('arrival_date') && !next.arrival_date) next.arrival_date = d.arrival_date || ''
          if (!touchedRef.current.has('departure_date') && !next.departure_date) next.departure_date = d.departure_date || ''
          if (!touchedRef.current.has('game_dates')) {
            const tk = data.competition?.template_key || ''
            if (tk === 'BCLA' || tk === 'BCLA_F4') {
              next.game_dates = BCLA_F4_ROUNDS.map(label => ({ label, date: '' }))
            } else if (tk === 'LSB') {
              next.game_dates = (data.game_dates || []).map((g, i) => ({ label: `Gameday ${i + 1}`, date: g.date || '' }))
            } else {
              next.game_dates = (data.game_dates || []).map(g => ({ label: g.label, date: g.date || '' }))
            }
          }
          return next
        })
      }
    }).catch(() => { if (!cancelled) setPrefill(null) })
    return () => { cancelled = true }
  }, [form.competition_id])

  // Single-person prefill, debounced: refines dates/venue/location with the
  // person's own crew assignment once exactly one is selected. With several
  // people selected we keep the competition-wide dates (see the note in the
  // JSX below) instead of guessing which person's schedule should win.
  useEffect(() => {
    if (form.personnel_ids.length !== 1 || !form.competition_id) return
    const pid = form.personnel_ids[0]
    const timer = setTimeout(() => {
      getNominationPrefill(form.competition_id, [pid]).then(data => {
        const info = data.people?.[pid]
        if (!info) return
        setForm(f => {
          const next = { ...f }
          if (!touchedRef.current.has('game_dates') && info.game_dates?.length
              && templateKey !== 'BCLA' && templateKey !== 'BCLA_F4') {
            next.game_dates = info.game_dates.map(g => ({ label: g.label, date: g.date }))
          }
          if (!touchedRef.current.has('arrival_date') && info.arrival_date) next.arrival_date = info.arrival_date
          if (!touchedRef.current.has('departure_date') && info.departure_date) next.departure_date = info.departure_date
          if (!touchedRef.current.has('venue') && info.venue) next.venue = info.venue
          if (!touchedRef.current.has('location') && info.location) next.location = info.location
          return next
        })
      }).catch(() => {})
    }, 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.personnel_ids.join(','), form.competition_id, templateKey])

  function handleCompChange(competitionId) {
    touchedRef.current = new Set()
    setForm(f => ({
      ...f, competition_id: competitionId,
      letter_date: '', location: '', venue: '', arrival_date: '', departure_date: '',
      game_dates: [], confirmation_deadline: '',
    }))
  }

  function setField(field, value) {
    markTouched(field)
    setForm(f => ({ ...f, [field]: value }))
  }

  function addGameDate() {
    markTouched('game_dates')
    setForm(f => {
      const idx = f.game_dates.length + 1
      const label = templateKey === 'LSB' ? `Gameday ${idx}` : ''
      return { ...f, game_dates: [...f.game_dates, { label, date: '' }] }
    })
  }
  function removeGameDate(idx) {
    markTouched('game_dates')
    setForm(f => ({ ...f, game_dates: f.game_dates.filter((_, i) => i !== idx) }))
  }
  function updateGameDate(idx, field, value) {
    markTouched('game_dates')
    setForm(f => {
      const gd = [...f.game_dates]
      gd[idx] = { ...gd[idx], [field]: value }
      return { ...f, game_dates: gd }
    })
  }

  function togglePerson(id) {
    setForm(f => {
      const ids = new Set(f.personnel_ids)
      if (ids.has(id)) ids.delete(id)
      else ids.add(id)
      return { ...f, personnel_ids: [...ids] }
    })
  }

  const filteredPersonnel = useMemo(() => {
    let list = personnel
    if (roleFilter) list = list.filter(p => p.role === roleFilter)
    if (assignedOnly && (prefill?.assigned_personnel_ids || []).length > 0) {
      const set = new Set(prefill.assigned_personnel_ids)
      list = list.filter(p => set.has(p.id))
    }
    if (personSearch) list = list.filter(p => p.name.toLowerCase().includes(personSearch.toLowerCase()))
    return list
  }, [personnel, roleFilter, assignedOnly, prefill, personSearch])

  function selectAllFiltered() { setForm(f => ({ ...f, personnel_ids: filteredPersonnel.map(p => p.id) })) }
  function clearSelection() { setForm(f => ({ ...f, personnel_ids: [] })) }

  // Fees — placeholder + hint come from the competition's fee schedule by
  // role; the Total honors fee_type (point 9/CLAUDE.md: per_game multiplies
  // by the game dates, tournament doesn't).
  const selectedPeople = form.personnel_ids.map(id => personnel.find(p => p.id === id)).filter(Boolean)
  const uniqueRoles = [...new Set(selectedPeople.map(p => p.role))]
  const singleRole = uniqueRoles.length === 1 ? uniqueRoles[0] : null
  const roleFee = singleRole ? prefill?.fees_by_role?.[singleRole] : null
  // With mixed roles the backend still fills the fee per person (one rate for
  // the TD, another for the VGO); the fee only counts as missing when some
  // selected role has no rate on the competition at all.
  const everyRoleHasFee = selectedPeople.length > 0
    && uniqueRoles.every(r => prefill?.fees_by_role?.[r]?.window_fee != null)

  const feesHint = useMemo(() => {
    const entries = Object.entries(prefill?.fees_by_role || {})
    if (entries.length === 0) return null
    return entries.map(([role, fee]) => `${roleLabel(role)} $${fee.window_fee}`).join(' · ')
  }, [prefill])

  const gameCount = form.game_dates.length
  const effectiveFee = form.window_fee !== '' ? (parseFloat(form.window_fee) || 0) : (roleFee ? roleFee.window_fee : null)
  const effectiveIncidentals = form.incidentals !== '' ? (parseFloat(form.incidentals) || 0) : (roleFee ? (roleFee.incidentals || 0) : 0)

  const { totalDisplay, breakdown } = useMemo(() => {
    if (effectiveFee == null) return { totalDisplay: t('nominations.totalByRole'), breakdown: '' }
    if (feeType === 'per_game') {
      const total = effectiveFee * gameCount + effectiveIncidentals
      return {
        totalDisplay: total.toFixed(2),
        breakdown: t('nominations.feeBreakdownPerGame', { count: gameCount, fee: effectiveFee, incidentals: effectiveIncidentals }),
      }
    }
    const total = effectiveFee + effectiveIncidentals
    return {
      totalDisplay: total.toFixed(2),
      breakdown: t('nominations.feeBreakdownTournament', { fee: effectiveFee, incidentals: effectiveIncidentals }),
    }
  }, [effectiveFee, effectiveIncidentals, feeType, gameCount, t])

  const requiredFields = prefill?.required_fields || []
  function isRequired(field) { return requiredFields.includes(field) }

  const missingFields = useMemo(() => {
    const missing = []
    for (const f of requiredFields) {
      if (f === 'game_dates') {
        if (form.game_dates.length === 0 || form.game_dates.some(gd => !gd.date)) missing.push(f)
      } else if (f === 'window_fee') {
        if (form.window_fee === '' && !everyRoleHasFee) missing.push(f)
      } else if (!form[f]) {
        missing.push(f)
      }
    }
    return missing
  }, [requiredFields, form, everyRoleHasFee])

  function buildPayload() {
    const payload = {
      letter_date: form.letter_date || null,
      game_dates: form.game_dates,
      window_fee: form.window_fee === '' ? null : parseFloat(form.window_fee),
      incidentals: form.incidentals === '' ? null : parseFloat(form.incidentals),
    }
    if (!isEdit) payload.competition_id = form.competition_id
    if (showLocationFields) {
      payload.location = form.location
      payload.venue = form.venue
      payload.arrival_date = form.arrival_date || null
      payload.departure_date = form.departure_date || null
    }
    if (showDeadline) payload.confirmation_deadline = form.confirmation_deadline || null
    return payload
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      if (isEdit) {
        await updateNomination(nomination.id, buildPayload())
        if (nomination.status === 'generated') {
          try {
            const genResult = await generateNomination(nomination.id)
            if (genResult.status === 'generated') {
              push({ type: 'success', title: t('nominations.regenerated') })
            } else {
              push({ type: 'error', title: describeNominationError({ response: { data: { detail: genResult } } }, t) })
            }
          } catch (err) {
            push({ type: 'error', title: describeNominationError(err, t) })
          }
        } else {
          push({ type: 'success', title: t('nominations.updated') })
        }
        onUpdated()
        onClose()
        return
      }

      const payload = buildPayload()
      let createdIds = []
      if (form.personnel_ids.length > 1) {
        const result = await createBulkNominations({ ...payload, personnel_ids: form.personnel_ids })
        createdIds = (result.nominations || []).map(n => n.id)
        if (result.errors?.length) {
          push({ type: 'error', title: `${t('personnel.errors')}: ${result.errors.length}` })
        }
      } else if (form.personnel_ids.length === 1) {
        const result = await createNomination({ ...payload, personnel_id: form.personnel_ids[0] })
        createdIds = [result.id]
      }
      if (missingFields.length > 0 && createdIds.length > 0) {
        push({ type: 'info', title: t('nominations.missingFieldsDraft', {
          fields: missingFields.map(f => t(`nominations.field.${f}`)).join(', '),
        }) })
      }
      onCreated(createdIds)
    } catch (err) {
      push({ type: 'error', title: describeNominationError(err, t) })
    } finally {
      setSaving(false)
    }
  }

  const canPreview = !!form.competition_id && form.personnel_ids.length === 1

  return createPortal(
    <div className="fiba-modal-overlay z-[60]">
      <div className="fiba-modal max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-ink-900 dark:text-white">
            {isEdit ? t('nominations.editNominationTitle') : t('nominations.newNominationTitle')}
          </h3>
          <button onClick={onClose} className="text-fiba-muted hover:text-ink-900 dark:hover:text-white text-xl">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Competition first */}
          <div>
            <label className="fiba-label">{t('nominations.competition')}</label>
            {isEdit ? (
              <p className="text-sm font-medium text-ink-900 dark:text-white">
                {competitionLabel(selectedComp, t('months.short'))}
              </p>
            ) : (
              <select required value={form.competition_id} onChange={e => handleCompChange(e.target.value)} className="fiba-select">
                <option value="">{t('nominations.selectCompetition')}</option>
                {competitions.map(c => (
                  <option key={c.id} value={c.id}>{competitionLabel(c, t('months.short'))}</option>
                ))}
              </select>
            )}
          </div>

          {/* Persons */}
          <div>
            <label className="fiba-label">
              {t('nominations.persons')}
              {!isEdit && ` (${form.personnel_ids.length} ${t('nominations.selected')})`}
            </label>
            {isEdit ? (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-ink-900 dark:text-white">{nomination.personnel?.name}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${roleBadgeClass(nomination.personnel?.role)}`}>
                  {roleLabel(nomination.personnel?.role)}
                </span>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <button type="button" onClick={() => setRoleFilter('')}
                    className={`px-2 py-1 rounded text-xs font-medium ${roleFilter === '' ? 'bg-fiba-accent/20 text-fiba-accent' : 'text-fiba-muted hover:text-ink-900 dark:hover:text-white'}`}>
                    {t('nominations.roleAll')}
                  </button>
                  {ROLES.map(r => (
                    <button key={r.value} type="button" onClick={() => setRoleFilter(r.value)}
                      className={`px-2 py-1 rounded text-xs font-medium ${roleFilter === r.value ? 'bg-fiba-accent/20 text-fiba-accent' : 'text-fiba-muted hover:text-ink-900 dark:hover:text-white'}`}>
                      {roleLabel(r.value)}
                    </button>
                  ))}
                </div>
                {(prefill?.assigned_personnel_ids || []).length > 0 && (
                  <label className="flex items-center gap-2 mb-2 text-xs text-fiba-muted">
                    <input type="checkbox" checked={assignedOnly} onChange={e => setAssignedOnly(e.target.checked)} className="rounded" />
                    {t('nominations.onlyAssigned')}
                  </label>
                )}
                <input type="text" placeholder={t('nominations.searchPerson')} value={personSearch}
                  onChange={e => setPersonSearch(e.target.value)} className="fiba-input mb-1" />
                <div className="flex gap-2 mb-2">
                  <button type="button" onClick={selectAllFiltered} className="text-fiba-accent hover:underline text-xs">
                    {t('nominations.selectAll')}
                  </button>
                  <button type="button" onClick={clearSelection} className="text-fiba-muted hover:underline text-xs">
                    {t('nominations.clear')}
                  </button>
                </div>
                <div className="border border-fiba-border rounded-lg max-h-48 overflow-y-auto">
                  {filteredPersonnel.map(p => (
                    <label key={p.id}
                      className={`flex items-center gap-2 px-3 py-2 hover:bg-fiba-surface cursor-pointer text-sm ${form.personnel_ids.includes(p.id) ? 'bg-fiba-accent/10' : ''}`}>
                      <input type="checkbox" checked={form.personnel_ids.includes(p.id)} onChange={() => togglePerson(p.id)} className="rounded" />
                      <span>{p.name}</span>
                      <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${roleBadgeClass(p.role)}`}>{roleLabel(p.role)}</span>
                    </label>
                  ))}
                  {filteredPersonnel.length === 0 && (
                    <p className="px-3 py-4 text-center text-fiba-muted/60 text-sm">{t('nominations.noPersonsFound')}</p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Referee neutrality — informative only at competition level */}
          {refereeNotices.length > 0 && (
            <div className="px-3 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-1">
              <p className="text-xs font-bold text-amber-500">{t('nominations.refWarningTitle')}</p>
              {refereeNotices.map(n => (
                <div key={n.person.id} className="space-y-0.5">
                  {n.clubs && (
                    <p className="text-xs text-amber-500/90">
                      {t('nominations.refWarningClubs', {
                        name: n.person.name,
                        country: countryName(n.countryCode),
                        clubs: n.clubs.join(', '),
                      })}
                    </p>
                  )}
                  {!n.clubs && n.playsInTournament && (
                    <p className="text-xs text-amber-500/90">
                      {n.groups.length > 0
                        ? t('nominations.refWarningGroups', {
                            name: n.person.name,
                            country: countryName(n.countryCode),
                            groups: n.groups.join(', '),
                          })
                        : t('nominations.refWarningPlays', {
                            name: n.person.name,
                            country: countryName(n.countryCode),
                          })}
                    </p>
                  )}
                  {!n.clubs && n.specialBlocked?.length > 0 && (
                    <p className="text-xs text-amber-500/90">
                      {t('nominations.refWarningSpecial', {
                        name: n.person.name,
                        blocked: n.specialBlocked.map(c => countryName(c)).join(', '),
                      })}
                    </p>
                  )}
                </div>
              ))}
              <p className="text-[11px] text-amber-500/70">{t('nominations.refWarningHint')}</p>
            </div>
          )}

          {!isEdit && form.personnel_ids.length > 1 && (
            <p className="text-xs text-fiba-muted italic">{t('nominations.multiPersonDatesNote')}</p>
          )}

          {/* Letter date */}
          <div>
            <label className="fiba-label">{t('nominations.letterDate')}{isRequired('letter_date') && ' *'}</label>
            <input type="date" value={form.letter_date} onChange={e => setField('letter_date', e.target.value)} className="fiba-input" />
          </div>

          {/* Location & venue */}
          {showLocationFields && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="fiba-label">{t('nominations.location')}{isRequired('location') && ' *'}</label>
                  <input type="text" value={form.location} onChange={e => setField('location', e.target.value)} className="fiba-input" />
                </div>
                <div>
                  <label className="fiba-label">{t('nominations.venue')}{isRequired('venue') && ' *'}</label>
                  <input type="text" value={form.venue} onChange={e => setField('venue', e.target.value)} className="fiba-input" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="fiba-label">{t('nominations.arrivalDate')}{isRequired('arrival_date') && ' *'}</label>
                  <input type="date" value={form.arrival_date} onChange={e => setField('arrival_date', e.target.value)} className="fiba-input" />
                </div>
                <div>
                  <label className="fiba-label">{t('nominations.departureDate')}{isRequired('departure_date') && ' *'}</label>
                  <input type="date" value={form.departure_date} onChange={e => setField('departure_date', e.target.value)} className="fiba-input" />
                </div>
              </div>
            </>
          )}

          {/* Game dates */}
          {templateKey && templateKey !== 'BCLA_RS' && (
            <div>
              <label className="fiba-label">{t('nominations.gameDates')}{isRequired('game_dates') && ' *'}</label>
              {form.game_dates.map((gd, idx) => (
                <div key={idx} className="flex gap-2 mb-2 items-center">
                  {(templateKey === 'BCLA' || templateKey === 'BCLA_F4') ? (
                    <span className="text-sm text-fiba-muted w-28">{gd.label}</span>
                  ) : (
                    <input type="text" value={gd.label} onChange={e => updateGameDate(idx, 'label', e.target.value)}
                      placeholder={t('templates.label')} className="fiba-input w-32" readOnly={templateKey === 'LSB'} />
                  )}
                  <input type="date" value={gd.date} onChange={e => updateGameDate(idx, 'date', e.target.value)} className="fiba-input flex-1" />
                  {templateKey !== 'BCLA' && templateKey !== 'BCLA_F4' && (
                    <button type="button" onClick={() => removeGameDate(idx)} className="text-red-400 hover:text-red-300 text-lg">&times;</button>
                  )}
                </div>
              ))}
              {templateKey !== 'BCLA' && templateKey !== 'BCLA_F4' && (
                <button type="button" onClick={addGameDate} className="text-fiba-accent hover:underline text-sm">
                  {t('nominations.addDate')}
                </button>
              )}
            </div>
          )}

          {/* Confirmation deadline */}
          {showDeadline && (
            <div>
              <label className="fiba-label">{t('nominations.confirmationDeadline')}{isRequired('confirmation_deadline') && ' *'}</label>
              <input type="date" value={form.confirmation_deadline}
                onChange={e => setField('confirmation_deadline', e.target.value)} className="fiba-input" />
            </div>
          )}

          {/* Fees */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="fiba-label">
                {feeType === 'tournament' ? t('nominations.tournamentFee') : t('nominations.perGameFee')}
                {isRequired('window_fee') && ' *'}
              </label>
              <input type="number" step="0.01" value={form.window_fee}
                placeholder={roleFee ? String(roleFee.window_fee) : ''}
                onChange={e => setField('window_fee', e.target.value)} className="fiba-input" />
            </div>
            <div>
              <label className="fiba-label">{t('nominations.incidentals')}{isRequired('incidentals') && ' *'}</label>
              <input type="number" step="0.01" value={form.incidentals}
                placeholder={roleFee ? String(roleFee.incidentals ?? 0) : ''}
                onChange={e => setField('incidentals', e.target.value)} className="fiba-input" />
            </div>
            <div>
              <label className="fiba-label">{t('nominations.total')}</label>
              <input type="text" value={totalDisplay} readOnly className="fiba-input bg-fiba-surface" />
            </div>
          </div>
          {breakdown && <p className="text-xs text-fiba-muted -mt-2">{breakdown}</p>}
          <p className="text-xs text-fiba-muted">
            {feesHint ? t('nominations.feesHintKnown', { list: feesHint }) : t('nominations.feesHintEmpty')}
          </p>

          {missingFields.length > 0 && (
            <p className="text-xs text-amber-500">
              {t('nominations.missingFieldsLine', { fields: missingFields.map(f => t(`nominations.field.${f}`)).join(', ') })}
            </p>
          )}

          <div className="flex justify-between items-center gap-3 pt-4">
            <button type="button" onClick={() => setPreviewOpen(true)} disabled={!canPreview}
              className="btn-fiba-ghost disabled:opacity-40">
              {t('nominations.viewLetter')}
            </button>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-fiba-muted hover:text-ink-900 dark:text-white">
                {t('nominations.cancel')}
              </button>
              <button type="submit" disabled={saving || form.personnel_ids.length === 0} className="btn-fiba disabled:opacity-50">
                {saving ? t('nominations.saving')
                  : isEdit ? t('nominations.saveChanges')
                  : form.personnel_ids.length > 1 ? t('nominations.createCount', { count: form.personnel_ids.length })
                  : t('nominations.createOne')}
              </button>
            </div>
          </div>
        </form>
      </div>

      {previewOpen && (
        <NominationPreviewModal
          title={t('nominations.previewTitle', { name: selectedPeople[0]?.name || '' })}
          fetcher={() => previewNominationDraft({ ...buildPayload(), competition_id: form.competition_id, personnel_id: form.personnel_ids[0] })}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>,
    document.body
  )
}

/**
 * PDF (or, if LibreOffice is down, .docx) preview in an iframe — same blob +
 * portal pattern as Templates.jsx's sample preview, for the same reason: an
 * AppShell ancestor creates a containing block, so a plain fixed overlay
 * would anchor to it instead of the viewport and end up cut off.
 *
 * `fetcher` is `() => previewNomination(id)` for an existing row, or
 * `() => previewNominationDraft(payload)` from inside the form — both resolve
 * to `{ blob, isPdf, missing, conversionError }` (see api/client.js).
 */
export function NominationPreviewModal({ title, fetcher, onClose }) {
  const { t } = useLanguage()
  const [url, setUrl] = useState(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState(null)
  const [missing, setMissing] = useState([])

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setError(null)
    fetcher().then(({ blob, isPdf, missing: m }) => {
      if (cancelled) return
      setMissing(m || [])
      if (isPdf) {
        setUrl(URL.createObjectURL(blob))
      } else {
        // LibreOffice is down — hand the user the .docx instead of an empty frame.
        const objUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = objUrl
        a.download = 'nomination_preview.docx'
        a.click()
        URL.revokeObjectURL(objUrl)
        setError(t('nominations.previewDocx'))
      }
    }).catch(() => { if (!cancelled) setError(t('nominations.previewError')) })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  return createPortal(
    <div className="fiba-modal-overlay z-[70]">
      <div className="fiba-modal max-w-4xl">
        <div className="flex items-start justify-between p-4 border-b border-fiba-border">
          <h3 className="text-lg font-bold text-ink-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="text-fiba-muted hover:text-ink-900 dark:hover:text-white">
            <Icon.X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">
          {!busy && missing.length > 0 && (
            <div className="mb-3 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-600 dark:text-amber-400">
              {t('nominations.previewMissing', { fields: missing.map(f => t(`nominations.field.${f}`)).join(', ') })}
            </div>
          )}
          {busy && (
            <div className="h-[70vh] flex items-center justify-center text-fiba-muted text-sm">
              {t('nominations.generatingPreview')}
            </div>
          )}
          {!busy && error && (
            <div className="h-[70vh] flex items-center justify-center text-center text-sm text-fiba-muted px-6">
              {error}
            </div>
          )}
          {!busy && !error && url && (
            <iframe src={url} title={title} className="w-full h-[70vh] rounded-lg border border-fiba-border bg-white" />
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
