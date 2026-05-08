import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getAssets, createAsset, updateAsset, retireAsset,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'

const STATUS_BADGES = {
  available:   'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40',
  in_use:      'bg-blue-500/20 text-blue-400 border border-blue-500/40',
  maintenance: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40',
  retired:     'bg-gray-500/20 text-gray-400 border border-gray-500/40',
}

const EMPTY_FORM = {
  name: '', serial_number: '', category: '', brand: '', model: '',
  status: 'available', location: '', purchase_date: '', notes: '',
}

export default function Assets() {
  const { t } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('assets')

  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      setAssets(await getAssets())
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    return assets.filter(a => {
      if (statusFilter && a.status !== statusFilter) return false
      if (categoryFilter && a.category !== categoryFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return (a.name || '').toLowerCase().includes(q)
          || (a.serial_number || '').toLowerCase().includes(q)
          || (a.brand || '').toLowerCase().includes(q)
      }
      return true
    })
  }, [assets, search, statusFilter, categoryFilter])

  const categoryOptions = useMemo(() =>
    [...new Set(assets.map(a => a.category).filter(Boolean))].sort(),
    [assets])

  const stats = useMemo(() => ({
    total: assets.length,
    available: assets.filter(a => a.status === 'available').length,
    in_use: assets.filter(a => a.status === 'in_use').length,
    maintenance: assets.filter(a => a.status === 'maintenance').length,
  }), [assets])

  function openNew() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  function openEdit(asset) {
    setEditing(asset)
    setForm({
      name: asset.name || '',
      serial_number: asset.serial_number || '',
      category: asset.category || '',
      brand: asset.brand || '',
      model: asset.model || '',
      status: asset.status || 'available',
      location: asset.location || '',
      purchase_date: asset.purchase_date || '',
      notes: asset.notes || '',
    })
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = { ...form }
      // Don't send empty strings for optional fields
      Object.keys(payload).forEach(k => {
        if (payload[k] === '') payload[k] = null
      })
      if (editing) {
        await updateAsset(editing.id, payload)
      } else {
        await createAsset(payload)
      }
      setShowForm(false)
      await load()
    } catch (err) {
      alert(err.response?.data?.detail || err.message)
    }
    setSaving(false)
  }

  async function handleRetire(asset) {
    if (!confirm(`${t('assets.confirmRetire')} "${asset.name}"?`)) return
    try {
      await retireAsset(asset.id)
      await load()
    } catch (err) {
      alert(err.response?.data?.detail || err.message)
    }
  }

  if (loading) return <div className="text-fiba-muted text-sm">{t('common.loading')}</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">{t('assets.title')}</h2>
        {canEdit && (
          <button onClick={openNew} className="btn-fiba">{t('assets.newAsset')}</button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: t('assets.total'), value: stats.total },
          { label: t('assets.available'), value: stats.available, color: 'text-emerald-400' },
          { label: t('assets.inUse'), value: stats.in_use, color: 'text-blue-400' },
          { label: t('assets.maintenance'), value: stats.maintenance, color: 'text-yellow-400' },
        ].map(s => (
          <div key={s.label} className="fiba-stat">
            <p className="text-xs text-fiba-muted">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color || 'text-white'}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input type="text" placeholder={t('assets.searchPlaceholder')} value={search}
          onChange={e => setSearch(e.target.value)}
          className="fiba-input w-full md:w-80" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="fiba-select !w-auto min-w-[160px] flex-shrink-0">
          <option value="">{t('assets.allStatuses')}</option>
          <option value="available">{t('assets.available')}</option>
          <option value="in_use">{t('assets.inUse')}</option>
          <option value="maintenance">{t('assets.maintenance')}</option>
          <option value="retired">{t('assets.retired')}</option>
        </select>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
          className="fiba-select !w-auto min-w-[160px] flex-shrink-0">
          <option value="">{t('assets.allCategories')}</option>
          {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <table className="fiba-table">
          <thead>
            <tr>
              <th>{t('assets.name')}</th>
              <th>{t('assets.serial')}</th>
              <th>{t('assets.category')}</th>
              <th>{t('assets.location')}</th>
              <th>{t('assets.status')}</th>
              <th>{t('assets.assignedTo')}</th>
              <th>{t('assets.action')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(a => (
              <tr key={a.id}>
                <td className="px-4 py-3">
                  <Link to={`/inventory/${a.id}`} className="text-fiba-accent hover:underline">{a.name}</Link>
                  {a.brand && <div className="text-[11px] text-fiba-muted">{a.brand} {a.model || ''}</div>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-fiba-muted">{a.serial_number || '—'}</td>
                <td className="px-4 py-3">{a.category || '—'}</td>
                <td className="px-4 py-3">{a.location || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGES[a.status]}`}>
                    {t(`assets.${camel(a.status)}`)}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">{a.assigned_to || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2 text-sm">
                    <Link to={`/inventory/${a.id}`} className="text-fiba-accent hover:underline">{t('assets.view')}</Link>
                    {canEdit && (
                      <>
                        <button onClick={() => openEdit(a)} className="text-fiba-muted hover:text-fiba-accent hover:underline">{t('assets.edit')}</button>
                        {a.status !== 'retired' && (
                          <button onClick={() => handleRetire(a)} className="text-red-400 hover:underline">{t('assets.retire')}</button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-fiba-muted">{t('assets.noAssets')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showForm && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-2xl p-6">
            <h3 className="text-lg font-bold text-white mb-4">
              {editing ? t('assets.editAsset') : t('assets.newAsset')}
            </h3>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="fiba-label">{t('assets.name')} *</label>
                <input required value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="fiba-input" />
              </div>
              <div>
                <label className="fiba-label">{t('assets.serial')}</label>
                <input value={form.serial_number}
                  onChange={e => setForm(f => ({ ...f, serial_number: e.target.value }))}
                  className="fiba-input" />
              </div>
              <div>
                <label className="fiba-label">{t('assets.category')}</label>
                <input placeholder="Laptop, Camera, AV Equipment..." value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                  className="fiba-input" />
              </div>
              <div>
                <label className="fiba-label">{t('assets.brand')}</label>
                <input value={form.brand}
                  onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
                  className="fiba-input" />
              </div>
              <div>
                <label className="fiba-label">{t('assets.model')}</label>
                <input value={form.model}
                  onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                  className="fiba-input" />
              </div>
              <div>
                <label className="fiba-label">{t('assets.status')}</label>
                <select value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                  className="fiba-select">
                  <option value="available">{t('assets.available')}</option>
                  <option value="in_use">{t('assets.inUse')}</option>
                  <option value="maintenance">{t('assets.maintenance')}</option>
                  <option value="retired">{t('assets.retired')}</option>
                </select>
              </div>
              <div>
                <label className="fiba-label">{t('assets.location')}</label>
                <input value={form.location}
                  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  className="fiba-input" />
              </div>
              <div>
                <label className="fiba-label">{t('assets.purchaseDate')}</label>
                <input type="date" value={form.purchase_date}
                  onChange={e => setForm(f => ({ ...f, purchase_date: e.target.value }))}
                  className="fiba-input" />
              </div>
              <div className="col-span-2">
                <label className="fiba-label">{t('assets.notes')}</label>
                <textarea rows={3} value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="fiba-input" />
              </div>
              <div className="col-span-2 flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-sm text-fiba-muted hover:text-white">
                  {t('common.cancel')}
                </button>
                <button type="submit" disabled={saving} className="btn-fiba disabled:opacity-50">
                  {saving ? t('common.saving') : (editing ? t('common.save') : t('common.create'))}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function camel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}
