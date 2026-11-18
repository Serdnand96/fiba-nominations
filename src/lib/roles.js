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
  { value: 'VGO',            label: 'VGO',                i18nKey: null,                   badge: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400' },
  { value: 'TD',             label: 'TD',                 i18nKey: null,                   badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400' },
  { value: 'REF',            label: 'Referee',            i18nKey: 'roles.REF',            badge: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400' },
  { value: 'REF_INSTRUCTOR', label: 'Referee Instructor', i18nKey: 'roles.REF_INSTRUCTOR', badge: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-400' },
  { value: 'VIDEO_OPERATOR', label: 'Video Operator',     i18nKey: 'roles.VIDEO_OPERATOR', badge: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-400' },
]

const _BY_VALUE = Object.fromEntries(ROLES.map(r => [r.value, r]))

// Con `t` (de useLanguage) el rol sale en el idioma activo. TD y VGO se
// muestran siempre como sigla.
export function roleLabel(role, t) {
  const entry = _BY_VALUE[role]
  if (!entry) return role || '-'
  return entry.i18nKey && t ? t(entry.i18nKey) : entry.label
}

export function roleBadgeClass(role) {
  return _BY_VALUE[role]?.badge || 'bg-ink-100 text-ink-700 dark:bg-ink-500/20 dark:text-ink-400'
}
