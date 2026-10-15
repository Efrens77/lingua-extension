// Inline SVG icons (stroke = currentColor, so CSS colors them).
const svg = (body) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  swap: svg('<path d="M7 7h12l-3-3"/><path d="M17 17H5l3 3"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  speaker: svg('<path d="M4 10v4h4l5 4V6l-5 4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>'),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>'),
  clear: svg('<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>'),
  refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
};
