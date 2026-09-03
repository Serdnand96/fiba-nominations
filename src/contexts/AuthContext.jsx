import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getUserPermissions, getMyProfile } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [permissions, setPermissions] = useState({})
  const [isSuperadmin, setIsSuperadmin] = useState(false)
  // Perfil propio (hoy: avatar_url). Null hasta que carga o si falla: la foto
  // nunca bloquea el login, el sidebar cae a las iniciales.
  const [profile, setProfile] = useState(null)

  async function loadPermissions(userId) {
    try {
      const data = await getUserPermissions(userId)
      setIsSuperadmin(data.is_superadmin)
      const permMap = {}
      for (const p of data.permissions) {
        permMap[p.module] = { can_view: p.can_view, can_edit: p.can_edit }
      }
      setPermissions(permMap)
    } catch {
      // If permissions fail to load, default to no access
      setPermissions({})
      setIsSuperadmin(false)
    }
  }

  async function loadProfile() {
    try {
      setProfile(await getMyProfile())
    } catch {
      setProfile(null)
    }
  }

  const updateProfile = useCallback((patch) => {
    setProfile(prev => ({ ...(prev || {}), ...patch }))
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null
      setUser(u)
      if (u) {
        loadProfile()
        loadPermissions(u.id).then(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null
      setUser(u)
      if (u) {
        loadPermissions(u.id)
        loadProfile()
      } else {
        setPermissions({})
        setIsSuperadmin(false)
        setProfile(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    // Load permissions after sign in
    if (data.user) {
      await loadPermissions(data.user.id)
      loadProfile()
    }
    return data
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    setPermissions({})
    setIsSuperadmin(false)
    setProfile(null)
  }

  const hasView = useCallback((module) => {
    if (isSuperadmin) return true
    return permissions[module]?.can_view === true
  }, [isSuperadmin, permissions])

  const hasEdit = useCallback((module) => {
    if (isSuperadmin) return true
    return permissions[module]?.can_edit === true
  }, [isSuperadmin, permissions])

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, isSuperadmin, hasView, hasEdit, profile, updateProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
