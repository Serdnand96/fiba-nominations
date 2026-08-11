import { useEffect, useMemo, useState } from 'react'
import {
  getEmployees, createEmployee, updateEmployee, deleteEmployee,
  getEmployeeTripCounts, getEmployeeTrips,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../contexts/AuthContext'

const EMPTY_FORM = {
  name: '', email: '', position: '', department: '', phone: '',
  active: true, notes: '',
}

export default function Employees() {
  const { t } = useLanguage()
  const { push } = useToast()
  const { hasEdit, hasView } = useAuth()
  const canEdit = hasEdit('employees')
  // Los días compensatorios llevan permiso aparte. Esto es solo UX: el backend
  // ya recorta el dato de la respuesta a quien no lo tenga.
  const canSeeCompDays = hasView('comp_days')

  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [activeFilter, setActiveFilter] = useState('active')

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Viajes del año. El número no está guardado en el empleado: sale de sumar
  // sus designaciones (staffing plan) y su presencia en el padrón de logística.
  const [tripYear, setTripYear] = useState(new Date().getFullYear())
  const [tripCounts, setTripCounts] = useState({})
  // Sábados y domingos caídos dentro de los viajes → base de los compensatorios.
  const [compDays, setCompDays] = useState({})
  const [tripYears, setTripYears] = useState([])
  const [tripPanel, setTripPanel] = useState(null) // { employee, data, loading }

  useEffect(() => { load() }, [])

  useEffect(() => { loadTripCounts() }, [tripYear])

  async function load() {
    setLoading(true)
    try {
      setEmployees(await getEmployees())
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function loadTripCounts() {
    try {
      const r = await getEmployeeTripCounts(tripYear)
      setTripCounts(r.counts || {})
      setCompDays(r.weekend_days || {})
      setTripYears(r.years || [])
    } catch (e) { console.error(e) }
  }

  async function openTrips(employee) {
    setTripPanel({ employee, data: null, loading: true })
    try {
      const data = await getEmployeeTrips(employee.id, tripYear)
      setTripPanel({ employee, data, loading: false })
    } catch (e) {
      console.error(e)
      setTripPanel({ employee, data: null, loading: false })
    }
  }

  // El selector ofrece los años con datos más el actual, para no quedar en un
  // año vacío cuando todavía no se cargó nada.
  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear()
    return [...new Set([current, tripYear, ...tripYears])].sort((a, b) => b - a)
  }, [tripYears, tripYear])

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
      push({ type: 'error', title: err.response?.data?.detail || err.message })
    }
    setSaving(false)
  }

  async function handleDeactivate(emp) {
    if (!confirm(`${t('employees.confirmDeactivate')} "${emp.name}"?`)) return
    try {
      await deleteEmployee(emp.id)
      await load()
    } catch (err) {
      push({ type: 'error', title: err.response?.data?.detail || err.message })
    }
  }

  if (loading) return <div className="text-fiba-muted text-sm">{t('common.loading')}</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-ink-900 dark:text-white">{t('employees.title')}</h2>
        {canEdit && (
          <button onClick={openNew} className="btn-fiba">{t('employees.newEmployee')}</button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="fiba-stat"><p className="text-xs text-fiba-muted">{t('employees.total')}</p><p className="text-2xl font-bold text-ink-900 dark:text-white">{stats.total}</p></div>
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
        <select value={tripYear} onChange={e => setTripYear(Number(e.target.value))}
          className="fiba-select !w-auto min-w-[120px] flex-shrink-0"
          title={t('employees.tripsYearHint')}>
          {yearOptions.map(y => (
            <option key={y} value={y}>{t('employees.tripsYearOption', { year: y })}</option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
        <table className="fiba-table">
          <thead>
            <tr>
              <th>{t('employees.name')}</th>
              <th>{t('employees.email')}</th>
              <th>{t('employees.position')}</th>
              <th>{t('employees.department')}</th>
              <th>{t('employees.phone')}</th>
              <th>{t('employees.trips')}</th>
              {canSeeCompDays && <th>{t('employees.compDays')}</th>}
              <th>{t('common.status')}</th>
              <th>{t('common.action')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(e => (
              <tr key={e.id} className={!e.active ? 'opacity-50' : ''}>
                <td className="px-4 py-3 font-medium text-ink-900 dark:text-white">{e.name}</td>
                <td className="px-4 py-3 text-fiba-muted text-sm">{e.email || '—'}</td>
                <td className="px-4 py-3 text-sm">{e.position || '—'}</td>
                <td className="px-4 py-3 text-sm">{e.department || '—'}</td>
                <td className="px-4 py-3 text-sm">{e.phone || '—'}</td>
                <td className="px-4 py-3">
                  {tripCounts[e.id] ? (
                    <button onClick={() => openTrips(e)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-fiba-accent/15 text-fiba-accent hover:bg-fiba-accent/25 transition-colors"
                      title={t('employees.tripsOpen', { year: tripYear })}>
                      {tripCounts[e.id]}
                    </button>
                  ) : (
                    <span className="text-fiba-muted/50 text-sm">—</span>
                  )}
                </td>
                {canSeeCompDays && (
                  <td className="px-4 py-3">
                    {compDays[e.id] ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-500/15 text-blue-400"
                        title={t('employees.compDaysHint', { year: tripYear })}>
                        {compDays[e.id]}
                      </span>
                    ) : (
                      <span className="text-fiba-muted/50 text-sm">—</span>
                    )}
                  </td>
                )}
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${e.active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-ink-500 dark:text-gray-400'}`}>
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
              <tr><td colSpan={canSeeCompDays ? 9 : 8} className="px-4 py-8 text-center text-fiba-muted">{t('employees.noEmployees')}</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Detalle de viajes — qué eventos, no solo cuántos. */}
      {tripPanel && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setTripPanel(null)} />
          <div className="fixed top-0 right-0 h-full w-full max-w-md bg-fiba-card border-l border-fiba-border z-50 flex flex-col animate-slide-in">
            <div className="flex items-start justify-between p-6 border-b border-fiba-border">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-ink-900 dark:text-white truncate">{tripPanel.employee.name}</h3>
                <p className="text-xs text-fiba-muted mt-0.5">
                  {[tripPanel.employee.position, tripPanel.employee.department].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <button onClick={() => setTripPanel(null)}
                className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-ink-900 dark:hover:text-white">×</button>
            </div>

            <div className="px-6 py-3 border-b border-fiba-border bg-fiba-surface/50">
              <h4 className="text-sm font-semibold text-ink-700 dark:text-gray-300">
                {t('employees.tripsYearOption', { year: tripYear })}
              </h4>
              <p className="text-xs text-fiba-muted/60">{t('employees.tripsSource')}</p>
            </div>

            <div className="flex-1 overflow-auto p-6">
              {tripPanel.loading ? (
                <div className="text-center py-8 text-fiba-muted text-sm">{t('common.loading')}</div>
              ) : !tripPanel.data || tripPanel.data.trips.length === 0 ? (
                <div className="text-center py-8 text-fiba-muted text-sm">{t('employees.tripsEmpty')}</div>
              ) : (
                <>
                  <div className={`grid ${canSeeCompDays ? 'grid-cols-3' : 'grid-cols-2'} gap-3 mb-4`}>
                    <div className="fiba-stat">
                      <p className="text-xs text-fiba-muted">{t('employees.trips')}</p>
                      <p className="text-2xl font-bold text-ink-900 dark:text-white">{tripPanel.data.totals.trips}</p>
                    </div>
                    <div className="fiba-stat">
                      <p className="text-xs text-fiba-muted">{t('employees.tripsDays')}</p>
                      <p className="text-2xl font-bold text-ink-900 dark:text-white">
                        {tripPanel.data.totals.days || '—'}
                      </p>
                    </div>
                    {canSeeCompDays && (
                      <div className="fiba-stat">
                        <p className="text-xs text-fiba-muted">{t('employees.compDays')}</p>
                        <p className="text-2xl font-bold text-blue-400">
                          {tripPanel.data.totals.weekend_days || '—'}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    {tripPanel.data.trips.map(trip => (
                      <div key={`${trip.competition_id}-${trip.source}`}
                        className="border border-fiba-border rounded-lg p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ink-900 dark:text-white truncate">
                              {trip.competition_name || '—'}
                            </p>
                            <p className="text-xs text-fiba-muted">
                              {trip.start_date || '—'}
                              {trip.end_date && trip.end_date !== trip.start_date ? ` — ${trip.end_date}` : ''}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className="block text-sm font-semibold text-fiba-accent">
                              {trip.days > 0 ? t('employees.tripsDaysCount', { count: trip.days }) : '—'}
                            </span>
                            {canSeeCompDays && trip.weekend_days > 0 && (
                              <span className="block text-xs font-semibold text-blue-400"
                                title={t('employees.compDaysHint', { year: tripYear })}>
                                {t('employees.compDaysCount', { count: trip.weekend_days })}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          {trip.event_role && (
                            <span className="px-2 py-0.5 rounded text-xs bg-fiba-surface text-fiba-muted">
                              {trip.event_role}
                            </span>
                          )}
                          {/* De dónde salió el viaje: designación cargada, o
                              solo presencia en el manifiesto de logística. */}
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border border-fiba-border text-fiba-muted/70">
                            {t(`employees.tripsSource_${trip.source}`)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {showForm && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-xl p-6">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-4">
              {editing ? t('employees.editEmployee') : t('employees.newEmployee')}
            </h3>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  className="px-4 py-2 text-sm text-fiba-muted hover:text-ink-900 dark:text-white">
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
