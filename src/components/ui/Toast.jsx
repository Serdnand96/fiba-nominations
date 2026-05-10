import React, { createContext, useContext, useState } from 'react';
import { Icon } from '../../lib/icons';

const ToastCtx = createContext({ push: () => {} });

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = (t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, ...t }]);
    setTimeout(() => setToasts(prev => prev.filter(x => x.id !== id)), 4200);
  };
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 w-[340px]">
        {toasts.map(t => {
          const tones = {
            success:{ bar:'bg-success-500', icon:<Icon.Check className="text-success-600 w-5 h-5"/> },
            error:  { bar:'bg-danger-500',  icon:<Icon.Alert className="text-danger-600 w-5 h-5"/> },
            info:   { bar:'bg-info-500',    icon:<Icon.Info className="text-info-600 w-5 h-5"/> },
          };
          const cfg = tones[t.type] || tones.info;
          return (
            <div key={t.id} className="flex gap-3 p-3.5 pr-3 rounded-lg border border-ink-200 dark:border-navy-700 bg-white dark:bg-navy-900 shadow-pop screen-enter relative overflow-hidden">
              <div className={`absolute left-0 top-0 bottom-0 w-1 ${cfg.bar}`}/>
              <div className="flex-shrink-0 pl-1">{cfg.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-ink-900 dark:text-ink-50">{t.title}</div>
                {t.body && <div className="text-xs text-ink-600 dark:text-ink-300 mt-0.5">{t.body}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
