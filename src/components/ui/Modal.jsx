import React, { useEffect, useRef, useId } from 'react';
import { Icon } from '../../lib/icons';
import { IconButton } from './Button';

const sizes = { sm:'max-w-md', md:'max-w-lg', lg:'max-w-2xl', xl:'max-w-3xl' };

const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';

export function Modal({ open, onClose, title, subtitle, children, footer, size='md', closeLabel='Cerrar' }) {
  const panelRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    // Recordar quién tenía el foco para devolvérselo al cerrar.
    restoreFocusRef.current = document.activeElement;

    const panel = panelRef.current;
    // Foco inicial: el primer control del modal, o el panel mismo.
    const focusables = panel?.querySelectorAll(FOCUSABLE);
    (focusables && focusables.length ? focusables[0] : panel)?.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); return; }
      if (e.key !== 'Tab') return;
      // Trampa de foco: Tab no debe salir del modal.
      const items = panel?.querySelectorAll(FOCUSABLE);
      if (!items || !items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Devolver el foco al disparador al cerrar.
      const el = restoreFocusRef.current;
      if (el && typeof el.focus === 'function') el.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy-950/40 backdrop-blur-sm" onClick={onClose}/>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`relative w-full ${sizes[size]} bg-white dark:bg-navy-900 rounded-xl shadow-pop border border-ink-200 dark:border-navy-800 overflow-hidden`}
      >
        <div className="flex items-start justify-between px-6 pt-5 pb-3">
          <div>
            <h3 id={titleId} className="text-base font-semibold text-navy-900 dark:text-white">{title}</h3>
            {subtitle && <p className="text-[13px] text-ink-500 mt-0.5 dark:text-ink-400">{subtitle}</p>}
          </div>
          <IconButton icon={<Icon.X/>} label={closeLabel} onClick={onClose}/>
        </div>
        <div className="px-6 py-4 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <div className="px-6 py-4 bg-ink-50/60 dark:bg-navy-950/40 border-t border-ink-200 dark:border-navy-800 flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
