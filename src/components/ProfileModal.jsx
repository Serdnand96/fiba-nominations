import { useEffect, useMemo, useRef, useState } from 'react'
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

function TabButton({ active, icon, children, ...rest }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
        active
          ? 'bg-white text-navy-900 shadow-sm dark:bg-navy-700 dark:text-white'
          : 'text-ink-600 hover:text-ink-900 dark:text-ink-300 dark:hover:text-white'
      }`}
      {...rest}
    >
      <span className="w-4 h-4">{icon}</span>
      {children}
    </button>
  )
}

export default function ProfileModal({ open, onClose }) {
  const { user, profile, updateProfile, isSuperadmin } = useAuth()
  const { t } = useLanguage()
  const { push } = useToast()
  const inputRef = useRef(null)
  const [tab, setTab] = useState('photo')
  const [pending, setPending] = useState(null)   // File de la foto lista para subir
  const [preview, setPreview] = useState(null)   // object URL del pending
  const [busy, setBusy] = useState(false)

  // Pestaña Avatar: la librería se carga recién cuando se abre la pestaña.
  const [lib, setLib] = useState(null)
  const [libError, setLibError] = useState(false)
  const [styleKey, setStyleKey] = useState('avataaars')
  const [seeds, setSeeds] = useState([])
  const [chosen, setChosen] = useState(null)     // seed elegida en la grilla

  useEffect(() => {
    if (!open) { setPending(null); setChosen(null); setBusy(false); setTab('photo') }
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

  function switchTab(next) {
    setTab(next)
    // Cada pestaña tiene su propia selección: al cambiar se descarta la otra.
    if (next === 'photo') setChosen(null)
    else setPending(null)
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
    if (!confirm(t('profile.confirmRemove'))) return
    setBusy(true)
    try {
      await deleteMyAvatar()
      updateProfile({ avatar_url: null })
      setPending(null)
      setChosen(null)
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

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={t('profile.title')}
      subtitle={t('profile.subtitle')}
      size="md"
      closeLabel={t('common.close')}
      footer={
        <>
          {current && (
            <Button variant="ghost" size="sm" icon={<Icon.Trash />} onClick={onRemove} disabled={busy} className="mr-auto">
              {t('profile.removePhoto')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={onSave} disabled={!canSave || busy} icon={<Icon.Check />}>
            {busy ? t('common.saving') : t('profile.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <Avatar name={user?.email} src={shown} size="xl" tone="basketball" />
        <div className="text-center leading-tight">
          <div className="text-sm font-medium text-ink-900 dark:text-ink-50 break-all">{user?.email}</div>
          <div className="text-xs text-ink-500 dark:text-ink-400">{role}</div>
        </div>

        <div role="tablist" className="w-full flex gap-1 p-1 rounded-lg bg-ink-100 dark:bg-navy-800">
          <TabButton active={tab === 'photo'} icon={<Icon.Photo />} onClick={() => switchTab('photo')}>{t('profile.tabPhoto')}</TabButton>
          <TabButton active={tab === 'avatar'} icon={<Icon.Star />} onClick={() => switchTab('avatar')}>{t('profile.tabAvatar')}</TabButton>
        </div>

        {tab === 'photo' && (
          <div className="w-full flex flex-col items-center gap-3">
            <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onPick} />
            <Button variant="secondary" size="sm" icon={<Icon.Upload />} onClick={() => inputRef.current?.click()} disabled={busy}>
              {current || pending ? t('profile.changePhoto') : t('profile.choosePhoto')}
            </Button>
            <p className="text-2xs text-ink-500 dark:text-ink-400 text-center">{t('profile.hint')}</p>
          </div>
        )}

        {tab === 'avatar' && (
          <div className="w-full flex flex-col gap-3">
            {libError ? (
              <p className="text-xs text-danger-600 text-center">{t('profile.avatarLoadError')}</p>
            ) : !lib ? (
              <p className="text-xs text-ink-500 text-center">{t('common.loading')}</p>
            ) : (
              <>
                <div className="flex flex-wrap justify-center gap-1.5">
                  {lib.AVATAR_STYLES.map(s => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => { setStyleKey(s.key); setChosen(null) }}
                      className={`px-2.5 py-1 rounded-full text-2xs font-semibold border transition-colors ${
                        styleKey === s.key
                          ? 'bg-basketball-500 border-basketball-500 text-white'
                          : 'border-ink-200 text-ink-600 hover:border-ink-400 dark:border-navy-700 dark:text-ink-300 dark:hover:border-navy-500'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                  {candidates.map(c => (
                    <button
                      key={c.seed}
                      type="button"
                      onClick={() => setChosen(c.seed)}
                      aria-pressed={chosen === c.seed}
                      className={`aspect-square rounded-full overflow-hidden border-2 transition ${
                        chosen === c.seed
                          ? 'border-basketball-500 ring-2 ring-basketball-500/40'
                          : 'border-transparent hover:border-ink-300 dark:hover:border-navy-500'
                      }`}
                    >
                      <img src={c.src} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <p className="text-2xs text-ink-500 dark:text-ink-400">{t('profile.avatarHint')}</p>
                  <Button variant="secondary" size="sm" onClick={shuffle} disabled={busy}>{t('profile.moreAvatars')}</Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
