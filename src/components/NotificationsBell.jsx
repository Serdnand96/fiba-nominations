import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { Icon } from '../lib/icons'
import { Button, Empty } from './ui'
import {
  getNotifications,
  getPendingInbox,
  markNotificationRead,
  markAllNotificationsRead,
} from '../api/client'

// Campana del topbar (WP6). Dos fuentes, a propósito separadas:
//  - "Novedades": filas persistidas en `notifications`, se marcan leídas.
//  - "Pendientes": contadores calculados en vivo por el backend según los
//    permisos del usuario (no se marcan leídos: desaparecen al resolverse).
// El badge suma las dos. Sin cron ni websockets: poll cada 60 s y refetch al
// volver a la pestaña.

const POLL_MS = 60_000
const PAGE_SIZE = 20

// Tono del punto por `kind`. Desconocido → neutro (el backend puede sumar
// kinds antes que el frontend).
const kindTone = {
  expense_submitted:        'bg-info-500',
  expense_approved:         'bg-success-500',
  expense_rejected:         'bg-danger-500',
  expense_paid:             'bg-success-500',
  payment_tax_form_missing: 'bg-warning-500',
  payment_completed:        'bg-success-500',
  payment_cancelled:        'bg-danger-500',
}

function useTimeAgo() {
  const { t, lang } = useLanguage()
  return useCallback((iso) => {
    if (!iso) return ''
    const diff = Math.max(0, Date.now() - new Date(iso).getTime())
    const min = Math.floor(diff / 60000)
    if (min < 1) return t('notifications.justNow')
    if (min < 60) return t('notifications.minutesAgo', { n: min })
    const h = Math.floor(min / 60)
    if (h < 24) return t('notifications.hoursAgo', { n: h })
    const d = Math.floor(h / 24)
    if (d < 7) return t('notifications.daysAgo', { n: d })
    return new Date(iso).toLocaleDateString(lang === 'es' ? 'es' : 'en', { day: '2-digit', month: 'short' })
  }, [t, lang])
}

// Un kind/key sin traducción devuelve la clave cruda desde t(): en ese caso
// mejor no mostrar nada que mostrar "notifications.kinds.foo".
function translated(t, key) {
  const v = t(key)
  return v === key ? null : v
}

export default function NotificationsBell() {
  const { user } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const timeAgo = useTimeAgo()

  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [pending, setPending] = useState([])
  const [loaded, setLoaded] = useState(false)
  const rootRef = useRef(null)
  const buttonRef = useRef(null)

  const userId = user?.id || null

  // allSettled: si una de las dos falla (p.ej. el backend todavía no tiene el
  // endpoint) la otra igual se muestra; el error se traga en silencio porque
  // la campana no debe romper el shell.
  const refresh = useCallback(async () => {
    if (!userId) return
    const [notifs, inbox] = await Promise.allSettled([
      getNotifications({ limit: PAGE_SIZE }),
      getPendingInbox(),
    ])
    if (notifs.status === 'fulfilled') {
      setItems(Array.isArray(notifs.value?.items) ? notifs.value.items : [])
      setUnreadCount(Number(notifs.value?.unread_count) || 0)
    }
    if (inbox.status === 'fulfilled') {
      setPending(Array.isArray(inbox.value) ? inbox.value.filter(p => p && p.count > 0) : [])
    }
    setLoaded(true)
  }, [userId])

  // Poll + refetch al volver a la pestaña. Sin usuario no se pollea nada.
  useEffect(() => {
    if (!userId) {
      setItems([]); setUnreadCount(0); setPending([]); setLoaded(false)
      return
    }
    refresh()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId, refresh])

  // Cerrar con click afuera y Escape (mismo patrón que MultiSelect).
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus() }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => {
    if (!open) refresh()
    setOpen(!open)
  }

  const go = (link) => {
    if (!link) return
    setOpen(false)
    navigate(link)
  }

  const openItem = (n) => {
    if (!n.read_at) {
      // Optimista: se marca en pantalla y se corrige con el contador real.
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
      setUnreadCount(c => Math.max(0, c - 1))
      markNotificationRead(n.id)
        .then(r => { if (r && typeof r.unread_count === 'number') setUnreadCount(r.unread_count) })
        .catch(() => refresh())
    }
    go(n.link)
  }

  const markAll = async () => {
    const now = new Date().toISOString()
    setItems(prev => prev.map(x => x.read_at ? x : { ...x, read_at: now }))
    setUnreadCount(0)
    try {
      const r = await markAllNotificationsRead()
      if (r && typeof r.unread_count === 'number') setUnreadCount(r.unread_count)
    } catch {
      refresh()
    }
  }

  if (!userId) return null

  const pendingTotal = pending.reduce((s, p) => s + (Number(p.count) || 0), 0)
  const total = unreadCount + pendingTotal
  const badge = total > 99 ? '99+' : String(total)
  const label = total > 0 ? `${t('notifications.title')} (${badge})` : t('notifications.title')

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={label}
        title={t('notifications.title')}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`relative w-9 h-9 inline-flex items-center justify-center rounded-md transition-colors text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-navy-800 ${open ? 'bg-ink-100 dark:bg-navy-800' : ''}`}
      >
        <Icon.Bell className="w-[18px] h-[18px]" />
        {total > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full bg-danger-600 text-white text-[10px] font-semibold leading-none ring-2 ring-white dark:ring-navy-900 tabular-nums">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t('notifications.title')}
          className="absolute right-0 top-full mt-2 z-30 w-[22rem] max-w-[calc(100vw-1.5rem)] bg-white dark:bg-navy-800 rounded-lg shadow-pop border border-ink-200 dark:border-navy-700 overflow-hidden"
        >
          <div className="px-4 h-11 flex items-center justify-between border-b border-ink-100 dark:border-navy-700">
            <div className="text-[13.5px] font-semibold text-ink-900 dark:text-white">{t('notifications.title')}</div>
            <Button variant="link" size="xs" className="px-0" onClick={markAll} disabled={unreadCount === 0}>
              {t('notifications.markAllRead')}
            </Button>
          </div>

          <div className="max-h-[70vh] overflow-y-auto">
            {pending.length > 0 && (
              <section className="px-4 py-3 border-b border-ink-100 dark:border-navy-700">
                <div className="text-2xs font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400 mb-2">
                  {t('notifications.pendingTitle')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pending.map(p => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => go(p.link)}
                      className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1 rounded-md border border-ink-200 dark:border-navy-600 bg-ink-50 dark:bg-navy-900 text-xs font-medium text-ink-700 dark:text-ink-100 hover:border-ink-300 hover:bg-ink-100 dark:hover:bg-navy-700 transition-colors"
                    >
                      <span>{translated(t, `notifications.pending.${p.key}`) || p.key}</span>
                      <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded bg-navy-700 text-white text-[10px] font-semibold tabular-nums">
                        {p.count > 99 ? '99+' : p.count}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="py-2">
              <div className="px-4 pt-1 pb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400">
                {t('notifications.newsTitle')}
              </div>
              {!loaded ? (
                <div className="flex items-center justify-center py-8">
                  <div className="w-5 h-5 border-2 border-basketball-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : items.length === 0 ? (
                <div className="[&>div]:py-6">
                  <Empty icon={<Icon.Bell />} title={t('notifications.empty')} body={t('notifications.emptyBody')} />
                </div>
              ) : (
                <ul>
                  {items.map(n => {
                    const unread = !n.read_at
                    const kindLabel = translated(t, `notifications.kinds.${n.kind}`)
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => openItem(n)}
                          className={`w-full text-left flex gap-3 px-4 py-2.5 transition-colors hover:bg-ink-50 dark:hover:bg-navy-700 ${unread ? 'bg-navy-50/60 dark:bg-navy-900/40' : ''}`}
                        >
                          <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${unread ? (kindTone[n.kind] || 'bg-ink-400') : 'bg-transparent'}`} />
                          <span className="flex-1 min-w-0">
                            {kindLabel && (
                              <span className="block text-2xs font-medium text-ink-500 dark:text-ink-400 truncate">{kindLabel}</span>
                            )}
                            <span className={`block text-[13px] leading-snug text-ink-900 dark:text-white ${unread ? 'font-semibold' : 'font-normal'}`}>
                              {n.title || kindLabel || n.kind}
                            </span>
                            {n.body && (
                              <span className="block text-xs text-ink-500 dark:text-ink-400 mt-0.5 line-clamp-2">{n.body}</span>
                            )}
                            <span className="block text-2xs text-ink-400 dark:text-ink-500 mt-1">{timeAgo(n.created_at)}</span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
