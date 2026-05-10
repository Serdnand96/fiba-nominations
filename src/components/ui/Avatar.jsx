import React from 'react';

const sizes = { xs:'w-6 h-6 text-[10px]', sm:'w-7 h-7 text-[11px]', md:'w-8 h-8 text-xs', lg:'w-10 h-10 text-sm' };
const tones = {
  navy:'bg-navy-100 text-navy-800 dark:bg-navy-700 dark:text-navy-100',
  basketball:'bg-basketball-100 text-basketball-700',
  ink:'bg-ink-200 text-ink-700 dark:bg-navy-800 dark:text-ink-200',
};

export function Avatar({ name, size='md', tone='navy' }) {
  const initials = (name||'').split(' ').filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase();
  return <span className={`inline-flex items-center justify-center rounded-full font-semibold ${sizes[size]} ${tones[tone]}`}>{initials || '—'}</span>;
}

export function NameCell({ name, country, flag, sub }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <Avatar name={name}/>
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink-900 dark:text-ink-50 truncate">{name}</div>
        <div className="text-xs text-ink-500 dark:text-ink-400 truncate flex items-center gap-1">
          {flag && <span className="text-[13px] leading-none">{flag}</span>}
          <span>{sub || country}</span>
        </div>
      </div>
    </div>
  );
}
