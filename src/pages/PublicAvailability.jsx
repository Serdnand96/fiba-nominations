import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  getPublicAvailabilityForm, getPublicAvailabilityPerson, submitPublicAvailability,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { Avatar } from '../components/ui/Avatar'
import { Button } from '../components/ui/Button'
import { Icon } from '../lib/icons'
import { PublicShell, PublicUnavailable } from '../components/layout/PublicShell'

// Public self-service form: officials open a shared per-role link, pick their
// name and submit availability. Rendered outside the authenticated shell
// (see the early-return in App.jsx), so it carries its own page chrome.

const STATUSES = ['available', 'unavailable', 'restricted']

// Fondos -600/-700: sobre blanco, el texto blanco necesita un fondo lo bastante
// oscuro para pasar AA (los -500 daban 2.3-3.8:1). warning va a -700 porque el
// ámbar es claro.
const CHIP_SELECTED = {
  available:   'bg-success-600 border-success-600 text-white',
  unavailable: 'bg-danger-600 border-danger-600 text-white',
  restricted:  'bg-warning-700 border-warning-700 text-white',
}
const CHIP_IDLE = 'bg-white dark:bg-navy-950 border-ink-200 dark:border-navy-700 text-ink-600 dark:text-ink-300 hover:border-ink-300 dark:hover:border-navy-600'

const inputCls = 'w-full h-9 px-2.5 rounded-md border border-ink-200 dark:border-navy-700 bg-white dark:bg-navy-950 text-sm text-ink-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-navy-500/30'

export default function PublicAvailability() {
  const { token } = useParams()
  const { t, lang } = useLanguage()
  const locale = lang === 'es' ? 'es' : 'en-US'

  const [form, setForm] = useState(null)          // { role, personnel, competitions }
  const [loading, setLoading] = useState(true)
  const [invalid, setInvalid] = useState(false)

  const [search, setSearch] = useState('')
  const [person, setPerson] = useState(null)      // selected roster entry
  const [personLoading, setPersonLoading] = useState(false)
  const [confirmedAt, setConfirmedAt] = useState(null)

  const [events, setEvents] = useState({})        // competition_id -> { status, notes }
  const [ranges, setRanges] = useState([])        // [{ start_date, end_date, status, notes }]

  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    getPublicAvailabilityForm(token)
      .then(f => { if (!cancelled) { setForm(f); setLoading(false) } })
      .catch(() => { if (!cancelled) { setInvalid(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [token])

  const filteredPeople = useMemo(() => {
    if (!form) return []
    const q = search.trim().toLowerCase()
    if (!q) return form.personnel
    return form.personnel.filter(p =>
      p.name.toLowerCase().includes(q) || (p.country || '').toLowerCase().includes(q))
  }, [form, search])

  async function selectPerson(p) {
    setPersonLoading(true)
    setError(null)
    try {
      const data = await getPublicAvailabilityPerson(token, p.id)
      const compIds = new Set((form?.competitions || []).map(c => c.id))
      const ev = {}
      data.events.forEach(r => {
        if (compIds.has(r.competition_id)) ev[r.competition_id] = { status: r.status, notes: r.notes || '' }
      })
      setEvents(ev)
      setRanges(data.ranges.map(r => ({
        start_date: r.start_date || '', end_date: r.end_date || '',
        status: r.status || 'unavailable', notes: r.notes || '',
      })))
      setConfirmedAt(data.availability_confirmed_at)
      setPerson(p)
      setSubmitted(false)
    } catch {
      setError(t('publicAvailability.submitError'))
    }
    setPersonLoading(false)
  }

  function resetPerson() {
    setPerson(null)
    setEvents({})
    setRanges([])
    setSearch('')
    setSubmitted(false)
    setError(null)
  }

  function setEventStatus(compId, status) {
    setEvents(prev => {
      const cur = prev[compId] || { notes: '' }
      return { ...prev, [compId]: { ...cur, status } }
    })
  }

  function setEventNotes(compId, notes) {
    setEvents(prev => ({ ...prev, [compId]: { ...(prev[compId] || {}), notes } }))
  }

  function updateRange(idx, patch) {
    setRanges(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  async function handleSubmit() {
    setError(null)
    for (const r of ranges) {
      if (!r.start_date || !r.end_date || r.end_date < r.start_date) {
        setError(t('publicAvailability.rangeError'))
        return
      }
    }
    setSubmitting(true)
    try {
      const payload = {
        events: Object.entries(events)
          .filter(([, v]) => v.status)
          .map(([competition_id, v]) => ({ competition_id, status: v.status, notes: v.notes || null })),
        ranges: ranges.map(r => ({
          start_date: r.start_date, end_date: r.end_date,
          status: r.status || 'unavailable', notes: r.notes || null,
        })),
      }
      const res = await submitPublicAvailability(token, person.id, payload)
      setConfirmedAt(res.availability_confirmed_at)
      setSubmitted(true)
      window.scrollTo({ top: 0 })
    } catch {
      setError(t('publicAvailability.submitError'))
    }
    setSubmitting(false)
  }

  function fmtCompDates(c) {
    if (!c.start_date) return lang === 'es' ? 'Por confirmar' : 'TBD'
    const opts = { month: 'short', day: 'numeric' }
    const s = new Date(c.start_date + 'T00:00:00').toLocaleDateString(locale, opts)
    if (!c.end_date || c.end_date === c.start_date) return s
    const e = new Date(c.end_date + 'T00:00:00').toLocaleDateString(locale, opts)
    return lang === 'es' ? `${s} al ${e}` : `${s} to ${e}`
  }

  function fmtTimestamp(iso) {
    if (!iso) return ''
    return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
  }

  /* ── Page chrome ─────────────────────────────────────────────── */

  const shell = (children) => (
    <PublicShell width="max-w-2xl" title={t('publicAvailability.pageTitle')} context="FIBA Americas">
      <div className="max-w-2xl mx-auto px-4 py-6 md:py-8">
        {children}
      </div>
    </PublicShell>
  )

  if (loading) {
    return shell(
      <div className="flex justify-center py-20">
        <div className="w-6 h-6 border-2 border-basketball-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (invalid) {
    return (
      <PublicUnavailable
        title={lang === 'es' ? 'Este enlace no está disponible' : 'This link is not available'}
        message={t('publicAvailability.invalidLink')} />
    )
  }

  /* ── Success screen ──────────────────────────────────────────── */

  if (submitted) {
    return shell(
      <div className="bg-white dark:bg-navy-900 border border-ink-200 dark:border-navy-800 rounded-xl p-8 text-center">
        <div className="w-14 h-14 mx-auto rounded-full bg-success-100 dark:bg-success-500/20 flex items-center justify-center mb-4">
          <Icon.Check className="w-7 h-7 text-success-600 dark:text-success-500" />
        </div>
        <h2 className="text-lg font-semibold text-navy-900 dark:text-white mb-2">
          {t('publicAvailability.thanksTitle', { name: person?.name?.split(' ')[0] || '' })}
        </h2>
        <p className="text-sm text-ink-600 dark:text-ink-300 mb-6">
          {t('publicAvailability.thanksBody', { date: fmtTimestamp(confirmedAt) })}
        </p>
        <Button variant="secondary" onClick={() => setSubmitted(false)}>
          {t('publicAvailability.editAgain')}
        </Button>
      </div>
    )
  }

  /* ── Step 1: pick your name ──────────────────────────────────── */

  if (!person) {
    return shell(
      <div className="bg-white dark:bg-navy-900 border border-ink-200 dark:border-navy-800 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-ink-100 dark:border-navy-800">
          <h2 className="text-[15px] font-semibold text-navy-900 dark:text-white mb-0.5">
            {t(`rolesShort.${form.role}`)}
          </h2>
          <p className="text-sm text-ink-500 dark:text-ink-400">{t('publicAvailability.intro')}</p>
        </div>
        <div className="p-4">
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('publicAvailability.searchPlaceholder')}
            className={inputCls} autoFocus
          />
          <div className="mt-3 max-h-[50vh] overflow-y-auto divide-y divide-ink-100 dark:divide-navy-800 rounded-md border border-ink-100 dark:border-navy-800">
            {filteredPeople.length === 0 && (
              <div className="p-4 text-center text-sm text-ink-500 dark:text-ink-400">
                {t('publicAvailability.noMatches')}
              </div>
            )}
            {filteredPeople.map(p => (
              <button key={p.id} onClick={() => selectPerson(p)} disabled={personLoading}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-ink-50 dark:hover:bg-navy-800/60 transition-colors disabled:opacity-50">
                <Avatar name={p.name} size="sm" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13.5px] font-medium text-ink-900 dark:text-white truncate">{p.name}</span>
                  {p.country && <span className="block text-xs text-ink-500 dark:text-ink-400 truncate">{p.country}</span>}
                </span>
                <Icon.Chevron className="w-4 h-4 text-ink-400 dark:text-navy-600" />
              </button>
            ))}
          </div>
        </div>
        {error && <div className="px-4 pb-4 text-sm text-danger-600 dark:text-danger-500">{error}</div>}
      </div>
    )
  }

  /* ── Step 2: availability form ───────────────────────────────── */

  return shell(
    <div className="space-y-4">
      {/* Person header */}
      <div className="bg-white dark:bg-navy-900 border border-ink-200 dark:border-navy-800 rounded-xl p-4 flex items-center gap-3">
        <Avatar name={person.name} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold text-navy-900 dark:text-white truncate">{person.name}</div>
          <div className="text-xs text-ink-500 dark:text-ink-400">
            {confirmedAt
              ? t('publicAvailability.lastConfirmed', { date: fmtTimestamp(confirmedAt) })
              : t('publicAvailability.neverConfirmed')}
          </div>
        </div>
        <button onClick={resetPerson}
          className="text-xs font-medium text-basketball-700 dark:text-basketball-400 hover:underline flex-shrink-0">
          {t('publicAvailability.changeName')}
        </button>
      </div>

      {/* Upcoming competitions */}
      <div className="bg-white dark:bg-navy-900 border border-ink-200 dark:border-navy-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-ink-100 dark:border-navy-800">
          <h3 className="text-[14px] font-semibold text-navy-900 dark:text-white">{t('publicAvailability.upcoming')}</h3>
          <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">{t('publicAvailability.upcomingHelp')}</p>
        </div>
        {form.competitions.length === 0 ? (
          <div className="p-6 text-center text-sm text-ink-500 dark:text-ink-400">
            {t('publicAvailability.noCompetitions')}
          </div>
        ) : (
          <div className="divide-y divide-ink-100 dark:divide-navy-800">
            {form.competitions.map(c => {
              const answer = events[c.id] || {}
              return (
                <div key={c.id} className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium text-ink-900 dark:text-white">
                        {c.short_name || c.name}
                      </div>
                      <div className="text-xs text-ink-500 dark:text-ink-400 num">
                        {fmtCompDates(c)}{c.location ? ` · ${c.location}` : ''}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      {STATUSES.map(s => (
                        <button key={s} onClick={() => setEventStatus(c.id, s)}
                          className={`flex-1 sm:flex-none px-2.5 h-8 rounded-md text-xs font-medium border transition-colors whitespace-nowrap ${
                            answer.status === s ? CHIP_SELECTED[s] : CHIP_IDLE
                          }`}>
                          {t(`availability.${s}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {answer.status === 'restricted' && (
                    <div className="mt-2.5">
                      <p className="text-2xs text-ink-500 dark:text-ink-400 mb-1">{t('availability.restrictedHint')}</p>
                      <input
                        type="text" value={answer.notes || ''}
                        onChange={e => setEventNotes(c.id, e.target.value)}
                        placeholder={t('publicAvailability.restrictionNote')}
                        maxLength={500}
                        className={inputCls}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Unavailable periods */}
      <div className="bg-white dark:bg-navy-900 border border-ink-200 dark:border-navy-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-ink-100 dark:border-navy-800 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold text-navy-900 dark:text-white">{t('publicAvailability.blockedPeriods')}</h3>
            <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">{t('publicAvailability.blockedHelp')}</p>
          </div>
          <Button variant="secondary" size="sm" className="flex-shrink-0"
            onClick={() => setRanges(prev => [...prev, { start_date: '', end_date: '', status: 'unavailable', notes: '' }])}>
            {t('publicAvailability.addPeriod')}
          </Button>
        </div>
        {ranges.length === 0 ? (
          <div className="p-5 text-center text-sm text-ink-500 dark:text-ink-400">
            {t('publicAvailability.noPeriods')}
          </div>
        ) : (
          <div className="divide-y divide-ink-100 dark:divide-navy-800">
            {ranges.map((r, idx) => (
              <div key={idx} className="p-4 space-y-2.5">
                <div className="flex items-end gap-2.5">
                  <div className="flex-1">
                    <label className="block text-2xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400 mb-1">
                      {t('publicAvailability.from')}
                    </label>
                    <input type="date" value={r.start_date}
                      onChange={e => updateRange(idx, { start_date: e.target.value })} className={inputCls} />
                  </div>
                  <div className="flex-1">
                    <label className="block text-2xs font-semibold uppercase tracking-wide text-ink-500 dark:text-ink-400 mb-1">
                      {t('publicAvailability.to')}
                    </label>
                    <input type="date" value={r.end_date} min={r.start_date || undefined}
                      onChange={e => updateRange(idx, { end_date: e.target.value })} className={inputCls} />
                  </div>
                  <button onClick={() => setRanges(prev => prev.filter((_, i) => i !== idx))}
                    aria-label={t('availability.delete')} title={t('availability.delete')}
                    className="h-9 w-9 flex-shrink-0 inline-flex items-center justify-center rounded-md text-ink-500 hover:text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-500/10 transition-colors">
                    <Icon.Trash className="w-[18px] h-[18px]" />
                  </button>
                </div>
                <input type="text" value={r.notes}
                  onChange={e => updateRange(idx, { notes: e.target.value })}
                  placeholder={t('publicAvailability.optionalNote')} maxLength={500}
                  className={inputCls} />
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-danger-50 dark:bg-danger-500/10 border border-danger-100 dark:border-danger-500/30 rounded-lg px-4 py-3 text-sm text-danger-700 dark:text-danger-500">
          {error}
        </div>
      )}

      <Button size="lg" className="w-full" disabled={submitting} onClick={handleSubmit}>
        {submitting ? t('publicAvailability.confirming') : t('publicAvailability.confirmBtn')}
      </Button>

      <p className="text-center text-xs text-ink-400 dark:text-ink-500 pb-4">FIBA Americas</p>
    </div>
  )
}
