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
    <div className="min-h-screen bg-fiba-dark flex items-center justify-center relative overflow-hidden">
      {/* Background pattern */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, #F2FE5A 1px, transparent 0)`,
          backgroundSize: '40px 40px',
        }}
      />

      {/* Accent glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-fiba-accent/5 rounded-full blur-[120px]" />

      <div className="relative z-10 w-full max-w-sm">
        {/* Logo card */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-fiba-accent rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-fiba-accent/20">
            <svg className="w-9 h-9 text-fiba-dark" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.79 3 4s-1.34 4-3 4-3-1.79-3-4 1.34-4 3-4z" opacity="0.3" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">FIBA Americas</h1>
          <p className="text-sm text-fiba-muted mt-1">{t('app.subtitle')}</p>
        </div>

        {/* Login form */}
        <div className="bg-fiba-card border border-fiba-border rounded-2xl p-8 shadow-2xl">
          {/* Language toggle */}
          <div className="flex items-center justify-center gap-0.5 mb-6 bg-fiba-surface rounded-lg p-0.5 max-w-[140px] mx-auto">
            <button onClick={() => setLang('es')}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                lang === 'es' ? 'bg-fiba-accent text-fiba-dark' : 'text-fiba-muted hover:text-white'
              }`}>
              ES
            </button>
            <button onClick={() => setLang('en')}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                lang === 'en' ? 'bg-fiba-accent text-fiba-dark' : 'text-fiba-muted hover:text-white'
              }`}>
              EN
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            <div>
              <label className="fiba-label">{t('login.email')}</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="fiba-input"
                placeholder={t('login.placeholder_email')}
              />
            </div>

            <div>
              <label className="fiba-label">{t('login.password')}</label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="fiba-input"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-fiba w-full"
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
      </div>
    </div>
  )
}
