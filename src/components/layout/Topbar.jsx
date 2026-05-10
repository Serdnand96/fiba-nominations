import React from 'react';
import { Icon } from '../../lib/icons';
import { IconButton } from '../ui/Button';

export function Topbar({ title, breadcrumb, actions, dark, onToggleDark }) {
  return (
    <header className="h-14 px-6 bg-white dark:bg-navy-900 border-b border-ink-200 dark:border-navy-800 flex items-center justify-between flex-shrink-0">
      <div className="min-w-0">
        {breadcrumb && (
          <div className="text-xs text-ink-500 dark:text-ink-400 flex items-center gap-1 mb-0.5">
            {breadcrumb.map((b,i) => (
              <React.Fragment key={i}>
                {i>0 && <Icon.Chevron className="w-3 h-3"/>}
                <span className={i===breadcrumb.length-1?'text-ink-700 dark:text-ink-200':''}>{b}</span>
              </React.Fragment>
            ))}
          </div>
        )}
        <h1 className="text-[17px] font-semibold text-navy-900 dark:text-white tracking-tight">{title}</h1>
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <div className="h-6 w-px bg-ink-200 dark:bg-navy-700 mx-1"/>
        <IconButton icon={dark ? <Icon.Sun/> : <Icon.Moon/>} label="Toggle theme" onClick={onToggleDark}/>
        <IconButton icon={<Icon.Bell/>} label="Notificaciones"/>
        <IconButton icon={<Icon.Cog/>} label="Ajustes"/>
      </div>
    </header>
  );
}
