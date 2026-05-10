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
    <div className="min-h-screen bg-navy-900 flex items-center justify-center relative overflow-hidden p-4">
      {/* Subtle dot pattern */}
      <div className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, #F57C2A 1px, transparent 0)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Basketball glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-basketball-500/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-basketball-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-pop">
            <svg viewBox="0 0 64 64" className="w-10 h-10">
              <path d="M18 14 L44 14 L44 22 L26 22 L26 30 L40 30 L40 38 L26 38 L26 50 L18 50 Z" fill="#fff"/>
              <path d="M14 38 Q32 56 50 38" stroke="#0c2340" strokeWidth="3" fill="none" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">FIBA Americas</h1>
          <p className="text-sm text-navy-300 mt-1">{t('app.subtitle')}</p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-navy-800 rounded-2xl p-8 shadow-pop">
          {/* Language toggle */}
          <div className="flex items-center justify-center gap-0.5 mb-6 bg-ink-100 dark:bg-navy-900 rounded-md p-0.5 max-w-[140px] mx-auto">
            <button onClick={() => setLang('es')}
              className={`flex-1 px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                lang === 'es' ? 'bg-basketball-500 text-white' : 'text-ink-500 dark:text-ink-400 hover:text-ink-900 dark:hover:text-white'
              }`}>
              ES
            </button>
            <button onClick={() => setLang('en')}
              className={`flex-1 px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                lang === 'en' ? 'bg-basketball-500 text-white' : 'text-ink-500 dark:text-ink-400 hover:text-ink-900 dark:hover:text-white'
              }`}>
              EN
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-danger-50 dark:bg-danger-700/20 border border-danger-200 dark:border-danger-700/40 text-danger-700 dark:text-danger-100 text-sm px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-ink-700 dark:text-ink-300 mb-1.5">
                {t('login.email')}
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t('login.placeholder_email')}
                className="w-full bg-white dark:bg-navy-900 border border-ink-300 dark:border-navy-700 text-ink-900 dark:text-ink-100 rounded-lg px-3 py-2.5 text-sm
                           placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-navy-500/30 focus:border-navy-500
                           transition-all duration-150"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-ink-700 dark:text-ink-300 mb-1.5">
                {t('login.password')}
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-white dark:bg-navy-900 border border-ink-300 dark:border-navy-700 text-ink-900 dark:text-ink-100 rounded-lg px-3 py-2.5 text-sm
                           placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-navy-500/30 focus:border-navy-500
                           transition-all duration-150"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-basketball-500 hover:bg-basketball-600 active:bg-basketball-700 text-white font-semibold px-4 py-2.5 rounded-lg
                         transition-all duration-150 text-sm shadow-card disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {t('login.submitting')}
                </span>
              ) : t('login.submit')}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-navy-300 mt-6">
          © {new Date().getFullYear()} FIBA Americas
        </p>
      </div>
    </div>
  )
}
