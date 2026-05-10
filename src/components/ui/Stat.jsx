import React from 'react';
import { Card } from './Card';
import { Icon } from '../../lib/icons';

export function Stat({ label, value, delta, trend, icon, sub }) {
  const trendCfg = trend === 'up'
    ? { color:'text-success-600 bg-success-50 dark:bg-success-500/15', icon: <Icon.ArrowUp className="w-3 h-3"/>}
    : trend === 'down'
    ? { color:'text-danger-600 bg-danger-50 dark:bg-danger-500/15',   icon: <Icon.ArrowDown className="w-3 h-3"/> }
    : null;
  return (
    <Card padding="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[13px] font-medium text-ink-500 dark:text-ink-400">{label}</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <div className="text-[28px] leading-none font-semibold text-navy-900 dark:text-white num tracking-tight">{value}</div>
            {trendCfg && delta && (
              <span className={`inline-flex items-center gap-0.5 text-2xs font-semibold px-1.5 py-0.5 rounded ${trendCfg.color}`}>
                {trendCfg.icon}{delta}
              </span>
            )}
          </div>
          {sub && <div className="text-xs text-ink-500 dark:text-ink-400 mt-1.5">{sub}</div>}
        </div>
        {icon && (
          <div className="w-10 h-10 rounded-lg bg-navy-50 text-navy-700 dark:bg-navy-800 dark:text-navy-200 flex items-center justify-center">
            {React.cloneElement(icon, { className:'w-5 h-5' })}
          </div>
        )}
      </div>
    </Card>
  );
}
