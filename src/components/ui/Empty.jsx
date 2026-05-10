import React from 'react';
import { Icon } from '../../lib/icons';

export function Empty({ icon, title, body, action }) {
  return (
    <div className="text-center py-14 px-6">
      <div className="w-14 h-14 mx-auto rounded-xl bg-ink-100 dark:bg-navy-800 text-ink-500 dark:text-ink-400 flex items-center justify-center">
        {React.cloneElement(icon || <Icon.Info/>, { className:'w-7 h-7'})}
      </div>
      <div className="mt-4 text-[15px] font-semibold text-ink-900 dark:text-white">{title}</div>
      <p className="text-sm text-ink-500 dark:text-ink-400 mt-1 max-w-sm mx-auto">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Kbd({ children }) {
  return <kbd className="font-mono text-[10px] font-semibold text-ink-500 bg-white dark:bg-navy-800 border border-ink-200 dark:border-navy-700 rounded px-1.5 py-0.5">{children}</kbd>;
}
