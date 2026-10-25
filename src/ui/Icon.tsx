/**
 * A small stroke icon set, drawn inline.
 *
 * Hand-rolled rather than pulled from an icon package: the app needs about
 * thirty glyphs, all on one 16px grid with one stroke weight, and that
 * consistency matters more at this size than breadth of choice.
 */

const PATHS = {
  import: 'M8 2v6.5M5.5 6 8 8.5 10.5 6M3 10.5V13h10v-2.5',
  export: 'M8 9V2.5M5.5 5 8 2.5 10.5 5M3 10.5V13h10v-2.5',
  save: 'M3 3h7l3 3v7H3zM5.5 3v3h4V3M5.5 13V9.5h5V13',
  open: 'M2 12.5v-9h4l1.5 2H14v7z',
  undo: 'M3.5 7.5h6a3 3 0 1 1 0 6H7.5M3.5 7.5 6 5M3.5 7.5 6 10',
  redo: 'M12.5 7.5h-6a3 3 0 1 0 0 6H8.5M12.5 7.5 10 5M12.5 7.5 10 10',
  render:
    'M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0M8 2.2V8M13.1 11 8 8M2.9 11 8 8',
  eye: 'M1.6 8S4 4.3 8 4.3 14.4 8 14.4 8 12 11.7 8 11.7 1.6 8 1.6 8M9.75 8a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0',
  eyeOff:
    'M6.2 5a5.6 5.6 0 0 1 1.8-.3c4 0 6.4 3.3 6.4 3.3a12 12 0 0 1-2 2.2M4.2 5.9A11.4 11.4 0 0 0 1.6 8S4 11.3 8 11.3c.7 0 1.3-.1 1.9-.3M2.5 13.5l11-11',
  chevronRight: 'M6.5 4 10.5 8 6.5 12',
  chevronDown: 'M4 6.5 8 10.5 12 6.5',
  chevronUp: 'M4 9.5 8 5.5 12 9.5',
  trash: 'M3 4.8h10M6.4 4.8V3.3h3.2v1.5M4.6 4.8l.7 8.4h5.4l.7-8.4M6.7 7.2v3.8M9.3 7.2v3.8',
  copy: 'M6 6h7v7H6zM10 6V3H3v7h3',
  plus: 'M8 3.5v9M3.5 8h9',
  reset: 'M13 8a5 5 0 1 1-1.7-3.8M13.2 3v2.4h-2.4',
  grid: 'M2 6h12M2 10h12M6 2v12M10 2v12',
  cube: 'M8 2.2l5.8 3.1v5.4L8 13.8l-5.8-3.1V5.3zM2.2 5.3 8 8.4l5.8-3.1M8 8.4v5.4',
  light:
    'M10.6 8a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0M8 1.6v1.7M8 12.7v1.7M1.6 8h1.7M12.7 8h1.7M3.5 3.5l1.2 1.2M11.3 11.3l1.2 1.2M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2',
  camera:
    'M2 5.6h2.6L5.9 4h4.2l1.3 1.6H14v6.8H2zM10.2 8.9a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0',
  material: 'M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0M4.3 5.6c.9-1.1 2.1-1.6 3-1.3',
  sliders: 'M2.5 4.5h11M2.5 11.5h11M6 2.8v3.4M10.5 9.8v3.4',
  close: 'M4 4l8 8M12 4l-8 8',
  bell: 'M4 11.2V7.6a4 4 0 0 1 8 0v3.6l1.2 1.3H2.8zM6.6 13.7a1.5 1.5 0 0 0 2.8 0',
  brush:
    'M13.4 2.6 7.9 8.1M6.1 8.4l1.5 1.5c0 2.3-1.5 3.6-4.2 3.6.7-.8.8-1.5.8-2.3 0-1.1.8-2.2 1.9-2.8z',
  pencil: 'M10.6 2.9l2.5 2.5-7.6 7.6-3.2.7.7-3.2zM9.2 4.3l2.5 2.5',
  check: 'M3.5 8.4 6.4 11.3 12.5 5',
  alert: 'M8 2.6 14.4 13.4H1.6zM8 6.4v3.1M8 11.1v.9',
  info: 'M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0M8 7.4v3.9M8 4.7v.9',
  help: 'M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0M6.3 6.4a1.75 1.75 0 1 1 2.5 1.6c-.5.25-.8.7-.8 1.2v.4M8 11.1v.9',
  frame: 'M2.5 5.8V2.5h3.3M13.5 5.8V2.5h-3.3M2.5 10.2v3.3h3.3M13.5 10.2v3.3h-3.3',
  target:
    'M8 1.8v2.2M8 12v2.2M1.8 8h2.2M12 8h2.2M10.6 8a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0',
  panelLeft: 'M2.5 3h11v10h-11zM6.4 3v10',
  panelRight: 'M2.5 3h11v10h-11zM9.6 3v10',
  panelBottom: 'M2.5 3h11v10h-11zM2.5 9.4h11',
  image: 'M2.5 3.5h11v9h-11zM2.5 10 6 6.8l2.4 2.3L11 6.6l2.5 2.4M11 5.6a.95.95 0 1 1-1.9 0 .95.95 0 0 1 1.9 0',
  globe:
    'M14 8A6 6 0 1 1 2 8a6 6 0 0 1 12 0M2.3 6.2h11.4M2.3 9.8h11.4M8 2.1c-1.6 1.6-2.4 3.6-2.4 5.9S6.4 12.3 8 13.9c1.6-1.6 2.4-3.6 2.4-5.9S9.6 3.7 8 2.1',
  folder: 'M2 12.5v-9h4l1.5 2H14v7z',
  dots: 'M4.2 8h.01M8 8h.01M11.8 8h.01',
  perspective: 'M3 4.2 13 2.6v10.8L3 11.8zM3 4.2v7.6M13 2.6v10.8',
  ortho: 'M3.2 3.2h9.6v9.6H3.2z',
  pin: 'M8 9.6V14M5.2 2.4h5.6l-.8 4.2H6z',
  stop: 'M4.5 4.5h7v7h-7z',
  lock: 'M4.5 7.2h7V13h-7zM6 7.2V5.4a2 2 0 1 1 4 0v1.8',
  unlock: 'M4.5 7.2h7V13h-7zM6 7.2V5.4a2 2 0 0 1 3.9-.5',
  screenshot:
    'M2 5.6h2.6L5.9 4h4.2l1.3 1.6H14v6.8H2zM6.3 8.2h3.4M8 6.5v3.4',
  keyboard: 'M2 4.5h12v7H2zM4.5 7h.01M7 7h.01M9.5 7h.01M12 7h.01M5 9.4h6',
  library: 'M3 3v10M6.2 3v10M9.4 3.4l3.1 9.2',
  project: 'M2.5 3h11v10h-11zM2.5 6.2h11M6.2 6.2V13',
  move: 'M8 2v12M2 8h12M6.3 3.7 8 2l1.7 1.7M6.3 12.3 8 14l1.7-1.7M3.7 6.3 2 8l1.7 1.7M12.3 6.3 14 8l-1.7 1.7',
  select: 'M4 2.5l8 5.7-3.8.8-1.6 3.8z',
  pan: 'M5.6 8.3V4.2a1 1 0 0 1 2 0V7M7.6 7V3.3a1 1 0 0 1 2 0V7M9.6 7V4a1 1 0 0 1 2 0v5a4.2 4.2 0 0 1-4.2 4.2H7a3 3 0 0 1-2.4-1.2L2.9 8.7a1 1 0 0 1 1.6-1.2z',
  orbit: 'M2 8c0-1.7 2.7-3 6-3s6 1.3 6 3-2.7 3-6 3-6-1.3-6-3zM6.5 8a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0',
  zoom: 'M13 13l-2.6-2.6M10.8 6.9a3.9 3.9 0 1 1-7.8 0 3.9 3.9 0 0 1 7.8 0M5 6.9h3.8M6.9 5v3.8',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 16,
  className,
  strokeWidth = 1.25,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
