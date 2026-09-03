import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { Icon } from '../lib/icons'
import { Avatar, Button, Modal, useToast } from './ui'
import { uploadMyAvatar, deleteMyAvatar } from '../api/client'

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif'
const ALLOWED = ACCEPT.split(',')
const MAX_BYTES = 2 * 1024 * 1024
const SIDE = 512

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
  const [pending, setPending] = useState(null)   // File listo para subir
  const [preview, setPreview] = useState(null)   // object URL del pending
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) { setPending(null); setBusy(false) }
  }, [open])

  useEffect(() => {
    if (!pending) { setPreview(null); return }
    const url = URL.createObjectURL(pending)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [pending])

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
    if (!pending) return
    setBusy(true)
    try {
      const res = await uploadMyAvatar(pending)
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
      push({ type: 'success', title: t('profile.removed') })
    } catch {
      push({ type: 'error', title: t('profile.errorRemove') })
    } finally {
      setBusy(false)
    }
  }

  const current = profile?.avatar_url || null
  const shown = preview || current
  const role = isSuperadmin ? t('common.superadmin') : t('common.user')

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={t('profile.title')}
      subtitle={t('profile.subtitle')}
      size="sm"
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
          <Button onClick={onSave} disabled={!pending || busy} icon={<Icon.Upload />}>
            {busy ? t('common.uploading') : t('profile.savePhoto')}
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

        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onPick} />

        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="secondary" size="sm" icon={<Icon.Photo />} onClick={() => inputRef.current?.click()} disabled={busy}>
            {current || pending ? t('profile.changePhoto') : t('profile.choosePhoto')}
          </Button>
          {current && !pending && (
            <Button variant="ghost" size="sm" icon={<Icon.Trash />} onClick={onRemove} disabled={busy}>
              {t('profile.removePhoto')}
            </Button>
          )}
        </div>

        <p className="text-2xs text-ink-500 dark:text-ink-400 text-center">{t('profile.hint')}</p>
      </div>
    </Modal>
  )
}
