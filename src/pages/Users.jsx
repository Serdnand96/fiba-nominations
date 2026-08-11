import { useState, useEffect } from 'react'
import {
  getUsers, createUser, deleteUser, updateUserPassword,
  getUserPermissions, updateUserPermissions,
  getDepartments, getBudgetAccess, updateBudgetAccess,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../contexts/AuthContext'

const MODULES = ['calendar', 'nominations', 'payments', 'budget', 'personnel', 'competitions', 'templates', 'users', 'logistics', 'availability', 'training', 'games', 'assets', 'loans', 'employees', 'reports', 'evaluations', 'comp_days']
// Permisos que gobiernan un dato, no una página: solo tienen sentido en "ver".
// Marcar "editar" no haría nada, así que el checkbox va deshabilitado.
const VIEW_ONLY_MODULES = new Set(['comp_days'])

export default function Users() {
  const { t } = useLanguage()
  const { push } = useToast()
  const { isSuperadmin, hasEdit } = useAuth()
  const canEdit = hasEdit('users')
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Password editor
  const [pwdUser, setPwdUser] = useState(null)
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [pwdError, setPwdError] = useState('')
  const [pwdSaving, setPwdSaving] = useState(false)
  const [pwdSuccess, setPwdSuccess] = useState(false)

  // Permission editor
  const [permUser, setPermUser] = useState(null)
  const [permData, setPermData] = useState([])
  const [permLoading, setPermLoading] = useState(false)
  const [permSaving, setPermSaving] = useState(false)
  const [permSuccess, setPermSuccess] = useState(false)
  // Acceso por departamento del módulo Presupuesto (tabla aparte de user_permissions)
  const [deptList, setDeptList] = useState([])
  const [deptAccess, setDeptAccess] = useState([])

  useEffect(() => { loadUsers() }, [])

  async function loadUsers() {
    try {
      const data = await getUsers()
      setUsers(data)
    } catch (err) {
      console.error('Error loading users:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleCreate(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      await createUser({ email, password })
      setEmail('')
      setPassword('')
      setShowForm(false)
      loadUsers()
    } catch (err) {
      setError(err.response?.data?.detail || err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(user) {
    if (!confirm(t('users.confirmDelete', { email: user.email }))) return
    try {
      await deleteUser(user.id)
      loadUsers()
    } catch (err) {
      push({ type: 'error', title: t('users.errorDeleting') + ': ' + (err.response?.data?.detail || err.message) })
    }
  }

  function openPwdEditor(user) {
    setPwdUser(user)
    setNewPwd('')
    setConfirmPwd('')
    setPwdError('')
    setPwdSuccess(false)
  }

  async function handlePasswordSave(e) {
    e.preventDefault()
    setPwdError('')
    if (newPwd.length < 8) {
      setPwdError(t('users.passwordTooShort'))
      return
    }
    if (newPwd !== confirmPwd) {
      setPwdError(t('users.passwordMismatch'))
      return
    }
    setPwdSaving(true)
    try {
      await updateUserPassword(pwdUser.id, newPwd)
      setPwdSuccess(true)
      setTimeout(() => setPwdUser(null), 1500)
    } catch (err) {
      setPwdError(err.response?.data?.detail || err.message)
    } finally {
      setPwdSaving(false)
    }
  }

  async function openPermEditor(user) {
    if (user.is_superadmin) return
    setPermUser(user)
    setPermLoading(true)
    setPermSuccess(false)
    try {
      const data = await getUserPermissions(user.id)
      setPermData(data.permissions.map(p => ({ ...p })))
    } catch {
      setPermData(MODULES.map(m => ({ module: m, can_view: false, can_edit: false })))
    }
    // El acceso por departamento de Presupuesto vive en su propia tabla: el
    // permiso `budget` abre el módulo, esto recorta qué filas ve adentro.
    try {
      const [deps, access] = await Promise.all([getDepartments(), getBudgetAccess(user.id)])
      setDeptList(deps)
      const byCode = Object.fromEntries(access.map(a => [a.department_code, a]))
      setDeptAccess([
        { department_code: '*', ...(byCode['*'] || { can_view: false, can_edit: false }) },
        ...deps.map(d => ({
          department_code: d.code,
          ...(byCode[d.code] || { can_view: false, can_edit: false }),
        })),
      ])
    } catch {
      setDeptList([])
      setDeptAccess([])
    }
    setPermLoading(false)
  }

  function toggleDept(code, field) {
    setDeptAccess(prev => prev.map(d => {
      if (d.department_code !== code) return d
      if (field === 'can_view') {
        const v = !d.can_view
        return { ...d, can_view: v, can_edit: v ? d.can_edit : false }
      }
      const e = !d.can_edit
      return { ...d, can_edit: e, can_view: e ? true : d.can_view }
    }))
  }

  function toggleView(module) {
    setPermData(prev => prev.map(p => {
      if (p.module !== module) return p
      const newView = !p.can_view
      return { ...p, can_view: newView, can_edit: newView ? p.can_edit : false }
    }))
  }

  function toggleEdit(module) {
    setPermData(prev => prev.map(p => {
      if (p.module !== module) return p
      const newEdit = !p.can_edit
      return { ...p, can_edit: newEdit, can_view: newEdit ? true : p.can_view }
    }))
  }

  async function savePermissions() {
    setPermSaving(true)
    try {
      await updateUserPermissions(permUser.id, permData)
      // Se guarda siempre, incluso vacío: quitarle todos los departamentos es
      // la forma de dejarlo sin datos sin tener que sacarle el módulo.
      await updateBudgetAccess(
        permUser.id,
        deptAccess.filter(d => d.can_view || d.can_edit),
      )
      setPermSuccess(true)
      setTimeout(() => setPermSuccess(false), 2000)
    } catch (err) {
      push({ type: 'error', title: err.response?.data?.detail || t('permissions.errorSaving') })
    }
    setPermSaving(false)
  }

  function getModuleLabel(module) {
    // The permission is called 'assets' but the nav module is "Inventory".
    if (module === 'assets') return t('nav.inventory')
    // No es una página, así que no tiene entrada en el sidebar de dónde sacar
    // el nombre: gobierna la columna de días compensatorios de Empleados.
    if (module === 'comp_days') return t('employees.compDaysPermission')
    return t(`nav.${module}`) || module
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-ink-900 dark:text-white">{t('users.title')}</h2>
        {canEdit && (
          <button onClick={() => setShowForm(!showForm)}
            className="btn-fiba">
            {showForm ? t('users.cancel') : t('users.newUser')}
          </button>
        )}
      </div>

      {showForm && canEdit && (
        <form onSubmit={handleCreate} className="fiba-card p-6 mb-6 max-w-md">
          {error && (
            <div className="bg-red-500/10 text-red-400 text-sm px-4 py-3 rounded-lg mb-4">{error}</div>
          )}
          <div className="space-y-4">
            <div>
              <label className="fiba-label">{t('users.email')}</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="fiba-input"
                placeholder="usuario@fiba.basketball" />
            </div>
            <div>
              <label className="fiba-label">{t('users.password')}</label>
              <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
                className="fiba-input"
                placeholder={t('users.minChars')} />
            </div>
            <button type="submit" disabled={saving}
              className="btn-fiba disabled:opacity-50">
              {saving ? t('users.creating') : t('users.createUser')}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-fiba-muted/60 text-sm">{t('users.loading')}</p>
      ) : (
        <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
        <table className="fiba-table">
            <thead>
              <tr>
                <th>{t('users.email')}</th>
                <th>{t('users.created')}</th>
                <th>{t('users.lastAccess')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className={permUser?.id === u.id ? 'bg-fiba-accent/10' : ''}>
                  <td className="px-6 py-4 text-sm text-ink-900 dark:text-white">
                    <div className="flex items-center gap-2">
                      {u.email}
                      {u.is_superadmin && (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400">
                          {t('permissions.superadmin')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-fiba-muted">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-fiba-muted">
                    {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : t('users.never')}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex gap-3 justify-end">
                      {isSuperadmin && (
                        <button onClick={() => openPwdEditor(u)} className="text-fiba-accent hover:underline text-sm">
                          {t('users.changePassword')}
                        </button>
                      )}
                      {isSuperadmin && !u.is_superadmin && (
                        <button onClick={() => openPermEditor(u)} className="text-fiba-accent hover:underline text-sm">
                          {t('permissions.editPermissions')}
                        </button>
                      )}
                      {canEdit && !u.is_superadmin && (
                        <button onClick={() => handleDelete(u)} className="text-red-400 hover:text-red-300 text-sm">
                          {t('users.delete')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-fiba-muted/60 text-sm">
                    {t('users.noUsers')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </div>
      )}

      {/* Password Editor Modal */}
      {pwdUser && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-md p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-ink-900 dark:text-white">{t('users.changePasswordTitle')}</h3>
                <p className="text-sm text-fiba-muted">{pwdUser.email}</p>
              </div>
              <button onClick={() => setPwdUser(null)} className="text-fiba-muted hover:text-ink-900 dark:text-white text-xl">&times;</button>
            </div>

            <form onSubmit={handlePasswordSave} className="space-y-4">
              {pwdError && (
                <div className="bg-red-500/10 text-red-400 text-sm px-4 py-3 rounded-lg">{pwdError}</div>
              )}
              {pwdSuccess && (
                <div className="bg-emerald-500/10 text-emerald-400 text-sm px-4 py-3 rounded-lg">
                  {t('users.passwordUpdated')}
                </div>
              )}
              <div>
                <label className="fiba-label">{t('users.newPassword')}</label>
                <input type="password" required minLength={8} value={newPwd} onChange={e => setNewPwd(e.target.value)}
                  className="fiba-input" placeholder={t('users.minChars8')} autoComplete="new-password" />
              </div>
              <div>
                <label className="fiba-label">{t('users.confirmPassword')}</label>
                <input type="password" required minLength={8} value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)}
                  className="fiba-input" placeholder={t('users.minChars8')} autoComplete="new-password" />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setPwdUser(null)} className="px-4 py-2 text-sm text-fiba-muted">
                  {t('users.cancel')}
                </button>
                <button type="submit" disabled={pwdSaving} className="btn-fiba disabled:opacity-50">
                  {pwdSaving ? t('users.savingPassword') : t('users.savePassword')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Permission Editor Modal */}
      {permUser && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-md p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-ink-900 dark:text-white">{t('permissions.editPermissions')}</h3>
                <p className="text-sm text-fiba-muted">{permUser.email}</p>
              </div>
              <button onClick={() => setPermUser(null)} className="text-fiba-muted hover:text-ink-900 dark:text-white text-xl">&times;</button>
            </div>

            {permLoading ? (
              <div className="text-center py-8 text-fiba-muted/60 text-sm">{t('common.loading')}</div>
            ) : (
              <>
                <table className="w-full text-sm mb-4">
                  <thead className="bg-fiba-surface">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-fiba-muted">{t('permissions.module')}</th>
                      <th className="text-center px-3 py-2 font-medium text-fiba-muted w-24">{t('permissions.canView')}</th>
                      <th className="text-center px-3 py-2 font-medium text-fiba-muted w-24">{t('permissions.canEdit')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {permData.map(p => (
                      <tr key={p.module} className="border-t border-fiba-border">
                        <td className="px-3 py-2 font-medium">{getModuleLabel(p.module)}</td>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" checked={p.can_view}
                            onChange={() => toggleView(p.module)}
                            className="rounded border-fiba-border" />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" checked={p.can_edit}
                            disabled={VIEW_ONLY_MODULES.has(p.module)}
                            title={VIEW_ONLY_MODULES.has(p.module) ? t('permissions.viewOnlyModule') : undefined}
                            onChange={() => toggleEdit(p.module)}
                            className="rounded border-fiba-border disabled:opacity-30" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Presupuesto recorta por departamento además del módulo:
                    el permiso abre la página, esto decide qué filas ve. */}
                {deptAccess.length > 0 && (
                  <div className="mb-4 border-t border-fiba-border pt-4">
                    <h4 className="text-sm font-semibold text-ink-900 dark:text-white">
                      {t('budget.access')}
                    </h4>
                    <p className="text-xs text-fiba-muted mt-0.5 mb-2">{t('budget.accessHint')}</p>
                    {!permData.find(p => p.module === 'budget')?.can_view && (
                      <p className="text-xs text-amber-500 mb-2">{t('budget.accessNeedsModule')}</p>
                    )}
                    <table className="w-full text-sm">
                      <thead className="bg-fiba-surface">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium text-fiba-muted">
                            {t('budget.department')}
                          </th>
                          <th className="text-center px-3 py-2 font-medium text-fiba-muted w-24">
                            {t('permissions.canView')}
                          </th>
                          <th className="text-center px-3 py-2 font-medium text-fiba-muted w-24">
                            {t('permissions.canEdit')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {deptAccess.map(d => {
                          const all = deptAccess.find(x => x.department_code === '*')
                          // Con "todos" marcado, las filas por departamento no
                          // suman nada: se deshabilitan para no dar a entender
                          // que recortan algo.
                          const overridden = d.department_code !== '*' && all?.can_view
                          return (
                            <tr key={d.department_code}
                              className={`border-t border-fiba-border ${overridden ? 'opacity-40' : ''}`}>
                              <td className="px-3 py-2 font-medium">
                                {d.department_code === '*'
                                  ? <em>{t('budget.accessAll')}</em>
                                  : (deptList.find(x => x.code === d.department_code)?.label || d.department_code)}
                              </td>
                              <td className="px-3 py-2 text-center">
                                <input type="checkbox" checked={d.can_view} disabled={overridden}
                                  onChange={() => toggleDept(d.department_code, 'can_view')}
                                  className="rounded border-fiba-border disabled:opacity-30" />
                              </td>
                              <td className="px-3 py-2 text-center">
                                <input type="checkbox" checked={d.can_edit} disabled={overridden}
                                  onChange={() => toggleDept(d.department_code, 'can_edit')}
                                  className="rounded border-fiba-border disabled:opacity-30" />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {permSuccess && (
                  <div className="bg-emerald-500/10 text-emerald-400 text-sm px-4 py-2 rounded-lg mb-3">
                    {t('permissions.permissionsUpdated')}
                  </div>
                )}

                <div className="flex justify-end gap-3">
                  <button onClick={() => setPermUser(null)} className="px-4 py-2 text-sm text-fiba-muted">
                    {t('permissions.cancel')}
                  </button>
                  <button onClick={savePermissions} disabled={permSaving}
                    className="btn-fiba disabled:opacity-50">
                    {permSaving ? t('permissions.saving') : t('permissions.savePermissions')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
