import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { SceneRoot } from '../scene/SceneRoot';
import { pickDepthAt, pickNodeAt } from '../scene/viewportApi';
import { worldToMm } from '../render/depthOfField';
import { selectIsEmpty, useProject } from '../store/project';
import { useUI } from '../store/ui';
import { EXAMPLE_MODEL } from '../scene/exampleModel';
import { Hud } from './Hud';
import {
  addExampleModel,
  selectAndReveal,
  fitSelected,
  fitView,
  importModel,
  togglePathPreview,
  importModelFiles,
  saveProject,
} from '../actions';
import { Button, IconButton, Tip } from './controls';
import { Toasts } from './Overlays';
import { ViewCube } from './ViewCube';
import { Icon } from './Icon';
import { SUPPORTED_EXTENSIONS } from '../io/importModel';

/**
 * Marks what the final image will contain when it is narrower than the view.
 *
 * Both render engines keep the camera's vertical extent and let the width
 * follow the output's aspect ratio, so the frame is the view's full height at
 * that ratio. A wider output simply sees more at the sides than the viewport
 * can show; no frame is drawn then, and the HUD says so.
 */
function OutputFrame({
  size,
  width,
  height,
}: {
  size: { width: number; height: number };
  width: number;
  height: number;
}) {
  if (size.width === 0 || size.height === 0 || width === 0 || height === 0) return null;
  const frameWidth = size.height * (width / height);
  if (frameWidth >= size.width - 1) return null;
  const band = (size.width - frameWidth) / 2;
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true" data-testid="output-frame">
      <div className="absolute inset-y-0 left-0 bg-shell/60" style={{ width: band }} />
      <div className="absolute inset-y-0 right-0 bg-shell/60" style={{ width: band }} />
      <div
        className="absolute inset-y-0 border-x border-line-strong"
        style={{ left: band, width: frameWidth }}
      />
    </div>
  );
}

/**
 * Keeps the interface alive when the 3D view cannot start. If the browser will
 * not hand out a WebGL context (typically right after the GPU process crashed),
 * the canvas throws while it mounts, and without a boundary that unmounts the
 * whole app and leaves a black window.
 */
class CanvasBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('The 3D view could not start', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="absolute inset-0 grid place-items-center bg-shell p-6">
        <div className="max-w-[360px] rounded-xl border border-danger/40 bg-panel p-5 text-center">
          <span className="mx-auto mb-2 grid size-7 place-items-center rounded-full border border-danger/40 text-danger">
            <Icon name="alert" />
          </span>
          <h2 className="text-title font-medium text-ink">The 3D view could not start</h2>
          <p className="mt-1 text-ctl leading-relaxed text-ink-dim">
            The browser would not give this page a graphics context. That usually
            follows a GPU reset: quit the browser completely (⌘Q), open it again and
            reload. In Chrome, chrome://gpu should say WebGL is hardware accelerated.
          </p>
          <div className="mt-3 flex justify-center gap-1.5">
            <Button
              tone="primary"
              onClick={() => {
                this.setState({ failed: false });
                this.props.onRetry();
              }}
            >
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

/** Treat a pointer release as a click only if it barely moved. */
const CLICK_SLOP = 5;

const VIEW_TOOL_CURSOR = {
  select: '',
  pan: 'cursor-grab',
  orbit: 'cursor-move',
  zoom: 'cursor-zoom-in',
} as const;

export function Viewport() {
  const host = useRef<HTMLDivElement>(null);
  const pressed = useRef<{ x: number; y: number } | null>(null);
  const [dragDepth, setDragDepth] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const isEmpty = useProject(selectIsEmpty);
  const showGrid = useUI((state) => state.showGrid);
  const setShowGrid = useUI((state) => state.setShowGrid);
  const showHud = useUI((state) => state.showHud);
  const setShowHud = useUI((state) => state.setShowHud);
  const showLightHelpers = useUI((state) => state.showLightHelpers);
  const setShowLightHelpers = useUI((state) => state.setShowLightHelpers);
  const selectedNodeId = useUI((state) => state.selectedNodeId);
  const busy = useUI((state) => state.busy);
  const busyProgress = useUI((state) => state.busyProgress);
  const busyEstimate = useUI((state) => state.busyEstimate);
  const contextLost = useUI((state) => state.contextLost);
  const contextLostNote = useUI((state) => state.contextLostNote);
  const canvasEpoch = useUI((state) => state.canvasEpoch);

  const showFrame = useUI((state) => state.showFrame);
  const pickingFocus = useUI((state) => state.pickingFocus);
  const viewTool = useUI((state) => state.viewTool);
  const paintBrush = useUI((state) => state.paintBrush);
  const pathPreview = useUI((state) => state.pathPreview);
  const pathSamples = useUI((state) => state.pathPreviewSamples);
  const previewLimit = useProject((state) => state.render.previewSamples);
  const outputWidth = useProject((state) => state.render.width);
  const outputHeight = useProject((state) => state.render.height);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const toNdc = useCallback((clientX: number, clientY: number) => {
    const rect = host.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * 2 - 1,
      y: -(((clientY - rect.top) / rect.height) * 2 - 1),
    };
  }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    pressed.current = { x: event.clientX, y: event.clientY };
  };

  const onPointerUp = (event: React.PointerEvent) => {
    const ndc = toNdc(event.clientX, event.clientY);
    const ui = useUI.getState();

    // A material being dragged out of the library lands here.
    const draggedMaterial = ui.dragMaterialId;
    if (draggedMaterial) {
      ui.setDragMaterial(null);
      const nodeId = ndc ? pickNodeAt(ndc.x, ndc.y) : null;
      if (!nodeId) {
        ui.toast('info', 'Nothing there', 'Drop a material onto an object to apply it.');
        return;
      }
      const node = useProject.getState().nodes[nodeId];
      if (node?.kind === 'mesh') {
        useProject.getState().assignMaterial(nodeId, draggedMaterial);
        selectAndReveal(nodeId);
      } else {
        useProject.getState().assignMaterialToModel(node.modelId, draggedMaterial);
      }
      return;
    }

    // Otherwise this is either a selection click or the end of an orbit drag.
    const start = pressed.current;
    pressed.current = null;
    if (!start || !ndc) return;
    const moved =
      Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y);
    if (moved > CLICK_SLOP) return;

    // "Select Focal Point": this click sets the focus instead of selecting.
    if (ui.pickingFocus) {
      const depth = pickDepthAt(ndc.x, ndc.y);
      if (depth === null) {
        ui.toast('info', 'Nothing there', 'Click on the model to focus on it.');
        return;
      }
      ui.setPickingFocus(false);
      useProject.getState().updateRender({ focusDistance: depth }, 'render-focus');
      ui.toast('success', 'Focal point set', `${Math.round(worldToMm(depth))} mm from the camera.`);
      return;
    }

    // With a view tool active the left button moves the view; it does not select.
    if (ui.viewTool !== 'select') return;

    // Paint brush: the part under the cursor takes the picked material and the
    // selection stays as it is.
    if (ui.paintBrush && ui.selectedMaterialId) {
      const nodeId = pickNodeAt(ndc.x, ndc.y);
      const node = nodeId ? useProject.getState().nodes[nodeId] : null;
      if (node?.kind === 'mesh') {
        useProject.getState().assignMaterial(node.id, ui.selectedMaterialId);
      } else if (node) {
        useProject.getState().assignMaterialToModel(node.modelId, ui.selectedMaterialId);
      }
      return;
    }

    const hit = pickNodeAt(ndc.x, ndc.y);
    // A click on empty space lets go of the picked material too.
    if (!hit) ui.deselectMaterial();
    selectAndReveal(hit);
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragDepth(0);
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length > 0) void importModelFiles(files);
  };

  return (
    <div
      ref={host}
      className={`relative min-h-0 min-w-0 flex-1 bg-shell ${
        pickingFocus ? 'cursor-crosshair' : paintBrush && viewTool === 'select' ? 'cursor-cell' : VIEW_TOOL_CURSOR[viewTool]
      }`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragDepth((depth) => depth + 1);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => setDragDepth((depth) => Math.max(0, depth - 1))}
      onDrop={onDrop}
    >
      {/* On-demand rendering: a product scene is still between interactions,
          so there is nothing to gain from redrawing it sixty times a second —
          and with the floor reflection each frame costs two passes over the
          geometry. Anything that changes the scene calls `invalidate`. */}
      <CanvasBoundary onRetry={() => useUI.getState().rebuildCanvas()}>
      <Canvas
        key={canvasEpoch}
        frameloop="demand"
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: false,
        }}
        resize={{ scroll: false }}
      >
        <SceneRoot />
      </Canvas>
      </CanvasBoundary>

      {showFrame && <OutputFrame size={size} width={outputWidth} height={outputHeight} />}
      <div className="pointer-events-none absolute top-2.5 left-2.5 flex flex-col items-start gap-1.5">
        <Hud viewWidth={size.width} viewHeight={size.height} />
      </div>

      {/* Viewport controls. Kept to one strip so the scene stays the subject. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5">
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-line bg-panel/85 p-1 backdrop-blur-sm">
          <IconButton size={30} iconSize={18} icon="frame" tip="Fit all  ·  A" onClick={fitView} />
          <IconButton
            size={30}
            iconSize={18}
            icon="target"
            tip="Frame selected  ·  F"
            onClick={fitSelected}
            disabled={!selectedNodeId}
          />
          <span className="mx-0.5 h-4 w-px bg-line" />
          <IconButton
            size={30}
            iconSize={18}
            icon="grid"
            tip="Grid  ·  G"
            active={showGrid}
            onClick={() => setShowGrid(!showGrid)}
          />
          <IconButton
            size={30}
            iconSize={18}
            icon="light"
            tip="Show light positions  ·  H"
            active={showLightHelpers}
            onClick={() => setShowLightHelpers(!showLightHelpers)}
          />
          <IconButton
            size={30}
            iconSize={18}
            icon="info"
            tip="Heads-up display — scene and output facts"
            active={showHud}
            onClick={() => setShowHud(!showHud)}
          />
        </div>

        {/* Right corner: the view cube, and under it the path traced preview
            button, whose sample counter opens to its left while it is on. */}
        <div className="flex flex-col items-end gap-1.5">
          <ViewCube />
          <div className="flex items-center gap-1.5">
          {pathPreview && (
            <div
              className="rounded-lg border border-amber-dim bg-panel/85 px-2.5 py-1 text-label text-amber backdrop-blur-sm"
              data-testid="path-preview-label"
            >
              {pathSamples < 0
                ? 'Path traced preview · preparing the scene…'
                : `Path traced preview · ${pathSamples} / ${previewLimit} samples${pathSamples >= previewLimit ? ' · done' : ''}`}
            </div>
          )}
          <div className="pointer-events-auto rounded-lg border border-line bg-panel/85 p-1 backdrop-blur-sm">
            <IconButton
            size={30}
            iconSize={18}
              icon="render"
              tip={
                pathPreview
                  ? 'Path traced preview is on — switch back to the fast viewport'
                  : 'Path traced preview — trace the viewport instead of rasterising it'
              }
              active={pathPreview}
              onClick={togglePathPreview}
            />
          </div>
          </div>
        </div>
      </div>

      <Toasts />

      {/* Drop target */}
      {dragDepth > 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-shell/70 ring-2 ring-amber ring-inset">
          <div className="flex flex-col items-center gap-2 text-ink">
            <Icon name="import" size={24} />
            <p className="text-title">Drop to import</p>
            <p className="text-label text-ink-dim">
              {SUPPORTED_EXTENSIONS.map((ext) => `.${ext}`).join('  ')}
            </p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {isEmpty && dragDepth === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
          <div className="pointer-events-auto w-full max-w-[340px] rounded-xl border border-line bg-panel/92 p-5 backdrop-blur-sm">
            {busy ? (
              // The import's progress takes the place of the buttons.
              <div role="status" data-testid="import-progress">
                <div className="flex items-baseline gap-2">
                  <h2 className="min-w-0 flex-1 truncate text-title font-medium text-ink">{busy}</h2>
                  {busyProgress !== null && !busyEstimate && (
                    <span className="shrink-0 text-label text-ink-dim tabular-nums">
                      {Math.round(busyProgress * 100)} %
                    </span>
                  )}
                </div>
                <ImportBar progress={busyProgress} estimate={busyEstimate} />
                <p className="mt-2 text-label text-ink-faint">
                  A large model can take a moment to read and prepare.
                </p>
              </div>
            ) : (
              <>
                <h2 className="text-title font-medium text-ink">The scene is empty</h2>
                <p className="mt-1 text-ctl leading-relaxed text-ink-dim">
                  Drag a model onto the viewport, or load the example bottle to start
                  setting up materials and lighting.
                </p>

                <div className="mt-3 flex gap-1.5">
                  <Button tone="primary" icon="import" onClick={() => void importModel()}>
                    Import model
                  </Button>
                  <Button onClick={() => void addExampleModel()}>{EXAMPLE_MODEL.name}</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Context loss */}
      {contextLost && (
        <div className="absolute inset-0 grid place-items-center bg-shell/92">
          <div className="max-w-[340px] rounded-xl border border-danger/40 bg-panel p-5 text-center">
            <Tip text="The GPU dropped the WebGL context">
              <span className="mx-auto mb-2 grid size-7 place-items-center rounded-full border border-danger/40 text-danger">
                <Icon name="alert" />
              </span>
            </Tip>
            <h2 className="text-title font-medium text-ink">Graphics context lost</h2>
            <p className="mt-1 text-ctl leading-relaxed text-ink-dim">
              The browser released the GPU context, usually after a driver reset or
              because too many contexts were open. Your scene is still in memory:
              try Restore view first, and save the project if it will not come back.
              After several resets Chrome stops giving out WebGL until it is quit
              completely (⌘Q) and opened again.
            </p>
            {contextLostNote && (
              <p className="mt-1.5 text-label text-ink-faint">{contextLostNote}</p>
            )}
            <div className="mt-3 flex justify-center gap-1.5">
              <Button onClick={saveProject} icon="save">
                Save project
              </Button>
              <Button
                tone="primary"
                onClick={() => {
                  useUI.getState().setContextLost(false);
                  useUI.getState().rebuildCanvas();
                }}
              >
                Restore view
              </Button>
              <Button onClick={() => window.location.reload()}>Reload</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The import bar. While the page is blocked by a parse nothing in JavaScript
 * can update it, so a stage that is expected to block hands over an estimate
 * and the bar glides towards it with a transform animation, which the browser
 * runs without the page's help. It slows as it nears the stage's end, so a slow
 * file looks busy rather than finished, and the real value takes over when the
 * stage ends. That is why no percentage is printed during such a stage.
 */
function ImportBar({
  progress,
  estimate,
}: {
  progress: number | null;
  estimate: { to: number; seconds: number } | null;
}) {
  const fill = useRef<HTMLDivElement>(null);
  const start = progress ?? 0;

  useEffect(() => {
    const element = fill.current;
    if (!element || !estimate || typeof element.animate !== 'function') return;
    const animation = element.animate(
      [{ transform: `scaleX(${Math.max(start, 0.03)})` }, { transform: `scaleX(${estimate.to})` }],
      { duration: estimate.seconds * 1000, easing: 'cubic-bezier(0.15, 0.7, 0.3, 1)', fill: 'forwards' },
    );
    return () => animation.cancel();
  }, [estimate, start]);

  return (
    <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-well">
      <div
        ref={fill}
        className="h-full origin-left rounded-full bg-amber transition-transform duration-300"
        style={{
          width: '100%',
          transform: progress === null ? undefined : `scaleX(${Math.max(progress, 0.03)})`,
        }}
      />
    </div>
  );
}
