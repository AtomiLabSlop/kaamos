import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute, Vector3 } from 'three';

/**
 * Turns parts that were modelled inside-out the right way round.
 *
 * Rhino and most CAD viewers draw both sides of a surface, so a panel whose
 * faces point into the car looks fine there. Kaamos draws the front side only,
 * so such a panel looks missing. Triangles are grouped into connected pieces
 * (by shared positions, so a mesh holding several parts is judged part by part)
 * and each piece is judged on its own:
 *
 * - a closed piece is inside-out when the volume it encloses comes out negative;
 * - an open piece (a side panel is just a sheet) has no volume, so it is judged
 *   by whether most of its area faces away from the middle of the model. This is
 *   a heuristic and is deliberately cautious: only a clear majority flips it.
 *
 * Returns the number of pieces turned. Winding and the stored normals are both
 * reversed, so shading stays consistent.
 */
export function fixOrientation(
  geometry: BufferGeometry,
  centre: Vector3,
): { pieces: number; flipped: number } {
  const position = geometry.getAttribute('position');
  if (!position || position.count < 3) return { pieces: 0, flipped: 0 };
  const index = geometry.getIndex();
  const triangleCount = Math.floor((index ? index.count : position.count) / 3);
  if (triangleCount === 0) return { pieces: 0, flipped: 0 };

  const vertexAt = (t: number, corner: number) => (index ? index.getX(t * 3 + corner) : t * 3 + corner);
  const count = position.count;

  // Vertices that sit at the same place count as one.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const levels = 2 ** 17 - 1;
  const sx = (maxX - minX) || 1, sy = (maxY - minY) || 1, sz = (maxZ - minZ) || 1;
  const welded = new Int32Array(count);
  const ids = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const qx = Math.round(((position.getX(i) - minX) / sx) * levels);
    const qy = Math.round(((position.getY(i) - minY) / sy) * levels);
    const qz = Math.round(((position.getZ(i) - minZ) / sz) * levels);
    const key = (qx * (levels + 1) + qy) * (levels + 1) + qz;
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    welded[i] = id;
  }
  const weldedCount = ids.size;
  ids.clear();

  // Union-find over welded vertices: triangles sharing a vertex are one piece.
  const parent = new Int32Array(weldedCount);
  for (let i = 0; i < weldedCount; i++) parent[i] = i;
  const find = (a: number) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  for (let t = 0; t < triangleCount; t++) {
    const a = find(welded[vertexAt(t, 0)]);
    const b = find(welded[vertexAt(t, 1)]);
    const c = find(welded[vertexAt(t, 2)]);
    if (a !== b) parent[b] = a;
    const root = find(a);
    if (root !== c) parent[find(c)] = root;
  }

  // Per piece: enclosed volume, outward score, and how many edges are not shared by exactly two triangles.
  interface Piece {
    volume: number;
    facing: number;
    area: number;
    edges: number;
    openEdges: number;
  }
  const pieces = new Map<number, Piece>();
  const edgeUse = new Map<number, number>();
  const edgeOwner = new Map<number, number>();
  const base = position.count > 0 ? [position.getX(0), position.getY(0), position.getZ(0)] : [0, 0, 0];
  const point = (v: number) => [
    position.getX(v) - base[0],
    position.getY(v) - base[1],
    position.getZ(v) - base[2],
  ];
  const triangleRoot = new Int32Array(triangleCount);

  for (let t = 0; t < triangleCount; t++) {
    const ia = vertexAt(t, 0), ib = vertexAt(t, 1), ic = vertexAt(t, 2);
    const root = find(welded[ia]);
    triangleRoot[t] = root;
    let piece = pieces.get(root);
    if (!piece) {
      piece = { volume: 0, facing: 0, area: 0, edges: 0, openEdges: 0 };
      pieces.set(root, piece);
    }
    const a = point(ia), b = point(ib), c = point(ic);
    const cx = b[1] * c[2] - b[2] * c[1];
    const cy = b[2] * c[0] - b[0] * c[2];
    const cz = b[0] * c[1] - b[1] * c[0];
    piece.volume += (a[0] * cx + a[1] * cy + a[2] * cz) / 6;

    // Area weighted normal against the direction away from the model's middle.
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const dx = (a[0] + b[0] + c[0]) / 3 + base[0] - centre.x;
    const dy = (a[1] + b[1] + c[1]) / 3 + base[1] - centre.y;
    const dz = (a[2] + b[2] + c[2]) / 3 + base[2] - centre.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    piece.facing += (nx * dx + ny * dy + nz * dz) / distance;
    piece.area += length;

    const pairs = [
      [welded[ia], welded[ib]],
      [welded[ib], welded[ic]],
      [welded[ic], welded[ia]],
    ];
    for (const [p, q] of pairs) {
      if (p === q) continue;
      const key = p < q ? p * weldedCount + q : q * weldedCount + p;
      edgeUse.set(key, (edgeUse.get(key) ?? 0) + 1);
      edgeOwner.set(key, root);
    }
  }
  for (const [key, uses] of edgeUse) {
    const piece = pieces.get(edgeOwner.get(key) as number);
    if (!piece) continue;
    piece.edges += 1;
    if (uses !== 2) piece.openEdges += 1;
  }

  const flip = new Set<number>();
  for (const [root, piece] of pieces) {
    const closed = piece.edges > 0 && piece.openEdges / piece.edges < 0.005;
    if (closed) {
      if (piece.volume < 0) flip.add(root);
    } else if (piece.area > 0 && piece.facing / piece.area < -0.3) {
      flip.add(root);
    }
  }
  if (flip.size === 0) return { pieces: pieces.size, flipped: 0 };

  // Reverse the winding of the flipped triangles and negate their normals.
  const normal = geometry.getAttribute('normal') as BufferAttribute | InterleavedBufferAttribute | undefined;
  const negated = new Uint8Array(count);
  for (let t = 0; t < triangleCount; t++) {
    if (!flip.has(triangleRoot[t])) continue;
    if (index) {
      const b = index.getX(t * 3 + 1);
      index.setX(t * 3 + 1, index.getX(t * 3 + 2));
      index.setX(t * 3 + 2, b);
    } else {
      for (const name of Object.keys(geometry.attributes)) {
        const attribute = geometry.getAttribute(name);
        for (let k = 0; k < attribute.itemSize; k++) {
          const first = attribute.getComponent(t * 3 + 1, k);
          attribute.setComponent(t * 3 + 1, k, attribute.getComponent(t * 3 + 2, k));
          attribute.setComponent(t * 3 + 2, k, first);
        }
      }
    }
    for (let corner = 0; corner < 3; corner++) negated[vertexAt(t, corner)] = 1;
  }
  if (normal) {
    for (let v = 0; v < count; v++) {
      if (!negated[v]) continue;
      normal.setXYZ(v, -normal.getX(v), -normal.getY(v), -normal.getZ(v));
    }
    normal.needsUpdate = true;
  }
  if (index) index.needsUpdate = true;
  else for (const name of Object.keys(geometry.attributes)) geometry.getAttribute(name).needsUpdate = true;
  return { pieces: pieces.size, flipped: flip.size };
}
