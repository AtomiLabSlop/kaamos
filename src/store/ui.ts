import { create } from 'zustand';
import type { NodeId, RenderResult } from './types';
import { uid } from '../lib/util';
import type { CadDetail } from '../io/importCad';
import { loadRenderDefaults } from './renderDefaults';

/**
 * Ephemeral interface state, kept apart from the project document so that
 * selecting an object or opening a panel never lands in the undo history or in
 * a saved file.
 */

/** What the Move tool's handle does to the selected part. */
export type MoveMode = 'translate' | 'rotate';

/** The five tabs of the Project window. */
export type ProjectTab = 'scene' | 'material' | 'environment' | 'lighting' | 'camera';

export interface Toast {
  id: string;
  kind: 'info' | 'warn' | 'error' | 'success';
  message: string;
  detail?: string;
}

/** A toast kept in the notification history. */
export interface ToastRecord extends Toast {
  at: number;
}

export interface RenderProgress {
  active: boolean;
  sample: number;
  total: number;
  stage: string;
}

export interface Confirmation {
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  /** Runs when the dialog is cancelled or closed without confirming. */
  onCancel?: () => void;
}

export type ViewTool = 'select' | 'pan' | 'orbit' | 'zoom';

interface UIState {
  selectedNodeId: NodeId | null;
  /**
   * A group of parts picked together (all parts using a material). They are
   * outlined and marked in the tree, and Frame selected frames them all. Empty
   * in ordinary use; picking one part any other way clears it. `selectedNodeId`
   * is the group's first part, and the editing tools act on that one.
   */
  groupNodeIds: NodeId[];
  selectedMaterialId: string | null;
  /** While on, a click on a part gives it the picked material instead of selecting it. */
  paintBrush: boolean;
  selectedLightId: string | null;
  expandedNodeIds: Record<NodeId, boolean>;

  projectTab: ProjectTab;
  /** Materials window (left). */
  leftOpen: boolean;
  /** Project window (right). */
  rightOpen: boolean;
  renderWindowOpen: boolean;
  /** Top-left corner of the floating Render window; null means the default spot. */
  renderWindowPos: { x: number; y: number } | null;
  hotkeysOpen: boolean;
  /** About Kaamos: known limitations and the feedback link. */
  aboutOpen: boolean;

  showGrid: boolean;
  showLightHelpers: boolean;
  /** Heads-up display of scene and output facts in the viewport. */
  showHud: boolean;
  /** Frame that marks what the final image will contain. */
  showFrame: boolean;
  /** Keep the output aspect ratio when one dimension is edited. */
  lockAspect: boolean;

  busy: string | null;
  /** 0 to 1 while a long import reports real stages; null when it cannot say. */
  busyProgress: number | null;
  /** While a blocking stage runs: where the bar should glide to, and over how long. */
  busyEstimate: { to: number; seconds: number } | null;
  contextLost: boolean;
  /** What the renderer was holding when the context was lost, for a bug report. */
  contextLostNote: string | null;
  /** Bumped after a lost graphics context comes back, so the canvas is rebuilt from scratch. */
  canvasEpoch: number;
  dragMaterialId: string | null;
  /** True while the next viewport click chooses the depth-of-field focal point. */
  pickingFocus: boolean;
  /** True while the next viewport click places a new light that lights the clicked spot. */
  aimingLight: boolean;
  /** The viewport is being path traced rather than rasterised. */
  pathPreview: boolean;
  /** Samples accumulated so far by the path-traced preview. */
  pathPreviewSamples: number;
  dropActive: boolean;
  /** The Move tool: a handle in the viewport for moving or turning the selected part. */
  moveTool: boolean;
  /** What the left mouse button does in the viewport (the toolbar's view tools). */
  viewTool: ViewTool;
  moveMode: MoveMode;

  renderProgress: RenderProgress;
  renders: RenderResult[];
  previewRenderId: string | null;

  toasts: Toast[];
  /** The latest notifications, newest last. */
  toastHistory: ToastRecord[];
  toastHistoryOpen: boolean;
  /** When the project was last saved to a file (ms), or null. */
  lastSavedAt: number | null;
  /** When the working copy was last autosaved in this browser (ms), or null. */
  autosavedAt: number | null;
  /** True while there are changes that no saved file holds. */
  unsaved: boolean;
  confirmation: Confirmation | null;
  /** A STEP or IGES import waiting for the user to pick a detail level. */
  cadImport: { fileName: string } | null;
  /** The last detail level chosen, offered again next time. */
  cadDetail: CadDetail;

  selectNode(id: NodeId | null): void;
  selectNodes(ids: NodeId[]): void;
  selectMaterial(id: string | null): void;
  /** Nothing picked in the library any more; also ends the paint brush. */
  deselectMaterial(): void;
  setPaintBrush(on: boolean): void;
  selectLight(id: string | null): void;
  toggleNodeExpanded(id: NodeId): void;
  setNodeExpanded(id: NodeId, expanded: boolean): void;
  expandAll(ids: NodeId[]): void;

  setProjectTab(tab: ProjectTab): void;
  toggleLeft(): void;
  toggleRight(): void;
  /** Open the Project window on a given tab. */
  showProjectTab(tab: ProjectTab): void;
  setRenderWindowOpen(open: boolean): void;
  toggleRenderWindow(): void;
  setRenderWindowPos(pos: { x: number; y: number } | null): void;
  setHotkeysOpen(open: boolean): void;
  setAboutOpen(open: boolean): void;
  /** Put every window back where it starts. */
  setShowGrid(show: boolean): void;
  setShowLightHelpers(show: boolean): void;
  setShowHud(show: boolean): void;
  setShowFrame(show: boolean): void;
  setLockAspect(lock: boolean): void;

  setBusy(message: string | null): void;
  setBusyProgress(progress: number | null, estimate?: { to: number; seconds: number } | null): void;
  setContextLost(lost: boolean, note?: string): void;
  rebuildCanvas(): void;
  setDragMaterial(id: string | null): void;
  setPickingFocus(picking: boolean): void;
  setAimingLight(placing: boolean): void;
  setPathPreview(on: boolean): void;
  setPathPreviewSamples(samples: number): void;
  setDropActive(active: boolean): void;
  setMoveTool(on: boolean): void;
  setViewTool(tool: ViewTool): void;
  setMoveMode(mode: MoveMode): void;

  setRenderProgress(progress: Partial<RenderProgress>): void;
  addRender(result: RenderResult): void;
  removeRender(id: string): void;
  clearRenders(): void;
  setPreviewRender(id: string | null): void;

  toast(kind: Toast['kind'], message: string, detail?: string): void;
  dismissToast(id: string): void;
  setToastHistoryOpen(open: boolean): void;
  markSaved(at?: number): void;
  markAutosaved(): void;
  markUnsaved(): void;
  confirm(confirmation: Confirmation): void;
  closeConfirmation(): void;
  askCadDetail(fileName: string): void;
  setCadDetail(detail: CadDetail): void;
  closeCadImport(): void;
}

/** Keep render history bounded; each entry holds a full-size PNG blob URL. */
const MAX_RENDERS = 12;

export const useUI = create<UIState>((set, get) => ({
  selectedNodeId: null,
  groupNodeIds: [],
  selectedMaterialId: null,
  paintBrush: false,
  selectedLightId: null,
  expandedNodeIds: {},

  projectTab: 'scene',
  leftOpen: true,
  rightOpen: true,
  renderWindowOpen: false,
  renderWindowPos: null,
  hotkeysOpen: false,
  aboutOpen: false,

  showGrid: true,
  showLightHelpers: false,
  showHud: true,
  showFrame: loadRenderDefaults().showFrame ?? true,
  lockAspect: loadRenderDefaults().lockAspect ?? true,

  busy: null,
  busyProgress: null,
  busyEstimate: null,
  contextLost: false,
  contextLostNote: null,
  canvasEpoch: 0,
  dragMaterialId: null,
  pickingFocus: false,
  aimingLight: false,
  pathPreview: false,
  pathPreviewSamples: 0,
  dropActive: false,
  moveTool: false,
  viewTool: 'select',
  moveMode: 'translate',

  renderProgress: { active: false, sample: 0, total: 0, stage: '' },
  renders: [],
  previewRenderId: null,

  toasts: [],
  toastHistory: [],
  toastHistoryOpen: false,
  lastSavedAt: null,
  autosavedAt: null,
  unsaved: false,
  confirmation: null,
  cadImport: null,
  cadDetail: 'standard',

  selectNode(id) {
    set(id ? { selectedNodeId: id, groupNodeIds: [], paintBrush: false } : { selectedNodeId: id, groupNodeIds: [] });
    if (id && get().projectTab === 'lighting') set({ projectTab: 'material' });
  },
  selectNodes(ids) {
    set({ selectedNodeId: ids[0] ?? null, groupNodeIds: ids.length > 1 ? ids : [] });
  },
  selectMaterial(id) {
    set({ selectedMaterialId: id, projectTab: 'material', rightOpen: true });
  },
  deselectMaterial() {
    set({ selectedMaterialId: null, paintBrush: false });
  },
  setPaintBrush(on) {
    set({ paintBrush: on });
  },
  selectLight(id) {
    set(id ? { selectedLightId: id, projectTab: 'lighting', paintBrush: false } : { selectedLightId: id });
  },
  toggleNodeExpanded(id) {
    set({
      expandedNodeIds: {
        ...get().expandedNodeIds,
        [id]: !(get().expandedNodeIds[id] ?? false),
      },
    });
  },
  setNodeExpanded(id, expanded) {
    set({ expandedNodeIds: { ...get().expandedNodeIds, [id]: expanded } });
  },
  expandAll(ids) {
    const next = { ...get().expandedNodeIds };
    for (const id of ids) next[id] = true;
    set({ expandedNodeIds: next });
  },

  setProjectTab(projectTab) {
    set(
      projectTab === 'material'
        ? { projectTab, aimingLight: false }
        : { projectTab, paintBrush: false, aimingLight: projectTab === 'lighting' && get().aimingLight },
    );
  },
  showProjectTab(projectTab) {
    set(
      projectTab === 'material'
        ? { projectTab, rightOpen: true, aimingLight: false }
        : { projectTab, rightOpen: true, paintBrush: false, aimingLight: projectTab === 'lighting' && get().aimingLight },
    );
  },
  setRenderWindowOpen(renderWindowOpen) {
    set({ renderWindowOpen });
  },
  toggleRenderWindow() {
    set({ renderWindowOpen: !get().renderWindowOpen });
  },
  setRenderWindowPos(renderWindowPos) {
    set({ renderWindowPos });
  },
  setHotkeysOpen(hotkeysOpen) {
    set({ hotkeysOpen });
  },
  setAboutOpen(aboutOpen) {
    set({ aboutOpen });
  },
  toggleLeft() {
    set({ leftOpen: !get().leftOpen });
  },
  toggleRight() {
    set({ rightOpen: !get().rightOpen });
  },
  setShowGrid(showGrid) {
    set({ showGrid });
  },
  setShowLightHelpers(showLightHelpers) {
    set({ showLightHelpers });
  },
  setShowHud(showHud) {
    set({ showHud });
  },
  setShowFrame(showFrame) {
    set({ showFrame });
  },
  setLockAspect(lockAspect) {
    set({ lockAspect });
  },

  setBusy(busy) {
    set({ busy, busyProgress: null, busyEstimate: null });
  },
  setBusyProgress(busyProgress, busyEstimate = null) {
    set({ busyProgress, busyEstimate });
  },
  rebuildCanvas() {
    set({ canvasEpoch: get().canvasEpoch + 1 });
  },
  setContextLost(contextLost, note) {
    set({ contextLost, contextLostNote: contextLost ? (note ?? null) : null });
  },
  setDragMaterial(dragMaterialId) {
    set({ dragMaterialId });
  },
  setPathPreview(pathPreview) {
    // -1 means "preparing the scene": the viewport is still drawn by the
    // rasteriser until the path tracer has built it.
    set({ pathPreview, pathPreviewSamples: pathPreview ? -1 : 0 });
  },
  setPathPreviewSamples(pathPreviewSamples) {
    set({ pathPreviewSamples });
  },
  setAimingLight(aimingLight) {
    set({ aimingLight });
  },
  setPickingFocus(pickingFocus) {
    set({ pickingFocus });
  },
  setDropActive(dropActive) {
    set({ dropActive });
  },
  setMoveTool(moveTool) {
    set({ moveTool });
  },
  setViewTool(viewTool) {
    set({ viewTool });
  },
  setMoveMode(moveMode) {
    set({ moveMode });
  },

  setRenderProgress(progress) {
    set({ renderProgress: { ...get().renderProgress, ...progress } });
  },
  addRender(result) {
    const renders = [result, ...get().renders];
    const dropped = renders.splice(MAX_RENDERS);
    for (const old of dropped) URL.revokeObjectURL(old.url);
    set({ renders, previewRenderId: result.id, renderWindowOpen: true });
  },
  removeRender(id) {
    const target = get().renders.find((render) => render.id === id);
    if (target) URL.revokeObjectURL(target.url);
    set({
      renders: get().renders.filter((render) => render.id !== id),
      previewRenderId: get().previewRenderId === id ? null : get().previewRenderId,
    });
  },
  clearRenders() {
    for (const render of get().renders) URL.revokeObjectURL(render.url);
    set({ renders: [], previewRenderId: null });
  },
  setPreviewRender(previewRenderId) {
    set({ previewRenderId });
  },

  toast(kind, message, detail) {
    const id = uid('toast');
    const toast = { id, kind, message, detail };
    set({
      toasts: [...get().toasts, toast],
      toastHistory: [...get().toastHistory, { ...toast, at: Date.now() }].slice(-10),
    });
    // Long enough to read a sentence of detail; the history keeps the last ten.
    const linger = kind === 'error' ? 20000 : kind === 'warn' ? 14000 : 8000;
    setTimeout(() => get().dismissToast(id), linger);
  },
  setToastHistoryOpen(toastHistoryOpen) {
    set({ toastHistoryOpen });
  },
  markSaved(at = Date.now()) {
    set({ lastSavedAt: at, unsaved: false });
  },
  markAutosaved() {
    set({ autosavedAt: Date.now() });
  },
  markUnsaved() {
    if (!get().unsaved) set({ unsaved: true });
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((toast) => toast.id !== id) });
  },
  confirm(confirmation) {
    set({ confirmation });
  },
  closeConfirmation() {
    set({ confirmation: null });
  },
  askCadDetail(fileName) {
    set({ cadImport: { fileName } });
  },
  setCadDetail(detail) {
    set({ cadDetail: detail });
  },
  closeCadImport() {
    set({ cadImport: null });
  },
}));
