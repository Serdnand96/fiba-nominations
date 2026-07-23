// Per-page "last search" persistence: each page stores its latest filters
// under its own localStorage key and restores them on entry. Pages validate
// the restored shape/values themselves — these helpers only handle storage.

export function readLastSearch(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null')
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function writeLastSearch(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}
