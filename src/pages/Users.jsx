import { useState, useEffect } from 'react'
import { getUsers, createUser, deleteUser, getUserPermissions, updateUserPermissions } from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'

const MODULES = ['calendar', 'nominations', 'personnel', 'competitions', 'templates', 'users', 'transport', 'availability', 'training']

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
        <h2 className="text-xl font-bold text-white">{t('users.title')}</h2>
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
                  <td className="px-6 py-4 text-sm text-white">
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
      )}

      {/* Permission Editor Modal */}
      {permUser && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-md p-6">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-white">{t('permissions.editPermissions')}</h3>
                <p className="text-sm text-fiba-muted">{permUser.email}</p>
              </div>
              <button onClick={() => setPermUser(null)} className="text-fiba-muted hover:text-white text-xl">&times;</button>
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
                            onChange={() => toggleEdit(p.module)}
                            className="rounded border-fiba-border" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

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
