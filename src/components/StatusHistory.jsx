import { useLanguage } from '../i18n/LanguageContext'
import { Icon } from '../lib/icons'
import { Badge, Empty } from './ui'

// Timeline del historial de estados de un gasto o de un pago
// (tabla finance_status_history, migración 046). Recibe las filas tal cual las
// devuelve `GET …/history` (más reciente primero) y no pide nada por su cuenta:
// quien la usa decide cuándo cargar y cuándo refrescar.
//
// StatusPill no sirve acá: su statusMap no cubre new/in_process/paid/rejected/
// cancelled y traduce `completed` como "Finalizada". Por eso Badge con tono
// propio por estado.
const STATUS_TONE = {
  // payments
  new:        'ink',
  in_process: 'warning',
  completed:  'success',
  // expenses
  draft:      'ink',
  approved:   'info',
  paid:       'success',
  rejected:   'danger',
  // ambos
  cancelled:  'outline',
}

const DOT_COLOR = {
  ink:     'bg-ink-400',
  warning: 'bg-warning-500',
  success: 'bg-success-500',
  info:    'bg-info-500',
  danger:  'bg-danger-500',
  outline: 'bg-ink-300 dark:bg-navy-600',
}

function StatusBadge({ status }) {
  const { t } = useLanguage()
  const key = `common.historyStatus_${status}`
  const label = t(key)
  return (
    <Badge tone={STATUS_TONE[status] || 'ink'} size="sm">
      {label === key ? status : label}
    </Badge>
  )
}

function formatDate(value, lang) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString(lang === 'en' ? 'en-US' : 'es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export default function StatusHistory({ items }) {
  const { t, lang } = useLanguage()
  const rows = Array.isArray(items) ? items : []

  if (rows.length === 0) {
    return (
      <Empty
        icon={<Icon.History />}
        title={t('common.historyEmpty')}
        body={t('common.historyEmptyBody')}
      />
    )
  }

  return (
    <ol className="relative" aria-label={t('common.historyTitle')}>
      {rows.map((item, idx) => {
        const tone = STATUS_TONE[item.to_status] || 'ink'
        const meta = item.meta || {}
        const isLast = idx === rows.length - 1
        return (
          <li key={item.id || `${item.changed_at}-${idx}`} className="relative flex gap-3 pb-5 last:pb-0">
            {/* riel + punto */}
            <div className="relative flex flex-col items-center">
              <span className={`mt-1.5 w-2.5 h-2.5 rounded-full ${DOT_COLOR[tone]}`} />
              {!isLast && (
                <span className="absolute top-4 bottom-[-20px] w-px bg-ink-200 dark:bg-navy-700" aria-hidden="true" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {item.from_status ? (
                  <>
                    <StatusBadge status={item.from_status} />
                    <Icon.Chevron className="w-3.5 h-3.5 text-ink-400 dark:text-ink-500" aria-hidden="true" />
                  </>
                ) : (
                  <span className="text-xs text-ink-500 dark:text-ink-400">{t('common.historyCreated')}</span>
                )}
                <StatusBadge status={item.to_status} />
                {meta.override && (
                  <Badge tone="warning" size="sm" icon={<Icon.Alert />}>
                    {t('common.historyOverride')}
                  </Badge>
                )}
                {meta.bulk && (
                  <Badge tone="navy" size="sm">{t('common.historyBulk')}</Badge>
                )}
              </div>

              <div className="mt-1 text-xs text-ink-500 dark:text-ink-400">
                <time dateTime={item.changed_at}>{formatDate(item.changed_at, lang)}</time>
                {' · '}
                <span className="break-all">
                  {t('common.historyBy', { user: item.changed_by_email || t('common.historyUnknownUser') })}
                </span>
              </div>

              {item.reason && (
                <p className="mt-1.5 text-sm text-ink-700 dark:text-ink-200 whitespace-pre-wrap break-words">
                  <span className="font-medium">{t('common.historyReason')}:</span> {item.reason}
                </p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
