import { useEffect, useRef, useState } from 'react'
import { getActivityLog } from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'

const PAGE_SIZE = 50

// Modules that can appear in the log (router prefixes under /api).
const MODULE_OPTIONS = [
  'nominations', 'payments', 'personnel', 'competitions', 'templates',
  'users', 'calendar', 'transport', 'availability', 'training', 'games',
  'assets', 'loans', 'employees', 'permissions',
]

// HTTP method → semantic badge. POST also covers actions like generate or
// rotate; the path column carries the exact operation.
const ACTION_STYLE = {
  POST:   { labelKey: 'activity.created', cls: 'bg-emerald-500/20 text-emerald-400' },
  PUT:    { labelKey: 'activity.updated', cls: 'bg-blue-500/20 text-blue-400' },
  PATCH:  { labelKey: 'activity.updated', cls: 'bg-blue-500/20 text-blue-400' },
  DELETE: { labelKey: 'activity.deleted', cls: 'bg-red-500/20 text-red-400' },
}

export default function Activity() {
  const { t, lang } = useLanguage()

  const [items, setItems] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)

  const [email, setEmail] = useState('')
  const [module, setModule] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Drop out-of-order responses (slow request resolving after a newer one).
  const requestSeq = useRef(0)

  function buildParams(offset) {
    const params = { limit: PAGE_SIZE, offset }
    if (email.trim()) params.user_email = email.trim()
    if (module) params.module = module
    if (dateFrom) params.date_from = dateFrom
    if (dateTo) params.date_to = dateTo
    return params
  }

  async function load() {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(false)
    try {
      const data = await getActivityLog(buildParams(0))
      if (seq !== requestSeq.current) return
      setItems(data.items)
      setHasMore(data.has_more)
    } catch (e) {
      console.error(e)
      if (seq === requestSeq.current) setError(true)
    }
    if (seq === requestSeq.current) setLoading(false)
  }

  async function loadMore() {
    const seq = requestSeq.current
    setLoadingMore(true)
    try {
      const data = await getActivityLog(buildParams(items.length))
      if (seq !== requestSeq.current) return
      setItems(prev => [...prev, ...data.items])
      setHasMore(data.has_more)
    } catch (e) { console.error(e) }
    setLoadingMore(false)
  }

  // Reload on any filter change; the timeout debounces typing in the email box.
  useEffect(() => {
    const id = setTimeout(load, 300)
    return () => clearTimeout(id)
  }, [email, module, dateFrom, dateTo]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasFilters = email || module || dateFrom || dateTo

  function clearFilters() {
    setEmail('')
    setModule('')
    setDateFrom('')
    setDateTo('')
  }

  function moduleLabel(m) {
    if (!m) return '—'
    if (m === 'assets') return t('nav.inventory')
    if (m === 'permissions') return t('activity.permissionsModule')
    const label = t(`nav.${m}`)
    return label === `nav.${m}` ? m : label
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleString(lang === 'es' ? 'es' : 'en', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-ink-900 dark:text-white">{t('activity.title')}</h2>
        <p className="text-sm text-fiba-muted mt-1">{t('activity.subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder={t('activity.searchPlaceholder')}
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="fiba-input w-full md:w-72"
        />
        <select
          value={module}
          onChange={e => setModule(e.target.value)}
          className="fiba-select !w-auto min-w-[180px] flex-shrink-0"
        >
          <option value="">{t('activity.allModules')}</option>
          {MODULE_OPTIONS.map(m => <option key={m} value={m}>{moduleLabel(m)}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-fiba-muted flex-shrink-0">
          {t('activity.from')}
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="fiba-input !w-auto" />
        </label>
        <label className="flex items-center gap-2 text-sm text-fiba-muted flex-shrink-0">
          {t('activity.to')}
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="fiba-input !w-auto" />
        </label>
        {hasFilters && (
          <button onClick={clearFilters} className="text-sm text-fiba-accent hover:underline flex-shrink-0">
            {t('activity.clearFilters')}
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-fiba-muted text-sm py-10">{t('common.loading')}</div>
      ) : error ? (
        <div className="text-red-400 text-sm py-10">{t('activity.errorLoading')}</div>
      ) : (
        <>
          <div className="rounded-xl border border-fiba-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="fiba-table">
                <thead>
                  <tr>
                    <th>{t('activity.date')}</th>
                    <th>{t('activity.user')}</th>
                    <th>{t('common.action')}</th>
                    <th>{t('activity.module')}</th>
                    <th>{t('activity.detail')}</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(r => {
                    const style = ACTION_STYLE[r.action] || { labelKey: null, cls: 'bg-gray-500/20 text-ink-500 dark:text-gray-400' }
                    return (
                      <tr key={r.id}>
                        <td className="px-4 py-3 text-sm whitespace-nowrap text-fiba-muted">{formatDate(r.created_at)}</td>
                        <td className="px-4 py-3 text-sm font-medium text-ink-900 dark:text-white">{r.user_email || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${style.cls}`}>
                            {style.labelKey ? t(style.labelKey) : r.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm">{moduleLabel(r.module)}</td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs text-fiba-muted break-all">
                            {r.action} {r.path.replace(/^\/api/, '')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-fiba-muted whitespace-nowrap">{r.ip || '—'}</td>
                      </tr>
                    )
                  })}
                  {items.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-fiba-muted">{t('activity.noActivity')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-fiba-muted">{t('activity.retentionNote')}</p>
            {hasMore && (
              <button onClick={loadMore} disabled={loadingMore} className="btn-fiba disabled:opacity-50">
                {loadingMore ? t('common.loading') : t('activity.loadMore')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
