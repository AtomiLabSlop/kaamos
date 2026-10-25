import { registry } from '../scene/registry';
import type { TextureRef } from '../store/types';
import { uid } from '../lib/util';

/**
 * Images for material slots.
 *
 * An uploaded image is decoded once into an ImageBitmap (flipped for GL) and
 * kept in the registry beside its original bytes, so a project file can embed
 * exactly what was uploaded. Materials refer to it by key.
 */

export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp';
const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
/** Larger images are reduced on decode; the original bytes are still saved. */
const MAX_IMAGE_SIDE = 4096;

export class ImageImportError extends Error {}

function mimeFromName(name: string): string | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  return null;
}

export async function importImageFromBytes(
  bytes: ArrayBuffer,
  name: string,
  options: { key?: string; mime?: string } = {},
): Promise<TextureRef> {
  const mime = options.mime ?? mimeFromName(name);
  if (!mime) {
    throw new ImageImportError(`"${name}" is not a supported image. Use PNG, JPEG or WebP.`);
  }
  if (bytes.byteLength === 0) throw new ImageImportError(`"${name}" is empty.`);
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new ImageImportError(
      `"${name}" is larger than the ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB limit.`,
    );
  }

  const blob = new Blob([bytes], { type: mime });
  const decode = (options?: ImageBitmapOptions) =>
    createImageBitmap(blob, {
      imageOrientation: 'flipY',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
      ...options,
    });

  let bitmap: ImageBitmap;
  try {
    bitmap = await decode();
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest > MAX_IMAGE_SIDE) {
      const k = MAX_IMAGE_SIDE / longest;
      const width = Math.max(1, Math.round(bitmap.width * k));
      const height = Math.max(1, Math.round(bitmap.height * k));
      bitmap.close();
      bitmap = await decode({ resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
    }
  } catch {
    throw new ImageImportError(`"${name}" could not be read as an image.`);
  }

  const key = options.key ?? uid('img');
  registry.putImage(key, { bytes, name, mime, bitmap });
  return { key, name };
}

export async function importImageFile(file: File): Promise<TextureRef> {
  return importImageFromBytes(await file.arrayBuffer(), file.name, {
    mime: mimeFromName(file.name) ?? (file.type || undefined),
  });
}
