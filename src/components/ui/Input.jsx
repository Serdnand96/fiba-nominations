import React from 'react';
import { Icon } from '../../lib/icons';

export function Input({ icon, label, hint, error, className='', wrapperClass='', ...rest }) {
  return (
    <label className={`block ${wrapperClass}`}>
      {label && <div className="text-[13px] font-medium text-ink-700 mb-1.5 dark:text-ink-200">{label}</div>}
      <div className="relative">
        {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">{React.cloneElement(icon, { className:'w-4 h-4'})}</span>}
        <input
          className={`w-full h-9 ${icon?'pl-9':'pl-3'} pr-3 text-sm bg-white border border-ink-200 rounded-md placeholder:text-ink-400 text-ink-900 focus:outline-none focus:border-navy-500 focus:shadow-focus transition-shadow dark:bg-navy-800 dark:border-navy-700 dark:text-ink-50 ${error?'border-danger-500 shadow-[0_0_0_3px_rgba(240,68,56,0.15)]':''} ${className}`}
          {...rest}
        />
      </div>
      {hint && !error && <div className="text-xs text-ink-500 mt-1.5">{hint}</div>}
      {error && <div className="text-xs text-danger-600 mt-1.5 flex items-center gap-1"><Icon.Alert className="w-3.5 h-3.5"/> {error}</div>}
    </label>
  );
}

export function Select({ label, hint, options=[], value, onChange, className='', wrapperClass='' }) {
  return (
    <label className={`block ${wrapperClass}`}>
      {label && <div className="text-[13px] font-medium text-ink-700 mb-1.5 dark:text-ink-200">{label}</div>}
      <div className="relative">
        <select value={value} onChange={(e)=>onChange?.(e.target.value)}
          className={`w-full h-9 pl-3 pr-9 text-sm bg-white border border-ink-200 rounded-md text-ink-900 appearance-none focus:outline-none focus:border-navy-500 focus:shadow-focus transition-shadow dark:bg-navy-800 dark:border-navy-700 dark:text-ink-50 ${className}`}>
          {options.map(o => typeof o === 'string'
            ? <option key={o} value={o}>{o}</option>
            : <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <Icon.ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none"/>
      </div>
      {hint && <div className="text-xs text-ink-500 mt-1.5">{hint}</div>}
    </label>
  );
}
