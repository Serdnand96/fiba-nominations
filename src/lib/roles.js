// Personnel roles — single source of truth for labels + badge styling.
//
// Kept in sync with the CHECK constraint in
// supabase/migrations/016_referee_nationalities_and_crew_roles.sql and the
// _VALID_ROLES tuple in api/_lib/routers/personnel.py.

// El badge lleva variante dark: explícita. Antes era solo `bg-X-500/20
// text-X-400`, tuneado para el navy oscuro: sobre la card blanca (modo claro)
// esos text-*-400 daban ~1.5-2.5:1, muy por debajo de AA. En claro se usa el
// tono -700 sobre -100; en oscuro se conserva el look original.
export const ROLES = [
  { value: 'VGO',            label: 'VGO',                badge: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400' },
  { value: 'TD',             label: 'TD',                 badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' },
  { value: 'REF',            label: 'Referee',            badge: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400' },
  { value: 'REF_INSTRUCTOR', label: 'Referee Instructor', badge: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400' },
  { value: 'VIDEO_OPERATOR', label: 'Video Operator',     badge: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400' },
]

const _BY_VALUE = Object.fromEntries(ROLES.map(r => [r.value, r]))

export function roleLabel(role) {
  return _BY_VALUE[role]?.label || role || '—'
}

export function roleBadgeClass(role) {
  return _BY_VALUE[role]?.badge || 'bg-ink-100 text-ink-700 dark:bg-ink-500/20 dark:text-ink-400'
}
