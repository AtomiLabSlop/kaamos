import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';

/**
 * Textures generated in the browser for the studio environment.
 *
 * All of them are cached: the environment map is rebuilt whenever the rig or
 * colour temperature changes, and regenerating identical canvases each time
 * would be wasted work.
 */

const cache = new Map<string, CanvasTexture>();

function finish(key: string, canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  cache.set(key, texture);
  return texture;
}

/**
 * A vertical two-stop gradient, used for the environment dome and for the
 * gradient viewport background. Tall enough that a mirror finish reflecting the
 * dome shows a smooth ramp rather than visible steps.
 */
export function gradientTexture(top: string, bottom: string): CanvasTexture {
  const key = `grad|${top}|${bottom}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  return finish(key, canvas);
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * The luminance profile of a light panel.
 *
 * A real softbox is brightest in the middle and falls off towards its edges,
 * and that falloff is most of what makes a highlight on a curved surface read
 * as a photographic one. A flat rectangle with hard edges reflects as a white
 * box with a visible outline, which is the single clearest giveaway of a
 * synthetic studio. The `edge` parameter sets how far in the rolloff starts —
 * small values make a crisp panel, large values a very diffuse one.
 */
export function panelTexture(
  shape: 'rect' | 'circle' = 'rect',
  edge = 0.55,
): CanvasTexture {
  const key = `panel|${shape}|${edge}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    const image = ctx.createImageData(size, size);
    const data = image.data;
    const inner = 1 - edge;

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        // Normalized to [-1, 1] across the panel.
        const u = ((x + 0.5) / size) * 2 - 1;
        const v = ((y + 0.5) / size) * 2 - 1;

        let falloff: number;
        if (shape === 'circle') {
          falloff = 1 - smoothstep(inner, 1, Math.hypot(u, v));
        } else {
          falloff =
            (1 - smoothstep(inner, 1, Math.abs(u))) *
            (1 - smoothstep(inner, 1, Math.abs(v)));
        }

        // A gentle hotspot towards the middle, as a diffuser panel has.
        const radius = Math.min(Math.hypot(u, v), 1);
        const value = falloff * (0.86 + 0.14 * (1 - radius * radius));

        const byte = Math.round(Math.min(Math.max(value, 0), 1) * 255);
        const index = (y * size + x) * 4;
        data[index] = byte;
        data[index + 1] = byte;
        data[index + 2] = byte;
        data[index + 3] = 255;
      }
    }

    ctx.putImageData(image, 0, 0);
  }

  return finish(key, canvas);
}

export function disposeGradientTextures() {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}
