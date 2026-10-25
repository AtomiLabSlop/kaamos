import { BufferGeometry, Matrix4, Mesh, Object3D, Vector3 } from 'three';

/**
 * The volume centroid of an object, in the object's own local frame.
 *
 * Closed meshes (every edge shared by two triangles) are weighted by the volume
 * they enclose, so a hollow bottle shell, its liquid, its cork and its cap
 * combine into the centre of the material. Where nothing is closed (a label, a
 * sheet), the surface-area centroid stands in, and with no triangles at all the
 * object's own origin is returned. Triangles are visited once per call, so the
 * caller should keep the result for as long as the selection lasts.
 */
export function volumeCentroidLocal(root: Object3D): Vector3 {
  root.updateWorldMatrix(true, true);
  const toLocal = new Matrix4().copy(root.matrixWorld).invert();
  const meshToRoot = new Matrix4();

  let closedVolume = 0;
  const closedMoment = new Vector3();
  let surfaceArea = 0;
  const surfaceMoment = new Vector3();

  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.geometry || !isVisibleChain(mesh)) return;
    meshToRoot.multiplyMatrices(toLocal, mesh.matrixWorld);
    const part = measure(mesh.geometry, meshToRoot);
    if (!part) return;
    surfaceArea += part.area;
    surfaceMoment.addScaledVector(part.surfaceCentroid, part.area);
    if (part.closed && part.volume > 0) {
      closedVolume += part.volume;
      closedMoment.addScaledVector(part.volumeCentroid, part.volume);
    }
  });

  if (closedVolume > 0) return closedMoment.divideScalar(closedVolume);
  if (surfaceArea > 0) return surfaceMoment.divideScalar(surfaceArea);
  return new Vector3();
}

function isVisibleChain(object: Object3D) {
  let current: Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

const QUANT_BITS = 17;
const QUANT_LEVELS = 2 ** QUANT_BITS - 1;

interface Measured {
  volume: number;
  volumeCentroid: Vector3;
  area: number;
  surfaceCentroid: Vector3;
  closed: boolean;
}

function measure(geometry: BufferGeometry, matrix: Matrix4): Measured | null {
  const position = geometry.getAttribute('position');
  if (!position || position.count < 3) return null;
  const index = geometry.getIndex();
  const triangleCount = Math.floor((index ? index.count : position.count) / 3);
  if (triangleCount === 0) return null;

  // Vertices into the frame of the root, once each.
  const e = matrix.elements;
  const count = position.count;
  const vertices = new Float64Array(count * 3);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const tx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const ty = e[1] * x + e[5] * y + e[9] * z + e[13];
    const tz = e[2] * x + e[6] * y + e[10] * z + e[14];
    vertices[i * 3] = tx;
    vertices[i * 3 + 1] = ty;
    vertices[i * 3 + 2] = tz;
    if (tx < minX) minX = tx; if (tx > maxX) maxX = tx;
    if (ty < minY) minY = ty; if (ty > maxY) maxY = ty;
    if (tz < minZ) minZ = tz; if (tz > maxZ) maxZ = tz;
  }

  // Merge vertices that sit at the same place (exported meshes split vertices
  // along sharp edges), so that edges can be matched across those splits.
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const spanZ = maxZ - minZ || 1;
  const welded = new Int32Array(count);
  const ids = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const qx = Math.round(((vertices[i * 3] - minX) / spanX) * QUANT_LEVELS);
    const qy = Math.round(((vertices[i * 3 + 1] - minY) / spanY) * QUANT_LEVELS);
    const qz = Math.round(((vertices[i * 3 + 2] - minZ) / spanZ) * QUANT_LEVELS);
    const key = (qx * (QUANT_LEVELS + 1) + qy) * (QUANT_LEVELS + 1) + qz;
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    welded[i] = id;
  }

  // Reference point near the mesh, so that large coordinates do not cancel.
  const ox = vertices[0];
  const oy = vertices[1];
  const oz = vertices[2];

  const edges = new Map<number, number>();
  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    const key = a < b ? a * 4194304 + b : b * 4194304 + a;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  };

  let signedVolume = 0;
  let vx = 0, vy = 0, vz = 0;
  let area = 0;
  let sx = 0, sy = 0, sz = 0;

  for (let t = 0; t < triangleCount; t++) {
    const ia = index ? index.getX(t * 3) : t * 3;
    const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    const ax = vertices[ia * 3] - ox, ay = vertices[ia * 3 + 1] - oy, az = vertices[ia * 3 + 2] - oz;
    const bx = vertices[ib * 3] - ox, by = vertices[ib * 3 + 1] - oy, bz = vertices[ib * 3 + 2] - oz;
    const cx = vertices[ic * 3] - ox, cy = vertices[ic * 3 + 1] - oy, cz = vertices[ic * 3 + 2] - oz;

    // Signed volume of the tetrahedron from the reference point to the triangle.
    const crossX = by * cz - bz * cy;
    const crossY = bz * cx - bx * cz;
    const crossZ = bx * cy - by * cx;
    const v = (ax * crossX + ay * crossY + az * crossZ) / 6;
    signedVolume += v;
    vx += (v * (ax + bx + cx)) / 4;
    vy += (v * (ay + by + cy)) / 4;
    vz += (v * (az + bz + cz)) / 4;

    // Triangle area, for the surface fallback.
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const wx = cx - ax, wy = cy - ay, wz = cz - az;
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const a = 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
    area += a;
    sx += (a * (ax + bx + cx)) / 3;
    sy += (a * (ay + by + cy)) / 3;
    sz += (a * (az + bz + cz)) / 3;

    addEdge(welded[ia], welded[ib]);
    addEdge(welded[ib], welded[ic]);
    addEdge(welded[ic], welded[ia]);
  }

  // Closed when (almost) every edge is shared by exactly two triangles.
  let open = 0;
  for (const uses of edges.values()) if (uses !== 2) open++;
  const closed = edges.size > 0 && open / edges.size < 0.005;

  const volume = Math.abs(signedVolume);
  return {
    volume,
    volumeCentroid:
      signedVolume !== 0
        ? new Vector3(vx / signedVolume + ox, vy / signedVolume + oy, vz / signedVolume + oz)
        : new Vector3(ox, oy, oz),
    area,
    surfaceCentroid:
      area > 0 ? new Vector3(sx / area + ox, sy / area + oy, sz / area + oz) : new Vector3(ox, oy, oz),
    closed,
  };
}
