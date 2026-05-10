import React from 'react';

// FIBA Americas — Logo set (SVG)
// All logos are designed in inline SVG with navy + basketball palette.
// Use width prop for sizing; height auto-scales via viewBox.

// === 01. MONOGRAM — F with basketball seam ===
// Primary mark for the app. Square. Works at 24-128px.
function LogoMonogram({ size = 48, mono = false }) {
  const navy = mono ? 'currentColor' : '#0c2340';
  const orange = mono ? 'currentColor' : '#F57C2A';
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="FIBA Americas">
      <rect width="64" height="64" rx="12" fill={navy}/>
      {/* Stylized F */}
      <path d="M18 14 L44 14 L44 22 L26 22 L26 30 L40 30 L40 38 L26 38 L26 50 L18 50 Z" fill="#fff"/>
      {/* Basketball arc — runs through the F's bowl like a seam */}
      <path d="M14 38 Q32 56 50 38" stroke={orange} strokeWidth="3" fill="none" strokeLinecap="round"/>
    </svg>
  );
}

// === 02. ROUNDEL — Basketball-inspired circular emblem ===
// Use for badges, splash screens, social. Works 32-200px.
function LogoRoundel({ size = 80, mono = false }) {
  const navy = mono ? 'currentColor' : '#0c2340';
  const orange = mono ? '#fff' : '#F57C2A';
  const cream = mono ? 'currentColor' : '#fff';
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" aria-label="FIBA Americas">
      <circle cx="40" cy="40" r="38" fill={navy}/>
      <circle cx="40" cy="40" r="38" fill="none" stroke={orange} strokeWidth="1.5" opacity="0.4"/>
      {/* Basketball seams */}
      <g stroke={orange} strokeWidth="1.5" fill="none" opacity="0.5">
        <path d="M40 4 Q40 40 40 76"/>
        <path d="M4 40 Q40 40 76 40"/>
        <path d="M14 14 Q40 40 66 66"/>
        <path d="M66 14 Q40 40 14 66"/>
      </g>
      {/* Center mark */}
      <circle cx="40" cy="40" r="20" fill={navy}/>
      <text x="40" y="38" textAnchor="middle" fontFamily="IBM Plex Sans, sans-serif"
        fontSize="11" fontWeight="700" fill={cream} letterSpacing="0.5">FIBA</text>
      <text x="40" y="48" textAnchor="middle" fontFamily="IBM Plex Sans, sans-serif"
        fontSize="6" fontWeight="600" fill={orange} letterSpacing="2">AMERICAS</text>
    </svg>
  );
}

// === 03. WORDMARK LOCKUP — horizontal, primary marketing/header use ===
function LogoWordmark({ height = 32, mono = false, theme = 'light' }) {
  const navy = mono ? 'currentColor' : (theme === 'dark' ? '#fff' : '#0c2340');
  const orange = mono ? 'currentColor' : '#F57C2A';
  const sub = mono ? 'currentColor' : (theme === 'dark' ? '#8aa5cf' : '#6b7385');
  const w = height * 6.5;
  return (
    <svg width={w} height={height} viewBox="0 0 260 40" aria-label="FIBA Americas Nominations">
      {/* Mark */}
      <rect x="0" y="0" width="40" height="40" rx="8" fill={navy}/>
      <path d="M11 9 L29 9 L29 14 L17 14 L17 19 L26 19 L26 24 L17 24 L17 31 L11 31 Z" fill="#fff"/>
      <path d="M8 23 Q20 35 32 23" stroke={orange} strokeWidth="2" fill="none" strokeLinecap="round"/>
      {/* Wordmark */}
      <text x="52" y="20" fontFamily="IBM Plex Sans, sans-serif"
        fontSize="17" fontWeight="700" fill={navy} letterSpacing="-0.3">FIBA Americas</text>
      <text x="52" y="34" fontFamily="IBM Plex Sans, sans-serif"
        fontSize="10" fontWeight="500" fill={sub} letterSpacing="0.5">Nominations System</text>
    </svg>
  );
}

// === 04. SHIELD — institutional/formal use, document headers, .docx letters ===
function LogoShield({ size = 80, mono = false }) {
  const navy = mono ? 'currentColor' : '#0c2340';
  const orange = mono ? '#fff' : '#F57C2A';
  return (
    <svg width={size} height={size * 1.18} viewBox="0 0 80 94" aria-label="FIBA Americas">
      {/* Shield path */}
      <path d="M40 4 L74 12 L74 48 Q74 72 40 88 Q6 72 6 48 L6 12 Z"
        fill={navy} stroke={orange} strokeWidth="1.5"/>
      {/* Top band */}
      <path d="M6 28 L74 28" stroke={orange} strokeWidth="1.5"/>
      <text x="40" y="22" textAnchor="middle" fontFamily="IBM Plex Sans, sans-serif"
        fontSize="8" fontWeight="700" fill="#fff" letterSpacing="3">FIBA</text>
      {/* Center monogram */}
      <text x="40" y="58" textAnchor="middle" fontFamily="IBM Plex Sans, sans-serif"
        fontSize="28" fontWeight="700" fill="#fff" letterSpacing="-1">FA</text>
      {/* Basketball arc beneath */}
      <path d="M22 70 Q40 84 58 70" stroke={orange} strokeWidth="2" fill="none" strokeLinecap="round"/>
      <text x="40" y="82" textAnchor="middle" fontFamily="IBM Plex Sans, sans-serif"
        fontSize="6" fontWeight="600" fill={orange} letterSpacing="2.5">AMERICAS</text>
    </svg>
  );
}

// === 05. COMPACT WORDMARK — single-line, no submark ===
function LogoWordmarkCompact({ height = 24, mono = false, theme = 'light' }) {
  const navy = mono ? 'currentColor' : (theme === 'dark' ? '#fff' : '#0c2340');
  const orange = mono ? 'currentColor' : '#F57C2A';
  const w = height * 7.2;
  return (
    <svg width={w} height={height} viewBox="0 0 172 24" aria-label="FIBA Americas">
      <text x="0" y="18" fontFamily="IBM Plex Sans, sans-serif"
        fontSize="18" fontWeight="700" fill={navy} letterSpacing="-0.4">FIBA</text>
      <circle cx="50" cy="12" r="3" fill={orange}/>
      <text x="58" y="18" fontFamily="IBM Plex Sans, sans-serif"
        fontSize="18" fontWeight="500" fill={navy} letterSpacing="-0.2">Americas</text>
    </svg>
  );
}

// === Refined sidebar lockup — clean vertical accent + wordmark ===
function LogoSidebar() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-1 h-8 bg-basketball-500 rounded-full flex-shrink-0"/>
      <div className="leading-tight">
        <div className="text-[14px] font-semibold text-white tracking-tight">FIBA Americas</div>
        <div className="text-[10px] text-navy-300 font-semibold tracking-[0.12em] uppercase mt-0.5">Nominations</div>
      </div>
    </div>
  );
}

export { LogoMonogram, LogoRoundel, LogoWordmark, LogoShield, LogoWordmarkCompact, LogoSidebar };
