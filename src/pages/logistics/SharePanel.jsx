import { useEffect, useState } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import {
  getLogisticsLink, rotateLogisticsLink, toggleLogisticsLink, getLogisticsLinkQr,
} from '../../api/client'

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
      .catch(err => { if (!cancelled) setError(err.response?.data?.detail || t('No se pudo obtener el link.', 'Could not load the link.')) })
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
      setError(t('El navegador bloqueó el portapapeles. Copia el link a mano.',
                 'The browser blocked the clipboard. Copy the link manually.'))
    }
  }

  async function handleRotate() {
    if (!confirm(t('Al rotar el link, el que ya compartiste deja de funcionar. ¿Continuar?',
                   'Rotating the link stops the one you already shared from working. Continue?'))) return
    try {
      setLink(await rotateLogisticsLink(competitionId))
      await refreshQr()
    } catch (err) { setError(err.response?.data?.detail || 'Error') }
  }

  async function handleToggle() {
    try {
      setLink(await toggleLogisticsLink(competitionId, !link.enabled))
    } catch (err) { setError(err.response?.data?.detail || 'Error') }
  }

  return (
    <div className="fiba-modal-overlay">
      <div className="fiba-modal max-w-lg p-6">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 className="text-lg font-bold text-ink-900 dark:text-white">{t('Compartir logística', 'Share logistics')}</h3>
          <button onClick={onClose} className="text-fiba-muted hover:text-ink-700 dark:hover:text-white text-xl leading-none">&times;</button>
        </div>
        <p className="text-xs text-fiba-muted mb-4">{competitionName}</p>

        {loading && <div className="py-8 text-center text-sm text-fiba-muted">{t('Cargando...', 'Loading...')}</div>}

        {error && (
          <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">{error}</div>
        )}

        {link && (
          <div className="space-y-4">
            <div>
              <label className="fiba-label">{t('Link público', 'Public link')}</label>
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
                  {t('Cualquiera con este link ve el cronograma de traslados, el hospedaje y el manifiesto completos de esta competencia — sin cuenta y sin contraseña.',
                     'Anyone with this link sees this competition’s full transfer schedule, housing and manifest — no account, no password.')}
                </p>
                <p>
                  {t('Incluye los datos personales tal como están cargados, número de pasaporte incluido. Si el link se filtra, rótalo: el anterior deja de funcionar al instante.',
                     'It includes personal data exactly as loaded, passport numbers included. If the link leaks, rotate it: the old one stops working immediately.')}
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
                  {link.enabled ? t('Link activo', 'Link active') : t('Link desactivado', 'Link disabled')}
                </div>
                <div className="text-[11px] text-fiba-muted">
                  {link.enabled
                    ? t('El personal puede abrirlo ahora.', 'Staff can open it right now.')
                    : t('Quien lo abra recibe un 404.', 'Anyone opening it gets a 404.')}
                </div>
              </div>
              <button onClick={handleToggle} className="btn-fiba-ghost text-xs px-3 py-1.5">
                {link.enabled ? t('Desactivar', 'Disable') : t('Activar', 'Enable')}
              </button>
            </div>

            {link.rotated_at && (
              <p className="text-[11px] text-fiba-muted">
                {t('Última rotación', 'Last rotated')}: {new Date(link.rotated_at).toLocaleString(lang === 'es' ? 'es' : 'en-US')}
              </p>
            )}

            <div className="flex justify-between pt-2">
              <button onClick={handleRotate} className="text-xs text-red-400 hover:underline">
                {t('Rotar link', 'Rotate link')}
              </button>
              <button onClick={onClose} className="btn-fiba">{t('Listo', 'Done')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
