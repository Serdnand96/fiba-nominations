import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getUserPermissions } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [permissions, setPermissions] = useState({})
  const [isSuperadmin, setIsSuperadmin] = useState(false)

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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null
      setUser(u)
      if (u) {
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
      } else {
        setPermissions({})
        setIsSuperadmin(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    // Load permissions after sign in
    if (data.user) await loadPermissions(data.user.id)
    return data
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    setPermissions({})
    setIsSuperadmin(false)
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
    <AuthContext.Provider value={{ user, loading, signIn, signOut, permissions, isSuperadmin, hasView, hasEdit, loadPermissions }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
