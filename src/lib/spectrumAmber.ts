/**
 * Kaamos amber in place of Spectrum 2's blue.
 *
 * Spectrum's accent colour is compiled into its CSS as literal hex values (the
 * blue scale, light and dark), not a variable, so it cannot be themed. The
 * `kaamos-spectrum-amber` plugin in vite.config.ts rewrites those values in
 * Spectrum's own stylesheets at build time, using this table.
 *
 * Dark scheme (the one Kaamos uses): the step Spectrum fills accent buttons
 * with, blue-700 (#345bf8), becomes Kaamos amber #faaf57 exactly (hover and
 * pressed are the lighter steps above it). The steps around it keep their order of lightness in OKLCH
 * at that amber's hue, darker below and lighter above, chroma clipped to sRGB.
 * Bright amber cannot carry white text (about 2:1), so every accent fill in
 * Kaamos gets dark text instead (.kaamos-accent-fill / .kaamos-emph in
 * index.css; 7:1 or better on every button state).
 *
 * Light scheme (unused today): each amber has the blue's WCAG luminance, so
 * Spectrum's own contrasts would hold.
 *
 * Built from @adobe/spectrum-tokens 15.6.0 (blue-100 … blue-1600). If a
 * Spectrum update changes its blue, the affected parts turn blue again.
 */
const DARK: Record<string, string> = {
  '#0e173f': '#271807',
  '#0f1c52': '#38240d',
  '#0c2175': '#533717',
  '#122d9a': '#7b5426',
  '#1a3ac3': '#a87438',
  '#2549e5': '#d39348',
  '#345bf8': '#faaf57',
  '#4069fd': '#fbb564',
  '#5681ff': '#febe77',
  '#6995fe': '#fec689',
  '#7ca9fc': '#fecf9c',
  '#98c0fc': '#ffd9b2',
  '#b5d5fd': '#ffe3c7',
  '#d5e7fe': '#ffedda',
  '#eef5ff': '#fff4e9',
};

const LIGHT: Record<string, string> = {
  '#f5f9ff': '#fcf8f4',
  '#e5f0fe': '#f6eee4',
  '#cbe2fe': '#eeddc9',
  '#accffd': '#e3c8a7',
  '#8eb9fc': '#d7b181',
  '#729efd': '#ca9751',
  '#5d89ff': '#c1821c',
  '#4b75ff': '#af7301',
  '#3b63fb': '#9d6700',
  '#274dea': '#855603',
  '#1d3ecf': '#704903',
  '#1532ad': '#5d3b02',
  '#10288c': '#4b2f00',
  '#0c1f69': '#392300',
  '#0e1843': '#2a1801',
  '#070b1e': '#140a01',
};

export const SPECTRUM_BLUE_TO_AMBER: Record<string, string> = { ...LIGHT, ...DARK };

/** Text on an accent fill (index.css). */
export const ON_ACCENT = '#1a1206';
