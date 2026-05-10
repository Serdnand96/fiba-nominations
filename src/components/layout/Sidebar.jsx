import React from 'react';
import { Icon } from '../../lib/icons';
import { Kbd } from '../ui/Empty';

const items = [
  { id:'dashboard',   label:'Dashboard',         icon:<Icon.Dashboard/> },
  { id:'nominations', label:'Nominaciones',      icon:<Icon.Trophy/>, badge:'3' },
  { id:'officials',   label:'Colaboradores',     icon:<Icon.Users/> },
  { id:'availability',label:'TD Availability',   icon:<Icon.Calendar/> },
  { id:'training',    label:'Training Schedule', icon:<Icon.Whistle/> },
  { id:'transport',   label:'Transport',         icon:<Icon.Truck/> },
];
const admin = [
  { id:'permissions', label:'Permissions',       icon:<Icon.Shield/> },
];

export function Sidebar({ current, onNav, user = { name:'Ana Calderón', role:'Superadmin' } }) {
  const NavItem = (it) => (
    <button key={it.id} onClick={()=>onNav(it.id)}
      className={`w-full flex items-center gap-3 px-2.5 h-9 text-[13.5px] rounded-md transition-colors relative ${current===it.id
        ? 'bg-navy-800 text-white font-medium'
        : 'text-navy-200 hover:bg-navy-800/60 hover:text-white'}`}>
      {current===it.id && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-basketball-500"/>}
      {React.cloneElement(it.icon, { className:'w-[18px] h-[18px] flex-shrink-0'})}
      <span className="flex-1 text-left">{it.label}</span>
      {it.badge && <span className="text-[10px] font-semibold bg-basketball-500 text-white rounded-full px-1.5 py-0.5 leading-none">{it.badge}</span>}
    </button>
  );
  const initials = user.name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
  return (
    <aside className="w-[232px] bg-navy-900 text-white flex flex-col flex-shrink-0 border-r border-navy-950">
      <div className="h-14 px-4 flex items-center gap-2.5 border-b border-navy-800">
        <div className="w-7 h-7 rounded-md bg-basketball-500 text-white flex items-center justify-center font-bold text-[13px] tracking-tight">F</div>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold">FIBA Americas</div>
          <div className="text-2xs text-navy-300 font-medium tracking-wide">Nominations</div>
        </div>
      </div>
      <div className="px-3 py-3 border-b border-navy-800">
        <button className="w-full flex items-center gap-2.5 h-9 px-2.5 rounded-md bg-navy-800/60 hover:bg-navy-800 text-navy-200 text-[13px]">
          <Icon.Search className="w-4 h-4 text-navy-300"/>
          <span className="flex-1 text-left">Buscar…</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        <div className="text-2xs font-semibold text-navy-400 uppercase tracking-wider px-2.5 mb-1.5 mt-1">Operación</div>
        {items.map(NavItem)}
        <div className="text-2xs font-semibold text-navy-400 uppercase tracking-wider px-2.5 mb-1.5 mt-4">Sistema</div>
        {admin.map(NavItem)}
      </nav>
      <div className="border-t border-navy-800 p-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-basketball-500/20 text-basketball-300 flex items-center justify-center text-xs font-semibold">{initials}</div>
          <div className="flex-1 min-w-0 leading-tight">
            <div className="text-[13px] font-medium text-white truncate">{user.name}</div>
            <div className="text-2xs text-navy-300 truncate">{user.role}</div>
          </div>
          <button className="text-navy-300 hover:text-white"><Icon.Logout className="w-4 h-4"/></button>
        </div>
      </div>
    </aside>
  );
}
