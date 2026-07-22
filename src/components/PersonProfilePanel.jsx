import { useState, useEffect, useRef } from 'react'
import {
  getPersonnelById, updatePersonnel, uploadPersonnelPhoto, getPersonnelAvailability,
  getPersonnelWorkload, getCompetitions, createAvailability,
  updateAvailability, deleteAvailability,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { ROLES, roleLabel, roleBadgeClass } from '../lib/roles'
import { COUNTRIES, countryName, countryNameToCode } from '../lib/countries'

const STATUS_STYLES = {
  available: 'bg-emerald-500/20 text-emerald-400',
  unavailable: 'bg-red-500/20 text-red-400',
  restricted: 'bg-yellow-500/20 text-yellow-400',
}

function initials(name) {
  return (name || '')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0].toUpperCase()).join('')
}

// Visa expiry status → styling. 'expired' | 'soon' (<90d) | 'ok' | 'none'
function visaStatus(expires) {
  if (!expires) return 'none'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const exp = new Date(expires + 'T00:00:00')
  if (isNaN(exp)) return 'none'
  const days = Math.round((exp - today) / 86400000)
  if (days < 0) return 'expired'
  if (days <= 90) return 'soon'
  return 'ok'
}

const VISA_STYLES = {
  expired: 'bg-red-500/20 text-red-400',
  soon: 'bg-yellow-500/20 text-yellow-400',
  ok: 'bg-emerald-500/20 text-emerald-400',
  none: 'bg-fiba-surface text-fiba-muted',
}

/**
 * Self-contained profile side panel for a TD/VGO. Handles its own data loading
 * (workload + availability), photo upload, info editing and availability CRUD,
 * so it can be dropped into any page (Personnel, Nominations, …).
 */
export default function PersonProfilePanel({ person: initialPerson, onClose, onUpdated, canEdit, canEditAvail }) {
  const { t, lang } = useLanguage()
  const [person, setPerson] = useState(initialPerson)
  const [workload, setWorkload] = useState(null)
  const [availRecords, setAvailRecords] = useState([])
  const [competitions, setCompetitions] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  // Edit-info modal
  const [showEdit, setShowEdit] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', country: '', country_code: '', phone: '', passport: '', role: 'VGO', languagesText: '', visas: [] })

  // Availability modal
  const [showAvailModal, setShowAvailModal] = useState(false)
  const [editingAvail, setEditingAvail] = useState(null)
  const [availForm, setAvailForm] = useState({
    type: 'event_specific', competition_id: '', start_date: '', end_date: '', status: 'available', notes: '',
  })

  useEffect(() => {
    setPerson(initialPerson)
    load(initialPerson.id)
  }, [initialPerson.id])

  async function load(id) {
    setLoading(true)
    setWorkload(null)
    try {
      const [full, records, wl, comps] = await Promise.all([
        getPersonnelById(id).catch(() => null),
        getPersonnelAvailability(id),
        getPersonnelWorkload(id).catch(() => null),
        getCompetitions(),
      ])
      // Hydrate the full record (country/phone/passport/photo) so the panel works
      // even when opened from a page that only has partial personnel data.
      if (full) setPerson(p => ({ ...p, ...full }))
      setAvailRecords(records)
      setWorkload(wl)
      setCompetitions(comps)
    } catch {
      setAvailRecords([]); setWorkload(null)
    }
    setLoading(false)
  }

  async function handlePhoto(file) {
    if (!file) return
    setUploading(true)
    try {
      const res = await uploadPersonnelPhoto(person.id, file)
      // cache-bust: same storage path returns the same URL
      const busted = res.photo_url ? `${res.photo_url}?v=${Date.now()}` : res.photo_url
      setPerson(p => ({ ...p, photo_url: busted }))
      onUpdated?.()
    } catch (err) {
      alert(err.response?.data?.detail || t('personnel.errorSavingPhoto') || 'Error')
    }
    setUploading(false)
  }

  function openEdit() {
    setForm({
      name: person.name, email: person.email, country: person.country || '',
      country_code: person.country_code || countryNameToCode(person.country) || '',
      phone: person.phone || '', passport: person.passport || '', role: person.role,
      languagesText: (person.languages || []).join(', '),
      visas: (person.visas || []).map(v => ({ country: v.country || '', expires: v.expires || '' })),
    })
    setShowEdit(true)
  }

  function addVisa() {
    setForm(f => ({ ...f, visas: [...f.visas, { country: '', expires: '' }] }))
  }
  function updateVisa(idx, field, value) {
    setForm(f => {
      const visas = [...f.visas]
      visas[idx] = { ...visas[idx], [field]: value }
      return { ...f, visas }
    })
  }
  function removeVisa(idx) {
    setForm(f => ({ ...f, visas: f.visas.filter((_, i) => i !== idx) }))
  }

  async function handleEditSubmit(e) {
    e.preventDefault()
    const payload = {
      name: form.name, email: form.email, country: form.country, country_code: form.country_code,
      phone: form.phone, passport: form.passport, role: form.role,
      languages: (form.languagesText || '').split(',').map(s => s.trim()).filter(Boolean),
      visas: form.visas
        .filter(v => (v.country || '').trim())
        .map(v => ({ country: v.country.trim(), expires: v.expires || null })),
    }
    try {
      const updated = await updatePersonnel(person.id, payload)
      setPerson(p => ({ ...p, ...updated }))
      setShowEdit(false)
      onUpdated?.()
    } catch (err) {
      alert(err.response?.data?.detail || t('personnel.errorDeleting') || 'Error')
    }
  }

  // --- Availability CRUD ---
  function openCreateAvail() {
    setEditingAvail(null)
    setAvailForm({ type: 'event_specific', competition_id: '', start_date: '', end_date: '', status: 'available', notes: '' })
    setShowAvailModal(true)
  }

  function openEditAvail(rec) {
    setEditingAvail(rec)
    setAvailForm({
      type: rec.type, competition_id: rec.competition_id || '',
      start_date: rec.start_date || '', end_date: rec.end_date || '',
      status: rec.status, notes: rec.notes || '',
    })
    setShowAvailModal(true)
  }

  async function handleAvailSubmit(e) {
    e.preventDefault()
    const payload = { ...availForm, personnel_id: person.id }
    if (payload.type === 'event_specific') {
      payload.start_date = null; payload.end_date = null
    } else {
      payload.competition_id = null
    }
    try {
      if (editingAvail) {
        await updateAvailability(editingAvail.id, availForm)
      } else {
        await createAvailability(payload)
      }
      setShowAvailModal(false)
      setAvailRecords(await getPersonnelAvailability(person.id))
    } catch (err) {
      alert(err.response?.data?.detail || t('availability.errorSaving'))
    }
  }

  async function handleDeleteAvail(rec) {
    if (!confirm(t('availability.confirmDelete'))) return
    try {
      await deleteAvailability(rec.id)
      setAvailRecords(await getPersonnelAvailability(person.id))
    } catch (err) {
      alert(err.response?.data?.detail || t('availability.errorDeleting'))
    }
  }

  const roleStyle = roleBadgeClass(person.role)

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full max-w-lg bg-fiba-card border-l border-fiba-border z-50 flex flex-col animate-slide-in">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-fiba-border">
          <div className="flex gap-4 min-w-0">
            {/* Avatar */}
            <div className="relative shrink-0">
              {person.photo_url ? (
                <img src={person.photo_url} alt={person.name}
                  className="w-16 h-16 rounded-full object-cover border border-fiba-border" />
              ) : (
                <div className="w-16 h-16 rounded-full bg-fiba-surface border border-fiba-border flex items-center justify-center text-lg font-bold text-fiba-muted">
                  {initials(person.name)}
                </div>
              )}
              {canEdit && (
                <>
                  <button onClick={() => fileRef.current?.click()} disabled={uploading}
                    title={person.photo_url ? t('profile.changePhoto') : t('profile.uploadPhoto')}
                    className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-fiba-accent text-white flex items-center justify-center text-xs shadow hover:opacity-90 disabled:opacity-50">
                    {uploading
                      ? <span className="animate-pulse">…</span>
                      : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden"
                    onChange={e => e.target.files[0] && handlePhoto(e.target.files[0])} />
                </>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${roleStyle}`}>{roleLabel(person.role)}</span>
                {person.country && <span className="text-xs text-fiba-muted/60">{person.country}</span>}
              </div>
              <h3 className="text-lg font-bold text-ink-900 dark:text-white truncate">{person.name}</h3>
              <p className="text-sm text-fiba-muted truncate">{person.email}</p>
              {(person.phone || person.passport) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-fiba-muted">
                  {person.phone && <span>{t('personnel.phone')}: <span className="text-ink-700 dark:text-gray-300">{person.phone}</span></span>}
                  {person.passport && <span>{t('personnel.passport')}: <span className="text-ink-700 dark:text-gray-300">{person.passport}</span></span>}
                </div>
              )}
              {canEdit && (
                <button onClick={openEdit} className="mt-2 text-fiba-accent hover:underline text-xs">{t('profile.editInfo')}</button>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-ink-900 dark:text-white shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {/* Info: languages + visas */}
          <div className="px-6 py-3 border-b border-fiba-border bg-fiba-surface/50">
            <h4 className="text-sm font-semibold text-ink-700 dark:text-gray-300">{t('profile.information')}</h4>
          </div>
          <div className="p-6 border-b border-fiba-border space-y-4">
            <div>
              <p className="text-xs text-fiba-muted mb-1.5">{t('profile.languages')}</p>
              {(person.languages && person.languages.length > 0) ? (
                <div className="flex flex-wrap gap-1.5">
                  {person.languages.map((lang, i) => (
                    <span key={i} className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-fiba-surface text-ink-700 dark:text-gray-300 border border-fiba-border">
                      {lang}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-fiba-muted/60">{t('profile.noLanguages')}</p>
              )}
            </div>
            <div>
              <p className="text-xs text-fiba-muted mb-1.5">{t('profile.visas')}</p>
              {(person.visas && person.visas.length > 0) ? (
                <div className="space-y-1.5">
                  {person.visas.map((v, i) => {
                    const st = visaStatus(v.expires)
                    return (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <span className="text-sm text-ink-900 dark:text-white">{v.country}</span>
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${VISA_STYLES[st]}`}>
                          {v.expires
                            ? `${st === 'expired' ? t('profile.expired') + ': ' : t('profile.expires') + ' '}${v.expires}`
                            : t('profile.noExpiry')}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-fiba-muted/60">{t('profile.noVisas')}</p>
              )}
            </div>
          </div>

          {/* Workload section */}
          <div className="px-6 py-3 border-b border-fiba-border bg-fiba-surface/50">
            <h4 className="text-sm font-semibold text-ink-700 dark:text-gray-300">{t('profile.workload')}</h4>
            <p className="text-xs text-fiba-muted/60">{t('profile.workloadWindow')}</p>
          </div>
          <div className="p-6 border-b border-fiba-border">
            {loading ? (
              <div className="text-center py-6 text-fiba-muted/60 text-sm">{t('common.loading')}</div>
            ) : !workload ? (
              <div className="text-center py-6 text-fiba-muted/60 text-sm">{t('profile.noWorkload')}</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="fiba-stat">
                    <p className="text-xs text-fiba-muted">{t('profile.competitions')}</p>
                    <p className="text-2xl font-bold text-ink-900 dark:text-white">{workload.totals.competitions}</p>
                  </div>
                  <div className="fiba-stat">
                    <p className="text-xs text-fiba-muted">{t('profile.gameDays')}</p>
                    <p className="text-2xl font-bold text-ink-900 dark:text-white">{workload.totals.game_days}</p>
                  </div>
                </div>
                {workload.competitions.length === 0 ? (
                  <div className="text-center py-4 text-fiba-muted/60 text-sm">{t('profile.noWorkload')}</div>
                ) : (
                  <div className="space-y-2">
                    {workload.competitions.map(c => (
                      <div key={c.nomination_id} className="border border-fiba-border rounded-lg p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ink-900 dark:text-white truncate">
                              {c.competition_name} {c.year ? <span className="text-fiba-muted/60 font-normal">({c.year})</span> : null}
                            </p>
                            <p className="text-xs text-fiba-muted">
                              {c.first_date}{c.last_date && c.last_date !== c.first_date ? ` — ${c.last_date}` : ''}
                            </p>
                          </div>
                          <span className="shrink-0 text-sm font-semibold text-fiba-accent">
                            {c.game_days > 0 ? t('profile.daysCount', { count: c.game_days }) : '—'}
                          </span>
                        </div>
                        {c.confirmation_status && (
                          <span className="inline-block mt-2 px-2 py-0.5 rounded text-xs font-medium bg-fiba-surface text-fiba-muted">
                            {t(`nominations.conf${c.confirmation_status.charAt(0).toUpperCase()}${c.confirmation_status.slice(1)}`)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Availability section */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-fiba-border bg-fiba-surface/50">
            <h4 className="text-sm font-semibold text-ink-700 dark:text-gray-300">{t('availability.tab')}</h4>
            {canEditAvail && (
              <button onClick={openCreateAvail} className="btn-fiba text-xs px-3 py-1.5">
                {t('availability.addAvailability')}
              </button>
            )}
          </div>
          <div className="p-6">
            {loading ? (
              <div className="text-center py-6 text-fiba-muted/60 text-sm">{t('common.loading')}</div>
            ) : availRecords.length === 0 ? (
              <div className="text-center py-6 text-fiba-muted/60 text-sm">{t('availability.noRecords')}</div>
            ) : (
              <div className="space-y-3">
                {availRecords.map(rec => (
                  <div key={rec.id} className="border border-fiba-border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${rec.type === 'event_specific' ? 'bg-blue-500/20 text-blue-400' : 'bg-fiba-surface text-fiba-muted'}`}>
                          {rec.type === 'event_specific' ? t('availability.eventSpecific') : t('availability.dateRange')}
                        </span>
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[rec.status]}`}>
                          {t(`availability.${rec.status}`)}
                        </span>
                      </div>
                      {canEditAvail && (
                        <div className="flex gap-2">
                          <button onClick={() => openEditAvail(rec)} className="text-fiba-accent hover:underline text-xs">{t('availability.edit')}</button>
                          <button onClick={() => handleDeleteAvail(rec)} className="text-red-400 hover:underline text-xs">{t('availability.delete')}</button>
                        </div>
                      )}
                    </div>
                    <div className="text-sm text-ink-700 dark:text-gray-300">
                      {rec.type === 'event_specific' ? (
                        <span>{rec.competition?.name || rec.competition_id}</span>
                      ) : (
                        <span>{rec.start_date} — {rec.end_date}</span>
                      )}
                    </div>
                    {rec.notes && <p className="text-xs text-fiba-muted mt-1">{rec.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit-info Modal */}
      {showEdit && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="fiba-modal max-w-md p-6 max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-4">{t('personnel.editPerson')}</h3>
            <form onSubmit={handleEditSubmit} className="space-y-3">
              <input required placeholder={t('personnel.name')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="fiba-input" />
              <input required type="email" placeholder={t('personnel.email')} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="fiba-input" />
              <select value={form.country_code}
                onChange={e => {
                  const code = e.target.value
                  setForm(f => ({ ...f, country_code: code, country: code ? countryName(code, lang) : '' }))
                }}
                className="fiba-select">
                <option value="">{t('personnel.selectCountry')}</option>
                {COUNTRIES.map(c => (
                  <option key={c.code} value={c.code}>{lang === 'en' ? c.en : c.es} ({c.code})</option>
                ))}
              </select>
              <input placeholder={t('personnel.phone')} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="fiba-input" />
              <input placeholder={t('personnel.passport')} value={form.passport} onChange={e => setForm(f => ({ ...f, passport: e.target.value }))} className="fiba-input" />
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="fiba-select">
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>

              {/* Languages */}
              <div>
                <label className="fiba-label">{t('profile.languages')}</label>
                <input placeholder={t('profile.languagesPlaceholder')} value={form.languagesText}
                  onChange={e => setForm(f => ({ ...f, languagesText: e.target.value }))} className="fiba-input" />
                <p className="text-xs text-fiba-muted/60 mt-1">{t('profile.languagesHint')}</p>
              </div>

              {/* Visas */}
              <div>
                <label className="fiba-label">{t('profile.visas')}</label>
                <div className="space-y-2">
                  {form.visas.map((v, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <input placeholder={t('personnel.country')} value={v.country}
                        onChange={e => updateVisa(idx, 'country', e.target.value)} className="fiba-input flex-1" />
                      <input type="date" value={v.expires || ''}
                        onChange={e => updateVisa(idx, 'expires', e.target.value)} className="fiba-input flex-1" />
                      <button type="button" onClick={() => removeVisa(idx)} className="text-red-400 hover:text-red-300 text-lg shrink-0">&times;</button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addVisa} className="text-fiba-accent hover:underline text-sm mt-2">
                  {t('profile.addVisa')}
                </button>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowEdit(false)} className="px-4 py-2 text-sm text-fiba-muted">{t('personnel.cancel')}</button>
                <button type="submit" className="btn-fiba">{t('personnel.save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Availability Modal */}
      {showAvailModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="fiba-modal max-w-md p-6 max-h-[85vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-4">
              {editingAvail ? t('availability.editAvailability') : t('availability.newAvailability')}
            </h3>
            <form onSubmit={handleAvailSubmit} className="space-y-3">
              <div className="flex bg-fiba-surface rounded-lg p-0.5">
                <button type="button" onClick={() => setAvailForm(f => ({ ...f, type: 'event_specific' }))}
                  className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-colors ${availForm.type === 'event_specific' ? 'bg-fiba-accent text-white' : 'text-fiba-muted'}`}>
                  {t('availability.eventSpecific')}
                </button>
                <button type="button" onClick={() => setAvailForm(f => ({ ...f, type: 'date_range' }))}
                  className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-colors ${availForm.type === 'date_range' ? 'bg-fiba-accent text-white' : 'text-fiba-muted'}`}>
                  {t('availability.dateRange')}
                </button>
              </div>

              {availForm.type === 'event_specific' ? (
                <select required value={availForm.competition_id} onChange={e => setAvailForm(f => ({ ...f, competition_id: e.target.value }))}
                  className="fiba-select">
                  <option value="">{t('availability.selectCompetition')}</option>
                  {competitions
                    .slice()
                    .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
                    .map(c => <option key={c.id} value={c.id}>{c.name} {c.year ? `(${c.year})` : ''}</option>)}
                </select>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="fiba-label">{t('availability.startDate')}</label>
                    <input required type="date" value={availForm.start_date}
                      onChange={e => setAvailForm(f => ({ ...f, start_date: e.target.value }))} className="fiba-input" />
                  </div>
                  <div>
                    <label className="fiba-label">{t('availability.endDate')}</label>
                    <input required type="date" value={availForm.end_date}
                      onChange={e => setAvailForm(f => ({ ...f, end_date: e.target.value }))} className="fiba-input" />
                  </div>
                </div>
              )}

              <div>
                <label className="fiba-label">{t('availability.status')}</label>
                <select value={availForm.status} onChange={e => setAvailForm(f => ({ ...f, status: e.target.value }))} className="fiba-select">
                  <option value="available">{t('availability.available')}</option>
                  <option value="unavailable">{t('availability.unavailable')}</option>
                  <option value="restricted">{t('availability.restricted')}</option>
                </select>
              </div>

              <textarea placeholder={t('availability.notesPlaceholder')} value={availForm.notes}
                onChange={e => setAvailForm(f => ({ ...f, notes: e.target.value }))} className="fiba-input" rows={2} />

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowAvailModal(false)} className="px-4 py-2 text-sm text-fiba-muted">{t('availability.cancel')}</button>
                <button type="submit" className="btn-fiba">{t('availability.save')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .animate-slide-in { animation: slideIn 0.25s ease-out; }
      `}</style>
    </>
  )
}
