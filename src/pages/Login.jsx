import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'

export default function Login() {
  const { signIn } = useAuth()
  const { t, lang, setLang } = useLanguage()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(email, password)
    } catch (err) {
      setError(err.message === 'Invalid login credentials'
        ? t('login.invalidCredentials')
        : err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-blue-900">{t('app.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('app.subtitle')}</p>
        </div>

        {/* Language toggle */}
        <div className="flex items-center justify-center gap-1 mb-6 bg-gray-100 rounded-lg p-0.5 max-w-[200px] mx-auto">
          <button onClick={() => setLang('es')}
            className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${lang === 'es' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
            Español
          </button>
          <button onClick={() => setLang('en')}
            className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${lang === 'en' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
            English
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('login.email')}</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t('login.placeholder_email')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('login.password')}</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? t('login.submitting') : t('login.submit')}
          </button>
        </form>
      </div>
    </div>
  )
}
