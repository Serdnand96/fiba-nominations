import React from 'react';

// Tabler-style icons (subset). All paths © Tabler Icons (MIT).
// Use the className prop for size/color (defaults to w-4 h-4).

const I = (paths) => function TablerIcon({ className = 'w-4 h-4', ...rest }) {
  return (
    <svg viewBox="0 0 24 24" className={`tabler ${className}`} aria-hidden="true" {...rest}>
      {paths}
    </svg>
  );
};

export const Icon = {
  Dashboard: I(<><path d="M4 4h6v8H4z"/><path d="M4 16h6v4H4z"/><path d="M14 12h6v8h-6z"/><path d="M14 4h6v4h-6z"/></>),
  Trophy: I(<><path d="M8 21l8 0"/><path d="M12 17l0 4"/><path d="M7 4l10 0"/><path d="M17 4v8a5 5 0 0 1-10 0v-8"/><circle cx="5" cy="9" r="2"/><circle cx="19" cy="9" r="2"/></>),
  Users: I(<><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.85"/></>),
  Calendar: I(<><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M16 3v4"/><path d="M8 3v4"/><path d="M4 11h16"/></>),
  Whistle: I(<><path d="M14 8h7l-2 9a3 3 0 0 1-3 2H6a3 3 0 0 1-3-3v-2a3 3 0 0 1 3-3h8z"/><path d="M9 11v-3a4 4 0 0 1 8 0"/></>),
  Truck: I(<><path d="M3 6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v11h-11z"/><path d="M14 8h4l3 3v6h-7"/><circle cx="7" cy="19" r="2"/><circle cx="17" cy="19" r="2"/></>),
  Plane: I(<path d="M16 10h4a2 2 0 0 1 0 4h-4l-4 7h-3l2 -7h-4l-2 2h-3l2 -4l-2 -4h3l2 2h4l-2 -7h3z"/>),
  Shield: I(<><path d="M12 3l8 4v6c0 5-3.5 8.5-8 9c-4.5-.5-8-4-8-9v-6z"/><path d="M9 12l2 2l4-4"/></>),
  Plus: I(<><path d="M12 5v14"/><path d="M5 12h14"/></>),
  Minus: I(<path d="M5 12h14"/>),
  Search: I(<><circle cx="10" cy="10" r="7"/><path d="M21 21l-6-6"/></>),
  Download: I(<><path d="M12 3v12"/><path d="M7 11l5 5l5-5"/><path d="M5 21h14"/></>),
  Upload: I(<><path d="M12 21V9"/><path d="M7 13l5-5l5 5"/><path d="M5 3h14"/></>),
  Doc: I(<><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M5 8a2 2 0 0 1 2-2h7l5 5v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/></>),
  Check: I(<path d="M5 12l5 5l10-10"/>),
  X: I(<><path d="M18 6L6 18"/><path d="M6 6l12 12"/></>),
  Chevron: I(<path d="M9 6l6 6l-6 6"/>),
  ChevronDown: I(<path d="M6 9l6 6l6-6"/>),
  ArrowUp: I(<><path d="M12 5l0 14"/><path d="M5 12l7 -7l7 7"/></>),
  ArrowDown: I(<><path d="M12 5l0 14"/><path d="M19 12l-7 7l-7 -7"/></>),
  Alert: I(<><path d="M12 9v4"/><path d="M12 16v.01"/><path d="M5 21h14a2 2 0 0 0 1.84-2.75l-7-12a2 2 0 0 0-3.48 0l-7 12A2 2 0 0 0 5 21"/></>),
  Info: I(<><circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M11 12h1v4h1"/></>),
  Bell: I(<><path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6"/><path d="M9 17v1a3 3 0 0 0 6 0v-1"/></>),
  Clock: I(<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>),
  Globe: I(<><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8"/><path d="M3.6 15h16.8"/><path d="M11.5 3a17 17 0 0 0 0 18"/><path d="M12.5 3a17 17 0 0 1 0 18"/></>),
  Pin: I(<><circle cx="12" cy="11" r="3"/><path d="M17.657 16.657L13.414 20.9a2 2 0 0 1-2.828 0l-4.243-4.243a8 8 0 1 1 11.314 0z"/></>),
  Pushpin: I(<><path d="M9 4v6l-2 4v2h10v-2l-2-4V4"/><path d="M12 16v5"/><path d="M8 4h8"/></>),
  PushpinFilled: I(<><path d="M9 4v6l-2 4v2h10v-2l-2-4V4" fill="currentColor"/><path d="M12 16v5"/><path d="M8 4h8"/></>),
  Moon: I(<path d="M12 3a6 6 0 0 0 9 9a9 9 0 1 1-9-9"/>),
  Sun: I(<><circle cx="12" cy="12" r="4"/><path d="M3 12h1"/><path d="M12 3v1"/><path d="M20 12h1"/><path d="M12 20v1"/><path d="M5.6 5.6l.7.7"/><path d="M17.7 17.7l.7.7"/><path d="M5.6 18.4l.7-.7"/><path d="M17.7 6.3l.7-.7"/></>),
  Cog: I(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3a1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1"/></>),
  Logout: I(<><path d="M14 8v-2a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2"/><path d="M9 12h12l-3-3"/><path d="M18 15l3-3"/></>),
  Eye: I(<><circle cx="12" cy="12" r="2"/><path d="M22 12c-2.667 4-6 6-10 6s-7.333-2-10-6c2.667-4 6-6 10-6s7.333 2 10 6"/></>),
  History: I(<><path d="M12 8v4l2 2"/><path d="M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5"/></>),
  Report: I(<><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M5 8a2 2 0 0 1 2-2h7l5 5v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z"/><path d="M9 17v-3"/><path d="M12 17v-5"/><path d="M15 17v-2"/></>),
  Wallet: I(<><path d="M17 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/><path d="M20 12v-2a2 2 0 0 0-2-2h-4a2 2 0 0 0 0 4h4a2 2 0 0 0 2-2z"/></>),
  Star: I(<path d="M12 4l2.4 4.9l5.4.8l-3.9 3.8l.9 5.4l-4.8-2.5l-4.8 2.5l.9-5.4l-3.9-3.8l5.4-.8z"/>),
  StarFilled: I(<path d="M12 4l2.4 4.9l5.4.8l-3.9 3.8l.9 5.4l-4.8-2.5l-4.8 2.5l.9-5.4l-3.9-3.8l5.4-.8z" fill="currentColor"/>),
  // ── Muro (feed) ──
  Feed: I(<><path d="M16 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3"/><path d="M8 4h8v4H8z"/><path d="M8 12h8"/><path d="M8 16h5"/></>),
  Message: I(<><path d="M8 9h8"/><path d="M8 13h6"/><path d="M12 3c-4.97 0-9 3.58-9 8c0 1.9.75 3.64 2 5l-1 4l4.5-1.5A10.4 10.4 0 0 0 12 19c4.97 0 9-3.58 9-8s-4.03-8-9-8"/></>),
  Photo: I(<><path d="M15 8h.01"/><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 15l4-4a3 5 0 0 1 3 0l5 5"/><path d="M14 14l1-1a3 5 0 0 1 3 0l2 2"/></>),
  Link: I(<><path d="M9 15l6-6"/><path d="M11 6l.463-.536a5 5 0 0 1 7.071 7.072L18 13"/><path d="M13 18l-.397.534a5.068 5.068 0 0 1-7.127 0a4.972 4.972 0 0 1 0-7.071L6 11"/></>),
  Poll: I(<><path d="M4 20h16"/><rect x="5" y="10" width="3" height="7"/><rect x="10.5" y="5" width="3" height="12"/><rect x="16" y="13" width="3" height="4"/></>),
  Dots: I(<><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>),
  Trash: I(<><path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/></>),
  Pencil: I(<><path d="M4 20h4L18.5 9.5a2.828 2.828 0 1 0-4-4L4 16v4"/><path d="M13.5 6.5l4 4"/></>),
  Send: I(<><path d="M10 14l11-11"/><path d="M21 3L14.5 21a.55.55 0 0 1-1 0L10 14l-7-3.5a.55.55 0 0 1 0-1z"/></>),
  Megaphone: I(<><path d="M18 8a3 3 0 0 1 0 6"/><path d="M10 8v11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-5"/><path d="M12 8h0l4.524-3.77A.9.9 0 0 1 18 4.922v12.156a.9.9 0 0 1-1.476.692L12 14H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/></>),
};
