import {
  Box3,
  Euler,
  LoadingManager,
  Matrix4,
  Mesh,
  Object3D,
  Vector3,
  type Material,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { fixOrientation } from './fixOrientation';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { ModelFormat, NodeId, SceneNode, Vec3 } from '../store/types';
import { libraryMaterialId, DEFAULT_MATERIAL_PRESET } from '../materials/presets';
import {
  CadImportError,
  cadFormatFromExtension,
  parseCadFile,
  type CadDetail,
} from './importCad';
import { registry } from '../scene/registry';
import { triangleCount } from '../scene/triangleCount';
import { uid } from '../lib/util';

/**
 * Model import.
 *
 * The loaded Three.js hierarchy is translated into the flat, serializable node
 * tree in `store/types.ts`; geometries and the materials that came with the
 * file move into the registry. Nothing Three.js-shaped reaches the store.
 *
 * Node ids are `<modelId>/<child index path>` — derived from structure rather
 * than names, so reimporting the same bytes under the same model id always
 * yields the same ids. That is what lets a project file store per-node edits
 * and reattach them on load.
 *
 * Adding a format means adding a case to `parseToObject3D`; nothing else here
 * is format-specific.
 */

export const SUPPORTED_EXTENSIONS = [
  'glb',
  'gltf',
  'obj',
  'stl',
  'stp',
  'step',
  'igs',
  'iges',
] as const;
/**
 * What the importer reads, in words, for messages. Kept in step with the list
 * above so no message names fewer formats than the importer accepts.
 */
export const SUPPORTED_FORMATS_TEXT = 'GLB, glTF, OBJ, STL, STEP and IGES';

/**
 * The model picker deliberately has no `accept` filter. A filter greys out
 * every file it does not list: the macOS picker greyed out `.obj` files, and
 * the `.mtl` and texture files that belong with an OBJ or glTF can never be
 * selected alongside the model. The importer checks the extension itself and
 * says plainly when a file is not one it reads.
 */
export const ACCEPT_ATTRIBUTE = '';

/** Largest single file we will try to parse, to fail clearly instead of hanging. */
const MAX_FILE_BYTES = 512 * 1024 * 1024;

/** Imported models are scaled so their largest dimension is this many units. */
const TARGET_SIZE = 1.3;

export interface ParsedModel {
  modelId: string;
  name: string;
  fileName: string;
  format: ModelFormat;
  fileKey: string;
  nodes: SceneNode[];
  rootNodeId: NodeId;
  triangles: number;
  warnings: string[];
  /** Tessellation used for a STEP or IGES file; absent for other formats. */
  cadDetail?: CadDetail;
}

export class ImportError extends Error {}

export function formatFromName(name: string): ModelFormat | null {
  const ext = name.split('.').pop()?.toLowerCase();
  if (!ext) return null;
  if (ext === 'glb') return 'glb';
  if (ext === 'gltf') return 'gltf';
  if (ext === 'obj') return 'obj';
  if (ext === 'stl') return 'stl';
  return cadFormatFromExtension(ext);
}

/** Pick the model file out of a drop that may also contain .bin and textures. */
export function pickEntryFile(files: File[]): File | null {
  const scored = files
    .map((file) => ({ file, format: formatFromName(file.name) }))
    .filter((entry): entry is { file: File; format: ModelFormat } => entry.format !== null);
  if (scored.length === 0) return null;
  const preferred = scored.find((e) => e.format === 'glb') ?? scored[0];
  return preferred.file;
}

/**
 * Companion files in the same drop are exposed to the loader as blob URLs, so a
 * .gltf dropped together with its .bin and textures resolves them.
 */
function managerFor(companions: File[]) {
  const urls = new Map<string, string>();
  for (const file of companions) {
    urls.set(file.name.toLowerCase(), URL.createObjectURL(file));
  }

  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    const base = decodeURIComponent(url.split('/').pop() ?? '').toLowerCase();
    return urls.get(base) ?? url;
  });

  return {
    manager,
    has: (name: string) => urls.has(name.toLowerCase()),
    release: () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    },
  };
}

/**
 * One shared Draco decoder, since each instance spins up worker threads.
 *
 * Three resolves the decoder's wasm and glue through `import.meta.url`, so the
 * bundler emits them as assets and they are fetched only when a compressed file
 * is actually imported. No decoder path to configure, and nothing to serve by
 * hand — which is why `setDecoderPath` is deliberately not called here.
 */
let dracoLoader: DRACOLoader | null = null;
function getDracoLoader() {
  dracoLoader ??= new DRACOLoader();
  return dracoLoader;
}

export function disposeDracoLoader() {
  dracoLoader?.dispose();
  dracoLoader = null;
}

/** Compression we cannot decode. Reported rather than failing obscurely. */
function detectBlockedExtensions(bytes: ArrayBuffer) {
  const probeLength = Math.min(bytes.byteLength, 128 * 1024);
  const text = new TextDecoder('utf-8', { fatal: false }).decode(
    new Uint8Array(bytes, 0, probeLength),
  );
  const blocked: string[] = [];
  if (text.includes('KHR_texture_basisu')) blocked.push('KTX2 / Basis compressed textures');
  return blocked;
}

interface GltfResult {
  scene: Object3D;
  parser: {
    json: { nodes?: { name?: string }[] };
    associations: Map<object, { nodes?: number }>;
  };
}

/**
 * GLTFLoader rewrites node names for its animation bindings ("Cork shank"
 * becomes "Cork_shank"). Nothing here is animated, so put the names the file
 * actually holds back for the hierarchy.
 */
function restoreGltfNames(gltf: GltfResult) {
  const nodes = gltf.parser.json.nodes ?? [];
  gltf.scene.traverse((object) => {
    const index = gltf.parser.associations.get(object)?.nodes;
    const original = index === undefined ? undefined : nodes[index]?.name;
    if (original) object.name = original;
  });
}

async function parseGltf(
  bytes: ArrayBuffer,
  format: ModelFormat,
  companions: File[],
): Promise<Object3D> {
  const blocked = detectBlockedExtensions(bytes);
  if (blocked.length > 0) {
    throw new ImportError(
      `This file uses ${blocked.join(' and ')}, which this build cannot decode. ` +
        'Re-export with uncompressed textures and import again.',
    );
  }

  const { manager, release } = managerFor(companions);
  const loader = new GLTFLoader(manager);
  loader.setDRACOLoader(getDracoLoader());
  loader.setMeshoptDecoder(MeshoptDecoder);

  try {
    const gltf = await new Promise<GltfResult>((resolve, reject) => {
      if (format === 'glb') {
        loader.parse(bytes, '', resolve, reject);
      } else {
        const json = new TextDecoder().decode(new Uint8Array(bytes));
        loader.parse(json, '', resolve, reject);
      }
    });
    restoreGltfNames(gltf);
    return gltf.scene;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/draco/i.test(detail)) {
      throw new ImportError(
        'This file is Draco-compressed and the decoder could not be loaded. ' +
          'Check your network connection and try again, or re-export the file ' +
          'without compression.',
      );
    }
    throw error;
  } finally {
    release();
  }
}

/**
 * OBJ can carry NURBS surfaces (`cstype` / `surf` records, which Rhino writes
 * when it saves surfaces "as NURBS objects"). Three's loader reads only polygon
 * faces and silently skips these. Reading them correctly would need a trimming-
 * aware tessellator, and an untrimmed guess would draw the wrong shape, so they
 * are not imported — but the user is told, rather than left with an empty scene.
 */
export function countObjNurbsSurfaces(text: string) {
  return (text.match(/^[ \t]*surf[ \t]/gm) ?? []).length;
}

async function parseObj(bytes: ArrayBuffer, companions: File[]) {
  const { manager, release } = managerFor(companions);
  const text = new TextDecoder().decode(new Uint8Array(bytes));
  const mtlFile = companions.find((f) => f.name.toLowerCase().endsWith('.mtl'));

  try {
    const loader = new OBJLoader(manager);
    let usedMtl = false;

    if (mtlFile) {
      try {
        const mtlText = await mtlFile.text();
        const materials = new MTLLoader(manager).parse(mtlText, '');
        materials.preload();
        loader.setMaterials(materials);
        usedMtl = true;
      } catch {
        // A broken .mtl should not stop the geometry from coming in.
      }
    }

    return { object: loader.parse(text), usedMtl, nurbsSurfaces: countObjNurbsSurfaces(text) };
  } finally {
    release();
  }
}

/**
 * STL is bare triangles: no names, no units, no colours, one mesh. Binary and
 * ASCII are told apart by the loader. The file stores one normal per triangle,
 * which would show every facet of a curved surface, so normals are rebuilt:
 * smooth across gentle angles, sharp past 30 degrees. STL is Z-up like CAD, so
 * the model is stood up the same way STEP is, with the turn held on the object.
 */
function parseStl(bytes: ArrayBuffer, displayName: string): Object3D {
  const parsed = new STLLoader().parse(bytes);
  const position = parsed.getAttribute('position');
  if (!position || position.count < 3) {
    throw new ImportError('The file holds no triangles.');
  }
  parsed.deleteAttribute('normal');
  const geometry = toCreasedNormals(parsed, Math.PI / 6);
  parsed.dispose();
  const mesh = new Mesh(geometry);
  mesh.name = displayName;
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

const vec = (v: Vector3): Vec3 => [v.x, v.y, v.z];

function isRenderable(object: Object3D) {
  return (object as Mesh).isMesh === true;
}

function skipped(object: Object3D) {
  const type = object.type;
  return (
    type.endsWith('Light') ||
    type.endsWith('Camera') ||
    type === 'Points' ||
    type === 'Line' ||
    type === 'LineSegments' ||
    type === 'LineLoop' ||
    type === 'Sprite' ||
    type === 'Bone'
  );
}

const checkedGeometries = new WeakSet<object>();

interface WalkContext {
  /** Middle of the whole model, in world space; the open-piece check faces away from it. */
  centre: Vector3;
  flippedPieces: number;
  modelId: string;
  nodes: SceneNode[];
  warnings: Set<string>;
  defaultMaterialId: string | null;
  triangles: number;
  meshCount: number;
}

function walk(
  object: Object3D,
  parentId: NodeId | null,
  path: string,
  ctx: WalkContext,
): NodeId | null {
  if (skipped(object)) {
    if (object.type.endsWith('Light')) ctx.warnings.add('Lights in the file were skipped.');
    if (object.type.endsWith('Camera')) ctx.warnings.add('Cameras in the file were skipped.');
    if (object.type === 'Points' || object.type.startsWith('Line')) {
      ctx.warnings.add('Point and line objects were skipped.');
    }
    return null;
  }

  const id: NodeId = `${ctx.modelId}/${path}`;
  const mesh = object as Mesh;
  const isMesh = isRenderable(object);

  if (object.type === 'SkinnedMesh') {
    ctx.warnings.add('Skinned meshes are imported in their bind pose; animation is not supported.');
  }

  let geometryKey: string | undefined;
  let triangles = 0;

  if (isMesh) {
    if (!mesh.geometry || !mesh.geometry.getAttribute('position')) {
      ctx.warnings.add(`"${object.name || path}" had no geometry and was skipped.`);
      return null;
    }
    if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
    // Parts modelled inside-out would be invisible (only front faces are drawn).
    const local = ctx.centre.clone().applyMatrix4(new Matrix4().copy(mesh.matrixWorld).invert());
    if (!checkedGeometries.has(mesh.geometry)) {
      checkedGeometries.add(mesh.geometry);
      ctx.flippedPieces += fixOrientation(mesh.geometry, local).flipped;
    }
    geometryKey = `${id}#geo`;
    registry.putGeometry(geometryKey, mesh.geometry);
    triangles = triangleCount(mesh.geometry);
    ctx.triangles += triangles;
    ctx.meshCount += 1;
    if (mesh.material) {
      registry.putOriginalMaterial(id, mesh.material as Material | Material[]);
    }
  }

  const euler = new Euler().setFromQuaternion(object.quaternion, 'XYZ');

  const node: SceneNode = {
    id,
    modelId: ctx.modelId,
    parentId,
    childIds: [],
    name: object.name?.trim() || (isMesh ? `Mesh ${ctx.meshCount}` : 'Group'),
    kind: isMesh ? 'mesh' : 'group',
    visible: object.visible !== false,
    position: vec(object.position),
    rotation: [euler.x, euler.y, euler.z],
    scale: vec(object.scale),
    materialId: isMesh ? ctx.defaultMaterialId : null,
    ...(geometryKey ? { geometryKey, triangles } : {}),
  };

  ctx.nodes.push(node);

  object.children.forEach((child, index) => {
    const childId = walk(child, id, `${path}.${index}`, ctx);
    if (childId) node.childIds.push(childId);
  });

  // A group that contributed nothing renderable is not worth a tree row.
  if (!isMesh && node.childIds.length === 0) {
    ctx.nodes.splice(ctx.nodes.indexOf(node), 1);
    return null;
  }

  return id;
}

function buildNodes(
  loaded: Object3D,
  modelId: string,
  displayName: string,
  defaultMaterialId: string | null,
) {
  const ctx: WalkContext = {
    centre: new Vector3(),
    flippedPieces: 0,
    modelId,
    nodes: [],
    warnings: new Set(),
    defaultMaterialId,
    triangles: 0,
    meshCount: 0,
  };

  // Fit transform: centre on X/Z, sit on the ground, and normalize scale so
  // imports in millimetres and metres both arrive at a usable size. It is held
  // on the model's root node, so it stays visible and adjustable rather than
  // being baked into the geometry.
  loaded.updateMatrixWorld(true);
  const box = new Box3().setFromObject(loaded);
  if (!box.isEmpty()) box.getCenter(ctx.centre);
  let fitScale = 1;
  let offset: Vec3 = [0, 0, 0];

  if (!box.isEmpty()) {
    const size = box.getSize(new Vector3());
    const largest = Math.max(size.x, size.y, size.z);
    if (largest > 0 && Number.isFinite(largest)) {
      fitScale = TARGET_SIZE / largest;
    }
    const centre = box.getCenter(new Vector3());
    offset = [-centre.x * fitScale, -box.min.y * fitScale, -centre.z * fitScale];
  }

  const rootId: NodeId = `${modelId}/root`;
  const rootNode: SceneNode = {
    id: rootId,
    modelId,
    parentId: null,
    childIds: [],
    name: displayName,
    kind: 'group',
    visible: true,
    position: offset,
    rotation: [0, 0, 0],
    scale: [fitScale, fitScale, fitScale],
    materialId: null,
  };

  // glTF wraps everything in an identity "Scene" node. Merging it keeps the
  // hierarchy panel from opening with a pointless extra level.
  const identityWrapper =
    !isRenderable(loaded) &&
    loaded.position.lengthSq() === 0 &&
    loaded.scale.distanceToSquared(new Vector3(1, 1, 1)) === 0 &&
    loaded.quaternion.w === 1;

  const subjects = identityWrapper ? loaded.children : [loaded];
  subjects.forEach((child, index) => {
    const childId = walk(child, rootId, `${index}`, ctx);
    if (childId) rootNode.childIds.push(childId);
  });

  if (ctx.flippedPieces > 0) {
    ctx.warnings.add(
      `${ctx.flippedPieces} part${ctx.flippedPieces === 1 ? ' was' : 's were'} modelled inside-out and turned the right way round.`,
    );
  }

  if (rootNode.childIds.length === 0) {
    throw new ImportError(
      'No meshes were found in this file. It may contain only cameras, lights or ' +
        'curves, or the geometry may have failed to decode.',
    );
  }

  return {
    nodes: [rootNode, ...ctx.nodes],
    rootNodeId: rootId,
    triangles: ctx.triangles,
    warnings: [...ctx.warnings],
    fitScale,
  };
}

export interface ImportOptions {
  /** Supply to reproduce stable node ids, as project loading does. */
  modelId?: string;
  /** Extra files from the same drop: .bin, .mtl, textures. */
  companions?: File[];
  /** Skip storing bytes when they are already in the registry. */
  skipStore?: boolean;
  /** Tessellation density for STEP and IGES files. Defaults to Standard. */
  cadDetail?: CadDetail;
  /**
   * Reports where the import is: a stage name and how far through the whole
   * import that stage starts (0 to 1). Reading a file reports real bytes; the
   * parse and build stages cannot report inside themselves, so they report
   * where they begin. The page is painted before each one starts.
   */
  onProgress?: (
    stage: string,
    fraction: number,
    /** A stage that blocks the page says how far it should get and roughly how long it takes. */
    estimate?: { to: number; seconds: number },
  ) => void;
}

/** Lets the browser paint, so a stage label shows before blocking work starts. */
const nextPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/** Reads a file in chunks so the caller can show real progress. */
async function readFile(file: File, onFraction: (fraction: number) => void): Promise<ArrayBuffer> {
  if (typeof file.stream !== 'function' || file.size === 0) return file.arrayBuffer();
  const reader = file.stream().getReader();
  const out = new Uint8Array(file.size);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (got + value.length > out.length) return file.arrayBuffer();
    out.set(value, got);
    got += value.length;
    onFraction(got / file.size);
  }
  return out.buffer;
}

export async function importModelFromBytes(
  bytes: ArrayBuffer,
  fileName: string,
  options: ImportOptions = {},
): Promise<ParsedModel> {
  const format = formatFromName(fileName);
  if (!format) {
    throw new ImportError(
      `"${fileName}" is not a supported format. Kaamos reads ${SUPPORTED_FORMATS_TEXT} files.`,
    );
  }
  if (bytes.byteLength === 0) {
    throw new ImportError(`"${fileName}" is empty.`);
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new ImportError(
      `"${fileName}" is larger than the ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB import limit.`,
    );
  }

  const modelId = options.modelId ?? uid('model');
  const companions = options.companions ?? [];
  const displayName = fileName.replace(/\.[^.]+$/, '') || fileName;

  let loaded: Object3D;
  let defaultMaterialId: string | null = null;
  const extraWarnings: string[] = [];

  // A parse blocks the page and cannot report from inside, so the bar is
  // given an estimate to glide along (roughly 3 MB of file per second).
  options.onProgress?.(`Parsing ${fileName}`, 0.15, {
    to: 0.58,
    seconds: Math.max(2, bytes.byteLength / 3e6),
  });
  await nextPaint();
  try {
    if (format === 'step' || format === 'iges') {
      const cad = await parseCadFile(bytes, format, fileName, options.cadDetail);
      loaded = cad.object;
      extraWarnings.push(...cad.warnings);
      // CAD files often carry no colour at all. Left alone those arrive as a
      // flat default that reads badly under a studio environment, so they get
      // a library material instead; files that do carry colour keep it.
      if (!cad.hasColours) defaultMaterialId = libraryMaterialId(DEFAULT_MATERIAL_PRESET);
    } else if (format === 'stl') {
      loaded = parseStl(bytes, displayName);
      // No colour in STL: the flat default would read badly in a studio.
      defaultMaterialId = libraryMaterialId(DEFAULT_MATERIAL_PRESET);
    } else if (format === 'obj') {
      const { object, usedMtl, nurbsSurfaces } = await parseObj(bytes, companions);
      loaded = object;
      let hasMesh = false;
      object.traverse((child) => {
        if ((child as Mesh).isMesh) hasMesh = true;
      });
      if (nurbsSurfaces > 0 && !hasMesh) {
        throw new ImportError(
          `"${fileName}" contains ${nurbsSurfaces} NURBS surface${nurbsSurfaces === 1 ? '' : 's'}, ` +
            'which Kaamos cannot read from an OBJ file. Export it again as polygon meshes ' +
            '(in Rhino: "Save surfaces, polysurfaces and extrusions as: Polygon mesh objects"), ' +
            'or use a STEP file, which Kaamos does read.',
        );
      }
      if (nurbsSurfaces > 0) {
        extraWarnings.push(
          `${nurbsSurfaces} NURBS surface${nurbsSurfaces === 1 ? ' was' : 's were'} not imported. ` +
            'Only polygon meshes are read from OBJ; export them as polygon meshes or use STEP.',
        );
      }
      // OBJ without an MTL arrives with a flat default material that looks
      // wrong under a PBR environment, so give it a library material instead.
      if (!usedMtl) defaultMaterialId = libraryMaterialId(DEFAULT_MATERIAL_PRESET);
    } else {
      loaded = await parseGltf(bytes, format, companions);
    }
  } catch (error) {
    if (error instanceof ImportError) throw error;
    if (error instanceof CadImportError) throw new ImportError(error.message);
    const detail = error instanceof Error ? error.message : String(error);
    throw new ImportError(
      `"${fileName}" could not be read as ${format.toUpperCase()}. ${detail || 'The file may be corrupted.'}`,
    );
  }

  options.onProgress?.(`Building ${displayName}`, 0.6, {
    to: 0.74,
    seconds: Math.max(1, bytes.byteLength / 8e6),
  });
  await nextPaint();
  const built = buildNodes(loaded, modelId, displayName, defaultMaterialId);

  const fileKey = `${modelId}#file`;
  if (!options.skipStore) {
    registry.putFile(fileKey, { bytes, name: fileName, format });
  }

  const warnings = [...extraWarnings, ...built.warnings];
  if (built.fitScale !== 1) {
    const factor = built.fitScale > 1 ? built.fitScale : 1 / built.fitScale;
    if (factor > 4) {
      warnings.push(
        `Scaled to fit the studio (×${built.fitScale < 0.01 ? built.fitScale.toExponential(1) : built.fitScale.toPrecision(2)}). Adjust it on the model root if the size matters.`,
      );
    }
  }

  return {
    modelId,
    name: displayName,
    fileName,
    format,
    fileKey,
    nodes: built.nodes,
    rootNodeId: built.rootNodeId,
    triangles: built.triangles,
    warnings,
    ...(format === 'step' || format === 'iges'
      ? { cadDetail: options.cadDetail ?? 'standard' }
      : {}),
  };
}

export async function importModelFromFiles(
  files: File[],
  options: ImportOptions = {},
): Promise<ParsedModel> {
  const entry = pickEntryFile(files);
  if (!entry) {
    const names = files.map((f) => f.name).join(', ');
    throw new ImportError(
      `No importable model in ${names || 'the dropped files'}. Kaamos reads ${SUPPORTED_FORMATS_TEXT} files.`,
    );
  }
  const companions = files.filter((f) => f !== entry);
  // Reading takes the first 15 % of the bar.
  options.onProgress?.(`Reading ${entry.name}`, 0);
  let lastReported = 0;
  const bytes = await readFile(entry, (fraction) => {
    if (fraction - lastReported >= 0.01 || fraction === 1) {
      lastReported = fraction;
      options.onProgress?.(`Reading ${entry.name}`, fraction * 0.15);
    }
  });
  return importModelFromBytes(bytes, entry.name, { ...options, companions });
}
