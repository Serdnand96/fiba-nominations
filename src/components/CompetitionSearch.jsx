import { useState, useEffect, useRef } from 'react'

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
  const wrapperRef = useRef(null)
  const inputRef = useRef(null)

  const selected = competitions.find(c => c.id === value)

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

  const filtered = competitions.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return (c.name || '').toLowerCase().includes(q)
      || (c.short_name || '').toLowerCase().includes(q)
      || String(c.year || '').includes(q)
  })

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
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-fiba-muted text-center">No results</div>
            ) : (
              filtered.map(c => (
                <button
                  key={c.id}
                  onClick={() => handleSelect(c)}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-fiba-surface flex items-center justify-between transition-colors ${
                    c.id === value ? 'bg-fiba-accent/10 text-fiba-accent' : 'text-ink-700 dark:text-ink-300'
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
                  {c.id === value && (
                    <svg className="w-4 h-4 text-fiba-accent flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
