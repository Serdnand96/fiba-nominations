import React, { useEffect, useState } from 'react';

const sizes = { xs:'w-6 h-6 text-[10px]', sm:'w-7 h-7 text-[11px]', md:'w-8 h-8 text-xs', lg:'w-10 h-10 text-sm', xl:'w-24 h-24 text-2xl' };
const tones = {
  navy:'bg-navy-100 text-navy-800 dark:bg-navy-700 dark:text-navy-100',
  basketball:'bg-basketball-100 text-basketball-800',
  ink:'bg-ink-200 text-ink-700 dark:bg-navy-800 dark:text-ink-200',
};

// Con `src` muestra la foto (avatar de usuario, foto de personnel); sin `src`,
// o si la imagen no carga, cae a las iniciales de `name`. La imagen es
// decorativa por defecto (`alt=""`): siempre hay un nombre al lado; pasá `alt`
// solo cuando el avatar va solo.
export function Avatar({ name, src, alt='', size='md', tone='navy', className='' }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => { setBroken(false); }, [src]);
  const initials = (name||'').split(' ').filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase();
  const base = `inline-flex items-center justify-center rounded-full font-semibold flex-shrink-0 overflow-hidden ${sizes[size]} ${className}`;
  if (src && !broken) {
    // Lazy solo en los chicos (listas largas); un avatar grande siempre está a la vista.
    const lazy = size === 'xs' || size === 'sm' || size === 'md';
    return (
      <span className={`${base} bg-ink-100 dark:bg-navy-800`}>
        <img src={src} alt={alt} className="w-full h-full object-cover" loading={lazy ? 'lazy' : undefined} onError={() => setBroken(true)} />
      </span>
    );
  }
  return <span className={`${base} ${tones[tone]}`} aria-hidden={alt ? undefined : true}>{initials || '—'}</span>;
}

export function NameCell({ name, country, flag, sub, src }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <Avatar name={name} src={src}/>
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
