import type { RenderSettings } from './types';

/**
 * The user's saved render settings, kept in this browser (localStorage) so a
 * new scene or a fresh page starts from them. Only the output and quality
 * choices are kept: depth of field belongs to the camera and the scene, and
 * the viewport preview limit is a working choice.
 */

const KEY = 'kaamos.renderDefaults';

export interface SavedRenderDefaults {
  render: Partial<RenderSettings>;
  showFrame?: boolean;
  lockAspect?: boolean;
}

const SAVED_KEYS = [
  'engine',
  'width',
  'height',
  'samples',
  'pathSamples',
  'bounces',
  'denoise',
  'denoiseStrength',
  'transparentBackground',
] as const;

/** Whatever was saved, checked key by key; anything odd is ignored. */
export function loadRenderDefaults(): SavedRenderDefaults {
  const empty: SavedRenderDefaults = { render: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const data = JSON.parse(raw) as Record<string, unknown>;
    const render: Record<string, unknown> = {};
    const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 1;
    if (data.engine === 'raster' || data.engine === 'pathtrace') render.engine = data.engine;
    for (const key of ['width', 'height', 'samples', 'pathSamples', 'bounces'] as const) {
      if (isCount(data[key])) render[key] = Math.round(data[key] as number);
    }
    if (typeof data.denoise === 'boolean') render.denoise = data.denoise;
    if (data.denoiseStrength === 'light' || data.denoiseStrength === 'medium' || data.denoiseStrength === 'strong') {
      render.denoiseStrength = data.denoiseStrength;
    }
    if (typeof data.transparentBackground === 'boolean') {
      render.transparentBackground = data.transparentBackground;
    }
    return {
      render: render as Partial<RenderSettings>,
      showFrame: typeof data.showFrame === 'boolean' ? data.showFrame : undefined,
      lockAspect: typeof data.lockAspect === 'boolean' ? data.lockAspect : undefined,
    };
  } catch {
    return empty;
  }
}

/** Returns false when the browser would not store it (private window, blocked). */
export function saveRenderDefaults(
  render: RenderSettings,
  view: { showFrame: boolean; lockAspect: boolean },
): boolean {
  try {
    const data: Record<string, unknown> = { ...view };
    for (const key of SAVED_KEYS) data[key] = render[key];
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
