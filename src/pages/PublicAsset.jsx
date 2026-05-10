import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getPublicAsset } from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'

const STATUS_LABEL = {
  available:   { color: 'text-emerald-400', icon: '✓' },
  in_use:      { color: 'text-blue-400', icon: '→' },
  maintenance: { color: 'text-yellow-400', icon: '⚙' },
  retired:     { color: 'text-ink-500 dark:text-gray-400', icon: '✕' },
}

export default function PublicAsset() {
  const { id } = useParams()
  const { t } = useLanguage()
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

  if (loading) return (
    <div className="min-h-screen bg-fiba-dark flex items-center justify-center">
      <div className="text-fiba-muted">{t('common.loading')}</div>
    </div>
  )

  if (error || !asset) return (
    <div className="min-h-screen bg-fiba-dark flex items-center justify-center p-6">
      <div className="text-center">
        <h1 className="text-xl font-bold text-ink-900 dark:text-white mb-2">{t('assets.notFound')}</h1>
        <p className="text-fiba-muted text-sm">ID: {id}</p>
      </div>
    </div>
  )

  const statusStyle = STATUS_LABEL[asset.status] || {}

  return (
    <div className="min-h-screen bg-fiba-dark p-6 flex items-center justify-center">
      <div className="max-w-md w-full">
        <div className="text-center mb-6">
          <div className="w-12 h-12 mx-auto bg-fiba-accent rounded-xl flex items-center justify-center mb-3">
            <span className="text-2xl text-white font-bold">F</span>
          </div>
          <p className="text-fiba-muted text-xs">FIBA Americas Inventory</p>
        </div>

        <div className="fiba-card p-6">
          {asset.photo_url && (
            <img src={asset.photo_url} alt={asset.name} className="w-full rounded-lg mb-4 aspect-square object-cover" />
          )}

          <h1 className="text-2xl font-bold text-ink-900 dark:text-white mb-1">{asset.name}</h1>
          {asset.brand && <p className="text-fiba-muted text-sm mb-3">{asset.brand} {asset.model}</p>}

          <div className={`text-lg font-bold mb-4 ${statusStyle.color}`}>
            {statusStyle.icon} {t(`assets.${camel(asset.status)}`)}
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
    </div>
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

function camel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}
