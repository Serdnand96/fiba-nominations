import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from '../../lib/icons';

const ToastCtx = createContext({ push: () => {} });

const AUTO_DISMISS_MS = 5000;

const TONES = {
  success: { bar: 'bg-success-500', icon: <Icon.Check className="text-success-600 w-5 h-5" /> },
  error:   { bar: 'bg-danger-500',  icon: <Icon.Alert className="text-danger-600 w-5 h-5" /> },
  info:    { bar: 'bg-info-500',    icon: <Icon.Info className="text-info-600 w-5 h-5" /> },
};

// Un toast por sí mismo: se autodescarta, pero pausa el timer mientras el mouse
// o el foco están encima (WCAG 2.2.1 — el usuario tiene que poder alcanzarlo) y
// trae un botón de cierre manual.
function ToastItem({ toast, onDismiss }) {
  const timer = useRef(null);
  const start = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
  }, [toast.id, onDismiss]);
  const pause = useCallback(() => clearTimeout(timer.current), []);

  useEffect(() => {
    start();
    return () => clearTimeout(timer.current);
  }, [start]);

  const cfg = TONES[toast.type] || TONES.info;
  return (
    <div
      className="flex gap-3 p-3.5 pr-2 rounded-lg border border-ink-200 dark:border-navy-700 bg-white dark:bg-navy-900 shadow-pop screen-enter relative overflow-hidden"
      onMouseEnter={pause}
      onMouseLeave={start}
      onFocus={pause}
      onBlur={start}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${cfg.bar}`} />
      <div className="flex-shrink-0 pl-1">{cfg.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-ink-900 dark:text-ink-50">{toast.title}</div>
        {toast.body && <div className="text-xs text-ink-600 dark:text-ink-300 mt-0.5">{toast.body}</div>}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={toast.closeLabel || 'Cerrar'}
        className="flex-shrink-0 self-start p-1.5 rounded-md text-ink-400 hover:text-ink-700 dark:hover:text-ink-100 hover:bg-ink-100 dark:hover:bg-navy-800"
      >
        <Icon.X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const dismiss = useCallback((id) => setToasts(prev => prev.filter(x => x.id !== id)), []);
  const push = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, ...t }]);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      {/* aria-live: los lectores de pantalla anuncian cada toast al aparecer
          (WCAG 4.1.3). role="status" ya implica aria-live="polite". */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 w-[340px]"
      >
        {toasts.map(t => <ToastItem key={t.id} toast={t} onDismiss={dismiss} />)}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
