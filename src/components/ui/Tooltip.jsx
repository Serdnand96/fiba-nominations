import React, { useId, useState } from 'react';
import { Icon } from '../../lib/icons';
import { useLanguage } from '../../i18n/LanguageContext';

// Floating position of the bubble relative to the trigger it's anchored to.
const bubblePosition = {
  top:    'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left:   'right-full top-1/2 -translate-y-1/2 mr-2',
  right:  'left-full top-1/2 -translate-y-1/2 ml-2',
};
const arrowPosition = {
  top:    '-bottom-1 left-1/2 -translate-x-1/2',
  bottom: '-top-1 left-1/2 -translate-x-1/2',
  left:   '-right-1 top-1/2 -translate-y-1/2',
  right:  '-left-1 top-1/2 -translate-y-1/2',
};

/**
 * Generic hover/focus tooltip. Wraps a single trigger element (button, icon…)
 * and shows a small floating bubble with `label` on mouse hover and on
 * keyboard focus. Pure CSS + local state, no portal, no new dependency — safe
 * to drop inside modals, cards or tables.
 *
 * `position` picks which side the bubble opens on (default `top`). Prefer
 * `bottom` for triggers that sit near the top edge of a clipped
 * (`overflow-hidden`) container, e.g. a table/card header, so the bubble
 * doesn't get cropped.
 */
export function Tooltip({ label, children, position = 'top', className = '' }) {
  const id = useId();
  const [open, setOpen] = useState(false);

  const trigger = React.cloneElement(children, {
    tabIndex: children.props.tabIndex ?? 0,
    'aria-describedby': id,
    onMouseEnter: (e) => { children.props.onMouseEnter?.(e); setOpen(true); },
    onMouseLeave: (e) => { children.props.onMouseLeave?.(e); setOpen(false); },
    onFocus: (e) => { children.props.onFocus?.(e); setOpen(true); },
    onBlur: (e) => { children.props.onBlur?.(e); setOpen(false); },
    // Tap fallback: iOS Safari doesn't always focus a <button> on touch, so
    // hover/focus alone can leave the bubble unreachable on mobile. A tap
    // always *opens* it rather than a raw toggle — toggling would race with
    // onFocus on platforms where tapping does focus the button (Chrome,
    // Android, Windows Firefox): focus opens it, the click right after
    // would immediately flip it back closed. Dismissing on touch happens by
    // tapping elsewhere (blur), same as clicking away from any popover.
    onClick: (e) => { children.props.onClick?.(e); setOpen(true); },
  });

  return (
    <span className={`relative inline-flex align-middle ${className}`}>
      {trigger}
      <span role="tooltip" id={id} className={`pointer-events-none absolute z-30 w-max max-w-[13rem] whitespace-normal rounded-md bg-navy-900 dark:bg-ink-100 px-2.5 py-1.5 text-[12px] leading-snug text-white dark:text-navy-900 shadow-pop transition-opacity duration-150 ${open ? 'opacity-100' : 'opacity-0'} ${bubblePosition[position]}`}>
        {label}
        <span className={`absolute h-2 w-2 rotate-45 bg-navy-900 dark:bg-ink-100 ${arrowPosition[position]}`} />
      </span>
    </span>
  );
}

/**
 * Small "i" info icon pre-wired with a Tooltip — drop it next to a label,
 * legend entry or column header to explain a status inline instead of
 * sending users to docs. `label` must already be translated (pass `t(...)`).
 */
export function InfoHint({ label, position = 'top', className = '' }) {
  const { t } = useLanguage();
  return (
    <Tooltip label={label} position={position} className={className}>
      {/* Accessible name stays generic ("More info") so the bubble text —
          wired via aria-describedby in Tooltip — isn't announced twice.
          Visual icon stays 14px; the button box grows to a 24px (WCAG
          2.5.8) tap target around it. */}
      <button
        type="button"
        aria-label={t('common.moreInfo')}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-400 hover:text-ink-600 dark:text-ink-500 dark:hover:text-ink-300 focus:outline-none focus:shadow-focus"
      >
        <Icon.Info className="w-3.5 h-3.5" />
      </button>
    </Tooltip>
  );
}
