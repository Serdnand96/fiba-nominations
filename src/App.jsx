import { lazy, Suspense, useState, useEffect } from 'react'
import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import { useLanguage } from './i18n/LanguageContext'
import { Icon } from './lib/icons'

// Eager-load Login (always shown when logged out) and PublicAsset (no-auth route)
import Login from './pages/Login'
import PublicAsset from './pages/PublicAsset'

// Lazy-load every authenticated page so the initial bundle is small
const Calendar     = lazy(() => import('./pages/Calendar'))
const Nominations  = lazy(() => import('./pages/Nominations'))
const Personnel    = lazy(() => import('./pages/Personnel'))
const Competitions = lazy(() => import('./pages/Competitions'))
const Templates    = lazy(() => import('./pages/Templates'))
const Users        = lazy(() => import('./pages/Users'))
const Transport    = lazy(() => import('./pages/Transport'))
const Availability = lazy(() => import('./pages/Availability'))
const Training     = lazy(() => import('./pages/Training'))
const Games        = lazy(() => import('./pages/Games'))
const Assets       = lazy(() => import('./pages/Assets'))
const AssetDetail  = lazy(() => import('./pages/AssetDetail'))
const Loans        = lazy(() => import('./pages/Loans'))
const Scan         = lazy(() => import('./pages/Scan'))
const Employees    = lazy(() => import('./pages/Employees'))

/* ── Module → icon map (uses Tabler-style icons from lib/icons) ──── */
const moduleIcon = {
  calendar:     Icon.Calendar,
  nominations:  Icon.Trophy,
  personnel:    Icon.Users,
  competitions: Icon.Trophy,
  templates:    Icon.Doc,
  users:        Icon.Shield,
  availability: Icon.Clock,
  transport:    Icon.Truck,
  training:     Icon.Whistle,
  games:        Icon.Globe,
  assets:       Icon.Dashboard,
  loans:        Icon.Upload,
  scan:         Icon.Pin,
  employees:    Icon.Users,
}

function PermissionGuard({ module, children }) {
  const { hasView } = useAuth()
  const { t } = useLanguage()

  if (!hasView(module)) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="text-5xl text-ink-300 dark:text-navy-700 font-bold mb-4">403</div>
          <p className="text-ink-500 dark:text-ink-400 text-sm">{t('permissions.accessDenied')}</p>
        </div>
      </div>
    )
  }

  return children
}

export default function App() {
  const { user, loading, hasView } = useAuth()
  const { t } = useLanguage()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  // Default to dark mode: the not-yet-migrated pages use dark-only styling.
  // Once all pages are on the new design system, default can switch to light.
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return true
    const stored = localStorage.getItem('fiba_dark')
    return stored === null ? true : stored === '1'
  })

  // Sync dark mode with <html> class + localStorage
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('fiba_dark', dark ? '1' : '0')
  }, [dark])

  // Public routes (no auth required) — must be rendered before the user check
  if (typeof window !== 'undefined' && /^\/asset\/[0-9a-f-]+/i.test(window.location.pathname)) {
    return (
      <Routes>
        <Route path="/asset/:id" element={<PublicAsset />} />
      </Routes>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-ink-50 dark:bg-navy-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-basketball-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-ink-500 dark:text-ink-400 text-sm">{t('app.loading')}</span>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Login />
  }

  const allNavItems = [
    { to: '/calendar',     label: t('nav.calendar'),     module: 'calendar' },
    { to: '/nominations',  label: t('nav.nominations'),  module: 'nominations' },
    { to: '/personnel',    label: t('nav.personnel'),    module: 'personnel' },
    { to: '/competitions', label: t('nav.competitions'), module: 'competitions' },
    { to: '/templates',    label: t('nav.templates'),    module: 'templates' },
    { to: '/users',        label: t('nav.users'),        module: 'users' },
    { to: '/availability', label: t('nav.availability'), module: 'availability' },
    { to: '/transport',    label: t('nav.transport'),    module: 'transport' },
    { to: '/training',     label: t('nav.training'),     module: 'training' },
    { to: '/games',        label: t('nav.games'),        module: 'games' },
    { to: '/inventory',    label: t('nav.inventory'),    module: 'assets' },
    { to: '/loans',        label: t('nav.loans'),        module: 'loans' },
    { to: '/scan',         label: t('nav.scan'),         module: 'assets' },
    { to: '/employees',    label: t('nav.employees'),    module: 'employees' },
  ]

  const navItems = allNavItems.filter(item => hasView(item.module))
  const defaultRoute = navItems.length > 0 ? navItems[0].to : '/calendar'

  return (
    <div className="flex h-screen bg-ink-50 dark:bg-navy-950 relative">
      {/* ── Mobile backdrop ──────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-navy-950/60 backdrop-blur-sm z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ──────────────────────────────────────────── */}
      <aside className={`
        ${sidebarCollapsed ? 'md:w-[72px]' : 'md:w-[232px]'}
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        fixed md:relative z-40 md:z-auto
        w-[232px] h-full
        bg-navy-900 text-white flex flex-col flex-shrink-0 border-r border-navy-950
        transition-transform duration-200 md:transition-all
      `}>
        {/* Brand */}
        <div className="h-14 px-4 flex items-center gap-2.5 border-b border-navy-800 flex-shrink-0">
          <div className="w-8 h-8 rounded-md bg-basketball-500 flex items-center justify-center flex-shrink-0 shadow-card">
            <svg viewBox="0 0 64 64" className="w-5 h-5" aria-label="FIBA Americas">
              <path d="M18 14 L44 14 L44 22 L26 22 L26 30 L40 30 L40 38 L26 38 L26 50 L18 50 Z" fill="#fff"/>
              <path d="M14 38 Q32 56 50 38" stroke="#0c2340" strokeWidth="4" fill="none" strokeLinecap="round"/>
            </svg>
          </div>
          <div className={`leading-tight min-w-0 ${sidebarCollapsed ? 'md:hidden' : ''}`}>
            <div className="text-[13px] font-semibold truncate">FIBA Americas</div>
            <div className="text-2xs text-navy-300 font-medium tracking-wide truncate">{t('app.subtitle') || 'Nominations'}</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {!sidebarCollapsed && (
            <div className="text-2xs font-semibold text-navy-400 uppercase tracking-wider px-2.5 mb-1.5 mt-1">
              Operación
            </div>
          )}
          {navItems.map(item => {
            const IconComp = moduleIcon[item.module] || Icon.Dashboard
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                title={sidebarCollapsed ? item.label : undefined}
                className={({ isActive }) =>
                  `w-full flex items-center gap-3 px-2.5 h-9 text-[13.5px] rounded-md transition-colors relative ${
                    isActive
                      ? 'bg-navy-800 text-white font-medium'
                      : 'text-navy-200 hover:bg-navy-800/60 hover:text-white'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && (
                      <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-basketball-500" />
                    )}
                    <IconComp className="w-[18px] h-[18px] flex-shrink-0" />
                    <span className={`flex-1 text-left truncate ${sidebarCollapsed ? 'md:hidden' : ''}`}>
                      {item.label}
                    </span>
                  </>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Bottom: user card + collapse */}
        <div className="border-t border-navy-800 p-3 space-y-2 flex-shrink-0">
          <UserCard collapsed={sidebarCollapsed} />
          {!sidebarCollapsed && <LanguageSwitcher />}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="hidden md:flex w-full items-center justify-center py-1.5 text-navy-300 hover:text-white transition-colors"
            title={sidebarCollapsed ? 'Expand' : 'Collapse'}
          >
            <svg className={`w-4 h-4 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-14 px-4 md:px-6 bg-white dark:bg-navy-900 border-b border-ink-200 dark:border-navy-800 flex items-center gap-3 flex-shrink-0">
          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="md:hidden p-1.5 -ml-1.5 rounded-md text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-navy-800"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>

          <div className="flex-1 min-w-0">
            <h1 className="text-[15px] md:text-[17px] font-semibold text-navy-900 dark:text-white tracking-tight truncate">
              FIBA Americas
            </h1>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setDark(d => !d)}
              aria-label="Toggle theme"
              title="Toggle theme"
              className="w-9 h-9 inline-flex items-center justify-center rounded-md text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-navy-800 transition-colors"
            >
              {dark ? <Icon.Sun className="w-[18px] h-[18px]" /> : <Icon.Moon className="w-[18px] h-[18px]" />}
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6 lg:p-8 max-w-[1440px] mx-auto screen-enter">
            <Suspense fallback={
              <div className="flex items-center justify-center py-20">
                <div className="w-6 h-6 border-2 border-basketball-500 border-t-transparent rounded-full animate-spin" />
              </div>
            }>
              <Routes>
                <Route path="/" element={<Navigate to={defaultRoute} replace />} />
                <Route path="/calendar"        element={<PermissionGuard module="calendar"><Calendar /></PermissionGuard>} />
                <Route path="/nominations"     element={<PermissionGuard module="nominations"><Nominations /></PermissionGuard>} />
                <Route path="/personnel"       element={<PermissionGuard module="personnel"><Personnel /></PermissionGuard>} />
                <Route path="/competitions"    element={<PermissionGuard module="competitions"><Competitions /></PermissionGuard>} />
                <Route path="/templates"       element={<PermissionGuard module="templates"><Templates /></PermissionGuard>} />
                <Route path="/users"           element={<PermissionGuard module="users"><Users /></PermissionGuard>} />
                <Route path="/availability"    element={<PermissionGuard module="availability"><Availability /></PermissionGuard>} />
                <Route path="/transport"       element={<PermissionGuard module="transport"><Transport /></PermissionGuard>} />
                <Route path="/training"        element={<PermissionGuard module="training"><Training /></PermissionGuard>} />
                <Route path="/games"           element={<PermissionGuard module="games"><Games /></PermissionGuard>} />
                <Route path="/inventory"       element={<PermissionGuard module="assets"><Assets /></PermissionGuard>} />
                <Route path="/inventory/:id"   element={<PermissionGuard module="assets"><AssetDetail /></PermissionGuard>} />
                <Route path="/loans"           element={<PermissionGuard module="loans"><Loans /></PermissionGuard>} />
                <Route path="/scan"            element={<PermissionGuard module="assets"><Scan /></PermissionGuard>} />
                <Route path="/employees"       element={<PermissionGuard module="employees"><Employees /></PermissionGuard>} />
              </Routes>
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  )
}

function LanguageSwitcher() {
  const { lang, setLang } = useLanguage()
  return (
    <div className="flex items-center gap-0.5 bg-navy-800 rounded-md p-0.5">
      <button
        onClick={() => setLang('es')}
        className={`flex-1 px-2 py-1 rounded text-2xs font-semibold transition-all ${
          lang === 'es'
            ? 'bg-basketball-500 text-white'
            : 'text-navy-300 hover:text-white'
        }`}
      >
        ES
      </button>
      <button
        onClick={() => setLang('en')}
        className={`flex-1 px-2 py-1 rounded text-2xs font-semibold transition-all ${
          lang === 'en'
            ? 'bg-basketball-500 text-white'
            : 'text-navy-300 hover:text-white'
        }`}
      >
        EN
      </button>
    </div>
  )
}

function UserCard({ collapsed }) {
  const { signOut, user, isSuperadmin } = useAuth()
  const initial = (user.email || '?')[0].toUpperCase()
  const role = isSuperadmin ? 'Superadmin' : 'Usuario'

  if (collapsed) {
    return (
      <div className="hidden md:flex flex-col items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-basketball-500/20 text-basketball-300 flex items-center justify-center text-xs font-semibold">
          {initial}
        </div>
        <button
          onClick={signOut}
          title="Cerrar sesión"
          className="text-navy-300 hover:text-white"
        >
          <Icon.Logout className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2.5">
      <div className="w-8 h-8 rounded-full bg-basketball-500/20 text-basketball-300 flex items-center justify-center text-xs font-semibold flex-shrink-0">
        {initial}
      </div>
      <div className="flex-1 min-w-0 leading-tight">
        <div className="text-[13px] font-medium text-white truncate">{user.email}</div>
        <div className="text-2xs text-navy-300 truncate">{role}</div>
      </div>
      <button
        onClick={signOut}
        title="Cerrar sesión"
        className="text-navy-300 hover:text-white flex-shrink-0"
      >
        <Icon.Logout className="w-4 h-4" />
      </button>
    </div>
  )
}
