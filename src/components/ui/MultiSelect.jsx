import React, { useState, useRef, useEffect } from 'react';
import { Icon } from '../../lib/icons';
import { Input } from './Input';

export function MultiSelect({ label, options, value=[], onChange, icon }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const toggle = (v) => onChange(value.includes(v) ? value.filter(x=>x!==v) : [...value, v]);
  const summary = value.length === 0 ? label
    : value.length === 1 ? `${label}: ${options.find(o=>o.value===value[0])?.label}`
    : `${label} · ${value.length}`;
  return (
    <div className="relative" ref={ref}>
      <button onClick={()=>setOpen(o=>!o)}
        className={`inline-flex items-center gap-1.5 h-8 px-2.5 text-[13px] rounded-md border transition-colors ${value.length ? 'border-navy-500 bg-navy-50 text-navy-800 dark:bg-navy-800 dark:text-navy-100 dark:border-navy-600':'border-dashed border-ink-300 bg-white text-ink-700 hover:border-ink-400 dark:bg-navy-900 dark:border-navy-700 dark:text-ink-200'}`}>
        {icon ? React.cloneElement(icon,{className:'w-3.5 h-3.5'}) : <Icon.Plus className="w-3.5 h-3.5"/>}
        <span className="font-medium">{summary}</span>
        {value.length > 0 && (
          <span className="ml-1 inline-flex items-center justify-center text-[10px] font-semibold rounded bg-navy-700 text-white px-1.5 py-0.5">{value.length}</span>
        )}
      </button>
      {open && (
        <div className="absolute z-30 mt-1.5 w-64 bg-white dark:bg-navy-800 rounded-lg shadow-pop border border-ink-200 dark:border-navy-700 overflow-hidden">
          <div className="p-2 border-b border-ink-100 dark:border-navy-700">
            <Input icon={<Icon.Search/>} placeholder={`Filtrar ${label.toLowerCase()}...`} />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {options.map(o => (
              <button key={o.value} onClick={()=>toggle(o.value)}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] hover:bg-ink-50 dark:hover:bg-navy-700 text-left">
                <span className={`w-4 h-4 rounded border flex items-center justify-center ${value.includes(o.value)?'bg-navy-700 border-navy-700':'border-ink-300 dark:border-navy-600'}`}>
                  {value.includes(o.value) && <Icon.Check className="w-3 h-3 text-white"/>}
                </span>
                {o.swatch && <span className="text-base leading-none">{o.swatch}</span>}
                <span className="flex-1 text-ink-700 dark:text-ink-100">{o.label}</span>
                {o.count != null && <span className="text-xs text-ink-400">{o.count}</span>}
              </button>
            ))}
          </div>
          {value.length>0 && (
            <div className="border-t border-ink-100 dark:border-navy-700 p-1.5">
              <button onClick={()=>onChange([])} className="w-full text-xs py-1.5 text-ink-600 hover:bg-ink-50 dark:text-ink-300 dark:hover:bg-navy-700 rounded">Limpiar selección</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
