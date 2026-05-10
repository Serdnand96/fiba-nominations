import React from 'react';
import { Icon } from '../../lib/icons';
import { IconButton } from './Button';

const sizes = { sm:'max-w-md', md:'max-w-lg', lg:'max-w-2xl', xl:'max-w-3xl' };

export function Modal({ open, onClose, title, subtitle, children, footer, size='md' }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy-950/40 backdrop-blur-sm" onClick={onClose}/>
      <div className={`relative w-full ${sizes[size]} bg-white dark:bg-navy-900 rounded-xl shadow-pop border border-ink-200 dark:border-navy-800 overflow-hidden`}>
        <div className="flex items-start justify-between px-6 pt-5 pb-3">
          <div>
            <h3 className="text-base font-semibold text-navy-900 dark:text-white">{title}</h3>
            {subtitle && <p className="text-[13px] text-ink-500 mt-0.5 dark:text-ink-400">{subtitle}</p>}
          </div>
          <IconButton icon={<Icon.X/>} label="Cerrar" onClick={onClose}/>
        </div>
        <div className="px-6 py-4 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <div className="px-6 py-4 bg-ink-50/60 dark:bg-navy-950/40 border-t border-ink-200 dark:border-navy-800 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
