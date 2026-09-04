import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { Icon } from '../lib/icons'
import { Avatar, Button, Modal, useToast } from './ui'
import { uploadMyAvatar, deleteMyAvatar } from '../api/client'

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'
const ALLOWED = ACCEPT.split(',')
const MAX_BYTES = 2 * 1024 * 1024
const SIDE = 512
const CANDIDATES = 12
const TABS = ['photo', 'avatar']

// Recorta al centro en cuadrado y baja a 512px antes de subir: el avatar se ve
// siempre redondo y el archivo queda chico sin importar la foto original.
async function toSquare(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('decode'))
      i.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    if (!side) throw new Error('empty')
    const sx = (img.naturalWidth - side) / 2
    const sy = (img.naturalHeight - side) / 2
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = SIDE
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, SIDE, SIDE)
    ctx.drawImage(img, sx, sy, side, side, 0, 0, SIDE, SIDE)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.88))
    if (!blob) throw new Error('encode')
    return new File([blob], 'avatar.jpg', { type: 'image/jpeg' })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export default function ProfileModal({ open, onClose }) {
  const { user, profile, updateProfile, isSuperadmin } = useAuth()
  const { t } = useLanguage()
  const { push } = useToast()
  const inputRef = useRef(null)
  const tabRefs = useRef({})
  const ids = useId()
  const [tab, setTab] = useState('photo')
  const [pending, setPending] = useState(null)   // File de la foto lista para subir
  const [preview, setPreview] = useState(null)   // object URL del pending
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  // Pestaña Avatar: la librería se carga recién cuando se abre la pestaña.
  const [lib, setLib] = useState(null)
  const [libError, setLibError] = useState(false)
  const [styleKey, setStyleKey] = useState('avataaars')
  const [seeds, setSeeds] = useState([])
  const [chosen, setChosen] = useState(null)     // seed elegida en la grilla

  useEffect(() => {
    if (!open) {
      setPending(null); setChosen(null); setBusy(false); setTab('photo')
      setConfirmRemove(false); setLibError(false)
    }
  }, [open])

  useEffect(() => {
    if (!pending) { setPreview(null); return }
    const url = URL.createObjectURL(pending)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [pending])

  useEffect(() => {
    if (tab !== 'avatar' || lib || libError) return
    let alive = true
    import('../lib/avatars')
      .then(m => { if (!alive) return; setLib(m); setSeeds(m.randomSeeds(CANDIDATES)) })
      .catch(() => { if (alive) setLibError(true) })
    return () => { alive = false }
  }, [tab, lib, libError])

  const candidates = useMemo(() => {
    if (!lib) return []
    return seeds.map(seed => ({ seed, src: lib.svgDataUri(lib.avatarSvg(styleKey, seed, 96)) }))
  }, [lib, seeds, styleKey])

  const chosenSrc = useMemo(() => {
    if (!lib || !chosen) return null
    return lib.svgDataUri(lib.avatarSvg(styleKey, chosen, 256))
  }, [lib, chosen, styleKey])

  function shuffle() {
    if (!lib) return
    setSeeds(lib.randomSeeds(CANDIDATES))
    setChosen(null)
  }

  function switchTab(next, focus = false) {
    setTab(next)
    setConfirmRemove(false)
    // Cada pestaña tiene su propia selección: al cambiar se descarta la otra.
    if (next === 'photo') setChosen(null)
    else setPending(null)
    if (focus) tabRefs.current[next]?.focus()
  }

  // Flechas, Home y End entre pestañas (patrón tabs de WAI-ARIA).
  function onTabKeyDown(e) {
    const i = TABS.indexOf(tab)
    let next = null
    if (e.key === 'ArrowRight') next = TABS[(i + 1) % TABS.length]
    else if (e.key === 'ArrowLeft') next = TABS[(i - 1 + TABS.length) % TABS.length]
    else if (e.key === 'Home') next = TABS[0]
    else if (e.key === 'End') next = TABS[TABS.length - 1]
    if (next) { e.preventDefault(); switchTab(next, true) }
  }

  async function onPick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!ALLOWED.includes(file.type)) {
      push({ type: 'error', title: t('profile.invalidType') })
      return
    }
    try {
      setPending(await toSquare(file))
    } catch {
      // El navegador no pudo decodificar la imagen: se sube tal cual si entra.
      if (file.size > MAX_BYTES) {
        push({ type: 'error', title: t('profile.tooLarge') })
        return
      }
      setPending(file)
    }
  }

  async function onSave() {
    let file = pending
    setBusy(true)
    try {
      if (tab === 'avatar') {
        if (!lib || !chosen) return
        file = await lib.svgToPngFile(lib.avatarSvg(styleKey, chosen, SIDE), SIDE)
      }
      if (!file) return
      const res = await uploadMyAvatar(file)
      updateProfile({ avatar_url: res.avatar_url })
      push({ type: 'success', title: t('profile.uploaded') })
      onClose()
    } catch (err) {
      push({ type: 'error', title: err?.response?.data?.detail || t('profile.errorUpload') })
    } finally {
      setBusy(false)
    }
  }

  async function onRemove() {
    setBusy(true)
    try {
      await deleteMyAvatar()
      updateProfile({ avatar_url: null })
      setPending(null)
      setChosen(null)
      setConfirmRemove(false)
      push({ type: 'success', title: t('profile.removed') })
    } catch {
      push({ type: 'error', title: t('profile.errorRemove') })
    } finally {
      setBusy(false)
    }
  }

  const current = profile?.avatar_url || null
  const shown = (tab === 'avatar' ? chosenSrc : preview) || current
  const canSave = tab === 'avatar' ? !!chosen : !!pending
  const role = isSuperadmin ? t('common.superadmin') : t('common.user')
  const tabId = (k) => `${ids}-tab-${k}`
  const panelId = (k) => `${ids}-panel-${k}`

  const footer = confirmRemove ? (
    <>
      <span className="text-[13px] text-ink-700 dark:text-ink-200 mr-auto">{t('profile.confirmRemove')}</span>
      <Button variant="secondary" onClick={() => setConfirmRemove(false)} disabled={busy}>{t('common.cancel')}</Button>
      <Button variant="danger" onClick={onRemove} disabled={busy} icon={<Icon.Trash />}>
        {busy ? t('common.saving') : t('profile.confirmRemoveYes')}
      </Button>
    </>
  ) : (
    <>
      {current && (
        <Button variant="ghost" size="sm" icon={<Icon.Trash />} onClick={() => setConfirmRemove(true)} disabled={busy} className="mr-auto">
          {t('profile.removePhoto')}
        </Button>
      )}
      <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
      <Button onClick={onSave} disabled={!canSave || busy} icon={<Icon.Check />}>
        {busy ? t('common.saving') : t('profile.save')}
      </Button>
    </>
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeDisabled={busy}
      title={t('profile.title')}
      subtitle={t('profile.subtitle')}
      size="md"
      closeLabel={t('common.close')}
      footer={footer}
    >
      <div className="flex flex-col items-center gap-4">
        <Avatar name={user?.email} src={shown} size="xl" tone="basketball" />
        <div className="text-center leading-tight max-w-full">
          <div className="text-sm font-medium text-ink-900 dark:text-ink-50 break-words">{user?.email}</div>
          <div className="text-xs text-ink-500 dark:text-ink-400">{role}</div>
        </div>

        <div role="tablist" aria-label={t('profile.tabsLabel')} className="w-full flex gap-1 p-1 rounded-lg bg-ink-100 dark:bg-navy-800">
          {TABS.map(k => (
            <button
              key={k}
              ref={el => { tabRefs.current[k] = el }}
              type="button"
              role="tab"
              id={tabId(k)}
              aria-selected={tab === k}
              aria-controls={panelId(k)}
              tabIndex={tab === k ? 0 : -1}
              onClick={() => switchTab(k)}
              onKeyDown={onTabKeyDown}
              className={`flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 px-3 min-h-[44px] sm:min-h-[36px] rounded-md text-[13px] font-medium transition-colors ${
                tab === k
                  ? 'bg-white text-navy-900 shadow-sm dark:bg-navy-700 dark:text-white'
                  : 'text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-white'
              }`}
            >
              {k === 'photo' ? <Icon.Photo className="w-4 h-4" /> : <Icon.Star className="w-4 h-4" />}
              <span className="truncate">{k === 'photo' ? t('profile.tabPhoto') : t('profile.tabAvatar')}</span>
            </button>
          ))}
        </div>

        {tab === 'photo' && (
          <div role="tabpanel" id={panelId('photo')} aria-labelledby={tabId('photo')} className="w-full flex flex-col items-center gap-3">
            <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onPick} />
            <Button variant="secondary" icon={<Icon.Upload />} onClick={() => inputRef.current?.click()} disabled={busy}>
              {current || pending ? t('profile.changePhoto') : t('profile.choosePhoto')}
            </Button>
            <p className="text-2xs text-ink-500 dark:text-ink-400 text-center">{t('profile.hint')}</p>
          </div>
        )}

        {tab === 'avatar' && (
          <div role="tabpanel" id={panelId('avatar')} aria-labelledby={tabId('avatar')} className="w-full flex flex-col gap-3">
            {libError ? (
              <div role="alert" className="flex flex-col items-center gap-2 py-4">
                <p className="text-xs text-danger-600 dark:text-danger-100 text-center">{t('profile.avatarLoadError')}</p>
                <Button variant="secondary" size="sm" onClick={() => setLibError(false)}>{t('profile.retry')}</Button>
              </div>
            ) : !lib ? (
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2" aria-busy="true" aria-label={t('common.loading')}>
                {Array.from({ length: CANDIDATES }, (_, i) => (
                  <div key={i} className="aspect-square rounded-full bg-ink-100 dark:bg-navy-800 animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                <div role="group" aria-label={t('profile.stylesLabel')} className="flex flex-wrap justify-center gap-1.5">
                  {lib.AVATAR_STYLES.map(s => (
                    <button
                      key={s.key}
                      type="button"
                      aria-pressed={styleKey === s.key}
                      onClick={() => { setStyleKey(s.key); setChosen(null) }}
                      className={`px-3 min-h-[36px] sm:min-h-[28px] rounded-full text-2xs font-semibold border transition-colors ${
                        styleKey === s.key
                          ? 'bg-basketball-700 border-basketball-700 text-white'
                          : 'border-ink-200 text-ink-700 hover:border-ink-400 dark:border-navy-700 dark:text-ink-200 dark:hover:border-navy-500'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2" aria-live="polite">
                  {candidates.map((c, i) => (
                    <button
                      key={c.seed}
                      type="button"
                      onClick={() => setChosen(c.seed)}
                      aria-pressed={chosen === c.seed}
                      aria-label={`${t('profile.avatarOption')} ${i + 1}`}
                      className={`relative aspect-square rounded-full overflow-hidden border-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-basketball-500 ${
                        chosen === c.seed
                          ? 'border-basketball-700 ring-2 ring-basketball-500/40'
                          : 'border-transparent hover:border-ink-300 dark:hover:border-navy-500'
                      }`}
                    >
                      <img src={c.src} alt="" className="w-full h-full object-cover" />
                      {chosen === c.seed && (
                        <span className="absolute inset-0 flex items-center justify-center bg-navy-950/35">
                          <Icon.Check className="w-5 h-5 text-white" />
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-3">
                  <p className="text-2xs text-ink-500 dark:text-ink-400">{t('profile.avatarHint')}</p>
                  <Button variant="secondary" size="sm" onClick={shuffle} disabled={busy} className="whitespace-nowrap flex-shrink-0">{t('profile.moreAvatars')}</Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
