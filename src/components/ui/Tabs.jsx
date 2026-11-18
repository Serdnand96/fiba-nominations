import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Barra de pestañas subrayada — la de Budget, promovida al design system.
 *
 *   <Tabs value={tab} onChange={setTab}
 *     items={[{ key: 'plan', label: t('budget.tabPlan') }, …]} />
 *
 * Solo dibuja: quién guarda la pestaña activa lo decide el caller. Para que
 * viva en la URL (`?tab=…`, lo que necesitan los links de las notificaciones)
 * usá `useTabParam`.
 */
export function Tabs({ items, value, onChange, className = 'mb-6' }) {
  return (
    <div role="tablist" className={`flex gap-1 border-b border-fiba-border overflow-x-auto ${className}`}>
      {items.map(({ key, label }) => {
        const active = value === key;
        return (
          <button key={key} type="button" role="tab" aria-selected={active}
            onClick={() => onChange(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              active
                ? 'border-orange-500 text-ink-900 dark:text-white'
                : 'border-transparent text-fiba-muted hover:text-ink-900 dark:hover:text-white'
            }`}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Pestaña activa leída de `?tab=` (o del parámetro que se pida).
 *
 * Un valor desconocido cae en `fallback`: un link viejo o mal tipeado abre la
 * pestaña por defecto en vez de una página en blanco. Cambiar de pestaña
 * descarta `?open=`, porque el id abierto pertenece a la pestaña anterior, y
 * reemplaza la entrada del historial en vez de apilar una por clic.
 */
export function useTabParam(keys, fallback = keys[0], param = 'tab') {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get(param);
  const value = keys.includes(raw) ? raw : fallback;

  const setValue = useCallback((key) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set(param, key);
      next.delete('open');
      return next;
    }, { replace: true });
  }, [setSearchParams, param]);

  return [value, setValue];
}
