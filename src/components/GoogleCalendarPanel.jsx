import { useCallback, useEffect, useRef, useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import { Icon } from '../lib/icons'
import { Button, useToast } from './ui'
import {
  getGoogleCalendar, connectGoogleCalendar, syncGoogleCalendar, disconnectGoogleCalendar,
} from '../api/client'

// Pestaña "Google Calendar" de Mi perfil. La conexión es de quien está
// logueado (/api/me/google-calendar): conectar manda a Google y vuelve por
// /google/callback (pages/GoogleCallback.jsx). La primera sync corre en
// segundo plano en el backend, así que mientras no haya `last_synced_at` se
// vuelve a preguntar cada pocos segundos.
const POLL_MS = 4000
const POLL_MAX = 20

export default function GoogleCalendarPanel({ active }) {
  const { t, lang } = useLanguage()
  const { push } = useToast()
  const [status, setStatus] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [busy, setBusy] = useState(null)          // 'connect' | 'sync' | 'disconnect'
  const [confirm, setConfirm] = useState(false)
  const [deleteCalendar, setDeleteCalendar] = useState(true)
  const polls = useRef(0)

  const load = useCallback(() => {
    setLoadError(false)
    return getGoogleCalendar().then(setStatus).catch(() => setLoadError(true))
  }, [])

  useEffect(() => {
    if (!active) { setConfirm(false); return }
    polls.current = 0
    setGaveUp(false)
    load()
  }, [active, load])

  const firstSyncPending = !!status?.connected && !status.last_synced_at && !status.last_sync_error
  // Después de POLL_MAX se deja de esperar: el botón se habilita para que la
  // persona no quede trabada si la sync inicial murió sin dejar error.
  const [gaveUp, setGaveUp] = useState(false)
  useEffect(() => {
    if (!active || !firstSyncPending) return
    if (polls.current >= POLL_MAX) { setGaveUp(true); return }
    const id = setTimeout(() => { polls.current += 1; load() }, POLL_MS)
    return () => clearTimeout(id)
  }, [active, firstSyncPending, status, load])

  const errorDetail = (err, fallback) => err?.response?.data?.detail || t(fallback)

  async function onConnect() {
    setBusy('connect')
    try {
      const { auth_url } = await connectGoogleCalendar()
      window.location.assign(auth_url)
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, 'googleCalendar.errorConnect') })
      setBusy(null)
    }
  }

  async function onSync() {
    setBusy('sync')
    try {
      const res = await syncGoogleCalendar()
      setStatus(res)
      push({ type: 'success', title: t('googleCalendar.synced') })
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, 'googleCalendar.errorSync') })
      load()
    } finally {
      setBusy(null)
    }
  }

  async function onDisconnect() {
    setBusy('disconnect')
    try {
      setStatus(await disconnectGoogleCalendar(deleteCalendar))
      setConfirm(false)
      push({ type: 'success', title: t('googleCalendar.disconnected') })
    } catch (err) {
      push({ type: 'error', title: errorDetail(err, 'googleCalendar.errorDisconnect') })
    } finally {
      setBusy(null)
    }
  }

  const fmt = (iso) => iso ? new Date(iso).toLocaleString(lang === 'es' ? 'es' : 'en-US', {
    dateStyle: 'medium', timeStyle: 'short',
  }) : null

  if (loadError) {
    return (
      <div role="alert" className="flex flex-col items-center gap-2 py-4">
        <p className="text-xs text-danger-600 dark:text-danger-100 text-center">{t('googleCalendar.errorLoad')}</p>
        <Button variant="secondary" size="sm" onClick={load}>{t('myProfile.retry')}</Button>
      </div>
    )
  }

  if (!status) {
    return (
      <div role="status" className="py-6 flex justify-center">
        <span className="sr-only">{t('common.loading')}</span>
        <div className="w-5 h-5 border-2 border-basketball-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!status.configured) {
    return <p className="text-xs text-ink-500 dark:text-ink-400 text-center py-4">{t('googleCalendar.notConfigured')}</p>
  }

  if (!status.connected) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-[13px] text-ink-700 dark:text-ink-200">{t('googleCalendar.intro')}</p>
        <p className="text-2xs text-ink-500 dark:text-ink-400">{t('googleCalendar.introScope')}</p>
        {status.last_sync_error && (
          <p role="alert" className="text-xs text-danger-600 dark:text-danger-100">{status.last_sync_error}</p>
        )}
        <Button icon={<Icon.Calendar />} onClick={onConnect} disabled={!!busy}>
          {busy === 'connect' ? t('googleCalendar.redirecting') : t('googleCalendar.connect')}
        </Button>
      </div>
    )
  }

  return (
    <div className="w-full flex flex-col gap-3">
      <dl className="w-full grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
        <dt className="text-ink-500 dark:text-ink-400">{t('googleCalendar.account')}</dt>
        <dd className="text-ink-900 dark:text-ink-50 break-all">{status.google_email || '—'}</dd>
        <dt className="text-ink-500 dark:text-ink-400">{t('googleCalendar.lastSync')}</dt>
        <dd className="text-ink-900 dark:text-ink-50">
          {firstSyncPending && !gaveUp ? t('googleCalendar.firstSync') : (fmt(status.last_synced_at) || '—')}
        </dd>
        <dt className="text-ink-500 dark:text-ink-400">{t('googleCalendar.events')}</dt>
        <dd className="text-ink-900 dark:text-ink-50 tabular-nums">{status.events_count ?? '—'}</dd>
      </dl>

      {status.last_sync_error && (
        <p role="alert" className="text-xs text-danger-600 dark:text-danger-100">{status.last_sync_error}</p>
      )}
      <p className="text-2xs text-ink-500 dark:text-ink-400">{t('googleCalendar.howItWorks')}</p>

      {confirm ? (
        <div className="flex flex-col gap-2 rounded-md border border-ink-200 dark:border-navy-700 p-3">
          <p className="text-[13px] text-ink-700 dark:text-ink-200">{t('googleCalendar.confirmDisconnect')}</p>
          <label className="flex items-center gap-2 text-xs text-ink-700 dark:text-ink-200">
            <input
              type="checkbox"
              checked={deleteCalendar}
              onChange={e => setDeleteCalendar(e.target.checked)}
              className="rounded border-ink-300"
            />
            {t('googleCalendar.deleteCalendar')}
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirm(false)} disabled={!!busy}>{t('common.cancel')}</Button>
            <Button variant="danger" size="sm" onClick={onDisconnect} disabled={!!busy}>
              {busy === 'disconnect' ? t('common.saving') : t('googleCalendar.disconnect')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="ghost" size="sm" icon={<Icon.Trash />} onClick={() => setConfirm(true)} disabled={!!busy}>
            {t('googleCalendar.disconnect')}
          </Button>
          <Button variant="secondary" size="sm" icon={<Icon.Refresh />} onClick={onSync} disabled={!!busy || (firstSyncPending && !gaveUp)}>
            {busy === 'sync' ? t('googleCalendar.syncing') : t('googleCalendar.syncNow')}
          </Button>
        </div>
      )}
    </div>
  )
}
