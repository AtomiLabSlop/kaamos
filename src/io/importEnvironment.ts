import {
  DataTexture,
  DataUtils,
  EquirectangularReflectionMapping,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  RGBAFormat,
} from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { registry } from '../scene/registry';
import { uid } from '../lib/util';

/**
 * Custom environment maps.
 *
 * Radiance (.hdr) and OpenEXR (.exr) both carry the high dynamic range that
 * makes an environment usable as a light source, so both are parsed here from
 * bytes — no network fetch, and the bytes are kept so the map can be embedded
 * in a project file.
 *
 * Size is the trap. An 8K map is ~30 M pixels; decoding it the usual way (a
 * Blob copy, a fetch copy, the RGBE bytes, then half floats) held over 600 MB
 * at once, and everything downstream — the GPU upload, the prefiltered
 * reflection map, the path tracer's importance table built on the main thread —
 * scales with the pixel count. The page stopped responding for minutes, or the
 * tab crashed. So maps are limited to MAX_ENV_WIDTH: a Radiance file is decoded
 * one scanline at a time straight into the reduced size, and an EXR is reduced
 * right after decoding. Lighting and reflections gain nothing visible above
 * 4096 pixels across.
 */

const MAX_ENV_WIDTH = 4096;

export const ENVIRONMENT_ACCEPT = '.hdr,.exr';
const MAX_ENV_BYTES = 256 * 1024 * 1024;

export class EnvironmentImportError extends Error {}

/** Power-of-two reduction that brings `width` to MAX_ENV_WIDTH or below. */
function reductionFor(width: number) {
  let k = 1;
  while (width / k > MAX_ENV_WIDTH) k *= 2;
  return k;
}

function halfTexture(data: Uint16Array, width: number, height: number, flipY: boolean) {
  const texture = new DataTexture(data, width, height, RGBAFormat, HalfFloatType);
  texture.colorSpace = LinearSRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = flipY;
  return texture;
}

/**
 * Radiance RGBE, decoded scanline by scanline and box-filtered on the fly, so
 * memory holds the file and the reduced map, never the full-size image.
 */
function decodeRadiance(bytes: ArrayBuffer): DataTexture {
  const u8 = new Uint8Array(bytes);
  let pos = 0;
  const line = () => {
    let text = '';
    while (pos < u8.length && u8[pos] !== 0x0a) text += String.fromCharCode(u8[pos++]);
    pos += 1;
    return text;
  };
  const magic = line();
  if (!magic.startsWith('#?')) throw new Error('Missing Radiance header.');
  let format = '';
  for (let guard = 0; guard < 200; guard += 1) {
    const entry = line();
    if (entry === '') break;
    if (entry.startsWith('FORMAT=')) format = entry.slice(7).trim();
  }
  if (format && format !== '32-bit_rle_rgbe') throw new Error(`Unsupported Radiance format "${format}".`);
  const size = /^-Y\s+(\d+)\s+\+X\s+(\d+)$/.exec(line().trim());
  if (!size) throw new Error('Only top-to-bottom, left-to-right Radiance files are supported.');
  const height = Number(size[1]);
  const width = Number(size[2]);
  if (!(width > 0 && height > 0)) throw new Error('The image has no size.');

  const k = reductionFor(width);
  const outW = Math.max(1, Math.floor(width / k));
  const outH = Math.max(1, Math.floor(height / k));
  const out = new Uint16Array(outW * outH * 4);
  const acc = new Float32Array(outW * 3);
  const scan = new Uint8Array(width * 4);
  const weight = 1 / (k * k);
  const one = DataUtils.toHalfFloat(1);

  for (let y = 0; y < height; y += 1) {
    // One scanline into `scan` as interleaved RGBE.
    if (width >= 8 && width < 0x8000 && u8[pos] === 2 && u8[pos + 1] === 2 && ((u8[pos + 2] << 8) | u8[pos + 3]) === width) {
      pos += 4;
      for (let c = 0; c < 4; c += 1) {
        let x = 0;
        while (x < width) {
          let count = u8[pos++];
          if (count > 128) {
            count -= 128;
            const value = u8[pos++];
            for (let i = 0; i < count; i += 1) scan[(x++) * 4 + c] = value;
          } else {
            for (let i = 0; i < count; i += 1) scan[(x++) * 4 + c] = u8[pos++];
          }
          if (pos > u8.length) throw new Error('The file ends early.');
        }
      }
    } else {
      if (pos + width * 4 > u8.length) throw new Error('The file ends early.');
      scan.set(u8.subarray(pos, pos + width * 4));
      pos += width * 4;
    }

    const oy = Math.floor(y / k);
    if (oy >= outH) continue;
    for (let x = 0; x < outW * k; x += 1) {
      const e = scan[x * 4 + 3];
      if (e === 0) continue;
      const f = 2 ** (e - 136);
      const o = Math.floor(x / k) * 3;
      acc[o] += scan[x * 4] * f;
      acc[o + 1] += scan[x * 4 + 1] * f;
      acc[o + 2] += scan[x * 4 + 2] * f;
    }
    if (y % k === k - 1) {
      for (let x = 0; x < outW; x += 1) {
        const o = (oy * outW + x) * 4;
        out[o] = DataUtils.toHalfFloat(acc[x * 3] * weight);
        out[o + 1] = DataUtils.toHalfFloat(acc[x * 3 + 1] * weight);
        out[o + 2] = DataUtils.toHalfFloat(acc[x * 3 + 2] * weight);
        out[o + 3] = one;
      }
      acc.fill(0);
    }
  }
  return halfTexture(out, outW, outH, true);
}

/** OpenEXR through three's decoder (half float RGBA), then reduced if too wide. */
function decodeExr(bytes: ArrayBuffer): DataTexture {
  const loader = new EXRLoader();
  loader.setDataType(HalfFloatType);
  const parsed = loader.parse(bytes) as { width: number; height: number; data: Uint16Array; flipY?: boolean };
  const { width, height, data } = parsed;
  const k = reductionFor(width);
  if (k === 1) return halfTexture(data, width, height, parsed.flipY ?? false);
  const outW = Math.floor(width / k);
  const outH = Math.max(1, Math.floor(height / k));
  const out = new Uint16Array(outW * outH * 4);
  const weight = 1 / (k * k);
  for (let oy = 0; oy < outH; oy += 1) {
    for (let ox = 0; ox < outW; ox += 1) {
      const sum = [0, 0, 0, 0];
      for (let dy = 0; dy < k; dy += 1) {
        const row = (oy * k + dy) * width;
        for (let dx = 0; dx < k; dx += 1) {
          const i = (row + ox * k + dx) * 4;
          for (let c = 0; c < 4; c += 1) sum[c] += DataUtils.fromHalfFloat(data[i + c]);
        }
      }
      const o = (oy * outW + ox) * 4;
      for (let c = 0; c < 4; c += 1) out[o + c] = DataUtils.toHalfFloat(sum[c] * weight);
    }
  }
  return halfTexture(out, outW, outH, parsed.flipY ?? false);
}

export type EnvironmentFormat = 'hdr' | 'exr';

export function environmentFormatFromName(name: string): EnvironmentFormat | null {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'hdr') return 'hdr';
  if (ext === 'exr') return 'exr';
  return null;
}

export interface ImportedEnvironment {
  key: string;
  name: string;
}

export async function importEnvironmentFromBytes(
  bytes: ArrayBuffer,
  fileName: string,
  options: { key?: string; store?: boolean } = {},
): Promise<ImportedEnvironment> {
  const format = environmentFormatFromName(fileName);
  if (!format) {
    throw new EnvironmentImportError(
      `"${fileName}" is not a supported environment. Upload a .hdr or .exr file.`,
    );
  }
  if (bytes.byteLength === 0) {
    throw new EnvironmentImportError(`"${fileName}" is empty.`);
  }
  if (bytes.byteLength > MAX_ENV_BYTES) {
    throw new EnvironmentImportError(
      `"${fileName}" is larger than the ${Math.round(MAX_ENV_BYTES / 1024 / 1024)} MB limit.`,
    );
  }

  let texture: DataTexture;
  try {
    texture = format === 'hdr' ? decodeRadiance(bytes) : decodeExr(bytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new EnvironmentImportError(
      `"${fileName}" could not be read as ${format.toUpperCase()}. ${detail || 'The file may be corrupted.'}`,
    );
  }

  texture.mapping = EquirectangularReflectionMapping;
  texture.needsUpdate = true;

  const key = options.key ?? uid('env');
  registry.putEnvTexture(
    key,
    texture,
    options.store === false ? undefined : bytes,
    fileName,
  );

  return { key, name: fileName };
}

export async function importEnvironmentFile(file: File): Promise<ImportedEnvironment> {
  const bytes = await file.arrayBuffer();
  return importEnvironmentFromBytes(bytes, file.name);
}
