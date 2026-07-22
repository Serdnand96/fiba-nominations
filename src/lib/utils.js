// Tiny shared helpers used by several pages.

// snake_case → camelCase (status keys → i18n keys, e.g. in_use → inUse)
export function camel(s) {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

// Date-ish string → localized date; falls back to the raw value.
export function fmtDate(d) {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString() } catch { return d }
}
