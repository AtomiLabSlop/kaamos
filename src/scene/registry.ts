/**
 * Non-reactive store for GPU-backed resources and raw file bytes.
 *
 * Project state (see `store/types.ts`) refers to everything here by string
 * key. Keeping Three.js objects out of the Zustand store means project state
 * stays cloneable for undo/redo and serializable to JSON, and means a React
 * re-render never touches a GPU resource.
 */

import type { BufferGeometry, Material, Texture } from 'three';
import type { ModelFormat } from '../store/types';

export interface StoredFile {
  bytes: ArrayBuffer;
  name: string;
  format: ModelFormat;
}

const geometries = new Map<string, BufferGeometry>();
/**
 * Material that arrived with an imported file, keyed by node id. An array when
 * the mesh came in with per-group materials.
 */
const originalMaterials = new Map<string, Material | Material[]>();
const files = new Map<string, StoredFile>();
let sweepHolds = 0;
const envTextures = new Map<string, Texture>();

/** An image uploaded for a material slot. The bytes are what a project embeds. */
export interface StoredImage {
  bytes: ArrayBuffer;
  name: string;
  mime: string;
  /** Decoded once; every slot's texture shares it. Flipped for GL on decode. */
  bitmap: ImageBitmap;
}
const images = new Map<string, StoredImage>();
/** Raw bytes of an uploaded HDR, so it can be embedded in a project file. */
const envFiles = new Map<string, { bytes: ArrayBuffer; name: string }>();

export const registry = {
  /* ---- geometry ---- */
  putGeometry(key: string, geometry: BufferGeometry) {
    const existing = geometries.get(key);
    if (existing && existing !== geometry) existing.dispose();
    geometries.set(key, geometry);
  },
  getGeometry(key: string | undefined) {
    return key ? geometries.get(key) : undefined;
  },
  hasGeometry(key: string) {
    return geometries.has(key);
  },

  /* ---- materials that came in with a file ---- */
  putOriginalMaterial(nodeId: string, material: Material | Material[]) {
    originalMaterials.set(nodeId, material);
  },
  getOriginalMaterial(nodeId: string) {
    return originalMaterials.get(nodeId);
  },

  /* ---- source files, embedded when a project is saved ---- */
  putFile(key: string, file: StoredFile) {
    files.set(key, file);
  },
  getFile(key: string | undefined) {
    return key ? files.get(key) : undefined;
  },

  /* ---- environment textures ---- */
  putEnvTexture(key: string, texture: Texture, bytes?: ArrayBuffer, name?: string) {
    const existing = envTextures.get(key);
    if (existing && existing !== texture) existing.dispose();
    envTextures.set(key, texture);
    if (bytes && name) envFiles.set(key, { bytes, name });
  },
  getEnvTexture(key: string | null | undefined) {
    return key ? envTextures.get(key) : undefined;
  },
  getEnvFile(key: string | null | undefined) {
    return key ? envFiles.get(key) : undefined;
  },

  /* ---- material images ---- */
  putImage(key: string, image: StoredImage) {
    const existing = images.get(key);
    if (existing && existing !== image) existing.bitmap.close();
    images.set(key, image);
  },
  getImage(key: string | null | undefined) {
    return key ? images.get(key) : undefined;
  },

  /**
   * Release everything not reachable from the given key sets. Called after
   * undo history is trimmed, so a geometry stays alive while any reachable
   * history entry still refers to it.
   */
  /**
   * While something is being imported or opened, what it has registered is not
   * in any project state yet, so a sweep would free it. Hold sweeping for the
   * duration and release afterwards (a later edit sweeps again).
   */
  hold() {
    sweepHolds += 1;
  },
  release() {
    sweepHolds = Math.max(0, sweepHolds - 1);
  },

  sweep(live: {
    geometryKeys: Set<string>;
    nodeIds: Set<string>;
    fileKeys: Set<string>;
    envKeys: Set<string>;
    imageKeys: Set<string>;
  }) {
    if (sweepHolds > 0) return;
    let freed = 0;

    for (const [key, geometry] of geometries) {
      if (!live.geometryKeys.has(key)) {
        geometry.dispose();
        geometries.delete(key);
        freed += 1;
      }
    }

    const doomed = new Set<Material>();
    for (const [nodeId, material] of originalMaterials) {
      if (!live.nodeIds.has(nodeId)) {
        for (const m of flatten(material)) doomed.add(m);
        originalMaterials.delete(nodeId);
      }
    }
    // A glTF material can be shared between meshes; only dispose one that no
    // surviving node still points at.
    const stillUsed = new Set<Material>();
    for (const material of originalMaterials.values()) {
      for (const m of flatten(material)) stillUsed.add(m);
    }
    for (const material of doomed) {
      if (!stillUsed.has(material)) {
        disposeMaterial(material);
        freed += 1;
      }
    }

    for (const key of files.keys()) {
      if (!live.fileKeys.has(key)) files.delete(key);
    }

    for (const [key, texture] of envTextures) {
      if (!live.envKeys.has(key)) {
        texture.dispose();
        envTextures.delete(key);
        envFiles.delete(key);
        freed += 1;
      }
    }

    for (const [key, image] of images) {
      if (!live.imageKeys.has(key)) {
        image.bitmap.close();
        images.delete(key);
        freed += 1;
      }
    }

    return freed;
  },

  stats() {
    return {
      geometries: geometries.size,
      materials: originalMaterials.size,
      files: files.size,
      envTextures: envTextures.size,
      images: images.size,
    };
  },

  disposeAll() {
    for (const geometry of geometries.values()) geometry.dispose();
    geometries.clear();
    const unique = new Set<Material>();
    for (const material of originalMaterials.values()) {
      for (const m of flatten(material)) unique.add(m);
    }
    for (const material of unique) disposeMaterial(material);
    originalMaterials.clear();
    files.clear();
    for (const texture of envTextures.values()) texture.dispose();
    envTextures.clear();
    envFiles.clear();
    for (const image of images.values()) image.bitmap.close();
    images.clear();
  },
};

const flatten = (material: Material | Material[]): Material[] =>
  Array.isArray(material) ? material : [material];

/** Dispose a material and any texture it holds. */
export function disposeMaterial(material: Material) {
  const bag = material as unknown as Record<string, unknown>;
  for (const value of Object.values(bag)) {
    if (value && typeof value === 'object' && 'isTexture' in value) {
      (value as Texture).dispose();
    }
  }
  material.dispose();
}
