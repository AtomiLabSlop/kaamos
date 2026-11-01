import { CanvasTexture, NoColorSpace, RepeatWrapping, type Texture } from 'three';

/**
 * The path tracer has no bump maps, only normal maps, so a material with a
 * bump image would lose its relief in a path traced picture. For the length of
 * a trace the bump image is turned into the equivalent normal map: the slope of
 * the brightness, read across neighbouring pixels, tilts the surface.
 *
 * `STRENGTH` is how steeply a full-brightness step between two pixels tilts the
 * normal at a bump scale of 1; the material's bump scale multiplies it through
 * the normal scale. The raster view measures bumps on screen, the tracer in the
 * image, so the two never match exactly; this sits close to the raster look for
 * ordinary relief textures.
 */
const STRENGTH = 4;
const MAX_SIDE = 2048;

const cache = new WeakMap<object, CanvasTexture>();

type Source = CanvasImageSource & { width: number; height: number };

function build(image: Source): CanvasTexture | null {
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

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const outContext = out.getContext('2d');
  if (!outContext) return null;
  const result = outContext.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    const up = ((y + h - 1) % h) * w;
    const down = ((y + 1) % h) * w;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const left = (x + w - 1) % w;
      const right = (x + 1) % w;
      // The image is stored with v growing downwards through the rows, and the
      // pattern repeats, so the edges wrap round.
      const dx = (height[row + right] - height[row + left]) * 0.5 * STRENGTH;
      const dy = (height[down + x] - height[up + x]) * 0.5 * STRENGTH;
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
 * A normal map standing for the given bump map, placed on the surface the same
 * way (repeat, offset, rotation). Built once per image and kept.
 */
export function normalMapFromBump(bump: Texture): Texture | null {
  const image = bump.image as Source | null | undefined;
  if (!image || !image.width || !image.height) return null;

  let normal = cache.get(image);
  if (!normal) {
    const made = build(image);
    if (!made) return null;
    normal = made;
    cache.set(image, normal);
  }
  normal.repeat.copy(bump.repeat);
  normal.offset.copy(bump.offset);
  normal.center.copy(bump.center);
  normal.rotation = bump.rotation;
  normal.updateMatrix();
  return normal;
}
