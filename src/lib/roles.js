// Personnel roles — single source of truth for labels + badge styling.
//
// Kept in sync with the CHECK constraint in
// supabase/migrations/016_referee_nationalities_and_crew_roles.sql and the
// _VALID_ROLES tuple in api/_lib/routers/personnel.py.

export const ROLES = [
  { value: 'VGO',            label: 'VGO',                badge: 'bg-purple-500/20 text-purple-400' },
  { value: 'TD',             label: 'TD',                 badge: 'bg-emerald-500/20 text-emerald-400' },
  { value: 'REF',            label: 'Referee',            badge: 'bg-orange-500/20 text-orange-400' },
  { value: 'REF_INSTRUCTOR', label: 'Referee Instructor', badge: 'bg-sky-500/20 text-sky-400' },
  { value: 'VIDEO_OPERATOR', label: 'Video Operator',     badge: 'bg-rose-500/20 text-rose-400' },
]

const _BY_VALUE = Object.fromEntries(ROLES.map(r => [r.value, r]))

export function roleLabel(role) {
  return _BY_VALUE[role]?.label || role || '—'
}

export function roleBadgeClass(role) {
  return _BY_VALUE[role]?.badge || 'bg-ink-500/20 text-ink-400'
}
