// Inline SVG icons (stroke = currentColor). Level icons are always shown with a text label.

const svg = (inner, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${inner}</svg>`;

export const ICON = {
  // alert levels
  safe: svg('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16.5 9.5"/>'),
  watch: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  warning: svg('<path d="M12 3.5L2.5 20h19L12 3.5z"/><path d="M12 10v4.5"/><path d="M12 17.6v.1"/>'),
  danger: svg('<path d="M8.2 2.8h7.6L21.2 8.2v7.6l-5.4 5.4H8.2L2.8 15.8V8.2z"/><path d="M12 7.5v5.5"/><path d="M12 16.3v.1"/>'),
  // transport
  play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  pause: svg('<path d="M8 5v14M16 5v14"/>'),
  reset: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  // chrome
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>'),
  chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.7v.1"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  wifiOff: svg('<path d="M2 8.8a15 15 0 0 1 4-2.3M22 8.8a15 15 0 0 0-8.5-3.7M5 12.5a10 10 0 0 1 3.2-2M19 12.5a10 10 0 0 0-4.9-2.5M8.5 16a5 5 0 0 1 7 0M12 20h.01M3 3l18 18"/>'),
  bell: svg('<path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  ticket: svg('<rect x="5" y="4.5" width="14" height="16.5" rx="2.2"/><path d="M9 4.5V3h6v1.5M9 10.5h6M9 14.5h6M9 18h3"/>'),
  vol: svg('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  expand: svg('<path d="M14 4h6v6M10 20H4v-6M20 4l-7.5 7.5M4 20l7.5-7.5"/>'),
  chevron: svg('<path d="M6 9l6 6 6-6"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  check: svg('<path d="M5 12.5l4.2 4.2L19 7"/>'),
  checks: svg('<path d="M2.5 12.5l4 4L13 9.5M10 16.5l1 1L21.5 7"/>'),
  table: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>'),
  grip: `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>`,
  live: svg('<circle cx="12" cy="12" r="1.8" fill="currentColor"/><path d="M8.6 8.6a4.8 4.8 0 0 0 0 6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/>'),
  flask: svg('<path d="M9 3h6M10 3v5.5L4.8 18.2A1.8 1.8 0 0 0 6.4 21h11.2a1.8 1.8 0 0 0 1.6-2.8L14 8.5V3"/><path d="M7.5 15h9"/>'),
  // plants
  solar: svg('<circle cx="18.5" cy="5.5" r="2.4"/><path d="M3 20.5l3.2-9h13.3l.9 9z"/><path d="M4.6 16h15.6M10.4 11.5L9 20.5M15 11.5l.6 9"/>'),
  rig: svg('<path d="M12 3L7.8 21M12 3l4.2 18"/><path d="M9.4 13h5.2M8.6 17h6.8M10.6 8.5h2.8"/><path d="M3 21h18"/>'),
  mine: svg('<path d="M3 18h18"/><path d="M5.5 18a6.5 6.5 0 0 1 13 0"/><path d="M12 6.5v5.5"/><path d="M3 21h18"/>'),
  snow: svg('<path d="M12 2.5v19M4 7.2l16 9.6M4 16.8L20 7.2"/><path d="M9.6 4.2L12 6.6l2.4-2.4M9.6 19.8L12 17.4l2.4 2.4"/>'),
  // brand mark: a globe wrapped in a white scarf, as if being looked after (same artwork as icon.svg)
  geos: `<svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="12" fill="#14181f"/><circle cx="24" cy="21" r="14.5" fill="#3f73d9"/><path d="M14.6 12.9c3.2-1.4 6.6-.4 7.4 1.6.9 2.2-1.6 3-3.2 4.2-1.4 1-.5 3.1-2.3 3.5-2 .4-3.9-1.5-4.4-3.8-.4-2 .3-4.4 2.5-5.5zM28.2 10.9c2.8-.5 5.2 1 6 3.2.7 1.9-.9 3-2.4 3.2-1.8.3-2.2 2.3-3.9 2-1.9-.4-2.6-2.6-2.4-4.6.1-1.9 1-3.4 2.7-3.8z" fill="#9dbcf5" opacity=".78"/><path d="M9.7 22.6C15 28.6 33 28.6 38.3 22.6l.3 5C33.4 33.8 14.6 33.8 9.4 27.6z" fill="#f7f9fc"/><path d="M9.4 27.6c5.2 6.2 24 6.2 29.2 0l-.3 1.1c-5.3 5.8-23.3 5.8-28.6 0z" fill="#c9d4e6"/><path d="M26.4 33.2l5.2.9-1.3 8.8-5.4-1z" fill="#eef2f8" stroke="#c9d4e6" stroke-width=".8" stroke-linejoin="round"/><path d="M29.2 33.4l5.4-1.2 3.3 8.3-5.5 1.9z" fill="#fff" stroke="#c9d4e6" stroke-width=".8" stroke-linejoin="round"/><path d="M25.4 42.4l5 .9M32.6 42.4l4.8-1.6" stroke="#c9d4e6" stroke-width="1.4" stroke-linecap="round"/><ellipse cx="28.6" cy="33" rx="3.5" ry="2.6" fill="#fff" stroke="#c9d4e6" stroke-width=".8" transform="rotate(8 28.6 33)"/></svg>`,
};

export const LEVEL_ICON = ['safe', 'watch', 'warning', 'danger'];
export const LEVEL_LABEL = ['SAFE', 'WATCH', 'WARNING', 'DANGER'];

/** Status pill: colour is never alone, the icon and the label always travel with it. */
export function badge(level, { big = false, label } = {}) {
  return `<span class="pill lv${level}${big ? ' big' : ''}">${ICON[LEVEL_ICON[level]]}${label || LEVEL_LABEL[level]}</span>`;
}
