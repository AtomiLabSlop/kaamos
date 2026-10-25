import type { ProjectState, SceneNode } from '../store/types';
import {
  DEFAULT_CAMERA,
  DEFAULT_RENDER,
  projectSnapshot,
  useProject,
} from '../store/project';
import { DEFAULT_ENVIRONMENT } from '../scene/envPresets';
import { registry } from '../scene/registry';
import { asCadDetail } from './importCad';
import { importModelFromBytes } from './importModel';
import { importEnvironmentFromBytes } from './importEnvironment';
import { importImageFromBytes } from '../materials/imageStore';
import { MATERIAL_DEFAULTS } from '../materials/presets';
import { arrayBufferToBase64, base64ToArrayBuffer } from '../lib/util';

/**
 * Project files.
 *
 * A project is one JSON document. Imported models are embedded in it as their
 * original bytes, base64 encoded — not as re-serialized geometry — so opening a
 * project gives back exactly what was imported, textures and original materials
 * included. Nothing a user imported is dropped on save.
 *
 * On open, each model is parsed again from those bytes under its saved model
 * id. Node ids are derived from the model id and structure, so the ids come out
 * identical and the saved per-node edits — names, transforms, visibility and
 * material assignments — reattach to the right parts.
 */

export const PROJECT_EXTENSION = '.rmproj.json';
export const PROJECT_ACCEPT = '.json,.rmproj.json,.rmproj';
/** Projects whose source files total more than this are written as a binary container. */
export const BINARY_PROJECT_THRESHOLD = 192 * 1024 * 1024;
const BINARY_EXTENSION = '.rmproj';
const BINARY_MAGIC = 'KAAMOSB1';
// The identifier written into saved files. It predates the name Kaamos and is
// kept as it is so that projects saved earlier still open.
const FORMAT = 'rendering-machine-project';
const VERSION = 1;

/** Per-node edits, stored apart from the model so they survive reimport. */
type NodeOverride = Pick<
  SceneNode,
  'name' | 'visible' | 'position' | 'rotation' | 'scale' | 'materialId'
>;

interface EmbeddedModel {
  id: string;
  name: string;
  /** Older files may say 'sample' for a model that was generated in code. */
  source: string;
  sampleKind?: string;
  fileName?: string;
  format?: string;
  addedAt: number;
  /** base64 of the original file. Absent for the generated samples of older files. */
  bytes?: string;
  /** CAD tessellation density. Absent in older files, which meant Standard. */
  cadDetail?: string;
}

interface EmbeddedEnvironment {
  key: string;
  name: string;
  bytes: string;
}

interface EmbeddedImage {
  name: string;
  mime: string;
  bytes: string;
}

export interface ProjectFile {
  format: typeof FORMAT;
  version: number;
  savedAt: string;
  name: string;
  models: EmbeddedModel[];
  nodeOverrides: Record<string, NodeOverride>;
  materials: ProjectState['materials'];
  materialOrder: string[];
  /** Images used by materials, by registry key. Absent in files saved before textures. */
  images?: Record<string, EmbeddedImage>;
  lights: ProjectState['lights'];
  environment: ProjectState['environment'];
  customEnvironment?: EmbeddedEnvironment;
  camera: ProjectState['camera'];
  viewpoints: ProjectState['viewpoints'];
  render: ProjectState['render'];
}

export class ProjectFileError extends Error {}

const overrideOf = (node: SceneNode): NodeOverride => ({
  name: node.name,
  visible: node.visible,
  position: node.position,
  rotation: node.rotation,
  scale: node.scale,
  materialId: node.materialId,
});

/** A source file held by the project: a model, a custom environment or an image. */
export interface ProjectAsset {
  kind: 'model' | 'environment' | 'image';
  key: string;
  bytes: ArrayBuffer;
}

/**
 * The project as a file object. With `embed` false (autosave) the source bytes
 * are left out of the JSON and returned in `assets` instead, so they can be kept
 * once and not re-encoded on every autosave.
 */
export function serializeProject(embed = true): {
  file: ProjectFile;
  skipped: string[];
  assets: ProjectAsset[];
} {
  const state = projectSnapshot();
  const skipped: string[] = [];
  const assets: ProjectAsset[] = [];

  const models: EmbeddedModel[] = state.modelOrder.flatMap((id) => {
    const model = state.models[id];
    if (!model) return [];

    const entry: EmbeddedModel = {
      id: model.id,
      name: model.name,
      source: model.source,
      addedAt: model.addedAt,
      ...(model.fileName ? { fileName: model.fileName } : {}),
      ...(model.format ? { format: model.format } : {}),
      ...(model.cadDetail ? { cadDetail: model.cadDetail } : {}),
    };

    if (model.source === 'file') {
      const stored = registry.getFile(model.fileKey);
      if (stored && stored.bytes.byteLength > 0) {
        assets.push({ kind: 'model', key: model.id, bytes: stored.bytes });
        if (embed) entry.bytes = arrayBufferToBase64(stored.bytes);
      } else {
        // Should not happen, but saying so beats writing a project that opens
        // with a missing model and no explanation.
        skipped.push(model.name);
      }
    }

    return [entry];
  });

  const nodeOverrides: Record<string, NodeOverride> = {};
  for (const node of Object.values(state.nodes)) {
    nodeOverrides[node.id] = overrideOf(node);
  }

  let customEnvironment: EmbeddedEnvironment | undefined;
  const envFile = registry.getEnvFile(state.environment.customKey);
  if (state.environment.customKey && envFile) {
    assets.push({ kind: 'environment', key: state.environment.customKey, bytes: envFile.bytes });
    customEnvironment = {
      key: state.environment.customKey,
      name: envFile.name,
      bytes: embed ? arrayBufferToBase64(envFile.bytes) : '',
    };
  } else if (state.environment.customKey) {
    skipped.push(state.environment.customName ?? 'custom environment');
  }

  const images: Record<string, EmbeddedImage> = {};
  for (const material of Object.values(state.materials)) {
    for (const ref of Object.values(material.maps ?? {})) {
      if (!ref || images[ref.key]) continue;
      const stored = registry.getImage(ref.key);
      if (stored) {
        assets.push({ kind: 'image', key: ref.key, bytes: stored.bytes });
        images[ref.key] = {
          name: stored.name,
          mime: stored.mime,
          bytes: embed ? arrayBufferToBase64(stored.bytes) : '',
        };
      } else {
        skipped.push(ref.name);
      }
    }
  }

  return {
    file: {
      format: FORMAT,
      version: VERSION,
      savedAt: new Date().toISOString(),
      name: state.name,
      models,
      nodeOverrides,
      materials: state.materials,
      materialOrder: state.materialOrder,
      ...(Object.keys(images).length > 0 ? { images } : {}),
      lights: state.lights,
      environment: state.environment,
      ...(customEnvironment ? { customEnvironment } : {}),
      camera: state.camera,
      viewpoints: state.viewpoints,
      render: state.render,
    },
    skipped,
    assets,
  };
}

export function projectToBlob(file: ProjectFile) {
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

/**
 * Big projects: base64 inside one JSON string cannot hold more than roughly
 * 380 MB of model (the browser's string limit), so past a threshold the file is
 * a container instead: magic, header length, a JSON header (the project without
 * its bytes, plus the length of each asset), then the raw assets one after
 * another. Opening reads the header and slices each asset out of the file.
 */
export function projectToBinaryBlob(file: ProjectFile, assets: ProjectAsset[]) {
  const header = new TextEncoder().encode(
    JSON.stringify({
      file,
      assets: assets.map((a) => ({ kind: a.kind, key: a.key, length: a.bytes.byteLength })),
    }),
  );
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, header.byteLength, true);
  return new Blob([BINARY_MAGIC, length, header, ...assets.map((a) => a.bytes)], {
    type: 'application/octet-stream',
  });
}

export async function isBinaryProject(file: Blob): Promise<boolean> {
  const head = new TextDecoder().decode(await file.slice(0, BINARY_MAGIC.length).arrayBuffer());
  return head === BINARY_MAGIC;
}

export async function loadProjectFromBinary(blob: Blob): Promise<LoadReport> {
  const start = BINARY_MAGIC.length;
  const size = new DataView(await blob.slice(start, start + 4).arrayBuffer()).getUint32(0, true);
  let header: { file: unknown; assets: { kind: string; key: string; length: number }[] };
  try {
    header = JSON.parse(
      new TextDecoder().decode(await blob.slice(start + 4, start + 4 + size).arrayBuffer()),
    );
  } catch {
    throw new ProjectFileError('This project file is incomplete or corrupted.');
  }
  const assets = new Map<string, ArrayBuffer>();
  let offset = start + 4 + size;
  for (const asset of header.assets) {
    assets.set(asset.key, await blob.slice(offset, offset + asset.length).arrayBuffer());
    offset += asset.length;
  }
  if (offset > blob.size) throw new ProjectFileError('This project file is incomplete or corrupted.');
  return loadProjectFile(assertShape(header.file), assets);
}

function assertShape(value: unknown): ProjectFile {
  if (!value || typeof value !== 'object') {
    throw new ProjectFileError('That file is not a Kaamos project.');
  }
  const file = value as Partial<ProjectFile>;
  if (file.format !== FORMAT) {
    throw new ProjectFileError(
      'That file is not a Kaamos project. Open a .rmproj.json file.',
    );
  }
  if (typeof file.version !== 'number' || file.version > VERSION) {
    throw new ProjectFileError(
      `This project was saved by a newer version (file version ${String(file.version)}).`,
    );
  }
  if (!Array.isArray(file.models) || !file.environment || !file.camera) {
    throw new ProjectFileError('This project file is incomplete or corrupted.');
  }
  return file as ProjectFile;
}

export interface LoadReport {
  name: string;
  /** When the file was written (ms), or null if it does not say. */
  savedAt: number | null;
  models: number;
  warnings: string[];
}

export async function loadProjectFromText(text: string): Promise<LoadReport> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProjectFileError('That file is not valid JSON.');
  }
  return loadProjectFile(assertShape(parsed));
}

/**
 * Builds the project from a file object. Source bytes come from the file's own
 * base64 fields, or from `assets` (an autosave keeps them apart), looked up by
 * model id, environment key or image key.
 */
export async function loadProjectFile(
  file: ProjectFile,
  assets?: Map<string, ArrayBuffer>,
): Promise<LoadReport> {
  const warnings: string[] = [];
  const bytesFor = (key: string, base64?: string): ArrayBuffer | null => {
    const kept = assets?.get(key);
    if (kept) return kept;
    return base64 ? base64ToArrayBuffer(base64) : null;
  };

  /* ---- rebuild the scene from the embedded models ---- */
  const nodes: Record<string, SceneNode> = {};
  const models: ProjectState['models'] = {};
  const modelOrder: string[] = [];

  for (const entry of file.models) {
    try {
      if (entry.source === 'sample') {
        warnings.push(
          `"${entry.name}" was a built-in sample product that no longer exists, so it was skipped.`,
        );
        continue;
      }

      const modelBytes = entry.fileName ? bytesFor(entry.id, entry.bytes) : null;
      if (!modelBytes || !entry.fileName) {
        warnings.push(
          `"${entry.name}" had no embedded data and was skipped. The file was saved without it; ` +
            'open the original model and save again.',
        );
        continue;
      }

      const parsedModel = await importModelFromBytes(
        modelBytes,
        entry.fileName,
        { modelId: entry.id, cadDetail: asCadDetail(entry.cadDetail) },
      );
      for (const node of parsedModel.nodes) nodes[node.id] = node;
      models[entry.id] = {
        id: entry.id,
        name: entry.name,
        source: 'file',
        fileName: parsedModel.fileName,
        format: parsedModel.format,
        fileKey: parsedModel.fileKey,
        ...(parsedModel.cadDetail ? { cadDetail: parsedModel.cadDetail } : {}),
        rootNodeId: parsedModel.rootNodeId,
        addedAt: entry.addedAt,
      };
      modelOrder.push(entry.id);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      warnings.push(`"${entry.name}" could not be rebuilt. ${detail}`);
    }
  }

  /* ---- reapply the saved per-node edits ---- */
  let reattached = 0;
  let orphaned = 0;
  for (const [id, override] of Object.entries(file.nodeOverrides ?? {})) {
    const node = nodes[id];
    if (!node) {
      orphaned += 1;
      continue;
    }
    // Files saved while Rounded Edges existed may carry its setting; it is dropped.
    const { roundedEdges: _gone, ...kept } = override as typeof override & { roundedEdges?: unknown };
    nodes[id] = { ...node, ...kept };
    reattached += 1;
  }
  if (orphaned > 0 && reattached === 0 && Object.keys(nodes).length > 0) {
    warnings.push(
      'Saved object edits did not match the rebuilt models, so defaults were used.',
    );
  }

  /* ---- custom environment ----
     Merged over the current defaults so a project saved before a setting
     existed still opens, with the new setting at its default rather than
     undefined. The same applies to the camera and render sections below. */
  let environment = { ...DEFAULT_ENVIRONMENT, ...file.environment };
  if (file.customEnvironment) {
    try {
      const envBytes = bytesFor(file.customEnvironment.key, file.customEnvironment.bytes);
      if (!envBytes) throw new Error('No data was saved with it.');
      await importEnvironmentFromBytes(
        envBytes,
        file.customEnvironment.name,
        { key: file.customEnvironment.key },
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      warnings.push(`The custom environment could not be restored. ${detail}`);
      environment = { ...environment, source: 'studio', customKey: null, customName: null };
    }
  } else if (environment.customKey) {
    warnings.push('The custom environment was not embedded; a studio preset was used.');
    environment = { ...environment, source: 'studio', customKey: null, customName: null };
  }

  /* ---- material images ----
     Decoded before the project is replaced, so the materials find them on
     their first draw. A slot whose image is missing is cleared with a warning. */
  const materials: ProjectState['materials'] = {};
  for (const [id, saved] of Object.entries(file.materials ?? {})) {
    materials[id] = { ...MATERIAL_DEFAULTS, ...saved, maps: { ...(saved.maps ?? {}) } };
  }
  for (const [key, image] of Object.entries(file.images ?? {})) {
    try {
      const imageBytes = bytesFor(key, image.bytes);
      if (!imageBytes) throw new Error('No data was saved with it.');
      await importImageFromBytes(imageBytes, image.name, {
        key,
        mime: image.mime,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      warnings.push(`The image "${image.name}" could not be restored. ${detail}`);
    }
  }
  for (const material of Object.values(materials)) {
    for (const [slot, ref] of Object.entries(material.maps)) {
      if (ref && !registry.getImage(ref.key)) {
        delete material.maps[slot as keyof typeof material.maps];
        if (!file.images?.[ref.key]) {
          warnings.push(`The image "${ref.name}" was not embedded and was left out.`);
        }
      }
    }
  }

  const current = projectSnapshot();

  useProject.getState().replaceProject({
    name: file.name || 'Untitled',
    nodes,
    models,
    modelOrder,
    materials: file.materials ? materials : current.materials,
    materialOrder: file.materialOrder ?? current.materialOrder,
    lights: file.lights ?? current.lights,
    environment,
    camera: { ...DEFAULT_CAMERA, ...file.camera },
    viewpoints: file.viewpoints ?? current.viewpoints,
    // `aperture` belonged to the first depth-of-field controls and means nothing now.
    render: (({ aperture: _legacy, ...rest }) => ({ ...DEFAULT_RENDER, ...rest }))(
      (file.render ?? {}) as unknown as Record<string, unknown>,
    ) as ProjectState['render'],
  });

  const savedAt = Date.parse(file.savedAt);
  return {
    name: file.name || 'Untitled',
    savedAt: Number.isFinite(savedAt) ? savedAt : null,
    models: modelOrder.length,
    warnings,
  };
}

export function projectFilename(name: string, binary = false) {
  const safe = name.trim().replace(/[^\w\-. ]+/g, '').replace(/\s+/g, '-') || 'project';
  return `${safe}${binary ? BINARY_EXTENSION : PROJECT_EXTENSION}`;
}
