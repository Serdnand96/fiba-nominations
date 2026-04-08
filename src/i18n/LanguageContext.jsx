import { createContext, useContext, useState, useCallback } from 'react'
import translations from './translations'

const LanguageContext = createContext()

function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj)
}

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('fiba-lang') || 'es')

  const toggleLang = useCallback(() => {
    setLang(prev => {
      const next = prev === 'es' ? 'en' : 'es'
      localStorage.setItem('fiba-lang', next)
      return next
    })
  }, [])

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
    <LanguageContext.Provider value={{ lang, setLang: setLanguage, toggleLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider')
  return ctx
}
