import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Login from './pages/Login'
import Nominations from './pages/Nominations'
import Personnel from './pages/Personnel'
import Competitions from './pages/Competitions'
import Templates from './pages/Templates'
import Users from './pages/Users'
import Calendar from './pages/Calendar'

const navItems = [
  { to: '/calendar', label: 'Calendario' },
  { to: '/nominations', label: 'Nominaciones' },
  { to: '/personnel', label: 'Personal' },
  { to: '/competitions', label: 'Competencias' },
  { to: '/templates', label: 'Templates' },
  { to: '/users', label: 'Usuarios' },
]

export default function App() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-400 text-sm">Cargando...</div>
      </div>
    )
  }

  if (!user) {
    return <Login />
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-lg font-bold text-blue-900">FIBA Americas</h1>
          <p className="text-xs text-gray-500 mt-1">Nominations System</p>
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
          <LogoutButton />
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8">
          <Routes>
            <Route path="/" element={<Navigate to="/calendar" replace />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/nominations" element={<Nominations />} />
            <Route path="/personnel" element={<Personnel />} />
            <Route path="/competitions" element={<Competitions />} />
            <Route path="/templates" element={<Templates />} />
            <Route path="/users" element={<Users />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

function LogoutButton() {
  const { signOut, user } = useAuth()
  return (
    <div>
      <p className="text-xs text-gray-500 truncate mb-2">{user.email}</p>
      <button
        onClick={signOut}
        className="w-full text-left text-sm text-gray-600 hover:text-red-600 transition-colors"
      >
        Cerrar sesión
      </button>
    </div>
  )
}
