import React, { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { ToastProvider } from '../ui/Toast';

/**
 * AppShell wires the persistent layout (sidebar + topbar) around your routed pages.
 * - current / onNav: control nav highlight & routing (replace with your router of choice).
 * - children: the active page.
 */
export function AppShell({ current, onNav, title, breadcrumb, topActions, children }) {
  const [dark, setDark] = useState(() => localStorage.getItem('fiba_dark') === '1');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('fiba_dark', dark ? '1' : '0');
  }, [dark]);

  return (
    <ToastProvider>
      <div className="flex h-screen bg-ink-50 dark:bg-navy-950">
        <Sidebar current={current} onNav={onNav}/>
        <div className="flex-1 flex flex-col min-w-0">
          <Topbar title={title} breadcrumb={breadcrumb} actions={topActions} dark={dark} onToggleDark={()=>setDark(d=>!d)}/>
          <main className="flex-1 overflow-y-auto p-6">
            <div className="max-w-[1440px] mx-auto">{children}</div>
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
