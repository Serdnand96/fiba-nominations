import React from 'react';
import { Icon } from '../../lib/icons';

export function Table({ columns, rows, selectable=false, selected=[], onSelectAll, onSelect, dense=false, rowKey='id' }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-2xs font-semibold uppercase tracking-wider text-ink-500 dark:text-ink-400 bg-ink-50/60 dark:bg-navy-900/60 border-y border-ink-200 dark:border-navy-800">
            {selectable && (
              <th className="w-10 pl-4">
                <input type="checkbox" className="rounded border-ink-300 text-navy-700 focus:ring-navy-500" onChange={onSelectAll}
                  checked={selected.length>0 && selected.length===rows.length}/>
              </th>
            )}
            {columns.map(c => (
              <th key={c.key} className={`px-3 ${dense?'py-2':'py-2.5'} ${c.align==='right'?'text-right':''} ${c.className||''}`}>
                <span className="inline-flex items-center gap-1">
                  {c.label}
                  {c.sortable && <Icon.ArrowDown className="w-3 h-3 text-ink-400"/>}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="row-divide">
          {rows.map((row, ri) => (
            <tr key={row[rowKey] || ri} className="hover:bg-ink-50/70 dark:hover:bg-navy-800/60 group transition-colors">
              {selectable && (
                <td className="pl-4">
                  <input type="checkbox" className="rounded border-ink-300 text-navy-700 focus:ring-navy-500"
                    checked={selected.includes(row[rowKey])} onChange={()=>onSelect?.(row[rowKey])}/>
                </td>
              )}
              {columns.map(c => (
                <td key={c.key} className={`px-3 ${dense?'py-2':'py-3'} text-ink-700 dark:text-ink-200 ${c.align==='right'?'text-right':''} ${c.cellClass||''}`}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
