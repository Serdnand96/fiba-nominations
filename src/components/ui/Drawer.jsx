import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';

const sizes = { md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl' };

/**
 * Panel lateral derecho — el detalle/editor de Budget y de Pagos (mismo patrón
 * que el detalle de viajes en Empleados).
 *
 * Se monta con un portal en <body> por la misma razón que `Modal`: un
 * `position: fixed` dentro de un ancestro con `transform` mide el ancestro,
 * no la pantalla.
 */
export function Drawer({ title, subtitle, onClose, children, footer, size = 'lg', closeLabel = 'Cerrar' }) {
  return createPortal(
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div role="dialog" aria-modal="true"
        className={`fixed top-0 right-0 h-full w-full ${sizes[size] || sizes.lg} bg-fiba-card border-l border-fiba-border z-50 flex flex-col animate-slide-in`}>
        <div className="flex items-start justify-between p-6 border-b border-fiba-border">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-ink-900 dark:text-white truncate">{title}</h3>
            {subtitle && <p className="text-xs text-fiba-muted mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label={closeLabel}
            className="p-1.5 rounded hover:bg-fiba-surface text-fiba-muted hover:text-ink-900 dark:hover:text-white">×</button>
        </div>
        <div className="flex-1 overflow-auto p-6 space-y-4">{children}</div>
        {footer && <div className="p-6 border-t border-fiba-border flex gap-3 justify-end">{footer}</div>}
      </div>
    </>,
    document.body
  );
}

/**
 * Id del registro abierto en un drawer, leído de `?open=<id>`.
 *
 * Es lo que permite que un link (una notificación, por ejemplo) caiga directo
 * en el detalle. Devuelve `[id | null, setId]`; `setId(null)` lo saca de la
 * URL. Reemplaza la entrada del historial: abrir y cerrar un panel no es
 * navegar.
 */
export function useOpenParam(param = 'open') {
  const [searchParams, setSearchParams] = useSearchParams();
  const value = searchParams.get(param);

  const setValue = useCallback((id) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (id == null || id === '') next.delete(param);
      else next.set(param, String(id));
      return next;
    }, { replace: true });
  }, [setSearchParams, param]);

  return [value, setValue];
}
