import React from 'react';
import { useLanguage } from '../../i18n/LanguageContext';

const tones = {
  ink:       'bg-ink-100 text-ink-700 dark:bg-navy-800 dark:text-ink-200',
  navy:      'bg-navy-50 text-navy-700 dark:bg-navy-800 dark:text-navy-200',
  basketball:'bg-basketball-100 text-basketball-700 dark:bg-basketball-900/30 dark:text-basketball-300',
  success:   'bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-500',
  warning:   'bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-500',
  danger:    'bg-danger-50 text-danger-700 dark:bg-danger-500/15 dark:text-danger-500',
  info:      'bg-info-50 text-info-700 dark:bg-info-500/15 dark:text-info-500',
  outline:   'bg-transparent border border-ink-200 text-ink-700 dark:border-navy-700 dark:text-ink-200',
};
const dotColors = {
  ink:'bg-ink-400', navy:'bg-navy-500', basketball:'bg-basketball-500',
  success:'bg-success-500', warning:'bg-warning-500', danger:'bg-danger-500', info:'bg-info-500', outline:'bg-ink-400'
};
const sizes = {
  sm:'text-2xs px-1.5 py-0.5 rounded',
  md:'text-xs px-2 py-0.5 rounded-md',
  lg:'text-[13px] px-2.5 py-1 rounded-md'
};

export function Badge({ tone='ink', size='md', icon, children, dot=false }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${tones[tone]} ${sizes[size]}`}>
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${dotColors[tone]}`}/>}
      {icon && React.cloneElement(icon, { className:'w-3 h-3'})}
      {children}
    </span>
  );
}

const statusMap = {
  active:    { tone:'success',    es:'Activa',        en:'Active',      dot:true },
  completed: { tone:'ink',        es:'Finalizada',    en:'Completed',   dot:true },
  planning:  { tone:'info',       es:'Planificación', en:'Planning',    dot:true },
  draft:     { tone:'ink',        es:'Borrador',      en:'Draft' },
  pending:   { tone:'warning',    es:'Pendiente',     en:'Pending',     dot:true },
  approved:  { tone:'info',       es:'Aprobada',      en:'Approved' },
  sent:      { tone:'navy',       es:'Enviada',       en:'Sent' },
  accepted:  { tone:'success',    es:'Aceptada',      en:'Accepted',    dot:true },
  online:    { tone:'success',    es:'En línea',      en:'Online',      dot:true },
  offline:   { tone:'ink',        es:'Sin conexión',  en:'Offline',     dot:true },
  inactive:  { tone:'ink',        es:'Inactivo',      en:'Inactive' },
  scheduled: { tone:'info',       es:'Programado',    en:'Scheduled' },
  'in-progress':{ tone:'basketball', es:'En curso',   en:'In progress', dot:true },
  onsite:    { tone:'navy',       es:'Presencial',    en:'On site' },
  online_mode:{tone:'info',       es:'Virtual',       en:'Online' },
};

export function StatusPill({ status, label }) {
  const { lang } = useLanguage();
  const cfg = statusMap[status];
  if (!cfg) return <Badge tone="ink">{label || status}</Badge>;
  return <Badge tone={cfg.tone} dot={cfg.dot}>{lang === 'es' ? cfg.es : cfg.en}</Badge>;
}
