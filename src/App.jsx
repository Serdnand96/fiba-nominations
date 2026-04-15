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

function PermissionGuard({ module, children }) {
  const { hasView } = useAuth()
  const { t } = useLanguage()

  if (!hasView(module)) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="text-4xl text-gray-300 mb-4">403</div>
          <p className="text-gray-500 text-sm">{t('permissions.accessDenied')}</p>
        </div>
      </div>
    )
  }

  return children
}

export default function App() {
  const { user, loading, hasView, isSuperadmin } = useAuth()
  const { t } = useLanguage()

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">{t('app.loading')}</div>
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

  // Filter nav items by permission
  const navItems = allNavItems.filter(item => hasView(item.module))

  // Find first accessible route for default redirect
  const defaultRoute = navItems.length > 0 ? navItems[0].to : '/calendar'

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-lg font-bold text-blue-900">{t('app.title')}</h1>
          <p className="text-xs text-gray-500 mt-1">{t('app.subtitle')}</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-200">
          <LanguageSwitcher />
          <LogoutButton />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8">
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
    <div className="flex items-center gap-1 mb-3 bg-gray-100 rounded-lg p-0.5">
      <button
        onClick={() => setLang('es')}
        className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
          lang === 'es' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Español
      </button>
      <button
        onClick={() => setLang('en')}
        className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
          lang === 'en' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        English
      </button>
    </div>
  )
}

function LogoutButton() {
  const { signOut, user, isSuperadmin } = useAuth()
  const { t } = useLanguage()
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <p className="text-xs text-gray-500 truncate">{user.email}</p>
        {isSuperadmin && (
          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 shrink-0">SA</span>
        )}
      </div>
      <button
        onClick={signOut}
        className="w-full text-left text-sm text-gray-600 hover:text-red-600 transition-colors"
      >
        {t('app.logout')}
      </button>
    </div>
  )
}
