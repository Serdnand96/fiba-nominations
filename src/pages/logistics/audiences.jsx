// La división del módulo Logística: a quién le sirve cada cosa. El backend la
// resuelve por categoría del padrón (api/_lib/logistics_audiences.py):
//   staff → oficiales y staff FIBA · delegation → equipos · vip → VIPs e invitados.
// '' es "Todos": sin recorte, como funcionaba el módulo antes de dividirse.

export const AUDIENCE_KEYS = ['staff', 'delegation', 'vip']

export const AUDIENCE_LABELS = {
  es: { '': 'Todos', staff: 'Staff', delegation: 'Delegación', vip: 'VIP e invitados' },
  en: { '': 'All', staff: 'Staff', delegation: 'Delegation', vip: 'VIP & guests' },
}

export const audienceLabel = (audience, lang) => (
  AUDIENCE_LABELS[lang === 'es' ? 'es' : 'en'][audience || ''] || audience
)

// Categoría con la que nace una persona cargada a mano desde cada pestaña.
export const DEFAULT_CATEGORY = { '': 'official', staff: 'official', delegation: 'team', vip: 'vip' }

export default function AudienceSwitch({ value, onChange, lang, keys = ['', ...AUDIENCE_KEYS] }) {
  return (
    <div className="inline-flex rounded-lg border border-fiba-border overflow-hidden" role="group"
      aria-label={lang === 'es' ? 'Audiencia' : 'Audience'}>
      {keys.map(key => (
        <button key={key || 'all'} type="button" onClick={() => onChange(key)} aria-pressed={value === key}
          className={`px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
            value === key
              ? 'bg-fiba-accent text-white'
              : 'text-fiba-muted hover:text-ink-700 dark:hover:text-gray-200'
          }`}>
          {audienceLabel(key, lang)}
        </button>
      ))}
    </div>
  )
}
