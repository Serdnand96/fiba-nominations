import React from 'react';

const sizes = {
  xs: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-md',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-lg',
};
const variants = {
  primary:  'bg-basketball-500 hover:bg-basketball-600 active:bg-basketball-700 text-white font-medium shadow-card focus:shadow-focus-accent',
  secondary:'bg-white hover:bg-ink-50 active:bg-ink-100 text-ink-800 font-medium border border-ink-200 dark:bg-navy-800 dark:hover:bg-navy-700 dark:text-ink-50 dark:border-navy-700',
  ghost:    'bg-transparent hover:bg-ink-100 active:bg-ink-200 text-ink-700 font-medium dark:hover:bg-navy-800 dark:text-ink-200',
  navy:     'bg-navy-900 hover:bg-navy-800 active:bg-navy-950 text-white font-medium dark:bg-navy-700 dark:hover:bg-navy-600',
  danger:   'bg-danger-600 hover:bg-danger-700 text-white font-medium',
  link:     'bg-transparent text-navy-700 hover:text-navy-900 underline-offset-2 hover:underline dark:text-navy-300',
};

export function Button({ variant='primary', size='md', icon, iconRight, children, className='', ...rest }) {
  const iconCls = size==='xs' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  return (
    <button
      className={`inline-flex items-center justify-center transition-colors disabled:opacity-50 disabled:pointer-events-none ${sizes[size]} ${variants[variant]} ${className}`}
      {...rest}
    >
      {icon ? React.cloneElement(icon, { className: `${iconCls} ${icon.props?.className || ''}` }) : null}
      {children}
      {iconRight ? React.cloneElement(iconRight, { className: `${iconCls} ${iconRight.props?.className || ''}` }) : null}
    </button>
  );
}

const iconBtnSizes = { xs:'w-7 h-7', sm:'w-8 h-8', md:'w-9 h-9', lg:'w-10 h-10' };
const iconBtnVariants = {
  ghost:    'text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-navy-800',
  secondary:'border border-ink-200 bg-white hover:bg-ink-50 text-ink-700 dark:bg-navy-800 dark:border-navy-700 dark:text-ink-200',
};

export function IconButton({ icon, label, size='md', variant='ghost', className='', ...rest }) {
  return (
    <button aria-label={label} title={label}
      className={`inline-flex items-center justify-center rounded-md transition-colors ${iconBtnSizes[size]} ${iconBtnVariants[variant]} ${className}`} {...rest}>
      {React.cloneElement(icon, { className:'w-[18px] h-[18px]' })}
    </button>
  );
}
