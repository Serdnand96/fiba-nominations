import { useState, useEffect, useRef, useSyncExternalStore } from 'react'
import { Icon } from '../lib/icons.jsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useLanguage } from '../i18n/LanguageContext'
import { competitionLabel, competitionDateRange, competitionPeriod } from '../lib/competitions'

// localStorage is the offline cache; user_pinned_competitions in Supabase is the source of truth.
// On mount we render the cache instantly, then reconcile against the server.
const PINNED_CACHE_KEY = 'fiba_pinned_competitions'
// Set once the localStorage-only pins have been pushed to Supabase. After that
// the server is authoritative, so unpinning sticks and stale ids get pruned.
const PINNED_MIGRATED_KEY = 'fiba_pinned_competitions_migrated'

function loadCache() {
  try {
    const raw = localStorage.getItem(PINNED_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeCache(ids) {
  try { localStorage.setItem(PINNED_CACHE_KEY, JSON.stringify(ids)) } catch {}
}

// ── Shared pin store ────────────────────────────────────────────────────────
// Several CompetitionSearch instances can be mounted at once (Reports renders
// two). Keeping the list in a module-level store instead of per-component state
// means a pin made in one dropdown shows up in the others, and no instance can
// clobber another's writes with a stale snapshot.
let pinnedIdsStore = loadCache()
const pinListeners = new Set()

function getPinnedIds() {
  return pinnedIdsStore
}

function setPinnedIds(next) {
  pinnedIdsStore = next
  writeCache(next)
  pinListeners.forEach(fn => fn())
}

function subscribePins(fn) {
  pinListeners.add(fn)
  return () => pinListeners.delete(fn)
}

function usePinnedIds() {
  return useSyncExternalStore(subscribePins, getPinnedIds)
}

// Pull the authoritative list from Supabase. Pins are ordered by pinned_at so
// the pinned block keeps a stable, predictable order.
async function syncPinsFromServer(userId) {
  const { data: rows, error } = await supabase
    .from('user_pinned_competitions')
    .select('competition_id, pinned_at')
    .eq('user_id', userId)
    .order('pinned_at', { ascending: true })
  if (error) return

  const remoteIds = (rows || []).map(r => r.competition_id)

  // One-time migration of pins made before the Supabase-backed version (or
  // while the session was still loading), then the server wins from here on.
  let migrated = false
  try { migrated = localStorage.getItem(PINNED_MIGRATED_KEY) === '1' } catch {}
  if (!migrated) {
    const localOnly = loadCache().filter(id => !remoteIds.includes(id))
    if (localOnly.length > 0) {
      const { error: insertError } = await supabase
        .from('user_pinned_competitions')
        .upsert(
          localOnly.map(competition_id => ({ user_id: userId, competition_id })),
          { onConflict: 'user_id,competition_id', ignoreDuplicates: true },
        )
      if (!insertError) remoteIds.push(...localOnly)
    }
    try { localStorage.setItem(PINNED_MIGRATED_KEY, '1') } catch {}
  }

  setPinnedIds(remoteIds)
}

/**
 * Searchable competition selector — replaces plain <select> dropdowns.
 *
 * Props:
 *   competitions: array of { id, name, short_name?, start_date?, end_date?, ... }
 *   value: selected competition id
 *   onChange: (compId) => void
 *   placeholder: string
 *   className: optional wrapper class
 */
export default function CompetitionSearch({ competitions, value, onChange, placeholder = 'Search competition...', className = '' }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  // Rendered from the shared store (seeded from cache), reconciled with Supabase below.
  const pinnedIds = usePinnedIds()
  const { user } = useAuth()
  const { t } = useLanguage()
  const MONTHS_SHORT = t('months.short')
  const userId = user?.id || null
  const wrapperRef = useRef(null)
  const inputRef = useRef(null)

  const selected = competitions.find(c => c.id === value)
  const pinnedSet = new Set(pinnedIds)

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Reconcile with Supabase once the session is available, and again whenever
  // the dropdown is opened so pins made elsewhere (other tab/device) show up.
  useEffect(() => {
    if (!userId || !open) return
    syncPinsFromServer(userId)
  }, [userId, open])

  async function togglePin(compId, e) {
    e?.stopPropagation()
    const wasPinned = getPinnedIds().includes(compId)
    // Optimistic: update UI + cache immediately.
    setPinnedIds(
      wasPinned
        ? getPinnedIds().filter(id => id !== compId)
        : [...getPinnedIds(), compId],
    )

    if (!userId) return // not authenticated yet — cache-only

    const { error } = wasPinned
      ? await supabase
          .from('user_pinned_competitions')
          .delete()
          .eq('user_id', userId)
          .eq('competition_id', compId)
      : await supabase
          .from('user_pinned_competitions')
          .upsert(
            { user_id: userId, competition_id: compId },
            { onConflict: 'user_id,competition_id', ignoreDuplicates: true },
          )

    if (error) {
      // Revert just this pin, so a concurrent toggle on another row survives.
      setPinnedIds(
        wasPinned
          ? [...getPinnedIds(), compId]
          : getPinnedIds().filter(id => id !== compId),
      )
    }
  }

  const filtered = competitions.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return (c.name || '').toLowerCase().includes(q)
      || (c.short_name || '').toLowerCase().includes(q)
      || String(c.year || '').includes(q)
  })

  // Pinned competitions sort to the top, in the order they were pinned;
  // the rest keep their original order.
  const pinOrder = new Map(pinnedIds.map((id, i) => [id, i]))
  const sorted = [...filtered].sort((a, b) => {
    const ap = pinOrder.has(a.id) ? 0 : 1
    const bp = pinOrder.has(b.id) ? 0 : 1
    if (ap !== bp) return ap - bp
    if (ap === 0) return pinOrder.get(a.id) - pinOrder.get(b.id)
    return 0
  })
  const pinnedCount = sorted.reduce((n, c) => n + (pinnedSet.has(c.id) ? 1 : 0), 0)
  // Section headers only make sense when both groups are non-empty and we're
  // not filtering (a search mixes matches from both).
  const showSections = !search && pinnedCount > 0 && pinnedCount < sorted.length

  function handleSelect(comp) {
    onChange(comp.id)
    setOpen(false)
    setSearch('')
  }

  // El renglón secundario de cada opción. Lleva el año SIEMPRE: antes decía
  // "Oct 2 - Oct 4" y el año sólo aparecía cuando no había fechas
  // (`formatDateRange(c) || c.year`), así que las dos "LSB – Group A" —la de
  // 2026 y la de 2027— se distinguían únicamente por el día del mes.
  function competitionSubtitle(comp) {
    return competitionDateRange(comp, MONTHS_SHORT, { year: true })
      || competitionPeriod(comp, MONTHS_SHORT)
  }

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {/* Display button */}
      <button
        type="button"
        onClick={() => { setOpen(!open); setTimeout(() => inputRef.current?.focus(), 50) }}
        className="w-full flex items-center justify-between px-3 py-2 border border-fiba-border rounded-lg text-sm bg-fiba-surface hover:bg-fiba-surface-2 text-left min-w-[260px]"
      >
        <span className={selected ? 'text-ink-900 dark:text-ink-100 font-medium truncate' : 'text-fiba-muted'}>
          {/* Ya elegida y con el desplegable cerrado, el nombre solo no dice de
              qué año es. Es el estado en el que queda la pantalla mientras se
              trabaja, así que es justo donde más importa. */}
          {selected ? competitionLabel(selected, MONTHS_SHORT) : placeholder}
        </span>
        <svg className={`w-4 h-4 text-fiba-muted transition-transform flex-shrink-0 ml-2 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-fiba-card border border-fiba-border rounded-lg shadow-lg z-50 max-h-72 flex flex-col">
          {/* Search input */}
          <div className="p-2 border-b border-fiba-border">
            <input
              ref={inputRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={placeholder}
              className="fiba-input"
              onKeyDown={e => {
                if (e.key === 'Escape') setOpen(false)
                if (e.key === 'Enter' && filtered.length === 1) handleSelect(filtered[0])
              }}
            />
          </div>

          {/* Options */}
          <div className="overflow-y-auto flex-1">
            {sorted.length === 0 ? (
              <div className="px-4 py-3 text-sm text-fiba-muted text-center">{t('competitionSearch.noResults')}</div>
            ) : (
              sorted.map((c, idx) => {
                const isPinned = pinnedSet.has(c.id)
                const isSelected = c.id === value
                return (
                  <div key={c.id}>
                    {showSections && idx === 0 && (
                      <div className="px-4 py-1 text-[10px] uppercase tracking-wider text-fiba-muted bg-fiba-surface/50">
                        {t('competitionSearch.pinnedSection')} ({pinnedCount})
                      </div>
                    )}
                    {showSections && idx === pinnedCount && (
                      <div className="px-4 py-1 text-[10px] uppercase tracking-wider text-fiba-muted border-t border-fiba-border bg-fiba-surface/50">
                        {t('competitionSearch.allSection')}
                      </div>
                    )}
                    <div
                      className={`group w-full flex items-center transition-colors ${
                        isSelected ? 'bg-fiba-accent/10' : 'hover:bg-fiba-surface'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSelect(c)}
                        className={`flex-1 text-left px-4 py-2.5 text-sm flex items-center justify-between min-w-0 ${
                          isSelected ? 'text-fiba-accent' : 'text-ink-700 dark:text-ink-300'
                        }`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{c.name}</div>
                          {competitionSubtitle(c) && (
                            <div className="text-xs text-fiba-muted mt-0.5">
                              {competitionSubtitle(c)}
                            </div>
                          )}
                        </div>
                        {isSelected && (
                          <svg className="w-4 h-4 text-fiba-accent flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => togglePin(c.id, e)}
                        title={isPinned ? t('competitionSearch.unpin') : t('competitionSearch.pin')}
                        aria-label={isPinned ? t('competitionSearch.unpin') : t('competitionSearch.pin')}
                        aria-pressed={isPinned}
                        className={`flex-shrink-0 mr-2 p-1.5 rounded hover:bg-fiba-surface-2 transition-opacity ${
                          isPinned
                            ? 'text-fiba-accent opacity-100'
                            : 'text-fiba-muted opacity-40 hover:opacity-100 group-hover:opacity-100 focus:opacity-100'
                        }`}
                      >
                        {isPinned
                          ? <Icon.PushpinFilled className="w-4 h-4" />
                          : <Icon.Pushpin className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
