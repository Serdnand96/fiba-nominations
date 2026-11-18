import { useLanguage } from '../../i18n/LanguageContext'
import { LogoWordmark } from '../brand/Logo'

// Marco común de las páginas que se abren sin sesión: logística, checklist de
// sede, disponibilidad y activo por QR. App.jsx las muestra siempre en claro;
// las variantes dark: quedan por si se reutiliza dentro del shell autenticado.

const linkTones = {
  light: 'text-ink-500 hover:text-navy-900 dark:text-ink-400 dark:hover:text-white',
  onNavy: 'text-navy-200 hover:text-white',
}

// El idioma se cambia con un enlace de texto con el nombre del otro idioma.
export function LanguageLink({ tone = 'light', className = '' }) {
  const { lang, setLang } = useLanguage()
  const next = lang === 'es' ? 'en' : 'es'
  return (
    <button type="button" lang={next} onClick={() => setLang(next)}
      className={`text-xs underline-offset-2 hover:underline transition-colors print:hidden ${linkTones[tone]} ${className}`}>
      {next === 'en' ? 'English' : 'Español'}
    </button>
  )
}

export function PublicHeader({ title, context, width = 'max-w-5xl' }) {
  return (
    <header className="bg-white border-b border-ink-200 dark:bg-navy-900 dark:border-navy-800">
      <div className={`${width} mx-auto px-4 py-3 flex items-center gap-4`}>
        <LogoWordmark height={28} />
        {(title || context) && (
          <div className="min-w-0 flex-1 leading-tight pl-4 border-l border-ink-200 dark:border-navy-800">
            {title && <h1 className="text-base sm:text-lg font-semibold text-navy-900 dark:text-white">{title}</h1>}
            {context && <p className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">{context}</p>}
          </div>
        )}
        <LanguageLink className="ml-auto shrink-0 self-start mt-1" />
      </div>
    </header>
  )
}

export function PublicShell({ title, context, width = 'max-w-5xl', children }) {
  return (
    <div className="min-h-screen bg-ink-50 text-ink-900 dark:bg-navy-950 dark:text-white">
      <PublicHeader title={title} context={context} width={width} />
      {children}
    </div>
  )
}

// Enlace vencido, reemplazado o inexistente.
export function PublicUnavailable({ title, message }) {
  return (
    <div className="min-h-screen bg-ink-50 dark:bg-navy-950 flex flex-col">
      <div className="flex justify-end px-4 py-3">
        <LanguageLink />
      </div>
      <div className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="max-w-sm text-center">
          <div className="flex justify-center mb-5"><LogoWordmark height={32} /></div>
          <h1 className="text-lg font-semibold text-navy-900 dark:text-white mb-1">{title}</h1>
          {message && <p className="text-sm text-ink-600 dark:text-ink-400">{message}</p>}
        </div>
      </div>
    </div>
  )
}

export default PublicShell
