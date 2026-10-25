import { registry } from './scene/registry';
import { rescueModelFiles } from './io/autosave';
import { selectIsEmpty, useProject } from './store/project';
import { useUI } from './store/ui';
import type { TextureSlot, Vec3 } from './store/types';
import {
  EXAMPLE_IMAGES,
  EXAMPLE_MODEL,
  EXAMPLE_LIQUID,
  EXAMPLE_ROTATION_Y,
  EXAMPLE_MATERIALS,
  fetchExampleImage,
  fetchExampleModel,
} from './scene/exampleModel';
import { libraryMaterialId } from './materials/presets';
import { dropNodeToFloor } from './scene/floorDrop';
import {
  IMAGE_ACCEPT,
  ImageImportError,
  importImageFile,
  importImageFromBytes,
} from './materials/imageStore';
import {
  ACCEPT_ATTRIBUTE,
  ImportError,
  formatFromName,
  importModelFromFiles,
  pickEntryFile,
} from './io/importModel';
import type { CadDetail } from './io/importCad';
import { currentLens } from './render/depthOfField';
import {
  ENVIRONMENT_ACCEPT,
  EnvironmentImportError,
  importEnvironmentFile,
} from './io/importEnvironment';
import {
  PROJECT_ACCEPT,
  BINARY_PROJECT_THRESHOLD,
  isBinaryProject,
  loadProjectFromBinary,
  projectToBinaryBlob,
  ProjectFileError,
  loadProjectFromText,
  projectFilename,
  projectToBlob,
  serializeProject,
} from './io/projectFile';
import { renderFinal } from './render/finalRender';
import { renderPathTraced } from './render/pathTracedRender';
import { RenderAborted } from './render/renderErrors';
import {
  applyCameraState,
  applyViewDirection,
  fovBasis,
  frameAll,
  frameNode,
  frameNodes,
  hideForRender,
  readCameraState,
  requestRedraw,
  targetDistance,
  viewport,
} from './scene/viewportApi';
import { downloadBlob, formatBytes, uid } from './lib/util';

/**
 * Commands.
 *
 * Every toolbar button, keyboard shortcut and panel action routes through this
 * module, so an action behaves identically however it was triggered and the
 * React components stay presentational.
 */

const ui = () => useUI.getState();
const project = () => useProject.getState();

/* ------------------------------------------------------------------ *
   File pickers
 * ------------------------------------------------------------------ */

function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.append(input);

    const finish = (files: File[]) => {
      input.remove();
      resolve(files);
    };

    input.addEventListener('change', () => finish([...(input.files ?? [])]));
    // A cancelled picker fires `cancel` in current browsers; the focus fallback
    // keeps the promise from hanging in those that do not.
    input.addEventListener('cancel', () => finish([]));
    input.click();
  });
}

/* ------------------------------------------------------------------ *
   Models
 * ------------------------------------------------------------------ */

/**
 * Opens the tree below a model's root for as long as each level has a single
 * child, so a CAD file's wrapper groups don't hide the parts inside them.
 * Assemblies with many children are left closed.
 */
function expandSingleChains(rootId: string) {
  const nodes = project().nodes;
  let id: string | undefined = rootId;
  while (id) {
    ui().setNodeExpanded(id, true);
    const children: string[] = nodes[id]?.childIds ?? [];
    id = children.length === 1 ? children[0] : undefined;
  }
}

/** Selects a node and opens every group above it, so it is visible in the tree. */
export function selectAndReveal(nodeId: string | null) {
  ui().selectNode(nodeId);
  if (!nodeId) return;
  const nodes = project().nodes;
  let parent = nodes[nodeId]?.parentId;
  while (parent) {
    ui().setNodeExpanded(parent, true);
    parent = nodes[parent]?.parentId ?? null;
  }
}

/** Files held while the detail dialog is open. Kept out of the store, which stays serializable. */
let pendingCadFiles: File[] | null = null;

/** The dialog's Import button: carry on with the files that were waiting. */
export function confirmCadImport(cadDetail: CadDetail) {
  const files = pendingCadFiles;
  pendingCadFiles = null;
  ui().setCadDetail(cadDetail);
  ui().closeCadImport();
  if (files) void importModelFiles(files, { cadDetail });
}

export function cancelCadImport() {
  pendingCadFiles = null;
  ui().closeCadImport();
}

export async function importModelFiles(
  files: File[],
  options: { cadDetail?: CadDetail } = {},
) {
  if (files.length === 0) return;

  // STEP and IGES are cut into triangles on import, and how finely is the
  // user's call, so ask before reading.
  if (options.cadDetail === undefined) {
    const entry = pickEntryFile(files);
    const format = entry ? formatFromName(entry.name) : null;
    if (entry && (format === 'step' || format === 'iges')) {
      pendingCadFiles = files;
      ui().askCadDetail(entry.name);
      return;
    }
  }

  ui().setBusy(`Reading ${files.length > 1 ? `${files.length} files` : files[0].name}…`);
  registry.hold();
  try {
    const parsed = await importModelFromFiles(files, {
      cadDetail: options.cadDetail,
      onProgress: (stage, fraction, estimate) => {
        ui().setBusy(`${stage}…`);
        ui().setBusyProgress(fraction, estimate ?? null);
      },
    });
    ui().setBusy('Preparing the scene…');
    ui().setBusyProgress(0.75);
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const rootId = project().addImportedModel(parsed);
    ui().selectNode(rootId);
    expandSingleChains(rootId);

    requestAnimationFrame(() => {
      const framing = frameAll();
      if (framing) project().updateCamera({ orthoZoom: framing.orthoZoom }, 'frame');
    });

    const detail = parsed.warnings.length > 0 ? parsed.warnings.join(' ') : undefined;
    ui().toast(
      parsed.warnings.length > 0 ? 'warn' : 'success',
      `Imported ${parsed.name}`,
      detail,
    );
  } catch (error) {
    if (error instanceof ImportError) {
      ui().toast('error', 'Import failed', error.message);
    } else {
      const detail = error instanceof Error ? error.message : String(error);
      ui().toast('error', 'Import failed', detail);
    }
  } finally {
    registry.release();
    ui().setBusy(null);
  }
}

export async function importModel() {
  const files = await pickFiles(ACCEPT_ATTRIBUTE, true);
  await importModelFiles(files);
}

/** Picks every part that uses a material, outlines them and opens them in the tree. */
export function selectPartsUsingMaterial(materialId: string) {
  const ids = Object.values(project().nodes)
    .filter((node) => node.kind === 'mesh' && node.materialId === materialId)
    .map((node) => node.id);
  if (ids.length === 0) {
    ui().toast('info', 'No parts use this material');
    return;
  }
  ui().selectNodes(ids);
  for (const id of ids) {
    let parent = project().nodes[id]?.parentId;
    while (parent) {
      ui().setNodeExpanded(parent, true);
      parent = project().nodes[parent]?.parentId ?? null;
    }
  }
}

/** Adds the example bottle, the same way as importing its file. */
export async function addExampleModel() {
  let file: File;
  ui().setBusy(`Loading ${EXAMPLE_MODEL.name}…`);
  try {
    file = await fetchExampleModel();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    ui().toast('error', 'Example model failed', detail);
    ui().setBusy(null);
    return;
  }
  const before = new Set(project().modelOrder);
  await importModelFiles([file]);

  // Give the parts their materials. Skipped for any material the project
  // doesn't have (an older project's library may lack the newer presets).
  const modelId = project().modelOrder.find((id) => !before.has(id));
  if (!modelId) return;
  const rootId = project().models[modelId]?.rootNodeId;
  if (rootId) project().setNodeTransform(rootId, { rotation: [0, EXAMPLE_ROTATION_Y, 0] });
  for (const node of Object.values(project().nodes)) {
    if (node.modelId !== modelId || node.kind !== 'mesh') continue;
    const presetId = EXAMPLE_MATERIALS[node.name];
    const materialId = presetId ? libraryMaterialId(presetId) : null;
    if (materialId && project().materials[materialId]) {
      project().assignMaterial(node.id, materialId);
    }
    if (node.name === EXAMPLE_LIQUID.part) {
      const k = EXAMPLE_LIQUID.scale;
      project().setNodeTransform(node.id, {
        scale: [node.scale[0] * k, node.scale[1] * k, node.scale[2] * k],
      });
    }
  }
  // Label artwork and cork grain. A failure here only costs the images.
  for (const entry of EXAMPLE_IMAGES) {
    const materialId = libraryMaterialId(entry.preset);
    const material = project().materials[materialId];
    if (!material || material.maps?.[entry.slot]) continue;
    try {
      const { bytes, name } = await fetchExampleImage(entry.file);
      const ref = await importImageFromBytes(bytes, name);
      const latest = project().materials[materialId];
      if (!latest) continue;
      project().updateMaterial(
        materialId,
        { ...entry.patch, maps: { ...latest.maps, [entry.slot]: ref } },
        `example-image-${entry.file}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      ui().toast('warn', 'Example image failed', detail);
    }
  }
}

export function removeModel(modelId: string) {
  const model = project().models[modelId];
  if (!model) return;

  ui().confirm({
    title: 'Remove model',
    body: `Remove "${model.name}" and all of its objects from the scene? This can be undone.`,
    confirmLabel: 'Remove',
    destructive: true,
    onConfirm: () => {
      const selected = ui().selectedNodeId;
      const selectedNode = selected ? project().nodes[selected] : null;
      project().removeModel(modelId);
      if (selectedNode?.modelId === modelId) ui().selectNode(null);
      ui().toast('info', `Removed ${model.name}`);
    },
  });
}

/** Rests the selected part on the floor, 0.1 mm above it, in its present pose. */
export function dropSelectedToFloor() {
  const id = ui().selectedNodeId;
  if (!id) return;
  if (!dropNodeToFloor(id)) ui().toast('warn', 'Nothing to drop', 'The selected part has no visible geometry.');
}

export function deleteSelectedNode() {
  const id = ui().selectedNodeId;
  if (!id) return;
  const node = project().nodes[id];
  if (!node) return;

  const isModelRoot = project().models[node.modelId]?.rootNodeId === id;
  if (isModelRoot) {
    removeModel(node.modelId);
    return;
  }

  ui().confirm({
    title: 'Delete object',
    body: `Delete "${node.name}" from the scene? This can be undone.`,
    confirmLabel: 'Delete',
    destructive: true,
    onConfirm: () => {
      project().deleteNode(id);
      ui().selectNode(null);
    },
  });
}

/* ------------------------------------------------------------------ *
   Environment
 * ------------------------------------------------------------------ */

export async function uploadEnvironment() {
  const [file] = await pickFiles(ENVIRONMENT_ACCEPT, false);
  if (!file) return;

  ui().setBusy(`Loading ${file.name}…`);
  try {
    const imported = await importEnvironmentFile(file);
    project().setCustomEnvironment(imported.key, imported.name);
    ui().toast('success', `Environment set to ${imported.name}`);
  } catch (error) {
    const detail =
      error instanceof EnvironmentImportError || error instanceof Error
        ? error.message
        : String(error);
    ui().toast('error', 'Could not load environment', detail);
  } finally {
    ui().setBusy(null);
  }
}

/* ------------------------------------------------------------------ *
   Material images
 * ------------------------------------------------------------------ */

/** Pick an image file and put it in one of a material's slots. */
export async function chooseMaterialImage(materialId: string, slot: TextureSlot) {
  const [file] = await pickFiles(IMAGE_ACCEPT, false);
  if (!file) return;

  ui().setBusy(`Loading ${file.name}…`);
  try {
    const ref = await importImageFile(file);
    const material = project().materials[materialId];
    if (!material) return;
    project().updateMaterial(
      materialId,
      { maps: { ...material.maps, [slot]: ref } },
      `material-${materialId}-image-${slot}`,
    );
  } catch (error) {
    const detail =
      error instanceof ImageImportError || error instanceof Error
        ? error.message
        : String(error);
    ui().toast('error', 'Could not load image', detail);
  } finally {
    ui().setBusy(null);
  }
}

export function clearMaterialImage(materialId: string, slot: TextureSlot) {
  const material = project().materials[materialId];
  if (!material?.maps?.[slot]) return;
  const { [slot]: _removed, ...rest } = material.maps;
  project().updateMaterial(materialId, { maps: rest }, `material-${materialId}-image-${slot}`);
}

/* ------------------------------------------------------------------ *
   Project files
 * ------------------------------------------------------------------ */

export async function saveProject() {
  try {
    // A model whose source copy has dropped out of memory is fetched back from
    // the automatic backup first; only what cannot be recovered is reported.
    const unrecovered = await rescueModelFiles();
    // Past a few hundred MB the model cannot go through one base64 string, so
    // the project is written as a binary container instead (see projectFile.ts).
    const probe = serializeProject(false);
    const binary =
      probe.assets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0) > BINARY_PROJECT_THRESHOLD;
    const { file, skipped: reported, assets } = binary ? probe : serializeProject();
    const hasData = (m: { id: string; bytes?: string }) =>
      binary ? assets.some((a) => a.kind === 'model' && a.key === m.id) : Boolean(m.bytes);
    // Judged on the file itself, not on what the serializer says about it: a
    // model entry with no bytes opens as nothing, whatever the reason.
    const skipped = [
      ...new Set([
        ...reported,
        ...file.models.filter((m) => m.source === 'file' && !hasData(m)).map((m) => m.name),
      ]),
    ];

    // What the save actually saw, for the dialog: one line per model.
    const diagnose = () => {
      const state = useProject.getState();
      return state.modelOrder
        .map((id) => {
          const m = state.models[id];
          if (!m) return `${id}: no model`;
          const stored = registry.getFile(m.fileKey);
          const entry = file.models.find((e) => e.id === id);
          return (
            `${m.name}: source=${m.source}, key=${m.fileKey ?? 'none'}, ` +
            `memory=${stored ? stored.bytes.byteLength : 'missing'}, ` +
            `file=${entry ? entry.bytes?.length ?? 'no bytes' : 'no entry'}, ` +
            `fileName=${entry?.fileName ?? 'none'}`
          );
        })
        .join('; ');
    };

    const write = () => {
      const blob = binary ? projectToBinaryBlob(file, assets) : projectToBlob(file);
      downloadBlob(blob, projectFilename(file.name, binary));
      ui().markSaved();
      if (skipped.length > 0) {
        ui().toast(
          'warn',
          'Project saved without some assets',
          `${skipped.join(', ')} could not be embedded. Reimport before saving again.`,
        );
      } else {
        // Say what actually went in, per model, so a file that is too small for its
        // model is visible straight away.
        const parts = file.models
          .filter((m) => m.source === 'file')
          .map((m) => `${m.name} ${formatBytes(binary ? (assets.find((x) => x.kind === 'model' && x.key === m.id)?.bytes.byteLength ?? 0) : Math.round(((m.bytes?.length ?? 0) * 3) / 4))}`);
        ui().toast(
          'success',
          'Project saved',
          `${formatBytes(blob.size)}${parts.length ? ` · model data: ${parts.join(', ')}` : ' · no models in the scene'}`,
        );
      }
    };

    if (skipped.length > 0) {
      // A file written without a model opens without it, and the model cannot be
      // recovered from that file. Say so before writing it, not after.
      ui().confirm({
        title: 'Save without the model data?',
        body:
          `The source data of ${unrecovered.length > 0 ? unrecovered.join(', ') : skipped.join(', ')} could not be found, so the saved file would ` +
          `[${diagnose()}] ` +
          'open without it. Cancel, import the model again and save; or save anyway to keep the ' +
          'materials, lights and camera.',
        confirmLabel: 'Save anyway',
        onConfirm: write,
      });
      return;
    }
    write();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    ui().toast('error', 'Could not save project', detail);
  }
}

export async function openProject() {
  const [file] = await pickFiles(PROJECT_ACCEPT, false);
  if (!file) return;

  const proceed = async () => {
    ui().setBusy(`Opening ${file.name}…`);
    registry.hold();
    try {
      const report = (await isBinaryProject(file))
        ? await loadProjectFromBinary(file)
        : await loadProjectFromText(await file.text());
      ui().markSaved(report.savedAt ?? Date.now());
      ui().selectNode(null);
      ui().selectLight(null);
      requestAnimationFrame(() => {
        const framing = frameAll();
        if (framing) project().updateCamera({ orthoZoom: framing.orthoZoom }, 'frame');
      });
      ui().toast(
        report.warnings.length > 0 ? 'warn' : 'success',
        `Opened ${report.name}`,
        report.warnings.length > 0
          ? report.warnings.join(' ')
          : `${report.models} model${report.models === 1 ? '' : 's'}`,
      );
    } catch (error) {
      const detail =
        error instanceof ProjectFileError || error instanceof Error
          ? error.message
          : String(error);
      ui().toast('error', 'Could not open project', detail);
    } finally {
      registry.release();
      ui().setBusy(null);
    }
  };

  if (project().modelOrder.length > 0) {
    ui().confirm({
      title: 'Open project',
      body: 'Opening a project replaces the current scene. Save first if you want to keep it.',
      confirmLabel: 'Open',
      onConfirm: () => void proceed(),
    });
    return;
  }
  await proceed();
}

export function resetScene() {
  ui().confirm({
    title: 'Reset scene',
    body: 'Remove every model, restore the default materials, lighting and camera, and start over. This can be undone.',
    confirmLabel: 'Reset scene',
    destructive: true,
    onConfirm: () => {
      project().resetScene();
      ui().selectNode(null);
      ui().selectLight(null);
      ui().toast('info', 'Scene reset');
    },
  });
}

/* ------------------------------------------------------------------ *
   Camera
 * ------------------------------------------------------------------ */

export function fitView() {
  const framing = frameAll();
  if (framing) project().updateCamera({ orthoZoom: framing.orthoZoom }, 'frame');
}

export function fitSelected() {
  const id = ui().selectedNodeId;
  if (!id) {
    fitView();
    return;
  }
  const group = ui().groupNodeIds;
  const framing = group.length > 1 ? frameNodes(group) : frameNode(id);
  if (framing) {
    project().updateCamera({ orthoZoom: framing.orthoZoom }, 'frame');
  } else {
    ui().toast('info', 'Nothing to frame', 'The selected object has no geometry.');
  }
}

export function applyView(direction: Vec3) {
  const framing = applyViewDirection(direction);
  if (framing) project().updateCamera({ orthoZoom: framing.orthoZoom }, 'frame');
}

/** The depth of field settings a saved view carries. */
function lensOfView(): NonNullable<import('./store/types').Viewpoint['lens']> {
  const { depthOfField, fStop, focusDistance } = project().render;
  return { depthOfField, fStop, focusDistance };
}

export function saveViewpoint() {
  const camera = project().camera;
  const state = readCameraState(camera.projection, camera.fov, camera.orthoZoom);
  if (!state) {
    ui().toast('error', 'Could not read the camera');
    return;
  }
  const index = project().viewpoints.length + 1;
  project().addViewpoint({ ...state, lens: lensOfView(), name: `View ${index}` });
  ui().toast('success', `Saved view ${index}`);
}

/** Writes the current view over a saved one, after asking. */
export function overwriteViewpoint(id: string) {
  const view = project().viewpoints.find((entry) => entry.id === id);
  if (!view) return;
  ui().confirm({
    title: 'Replace saved view',
    body: `Replace "${view.name}" with the view you see now? The old camera position cannot be brought back, except with Undo.`,
    confirmLabel: 'Replace',
    destructive: true,
    onConfirm: () => {
      const camera = project().camera;
      const state = readCameraState(camera.projection, camera.fov, camera.orthoZoom);
      if (!state) {
        ui().toast('error', 'Could not read the camera');
        return;
      }
      project().updateViewpoint(id, { ...state, lens: lensOfView() });
      ui().toast('success', `Updated ${view.name}`);
    },
  });
}

export function restoreViewpoint(id: string) {
  const viewpoint = project().viewpoints.find((view) => view.id === id);
  if (!viewpoint) return;
  // Its position already belongs to its FOV; no dolly zoom on top.
  fovBasis.value = viewpoint.fov;
  project().updateCamera({
    projection: viewpoint.projection,
    fov: viewpoint.fov,
    orthoZoom: viewpoint.orthoZoom,
  });
  if (viewpoint.lens) project().updateRender(viewpoint.lens, 'restore-view-lens');
  requestAnimationFrame(() => applyCameraState(viewpoint.position, viewpoint.target));
}

/* ------------------------------------------------------------------ *
   Rendering
 * ------------------------------------------------------------------ */

let controller: AbortController | null = null;

function isRendering() {
  return controller !== null;
}

/** Turns the path-traced viewport on or off. */
export function togglePathPreview() {
  const on = !ui().pathPreview;
  if (on && selectIsEmpty(project())) {
    ui().toast('info', 'Nothing to trace', 'Add a model first.');
    return;
  }
  ui().setPathPreview(on);
  if (on) {
    ui().toast(
      'info',
      'Path traced preview',
      'The viewport is now path traced and sharpens while you hold still. It is not a final render.',
    );
  }
}

export async function runRender() {
  if (controller) return;

  // The preview and a final render both want the GPU; the preview steps aside
  // and comes back afterwards.
  const resumePreview = ui().pathPreview;
  if (resumePreview) {
    ui().setPathPreview(false);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  const settings = project().render;
  const camera = project().camera;
  const tracing = settings.engine === 'pathtrace';
  const total = tracing ? settings.pathSamples : settings.samples;
  controller = new AbortController();

  ui().setRenderProgress({
    active: true,
    sample: 0,
    total,
    stage: 'Starting',
  });

  const lens = currentLens();
  const onProgress = (sample: number, count: number, stage: string) =>
    ui().setRenderProgress({ active: true, sample, total: count, stage });

  try {
    const output = tracing
      ? await renderPathTraced({
          width: settings.width,
          height: settings.height,
          samples: settings.pathSamples,
          bounces: settings.bounces,
          denoise: settings.denoise,
          denoiseStrength: settings.denoiseStrength,
          transparentBackground: settings.transparentBackground,
          orthoZoom: camera.orthoZoom,
          lens: lens ? { bokehSize: lens.bokehSize, focusDistance: lens.focusDistance } : null,
          signal: controller.signal,
          onProgress,
        })
      : await renderFinal({
          width: settings.width,
          height: settings.height,
          samples: settings.samples,
          aperture: lens?.apertureRadius ?? 0,
          focusDistance: lens?.focusDistance ?? targetDistance(),
          transparentBackground: settings.transparentBackground,
          orthoZoom: camera.orthoZoom,
          signal: controller.signal,
          onProgress,
        });

    ui().addRender({
      id: uid('render'),
      url: output.url,
      width: output.width,
      height: output.height,
      samples: output.samples,
      engine: settings.engine,
      createdAt: Date.now(),
      durationMs: output.durationMs,
    });
  } catch (error) {
    if (error instanceof RenderAborted) {
      ui().toast('info', 'Render cancelled');
    } else {
      // A few failures arrive with no message at all (a worker or the GPU
      // rejecting with nothing), which used to show up as the word "undefined".
      const detail =
        error instanceof Error
          ? error.message || `${error.name} (no message)`
          : error == null || error === ''
            ? 'The renderer stopped without giving a reason. See the browser console.'
            : String(error);
      // The toast has room for the message only; the stack goes to the
      // console, which is where anyone diagnosing a failed render will look.
      console.error('Render failed', error);
      ui().toast('error', 'Render failed', detail);
    }
  } finally {
    controller = null;
    ui().setRenderProgress({ active: false, sample: 0, total: 0, stage: '' });
    if (resumePreview) ui().setPathPreview(true);
  }
}

export function cancelRender() {
  controller?.abort();
}

export async function exportRender(id: string) {
  const render = ui().renders.find((item) => item.id === id);
  if (!render) return;
  try {
    const response = await fetch(render.url);
    const blob = await response.blob();
    const stamp = new Date(render.createdAt)
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    const name = projectFilename(project().name).replace(/\.rmproj\.json$/, '');
    downloadBlob(blob, `${name}-${render.width}x${render.height}-${stamp}.png`);
  } catch {
    ui().toast('error', 'Could not export the image');
  }
}

/**
 * Save what the viewport shows right now as a PNG.
 *
 * This is a capture of the real-time preview — the same raster renderer the
 * viewport uses, at the size of the viewport, with the grid, outlines and light
 * wireframes left out. It is not a final render, and the file name and the
 * message say so; use Render for a path-traced or accumulated image.
 */
export async function takeScreenshot() {
  const { gl, scene, camera } = viewport;
  if (!gl || !scene || !camera) {
    ui().toast('error', 'The viewport is not ready yet');
    return;
  }
  if (isRendering()) {
    ui().toast('info', 'A render is in progress');
    return;
  }

  const restore = hideForRender();
  let blob: Blob | null = null;
  try {
    gl.render(scene, camera);
    // toBlob snapshots the canvas when it is called, so the drawing buffer
    // does not need to survive until the callback.
    blob = await new Promise<Blob | null>((resolve) =>
      gl.domElement.toBlob(resolve, 'image/png'),
    );
  } finally {
    restore();
    requestRedraw();
  }

  if (!blob) {
    ui().toast('error', 'Could not capture the viewport');
    return;
  }
  const { width, height } = gl.domElement;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = projectFilename(project().name).replace(/\.rmproj\.json$/, '');
  downloadBlob(blob, `${name}-screenshot-${width}x${height}-${stamp}.png`);
  ui().toast(
    'success',
    'Screenshot saved',
    'A capture of the real-time preview, not a final render.',
  );
}

/* ------------------------------------------------------------------ *
   History
 * ------------------------------------------------------------------ */

export function undo() {
  if (!useProject.getState().canUndo) return;
  project().undo();
  const selected = ui().selectedNodeId;
  if (selected && !project().nodes[selected]) ui().selectNode(null);
}

export function redo() {
  if (!useProject.getState().canRedo) return;
  project().redo();
  const selected = ui().selectedNodeId;
  if (selected && !project().nodes[selected]) ui().selectNode(null);
}
