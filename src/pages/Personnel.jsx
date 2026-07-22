import { useState, useEffect, useMemo, useRef } from 'react'
import { getPersonnel, createPersonnel, updatePersonnel, deletePersonnel, importPersonnel } from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'
import PersonProfilePanel from '../components/PersonProfilePanel'
import { ROLES, roleLabel, roleBadgeClass } from '../lib/roles'
import { COUNTRIES, countryName, countryNameToCode } from '../lib/countries'

function compareValues(a, b, dir) {
  const av = (a ?? '').toString().toLowerCase()
  const bv = (b ?? '').toString().toLowerCase()
  const cmp = av.localeCompare(bv, undefined, { numeric: true })
  return dir === 'asc' ? cmp : -cmp
}

export default function Personnel() {
  const { t, lang } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('personnel')
  const canEditAvail = hasEdit('availability')
  const [people, setPeople] = useState([])
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [sort, setSort] = useState({ key: null, dir: 'asc' })
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', country: '', country_code: '', phone: '', passport: '', role: 'VGO' })

  // Profile panel — the shared PersonProfilePanel owns its own data/modals
  const [profilePerson, setProfilePerson] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    const data = await getPersonnel()
    setPeople(data)
  }

  const stats = useMemo(() => ({
    total: people.length,
    vgo: people.filter(p => p.role === 'VGO').length,
    td: people.filter(p => p.role === 'TD').length,
    referees: people.filter(p => p.role === 'REF' || p.role === 'REF_INSTRUCTOR').length,
    countries: new Set(people.map(p => p.country).filter(Boolean)).size,
  }), [people])

  const filtered = useMemo(() => {
    const rows = people.filter(p => {
      if (roleFilter && p.role !== roleFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
      }
      return true
    })
    if (!sort.key) return rows
    const accessors = {
      name: p => p.name,
      role: p => p.role,
      country: p => p.country,
      email: p => p.email,
    }
    const get = accessors[sort.key]
    return [...rows].sort((a, b) => compareValues(get(a), get(b), sort.dir))
  }, [people, search, roleFilter, sort])

  function toggleSort(key) {
    setSort(s => s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' })
  }

  function SortHeader({ label, sortKey }) {
    const active = sort.key === sortKey
    return (
      <th onClick={() => toggleSort(sortKey)}
        className="cursor-pointer select-none hover:text-ink-900 dark:hover:text-white"
        title={t('common.sort') || 'Sort'}>
        <span className="inline-flex items-center gap-1">
          {label}
          <span className={`text-fiba-accent transition-opacity ${active ? 'opacity-100' : 'opacity-0'}`}>
            {sort.dir === 'asc' ? '▲' : '▼'}
          </span>
        </span>
      </th>
    )
  }

  function openEdit(person) {
    setEditing(person)
    setForm({
      name: person.name, email: person.email,
      country: person.country || '',
      // Legacy rows have free-text country only — map it to a code when possible
      country_code: person.country_code || countryNameToCode(person.country) || '',
      phone: person.phone || '', passport: person.passport || '', role: person.role,
    })
    setShowModal(true)
  }

  function openCreate() {
    setEditing(null)
    setForm({ name: '', email: '', country: '', country_code: '', phone: '', passport: '', role: 'VGO' })
    setShowModal(true)
  }

  function handleCountryChange(code) {
    // Keep the legacy display field in sync with the selected code
    setForm(f => ({ ...f, country_code: code, country: code ? countryName(code, lang) : '' }))
  }

  async function handleDelete(person) {
    if (!confirm(t('personnel.confirmDelete', { name: person.name }))) return
    try {
      await deletePersonnel(person.id)
      if (profilePerson?.id === person.id) setProfilePerson(null)
      await load()
    } catch (err) {
      if (err.response?.status === 409) {
        if (confirm(t('personnel.confirmForceDelete', { detail: err.response.data.detail }))) {
          await deletePersonnel(person.id, true)
          if (profilePerson?.id === person.id) setProfilePerson(null)
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

  function openProfile(person) {
    setProfilePerson(person)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-ink-900 dark:text-white">{t('personnel.title')}</h2>
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {[
          { label: t('personnel.total'), value: stats.total },
          { label: 'VGOs', value: stats.vgo },
          { label: 'TDs', value: stats.td },
          { label: t('personnel.referees'), value: stats.referees },
          { label: t('personnel.countries'), value: stats.countries },
        ].map(s => (
          <div key={s.label} className="fiba-stat">
            <p className="text-xs text-fiba-muted">{s.label}</p>
            <p className="text-2xl font-bold text-ink-900 dark:text-white">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-3 mb-4">
        <input type="text" placeholder={t('personnel.search')} value={search} onChange={e => setSearch(e.target.value)}
          className="fiba-input w-full sm:w-80" />
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="fiba-select">
          <option value="">{t('personnel.allRoles')}</option>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
        <table className="fiba-table">
          <thead>
            <tr>
              <SortHeader label={t('personnel.name')} sortKey="name" />
              <SortHeader label={t('personnel.role')} sortKey="role" />
              <SortHeader label={t('personnel.country')} sortKey="country" />
              <SortHeader label={t('personnel.email')} sortKey="email" />
              <th>{t('personnel.passport')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => (
              <tr key={p.id} className={profilePerson?.id === p.id ? 'bg-fiba-accent/10' : ''}>
                <td className="px-4 py-3 font-medium">
                  <button onClick={() => openProfile(p)}
                    className="text-left text-fiba-accent hover:underline font-medium">
                    {p.name}
                  </button>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${roleBadgeClass(p.role)}`}>{roleLabel(p.role)}</span>
                </td>
                <td className="px-4 py-3">{p.country_code ? `${countryName(p.country_code, lang)} (${p.country_code})` : (p.country || '—')}</td>
                <td className="px-4 py-3">{p.email}</td>
                <td className="px-4 py-3">{p.passport || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    <button onClick={() => openProfile(p)} className="text-emerald-400 hover:underline text-sm">{t('profile.view')}</button>
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
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-4">{editing ? t('personnel.editPerson') : t('personnel.addPersonTitle')}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input required placeholder={t('personnel.name')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="fiba-input" />
              <input required type="email" placeholder={t('personnel.email')} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="fiba-input" />
              <div>
                <select value={form.country_code} onChange={e => handleCountryChange(e.target.value)} className="fiba-select">
                  <option value="">{t('personnel.selectCountry')}</option>
                  {COUNTRIES.map(c => (
                    <option key={c.code} value={c.code}>{lang === 'en' ? c.en : c.es} ({c.code})</option>
                  ))}
                </select>
                {/* Legacy free-text country that didn't map to a code — kept until a code is picked */}
                {!form.country_code && form.country && (
                  <p className="text-xs text-fiba-muted/60 mt-1">{t('personnel.unmappedCountry', { country: form.country })}</p>
                )}
              </div>
              <input placeholder={t('personnel.phone')} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="fiba-input" />
              <input placeholder={t('personnel.passport')} value={form.passport} onChange={e => setForm(f => ({ ...f, passport: e.target.value }))} className="fiba-input" />
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="fiba-select">
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
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

      {/* Profile Side Panel (shared component) */}
      {profilePerson && (
        <PersonProfilePanel
          person={profilePerson}
          onClose={() => setProfilePerson(null)}
          onUpdated={load}
          canEdit={canEdit}
          canEditAvail={canEditAvail}
        />
      )}

      {/* Import View */}
      {showImport && <ImportView onClose={() => { setShowImport(false); load() }} />}
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
  const [importError, setImportError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef(null)

  function handleFile(f) {
    setImportError('')
    setFile(f)
    setTab('preview')
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  async function handleImport() {
    if (!file) {
      setImportError(t('personnel.uploadFirst'))
      return
    }
    setLoading(true)
    setImportError('')
    try {
      const res = await importPersonnel(file)
      setResult(res)
      setTab('result')
    } catch (err) {
      const detail = err.response?.data?.detail
      const status = err.response?.status
      let msg = detail || err.message || 'Import failed'
      if (status) msg = `[${status}] ${msg}`
      setImportError(msg)
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
          <h3 className="text-lg font-bold text-ink-900 dark:text-white">{t('personnel.importTitle')}</h3>
          <button onClick={onClose} className="text-fiba-muted hover:text-ink-900 dark:text-white text-xl">&times;</button>
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
              <h4 className="text-sm font-medium text-ink-700 dark:text-gray-300 mb-2">{t('personnel.columnFormat')}</h4>
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
                    [t('personnel.role'), t('personnel.yes'), 'VGO / TD / REF / REF_INSTRUCTOR'],
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
                <p className="text-sm text-fiba-muted mb-4">{t('personnel.file')}: <strong className="text-ink-900 dark:text-white">{file.name}</strong> ({(file.size / 1024).toFixed(1)} KB)</p>
                {importError && (
                  <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded text-sm">
                    {importError}
                  </div>
                )}
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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
                <h4 className="text-sm font-medium text-ink-700 dark:text-gray-300 mb-2">{t('personnel.errorDetail')}</h4>
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
