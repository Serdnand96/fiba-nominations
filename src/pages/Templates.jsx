import { useEffect, useState } from 'react'
import { useLanguage } from '../i18n/LanguageContext'
import { getTemplates, previewTemplate } from '../api/client'
import { Icon } from '../lib/icons'

const BADGE_COLORS = {
  WCQ: 'bg-red-500/20 text-red-400',
  BCLA: 'bg-blue-500/20 text-blue-400',
  LSB: 'bg-amber-500/20 text-amber-400',
  GENERIC: 'bg-fiba-surface text-fiba-muted',
}

export default function Templates() {
  const { t } = useLanguage()
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)

  // Preview modal state
  const [previewKey, setPreviewKey] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState(null)

  useEffect(() => {
    getTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false))
  }, [])

  // Release the object URL when the modal closes or the preview is replaced.
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const openPreview = async (key) => {
    setPreviewKey(key)
    setPreviewError(null)
    setPreviewUrl(null)
    setPreviewBusy(true)
    try {
      const { blob, isPdf } = await previewTemplate(key)
      if (isPdf) {
        setPreviewUrl(URL.createObjectURL(blob))
      } else {
        // LibreOffice is down — hand the user the .docx instead of an empty frame.
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${key}_preview.docx`
        a.click()
        URL.revokeObjectURL(url)
        setPreviewError(t('templates.previewDocx'))
      }
    } catch {
      setPreviewError(t('templates.previewError'))
    } finally {
      setPreviewBusy(false)
    }
  }

  const closePreview = () => {
    setPreviewKey(null)
    setPreviewError(null)
    setPreviewUrl(null)
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-ink-900 dark:text-white mb-6">{t('templates.title')}</h2>

      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
        <table className="fiba-table">
          <thead>
            <tr>
              <th>{t('templates.template')}</th>
              <th>{t('templates.file')}</th>
              <th>{t('templates.type')}</th>
              <th>{t('templates.signatory')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-fiba-muted">{t('common.loading')}</td></tr>
            )}
            {!loading && templates.map(tmpl => (
              <tr key={tmpl.key}>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${BADGE_COLORS[tmpl.key] || BADGE_COLORS.GENERIC}`}>
                    {tmpl.key}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  {tmpl.built_from_code
                    ? <span className="font-sans italic text-fiba-muted">{t('templates.builtFromCode')}</span>
                    : (
                      <>
                        {tmpl.base_file}
                        {!tmpl.base_file_present && (
                          <span className="ml-2 font-sans text-red-400">{t('templates.missingFile')}</span>
                        )}
                      </>
                    )}
                </td>
                <td className="px-4 py-3">{t(`templates.${tmpl.type}`)}</td>
                <td className="px-4 py-3 text-xs">{tmpl.signatory}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openPreview(tmpl.key)}
                    className="inline-flex items-center gap-1.5 text-fiba-accent hover:underline text-xs">
                    <Icon.Eye className="w-4 h-4" />
                    {t('templates.preview')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {previewKey && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="fiba-modal w-full max-w-4xl h-[85vh] flex flex-col">
            <div className="flex items-start justify-between p-4 border-b border-fiba-border">
              <div>
                <h3 className="text-lg font-bold text-ink-900 dark:text-white">
                  {t('templates.previewTitle', { key: previewKey })}
                </h3>
                <p className="text-xs text-fiba-muted mt-0.5">{t('templates.sampleNote')}</p>
              </div>
              <button onClick={closePreview} className="text-fiba-muted hover:text-ink-900 dark:hover:text-white">
                <Icon.X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 min-h-0 p-4">
              {previewBusy && (
                <div className="h-full flex items-center justify-center text-fiba-muted text-sm">
                  {t('templates.generating')}
                </div>
              )}
              {!previewBusy && previewError && (
                <div className="h-full flex items-center justify-center text-center text-sm text-fiba-muted px-6">
                  {previewError}
                </div>
              )}
              {!previewBusy && previewUrl && (
                <iframe src={previewUrl} title={`${previewKey} preview`}
                  className="w-full h-full rounded-lg border border-fiba-border bg-white" />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
