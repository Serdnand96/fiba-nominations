import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import translations from './translations'

const LanguageContext = createContext()

function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj)
}

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('fiba-lang') || 'es')

  // Mantener <html lang> en sincronía con el idioma elegido. Era estático
  // ("es" en index.html), así que un visitante en inglés —sobre todo en las
  // vistas públicas sin login— hacía que los lectores de pantalla pronunciaran
  // el contenido como si fuera español.
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLanguage = useCallback((l) => {
    localStorage.setItem('fiba-lang', l)
    setLang(l)
  }, [])

  // t('calendar.title') => string
  // t('calendar.confirmDelete', { name: 'X' }) => string with interpolation
  const t = useCallback((key, params) => {
    const entry = getNestedValue(translations, key)
    if (!entry) return key
    // Direct language value
    let val = typeof entry === 'object' && entry[lang] !== undefined ? entry[lang] : entry
    // Array (months, days) — return whole array
    if (Array.isArray(val)) return val
    // String interpolation
    if (typeof val === 'string' && params) {
      Object.entries(params).forEach(([k, v]) => {
        val = val.replace(new RegExp(`\\{${k}\\}`, 'g'), v)
      })
    }
    return val
  }, [lang])

  return (
    <LanguageContext.Provider value={{ lang, setLang: setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider')
  return ctx
}
