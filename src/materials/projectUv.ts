import {
  BufferAttribute,
  Vector3,
  type BufferGeometry,
  type InterleavedBufferAttribute,
} from 'three';
import type { MapProjection } from '../store/types';

/**
 * UV coordinates for parts that arrive without any.
 *
 * Models from CAD and from a plain OBJ export usually carry no UVs, so an image
 * has nothing to attach to. Instead of asking the user to unwrap in another
 * program, the image is projected onto the part's own bounding box — flat from
 * the front, side or top, or wrapped around the vertical axis. The result is an
 * ordinary `uv` attribute, so both render engines read it the same way.
 *
 * A model's own UVs are never lost: they are remembered the first time a part
 * is seen and put back whenever a mapping that uses them is chosen.
 */

interface UvMemory {
  original: BufferAttribute | null;
  applied: MapProjection | 'file' | null;
}

const MEMORY = 'kaamosUv';

function memoryOf(geometry: BufferGeometry): UvMemory {
  const data = geometry.userData as Record<string, UvMemory | undefined>;
  let memory = data[MEMORY];
  if (!memory) {
    const existing = geometry.getAttribute('uv');
    memory = {
      original: existing instanceof BufferAttribute ? existing : null,
      applied: existing ? 'file' : null,
    };
    data[MEMORY] = memory;
  }
  return memory;
}

/** True when the geometry came with UVs of its own. */
export const hasFileUv = (geometry: BufferGeometry) => memoryOf(geometry).original !== null;

/** Returns true when the geometry's `uv` attribute changed. */
export function applyProjection(geometry: BufferGeometry, projection: MapProjection): boolean {
  const memory = memoryOf(geometry);
  const wanted: MapProjection | 'file' =
    projection === 'auto' ? (memory.original ? 'file' : 'front') : projection;

  if (memory.applied === wanted) return false;

  if (wanted === 'file' && memory.original) {
    geometry.setAttribute('uv', memory.original);
    memory.applied = 'file';
    return true;
  }

  const position = geometry.getAttribute('position');
  if (!position) return false;

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return false;

  const size = box.getSize(new Vector3());
  const sx = size.x || 1;
  const sy = size.y || 1;
  const sz = size.z || 1;

  // Around the vertical axis through the part's own origin, which is where a
  // turntable product has its axis. The angle is fitted to the span the part
  // actually covers, so a label that wraps a quarter of the bottle gets the
  // whole image rather than a quarter of it.
  const cylinderU = wanted === 'cylinder' ? cylinderCoordinates(position) : null;

  const uv = new Float32Array(position.count * 2);
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    let u: number;
    let v: number;
    switch (wanted) {
      case 'side':
        u = (z - box.min.z) / sz;
        v = (y - box.min.y) / sy;
        break;
      case 'top':
        u = (x - box.min.x) / sx;
        v = (z - box.min.z) / sz;
        break;
      case 'cylinder':
        u = cylinderU![i];
        v = (y - box.min.y) / sy;
        break;
      default: // front
        u = (x - box.min.x) / sx;
        v = (y - box.min.y) / sy;
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }

  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  memory.applied = wanted as MapProjection;
  return true;
}

/** Angle around the Y axis for each vertex, scaled to 0..1 across the part's own span. */
function cylinderCoordinates(position: BufferAttribute | InterleavedBufferAttribute) {
  const count = position.count;
  let sx = 0;
  let sz = 0;
  for (let i = 0; i < count; i += 1) {
    sx += position.getX(i);
    sz += position.getZ(i);
  }
  // Measured from the part's mean direction, so a part crossing the ±180° seam
  // is not split in two.
  const centre = Math.atan2(sx, sz);
  const angle = new Float32Array(count);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < count; i += 1) {
    let a = Math.atan2(position.getX(i), position.getZ(i)) - centre;
    a = Math.atan2(Math.sin(a), Math.cos(a)); // wrap to -π..π
    angle[i] = a;
    if (a < lo) lo = a;
    if (a > hi) hi = a;
  }
  const span = hi - lo || 1;
  for (let i = 0; i < count; i += 1) {
    angle[i] = Math.min(1, Math.max(0, (angle[i] - lo) / span));
  }
  return angle;
}

/* ------------------------------------------------------------------ *
   Front-side-only images
 * ------------------------------------------------------------------ */

/**
 * The projection actually in force, or null when the part uses UVs from its
 * file (which carry no notion of a front).
 */
export function effectiveProjection(
  geometry: BufferGeometry,
  projection: MapProjection,
): Exclude<MapProjection, 'auto'> | null {
  if (projection !== 'auto') return projection;
  return memoryOf(geometry).original ? null : 'front';
}

/**
 * Which way the printed side of a part faces, in the part's own space — the
 * same "towards the projector" as `applyFaceSplit` uses: +Z, +X or +Y for a
 * flat projection, and for a cylinder the part's mean direction away from the
 * axis. Null when the part has no notion of a front.
 */
export function printDirection(
  geometry: BufferGeometry,
  projection: MapProjection,
): Vector3 | null {
  const mode = effectiveProjection(geometry, projection);
  if (!mode) return null;
  switch (mode) {
    case 'side':
      return new Vector3(1, 0, 0);
    case 'top':
      return new Vector3(0, 1, 0);
    case 'cylinder': {
      const data = geometry.userData as Record<string, [number, number] | undefined>;
      let mean = data.kaamosPrintMean;
      if (!mean) {
        const position = geometry.getAttribute('position');
        let sx = 0;
        let sz = 0;
        for (let i = 0; i < position.count; i += 1) {
          sx += position.getX(i);
          sz += position.getZ(i);
        }
        mean = [sx, sz];
        data.kaamosPrintMean = mean;
      }
      const length = Math.hypot(mean[0], mean[1]);
      return length > 1e-9 ? new Vector3(mean[0] / length, 0, mean[1] / length) : null;
    }
    default:
      return new Vector3(0, 0, 1);
  }
}

interface SplitMemory {
  /** The index before the split; null for a geometry that had none. */
  index: BufferAttribute | null;
  key: string | null;
}
const SPLIT = 'kaamosSplit';

function splitMemoryOf(geometry: BufferGeometry): SplitMemory {
  const data = geometry.userData as Record<string, SplitMemory | undefined>;
  let memory = data[SPLIT];
  if (!memory) {
    memory = { index: null, key: null };
    data[SPLIT] = memory;
  }
  return memory;
}

/** Whether `applyFaceSplit` can do anything for this geometry and projection. */
export const canSplitFaces = (geometry: BufferGeometry, projection: MapProjection) =>
  effectiveProjection(geometry, projection) !== null;

/**
 * Sorts the triangles into two ranges, as geometry groups: those facing the
 * projection (group 0, which takes the material with the images) and the rest
 * (group 1, plain). Facing means the face normal points towards the projector —
 * along +Z, +X or +Y for a flat projection, away from the axis for a cylinder.
 * The original index is kept, and put back when the split is switched off.
 * Returns true when anything changed.
 */
export function applyFaceSplit(
  geometry: BufferGeometry,
  enabled: boolean,
  projection: MapProjection,
): boolean {
  const memory = splitMemoryOf(geometry);
  const mode = enabled ? effectiveProjection(geometry, projection) : null;
  const key = mode;

  if (memory.key === key) return false;

  // Back to the original order before anything else.
  if (memory.key !== null) {
    geometry.setIndex(memory.index);
    memory.index = null;
  }
  geometry.clearGroups();
  memory.key = null;

  if (!mode) return true;

  const position = geometry.getAttribute('position');
  if (!position) return true;
  const index = geometry.getIndex();
  const triangles = index ? index.count / 3 : position.count / 3;
  const read = (n: number) => (index ? index.getX(n) : n);

  const facing: number[] = [];
  const rest: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const normal = new Vector3();
  const toward = new Vector3();

  for (let t = 0; t < triangles; t += 1) {
    const i0 = read(t * 3);
    const i1 = read(t * 3 + 1);
    const i2 = read(t * 3 + 2);
    a.fromBufferAttribute(position, i0);
    b.fromBufferAttribute(position, i1);
    c.fromBufferAttribute(position, i2);
    normal.subVectors(c, b).cross(a.clone().sub(b)).normalize();

    switch (mode) {
      case 'side':
        toward.set(1, 0, 0);
        break;
      case 'top':
        toward.set(0, 1, 0);
        break;
      case 'cylinder':
        toward
          .set((a.x + b.x + c.x) / 3, 0, (a.z + b.z + c.z) / 3)
          .normalize();
        break;
      default:
        toward.set(0, 0, 1);
    }

    (normal.dot(toward) > 0.25 ? facing : rest).push(i0, i1, i2);
  }

  const total = facing.length + rest.length;
  const IndexArray = index && index.array instanceof Uint16Array ? Uint16Array : Uint32Array;
  const ordered = new IndexArray(total);
  ordered.set(facing, 0);
  ordered.set(rest, facing.length);

  memory.index = index ?? null;
  geometry.setIndex(new BufferAttribute(ordered, 1));
  if (facing.length > 0) geometry.addGroup(0, facing.length, 0);
  if (rest.length > 0) geometry.addGroup(facing.length, rest.length, 1);
  memory.key = key;
  return true;
}
