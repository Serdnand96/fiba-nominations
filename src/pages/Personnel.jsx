import { useState, useEffect, useMemo, useRef } from 'react'
import { getPersonnel, createPersonnel, updatePersonnel, deletePersonnel, importPersonnel,
  getPersonnelAvailability, getCompetitions, createAvailability, updateAvailability, deleteAvailability } from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'

const STATUS_STYLES = {
  available: 'bg-emerald-500/20 text-emerald-400',
  unavailable: 'bg-red-500/20 text-red-400',
  restricted: 'bg-yellow-500/20 text-yellow-400',
}

export default function Personnel() {
  const { t } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('personnel')
  const canEditAvail = hasEdit('availability')
  const [people, setPeople] = useState([])
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', country: '', phone: '', passport: '', role: 'VGO' })

  // Availability panel
  const [availPerson, setAvailPerson] = useState(null)
  const [availRecords, setAvailRecords] = useState([])
  const [availLoading, setAvailLoading] = useState(false)
  const [competitions, setCompetitions] = useState([])
  const [showAvailModal, setShowAvailModal] = useState(false)
  const [editingAvail, setEditingAvail] = useState(null)
  const [availForm, setAvailForm] = useState({
    type: 'event_specific', competition_id: '', start_date: '', end_date: '',
    status: 'available', notes: '',
  })

  useEffect(() => { load() }, [])

  async function load() {
    const data = await getPersonnel()
    setPeople(data)
  }

  const stats = useMemo(() => ({
    total: people.length,
    vgo: people.filter(p => p.role === 'VGO').length,
    td: people.filter(p => p.role === 'TD').length,
    countries: new Set(people.map(p => p.country).filter(Boolean)).size,
  }), [people])

  const filtered = useMemo(() => {
    return people.filter(p => {
      if (roleFilter && p.role !== roleFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
      }
      return true
    })
  }, [people, search, roleFilter])

  function openEdit(person) {
    setEditing(person)
    setForm({ name: person.name, email: person.email, country: person.country || '', phone: person.phone || '', passport: person.passport || '', role: person.role })
    setShowModal(true)
  }

  function openCreate() {
    setEditing(null)
    setForm({ name: '', email: '', country: '', phone: '', passport: '', role: 'VGO' })
    setShowModal(true)
  }

  async function handleDelete(person) {
    if (!confirm(t('personnel.confirmDelete', { name: person.name }))) return
    try {
      await deletePersonnel(person.id)
      if (availPerson?.id === person.id) setAvailPerson(null)
      await load()
    } catch (err) {
      if (err.response?.status === 409) {
        if (confirm(t('personnel.confirmForceDelete', { detail: err.response.data.detail }))) {
          await deletePersonnel(person.id, true)
          if (availPerson?.id === person.id) setAvailPerson(null)
          await load()
        }
      } else {
        alert(err.response?.data?.detail || t('personnel.errorDeleting'))
      }
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (editing) {
      await updatePersonnel(editing.id, form)
    } else {
      await createPersonnel(form)
    }
    setShowModal(false)
    await load()
  }

  // --- Availability panel ---
  async function openAvailPanel(person) {
    setAvailPerson(person)
    setAvailLoading(true)
    try {
      const [records, comps] = await Promise.all([
        getPersonnelAvailability(person.id),
        competitions.length ? Promise.resolve(competitions) : getCompetitions(),
      ])
      setAvailRecords(records)
      if (!competitions.length) setCompetitions(comps)
    } catch { setAvailRecords([]) }
    setAvailLoading(false)
  }

  function openCreateAvail() {
    setEditingAvail(null)
    setAvailForm({ type: 'event_specific', competition_id: '', start_date: '', end_date: '', status: 'available', notes: '' })
    setShowAvailModal(true)
  }

  function openEditAvail(rec) {
    setEditingAvail(rec)
    setAvailForm({
      type: rec.type,
      competition_id: rec.competition_id || '',
      start_date: rec.start_date || '',
      end_date: rec.end_date || '',
      status: rec.status,
      notes: rec.notes || '',
    })
    setShowAvailModal(true)
  }

  async function handleAvailSubmit(e) {
    e.preventDefault()
    const payload = { ...availForm, personnel_id: availPerson.id }
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
      const records = await getPersonnelAvailability(availPerson.id)
      setAvailRecords(records)
    } catch (err) {
      alert(err.response?.data?.detail || t('availability.errorSaving'))
    }
  }

  async function handleDeleteAvail(rec) {
    if (!confirm(t('availability.confirmDelete'))) return
    try {
      await deleteAvailability(rec.id)
      const records = await getPersonnelAvailability(availPerson.id)
      setAvailRecords(records)
    } catch (err) {
      alert(err.response?.data?.detail || t('availability.errorDeleting'))
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">{t('personnel.title')}</h2>
        {canEdit && (
          <div className="flex gap-2">
            <button onClick={() => setShowImport(true)} className="btn-fiba-ghost">
              {t('personnel.importCsv')}
            </button>
            <button onClick={openCreate} className="btn-fiba">
              {t('personnel.addPerson')}
            </button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: t('personnel.total'), value: stats.total },
          { label: 'VGOs', value: stats.vgo },
          { label: 'TDs', value: stats.td },
          { label: t('personnel.countries'), value: stats.countries },
        ].map(s => (
          <div key={s.label} className="fiba-stat">
            <p className="text-xs text-fiba-muted">{s.label}</p>
            <p className="text-2xl font-bold text-white">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input type="text" placeholder={t('personnel.search')} value={search} onChange={e => setSearch(e.target.value)}
          className="fiba-input w-80" />
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="fiba-select">
          <option value="">{t('personnel.allRoles')}</option>
          <option value="VGO">VGO</option>
          <option value="TD">TD</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
        <table className="fiba-table">
          <thead>
            <tr>
              <th>{t('personnel.name')}</th>
              <th>{t('personnel.role')}</th>
              <th>{t('personnel.country')}</th>
              <th>{t('personnel.email')}</th>
              <th>{t('personnel.passport')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id} className={availPerson?.id === p.id ? 'bg-fiba-accent/10' : ''}>
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${p.role === 'VGO' ? 'bg-purple-500/20 text-purple-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{p.role}</span>
                </td>
                <td className="px-4 py-3">{p.country || '—'}</td>
                <td className="px-4 py-3">{p.email}</td>
                <td className="px-4 py-3">{p.passport || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    {p.role === 'TD' && (
                      <button onClick={() => openAvailPanel(p)} className="text-emerald-400 hover:underline text-sm">{t('availability.tab')}</button>
                    )}
                    {canEdit && (
                      <>
                        <button onClick={() => openEdit(p)} className="text-fiba-accent hover:underline text-sm">{t('personnel.edit')}</button>
                        <button onClick={() => handleDelete(p)} className="text-red-400 hover:underline text-sm">{t('personnel.delete')}</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-fiba-muted/60">{t('personnel.noPersonnel')}</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Person Modal */}
      {showModal && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-md p-6">
            <h3 className="text-lg font-bold text-white mb-4">{editing ? t('personnel.editPerson') : t('personnel.addPersonTitle')}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input required placeholder={t('personnel.name')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="fiba-input" />
              <input required type="email" placeholder={t('personnel.email')} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="fiba-input" />
              <input placeholder={t('personnel.country')} value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} className="fiba-input" />
              <input placeholder={t('personnel.phone')} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="fiba-input" />
              <input placeholder={t('personnel.passport')} value={form.passport} onChange={e => setForm(f => ({ ...f, passport: e.target.value }))} className="fiba-input" />
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="fiba-select">
                <option value="VGO">VGO</option>
                <option value="TD">TD</option>
              </select>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-fiba-muted">{t('personnel.cancel')}</button>
                <button type="submit" className="btn-fiba">
                  {editing ? t('personnel.save') : t('personnel.add')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Availability Side Panel */}
      {availPerson && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setAvailPerson(null)} />
          <div className="fixed top-0 right-0 h-full w-full max-w-lg bg-fiba-card border-l border-fiba-border z-50 flex flex-col animate-slide-in">
            <div className="flex items-start justify-between p-6 border-b border-fiba-border">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-400">TD</span>
                  {availPerson.country && <span className="text-xs text-fiba-muted/60">{availPerson.country}</span>}
                </div>
                <h3 className="text-lg font-bold text-white">{availPerson.name}</h3>
                <p className="text-sm text-fiba-muted">{availPerson.email}</p>
              </div>
              <button onClick={() => setAvailPerson(null)} className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-white">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex items-center justify-between px-6 py-3 border-b border-fiba-border bg-fiba-surface/50">
              <h4 className="text-sm font-semibold text-gray-300">{t('availability.tab')}</h4>
              {canEditAvail && (
                <button onClick={openCreateAvail} className="btn-fiba text-xs px-3 py-1.5">
                  {t('availability.addAvailability')}
                </button>
              )}
            </div>

            <div className="flex-1 overflow-auto p-6">
              {availLoading ? (
                <div className="text-center py-8 text-fiba-muted/60 text-sm">{t('common.loading')}</div>
              ) : availRecords.length === 0 ? (
                <div className="text-center py-8 text-fiba-muted/60 text-sm">{t('availability.noRecords')}</div>
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
                      <div className="text-sm text-gray-300">
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
        </>
      )}

      {/* Availability Modal */}
      {showAvailModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]">
          <div className="fiba-modal max-w-md p-6">
            <h3 className="text-lg font-bold text-white mb-4">
              {editingAvail ? t('availability.editAvailability') : t('availability.newAvailability')}
            </h3>
            <form onSubmit={handleAvailSubmit} className="space-y-3">
              {/* Type toggle */}
              <div className="flex bg-fiba-surface rounded-lg p-0.5">
                <button type="button" onClick={() => setAvailForm(f => ({ ...f, type: 'event_specific' }))}
                  className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-colors ${availForm.type === 'event_specific' ? 'bg-fiba-accent text-fiba-dark' : 'text-fiba-muted'}`}>
                  {t('availability.eventSpecific')}
                </button>
                <button type="button" onClick={() => setAvailForm(f => ({ ...f, type: 'date_range' }))}
                  className={`flex-1 px-3 py-2 rounded-md text-xs font-medium transition-colors ${availForm.type === 'date_range' ? 'bg-fiba-accent text-fiba-dark' : 'text-fiba-muted'}`}>
                  {t('availability.dateRange')}
                </button>
              </div>

              {/* Conditional fields */}
              {availForm.type === 'event_specific' ? (
                <select required value={availForm.competition_id} onChange={e => setAvailForm(f => ({ ...f, competition_id: e.target.value }))}
                  className="fiba-select">
                  <option value="">{t('availability.selectCompetition')}</option>
                  {competitions
                    .sort((a, b) => (a.start_date || '').localeCompare(b.start_date || ''))
                    .map(c => <option key={c.id} value={c.id}>{c.name} {c.year ? `(${c.year})` : ''}</option>)}
                </select>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="fiba-label">{t('availability.startDate')}</label>
                    <input required type="date" value={availForm.start_date}
                      onChange={e => setAvailForm(f => ({ ...f, start_date: e.target.value }))}
                      className="fiba-input" />
                  </div>
                  <div>
                    <label className="fiba-label">{t('availability.endDate')}</label>
                    <input required type="date" value={availForm.end_date}
                      onChange={e => setAvailForm(f => ({ ...f, end_date: e.target.value }))}
                      className="fiba-input" />
                  </div>
                </div>
              )}

              {/* Status */}
              <div>
                <label className="fiba-label">{t('availability.status')}</label>
                <select value={availForm.status} onChange={e => setAvailForm(f => ({ ...f, status: e.target.value }))}
                  className="fiba-select">
                  <option value="available">{t('availability.available')}</option>
                  <option value="unavailable">{t('availability.unavailable')}</option>
                  <option value="restricted">{t('availability.restricted')}</option>
                </select>
              </div>

              {/* Notes */}
              <textarea placeholder={t('availability.notesPlaceholder')} value={availForm.notes}
                onChange={e => setAvailForm(f => ({ ...f, notes: e.target.value }))}
                className="fiba-input" rows={2} />

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowAvailModal(false)} className="px-4 py-2 text-sm text-fiba-muted">{t('availability.cancel')}</button>
                <button type="submit" className="btn-fiba">
                  {t('availability.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import View */}
      {showImport && <ImportView onClose={() => { setShowImport(false); load() }} />}

      <style>{`
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .animate-slide-in { animation: slideIn 0.25s ease-out; }
      `}</style>
    </div>
  )
}

function ImportView({ onClose }) {
  const { t } = useLanguage()
  const [tab, setTab] = useState('upload')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  function handleFile(f) {
    setFile(f)
    const reader = new FileReader()
    reader.onload = () => { setTab('preview') }
    reader.readAsArrayBuffer(f)
    setTab('preview')
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  async function handleImport() {
    setLoading(true)
    try {
      const res = await importPersonnel(file)
      setResult(res)
      setTab('result')
    } finally {
      setLoading(false)
    }
  }

  function downloadTemplate() {
    const csv = `${t('personnel.name')},${t('personnel.email')},${t('personnel.country')},${t('personnel.phone')},${t('personnel.passport')},${t('personnel.role')}\n`
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'plantilla_personal.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const tabs = [
    { key: 'upload', label: t('personnel.uploadFile') },
    { key: 'preview', label: t('personnel.preview') },
    { key: 'result', label: t('personnel.result') },
  ]

  return (
    <div className="fixed inset-0 bg-black/60 flex items-start justify-center pt-16 z-50">
      <div className="fiba-modal max-w-2xl p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-white">{t('personnel.importTitle')}</h3>
          <button onClick={onClose} className="text-fiba-muted hover:text-white text-xl">&times;</button>
        </div>

        <div className="flex border-b border-fiba-border mb-4">
          {tabs.map(tb => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === tb.key ? 'border-fiba-accent text-fiba-accent' : 'border-transparent text-fiba-muted'}`}>
              {tb.label}
            </button>
          ))}
        </div>

        {tab === 'upload' && (
          <div>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${dragOver ? 'border-fiba-accent bg-fiba-accent/5' : 'border-fiba-border hover:border-fiba-muted'}`}
            >
              <p className="text-fiba-muted text-sm">{t('personnel.dropzone')}</p>
              <p className="text-fiba-muted/60 text-xs mt-1">{t('personnel.dropzoneHint')}</p>
              <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
            </div>

            <div className="mt-6">
              <h4 className="text-sm font-medium text-gray-300 mb-2">{t('personnel.columnFormat')}</h4>
              <table className="w-full text-xs border border-fiba-border rounded">
                <thead className="bg-fiba-surface">
                  <tr>
                    <th className="text-left px-3 py-2">{t('personnel.column')}</th>
                    <th className="text-left px-3 py-2">{t('personnel.required')}</th>
                    <th className="text-left px-3 py-2">{t('personnel.validValues')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    [t('personnel.name'), t('personnel.yes'), t('personnel.freeText')],
                    [t('personnel.email'), t('personnel.yes'), t('personnel.validEmail')],
                    [t('personnel.country'), t('personnel.no'), t('personnel.freeText')],
                    [t('personnel.phone'), t('personnel.no'), t('personnel.freeText')],
                    [t('personnel.passport'), t('personnel.no'), t('personnel.freeText')],
                    [t('personnel.role'), t('personnel.yes'), 'VGO / TD'],
                  ].map(([col, req, vals]) => (
                    <tr key={col} className="border-t border-fiba-border">
                      <td className="px-3 py-1.5">{col}</td>
                      <td className="px-3 py-1.5">{req}</td>
                      <td className="px-3 py-1.5">{vals}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button onClick={downloadTemplate} className="mt-4 text-fiba-accent hover:underline text-sm">
              {t('personnel.downloadTemplate')}
            </button>
          </div>
        )}

        {tab === 'preview' && (
          <div>
            {file ? (
              <>
                <p className="text-sm text-fiba-muted mb-4">{t('personnel.file')}: <strong className="text-white">{file.name}</strong> ({(file.size / 1024).toFixed(1)} KB)</p>
                <div className="flex justify-end">
                  <button onClick={handleImport} disabled={loading}
                    className="btn-fiba disabled:opacity-50">
                    {loading ? t('personnel.importing') : t('personnel.confirmImport')}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-fiba-muted/60 text-sm">{t('personnel.uploadFirst')}</p>
            )}
          </div>
        )}

        {tab === 'result' && result && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-emerald-400">{result.imported}</p>
                <p className="text-xs text-emerald-400">{t('personnel.imported')}</p>
              </div>
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-yellow-400">{result.skipped}</p>
                <p className="text-xs text-yellow-400">{t('personnel.skipped')}</p>
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-red-400">{result.errors.length}</p>
                <p className="text-xs text-red-400">{t('personnel.errors')}</p>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-2">{t('personnel.errorDetail')}</h4>
                <div className="max-h-40 overflow-y-auto border border-fiba-border rounded">
                  <table className="w-full text-xs">
                    <thead className="bg-fiba-surface sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-1.5">{t('personnel.row')}</th>
                        <th className="text-left px-3 py-1.5">{t('personnel.email')}</th>
                        <th className="text-left px-3 py-1.5">{t('personnel.reason')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.errors.map((err, i) => (
                        <tr key={i} className="border-t border-fiba-border">
                          <td className="px-3 py-1.5">{err.row}</td>
                          <td className="px-3 py-1.5">{err.email}</td>
                          <td className="px-3 py-1.5">{err.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
