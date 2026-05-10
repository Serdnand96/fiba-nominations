/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // ── FIBA navy — institutional surfaces & navigation ──
        navy: {
          50:  '#f3f6fb',
          100: '#e4ecf5',
          200: '#c0d0e4',
          300: '#8aa5cf',
          400: '#5a7fb8',
          500: '#335a9a',
          600: '#224680',
          700: '#1a3668',
          800: '#142c4e',
          900: '#0c2340', // official FIBA navy
          950: '#081628',
        },
        // ── Basketball — accent. Primary CTAs and key active states. ──
        basketball: {
          50:  '#fef5ed',
          100: '#fde6d0',
          200: '#fbc89e',
          300: '#f8a368',
          400: '#f78b46',
          500: '#F57C2A',
          600: '#d96a1a',
          700: '#b25416',
          800: '#8c4216',
          900: '#723815',
        },
        // ── Ink — warm slate neutrals ──
        ink: {
          50:  '#f8fafc',
          100: '#f1f4f8',
          200: '#e4e8ee',
          300: '#cbd2dc',
          400: '#9aa3b2',
          500: '#6b7385',
          600: '#4c5466',
          700: '#363c4c',
          800: '#1f2433',
          900: '#0f1320',
        },
        success: { 50:'#ecfdf3', 100:'#d1fadf', 500:'#12b76a', 600:'#039855', 700:'#027a48' },
        warning: { 50:'#fffaeb', 100:'#fef0c7', 500:'#f79009', 600:'#dc6803', 700:'#b54708' },
        danger:  { 50:'#fef3f2', 100:'#fee4e2', 500:'#f04438', 600:'#d92d20', 700:'#b42318' },
        info:    { 50:'#eff8ff', 100:'#d1e9ff', 500:'#2e90fa', 600:'#1570ef', 700:'#175cd3' },

        // ── Legacy aliases: kept so existing fiba-* classes still compile. ──
        // Mapped to the new palette so the look approaches the new design even
        // before each page is migrated to the new components.
        fiba: {
          dark:          '#0c2340',  // navy-900
          darker:        '#081628',  // navy-950
          card:          '#142c4e',  // navy-800
          border:        '#1a3668',  // navy-700
          muted:         '#9aa3b2',  // ink-400
          accent:        '#F57C2A',  // basketball-500
          'accent-hover':'#d96a1a',  // basketball-600
          surface:       '#1a3668',  // navy-700
          'surface-2':   '#224680',  // navy-600
        },
      },
      boxShadow: {
        'card':         '0 1px 2px 0 rgba(16, 24, 40, 0.04), 0 1px 3px 0 rgba(16, 24, 40, 0.06)',
        'card-lg':      '0 4px 6px -2px rgba(16, 24, 40, 0.03), 0 12px 16px -4px rgba(16, 24, 40, 0.08)',
        'pop':          '0 8px 16px -4px rgba(12, 35, 64, 0.10), 0 20px 40px -8px rgba(12, 35, 64, 0.16)',
        'focus':        '0 0 0 4px rgba(51, 90, 154, 0.20)',
        'focus-accent': '0 0 0 4px rgba(245, 124, 42, 0.25)',
      },
      borderRadius: {
        'xs': '3px',
        'sm': '4px',
        'md': '6px',
        'lg': '8px',
        'xl': '12px',
        '2xl':'16px',
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '14px', letterSpacing: '0.02em' }],
      },
      spacing: { '4.5':'1.125rem', '13':'3.25rem', '15':'3.75rem' },
    },
  },
  plugins: [require('@tailwindcss/forms')],
}
