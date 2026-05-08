import { useEffect, useMemo, useState } from 'react'
import { getEmployees, createEmployee, updateEmployee, deleteEmployee } from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'

const EMPTY_FORM = {
  name: '', email: '', position: '', department: '', phone: '',
  active: true, notes: '',
}

export default function Employees() {
  const { t } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('employees')

  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [activeFilter, setActiveFilter] = useState('active')

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      setEmployees(await getEmployees())
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    return employees.filter(e => {
      if (activeFilter === 'active' && !e.active) return false
      if (activeFilter === 'inactive' && e.active) return false
      if (departmentFilter && e.department !== departmentFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return (e.name || '').toLowerCase().includes(q)
          || (e.email || '').toLowerCase().includes(q)
          || (e.position || '').toLowerCase().includes(q)
      }
      return true
    })
  }, [employees, search, departmentFilter, activeFilter])

  const departmentOptions = useMemo(() =>
    [...new Set(employees.map(e => e.department).filter(Boolean))].sort(),
    [employees])

  const stats = useMemo(() => ({
    total: employees.length,
    active: employees.filter(e => e.active).length,
    departments: new Set(employees.map(e => e.department).filter(Boolean)).size,
  }), [employees])

  function openNew() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
  }

  function openEdit(emp) {
    setEditing(emp)
    setForm({
      name: emp.name || '',
      email: emp.email || '',
      position: emp.position || '',
      department: emp.department || '',
      phone: emp.phone || '',
      active: emp.active !== false,
      notes: emp.notes || '',
    })
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const payload = { ...form }
      Object.keys(payload).forEach(k => {
        if (payload[k] === '') payload[k] = null
      })
      if (editing) {
        await updateEmployee(editing.id, payload)
      } else {
        await createEmployee(payload)
      }
      setShowForm(false)
      await load()
    } catch (err) {
      alert(err.response?.data?.detail || err.message)
    }
    setSaving(false)
  }

  async function handleDeactivate(emp) {
    if (!confirm(`${t('employees.confirmDeactivate')} "${emp.name}"?`)) return
    try {
      await deleteEmployee(emp.id)
      await load()
    } catch (err) {
      alert(err.response?.data?.detail || err.message)
    }
  }

  if (loading) return <div className="text-fiba-muted text-sm">{t('common.loading')}</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">{t('employees.title')}</h2>
        {canEdit && (
          <button onClick={openNew} className="btn-fiba">{t('employees.newEmployee')}</button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="fiba-stat"><p className="text-xs text-fiba-muted">{t('employees.total')}</p><p className="text-2xl font-bold text-white">{stats.total}</p></div>
        <div className="fiba-stat"><p className="text-xs text-fiba-muted">{t('employees.active')}</p><p className="text-2xl font-bold text-emerald-400">{stats.active}</p></div>
        <div className="fiba-stat"><p className="text-xs text-fiba-muted">{t('employees.departments')}</p><p className="text-2xl font-bold text-blue-400">{stats.departments}</p></div>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <input type="text" placeholder={t('employees.searchPlaceholder')} value={search}
          onChange={e => setSearch(e.target.value)} className="fiba-input w-full md:w-80" />
        <select value={activeFilter} onChange={e => setActiveFilter(e.target.value)}
          className="fiba-select !w-auto min-w-[140px] flex-shrink-0">
          <option value="">{t('employees.all')}</option>
          <option value="active">{t('employees.active')}</option>
          <option value="inactive">{t('employees.inactive')}</option>
        </select>
        <select value={departmentFilter} onChange={e => setDepartmentFilter(e.target.value)}
          className="fiba-select !w-auto min-w-[180px] flex-shrink-0">
          <option value="">{t('employees.allDepartments')}</option>
          {departmentOptions.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <table className="fiba-table">
          <thead>
            <tr>
              <th>{t('employees.name')}</th>
              <th>{t('employees.email')}</th>
              <th>{t('employees.position')}</th>
              <th>{t('employees.department')}</th>
              <th>{t('employees.phone')}</th>
              <th>{t('common.status')}</th>
              <th>{t('common.action')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(e => (
              <tr key={e.id} className={!e.active ? 'opacity-50' : ''}>
                <td className="px-4 py-3 font-medium text-white">{e.name}</td>
                <td className="px-4 py-3 text-fiba-muted text-sm">{e.email || '—'}</td>
                <td className="px-4 py-3 text-sm">{e.position || '—'}</td>
                <td className="px-4 py-3 text-sm">{e.department || '—'}</td>
                <td className="px-4 py-3 text-sm">{e.phone || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${e.active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'}`}>
                    {e.active ? t('employees.active') : t('employees.inactive')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {canEdit && (
                    <div className="flex gap-2 text-sm">
                      <button onClick={() => openEdit(e)} className="text-fiba-accent hover:underline">{t('common.edit')}</button>
                      {e.active && (
                        <button onClick={() => handleDeactivate(e)} className="text-red-400 hover:underline">{t('employees.deactivate')}</button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-fiba-muted">{t('employees.noEmployees')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-xl p-6">
            <h3 className="text-lg font-bold text-white mb-4">
              {editing ? t('employees.editEmployee') : t('employees.newEmployee')}
            </h3>
            <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="fiba-label">{t('employees.name')} *</label>
                <input required value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="fiba-input" />
              </div>
              <div className="col-span-2">
                <label className="fiba-label">{t('employees.email')}</label>
                <input type="email" value={form.email}
                  onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="fiba-input" />
              </div>
              <div>
                <label className="fiba-label">{t('employees.position')}</label>
                <input value={form.position}
                  onChange={e => setForm(f => ({ ...f, position: e.target.value }))}
                  className="fiba-input" />
              </div>
              <div>
                <label className="fiba-label">{t('employees.department')}</label>
                <input value={form.department}
                  onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                  className="fiba-input" />
              </div>
              <div>
                <label className="fiba-label">{t('employees.phone')}</label>
                <input value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="fiba-input" />
              </div>
              <div>
                <label className="fiba-label">{t('common.status')}</label>
                <select value={form.active ? '1' : '0'}
                  onChange={e => setForm(f => ({ ...f, active: e.target.value === '1' }))}
                  className="fiba-select">
                  <option value="1">{t('employees.active')}</option>
                  <option value="0">{t('employees.inactive')}</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="fiba-label">{t('common.notes')}</label>
                <textarea rows={2} value={form.notes}
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
