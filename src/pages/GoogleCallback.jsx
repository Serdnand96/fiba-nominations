import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLanguage } from '../i18n/LanguageContext'
import { Button, useToast } from '../components/ui'
import { finishGoogleCalendar } from '../api/client'

// Vuelta del OAuth de Google (redirect URI `/google/callback`). Le pasa `code`
// y `state` al backend con el JWT y vuelve a Mi perfil → Google Calendar. El
// backend valida que el state sea de este usuario y no haya vencido.
export default function GoogleCallback() {
  const { t } = useLanguage()
  const { push } = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [error, setError] = useState(null)
  const sent = useRef(false)   // StrictMode monta dos veces: el code sirve una sola

  useEffect(() => {
    if (sent.current) return
    sent.current = true
    const back = () => navigate('/?profile=google', { replace: true })
    const code = params.get('code')
    const state = params.get('state')
    if (params.get('error') || !code || !state) {
      // La persona canceló en Google (error=access_denied) o el link vino roto.
      push({ type: 'error', title: t('googleCalendar.cancelled') })
      back()
      return
    }
    finishGoogleCalendar(code, state)
      .then(() => {
        push({ type: 'success', title: t('googleCalendar.connected') })
        back()
      })
      .catch(err => setError(err?.response?.data?.detail || t('googleCalendar.errorConnect')))
  }, [params, navigate, push, t])

  return (
    <div className="max-w-md mx-auto py-16 flex flex-col items-center gap-4 text-center">
      {error ? (
        <>
          <p role="alert" className="text-sm text-danger-600 dark:text-danger-100">{error}</p>
          <Button variant="secondary" onClick={() => navigate('/?profile=google', { replace: true })}>
            {t('googleCalendar.backToProfile')}
          </Button>
        </>
      ) : (
        <div role="status" className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-basketball-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-ink-500 dark:text-ink-400">{t('googleCalendar.finishing')}</span>
        </div>
      )}
    </div>
  )
}
