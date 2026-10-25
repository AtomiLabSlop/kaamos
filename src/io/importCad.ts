import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SRGBColorSpace,
  type Material,
} from 'three';
import type { OcctMesh, OcctNode, OcctParams, OcctResult } from 'occt-import-js';
import type { OcctRequest, OcctResponse } from './occtWorker';

/**
 * STEP and IGES import.
 *
 * CAD files describe surfaces mathematically rather than as triangles, so they
 * have to be tessellated before anything can draw them. That is what
 * OpenCascade does here, through its WebAssembly build.
 *
 * Tessellation density is the decision that matters: too coarse and a fillet
 * shows its facets, too fine and a modest assembly arrives with millions of
 * triangles. `CAD_DETAILS` below is the one place to tune it. The linear
 * deflection is a ratio of the model's bounding box, so it adapts to scale on
 * its own — the same setting suits a watch case and a washing machine.
 */

export type CadFormat = 'step' | 'iges';

export const CAD_EXTENSIONS = ['stp', 'step', 'igs', 'iges'] as const;

/**
 * How densely a CAD surface is cut into triangles. Chosen by the user at
 * import, because the right answer depends on the job (see README).
 *
 * Measured on the example bottle: Standard 73k triangles in about 3.6 s,
 * Fine 215k in about 11 s (the cost grows faster than the triangle count).
 * A third step at 0.05 rad gave 854k triangles and about 100 s, which is
 * too slow to offer.
 */
export type CadDetail = 'standard' | 'fine';

export const CAD_DETAIL_DEFAULT: CadDetail = 'standard';

export const CAD_DETAILS: Record<CadDetail, { label: string; params: OcctParams }> = {
  standard: {
    label: 'Standard',
    params: {
      linearUnit: 'millimeter',
      linearDeflectionType: 'bounding_box_ratio',
      // Roughly one part in two thousand of the model's size: fine enough that
      // a cylinder reads as round under a sharp reflection.
      linearDeflection: 0.0005,
      // About 14 degrees between adjacent facet normals.
      angularDeflection: 0.25,
    },
  },
  fine: {
    label: 'Fine',
    params: {
      linearUnit: 'millimeter',
      linearDeflectionType: 'bounding_box_ratio',
      linearDeflection: 0.0005,
      // About 6 degrees between adjacent facet normals. Curved glass in a
      // path-traced render shows faceting that Standard hides.
      angularDeflection: 0.1,
    },
  },
};

/** Reads a stored value from a project file, falling back for older ones. */
export const asCadDetail = (value: unknown): CadDetail =>
  value === 'fine' ? 'fine' : 'standard';

/** Models above this take long enough that the wait is worth mentioning. */
export const CAD_SLOW_FILE_BYTES = 8 * 1024 * 1024;

export class CadImportError extends Error {}

export function cadFormatFromExtension(ext: string): CadFormat | null {
  if (ext === 'stp' || ext === 'step') return 'step';
  if (ext === 'igs' || ext === 'iges') return 'iges';
  return null;
}

/**
 * Runs one import in its own worker and shuts it down afterwards.
 *
 * A fresh worker each time costs a WebAssembly instantiation — cheap, since
 * the browser caches the compiled module — and in return OpenCascade's heap,
 * which a large assembly can push into the hundreds of megabytes, is handed
 * back as soon as the import finishes.
 */
function runInWorker(
  bytes: ArrayBuffer,
  format: CadFormat,
  params: OcctParams,
): Promise<OcctResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./occtWorker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (error) {
      reject(
        new CadImportError(
          `The CAD reader could not start. ${error instanceof Error ? error.message : ''}`.trim(),
        ),
      );
      return;
    }

    const finish = (fn: () => void) => {
      worker.terminate();
      fn();
    };

    worker.onmessage = (event: MessageEvent<OcctResponse>) => {
      const data = event.data;
      if (data.ok) finish(() => resolve(data.result));
      else finish(() => reject(new CadImportError(data.error)));
    };

    worker.onerror = (event) => {
      finish(() =>
        reject(new CadImportError(event.message || 'The CAD reader failed to load.')),
      );
    };

    // A copy is transferred so the caller keeps its own bytes, which the
    // project file needs in order to embed the original.
    const copy = bytes.slice(0);
    const request: OcctRequest = { bytes: copy, format, params };
    worker.postMessage(request, [copy]);
  });
}

function toColour(rgb: [number, number, number]) {
  // OpenCascade reports authored colours, so they are display-referred.
  return new Color().setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace);
}

const makeMaterial = (colour: Color | null) =>
  new MeshStandardMaterial({
    color: colour ?? new Color(0xb9bdc1),
    roughness: 0.45,
    metalness: 0,
  });

/**
 * Builds geometry for one solid, splitting it into groups where the source
 * B-rep gives its faces different colours — which is how most assemblies carry
 * their colour coding.
 */
function toMesh(occtMesh: OcctMesh, index: number): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(occtMesh.attributes.position.array, 3),
  );
  if (occtMesh.attributes.normal) {
    geometry.setAttribute(
      'normal',
      new Float32BufferAttribute(occtMesh.attributes.normal.array, 3),
    );
  }
  geometry.setIndex(occtMesh.index.array);
  if (!occtMesh.attributes.normal) geometry.computeVertexNormals();

  const meshColour = occtMesh.color ? toColour(occtMesh.color) : null;
  const faces = occtMesh.brep_faces ?? [];
  const faceColours = faces.filter((face) => face.color !== null);

  let material: Material | Material[];

  const distinct = new Set(
    faceColours.map((face) => (face.color as number[]).join(',')),
  );

  if (faceColours.length > 0 && distinct.size > 1) {
    // Merge neighbouring faces that share a colour, so a part with hundreds of
    // faces does not become hundreds of draw calls.
    const materials: Material[] = [];
    const byColour = new Map<string, number>();
    let runKey: string | null = null;
    let runStart = 0;
    let runEnd = -1;

    const flush = () => {
      if (runKey === null || runEnd < runStart) return;
      let slot = byColour.get(runKey);
      if (slot === undefined) {
        const rgb = runKey.split(',').map(Number) as [number, number, number];
        slot = materials.length;
        materials.push(makeMaterial(runKey === 'none' ? meshColour : toColour(rgb)));
        byColour.set(runKey, slot);
      }
      geometry.addGroup(runStart * 3, (runEnd - runStart + 1) * 3, slot);
    };

    for (const face of faces) {
      const key = face.color ? face.color.join(',') : 'none';
      if (key === runKey && face.first === runEnd + 1) {
        runEnd = face.last;
        continue;
      }
      flush();
      runKey = key;
      runStart = face.first;
      runEnd = face.last;
    }
    flush();

    material = materials.length > 0 ? materials : makeMaterial(meshColour);
  } else {
    const only = faceColours[0]?.color;
    material = makeMaterial(meshColour ?? (only ? toColour(only) : null));
  }

  const mesh = new Mesh(geometry, material);
  mesh.name = occtMesh.name?.trim() || `Solid ${index + 1}`;
  return mesh;
}

function buildTree(node: OcctNode, meshes: Mesh[], depth = 0): Object3D {
  const group = new Group();
  group.name = node.name?.trim() || (depth === 0 ? 'Assembly' : 'Component');

  for (const index of node.meshes ?? []) {
    const mesh = meshes[index];
    // A solid referenced from two places in an assembly needs its own object.
    group.add(mesh.parent ? (mesh.clone() as Mesh) : mesh);
  }
  for (const child of node.children ?? []) {
    group.add(buildTree(child, meshes, depth + 1));
  }

  return group;
}

export interface CadParseResult {
  object: Object3D;
  warnings: string[];
  /** False when the file carried no colour at all, so a material is assigned. */
  hasColours: boolean;
  triangles: number;
}

export async function parseCadFile(
  bytes: ArrayBuffer,
  format: CadFormat,
  fileName: string,
  detail: CadDetail = CAD_DETAIL_DEFAULT,
): Promise<CadParseResult> {
  const result = await runInWorker(bytes, format, CAD_DETAILS[detail].params);

  if (!result.success) {
    throw new CadImportError(
      `"${fileName}" could not be read as ${format.toUpperCase()}. ` +
        'The file may be damaged, or it may use a schema OpenCascade does not support.',
    );
  }
  if (!result.meshes || result.meshes.length === 0) {
    throw new CadImportError(
      `"${fileName}" contained no solid or surface geometry. ` +
        'Files holding only curves, sketches or annotations cannot be rendered.',
    );
  }

  const meshes = result.meshes.map(toMesh);
  let triangles = 0;
  for (const mesh of meshes) {
    const index = mesh.geometry.getIndex();
    triangles += index ? index.count / 3 : 0;
  }

  const hasColours = result.meshes.some(
    (mesh) => mesh.color || (mesh.brep_faces ?? []).some((face) => face.color),
  );

  const warnings: string[] = [];
  if (triangles > 2_000_000) {
    warnings.push(
      `Tessellated to ${Math.round(triangles / 1000)}k triangles — large enough to slow the viewport.`,
    );
  }

  // CAD files are Z-up: the part stands along Z with its base at Z = 0. The
  // viewport is Y-up, so the model would arrive lying on its side. The turn is
  // held on the top group's rotation, where it can be seen and undone.
  const object = buildTree(result.root, meshes);
  object.rotation.x = -Math.PI / 2;

  return {
    object,
    warnings,
    hasColours,
    triangles: Math.round(triangles),
  };
}
