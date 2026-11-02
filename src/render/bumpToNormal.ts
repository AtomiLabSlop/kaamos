import { CanvasTexture, NoColorSpace, RepeatWrapping, type Texture } from 'three';

/**
 * The path tracer has no bump maps, only normal maps, so a material with a
 * bump image would lose its relief in a path traced picture. For the length of
 * a trace the bump image is turned into the equivalent normal map: the slope of
 * the brightness, read across neighbouring pixels, tilts the surface.
 *
 * The slope is measured per pixel of a `REFERENCE_SIDE` image whatever the
 * image's own size (a larger image is read across a few pixels), so a larger
 * copy of the same picture gives the same relief.
 * The bump strength is built into the map rather than applied as a normal
 * scale afterwards: the map holds 8 bits per channel, and a gentle relief
 * scaled up after storing turned into a few coarse steps, or into nothing.
 * `STRENGTH` is the tilt of a full-brightness step across one reference pixel
 * at a bump strength of 1. The raster view measures bumps per screen pixel and
 * the tracer per image pixel, so the two never match exactly.
 */
const STRENGTH = 4;
const REFERENCE_SIDE = 512;
const MAX_SIDE = 2048;
/** Strengths built per image; more than this and the oldest is dropped. */
const KEEP_PER_IMAGE = 3;

const cache = new WeakMap<object, Map<number, CanvasTexture>>();

type Source = CanvasImageSource & { width: number; height: number };

function readHeights(image: Source) {
  const scale = Math.min(1, MAX_SIDE / Math.max(image.width, image.height));
  const w = Math.max(2, Math.round(image.width * scale));
  const h = Math.max(2, Math.round(image.height * scale));

  const read = document.createElement('canvas');
  read.width = w;
  read.height = h;
  const readContext = read.getContext('2d', { willReadFrequently: true });
  if (!readContext) return null;
  readContext.drawImage(image, 0, 0, w, h);
  const pixels = readContext.getImageData(0, 0, w, h).data;

  const height = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    height[i] = (0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2]) / 255;
  }
  return { w, h, height };
}

const heights = new WeakMap<object, NonNullable<ReturnType<typeof readHeights>>>();

function build(image: Source, strength: number): CanvasTexture | null {
  let field = heights.get(image);
  if (!field) {
    const read = readHeights(image);
    if (!read) return null;
    field = read;
    heights.set(image, field);
  }
  const { w, h, height } = field;

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const outContext = out.getContext('2d');
  if (!outContext) return null;
  const result = outContext.createImageData(w, h);

  // Slope per reference pixel, read across the width of one reference pixel
  // (r pixels of this copy each side). Reading across neighbours only, a
  // smooth 8-bit ramp in a large image has steps several pixels apart and
  // showed almost no slope.
  const rx = Math.max(1, Math.round(w / REFERENCE_SIDE));
  const ry = Math.max(1, Math.round(h / REFERENCE_SIDE));
  const kx = 0.5 * STRENGTH * strength * (w / REFERENCE_SIDE / rx);
  const ky = 0.5 * STRENGTH * strength * (h / REFERENCE_SIDE / ry);

  for (let y = 0; y < h; y++) {
    const up = ((y + h - ry) % h) * w;
    const down = ((y + ry) % h) * w;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const left = (x + w - rx) % w;
      const right = (x + rx) % w;
      // The image is stored with v growing downwards through the rows, and the
      // pattern repeats, so the edges wrap round.
      const dx = (height[row + right] - height[row + left]) * kx;
      const dy = (height[down + x] - height[up + x]) * ky;
      const length = Math.hypot(dx, dy, 1);
      const o = (row + x) * 4;
      result.data[o] = Math.round((-dx / length * 0.5 + 0.5) * 255);
      result.data[o + 1] = Math.round((-dy / length * 0.5 + 0.5) * 255);
      result.data[o + 2] = Math.round((1 / length * 0.5 + 0.5) * 255);
      result.data[o + 3] = 255;
    }
  }
  outContext.putImageData(result, 0, 0);

  const texture = new CanvasTexture(out);
  texture.flipY = false; // same orientation as the bump image it came from
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = NoColorSpace;
  texture.userData.standsInForBump = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A normal map standing for the given bump map at the given strength (the
 * material's bump scale), placed on the surface the same way (repeat, offset,
 * rotation). The caller leaves the normal scale at 1. Built once per image and
 * strength and kept.
 */
export function normalMapFromBump(bump: Texture, strength: number): Texture | null {
  const image = bump.image as Source | null | undefined;
  if (!image || !image.width || !image.height) return null;

  const key = Math.round(strength * 1000) / 1000;
  let built = cache.get(image);
  if (!built) {
    built = new Map();
    cache.set(image, built);
  }
  let normal = built.get(key);
  if (!normal) {
    const made = build(image, key);
    if (!made) return null;
    normal = made;
    built.set(key, normal);
    while (built.size > KEEP_PER_IMAGE) {
      const oldest = built.keys().next().value as number;
      built.get(oldest)?.dispose();
      built.delete(oldest);
    }
  } else {
    // Most recently used goes to the back of the line.
    built.delete(key);
    built.set(key, normal);
  }
  normal.repeat.copy(bump.repeat);
  normal.offset.copy(bump.offset);
  normal.center.copy(bump.center);
  normal.rotation = bump.rotation;
  normal.updateMatrix();
  return normal;
}
