import { useEffect, useState } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import {
  getLogisticsLink, rotateLogisticsLink, toggleLogisticsLink, getLogisticsLinkQr,
} from '../../api/client'
import { Icon } from '../../lib/icons'

// Panel para compartir la logística de una competencia con el personal.
//
// Un link secreto por competencia, sin cuentas de por medio. Es la forma de
// que un árbitro que llega a Ezeiza mire su traslado desde el celular sin
// pedirle a nadie que le reenvíe una planilla.

export default function SharePanel({ competitionId, competitionName, onClose }) {
  const { lang } = useLanguage()
  const t = (es, en) => (lang === 'es' ? es : en)

  const [link, setLink] = useState(null)
  const [qrUrl, setQrUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    let createdUrl = null
    setLoading(true)
    getLogisticsLink(competitionId)
      .then(async (l) => {
        if (cancelled) return
        setLink(l)
        try {
          createdUrl = await getLogisticsLinkQr(competitionId)
          if (!cancelled) setQrUrl(createdUrl)
          else URL.revokeObjectURL(createdUrl)
        } catch { /* el QR es un extra: sin él el link sigue sirviendo */ }
      })
      .catch(err => { if (!cancelled) setError(err.response?.data?.detail || t('No se pudo obtener el enlace.', 'Could not load the link.')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; if (createdUrl) URL.revokeObjectURL(createdUrl) }
  }, [competitionId])

  async function refreshQr() {
    try {
      const next = await getLogisticsLinkQr(competitionId)
      setQrUrl(prev => { if (prev) URL.revokeObjectURL(prev); return next })
    } catch { /* no-op */ }
  }

  async function handleCopy() {
    if (!link?.url) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError(t('El navegador bloqueó el portapapeles. Copia el enlace a mano.',
                 'The browser blocked the clipboard. Copy the link manually.'))
    }
  }

  async function handleRotate() {
    if (!confirm(t('Se va a generar un enlace nuevo y el actual dejará de funcionar. ¿Continuar?',
                   'A new link will be generated and the current one will stop working. Continue?'))) return
    try {
      setLink(await rotateLogisticsLink(competitionId))
      await refreshQr()
    } catch (err) { setError(err.response?.data?.detail || t('No se pudo generar el enlace nuevo.', 'Could not generate the new link.')) }
  }

  async function handleToggle() {
    try {
      setLink(await toggleLogisticsLink(competitionId, !link.enabled))
    } catch (err) {
      setError(err.response?.data?.detail || (link.enabled
        ? t('No se pudo desactivar el enlace.', 'Could not disable the link.')
        : t('No se pudo activar el enlace.', 'Could not enable the link.')))
    }
  }

  return (
    <div className="fiba-modal-overlay">
      <div className="fiba-modal max-w-lg p-6">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 className="text-lg font-bold text-ink-900 dark:text-white">{t('Compartir logística', 'Share logistics')}</h3>
          <button onClick={onClose} aria-label={t('Cerrar', 'Close')} className="text-fiba-muted hover:text-ink-700 dark:hover:text-white">
            <Icon.X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-fiba-muted mb-4">{competitionName}</p>

        {loading && <div className="py-8 text-center text-sm text-fiba-muted">{t('Cargando...', 'Loading...')}</div>}

        {error && (
          <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">{error}</div>
        )}

        {link && (
          <div className="space-y-4">
            <div>
              <label className="fiba-label">{t('Enlace público', 'Public link')}</label>
              <div className="flex gap-2">
                <input readOnly value={link.url} onFocus={e => e.target.select()} className="fiba-input font-mono text-xs" />
                <button onClick={handleCopy} className="btn-fiba whitespace-nowrap text-xs px-3">
                  {copied ? t('Copiado', 'Copied') : t('Copiar', 'Copy')}
                </button>
              </div>
            </div>

            <div className="flex items-start gap-4">
              {qrUrl && (
                <img src={qrUrl} alt="QR" className="w-32 h-32 rounded-lg bg-white p-2 shrink-0" />
              )}
              <div className="text-xs text-fiba-muted space-y-2">
                <p>
                  {t('Cualquiera con este enlace puede ver la logística de esta competencia sin iniciar sesión.',
                     "Anyone with this link can see this competition's logistics without signing in.")}
                </p>
                <p>
                  {t('Muestra datos personales y números de pasaporte. Si el enlace se filtra, genera uno nuevo.',
                     'It shows personal data and passport numbers. If the link leaks, generate a new one.')}
                </p>
                {qrUrl && (
                  <a href={qrUrl} download={`logistica-qr.png`} className="text-fiba-accent hover:underline inline-block">
                    {t('Descargar QR', 'Download QR')}
                  </a>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-fiba-border px-3 py-2">
              <div>
                <div className="text-sm font-medium text-ink-900 dark:text-white">
                  {link.enabled ? t('Enlace activo', 'Link active') : t('Enlace desactivado', 'Link disabled')}
                </div>
                <div className="text-[11px] text-fiba-muted">
                  {link.enabled
                    ? t('El personal puede abrirlo ahora.', 'Staff can open it right now.')
                    : t('Nadie puede abrirlo.', 'Nobody can open it.')}
                </div>
              </div>
              <button onClick={handleToggle} className="btn-fiba-ghost text-xs px-3 py-1.5">
                {link.enabled ? t('Desactivar', 'Disable') : t('Activar', 'Enable')}
              </button>
            </div>

            {link.rotated_at && (
              <p className="text-[11px] text-fiba-muted">
                {t('Enlace renovado el', 'Link renewed on')} {new Date(link.rotated_at).toLocaleString(lang === 'es' ? 'es' : 'en-US')}
              </p>
            )}

            <div className="flex justify-between pt-2">
              <button onClick={handleRotate} className="text-xs text-red-400 hover:underline">
                {t('Generar enlace nuevo', 'Generate new link')}
              </button>
              <button onClick={onClose} className="btn-fiba">{t('Listo', 'Done')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
