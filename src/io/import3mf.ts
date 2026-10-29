import { Group, Mesh, type BufferGeometry, type Material } from 'three';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';

/**
 * 3MF: a zip holding triangle meshes with their assembly structure (build
 * items and components), colours and a unit (millimetres unless the file says
 * otherwise). Z-up like CAD and printing software.
 *
 * Normals are not stored, and the loader draws every facet flat, which shows
 * every triangle of a curved part. They are rebuilt like STL's: smooth across
 * gentle angles, sharp past 30 degrees. Triangles are not reduced.
 */

/** Millimetres per unit, for the unit names the 3MF specification allows. */
const UNIT_MM: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

/** The unit the model declares, read from the start of its model part only. */
function declaredUnit(bytes: ArrayBuffer): string {
  try {
    const parts = unzipSync(new Uint8Array(bytes), {
      filter: (file) => /^3D\/.*\.model$/i.test(file.name),
    });
    for (const data of Object.values(parts)) {
      const head = new TextDecoder().decode(data.subarray(0, 4096));
      const match = head.match(/<model\b[^>]*\bunit\s*=\s*"([a-z]+)"/i);
      if (match) return match[1].toLowerCase();
    }
  } catch {
    /* the loader reports an unreadable file itself */
  }
  return 'millimeter';
}

export interface Parsed3mf {
  object: Group;
  hasColours: boolean;
  warnings: string[];
}

export function parse3mf(bytes: ArrayBuffer, displayName: string): Parsed3mf {
  const loaded = new ThreeMFLoader().parse(bytes);

  const smoothed = new Map<BufferGeometry, BufferGeometry>();
  let hasColours = false;
  let triangles = 0;
  loaded.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    // Parts built from the same object share a geometry: rebuild it once.
    let geometry = smoothed.get(mesh.geometry);
    if (!geometry) {
      const source = mesh.geometry;
      source.deleteAttribute('normal');
      geometry = toCreasedNormals(source, Math.PI / 6);
      source.dispose();
      smoothed.set(source, geometry);
    }
    mesh.geometry = geometry;
    const position = geometry.getAttribute('position');
    triangles += position ? position.count / 3 : 0;

    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list as (Material & {
      flatShading?: boolean;
      vertexColors?: boolean;
      map?: unknown;
      color?: { getHex(): number };
    })[]) {
      if ('flatShading' in material) {
        material.flatShading = false;
        material.needsUpdate = true;
      }
      if (material.vertexColors || material.map || (material.color && material.color.getHex() !== 0xffffff)) {
        hasColours = true;
      }
    }
  });
  if (triangles === 0) {
    throw new Error('The file holds no triangles.');
  }

  const warnings: string[] = [];
  const unit = declaredUnit(bytes);
  const factor = UNIT_MM[unit];
  if (factor === undefined) {
    warnings.push(`The file names the unit "${unit}", which is not known here; millimetres assumed.`);
  } else if (factor !== 1) {
    loaded.scale.multiplyScalar(factor);
    warnings.push(`The file is in ${unit}s; converted to millimetres so depth of field is measured right.`);
  }

  // Z-up to the viewport's Y-up; the turn is held on the top group.
  const root = new Group();
  root.name = displayName;
  root.add(loaded);
  root.rotation.x = -Math.PI / 2;
  return { object: root, hasColours, warnings };
}
