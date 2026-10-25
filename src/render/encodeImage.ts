import type { WebGLRenderer, WebGLRenderTarget } from 'three';

/**
 * Reading a render target back and encoding it as a PNG.
 *
 * Shared by both rendering backends, which differ in how they arrive at the
 * pixels but agree completely on what to do with them: WebGL hands back rows
 * bottom-up and colour premultiplied by alpha, and a PNG wants neither.
 */

interface AsyncReadable {
  readRenderTargetPixelsAsync?: (
    target: WebGLRenderTarget,
    x: number,
    y: number,
    width: number,
    height: number,
    buffer: Uint8Array,
  ) => Promise<Uint8Array>;
}

/**
 * Reads an 8-bit target, preferring the asynchronous path where the driver
 * offers it — a synchronous read stalls the pipeline until the GPU catches up,
 * which at output resolution is long enough to drop frames in the interface.
 */
export async function readTarget(
  gl: WebGLRenderer,
  target: WebGLRenderTarget,
  width: number,
  height: number,
  buffer: Uint8Array,
): Promise<void> {
  const readable = gl as unknown as AsyncReadable;
  if (typeof readable.readRenderTargetPixelsAsync === 'function') {
    try {
      await readable.readRenderTargetPixelsAsync(target, 0, 0, width, height, buffer);
      return;
    } catch (error) {
      /* Three rejects this with no value at all when the GPU's fence wait
         fails, which Safari does now and then; the work is still on the GPU,
         so a plain synchronous read normally succeeds. A lost context is the
         exception, and would read back as silent zeros, so say so instead. */
      if (gl.getContext().isContextLost()) {
        throw new Error('The graphics context was lost while reading the finished image.');
      }
      console.warn('Asynchronous pixel read failed, reading synchronously', error);
    }
  }
  gl.readRenderTargetPixels(target, 0, 0, width, height, buffer);
}

/**
 * Turns a bottom-up, premultiplied RGBA buffer into a PNG.
 *
 * `scale` divides the source values, which lets the raster backend pass a
 * float accumulator holding the sum of many passes and have the average taken
 * here rather than in a second loop.
 */
export async function encodePng(
  source: Float32Array | Uint8Array,
  width: number,
  height: number,
  scale = 1,
): Promise<Blob> {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const inverse = 1 / scale;

  for (let y = 0; y < height; y += 1) {
    const from = (height - 1 - y) * width * 4;
    const to = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const s = from + x * 4;
      const d = to + x * 4;
      const alpha = source[s + 3] * inverse;

      if (alpha <= 0) {
        pixels[d] = 0;
        pixels[d + 1] = 0;
        pixels[d + 2] = 0;
        pixels[d + 3] = 0;
        continue;
      }

      const unpremultiply = 255 / alpha;
      pixels[d] = source[s] * inverse * unpremultiply;
      pixels[d + 1] = source[s + 1] * inverse * unpremultiply;
      pixels[d + 2] = source[s + 2] * inverse * unpremultiply;
      pixels[d + 3] = alpha;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a 2D context to encode the image.');
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  );
  if (!blob) throw new Error('The browser could not encode the PNG.');
  return blob;
}
