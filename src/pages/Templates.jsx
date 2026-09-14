import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLanguage } from '../i18n/LanguageContext'
import { useAuth } from '../contexts/AuthContext'
import {
  getTemplates, previewTemplate, uploadTemplate,
  activateTemplate, discardStagedTemplate, revertTemplate,
  createTemplateType, deleteTemplateType, downloadTemplateFile,
  duplicateTemplate, getNominations,
} from '../api/client'
import { Icon } from '../lib/icons'
import { Tooltip } from '../components/ui'

const BADGE_COLORS = {
  WCQ: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
  BCLA: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  LSB: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-400',
  GENERIC: 'bg-fiba-surface text-fiba-muted',
}

const FONT_STATUS_CLASSES = {
  ok: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  substituted: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-400',
  missing: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
}

export default function Templates() {
  const { t } = useLanguage()
  const { hasEdit } = useAuth()
  const canEdit = hasEdit('templates')

  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState(null)

  // Preview modal. `review` marks the preview of a staged upload, which is the
  // one that offers Activate / Discard — real-nomination preview only makes
  // sense outside of that flow, so the nomination picker is hidden there.
  const [preview, setPreview] = useState(null)   // { key, review }
  const [previewUrl, setPreviewUrl] = useState(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewError, setPreviewError] = useState(null)
  const [acting, setActing] = useState(false)

  // Nominations to preview against, fetched lazily (only once a non-review
  // preview is opened) so a visit to this page that never opens the preview
  // never pays for the list. `getNominations()` needs nominations:view, which
  // templates:view alone doesn't imply — a 403 just hides the picker, same as
  // the backend's own has_view() gate on the nomination_id branch.
  const [nominationOptions, setNominationOptions] = useState([])
  const [nominationsBlocked, setNominationsBlocked] = useState(false)
  const [previewNominationId, setPreviewNominationId] = useState('')
  const nominationsRequested = useRef(false)

  const [uploadingKey, setUploadingKey] = useState(null)
  const fileInputs = useRef({})

  // Field reference: one template at a time, so it reads as a short list
  // instead of four walls of names.
  const [fieldsKey, setFieldsKey] = useState(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [copied, setCopied] = useState(null)
  const withFields = templates.filter(x => x.placeholders?.length)
  const fieldsTemplate = withFields.find(x => x.key === fieldsKey) || withFields[0] || null

  const copyTag = (p) => {
    const text = [p.tag, ...(p.tag_extra || [])].join('\n')
    navigator.clipboard?.writeText(text)
    setCopied(p.name)
    setTimeout(() => setCopied(c => (c === p.name ? null : c)), 1500)
  }

  // `sourceKey`/`sourceLabel` are only set when this form is duplicating an
  // existing template — same modal, two outcomes (see doSubmitType).
  const emptyType = {
    key: '', label: '', kind: 'nomination',
    signatory_name: '', signatory_title: '', signatory_org: '',
    sourceKey: null, sourceLabel: null,
  }
  const [newType, setNewType] = useState(null)
  const [creating, setCreating] = useState(false)

  const load = () => getTemplates().then(setTemplates).catch(() => setTemplates([]))

  useEffect(() => { load().finally(() => setLoading(false)) }, [])

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const ensureNominationOptions = () => {
    if (nominationsRequested.current) return
    nominationsRequested.current = true
    getNominations().then(setNominationOptions).catch(() => setNominationsBlocked(true))
  }

  const nominationLabel = (n) => {
    const name = n.personnel?.name || n.id
    const comp = n.competitions?.name || ''
    const year = n.competitions?.year ? ` ${n.competitions.year}` : ''
    return comp ? `${name} · ${comp}${year}` : name
  }

  const openPreview = async (key, review = false, nominationId = null) => {
    if (!review) ensureNominationOptions()
    setPreview({ key, review })
    setPreviewNominationId(nominationId || '')
    setPreviewError(null)
    setPreviewUrl(null)
    setPreviewBusy(true)
    try {
      const { blob, isPdf } = await previewTemplate(key, review, nominationId)
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

  const changePreviewNomination = (value) => {
    if (!preview) return
    openPreview(preview.key, preview.review, value || null)
  }

  const closePreview = () => {
    setPreview(null)
    setPreviewError(null)
    setPreviewUrl(null)
    setPreviewNominationId('')
  }

  const handleFile = async (key, file) => {
    if (!file) return
    setNotice(null)
    setUploadingKey(key)
    try {
      const res = await uploadTemplate(key, file)
      await load()
      const parts = []
      if (res.unknown_placeholders?.length) {
        parts.push(t('templates.unknownPlaceholders', { list: res.unknown_placeholders.join(', ') }))
      }
      // Fonts the droplet can't print as-is: worth flagging next to the
      // "unknown placeholder" warning, in the same notice.
      for (const f of res.fonts || []) {
        if (f.status === 'substituted') {
          parts.push(t('templates.fontSubstituted', { family: f.family, substitute: f.substitute }))
        } else if (f.status === 'missing') {
          parts.push(t('templates.fontMissing', { family: f.family }))
        }
      }
      if (parts.length) {
        setNotice({ kind: 'warn', text: parts.join(' ') })
      }
      // Straight into the review preview: the upload is worthless until seen.
      openPreview(key, true)
    } catch (err) {
      const detail = err?.response?.data?.detail || String(err)
      setNotice({ kind: 'error', text: t('templates.uploadFailed', { error: detail }) })
    } finally {
      setUploadingKey(null)
      if (fileInputs.current[key]) fileInputs.current[key].value = ''
    }
  }

  const doActivate = async () => {
    setActing(true)
    try {
      await activateTemplate(preview.key)
      await load()
      setNotice({ kind: 'ok', text: t('templates.activated') })
      closePreview()
    } catch {
      setPreviewError(t('templates.previewError'))
    } finally {
      setActing(false)
    }
  }

  const doDiscard = async () => {
    setActing(true)
    try {
      await discardStagedTemplate(preview.key)
      await load()
      closePreview()
    } finally {
      setActing(false)
    }
  }

  const doRevert = async (key) => {
    if (!window.confirm(t('templates.revertConfirm'))) return
    await revertTemplate(key)
    await load()
  }

  const openNewType = () => {
    setNotice(null)
    setNewType({ ...emptyType })
  }

  // Prefills from the row being copied — `signatory` there is already joined
  // as "name, title, org" (see routers/templates.py), so it's split back into
  // the three form fields. Good enough for a prefill the user can still edit;
  // the backend falls back to the origin's real signatory anyway if these are
  // left untouched.
  const openDuplicate = (tmpl) => {
    setNotice(null)
    const [sigName = '', sigTitle = '', ...rest] = (tmpl.signatory || '').split(', ')
    setNewType({
      ...emptyType,
      kind: tmpl.type,
      signatory_name: sigName,
      signatory_title: sigTitle,
      signatory_org: rest.join(', '),
      sourceKey: tmpl.key,
      sourceLabel: tmpl.label,
    })
  }

  const doSubmitType = async (e) => {
    e.preventDefault()
    setCreating(true)
    setNotice(null)
    try {
      if (newType.sourceKey) {
        await duplicateTemplate(newType.sourceKey, {
          key: newType.key,
          label: newType.label,
          signatory_name: newType.signatory_name,
          signatory_title: newType.signatory_title,
          signatory_org: newType.signatory_org,
        })
        await load()
        setNotice({ kind: 'ok', text: t('templates.duplicated', { source: newType.sourceLabel }) })
      } else {
        await createTemplateType({
          key: newType.key,
          label: newType.label,
          kind: newType.kind,
          signatory_name: newType.signatory_name,
          signatory_title: newType.signatory_title,
          signatory_org: newType.signatory_org,
        })
        await load()
        setNotice({ kind: 'ok', text: t('templates.createdNeedsUpload') })
      }
      setNewType(null)
    } catch (err) {
      const detail = err?.response?.data?.detail || String(err)
      setNotice({ kind: 'error', text: t('templates.actionFailed', { error: detail }) })
    } finally {
      setCreating(false)
    }
  }

  const doDownload = async (tmpl) => {
    setNotice(null)
    try {
      const blob = await downloadTemplateFile(tmpl.key)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      // A type with no file of its own gets the starter for its shape.
      a.download = tmpl.base_file_present || tmpl.custom
        ? `${tmpl.key}.docx` : `${tmpl.key}_starter.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      const detail = err?.response?.data?.detail || String(err)
      setNotice({ kind: 'error', text: t('templates.actionFailed', { error: detail }) })
    }
  }

  const doDeleteType = async (key) => {
    if (!window.confirm(t('templates.deleteConfirm'))) return
    setNotice(null)
    try {
      await deleteTemplateType(key)
      await load()
    } catch (err) {
      const detail = err?.response?.data?.detail || String(err)
      setNotice({ kind: 'error', text: t('templates.actionFailed', { error: detail }) })
    }
  }

  // One row of the field-reference table, shared by the plain fields table
  // and the advanced (loop) one hidden behind the toggle below it.
  const renderFieldRow = (p) => {
    const described = t(`templates.ph.${p.name}`)
    const label = described === `templates.ph.${p.name}` ? p.name : described
    return (
      <tr key={p.name}>
        <td className="px-4 py-2 text-sm">
          {label}
          {p.kind === 'list' && (
            <span className="block text-[11px] text-fiba-muted/60">{t('templates.repeats')}</span>
          )}
        </td>
        <td className="px-4 py-2">
          <button onClick={() => copyTag(p)} title={t('templates.copyHint')}
            className="text-left font-mono text-xs text-fiba-accent hover:underline">
            <span className="block">{p.tag}</span>
            {p.tag_extra?.map(x => <span key={x} className="block">{x}</span>)}
          </button>
          {p.aliases?.length > 0 && (
            <span className="block font-mono text-[11px] text-fiba-muted/60 mt-0.5">
              {t('templates.orTag', { tag: `{{ ${p.aliases[0]} }}` })}
            </span>
          )}
          {copied === p.name && (
            <span className="ml-2 text-[11px] text-green-400">{t('templates.copied')}</span>
          )}
        </td>
        <td className="px-4 py-2 text-xs text-fiba-muted">{p.example}</td>
      </tr>
    )
  }

  const plainFields = fieldsTemplate?.placeholders.filter(p => !p.advanced) || []
  const advancedFields = fieldsTemplate?.placeholders.filter(p => p.advanced) || []

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-ink-900 dark:text-white">{t('templates.title')}</h2>
        {canEdit && (
          <button onClick={openNewType} className="btn-fiba text-sm">
            + {t('templates.newType')}
          </button>
        )}
      </div>

      {notice && (
        <div className={`mb-4 rounded-lg px-4 py-3 text-sm border ${
          notice.kind === 'error' ? 'border-red-500/40 text-red-400'
            : notice.kind === 'warn' ? 'border-amber-500/40 text-amber-400'
            : 'border-green-500/40 text-green-400'}`}>
          {notice.text}
        </div>
      )}

      {/* Without this, "upload your own design" is impossible: nobody can guess
          the field names from an empty Word document. */}
      <details className="mb-4 rounded-xl border border-fiba-border p-4">
        <summary className="cursor-pointer text-sm font-medium text-ink-900 dark:text-white">
          {t('templates.howTo')}
        </summary>

        <ol className="mt-4 space-y-2">
          {[1, 2, 3, 4].map(n => (
            <li key={n} className="flex gap-3 text-sm text-fiba-muted">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-fiba-accent/15 text-fiba-accent
                               text-xs font-semibold flex items-center justify-center">{n}</span>
              <span>{t(`templates.step${n}`)}</span>
            </li>
          ))}
        </ol>

        {fieldsTemplate && (
          <div className="mt-5">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <span className="text-xs text-fiba-muted">{t('templates.fieldsFor')}</span>
              {templates.filter(x => x.placeholders?.length).map(x => (
                <button key={x.key} onClick={() => { setFieldsKey(x.key); setShowAdvanced(false) }}
                  className={`px-2 py-0.5 rounded text-xs ${x.key === fieldsTemplate.key
                    ? 'bg-fiba-accent/15 text-fiba-accent font-medium'
                    : 'text-fiba-muted hover:text-ink-900 dark:hover:text-white'}`}>
                  {x.key}
                </button>
              ))}
            </div>

            <div className="overflow-x-auto rounded-lg border border-fiba-border">
              <table className="fiba-table">
                <thead>
                  <tr>
                    <th>{t('templates.colWhat')}</th>
                    <th>{t('templates.colCopy')}</th>
                    <th>{t('templates.colExample')}</th>
                  </tr>
                </thead>
                <tbody>
                  {plainFields.map(renderFieldRow)}
                </tbody>
              </table>
            </div>

            {advancedFields.length > 0 && (
              <div className="mt-3">
                <button type="button" onClick={() => setShowAdvanced(s => !s)}
                  className="text-xs text-fiba-accent hover:underline">
                  {showAdvanced ? t('templates.hideAdvanced') : t('templates.showAdvanced')}
                </button>
                {showAdvanced && (
                  <>
                    <p className="text-[11px] text-fiba-muted/60 mt-2 mb-1">{t('templates.advancedNote')}</p>
                    <div className="overflow-x-auto rounded-lg border border-fiba-border">
                      <table className="fiba-table">
                        <thead>
                          <tr>
                            <th>{t('templates.colWhat')}</th>
                            <th>{t('templates.colCopy')}</th>
                            <th>{t('templates.colExample')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {advancedFields.map(renderFieldRow)}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}

            <p className="text-xs text-fiba-muted/60 mt-2">{t('templates.deleteFieldNote')}</p>
          </div>
        )}
      </details>

      <div className="rounded-xl border border-fiba-border overflow-hidden">
        <div className="overflow-x-auto">
        <table className="fiba-table">
          <thead>
            <tr>
              <th>{t('templates.template')}</th>
              <th>{t('templates.file')}</th>
              <th>{t('templates.type')}</th>
              <th>{t('templates.fontsCol')}</th>
              <th>{t('templates.signatory')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-fiba-muted">{t('common.loading')}</td></tr>
            )}
            {!loading && templates.map(tmpl => (
              <tr key={tmpl.key}>
                <td className="px-4 py-3">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${BADGE_COLORS[tmpl.key] || BADGE_COLORS.GENERIC}`}>
                    {tmpl.key}
                  </span>
                  {tmpl.built_in && (
                    <span className="block text-[11px] text-fiba-muted mt-1">{tmpl.label}</span>
                  )}
                  {tmpl.key === 'BCLA' && (
                    <span className="block text-[11px] text-fiba-muted/70 mt-1">{t('templates.bclaVariantsNote')}</span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  {tmpl.base_file || <span className="font-sans italic text-fiba-muted">{tmpl.label}</span>}
                  {!tmpl.base_file_present && !tmpl.custom && (
                    <span className="ml-2 font-sans text-red-400">
                      {tmpl.built_in ? t('templates.missingFile') : t('templates.noFileYet')}
                    </span>
                  )}
                  {(tmpl.custom || tmpl.built_in) && (
                    <span className={`ml-2 font-sans px-1.5 py-0.5 rounded text-[11px] ${
                      tmpl.custom ? 'bg-fiba-accent/15 text-fiba-accent' : 'text-fiba-muted/70'}`}>
                      {tmpl.custom ? t('templates.custom') : t('templates.builtIn')}
                    </span>
                  )}
                  {tmpl.staged && (
                    <span className="ml-2 font-sans text-amber-400 text-[11px]">
                      {t('templates.stagedPending')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">{t(`templates.${tmpl.type}`)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1 max-w-[10rem]">
                    {!tmpl.fonts?.length && <span className="text-fiba-muted text-xs">—</span>}
                    {tmpl.fonts?.filter(f => f.status !== 'unknown').map(f => {
                      const chip = (
                        <span tabIndex={f.status === 'ok' ? undefined : 0}
                          className={`px-1.5 py-0.5 rounded text-[11px] font-mono cursor-default ${FONT_STATUS_CLASSES[f.status] || FONT_STATUS_CLASSES.ok}`}>
                          {f.family}
                        </span>
                      )
                      if (f.status === 'substituted') {
                        return (
                          <Tooltip key={f.family} label={t('templates.fontSubstituted', { family: f.family, substitute: f.substitute })}>
                            {chip}
                          </Tooltip>
                        )
                      }
                      if (f.status === 'missing') {
                        return (
                          <Tooltip key={f.family} label={t('templates.fontMissing', { family: f.family })}>
                            {chip}
                          </Tooltip>
                        )
                      }
                      return <span key={f.family}>{chip}</span>
                    })}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs">{tmpl.signatory}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                    {tmpl.staged && canEdit && (
                      <button onClick={() => openPreview(tmpl.key, true)}
                        className="text-amber-400 hover:underline text-xs">
                        {t('templates.review')}
                      </button>
                    )}
                    {canEdit && (tmpl.base_file_present || tmpl.custom) && (
                      <button onClick={() => openDuplicate(tmpl)}
                        className="text-fiba-accent hover:underline text-xs">
                        {t('templates.duplicate')}
                      </button>
                    )}
                    {tmpl.custom && canEdit && tmpl.built_in && (
                      <button onClick={() => doRevert(tmpl.key)}
                        className="text-fiba-muted hover:underline text-xs">
                        {t('templates.revert')}
                      </button>
                    )}
                    {!tmpl.built_in && canEdit && (
                      <button onClick={() => doDeleteType(tmpl.key)}
                        className="text-fiba-muted hover:underline text-xs">
                        {t('templates.deleteType')}
                      </button>
                    )}
                    <button onClick={() => doDownload(tmpl)}
                      className="inline-flex items-center gap-1.5 text-fiba-accent hover:underline text-xs">
                      <Icon.Download className="w-4 h-4" />
                      {tmpl.base_file_present || tmpl.custom
                        ? t('templates.download') : t('templates.downloadStarter')}
                    </button>
                    {canEdit && (
                      <>
                        <input type="file" accept=".docx" className="hidden"
                          ref={el => { fileInputs.current[tmpl.key] = el }}
                          onChange={e => handleFile(tmpl.key, e.target.files?.[0])} />
                        <button onClick={() => fileInputs.current[tmpl.key]?.click()}
                          disabled={uploadingKey === tmpl.key}
                          className="inline-flex items-center gap-1.5 text-fiba-accent hover:underline text-xs disabled:opacity-50">
                          <Icon.Upload className="w-4 h-4" />
                          {uploadingKey === tmpl.key ? t('templates.uploading') : t('templates.upload')}
                        </button>
                      </>
                    )}
                    {/* A UI-created type has nothing to render until its
                        .docx is uploaded and activated. */}
                    <button onClick={() => openPreview(tmpl.key)}
                      disabled={!tmpl.custom && !tmpl.base_file_present}
                      className="inline-flex items-center gap-1.5 text-fiba-accent hover:underline text-xs disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed">
                      <Icon.Eye className="w-4 h-4" />
                      {t('templates.preview')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {newType && createPortal(
        <div className="fiba-modal-overlay z-[60]">
          <div className="fiba-modal max-w-lg p-6">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white mb-4">
              {newType.sourceKey ? t('templates.duplicateTitle') : t('templates.newTypeTitle')}
            </h3>
            {newType.sourceKey && (
              <p className="text-xs text-fiba-muted mb-4">
                {t('templates.duplicateFromNote', { source: newType.sourceLabel })}
              </p>
            )}
            <form onSubmit={doSubmitType} className="space-y-3">
              <div>
                <label className="fiba-label">{t('templates.key')}</label>
                <input required value={newType.key} className="fiba-input font-mono"
                  onChange={e => setNewType(n => ({ ...n, key: e.target.value.toUpperCase() }))} />
                <p className="text-xs text-fiba-muted/60 mt-1">{t('templates.keyHint')}</p>
              </div>
              <div>
                <label className="fiba-label">{t('templates.label')}</label>
                <input required value={newType.label} className="fiba-input"
                  onChange={e => setNewType(n => ({ ...n, label: e.target.value }))} />
              </div>
              {!newType.sourceKey && (
                <div>
                  <label className="fiba-label">{t('templates.kind')}</label>
                  <select value={newType.kind} className="fiba-select"
                    onChange={e => setNewType(n => ({ ...n, kind: e.target.value }))}>
                    <option value="nomination">{t('templates.nomination')}</option>
                    <option value="confirmation">{t('templates.confirmation')}</option>
                  </select>
                  <p className="text-xs text-fiba-muted/60 mt-1">{t('templates.kindHint')}</p>
                </div>
              )}
              <input placeholder={t('templates.signatoryName')} value={newType.signatory_name} className="fiba-input"
                onChange={e => setNewType(n => ({ ...n, signatory_name: e.target.value }))} />
              <input placeholder={t('templates.signatoryTitle')} value={newType.signatory_title} className="fiba-input"
                onChange={e => setNewType(n => ({ ...n, signatory_title: e.target.value }))} />
              <input placeholder={t('templates.signatoryOrg')} value={newType.signatory_org} className="fiba-input"
                onChange={e => setNewType(n => ({ ...n, signatory_org: e.target.value }))} />

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setNewType(null)}
                  className="px-4 py-2 text-sm text-fiba-muted">{t('templates.cancel')}</button>
                <button type="submit" disabled={creating} className="btn-fiba disabled:opacity-50">
                  {newType.sourceKey ? t('templates.duplicateSubmit') : t('templates.create')}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Portal to body: an AppShell ancestor creates a containing block, so a
          plain fixed overlay anchors to it instead of the viewport and the
          modal ends up cut off (same reason as the Games assignment picker). */}
      {preview && createPortal(
        <div className="fiba-modal-overlay z-[60]">
          {/* Don't set a height here: .fiba-modal already caps at max-h-[90vh]
              with its own overflow, and a second height fights that. */}
          <div className="fiba-modal max-w-4xl">
            <div className="flex items-start justify-between p-4 border-b border-fiba-border">
              <div>
                <h3 className="text-lg font-bold text-ink-900 dark:text-white">
                  {preview.review
                    ? t('templates.reviewTitle', { key: preview.key })
                    : t('templates.previewTitle', { key: preview.key })}
                </h3>
                <p className="text-xs text-fiba-muted mt-0.5">
                  {preview.review ? t('templates.reviewNote') : t('templates.sampleNote')}
                </p>
              </div>
              <button onClick={closePreview} className="text-fiba-muted hover:text-ink-900 dark:hover:text-white">
                <Icon.X className="w-5 h-5" />
              </button>
            </div>

            {!preview.review && !nominationsBlocked && (
              <div className="px-4 pt-3">
                <label className="fiba-label">{t('templates.previewSource')}</label>
                <select className="fiba-select" value={previewNominationId}
                  onChange={e => changePreviewNomination(e.target.value)}>
                  <option value="">{t('templates.sampleData')}</option>
                  {nominationOptions.map(n => (
                    <option key={n.id} value={n.id}>{nominationLabel(n)}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="p-4">
              {previewBusy && (
                <div className="h-[70vh] flex items-center justify-center text-fiba-muted text-sm">
                  {t('templates.generating')}
                </div>
              )}
              {!previewBusy && previewError && (
                <div className="h-[70vh] flex items-center justify-center text-center text-sm text-fiba-muted px-6">
                  {previewError}
                </div>
              )}
              {!previewBusy && previewUrl && (
                <iframe src={previewUrl} title={`${preview.key} preview`}
                  className="w-full h-[70vh] rounded-lg border border-fiba-border bg-white" />
              )}
            </div>

            {preview.review && canEdit && (
              <div className="flex items-center justify-end gap-2 px-4 pb-4">
                <button onClick={doDiscard} disabled={acting}
                  className="px-4 py-2 text-sm text-fiba-muted disabled:opacity-50">
                  {t('templates.discard')}
                </button>
                <button onClick={doActivate} disabled={acting || !previewUrl}
                  className="btn-fiba disabled:opacity-50">
                  {t('templates.activate')}
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
