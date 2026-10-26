import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type {
  AreaLight,
  CameraSettings,
  EnvironmentSettings,
  MaterialDef,
  ModelAsset,
  NodeId,
  ProjectState,
  RenderSettings,
  SceneNode,
  Viewpoint,
} from './types';
import {
  buildLibraryMaterials,
  DEFAULT_MATERIAL_PRESET,
  libraryMaterialId,
  MATERIAL_DEFAULTS,
  PRESETS_BY_ID,
} from '../materials/presets';
import { DEFAULT_ENVIRONMENT, LIGHTING_PRESETS } from '../scene/envPresets';
import { loadRenderDefaults } from './renderDefaults';
import { registry } from '../scene/registry';
import type { ParsedModel } from '../io/importModel';
import { uid } from '../lib/util';

/* ------------------------------------------------------------------ *
   Defaults
 * ------------------------------------------------------------------ */

export const DEFAULT_CAMERA: CameraSettings = {
  projection: 'perspective',
  fov: 35,
  orthoZoom: 2.6,
  exposure: 1,
  // Khronos PBR Neutral was designed for product visualisation: it keeps
  // highlights from clipping without draining their colour the way AgX and
  // ACES do, so a saturated paint still reads as that paint. AgX remains
  // available and is the better choice for a more cinematic look.
  toneMapping: 'neutral',
};

export const DEFAULT_RENDER: RenderSettings = {
  engine: 'pathtrace',
  // The denoiser is off by default: it softened edges in the finished image.
  // Without it a scene lit only through glass or a small source is grainy at
  // this count and wants several times as many samples.
  pathSamples: 64,
  // The preview stops here and the GPU goes quiet; enough for a clean look.
  previewSamples: 256,
  bounces: 5,
  denoise: false,
  denoiseStrength: 'medium',
  width: 1280,
  height: 960,
  samples: 24,
  depthOfField: false,
  fStop: 2.8,
  focusDistance: 0,
  transparentBackground: false,
  shadowResolution: 2048,
};

function emptyProject(name = 'Untitled'): ProjectState {
  const library = buildLibraryMaterials();
  return {
    name,
    nodes: {},
    models: {},
    modelOrder: [],
    materials: library.materials,
    materialOrder: library.order,
    lights: LIGHTING_PRESETS[0].lights.map((light) => ({ ...light, id: uid('light') })),
    environment: { ...DEFAULT_ENVIRONMENT },
    camera: { ...DEFAULT_CAMERA },
    viewpoints: [],
    render: { ...DEFAULT_RENDER, ...loadRenderDefaults().render },
  };
}

/** The document half of the store, without the actions or history flags. */
function pickProject(state: ProjectState): ProjectState {
  return {
    name: state.name,
    nodes: state.nodes,
    models: state.models,
    modelOrder: state.modelOrder,
    materials: state.materials,
    materialOrder: state.materialOrder,
    lights: state.lights,
    environment: state.environment,
    camera: state.camera,
    viewpoints: state.viewpoints,
    render: state.render,
  };
}

const cloneProject = (state: ProjectState): ProjectState =>
  structuredClone(pickProject(state));

/* ------------------------------------------------------------------ *
   Undo history

   Snapshots of the serializable project, taken before each mutation. Rapid
   repeats of the same labelled action — a slider being dragged — coalesce into
   one entry so a drag is a single undo step.
 * ------------------------------------------------------------------ */

const HISTORY_LIMIT = 40;
const COALESCE_MS = 700;

let past: ProjectState[] = [];
let future: ProjectState[] = [];
let lastLabel = '';
let lastStamp = 0;

export interface ProjectStore extends ProjectState {
  /** Bumped on every history change so toolbar buttons re-render. */
  historyTick: number;
  canUndo: boolean;
  canRedo: boolean;

  undo(): void;
  redo(): void;

  addImportedModel(parsed: ParsedModel): NodeId;
  removeModel(modelId: string): void;
  deleteNode(nodeId: NodeId): void;

  renameNode(nodeId: NodeId, name: string): void;
  setNodeVisible(nodeId: NodeId, visible: boolean): void;
  /** Makes every hidden part and group visible again, as one undo step. */
  showAllNodes(): void;
  setNodeTransform(
    nodeId: NodeId,
    patch: Partial<Pick<SceneNode, 'position' | 'rotation' | 'scale'>>,
  ): void;
  assignMaterial(nodeId: NodeId, materialId: string | null): void;
  assignMaterialToModel(modelId: string, materialId: string | null): void;

  updateMaterial(id: string, patch: Partial<MaterialDef>, label?: string): void;
  renameMaterial(id: string, name: string): void;
  duplicateMaterial(id: string): string | null;
  resetMaterial(id: string): void;
  deleteMaterial(id: string): void;

  addLight(init?: Partial<Omit<AreaLight, 'id'>>): string;
  updateLight(id: string, patch: Partial<AreaLight>, label?: string): void;
  duplicateLight(id: string): string | null;
  removeLight(id: string): void;

  updateEnvironment(patch: Partial<EnvironmentSettings>, label?: string): void;
  applyLightingPreset(presetId: string): void;
  setCustomEnvironment(key: string, name: string): void;
  clearCustomEnvironment(): void;

  updateCamera(patch: Partial<CameraSettings>, label?: string): void;
  addViewpoint(viewpoint: Omit<Viewpoint, 'id'>): string;
  removeViewpoint(id: string): void;
  renameViewpoint(id: string, name: string): void;
  /** Replaces a saved view's camera with new values; its name stays. */
  updateViewpoint(id: string, camera: Omit<Viewpoint, 'id' | 'name'>): void;

  updateRender(patch: Partial<RenderSettings>, label?: string): void;

  setProjectName(name: string): void;
  resetScene(): void;
  replaceProject(state: ProjectState): void;
}

export const useProject = create<ProjectStore>((set, get) => {
  /** Record the pre-mutation state. Call before changing anything. */
  function mark(label: string) {
    const now = performance.now();
    if (label && label === lastLabel && now - lastStamp < COALESCE_MS) {
      lastStamp = now;
      return;
    }
    lastLabel = label;
    lastStamp = now;
    past.push(cloneProject(get()));
    if (past.length > HISTORY_LIMIT) {
      past = past.slice(past.length - HISTORY_LIMIT);
      // Not now: `mark` runs before the change, so the state seen here does not
      // yet hold what the change adds (a model just imported, a project just
      // opened), and sweeping would free its geometry and source file. After
      // the change has been applied, it does.
      queueMicrotask(() => sweepAssets(get()));
    }
    future = [];
    set({ historyTick: get().historyTick + 1, canUndo: true, canRedo: false });
  }

  /** Release registry entries no reachable state refers to any more. */
  function sweepAssets(current: ProjectState) {
    const geometryKeys = new Set<string>();
    const nodeIds = new Set<string>();
    const fileKeys = new Set<string>();
    const envKeys = new Set<string>();
    const imageKeys = new Set<string>();

    for (const state of [current, ...past, ...future]) {
      for (const material of Object.values(state.materials)) {
        for (const ref of Object.values(material.maps ?? {})) {
          if (ref) imageKeys.add(ref.key);
        }
      }
      for (const node of Object.values(state.nodes)) {
        nodeIds.add(node.id);
        if (node.geometryKey) geometryKeys.add(node.geometryKey);
      }
      for (const model of Object.values(state.models)) {
        if (model.fileKey) fileKeys.add(model.fileKey);
      }
      if (state.environment.customKey) envKeys.add(state.environment.customKey);
    }

    registry.sweep({ geometryKeys, nodeIds, fileKeys, envKeys, imageKeys });
  }

  function syncHistoryFlags() {
    set({
      historyTick: get().historyTick + 1,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
    });
  }

  /** Remove a node and everything under it. Returns affected model ids. */
  function detachSubtree(nodes: Record<NodeId, SceneNode>, rootId: NodeId) {
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop();
      if (!id) continue;
      const node = nodes[id];
      if (!node) continue;
      stack.push(...node.childIds);
      delete nodes[id];
    }
    // Unlink from the parent's child list.
    for (const node of Object.values(nodes)) {
      if (node.childIds.includes(rootId)) {
        node.childIds = node.childIds.filter((child) => child !== rootId);
      }
    }
  }

  return {
    ...emptyProject(),
    historyTick: 0,
    canUndo: false,
    canRedo: false,

    undo() {
      const previous = past.pop();
      if (!previous) return;
      future.push(cloneProject(get()));
      lastLabel = '';
      set(previous);
      syncHistoryFlags();
    },

    redo() {
      const next = future.pop();
      if (!next) return;
      past.push(cloneProject(get()));
      lastLabel = '';
      set(next);
      syncHistoryFlags();
    },

    /* ---------------- models ---------------- */

    addImportedModel(parsed) {
      mark(`import-${parsed.modelId}`);
      const nodes = { ...get().nodes };
      for (const node of parsed.nodes) nodes[node.id] = node;

      const model: ModelAsset = {
        id: parsed.modelId,
        name: parsed.name,
        source: 'file',
        fileName: parsed.fileName,
        format: parsed.format,
        fileKey: parsed.fileKey,
        ...(parsed.cadDetail ? { cadDetail: parsed.cadDetail } : {}),
        rootNodeId: parsed.rootNodeId,
        addedAt: Date.now(),
      };

      set({
        nodes,
        models: { ...get().models, [parsed.modelId]: model },
        modelOrder: [...get().modelOrder, parsed.modelId],
      });
      return parsed.rootNodeId;
    },

    removeModel(modelId) {
      const model = get().models[modelId];
      if (!model) return;
      mark(`remove-model-${modelId}`);

      const nodes = { ...get().nodes };
      detachSubtree(nodes, model.rootNodeId);
      const models = { ...get().models };
      delete models[modelId];

      set({
        nodes,
        models,
        modelOrder: get().modelOrder.filter((id) => id !== modelId),
      });
    },

    deleteNode(nodeId) {
      const node = get().nodes[nodeId];
      if (!node) return;
      const model = get().models[node.modelId];
      if (model && model.rootNodeId === nodeId) {
        get().removeModel(node.modelId);
        return;
      }
      mark(`delete-node-${nodeId}`);
      const nodes = { ...get().nodes };
      detachSubtree(nodes, nodeId);
      set({ nodes });
    },

    /* ---------------- nodes ---------------- */

    renameNode(nodeId, name) {
      const node = get().nodes[nodeId];
      if (!node || node.name === name) return;
      mark(`rename-node-${nodeId}`);
      set({ nodes: { ...get().nodes, [nodeId]: { ...node, name } } });
    },

    setNodeVisible(nodeId, visible) {
      const node = get().nodes[nodeId];
      if (!node) return;
      mark(`visible-${nodeId}`);
      set({ nodes: { ...get().nodes, [nodeId]: { ...node, visible } } });
    },

    showAllNodes() {
      const nodes = get().nodes;
      if (!Object.values(nodes).some((node) => !node.visible)) return;
      mark('show-all');
      const next = { ...nodes };
      for (const node of Object.values(nodes)) {
        if (!node.visible) next[node.id] = { ...node, visible: true };
      }
      set({ nodes: next });
    },

    setNodeTransform(nodeId, patch) {
      const node = get().nodes[nodeId];
      if (!node) return;
      mark(`transform-${nodeId}`);
      set({ nodes: { ...get().nodes, [nodeId]: { ...node, ...patch } } });
    },

    assignMaterial(nodeId, materialId) {
      const node = get().nodes[nodeId];
      if (!node || node.kind !== 'mesh') return;
      if (node.materialId === materialId) return;
      mark(`assign-material-${nodeId}`);
      set({ nodes: { ...get().nodes, [nodeId]: { ...node, materialId } } });
    },

    assignMaterialToModel(modelId, materialId) {
      const model = get().models[modelId];
      if (!model) return;
      mark(`assign-material-model-${modelId}`);
      const nodes = { ...get().nodes };
      for (const node of Object.values(nodes)) {
        if (node.modelId === modelId && node.kind === 'mesh') {
          nodes[node.id] = { ...node, materialId };
        }
      }
      set({ nodes });
    },

    /* ---------------- materials ---------------- */

    updateMaterial(id, patch, label) {
      const material = get().materials[id];
      if (!material) return;
      mark(label ?? `material-${id}-${Object.keys(patch).join(',')}`);
      set({
        materials: { ...get().materials, [id]: { ...material, ...patch } },
      });
    },

    renameMaterial(id, name) {
      const material = get().materials[id];
      if (!material || material.name === name) return;
      mark(`material-name-${id}`);
      set({ materials: { ...get().materials, [id]: { ...material, name } } });
    },

    duplicateMaterial(id) {
      const source = get().materials[id];
      if (!source) return null;
      mark(`duplicate-material-${id}`);
      const newId = uid('mat');
      const copy: MaterialDef = {
        ...source,
        id: newId,
        name: `${source.name} copy`,
        builtIn: false,
      };
      const index = get().materialOrder.indexOf(id);
      const order = [...get().materialOrder];
      order.splice(index + 1, 0, newId);
      set({ materials: { ...get().materials, [newId]: copy }, materialOrder: order });
      return newId;
    },

    resetMaterial(id) {
      const material = get().materials[id];
      if (!material) return;
      const preset = material.presetId ? PRESETS_BY_ID.get(material.presetId) : null;
      mark(`reset-material-${id}`);
      set({
        materials: {
          ...get().materials,
          [id]: {
            ...material,
            ...(preset ? preset.params : MATERIAL_DEFAULTS),
          },
        },
      });
    },

    deleteMaterial(id) {
      const material = get().materials[id];
      if (!material || material.builtIn) return;
      mark(`delete-material-${id}`);
      const materials = { ...get().materials };
      delete materials[id];

      const fallback = libraryMaterialId(DEFAULT_MATERIAL_PRESET);
      const nodes = { ...get().nodes };
      for (const node of Object.values(nodes)) {
        if (node.materialId === id) {
          nodes[node.id] = { ...node, materialId: materials[fallback] ? fallback : null };
        }
      }

      set({
        materials,
        materialOrder: get().materialOrder.filter((mid) => mid !== id),
        nodes,
      });
    },

    /* ---------------- lights ---------------- */

    addLight(init) {
      mark('add-light');
      const id = uid('light');
      const count = get().lights.length + 1;
      const light: AreaLight = {
        id,
        name: `Light ${count}`,
        enabled: true,
        color: '#ffffff',
        intensity: 4,
        width: 2,
        height: 2,
        position: [2.2, 2.4, 2.2],
        aimHeight: 0.4,
        ...init,
      };
      set({ lights: [...get().lights, light] });
      return id;
    },

    updateLight(id, patch, label) {
      const index = get().lights.findIndex((light) => light.id === id);
      if (index < 0) return;
      mark(label ?? `light-${id}-${Object.keys(patch).join(',')}`);
      const lights = [...get().lights];
      lights[index] = { ...lights[index], ...patch };
      set({ lights });
    },

    duplicateLight(id) {
      const source = get().lights.find((light) => light.id === id);
      if (!source) return null;
      mark(`duplicate-light-${id}`);
      const newId = uid('light');
      const index = get().lights.findIndex((light) => light.id === id);
      const lights = [...get().lights];
      lights.splice(index + 1, 0, { ...source, id: newId, name: `${source.name} copy` });
      set({ lights });
      return newId;
    },

    removeLight(id) {
      if (!get().lights.some((light) => light.id === id)) return;
      mark(`remove-light-${id}`);
      set({ lights: get().lights.filter((light) => light.id !== id) });
    },

    /* ---------------- environment ---------------- */

    updateEnvironment(patch, label) {
      mark(label ?? `environment-${Object.keys(patch).join(',')}`);
      set({ environment: { ...get().environment, ...patch } });
    },

    applyLightingPreset(presetId) {
      const preset = LIGHTING_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      mark(`lighting-preset-${presetId}`);
      set({
        environment: { ...get().environment, ...preset.environment },
        lights: preset.lights.map((light) => ({ ...light, id: uid('light') })),
      });
    },

    setCustomEnvironment(key, name) {
      mark('custom-environment');
      set({
        environment: {
          ...get().environment,
          source: 'custom',
          customKey: key,
          customName: name,
        },
      });
    },

    clearCustomEnvironment() {
      mark('clear-custom-environment');
      set({
        environment: {
          ...get().environment,
          source: 'studio',
          customKey: null,
          customName: null,
        },
      });
    },

    /* ---------------- camera ---------------- */

    updateCamera(patch, label) {
      mark(label ?? `camera-${Object.keys(patch).join(',')}`);
      set({ camera: { ...get().camera, ...patch } });
    },

    addViewpoint(viewpoint) {
      mark('add-viewpoint');
      const id = uid('view');
      set({ viewpoints: [...get().viewpoints, { ...viewpoint, id }] });
      return id;
    },

    removeViewpoint(id) {
      mark(`remove-viewpoint-${id}`);
      set({ viewpoints: get().viewpoints.filter((view) => view.id !== id) });
    },

    updateViewpoint(id, camera) {
      mark(`update-viewpoint-${id}`);
      set({
        viewpoints: get().viewpoints.map((view) => (view.id === id ? { ...view, ...camera } : view)),
      });
    },

    renameViewpoint(id, name) {
      mark(`rename-viewpoint-${id}`);
      set({
        viewpoints: get().viewpoints.map((view) =>
          view.id === id ? { ...view, name } : view,
        ),
      });
    },

    /* ---------------- render ---------------- */

    updateRender(patch, label) {
      mark(label ?? `render-${Object.keys(patch).join(',')}`);
      set({ render: { ...get().render, ...patch } });
    },

    /* ---------------- project ---------------- */

    setProjectName(name) {
      mark('project-name');
      set({ name });
    },

    resetScene() {
      mark('reset-scene');
      set(emptyProject());
    },

    replaceProject(state) {
      mark('open-project');
      set(pickProject(state));
    },
  };
});

/* ------------------------------------------------------------------ *
   Selectors
 * ------------------------------------------------------------------ */

export const selectRootIds = (state: ProjectState): NodeId[] =>
  state.modelOrder
    .map((id) => state.models[id]?.rootNodeId)
    .filter((id): id is NodeId => Boolean(id) && Boolean(state.nodes[id]));

export const selectIsEmpty = (state: ProjectState) => state.modelOrder.length === 0;

export function selectStats(state: ProjectState) {
  let meshes = 0;
  let triangles = 0;
  for (const node of Object.values(state.nodes)) {
    if (node.kind === 'mesh') {
      meshes += 1;
      triangles += node.triangles ?? 0;
    }
  }
  return { meshes, triangles, models: state.modelOrder.length };
}

/** Material a node renders with, or null when it keeps the file's own. */
export function selectNodeMaterial(
  state: ProjectState,
  nodeId: NodeId,
): MaterialDef | null {
  const node = state.nodes[nodeId];
  if (!node?.materialId) return null;
  return state.materials[node.materialId] ?? null;
}

export function selectNodePath(state: ProjectState, nodeId: NodeId): SceneNode[] {
  const path: SceneNode[] = [];
  let current: SceneNode | undefined = state.nodes[nodeId];
  let guard = 0;
  while (current && guard < 256) {
    path.unshift(current);
    current = current.parentId ? state.nodes[current.parentId] : undefined;
    guard += 1;
  }
  return path;
}

/** Count of mesh nodes using each material, for the library readout. */
export function selectMaterialUsage(state: ProjectState): Record<string, number> {
  const usage: Record<string, number> = {};
  for (const node of Object.values(state.nodes)) {
    if (node.kind === 'mesh' && node.materialId) {
      usage[node.materialId] = (usage[node.materialId] ?? 0) + 1;
    }
  }
  return usage;
}

/* ------------------------------------------------------------------ *
   Hooks for derived state

   These selectors build a fresh array, object or map on every call, which
   never compares equal by reference — subscribing to one directly would
   re-render forever. `useShallow` compares the contents instead, so a render
   happens only when the derived value actually differs.
 * ------------------------------------------------------------------ */

const NO_NODES: SceneNode[] = [];

export const useRootIds = () => useProject(useShallow(selectRootIds));

export const useMaterialUsage = () => useProject(useShallow(selectMaterialUsage));

export const useSceneStats = () => useProject(useShallow(selectStats));

export const useNodePath = (nodeId: NodeId | null) =>
  useProject(
    useShallow((state: ProjectState) =>
      nodeId ? selectNodePath(state, nodeId) : NO_NODES,
    ),
  );

export const projectSnapshot = (): ProjectState => pickProject(useProject.getState());

export function resetHistory() {
  past = [];
  future = [];
  lastLabel = '';
  useProject.setState({ canUndo: false, canRedo: false });
}

export { emptyProject };
