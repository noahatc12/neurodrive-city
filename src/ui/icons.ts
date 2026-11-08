/**
 * Inline SVG icons (24×24, stroke-based, currentColor). Drawn for this project.
 * @module ui/icons
 */
import { svg } from './dom.ts';

const wrap = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  graph: wrap(
    '<circle cx="5" cy="17" r="2"/><circle cx="12" cy="6" r="2"/><circle cx="19" cy="16" r="2"/><path d="M6.4 15.6 10.6 7.6M13.6 7.4l4.2 7.1M7 17.2h10"/>',
  ),
  stop: wrap('<path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z"/><path d="M8 12h8"/>'),
  yield: wrap('<path d="M3.5 5h17L12 20z"/><path d="M8 8h8l-4 7z" stroke-width="1.2"/>'),
  crossing: wrap(
    '<path d="M4 4v16M20 4v16"/><path d="M7 6h10M7 10h10M7 14h10M7 18h10" stroke-width="2.2"/>',
  ),
  parking: wrap(
    '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 17V7h3a3 3 0 0 1 0 6h-3"/>',
  ),
  light: wrap(
    '<rect x="8" y="2" width="8" height="17" rx="3"/><circle cx="12" cy="6" r="1.5"/><circle cx="12" cy="10.5" r="1.5"/><circle cx="12" cy="15" r="1.5"/><path d="M12 19v3"/>',
  ),
  start: wrap('<path d="M5 21V4"/><path d="M5 4h11l-2 3.5L16 11H5"/>'),
  target: wrap(
    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.8" fill="currentColor"/>',
  ),
  erase: wrap('<path d="m7 21-4-4 10-10 7 7-7 7z"/><path d="M14 21h7M9.5 10.5l7 7"/>'),
  undo: wrap('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo: wrap('<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
  grid: wrap('<path d="M4 4h16v16H4zM4 12h16M12 4v16"/>'),
  help: wrap(
    '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17" r="0.6" fill="currentColor"/>',
  ),
  menu: wrap('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  chevron: wrap('<path d="m6 9 6 6 6-6"/>'),
  close: wrap('<path d="M6 6l12 12M18 6 6 18"/>'),
  play: wrap('<path d="M7 4v16l13-8z"/>'),
  pause: wrap('<path d="M8 5v14M16 5v14"/>'),
  layers: wrap('<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'),
  sliders: wrap(
    '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  ),
  dice: wrap(
    '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="15" r="1" fill="currentColor"/>',
  ),
  brain: wrap(
    '<path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3h0V4z"/><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3V4z"/>',
  ),
  camera: wrap('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  save: wrap('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>'),
  folder: wrap('<path d="M3 6h6l2 2h10v11H3z"/>'),
  city: wrap(
    '<path d="M3 21h18M5 21V9l5-3v15M10 21V4l9 4v13"/><path d="M13 10h2M13 14h2M7 12h1M7 16h1"/>',
  ),
  globe: wrap(
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  ),
  trash: wrap('<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>'),
  cube: wrap('<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>'),
  square: wrap('<rect x="4" y="4" width="16" height="16" rx="2"/>'),
  sun: wrap(
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  ),
  moon: wrap('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'),
  ring: wrap('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/>'),
  road: wrap('<path d="M8 3 5 21M16 3l3 18M12 4v3M12 10v4M12 17v3"/>'),
  download: wrap('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  upload: wrap('<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>'),
  skip: wrap('<path d="M5 5v14l10-7z"/><path d="M19 5v14"/>'),
  reset: wrap('<path d="M4 4v6h6"/><path d="M5.5 15a7 7 0 1 0 1.6-7.4L4 10"/>'),
  bolt: wrap('<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
  car: wrap(
    '<path d="M5 17h14M4 13l2-6h12l2 6v5H4z"/><circle cx="7.5" cy="16.5" r="1.5"/><circle cx="16.5" cy="16.5" r="1.5"/>',
  ),
  info: wrap(
    '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.5" r="0.6" fill="currentColor"/>',
  ),
} as const;

export type IconName = keyof typeof ICONS;

/** Returns a fresh SVG element for an icon. */
export function icon(name: IconName): SVGElement {
  return svg(ICONS[name]);
}
