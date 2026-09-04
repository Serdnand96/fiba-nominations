import React, { useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../lib/icons';
import { IconButton } from './Button';

const sizes = { sm:'max-w-md', md:'max-w-lg', lg:'max-w-2xl', xl:'max-w-3xl' };

const FOCUSABLE = 'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])';
const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

// Bloqueo del scroll de fondo con contador: si hubiera dos modales abiertos,
// solo el último en cerrarse restaura el overflow original del body.
let lockCount = 0;
let prevOverflow = '';
function lockScroll() {
  if (lockCount++ === 0) { prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
}
function unlockScroll() {
  if (--lockCount <= 0) { lockCount = 0; document.body.style.overflow = prevOverflow; }
}

// Se monta con un portal en <body>: un `position: fixed` toma como contenedor
// al ancestro más cercano con `transform`, y el sidebar (App.jsx) siempre lleva
// uno (`translate-x-*`). Sin portal, un modal abierto desde ahí medía 232px de
// ancho — el del sidebar — en vez de la pantalla.
export function Modal({ open, onClose, title, subtitle, children, footer, size='md', closeLabel='Cerrar', closeDisabled=false }) {
  const panelRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const closeDisabledRef = useRef(closeDisabled);
  closeDisabledRef.current = closeDisabled;
  // onClose en un ref: los callers pasan una arrow inline y, si fuera dep del
  // efecto, cada render del padre reiniciaría el foco y el lock de scroll.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    // Recordar quién tenía el foco para devolvérselo al cerrar.
    restoreFocusRef.current = document.activeElement;

    const panel = panelRef.current;
    // Foco inicial: el primer control visible del cuerpo (no la X), o el panel.
    const body = panel?.querySelector('[data-modal-body]');
    const first = body ? [...body.querySelectorAll(FOCUSABLE)].find(isVisible) : null;
    (first || panel)?.focus();

    lockScroll();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); if (!closeDisabledRef.current) onCloseRef.current?.(); return; }
      if (e.key !== 'Tab') return;
      // Trampa de foco: Tab no debe salir del modal.
      const items = panel ? [...panel.querySelectorAll(FOCUSABLE)].filter(isVisible) : [];
      if (!items.length) return;
      const firstItem = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); firstItem.focus(); }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      unlockScroll();
      // Devolver el foco al disparador al cerrar, si sigue visible (en móvil el
      // drawer que lo contenía puede haberse cerrado); si no, al contenido.
      const el = restoreFocusRef.current;
      if (el && typeof el.focus === 'function' && isVisible(el)) el.focus();
      else document.querySelector('main')?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const requestClose = () => { if (!closeDisabled) onClose?.(); };
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy-950/40 backdrop-blur-sm" onClick={requestClose}/>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-busy={closeDisabled || undefined}
        tabIndex={-1}
        className={`relative w-full ${sizes[size]} max-h-[90dvh] flex flex-col bg-white dark:bg-navy-900 rounded-xl shadow-pop border border-ink-200 dark:border-navy-800 overflow-hidden`}
      >
        <div className="flex items-start justify-between gap-3 px-4 sm:px-6 pt-5 pb-3">
          <div className="min-w-0">
            <h3 id={titleId} className="text-base font-semibold text-navy-900 dark:text-white">{title}</h3>
            {subtitle && <p className="text-[13px] text-ink-500 mt-0.5 dark:text-ink-400">{subtitle}</p>}
          </div>
          <IconButton icon={<Icon.X/>} label={closeLabel} onClick={requestClose} disabled={closeDisabled} className="flex-shrink-0"/>
        </div>
        <div data-modal-body className="flex-1 min-h-0 px-4 sm:px-6 py-4 overflow-y-auto overflow-x-hidden">{children}</div>
        {footer && <div className="px-4 sm:px-6 py-4 bg-ink-50/60 dark:bg-navy-950/40 border-t border-ink-200 dark:border-navy-800 flex flex-wrap items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
