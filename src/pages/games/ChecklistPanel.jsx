import { useEffect, useState } from 'react'
import { useLanguage } from '../../i18n/LanguageContext'
import { useToast } from '../../components/ui/Toast'
import {
  getChecklistTemplates, createChecklistTemplate, updateChecklistTemplate,
  deleteChecklistTemplate, getChecklistLink, rotateChecklistLink,
  toggleChecklistLink, getChecklistLinkQr,
} from '../../api/client'

// Configuración del control de operación: las plantillas de checklist y el link
// con el que el oficial las completa desde la sede.
//
// Las plantillas son DATOS. Agregar el checklist del TD, el del médico o el de
// seguridad se hace acá, sin deploy — por eso este panel existe en vez de una
// constante en el backend (ver migración 038).
//
// Editar una plantilla NO reescribe las corridas ya hechas: cada corrida se
// llevó una copia de los ítems cuando se abrió. Eso es a propósito y el panel
// lo dice en pantalla, porque es lo primero que alguien va a asumir al revés.

const ROLES = ['VGO', 'TD', 'REF', 'REF_INSTRUCTOR', 'VIDEO_OPERATOR']

function emptyDraft() {
  return { name: '', role: '', description: '', items: [{ label: '', hint: '', required: true }] }
}

export default function ChecklistPanel({ competitionId, competitionName, canEdit, onClose, onTemplatesChange }) {
  const { lang } = useLanguage()
  const t = (es, en) => (lang === 'es' ? es : en)
  const { push } = useToast()

  const [tab, setTab] = useState('templates')
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState(emptyDraft())
  const [saving, setSaving] = useState(false)

  useEffect(() => { reload() }, [])

  async function reload() {
    setLoading(true)
    try {
      const rows = await getChecklistTemplates(true)
      setTemplates(rows || [])
      onTemplatesChange?.((rows || []).filter(r => r.active))
    } catch {
      push({ type: 'error', title: t('No se pudieron cargar las plantillas.', 'Could not load the templates.') })
    } finally {
      setLoading(false)
    }
  }

  function startNew() {
    setEditingId('new')
    setDraft(emptyDraft())
  }

  function startEdit(tpl) {
    setEditingId(tpl.id)
    setDraft({
      name: tpl.name || '',
      role: tpl.role || '',
      description: tpl.description || '',
      items: (tpl.items || []).map(i => ({ label: i.label, hint: i.hint || '', required: i.required })),
    })
  }

  function patchItem(idx, patch) {
    setDraft(d => ({ ...d, items: d.items.map((it, n) => (n === idx ? { ...it, ...patch } : it)) }))
  }

  function moveItem(idx, delta) {
    setDraft(d => {
      const next = [...d.items]
      const target = idx + delta
      if (target < 0 || target >= next.length) return d
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return { ...d, items: next }
    })
  }

  async function handleSave() {
    const items = draft.items
      .map(i => ({ label: (i.label || '').trim(), hint: (i.hint || '').trim() || null, required: !!i.required }))
      .filter(i => i.label)
    if (!draft.name.trim()) {
      push({ type: 'error', title: t('Poné un nombre a la plantilla.', 'Give the template a name.') })
      return
    }
    if (items.length === 0) {
      push({ type: 'error', title: t('Una plantilla sin ítems no controla nada.', 'A template with no items checks nothing.') })
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: draft.name.trim(),
        role: draft.role || null,
        description: draft.description.trim() || null,
        items,
      }
      if (editingId === 'new') await createChecklistTemplate(payload)
      else await updateChecklistTemplate(editingId, payload)
      setEditingId(null)
      await reload()
      push({ type: 'success', title: t('Plantilla guardada.', 'Template saved.') })
    } catch (err) {
      push({ type: 'error', title: err.response?.data?.detail || t('No se pudo guardar.', 'Could not save.') })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(tpl) {
    try {
      await updateChecklistTemplate(tpl.id, { active: !tpl.active })
      await reload()
    } catch (err) {
      push({ type: 'error', title: err.response?.data?.detail || 'Error' })
    }
  }

  async function handleDelete(tpl) {
    if (!confirm(t(
      `Borrar "${tpl.name}". Los checklists ya cargados en partidos NO se pierden: conservan su copia de los ítems. ¿Continuar?`,
      `Delete "${tpl.name}". Checklists already filled on games are NOT lost — they keep their own copy of the items. Continue?`,
    ))) return
    try {
      await deleteChecklistTemplate(tpl.id)
      await reload()
    } catch (err) {
      push({ type: 'error', title: err.response?.data?.detail || 'Error' })
    }
  }

  return (
    <div className="fiba-modal-overlay">
      <div className="fiba-modal max-w-3xl p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 className="text-lg font-bold text-ink-900 dark:text-white">
            {t('Control de operación', 'Operations control')}
          </h3>
          <button onClick={onClose} className="text-fiba-muted hover:text-ink-700 dark:hover:text-white text-xl leading-none">&times;</button>
        </div>
        <p className="text-xs text-fiba-muted mb-4">{competitionName}</p>

        <div className="flex gap-1 mb-5 border-b border-fiba-border">
          {[
            ['templates', t('Plantillas', 'Templates')],
            ['share', t('Link para la sede', 'Venue link')],
          ].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                tab === key
                  ? 'border-fiba-accent text-fiba-accent'
                  : 'border-transparent text-fiba-muted hover:text-ink-900 dark:hover:text-white'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'templates' ? (
          <TemplatesTab
            t={t} loading={loading} templates={templates} canEdit={canEdit}
            editingId={editingId} draft={draft} setDraft={setDraft} saving={saving}
            onStartNew={startNew} onStartEdit={startEdit} onCancel={() => setEditingId(null)}
            onSave={handleSave} onToggleActive={handleToggleActive} onDelete={handleDelete}
            patchItem={patchItem} moveItem={moveItem}
          />
        ) : (
          <ShareTab t={t} lang={lang} competitionId={competitionId} canEdit={canEdit} />
        )}
      </div>
    </div>
  )
}


function TemplatesTab({
  t, loading, templates, canEdit, editingId, draft, setDraft, saving,
  onStartNew, onStartEdit, onCancel, onSave, onToggleActive, onDelete, patchItem, moveItem,
}) {
  if (loading) return <div className="py-8 text-center text-sm text-fiba-muted">{t('Cargando...', 'Loading...')}</div>

  if (editingId) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="fiba-label">{t('Nombre', 'Name')}</label>
            <input className="fiba-input" value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder={t('VGO — Control de sede', 'VGO — Venue check')} />
          </div>
          <div>
            <label className="fiba-label">{t('Rol', 'Role')}</label>
            <select className="fiba-input" value={draft.role}
              onChange={e => setDraft(d => ({ ...d, role: e.target.value }))}>
              <option value="">{t('Cualquiera', 'Anyone')}</option>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="fiba-label">{t('Descripción', 'Description')}</label>
          <input className="fiba-input" value={draft.description}
            onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
            placeholder={t('Pruebas técnicas al llegar a la sede.', 'Technical tests on arrival at the venue.')} />
        </div>

        <div>
          <label className="fiba-label">{t('Ítems', 'Items')}</label>
          <div className="space-y-2">
            {draft.items.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <div className="flex flex-col pt-1.5">
                  <button type="button" onClick={() => moveItem(idx, -1)} disabled={idx === 0}
                    className="text-fiba-muted hover:text-ink-900 dark:hover:text-white disabled:opacity-25 text-[10px] leading-none">▲</button>
                  <button type="button" onClick={() => moveItem(idx, 1)} disabled={idx === draft.items.length - 1}
                    className="text-fiba-muted hover:text-ink-900 dark:hover:text-white disabled:opacity-25 text-[10px] leading-none">▼</button>
                </div>
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input className="fiba-input text-sm" value={item.label}
                    onChange={e => patchItem(idx, { label: e.target.value })}
                    placeholder={t('Conexión a reloj', 'Clock connection')} />
                  <input className="fiba-input text-sm" value={item.hint}
                    onChange={e => patchItem(idx, { hint: e.target.value })}
                    placeholder={t('Ayuda opcional', 'Optional hint')} />
                </div>
                <label className="flex items-center gap-1 pt-2 text-[11px] text-fiba-muted whitespace-nowrap"
                  title={t('Un ítem opcional no bloquea el cierre del checklist.', 'An optional item does not block closing the checklist.')}>
                  <input type="checkbox" checked={item.required}
                    onChange={e => patchItem(idx, { required: e.target.checked })} />
                  {t('Obligatorio', 'Required')}
                </label>
                <button type="button" onClick={() => setDraft(d => ({ ...d, items: d.items.filter((_, n) => n !== idx) }))}
                  className="pt-1.5 text-fiba-muted hover:text-red-400 text-sm">×</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setDraft(d => ({ ...d, items: [...d.items, { label: '', hint: '', required: true }] }))}
            className="btn-fiba-ghost text-xs mt-2">
            {t('+ Ítem', '+ Item')}
          </button>
        </div>

        <p className="text-[11px] text-fiba-muted">
          {t('Los checklists ya cargados en partidos no cambian: cada uno se llevó su copia de los ítems al abrirse.',
             'Checklists already filled on games do not change: each took its own copy of the items when it was opened.')}
        </p>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} className="btn-fiba-ghost">{t('Cancelar', 'Cancel')}</button>
          <button onClick={onSave} disabled={saving} className="btn-fiba disabled:opacity-50">
            {saving ? t('Guardando...', 'Saving...') : t('Guardar', 'Save')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      {templates.length === 0 ? (
        <p className="text-sm text-fiba-muted mb-4">
          {t('Todavía no hay plantillas.', 'No templates yet.')}
        </p>
      ) : (
        <div className="divide-y divide-fiba-border border border-fiba-border rounded-lg mb-4">
          {templates.map(tpl => (
            <div key={tpl.id} className="px-3 py-2.5 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-sm font-medium truncate ${tpl.active ? 'text-ink-900 dark:text-white' : 'text-fiba-muted line-through'}`}>
                    {tpl.name}
                  </span>
                  {tpl.role && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-fiba-muted/70 border border-fiba-border rounded px-1">
                      {tpl.role}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-fiba-muted truncate">
                  {(tpl.items || []).map(i => i.label).join(' · ') || t('sin ítems', 'no items')}
                </div>
              </div>
              {canEdit && (
                <div className="flex items-center gap-2 shrink-0 text-xs">
                  <button onClick={() => onStartEdit(tpl)} className="text-fiba-accent hover:underline">{t('Editar', 'Edit')}</button>
                  <button onClick={() => onToggleActive(tpl)} className="text-fiba-muted hover:underline">
                    {tpl.active ? t('Apagar', 'Disable') : t('Prender', 'Enable')}
                  </button>
                  <button onClick={() => onDelete(tpl)} className="text-red-400 hover:underline">{t('Borrar', 'Delete')}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <button onClick={onStartNew} className="btn-fiba">{t('+ Nueva plantilla', '+ New template')}</button>
      )}
    </div>
  )
}


function ShareTab({ t, lang, competitionId, canEdit }) {
  const [link, setLink] = useState(null)
  const [qrUrl, setQrUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    let createdUrl = null
    setLoading(true)
    getChecklistLink(competitionId)
      .then(async (l) => {
        if (cancelled) return
        setLink(l)
        try {
          createdUrl = await getChecklistLinkQr(competitionId)
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
      const next = await getChecklistLinkQr(competitionId)
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
      setError(t('El navegador bloqueó el portapapeles. Copiá el link a mano.',
                 'The browser blocked the clipboard. Copy the link manually.'))
    }
  }

  async function handleRotate() {
    if (!confirm(t('Al rotar el link, el que ya compartiste deja de funcionar. ¿Continuar?',
                   'Rotating the link stops the one you already shared from working. Continue?'))) return
    try {
      setLink(await rotateChecklistLink(competitionId))
      await refreshQr()
    } catch (err) { setError(err.response?.data?.detail || 'Error') }
  }

  async function handleToggle() {
    try {
      setLink(await toggleChecklistLink(competitionId, !link.enabled))
    } catch (err) { setError(err.response?.data?.detail || 'Error') }
  }

  if (loading) return <div className="py-8 text-center text-sm text-fiba-muted">{t('Cargando...', 'Loading...')}</div>
  if (error) return <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-400">{error}</div>
  if (!link) return null

  return (
    <div className="space-y-4">
      <div>
        <label className="fiba-label">{t('Link para el oficial', 'Link for the official')}</label>
        <div className="flex gap-2">
          <input readOnly value={link.url} onFocus={e => e.target.select()} className="fiba-input font-mono text-xs" />
          <button onClick={handleCopy} className="btn-fiba whitespace-nowrap text-xs px-3">
            {copied ? t('Copiado', 'Copied') : t('Copiar', 'Copy')}
          </button>
        </div>
      </div>

      <div className="flex items-start gap-4">
        {qrUrl && <img src={qrUrl} alt="QR" className="w-32 h-32 rounded-lg bg-white p-2 shrink-0" />}
        <div className="text-xs text-fiba-muted space-y-2">
          <p>
            {t('Quien tenga este link puede abrir el checklist de cualquier partido de esta competencia y completarlo desde el celular, sin cuenta.',
               'Anyone with this link can open the checklist of any game in this competition and fill it in from their phone, with no account.')}
          </p>
          <p className="text-amber-500">
            {t('A diferencia del link de logística, este ESCRIBE: no lo publiques más allá del grupo de oficiales. Si se filtra, rotalo.',
               'Unlike the logistics link, this one WRITES: do not share it beyond the officials’ group. If it leaks, rotate it.')}
          </p>
          <p>
            {t('Un checklist cerrado queda de solo lectura desde el link; reabrirlo exige entrar al sistema.',
               'A closed checklist is read-only from the link; reopening it requires signing in.')}
          </p>
          {qrUrl && (
            <a href={qrUrl} download="checklist-qr.png" className="text-fiba-accent hover:underline inline-block">
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
              ? t('Los oficiales pueden cargar ahora.', 'Officials can fill it in right now.')
              : t('Quien lo abra recibe un 404.', 'Anyone opening it gets a 404.')}
          </div>
        </div>
        {canEdit && (
          <button onClick={handleToggle} className="btn-fiba-ghost text-xs px-3 py-1.5">
            {link.enabled ? t('Desactivar', 'Disable') : t('Activar', 'Enable')}
          </button>
        )}
      </div>

      {link.rotated_at && (
        <p className="text-[11px] text-fiba-muted">
          {t('Última rotación', 'Last rotated')}: {new Date(link.rotated_at).toLocaleString(lang === 'es' ? 'es' : 'en-US')}
        </p>
      )}

      {canEdit && (
        <button onClick={handleRotate} className="text-xs text-red-400 hover:underline">
          {t('Rotar link', 'Rotate link')}
        </button>
      )}
    </div>
  )
}
