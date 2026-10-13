// Piezas compartidas por las pestañas de Pagos.

export const STATUS_BADGES = {
  new:        'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-500',
  in_process: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  split:      'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400',
  completed:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400',
}
export const STATUSES = ['new', 'in_process', 'split', 'completed']

export function fmt(n) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
