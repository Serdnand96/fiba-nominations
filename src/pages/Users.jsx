import { useState, useEffect } from 'react'
import { getUsers, createUser, deleteUser, getUserPermissions, updateUserPermissions } from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'

const MODULES = ['calendar', 'nominations', 'personnel', 'competitions', 'templates', 'users', 'transport', 'availability']

export default function Users() {
  const { t } = useLanguage()
  const { isSuperadmin, hasEdit } = useAuth()
  const canEdit = hasEdit('users')
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Permission editor
  const [permUser, setPermUser] = useState(null)
  const [permData, setPermData] = useState([])
  const [permLoading, setPermLoading] = useState(false)
  const [permSaving, setPermSaving] = useState(false)
  const [permSuccess, setPermSuccess] = useState(false)

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
      alert(t('users.errorDeleting') + ': ' + (err.response?.data?.detail || err.message))
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
    setPermLoading(false)
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
      setPermSuccess(true)
      setTimeout(() => setPermSuccess(false), 2000)
    } catch (err) {
      alert(err.response?.data?.detail || t('permissions.errorSaving'))
    }
    setPermSaving(false)
  }

  function getModuleLabel(module) {
    return t(`nav.${module}`) || module
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">{t('users.title')}</h2>
        {canEdit && (
          <button onClick={() => setShowForm(!showForm)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
            {showForm ? t('users.cancel') : t('users.newUser')}
          </button>
        )}
      </div>

      {showForm && canEdit && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl shadow p-6 mb-6 max-w-md">
          {error && (
            <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg mb-4">{error}</div>
          )}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('users.email')}</label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="usuario@fiba.basketball" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('users.password')}</label>
              <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t('users.minChars')} />
            </div>
            <button type="submit" disabled={saving}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {saving ? t('users.creating') : t('users.createUser')}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-gray-400 text-sm">{t('users.loading')}</p>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('users.email')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('users.created')}</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('users.lastAccess')}</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users.map(u => (
                <tr key={u.id} className={`hover:bg-gray-50 ${permUser?.id === u.id ? 'bg-blue-50' : ''}`}>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    <div className="flex items-center gap-2">
                      {u.email}
                      {u.is_superadmin && (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">
                          {t('permissions.superadmin')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : t('users.never')}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex gap-3 justify-end">
                      {isSuperadmin && !u.is_superadmin && (
                        <button onClick={() => openPermEditor(u)} className="text-blue-600 hover:underline text-sm">
                          {t('permissions.editPermissions')}
                        </button>
                      )}
                      {canEdit && !u.is_superadmin && (
                        <button onClick={() => handleDelete(u)} className="text-red-600 hover:text-red-800 text-sm">
                          {t('users.delete')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-gray-400 text-sm">
                    {t('users.noUsers')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Permission Editor Modal */}
      {permUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold">{t('permissions.editPermissions')}</h3>
                <p className="text-sm text-gray-500">{permUser.email}</p>
              </div>
              <button onClick={() => setPermUser(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            {permLoading ? (
              <div className="text-center py-8 text-gray-400 text-sm">{t('common.loading')}</div>
            ) : (
              <>
                <table className="w-full text-sm mb-4">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-gray-500">{t('permissions.module')}</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-500 w-24">{t('permissions.canView')}</th>
                      <th className="text-center px-3 py-2 font-medium text-gray-500 w-24">{t('permissions.canEdit')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {permData.map(p => (
                      <tr key={p.module} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium">{getModuleLabel(p.module)}</td>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" checked={p.can_view}
                            onChange={() => toggleView(p.module)}
                            className="rounded border-gray-300" />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" checked={p.can_edit}
                            onChange={() => toggleEdit(p.module)}
                            className="rounded border-gray-300" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {permSuccess && (
                  <div className="bg-green-50 text-green-700 text-sm px-4 py-2 rounded-lg mb-3">
                    {t('permissions.permissionsUpdated')}
                  </div>
                )}

                <div className="flex justify-end gap-3">
                  <button onClick={() => setPermUser(null)} className="px-4 py-2 text-sm text-gray-600">
                    {t('permissions.cancel')}
                  </button>
                  <button onClick={savePermissions} disabled={permSaving}
                    className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
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
