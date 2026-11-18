import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getPublicAsset } from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { camel } from '../lib/utils'
import { Icon } from '../lib/icons'
import { Badge } from '../components/ui/Badge'
import { PublicShell, PublicUnavailable } from '../components/layout/PublicShell'

// Estado del activo como Badge del design system: el tono ya trae su variante
// dark y contraste AA sobre la card blanca.
const STATUS_BADGE = {
  available:   { tone: 'success', icon: <Icon.Check /> },
  in_use:      { tone: 'info',    icon: <Icon.Chevron /> },
  maintenance: { tone: 'warning', icon: <Icon.Tool /> },
  retired:     { tone: 'ink',     icon: <Icon.X /> },
}

export default function PublicAsset() {
  const { id } = useParams()
  const { t, lang } = useLanguage()
  const [asset, setAsset] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    getPublicAsset(id)
      .then(a => { if (!cancelled) { setAsset(a); setLoading(false) } })
      .catch(err => { if (!cancelled) { setError(err); setLoading(false) } })
    return () => { cancelled = true }
  }, [id])

  const inventoryTitle = lang === 'es' ? 'Inventario FIBA Americas' : 'FIBA Americas Inventory'

  if (loading) return (
    <PublicShell width="max-w-md" title={inventoryTitle}>
      <div className="flex justify-center py-20 text-sm text-fiba-muted">{t('common.loading')}</div>
    </PublicShell>
  )

  if (error || !asset) return (
    <PublicUnavailable title={t('assets.notFound')} message={`ID: ${id}`} />
  )

  const status = STATUS_BADGE[asset.status] || { tone: 'ink' }

  return (
    <PublicShell width="max-w-md" title={inventoryTitle}>
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="fiba-card p-6">
          {asset.photo_url && (
            <img src={asset.photo_url} alt={asset.name} className="w-full rounded-lg mb-4 aspect-square object-cover" />
          )}

          <h1 className="text-2xl font-bold text-ink-900 dark:text-white mb-1">{asset.name}</h1>
          {asset.brand && <p className="text-fiba-muted text-sm mb-3">{asset.brand} {asset.model}</p>}

          <div className="mb-4">
            <Badge tone={status.tone} size="lg" icon={status.icon}>
              {t(`assets.${camel(asset.status)}`)}
            </Badge>
          </div>

          <dl className="space-y-2 text-sm">
            {asset.serial_number && <Row k={t('assets.serial')} v={asset.serial_number} mono />}
            {asset.category && <Row k={t('assets.category')} v={asset.category} />}
            {asset.location && <Row k={t('assets.location')} v={asset.location} />}
            {asset.assigned_to && (
              <>
                <hr className="border-fiba-border my-3" />
                <Row k={t('loans.assignedTo')} v={asset.assigned_to} />
                {asset.expected_return && <Row k={t('loans.expectedReturn')} v={asset.expected_return} />}
              </>
            )}
          </dl>
        </div>
      </div>
    </PublicShell>
  )
}

function Row({ k, v, mono }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-fiba-muted shrink-0">{k}</dt>
      <dd className={`text-ink-900 dark:text-white text-right ${mono ? 'font-mono text-xs' : ''}`}>{v}</dd>
    </div>
  )
}
