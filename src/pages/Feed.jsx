import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getFeedMe, getFeedPosts, createFeedPost, updateFeedPost, deleteFeedPost, pinFeedPost,
  reactFeedPost, getFeedComments, addFeedComment, deleteFeedComment, voteFeedPoll, getFeedSidebar,
} from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { Icon } from '../lib/icons'
import { Avatar, Badge, Button, Card, Empty, IconButton, Modal, useToast } from '../components/ui'

// El Muro: el módulo menos formal del sistema. Publicaciones con foto, link o
// encuesta; reacciones con emoji; comentarios; fijados. Ver feed.py para la
// semántica del permiso (view = participar, edit = moderar).

const PAGE_SIZE = 15
const MAX_BODY = 4000
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const EMOJIS = ['👍', '❤️', '🏀', '🎉', '😂', '👏']

// Mismo orden y claves que CATEGORIES en feed.py.
const CATEGORIES = [
  { key: 'general', emoji: '💬', tone: 'ink' },
  { key: 'news',    emoji: '📰', tone: 'navy' },
  { key: 'event',   emoji: '🏀', tone: 'basketball' },
  { key: 'hr',      emoji: '🧑‍💼', tone: 'info' },
  { key: 'fun',     emoji: '😄', tone: 'warning' },
  { key: 'kudos',   emoji: '👏', tone: 'success' },
]
const CATEGORY_BY_KEY = Object.fromEntries(CATEGORIES.map(c => [c.key, c]))

// Con paréntesis de captura, split() conserva los links entre los pedazos de
// texto. Sin flag g a propósito: test() con g es stateful (lastIndex).
const URL_SPLIT_RE = /(https?:\/\/[^\s<]+)/
const URL_RE = /^https?:\/\/[^\s<]+$/

// Texto plano → párrafos con los links clickeables. Nunca HTML crudo.
function Linkify({ text }) {
  const parts = text.split(URL_SPLIT_RE)
  return (
    <>
      {parts.map((part, i) => (
        URL_RE.test(part)
          ? <a key={i} href={part} target="_blank" rel="noopener noreferrer"
               className="text-basketball-600 dark:text-basketball-400 hover:underline break-all">{part}</a>
          : <span key={i}>{part}</span>
      ))}
    </>
  )
}

function useTimeAgo() {
  const { t, lang } = useLanguage()
  return useCallback((iso) => {
    const then = new Date(iso).getTime()
    const diff = Math.max(0, Date.now() - then)
    const min = Math.floor(diff / 60000)
    if (min < 1) return t('feed.justNow')
    if (min < 60) return t('feed.minutesAgo', { n: min })
    const h = Math.floor(min / 60)
    if (h < 24) return t('feed.hoursAgo', { n: h })
    const d = Math.floor(h / 24)
    if (d < 7) return t('feed.daysAgo', { n: d })
    return new Date(iso).toLocaleDateString(lang === 'es' ? 'es' : 'en', { day: '2-digit', month: 'short', year: 'numeric' })
  }, [t, lang])
}

function fmtRange(start, end, lang) {
  if (!start) return ''
  const loc = lang === 'es' ? 'es' : 'en'
  const opts = { day: 'numeric', month: 'short' }
  const s = new Date(`${start}T00:00:00`).toLocaleDateString(loc, opts)
  if (!end || end === start) return s
  const e = new Date(`${end}T00:00:00`).toLocaleDateString(loc, opts)
  return `${s} – ${e}`
}

function CategoryBadge({ category }) {
  const { t } = useLanguage()
  const cfg = CATEGORY_BY_KEY[category] || CATEGORY_BY_KEY.general
  return <Badge tone={cfg.tone} size="sm">{cfg.emoji} {t(`feed.${cfg.key}`)}</Badge>
}

/* ── Composer ──────────────────────────────────────────────────────────── */

function Composer({ me, events, onPosted }) {
  const { t } = useLanguage()
  const { push } = useToast()
  const [body, setBody] = useState('')
  const [category, setCategory] = useState('general')
  const [showLink, setShowLink] = useState(false)
  const [link, setLink] = useState('')
  const [showPoll, setShowPoll] = useState(false)
  const [pollOptions, setPollOptions] = useState(['', ''])
  const [image, setImage] = useState(null)
  const [preview, setPreview] = useState(null)
  const [official, setOfficial] = useState(false)
  const [competitionId, setCompetitionId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const textRef = useRef(null)

  useEffect(() => {
    if (!image) { setPreview(null); return }
    const url = URL.createObjectURL(image)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [image])

  // El textarea crece con el texto, sin scroll interno.
  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [body])

  function pickImage(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > MAX_IMAGE_BYTES) { setError(t('feed.imageTooLarge')); return }
    setError('')
    setImage(f)
  }

  function reset() {
    setBody(''); setCategory('general'); setShowLink(false); setLink('')
    setShowPoll(false); setPollOptions(['', '']); setImage(null)
    setOfficial(false); setCompetitionId(''); setError('')
  }

  const canPost = body.trim().length > 0 && body.length <= MAX_BODY && !saving

  async function submit() {
    if (!canPost) return
    const options = showPoll ? pollOptions.map(o => o.trim()).filter(Boolean) : []
    if (showPoll && options.length < 2) { setError(t('feed.pollNeedsTwo')); return }
    const linkValue = showLink ? link.trim() : ''
    if (linkValue && !/^https?:\/\//i.test(linkValue)) { setError(t('feed.invalidLink')); return }
    setSaving(true)
    setError('')
    try {
      const post = await createFeedPost({
        body: body.trim(), category, link_url: linkValue || undefined,
        poll_options: options, competition_id: competitionId || undefined,
        is_official: official, image,
      })
      reset()
      onPosted(post)
    } catch (e) {
      setError(e?.response?.data?.detail || t('feed.postFailed'))
      push({ type: 'error', title: t('feed.postFailed') })
    }
    setSaving(false)
  }

  function onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submit() }
  }

  return (
    <Card padding="p-4 md:p-5">
      <div className="flex gap-3">
        <Avatar name={me?.name} tone="basketball" size="lg" />
        <div className="flex-1 min-w-0">
          <textarea
            ref={textRef}
            value={body}
            onChange={e => setBody(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('feed.composerPlaceholder', { name: (me?.name || '').split(' ')[0] })}
            rows={2}
            maxLength={MAX_BODY}
            className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-ink-900 dark:text-ink-50 placeholder:text-ink-400 focus:outline-none"
          />

          {preview && (
            <div className="relative mt-2 inline-block">
              <img src={preview} alt="" className="max-h-64 rounded-lg border border-ink-200 dark:border-navy-700 object-cover" />
              <button type="button" onClick={() => setImage(null)} aria-label={t('feed.removeImage')}
                className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-navy-950/70 text-white flex items-center justify-center hover:bg-navy-950">
                <Icon.X className="w-4 h-4" />
              </button>
            </div>
          )}

          {showLink && (
            <input
              type="url" value={link} onChange={e => setLink(e.target.value)}
              placeholder={t('feed.linkPlaceholder')}
              className="fiba-input mt-2"
            />
          )}

          {showPoll && (
            <div className="mt-3 space-y-2 rounded-lg border border-dashed border-ink-200 dark:border-navy-700 p-3">
              {pollOptions.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text" value={opt} maxLength={100}
                    onChange={e => setPollOptions(prev => prev.map((o, j) => j === i ? e.target.value : o))}
                    placeholder={t('feed.pollOption', { n: i + 1 })}
                    className="fiba-input flex-1"
                  />
                  {pollOptions.length > 2 && (
                    <IconButton icon={<Icon.X />} size="sm" label={t('common.remove')}
                      onClick={() => setPollOptions(prev => prev.filter((_, j) => j !== i))} />
                  )}
                </div>
              ))}
              {pollOptions.length < 6 && (
                <button type="button" onClick={() => setPollOptions(prev => [...prev, ''])}
                  className="text-xs font-medium text-basketball-600 dark:text-basketball-400 hover:underline">
                  {t('feed.addOption')}
                </button>
              )}
            </div>
          )}

          {/* Categoría */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            {CATEGORIES.map(c => (
              <button
                key={c.key} type="button" onClick={() => setCategory(c.key)}
                className={`px-2.5 h-7 rounded-full text-xs font-medium border transition-colors ${
                  category === c.key
                    ? 'bg-navy-900 text-white border-navy-900 dark:bg-basketball-600 dark:border-basketball-600'
                    : 'bg-transparent text-ink-600 border-ink-200 hover:bg-ink-100 dark:text-ink-300 dark:border-navy-700 dark:hover:bg-navy-800'
                }`}
              >
                {c.emoji} {t(`feed.${c.key}`)}
              </button>
            ))}
          </div>

          {(me?.is_moderator || events.length > 0) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3">
              {events.length > 0 && (
                <select value={competitionId} onChange={e => setCompetitionId(e.target.value)}
                  className="fiba-select !w-auto max-w-full text-xs" aria-label={t('feed.linkEvent')}>
                  <option value="">{t('feed.noEvent')}</option>
                  {events.map(ev => <option key={ev.id} value={ev.id}>🏀 {ev.short_name || ev.name}</option>)}
                </select>
              )}
              {me?.is_moderator && (
                <label className="flex items-center gap-2 text-xs text-ink-600 dark:text-ink-300 cursor-pointer" title={t('feed.officialHint')}>
                  <input type="checkbox" checked={official} onChange={e => setOfficial(e.target.checked)}
                    className="rounded border-ink-300 text-basketball-600 focus:ring-basketball-500" />
                  <Icon.Megaphone className="w-3.5 h-3.5" /> {t('feed.official')}
                </label>
              )}
            </div>
          )}

          {error && <div className="mt-2 text-xs text-danger-600 flex items-center gap-1"><Icon.Alert className="w-3.5 h-3.5" /> {error}</div>}

          <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-ink-100 dark:border-navy-800">
            <div className="flex items-center gap-1">
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickImage} />
              <Button variant="ghost" size="xs" icon={<Icon.Photo />} onClick={() => fileRef.current?.click()}>{t('feed.addPhoto')}</Button>
              <Button variant="ghost" size="xs" icon={<Icon.Link />} onClick={() => setShowLink(v => !v)}
                className={showLink ? 'bg-ink-100 dark:bg-navy-800' : ''}>{t('feed.addLink')}</Button>
              <Button variant="ghost" size="xs" icon={<Icon.Poll />} onClick={() => setShowPoll(v => !v)}
                className={showPoll ? 'bg-ink-100 dark:bg-navy-800' : ''}>{t('feed.addPoll')}</Button>
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden sm:inline text-2xs text-ink-400">{t('feed.ctrlEnter')}</span>
              <Button size="sm" icon={<Icon.Send />} disabled={!canPost} onClick={submit}>
                {saving ? t('feed.publishing') : t('feed.publish')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}

/* ── Poll ──────────────────────────────────────────────────────────────── */

function Poll({ post, onChange }) {
  const { t } = useLanguage()
  const { push } = useToast()
  const [busy, setBusy] = useState(false)
  const poll = post.poll
  if (!poll) return null
  const voted = poll.my_vote !== null && poll.my_vote !== undefined

  async function vote(i) {
    if (busy || poll.my_vote === i) return
    setBusy(true)
    try { onChange(await voteFeedPoll(post.id, i)) }
    catch { push({ type: 'error', title: t('feed.actionFailed') }) }
    setBusy(false)
  }

  return (
    <div className="mt-3 space-y-1.5">
      {poll.options.map((opt, i) => {
        const pct = poll.total ? Math.round((opt.votes / poll.total) * 100) : 0
        const mine = poll.my_vote === i
        return (
          <button
            key={i} type="button" onClick={() => vote(i)} disabled={busy}
            className={`relative w-full text-left rounded-lg border overflow-hidden transition-colors ${
              mine ? 'border-basketball-500' : 'border-ink-200 dark:border-navy-700 hover:border-ink-300 dark:hover:border-navy-600'
            }`}
          >
            {voted && (
              <span className={`absolute inset-y-0 left-0 ${mine ? 'bg-basketball-500/20' : 'bg-ink-100 dark:bg-navy-800'}`}
                style={{ width: `${pct}%` }} aria-hidden="true" />
            )}
            <span className="relative flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="text-ink-800 dark:text-ink-100 flex items-center gap-2">
                {mine && <Icon.Check className="w-4 h-4 text-basketball-600" />}
                {opt.text}
              </span>
              {voted && <span className="font-mono text-xs text-ink-500 dark:text-ink-400">{pct}%</span>}
            </span>
          </button>
        )
      })}
      <div className="text-2xs text-ink-400">
        {poll.total === 1 ? t('feed.vote') : t('feed.votes', { n: poll.total })}
        {!voted && ` · ${t('feed.voteHint')}`}
      </div>
    </div>
  )
}

/* ── Comments ──────────────────────────────────────────────────────────── */

function Comments({ post, onCount }) {
  const { t } = useLanguage()
  const { push } = useToast()
  const timeAgo = useTimeAgo()
  const [items, setItems] = useState(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let alive = true
    getFeedComments(post.id).then(rows => { if (alive) setItems(rows) }).catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [post.id])

  async function send() {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try {
      const c = await addFeedComment(post.id, body)
      setItems(prev => [...(prev || []), c])
      setText('')
      onCount(1)
    } catch { push({ type: 'error', title: t('feed.actionFailed') }) }
    setSending(false)
  }

  async function remove(c) {
    if (!window.confirm(t('feed.confirmDeleteComment'))) return
    try {
      await deleteFeedComment(c.id)
      setItems(prev => prev.filter(x => x.id !== c.id))
      onCount(-1)
    } catch { push({ type: 'error', title: t('feed.actionFailed') }) }
  }

  return (
    <div className="mt-3 pt-3 border-t border-ink-100 dark:border-navy-800 space-y-3">
      {items === null ? (
        <div className="text-xs text-ink-400">{t('common.loading')}</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-ink-400">{t('feed.noComments')}</div>
      ) : items.map(c => (
        <div key={c.id} className="flex gap-2.5 group">
          <Avatar name={c.author_name} size="sm" tone="ink" />
          <div className="flex-1 min-w-0">
            <div className="inline-block max-w-full rounded-2xl rounded-tl-md bg-ink-50 dark:bg-navy-800 px-3 py-2">
              <div className="text-xs font-semibold text-ink-900 dark:text-ink-50">{c.author_name}</div>
              <div className="text-sm text-ink-800 dark:text-ink-100 whitespace-pre-wrap break-words"><Linkify text={c.body} /></div>
            </div>
            <div className="flex items-center gap-2 mt-0.5 pl-1 text-2xs text-ink-400">
              <span>{timeAgo(c.created_at)}</span>
              {c.can_manage && (
                <button type="button" onClick={() => remove(c)}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-danger-600 transition-opacity">
                  {t('common.delete')}
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input
          type="text" value={text} maxLength={1000}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send() } }}
          placeholder={t('feed.commentPlaceholder')}
          className="fiba-input flex-1 !rounded-full"
        />
        <IconButton icon={<Icon.Send />} label={t('feed.send')} variant="secondary" size="sm"
          disabled={!text.trim() || sending} onClick={send} />
      </div>
    </div>
  )
}

/* ── Post card ─────────────────────────────────────────────────────────── */

function PostCard({ post, isModerator, onUpdate, onDelete }) {
  const { t, lang } = useLanguage()
  const { push } = useToast()
  const timeAgo = useTimeAgo()
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(post.body)
  const [showComments, setShowComments] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  async function run(fn, successKey) {
    setBusy(true)
    try {
      const updated = await fn()
      if (updated) onUpdate(updated)
      if (successKey) push({ type: 'success', title: t(successKey) })
    } catch (e) {
      push({ type: 'error', title: e?.response?.data?.detail || t('feed.actionFailed') })
    }
    setBusy(false)
  }

  async function react(emoji) {
    // Optimista: el emoji cambia al toque y el backend confirma los totales.
    try {
      const summary = await reactFeedPost(post.id, emoji)
      onUpdate({ ...post, ...summary })
    } catch { push({ type: 'error', title: t('feed.actionFailed') }) }
  }

  async function saveEdit() {
    const body = draft.trim()
    if (!body) return
    await run(() => updateFeedPost(post.id, { body }), 'feed.saved')
    setEditing(false)
  }

  async function doDelete() {
    setConfirmDelete(false)
    setBusy(true)
    try {
      await deleteFeedPost(post.id)
      onDelete(post.id)
      push({ type: 'success', title: t('feed.deleted') })
    } catch { push({ type: 'error', title: t('feed.actionFailed') }) }
    setBusy(false)
  }

  const comp = post.competition
  const highlight = post.is_official
    ? 'border-basketball-300 dark:border-basketball-700/60 ring-1 ring-basketball-200/60 dark:ring-basketball-800/40'
    : post.is_pinned ? 'border-navy-300 dark:border-navy-600' : ''

  return (
    <Card padding="p-4 md:p-5" className={`screen-enter ${highlight}`}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <Avatar name={post.author_name} tone={post.is_official ? 'basketball' : 'navy'} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[14px] font-semibold text-ink-900 dark:text-ink-50 truncate">{post.author_name}</span>
            <CategoryBadge category={post.category} />
            {post.is_official && <Badge tone="basketball" size="sm" icon={<Icon.Megaphone />}>{t('feed.officialBadge')}</Badge>}
            {post.is_pinned && <Badge tone="navy" size="sm" icon={<Icon.PushpinFilled />}>{t('feed.pinned')}</Badge>}
          </div>
          <div className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">
            {timeAgo(post.created_at)}
            {post.edited_at && <span> · {t('feed.edited')}</span>}
          </div>
        </div>
        {post.can_manage && (
          <div className="relative" ref={menuRef}>
            <IconButton icon={<Icon.Dots />} label={t('feed.postActions')} size="sm" onClick={() => setMenuOpen(v => !v)} disabled={busy} />
            {menuOpen && (
              <div className="absolute right-0 mt-1 w-52 rounded-lg border border-ink-200 dark:border-navy-700 bg-white dark:bg-navy-900 shadow-pop py-1 z-20 text-sm">
                {post.is_mine || isModerator ? (
                  <MenuItem icon={<Icon.Pencil />} onClick={() => { setMenuOpen(false); setDraft(post.body); setEditing(true) }}>{t('common.edit')}</MenuItem>
                ) : null}
                {isModerator && (
                  <>
                    <MenuItem icon={post.is_pinned ? <Icon.Pushpin /> : <Icon.PushpinFilled />}
                      onClick={() => { setMenuOpen(false); run(() => pinFeedPost(post.id, !post.is_pinned)) }}>
                      {post.is_pinned ? t('feed.unpin') : t('feed.pin')}
                    </MenuItem>
                    <MenuItem icon={<Icon.Megaphone />}
                      onClick={() => { setMenuOpen(false); run(() => updateFeedPost(post.id, { is_official: !post.is_official })) }}>
                      {post.is_official ? t('feed.unmarkOfficial') : t('feed.markOfficial')}
                    </MenuItem>
                  </>
                )}
                <MenuItem icon={<Icon.Trash />} danger onClick={() => { setMenuOpen(false); setConfirmDelete(true) }}>{t('common.delete')}</MenuItem>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="mt-3">
        {editing ? (
          <div>
            <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={4} maxLength={MAX_BODY}
              className="fiba-input !h-auto resize-y text-[15px] leading-relaxed" autoFocus />
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="ghost" size="xs" onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
              <Button size="xs" onClick={saveEdit} disabled={busy || !draft.trim()}>{t('common.save')}</Button>
            </div>
          </div>
        ) : (
          <p className="text-[15px] leading-relaxed text-ink-900 dark:text-ink-50 whitespace-pre-wrap break-words">
            <Linkify text={post.body} />
          </p>
        )}

        {post.image_url && (
          <a href={post.image_url} target="_blank" rel="noopener noreferrer" className="block mt-3">
            <img src={post.image_url} alt="" loading="lazy"
              className="w-full max-h-[480px] object-cover rounded-lg border border-ink-200 dark:border-navy-700" />
          </a>
        )}

        {post.link_url && (
          <a href={post.link_url} target="_blank" rel="noopener noreferrer"
            className="mt-3 flex items-center gap-2 rounded-lg border border-ink-200 dark:border-navy-700 px-3 py-2 text-sm text-ink-700 dark:text-ink-200 hover:bg-ink-50 dark:hover:bg-navy-800 transition-colors">
            <Icon.Link className="w-4 h-4 text-ink-400 flex-shrink-0" />
            <span className="truncate">{post.link_url.replace(/^https?:\/\//, '')}</span>
          </a>
        )}

        {comp && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-md bg-basketball-50 dark:bg-basketball-900/20 text-basketball-800 dark:text-basketball-300 px-2.5 py-1 text-xs font-medium">
            <Icon.Trophy className="w-3.5 h-3.5" />
            <span>{comp.short_name || comp.name}</span>
            {comp.start_date && <span className="text-basketball-600/80 dark:text-basketball-400/80">· {fmtRange(comp.start_date, comp.end_date, lang)}</span>}
          </div>
        )}

        <Poll post={post} onChange={poll => onUpdate({ ...post, poll })} />
      </div>

      {/* Reactions + comments toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
        <div className="flex items-center gap-1">
          {EMOJIS.map(e => {
            const n = post.reactions?.[e] || 0
            const mine = post.my_reaction === e
            return (
              <button
                key={e} type="button" onClick={() => react(e)}
                aria-label={t('feed.react', { emoji: e })} aria-pressed={mine}
                className={`h-8 min-w-[2rem] px-1.5 rounded-full text-base leading-none inline-flex items-center gap-1 border transition-all hover:scale-110 ${
                  mine
                    ? 'bg-basketball-100 border-basketball-400 dark:bg-basketball-900/40 dark:border-basketball-600'
                    : 'border-transparent hover:bg-ink-100 dark:hover:bg-navy-800'
                }`}
              >
                <span>{e}</span>
                {n > 0 && <span className="font-mono text-xs text-ink-600 dark:text-ink-300">{n}</span>}
              </button>
            )
          })}
        </div>
        <button type="button" onClick={() => setShowComments(v => !v)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-500 dark:text-ink-400 hover:text-ink-900 dark:hover:text-white">
          <Icon.Message className="w-4 h-4" />
          {post.comment_count} {post.comment_count === 1 ? t('feed.comment') : t('feed.comments')}
        </button>
      </div>

      {showComments && (
        <Comments post={post} onCount={delta => onUpdate({ ...post, comment_count: Math.max(0, post.comment_count + delta) })} />
      )}

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title={t('feed.confirmDeleteTitle')} size="sm"
        closeLabel={t('common.close')}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={doDelete}>{t('common.delete')}</Button>
        </>}>
        <p className="text-sm text-ink-600 dark:text-ink-300">{t('feed.confirmDeleteBody')}</p>
      </Modal>
    </Card>
  )
}

function MenuItem({ icon, danger, children, ...rest }) {
  return (
    <button type="button" {...rest}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-ink-50 dark:hover:bg-navy-800 ${danger ? 'text-danger-600' : 'text-ink-800 dark:text-ink-100'}`}>
      {icon && <span className="w-4 h-4 flex-shrink-0 [&>svg]:w-4 [&>svg]:h-4">{icon}</span>}
      {children}
    </button>
  )
}

/* ── Sidebar ───────────────────────────────────────────────────────────── */

function SideCard({ title, icon, children }) {
  return (
    <Card padding="p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-ink-400 [&>svg]:w-4 [&>svg]:h-4">{icon}</span>
        <h3 className="text-[13px] font-semibold text-ink-900 dark:text-white">{title}</h3>
      </div>
      {children}
    </Card>
  )
}

function Sidebar({ data, isModerator }) {
  const { t, lang } = useLanguage()
  if (!data) return null
  const week = data.week || {}
  return (
    <div className="space-y-4">
      <SideCard title={t('feed.upcomingEvents')} icon={<Icon.Calendar />}>
        {data.events.length === 0 ? (
          <p className="text-xs text-ink-400">{t('feed.noEvents')}</p>
        ) : (
          <ul className="space-y-2.5">
            {data.events.map(ev => (
              <li key={ev.id} className="flex items-start gap-2.5">
                <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${ev.live ? 'bg-success-500 animate-pulse' : 'bg-basketball-500'}`} />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-ink-900 dark:text-ink-50 truncate">{ev.short_name || ev.name}</div>
                  <div className="text-xs text-ink-500 dark:text-ink-400 truncate">
                    {fmtRange(ev.start_date, ev.end_date, lang)}{ev.location ? ` · ${ev.location}` : ''}
                    {ev.live && <span className="ml-1.5 text-success-600 font-medium">{t('feed.live')}</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SideCard>

      <SideCard title={t('feed.traveling')} icon={<Icon.Plane />}>
        {data.traveling.length === 0 ? (
          <p className="text-xs text-ink-400">{t('feed.noTraveling')}</p>
        ) : (
          <div className="space-y-3">
            {data.traveling.map(g => (
              <div key={g.competition.id}>
                <div className="text-2xs font-semibold uppercase tracking-wider text-basketball-600 dark:text-basketball-400 truncate">
                  {g.competition.short_name || g.competition.name}
                </div>
                <ul className="mt-1 space-y-1">
                  {g.people.map((p, i) => (
                    <li key={i} className="flex items-center gap-2 text-[13px]">
                      <Avatar name={p.name} size="xs" tone="ink" />
                      <span className="text-ink-800 dark:text-ink-100 truncate">{p.name}</span>
                      {p.role && <span className="text-2xs text-ink-400 truncate">· {p.role}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </SideCard>

      <SideCard title={t('feed.weekTitle')} icon={<Icon.Feed />}>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[['posts', 'weekPosts'], ['reactions', 'weekReactions'], ['comments', 'weekComments']].map(([k, label]) => (
            <div key={k} className="rounded-lg bg-ink-50 dark:bg-navy-800 py-2">
              <div className="font-mono text-lg font-semibold text-navy-900 dark:text-white">{week[k] ?? 0}</div>
              <div className="text-2xs text-ink-500 dark:text-ink-400">{t(`feed.${label}`)}</div>
            </div>
          ))}
        </div>
        {week.top_author && (
          <div className="mt-3 flex items-center gap-2 text-xs text-ink-600 dark:text-ink-300">
            <span>🏆</span>
            <span>{t('feed.topAuthor')}: <span className="font-semibold text-ink-900 dark:text-white">{week.top_author.name}</span></span>
          </div>
        )}
      </SideCard>

      {isModerator && (
        <p className="text-2xs text-ink-400 px-1 leading-relaxed">{t('feed.moderatorHint')}</p>
      )}
    </div>
  )
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function Feed() {
  const { t } = useLanguage()
  const { hasEdit } = useAuth()
  const isModerator = hasEdit('feed')

  const [me, setMe] = useState(null)
  const [sidebar, setSidebar] = useState(null)
  const [posts, setPosts] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [category, setCategory] = useState('')
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const requestSeq = useRef(0)

  useEffect(() => {
    getFeedMe().then(setMe).catch(() => setMe({ name: '', is_moderator: false }))
    getFeedSidebar().then(setSidebar).catch(() => setSidebar({ events: [], traveling: [], week: {} }))
  }, [])

  const params = useCallback((offset) => {
    const p = { limit: PAGE_SIZE, offset }
    if (category) p.category = category
    if (pinnedOnly) p.pinned = true
    return p
  }, [category, pinnedOnly])

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(false)
    try {
      const data = await getFeedPosts(params(0))
      if (seq !== requestSeq.current) return
      setPosts(data.items)
      setHasMore(data.has_more)
    } catch {
      if (seq === requestSeq.current) setError(true)
    }
    if (seq === requestSeq.current) setLoading(false)
  }, [params])

  useEffect(() => { load() }, [load])

  async function loadMore() {
    const seq = requestSeq.current
    setLoadingMore(true)
    try {
      const data = await getFeedPosts(params(posts.length))
      if (seq !== requestSeq.current) return
      setPosts(prev => [...prev, ...data.items])
      setHasMore(data.has_more)
    } catch { /* el botón queda para reintentar */ }
    setLoadingMore(false)
  }

  function onPosted(post) {
    // Lo recién publicado aparece arriba salvo que el filtro lo excluya.
    if ((category && post.category !== category) || pinnedOnly) { load(); return }
    setPosts(prev => [post, ...prev])
    getFeedSidebar().then(setSidebar).catch(() => {})
  }

  function onUpdate(updated) {
    setPosts(prev => {
      const next = prev.map(p => p.id === updated.id ? updated : p)
      // Fijar/desfijar reordena: los fijados van arriba.
      return next.sort((a, b) => (b.is_pinned - a.is_pinned) || (b.created_at > a.created_at ? 1 : -1))
    })
  }

  function onDelete(id) {
    setPosts(prev => prev.filter(p => p.id !== id))
  }

  const events = useMemo(() => sidebar?.events || [], [sidebar])

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-ink-900 dark:text-white">{t('feed.title')}</h2>
        <p className="text-sm text-fiba-muted mt-1">{t('feed.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start">
        <div className="space-y-4 min-w-0">
          <Composer me={me} events={events} onPosted={onPosted} />

          {/* Filtros */}
          <div className="flex flex-wrap items-center gap-1.5">
            <FilterChip active={!category && !pinnedOnly} onClick={() => { setCategory(''); setPinnedOnly(false) }}>{t('feed.all')}</FilterChip>
            {CATEGORIES.map(c => (
              <FilterChip key={c.key} active={category === c.key && !pinnedOnly} onClick={() => { setCategory(c.key); setPinnedOnly(false) }}>
                {c.emoji} {t(`feed.${c.key}`)}
              </FilterChip>
            ))}
            <FilterChip active={pinnedOnly} onClick={() => { setPinnedOnly(v => !v); setCategory('') }}>📌 {t('feed.pinnedOnly')}</FilterChip>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-basketball-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <Empty icon={<Icon.Alert />} title={t('feed.errorLoading')} action={<Button variant="secondary" size="sm" onClick={load}>{t('feed.retry')}</Button>} />
          ) : posts.length === 0 ? (
            (category || pinnedOnly)
              ? <Empty icon={<Icon.Feed />} title={t('feed.emptyFiltered')} body={t('feed.emptyFilteredBody')} />
              : <Empty icon={<Icon.Message />} title={t('feed.empty')} body={t('feed.emptyBody')} />
          ) : (
            <>
              {posts.map(p => (
                <PostCard key={p.id} post={p} isModerator={isModerator} onUpdate={onUpdate} onDelete={onDelete} />
              ))}
              {hasMore && (
                <div className="flex justify-center pt-2">
                  <Button variant="secondary" size="sm" onClick={loadMore} disabled={loadingMore}>
                    {loadingMore ? t('common.loading') : t('feed.loadMore')}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <aside className="lg:sticky lg:top-0">
          <Sidebar data={sidebar} isModerator={isModerator} />
        </aside>
      </div>
    </div>
  )
}

function FilterChip({ active, children, ...rest }) {
  return (
    <button type="button" {...rest}
      className={`px-3 h-8 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-basketball-600 text-white border-basketball-600'
          : 'bg-white dark:bg-navy-900 text-ink-600 dark:text-ink-300 border-ink-200 dark:border-navy-700 hover:bg-ink-50 dark:hover:bg-navy-800'
      }`}>
      {children}
    </button>
  )
}
