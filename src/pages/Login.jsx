import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { LogoWordmark } from '../components/brand/Logo'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { LanguageLink } from '../components/layout/PublicShell'

export default function Login() {
  const { signIn } = useAuth()
  const { t, lang } = useLanguage()
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
      // El resto de los mensajes de Supabase llegan en inglés: se muestra uno genérico.
      setError(err.message === 'Invalid login credentials'
        ? t('login.invalidCredentials')
        : (lang === 'es' ? 'No se pudo iniciar sesión. Intenta de nuevo.' : 'Could not sign in. Try again.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-navy-900 flex flex-col p-4 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <LogoWordmark height={36} />
        <LanguageLink tone="onNavy" />
      </div>

      <div className="flex-1 flex items-center justify-center py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold text-white tracking-tight">FIBA Americas</h1>
            <p className="text-sm text-navy-300 mt-1">{t('app.subtitle')}</p>
          </div>

          <div className="bg-white dark:bg-navy-800 rounded-lg p-6 sm:p-8 shadow-card">
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div role="alert" className="bg-danger-50 dark:bg-danger-700/20 border border-danger-100 dark:border-danger-700/40 text-danger-700 dark:text-danger-100 text-sm px-4 py-3 rounded-lg">
                  {error}
                </div>
              )}

              <Input
                id="login-email"
                type="email"
                label={t('login.email')}
                autoComplete="username"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t('login.placeholder_email')}
              />

              <Input
                id="login-password"
                type="password"
                label={t('login.password')}
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
              />

              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading && (
                  <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true" />
                )}
                {loading ? t('login.submitting') : t('login.submit')}
              </Button>
            </form>
          </div>
        </div>
      </div>

      <p className="text-center text-xs text-navy-300">
        © {new Date().getFullYear()} FIBA Americas
        {/* Página estática (public/privacidad): Google exige que la portada enlace la política. */}
        {' · '}
        <a href="/privacidad/" className="underline hover:text-white">{t('login.privacy')}</a>
      </p>
    </div>
  )
}
