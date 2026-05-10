import React from 'react';

export function Card({ children, className='', padding='p-5' }) {
  return (
    <div className={`bg-white border border-ink-200 rounded-xl shadow-card dark:bg-navy-900 dark:border-navy-800 ${padding} ${className}`}>
      {children}
    </div>
  );
}

export function SectionHeader({ title, subtitle, action, eyebrow }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <div>
        {eyebrow && <div className="text-2xs font-medium uppercase tracking-wider text-basketball-600 mb-1">{eyebrow}</div>}
        <h2 className="text-[20px] font-semibold text-navy-900 dark:text-white tracking-tight">{title}</h2>
        {subtitle && <p className="text-sm text-ink-500 mt-0.5 dark:text-ink-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
