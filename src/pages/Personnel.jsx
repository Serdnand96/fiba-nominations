import { useState, useEffect, useMemo, useRef } from 'react'
import { getPersonnel, createPersonnel, updatePersonnel, deletePersonnel, importPersonnel } from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'

export default function Personnel() {
  const { t } = useLanguage()
  const [people, setPeople] = useState([])
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [showImport, setShowImport] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', country: '', phone: '', passport: '', role: 'VGO' })

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
      await load()
    } catch (err) {
      if (err.response?.status === 409) {
        if (confirm(t('personnel.confirmForceDelete', { detail: err.response.data.detail }))) {
          await deletePersonnel(person.id, true)
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">{t('personnel.title')}</h2>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
            {t('personnel.importCsv')}
          </button>
          <button onClick={openCreate} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            {t('personnel.addPerson')}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: t('personnel.total'), value: stats.total },
          { label: 'VGOs', value: stats.vgo },
          { label: 'TDs', value: stats.td },
          { label: t('personnel.countries'), value: stats.countries },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-lg border p-4">
            <p className="text-sm text-gray-500">{s.label}</p>
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input type="text" placeholder={t('personnel.search')} value={search} onChange={e => setSearch(e.target.value)}
          className="w-80 px-4 py-2 border rounded-lg text-sm" />
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
          <option value="">{t('personnel.allRoles')}</option>
          <option value="VGO">VGO</option>
          <option value="TD">TD</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{t('personnel.name')}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{t('personnel.role')}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{t('personnel.country')}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{t('personnel.email')}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{t('personnel.passport')}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map(p => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${p.role === 'VGO' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>{p.role}</span>
                </td>
                <td className="px-4 py-3">{p.country || '—'}</td>
                <td className="px-4 py-3">{p.email}</td>
                <td className="px-4 py-3">{p.passport || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-3">
                    <button onClick={() => openEdit(p)} className="text-blue-600 hover:underline text-sm">{t('personnel.edit')}</button>
                    <button onClick={() => handleDelete(p)} className="text-red-600 hover:underline text-sm">{t('personnel.delete')}</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">{t('personnel.noPersonnel')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Person Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-bold mb-4">{editing ? t('personnel.editPerson') : t('personnel.addPersonTitle')}</h3>
            <form onSubmit={handleSubmit} className="space-y-3">
              <input required placeholder={t('personnel.name')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm" />
              <input required type="email" placeholder={t('personnel.email')} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm" />
              <input placeholder={t('personnel.country')} value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm" />
              <input placeholder={t('personnel.phone')} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm" />
              <input placeholder={t('personnel.passport')} value={form.passport} onChange={e => setForm(f => ({ ...f, passport: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm" />
              <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="VGO">VGO</option>
                <option value="TD">TD</option>
              </select>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600">{t('personnel.cancel')}</button>
                <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
                  {editing ? t('personnel.save') : t('personnel.add')}
                </button>
              </div>
            </form>
          </div>
        </div>
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
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center pt-16 z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">{t('personnel.importTitle')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        <div className="flex border-b mb-4">
          {tabs.map(tb => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === tb.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`}>
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
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-colors ${dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}`}
            >
              <p className="text-gray-500 text-sm">{t('personnel.dropzone')}</p>
              <p className="text-gray-400 text-xs mt-1">{t('personnel.dropzoneHint')}</p>
              <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                onChange={e => e.target.files[0] && handleFile(e.target.files[0])} />
            </div>

            <div className="mt-6">
              <h4 className="text-sm font-medium text-gray-700 mb-2">{t('personnel.columnFormat')}</h4>
              <table className="w-full text-xs border rounded">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2">{t('personnel.column')}</th>
                    <th className="text-left px-3 py-2">{t('personnel.required')}</th>
                    <th className="text-left px-3 py-2">{t('personnel.validValues')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[
                    [t('personnel.name'), t('personnel.yes'), t('personnel.freeText')],
                    [t('personnel.email'), t('personnel.yes'), t('personnel.validEmail')],
                    [t('personnel.country'), t('personnel.no'), t('personnel.freeText')],
                    [t('personnel.phone'), t('personnel.no'), t('personnel.freeText')],
                    [t('personnel.passport'), t('personnel.no'), t('personnel.freeText')],
                    [t('personnel.role'), t('personnel.yes'), 'VGO / TD'],
                  ].map(([col, req, vals]) => (
                    <tr key={col}>
                      <td className="px-3 py-1.5">{col}</td>
                      <td className="px-3 py-1.5">{req}</td>
                      <td className="px-3 py-1.5">{vals}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button onClick={downloadTemplate} className="mt-4 text-blue-600 hover:underline text-sm">
              {t('personnel.downloadTemplate')}
            </button>
          </div>
        )}

        {tab === 'preview' && (
          <div>
            {file ? (
              <>
                <p className="text-sm text-gray-600 mb-4">{t('personnel.file')}: <strong>{file.name}</strong> ({(file.size / 1024).toFixed(1)} KB)</p>
                <div className="flex justify-end">
                  <button onClick={handleImport} disabled={loading}
                    className="bg-blue-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                    {loading ? t('personnel.importing') : t('personnel.confirmImport')}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-gray-400 text-sm">{t('personnel.uploadFirst')}</p>
            )}
          </div>
        )}

        {tab === 'result' && result && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-700">{result.imported}</p>
                <p className="text-xs text-green-600">{t('personnel.imported')}</p>
              </div>
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-yellow-700">{result.skipped}</p>
                <p className="text-xs text-yellow-600">{t('personnel.skipped')}</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-red-700">{result.errors.length}</p>
                <p className="text-xs text-red-600">{t('personnel.errors')}</p>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-gray-700 mb-2">{t('personnel.errorDetail')}</h4>
                <div className="max-h-40 overflow-y-auto border rounded">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-1.5">{t('personnel.row')}</th>
                        <th className="text-left px-3 py-1.5">{t('personnel.email')}</th>
                        <th className="text-left px-3 py-1.5">{t('personnel.reason')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {result.errors.map((err, i) => (
                        <tr key={i}>
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
