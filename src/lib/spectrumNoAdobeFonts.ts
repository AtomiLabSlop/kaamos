/**
 * Stands in for Spectrum 2's internal `Fonts` component (see vite.config.ts).
 * The original preloads Adobe Clean from Adobe's Typekit on every page load;
 * that font is licensed for Adobe products only, and Kaamos makes no
 * third-party font requests. The font comes from `--s2-font-family-sans`.
 */
export function Fonts(): null {
  return null;
}
