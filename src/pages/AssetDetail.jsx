import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  getAsset, uploadAssetPhoto, getAssetQR,
  createLoan, returnLoan,
} from '../api/client'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'

const STATUS_BADGES = {
  available:   'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40',
  in_use:      'bg-blue-500/20 text-blue-400 border border-blue-500/40',
  maintenance: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40',
  retired:     'bg-gray-500/20 text-gray-400 border border-gray-500/40',
}

export default function AssetDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('assets')
  const canEditLoans = hasEdit('loans')

  const [asset, setAsset] = useState(null)
  const [loading, setLoading] = useState(true)
  const fileRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  // Loan form state
  const [showLoanForm, setShowLoanForm] = useState(false)
  const [loanForm, setLoanForm] = useState({ assigned_to: '', expected_return: '', notes: '' })

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    try {
      setAsset(await getAsset(id))
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function handlePhotoUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await uploadAssetPhoto(id, file)
      await load()
    } catch (err) {
      alert(err.response?.data?.detail || err.message)
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleCreateLoan(e) {
    e.preventDefault()
    try {
      await createLoan({ ...loanForm, asset_id: id })
      setShowLoanForm(false)
      setLoanForm({ assigned_to: '', expected_return: '', notes: '' })
      await load()
    } catch (err) {
      alert(err.response?.data?.detail || err.message)
    }
  }

  async function handleReturn(loanId) {
    if (!confirm(t('loans.confirmReturn'))) return
    try {
      await returnLoan(loanId)
      await load()
    } catch (err) {
      alert(err.response?.data?.detail || err.message)
    }
  }

  if (loading) return <div className="text-fiba-muted text-sm">{t('common.loading')}</div>
  if (!asset) return <div className="text-red-400">{t('assets.notFound')}</div>

  return (
    <div>
      <Link to="/inventory" className="text-fiba-accent text-sm hover:underline mb-3 inline-block">
        ← {t('assets.backToList')}
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-white">{asset.name}</h2>
          {asset.brand && (
            <p className="text-fiba-muted text-sm">{asset.brand} {asset.model}</p>
          )}
          <span className={`inline-block mt-2 px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGES[asset.status]}`}>
            {t(`assets.${camel(asset.status)}`)}
          </span>
        </div>
        {canEditLoans && asset.status === 'available' && (
          <button onClick={() => setShowLoanForm(true)} className="btn-fiba">
            {t('loans.newLoan')}
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Photo + QR */}
        <div className="space-y-4">
          <div className="fiba-card p-3">
            <p className="text-xs text-fiba-muted mb-2">{t('assets.photo')}</p>
            {asset.photo_url ? (
              <img src={asset.photo_url} alt={asset.name} className="w-full rounded-lg object-cover aspect-square" />
            ) : (
              <div className="w-full aspect-square rounded-lg bg-fiba-surface flex items-center justify-center text-fiba-muted text-xs">
                {t('assets.noPhoto')}
              </div>
            )}
            {canEdit && (
              <>
                <input ref={fileRef} type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="mt-2 w-full text-sm text-fiba-accent hover:underline disabled:opacity-50">
                  {uploading ? t('common.uploading') : (asset.photo_url ? t('assets.changePhoto') : t('assets.uploadPhoto'))}
                </button>
              </>
            )}
          </div>
          <div className="fiba-card p-3">
            <p className="text-xs text-fiba-muted mb-2">{t('assets.qrCode')}</p>
            {asset.qr_code_url ? (
              <>
                <img src={asset.qr_code_url} alt="QR" className="w-full rounded-lg bg-white p-3" />
                <a href={asset.qr_code_url} download={`${asset.name}-QR.png`} target="_blank" rel="noreferrer"
                  className="mt-2 inline-block text-sm text-fiba-accent hover:underline">
                  {t('assets.downloadQr')}
                </a>
              </>
            ) : (
              <p className="text-xs text-fiba-muted">—</p>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="col-span-2 space-y-4">
          <div className="fiba-card p-4">
            <h3 className="text-sm font-bold text-white mb-3">{t('assets.details')}</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Row k={t('assets.serial')} v={asset.serial_number} />
              <Row k={t('assets.category')} v={asset.category} />
              <Row k={t('assets.brand')} v={asset.brand} />
              <Row k={t('assets.model')} v={asset.model} />
              <Row k={t('assets.location')} v={asset.location} />
              <Row k={t('assets.purchaseDate')} v={asset.purchase_date} />
              <Row k={t('assets.notes')} v={asset.notes} full />
            </dl>
          </div>

          {/* Active Loan */}
          {asset.active_loan && (
            <div className="fiba-card p-4 border-blue-500/40">
              <h3 className="text-sm font-bold text-blue-400 mb-3">{t('loans.activeLoan')}</h3>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <Row k={t('loans.assignedTo')} v={asset.active_loan.assigned_to} />
                <Row k={t('loans.expectedReturn')} v={asset.active_loan.expected_return} />
                <Row k={t('loans.loanDate')} v={fmtDate(asset.active_loan.loan_date)} />
                <Row k={t('common.notes')} v={asset.active_loan.notes} />
              </dl>
              {canEditLoans && (
                <button onClick={() => handleReturn(asset.active_loan.id)}
                  className="mt-3 btn-fiba">
                  {t('loans.markReturned')}
                </button>
              )}
            </div>
          )}

          {/* Loan History */}
          {asset.loan_history?.length > 0 && (
            <div className="fiba-card p-4">
              <h3 className="text-sm font-bold text-white mb-3">{t('loans.history')}</h3>
              <table className="w-full text-sm">
                <thead className="text-xs text-fiba-muted">
                  <tr>
                    <th className="text-left py-1">{t('loans.assignedTo')}</th>
                    <th className="text-left py-1">{t('loans.loanDate')}</th>
                    <th className="text-left py-1">{t('loans.actualReturn')}</th>
                    <th className="text-left py-1">{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {asset.loan_history.map(l => (
                    <tr key={l.id} className="border-t border-fiba-border">
                      <td className="py-2">{l.assigned_to}</td>
                      <td className="py-2">{fmtDate(l.loan_date)}</td>
                      <td className="py-2">{fmtDate(l.actual_return) || '—'}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${l.status === 'active' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                          {t(`loans.${l.status}`)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* New Loan Modal */}
      {showLoanForm && (
        <div className="fiba-modal-overlay">
          <div className="fiba-modal max-w-md p-6">
            <h3 className="text-lg font-bold text-white mb-4">{t('loans.newLoan')}</h3>
            <form onSubmit={handleCreateLoan} className="space-y-3">
              <div>
                <label className="fiba-label">{t('loans.assignedTo')} *</label>
                <input required value={loanForm.assigned_to}
                  onChange={e => setLoanForm(f => ({ ...f, assigned_to: e.target.value }))}
                  className="fiba-input" />
              </div>
              <div>
                <label className="fiba-label">{t('loans.expectedReturn')}</label>
                <input type="date" value={loanForm.expected_return}
                  onChange={e => setLoanForm(f => ({ ...f, expected_return: e.target.value }))}
                  className="fiba-input" />
              </div>
              <div>
                <label className="fiba-label">{t('common.notes')}</label>
                <textarea rows={2} value={loanForm.notes}
                  onChange={e => setLoanForm(f => ({ ...f, notes: e.target.value }))}
                  className="fiba-input" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowLoanForm(false)} className="px-4 py-2 text-sm text-fiba-muted hover:text-white">
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn-fiba">{t('common.create')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ k, v, full }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <dt className="text-xs text-fiba-muted">{k}</dt>
      <dd className="text-white">{v || '—'}</dd>
    </div>
  )
}

function fmtDate(d) {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString() } catch { return d }
}

function camel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}
