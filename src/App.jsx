import { useState } from 'react'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { useLanguage } from './i18n/LanguageContext'
import Login from './pages/Login'
import Nominations from './pages/Nominations'
import Personnel from './pages/Personnel'
import Competitions from './pages/Competitions'
import Templates from './pages/Templates'
import Users from './pages/Users'
import Calendar from './pages/Calendar'
import Transport from './pages/Transport'
import Availability from './pages/Availability'
import Training from './pages/Training'
import Games from './pages/Games'

/* ── Nav icons (simple SVG paths) ─────────────────────────────────────── */
const icons = {
  calendar: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  ),
  nominations: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  ),
  personnel: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  ),
  competitions: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.016 6.016 0 01-4.27 1.772 6.016 6.016 0 01-4.27-1.772" />
    </svg>
  ),
  templates: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
  ),
  users: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  availability: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  transport: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
    </svg>
  ),
  training: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  games: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9.563C9 9.252 9.252 9 9.563 9h4.874c.311 0 .563.252.563.563v4.874c0 .311-.252.563-.563.563H9.564A.562.562 0 019 14.437V9.564z" />
    </svg>
  ),
}

function PermissionGuard({ module, children }) {
  const { hasView } = useAuth()
  const { t } = useLanguage()

  if (!hasView(module)) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="text-5xl text-fiba-border mb-4">403</div>
          <p className="text-fiba-muted text-sm">{t('permissions.accessDenied')}</p>
        </div>
      </div>
    )
  }

  return children
}

export default function App() {
  const { user, loading, hasView, isSuperadmin } = useAuth()
  const { t } = useLanguage()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  if (loading) {
    return (
      <div className="min-h-screen bg-fiba-dark flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-fiba-accent border-t-transparent rounded-full animate-spin" />
          <span className="text-fiba-muted text-sm">{t('app.loading')}</span>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Login />
  }

  const allNavItems = [
    { to: '/calendar', label: t('nav.calendar'), module: 'calendar' },
    { to: '/nominations', label: t('nav.nominations'), module: 'nominations' },
    { to: '/personnel', label: t('nav.personnel'), module: 'personnel' },
    { to: '/competitions', label: t('nav.competitions'), module: 'competitions' },
    { to: '/templates', label: t('nav.templates'), module: 'templates' },
    { to: '/users', label: t('nav.users'), module: 'users' },
    { to: '/availability', label: t('nav.availability'), module: 'availability' },
    { to: '/transport', label: t('nav.transport'), module: 'transport' },
    { to: '/training', label: t('nav.training'), module: 'training' },
    { to: '/games', label: t('nav.games'), module: 'games' },
  ]

  const navItems = allNavItems.filter(item => hasView(item.module))
  const defaultRoute = navItems.length > 0 ? navItems[0].to : '/calendar'

  return (
    <div className="flex h-screen bg-fiba-dark">
      {/* ── Sidebar ──────────────────────────────────────────── */}
      <aside className={`${sidebarCollapsed ? 'w-[72px]' : 'w-64'} bg-fiba-darker border-r border-fiba-border flex flex-col transition-all duration-200`}>
        {/* Logo area */}
        <div className="p-4 border-b border-fiba-border">
          <div className="flex items-center gap-3">
            {/* FIBA icon */}
            <div className="w-9 h-9 bg-fiba-accent rounded-lg flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-fiba-dark" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.79 3 4s-1.34 4-3 4-3-1.79-3-4 1.34-4 3-4z" opacity="0.3" />
              </svg>
            </div>
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <h1 className="text-sm font-bold text-white truncate">FIBA Americas</h1>
                <p className="text-[11px] text-fiba-muted truncate">{t('app.subtitle')}</p>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              title={sidebarCollapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group ${
                  isActive
                    ? 'bg-fiba-accent/10 text-fiba-accent'
                    : 'text-fiba-muted hover:text-white hover:bg-fiba-surface/50'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`shrink-0 ${isActive ? 'text-fiba-accent' : 'text-fiba-muted group-hover:text-white'}`}>
                    {icons[item.module]}
                  </span>
                  {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  {isActive && !sidebarCollapsed && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-fiba-accent" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Bottom section */}
        <div className="p-3 border-t border-fiba-border space-y-2">
          {!sidebarCollapsed && <LanguageSwitcher />}
          <LogoutButton collapsed={sidebarCollapsed} />
          {/* Collapse toggle */}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-full flex items-center justify-center py-1.5 text-fiba-muted hover:text-white transition-colors"
            title={sidebarCollapsed ? 'Expand' : 'Collapse'}
          >
            <svg className={`w-4 h-4 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────── */}
      <main className="flex-1 overflow-auto">
        <div className="p-6 lg:p-8 max-w-[1400px]">
          <Routes>
            <Route path="/" element={<Navigate to={defaultRoute} replace />} />
            <Route path="/calendar" element={<PermissionGuard module="calendar"><Calendar /></PermissionGuard>} />
            <Route path="/nominations" element={<PermissionGuard module="nominations"><Nominations /></PermissionGuard>} />
            <Route path="/personnel" element={<PermissionGuard module="personnel"><Personnel /></PermissionGuard>} />
            <Route path="/competitions" element={<PermissionGuard module="competitions"><Competitions /></PermissionGuard>} />
            <Route path="/templates" element={<PermissionGuard module="templates"><Templates /></PermissionGuard>} />
            <Route path="/users" element={<PermissionGuard module="users"><Users /></PermissionGuard>} />
            <Route path="/availability" element={<PermissionGuard module="availability"><Availability /></PermissionGuard>} />
            <Route path="/transport" element={<PermissionGuard module="transport"><Transport /></PermissionGuard>} />
            <Route path="/training" element={<PermissionGuard module="training"><Training /></PermissionGuard>} />
            <Route path="/games" element={<PermissionGuard module="games"><Games /></PermissionGuard>} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

function LanguageSwitcher() {
  const { lang, setLang } = useLanguage()
  return (
    <div className="flex items-center gap-0.5 bg-fiba-surface rounded-lg p-0.5">
      <button
        onClick={() => setLang('es')}
        className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
          lang === 'es'
            ? 'bg-fiba-accent text-fiba-dark'
            : 'text-fiba-muted hover:text-white'
        }`}
      >
        ES
      </button>
      <button
        onClick={() => setLang('en')}
        className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
          lang === 'en'
            ? 'bg-fiba-accent text-fiba-dark'
            : 'text-fiba-muted hover:text-white'
        }`}
      >
        EN
      </button>
    </div>
  )
}

function LogoutButton({ collapsed }) {
  const { signOut, user, isSuperadmin } = useAuth()
  const { t } = useLanguage()
  return (
    <div>
      {!collapsed && (
        <div className="flex items-center gap-2 mb-2 px-1">
          <div className="w-6 h-6 bg-fiba-surface-2 rounded-full flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-fiba-accent">
              {(user.email || '?')[0].toUpperCase()}
            </span>
          </div>
          <p className="text-xs text-fiba-muted truncate">{user.email}</p>
          {isSuperadmin && (
            <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-fiba-accent/20 text-fiba-accent shrink-0">SA</span>
          )}
        </div>
      )}
      <button
        onClick={signOut}
        title={collapsed ? t('app.logout') : undefined}
        className={`${collapsed ? 'w-full flex justify-center' : 'w-full text-left px-1'} text-xs text-fiba-muted hover:text-red-400 transition-colors`}
      >
        {collapsed ? (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
          </svg>
        ) : t('app.logout')}
      </button>
    </div>
  )
}
