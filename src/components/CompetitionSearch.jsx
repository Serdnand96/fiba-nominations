import { useState, useEffect, useRef } from 'react'
import { Icon } from '../lib/icons.jsx'

const PINNED_STORAGE_KEY = 'fiba_pinned_competitions'

function loadPinned() {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : []
  } catch {
    return []
  }
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
  const [pinnedIds, setPinnedIds] = useState(() => loadPinned())
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

  function togglePin(compId, e) {
    e?.stopPropagation()
    setPinnedIds(prev => {
      const next = prev.includes(compId) ? prev.filter(id => id !== compId) : [...prev, compId]
      try { localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  const filtered = competitions.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return (c.name || '').toLowerCase().includes(q)
      || (c.short_name || '').toLowerCase().includes(q)
      || String(c.year || '').includes(q)
  })

  // Pinned competitions sort to the top, preserving original order within each group.
  const sorted = [...filtered].sort((a, b) => {
    const ap = pinnedSet.has(a.id) ? 0 : 1
    const bp = pinnedSet.has(b.id) ? 0 : 1
    return ap - bp
  })
  const firstUnpinnedIdx = sorted.findIndex(c => !pinnedSet.has(c.id))
  const hasPinnedAndUnpinned = !search && firstUnpinnedIdx > 0 && firstUnpinnedIdx < sorted.length

  function handleSelect(comp) {
    onChange(comp.id)
    setOpen(false)
    setSearch('')
  }

  function formatDateRange(comp) {
    if (!comp.start_date) return ''
    const start = new Date(comp.start_date + 'T00:00:00')
    const opts = { month: 'short', day: 'numeric' }
    let s = start.toLocaleDateString(undefined, opts)
    if (comp.end_date) {
      const end = new Date(comp.end_date + 'T00:00:00')
      s += ' - ' + end.toLocaleDateString(undefined, opts)
    }
    return s
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
          {selected ? selected.name : placeholder}
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
              <div className="px-4 py-3 text-sm text-fiba-muted text-center">No results</div>
            ) : (
              sorted.map((c, idx) => {
                const isPinned = pinnedSet.has(c.id)
                const isSelected = c.id === value
                return (
                  <div key={c.id}>
                    {hasPinnedAndUnpinned && idx === firstUnpinnedIdx && (
                      <div className="px-4 py-1 text-[10px] uppercase tracking-wider text-fiba-muted border-t border-fiba-border bg-fiba-surface/50">
                        All competitions
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
                          {(c.start_date || c.year) && (
                            <div className="text-xs text-fiba-muted mt-0.5">
                              {formatDateRange(c) || c.year}
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
                        title={isPinned ? 'Unpin' : 'Pin to top'}
                        aria-label={isPinned ? 'Unpin competition' : 'Pin competition to top'}
                        className={`flex-shrink-0 mr-2 p-1.5 rounded hover:bg-fiba-surface-2 transition-opacity ${
                          isPinned
                            ? 'text-fiba-accent opacity-100'
                            : 'text-fiba-muted opacity-0 group-hover:opacity-100 focus:opacity-100'
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
