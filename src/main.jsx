import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { LanguageProvider } from './i18n/LanguageContext'
import { ToastProvider } from './components/ui/Toast'
import App from './App'
// IBM Plex self-hosteada (@fontsource). Antes se cargaba con un @import a
// Google Fonts en index.css que la CSP de nginx bloqueaba en prod → todo el
// sitio caía a la fuente de fallback. Self-hosted entra dentro de font-src
// 'self' y no toca la CSP. Pesos que usa el DS: sans 400/500/600/700, mono
// 400/500/600.
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <LanguageProvider>
        <AuthProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </AuthProvider>
      </LanguageProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
