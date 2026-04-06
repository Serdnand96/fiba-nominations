import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import Nominations from './pages/Nominations'
import Personnel from './pages/Personnel'
import Competitions from './pages/Competitions'
import Templates from './pages/Templates'

const navItems = [
  { to: '/nominations', label: 'Nominaciones' },
  { to: '/personnel', label: 'Personal' },
  { to: '/competitions', label: 'Competencias' },
  { to: '/templates', label: 'Templates' },
]

export default function App() {
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
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8">
          <Routes>
            <Route path="/" element={<Navigate to="/nominations" replace />} />
            <Route path="/nominations" element={<Nominations />} />
            <Route path="/personnel" element={<Personnel />} />
            <Route path="/competitions" element={<Competitions />} />
            <Route path="/templates" element={<Templates />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}
