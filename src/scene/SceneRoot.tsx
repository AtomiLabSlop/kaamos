import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useProject, useRootIds } from '../store/project';
import { useUI } from '../store/ui';
import { setThicknessScale, syncMaterials } from '../materials/materialInstances';
import { CameraRig } from './CameraRig';
import { BackgroundSync, EnvironmentRig } from './EnvironmentRig';
import { Ground } from './Ground';
import { MoveTool } from './MoveTool';
import { NodeView } from './NodeView';
import { PathTracePreview } from './PathTracePreview';
import { PrintedSide } from './PrintedSide';
import { RasterDepthOfField } from './RasterDepthOfField';
import { SelectionOutline } from './SelectionOutline';
import { StudioLights } from './StudioLights';
import { frameAll, savedPose, viewport, VIEWPORT_TRANSMISSION_SCALE } from './viewportApi';

/**
 * Publishes the live renderer onto the `viewport` handle and reports WebGL
 * context loss, which otherwise leaves a silently black canvas.
 */
function ViewportBridge() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  const invalidate = useThree((state) => state.invalidate);
  const set = useThree((state) => state.set);

  useEffect(() => {
    viewport.gl = gl;
    viewport.scene = scene;
    viewport.invalidate = invalidate;
    viewport.setFrameloop = (mode) => set({ frameloop: mode });
    return () => {
      viewport.gl = null;
      viewport.scene = null;
      viewport.invalidate = null;
      viewport.setFrameloop = null;
    };
  }, [gl, scene, invalidate, set]);

  useEffect(() => {
    gl.transmissionResolutionScale = VIEWPORT_TRANSMISSION_SCALE;
  }, [gl]);

  useEffect(() => {
    viewport.camera = camera as typeof viewport.camera;
  }, [camera]);

  useEffect(() => {
    viewport.controls = controls;
  }, [controls]);

  useEffect(() => {
    const canvas = gl.domElement;
    const onLost = (event: Event) => {
      // A canvas that is being replaced loses its context on purpose; only the
      // live one counts.
      if (viewport.gl?.domElement !== canvas) return;
      // Preventing the default lets the browser attempt a restore.
      event.preventDefault();
      const { camera: cam, controls: orbit } = viewport;
      if (cam && orbit) {
        savedPose.value = {
          position: [cam.position.x, cam.position.y, cam.position.z],
          target: [orbit.target.x, orbit.target.y, orbit.target.z],
        };
      }
      const ui = useUI.getState();
      // Counters kept on the CPU side, so they are still readable now. They say
      // how big the view and the scene were when the GPU gave up.
      const { memory, render } = gl.info;
      const note = `${canvas.width} × ${canvas.height} px · ${memory.textures} textures · ${memory.geometries} geometries · ${Math.round(render.triangles / 1000)}k triangles in the last frame`;
      console.warn('WebGL context lost:', note);
      ui.setContextLost(true, note);
      // Coming back into the same heavy path-traced view is what tends to lose
      // the context a second time, so it stays off until asked for again.
      if (ui.pathPreview) ui.setPathPreview(false);
    };
    const onRestored = () => {
      const ui = useUI.getState();
      ui.setContextLost(false);
      // Everything drawn once into a GPU buffer — the studio environment, the
      // ground shadow, the path tracer's state — is empty after a loss and is
      // not redrawn by itself, which left the scene darker and flatter than
      // before. A fresh canvas rebuilds all of it.
      ui.rebuildCanvas();
      ui.toast(
        'success',
        'Graphics context restored',
        'The view was rebuilt. Path traced preview is off; turn it on again when ready.',
      );
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    };
  }, [gl]);

  return null;
}

/**
 * Keeps the shared Three.js materials in step with their definitions.
 *
 * The values are written straight onto the existing materials, which React and
 * the renderer know nothing about — so this has to ask for the redraw itself.
 */
function MaterialSync() {
  const materials = useProject((state) => state.materials);
  // World-to-local factor for thickness: one over the first model's fit scale.
  const thicknessScale = useProject((state) => {
    const model = state.models[state.modelOrder[0] ?? ''];
    const scale = model ? state.nodes[model.rootNodeId]?.scale?.[0] : undefined;
    return scale && scale > 0 ? 1 / scale : 1;
  });
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    setThicknessScale(thicknessScale);
    syncMaterials(materials);
    invalidate();
  }, [materials, thicknessScale, invalidate]);
  return null;
}

/** Frames the subject the first time anything appears in an empty scene. */
function AutoFrame() {
  const count = useProject((state) => state.modelOrder.length);
  const previous = useRef(0);

  useEffect(() => {
    const wasEmpty = previous.current === 0;
    previous.current = count;
    if (!wasEmpty || count === 0) return;
    const frame = requestAnimationFrame(() => frameAll());
    return () => cancelAnimationFrame(frame);
  }, [count]);

  return null;
}

function SceneContent() {
  const rootIds = useRootIds();
  return (
    <>
      {rootIds.map((id) => (
        <NodeView key={id} id={id} />
      ))}
    </>
  );
}

export function SceneRoot() {
  const pathPreview = useUI((state) => state.pathPreview);
  // The preview shows the ordinary raster view until the tracer has built the
  // scene (-1 samples), and that view still needs the label kept out of the
  // glass's refraction.
  const preparing = useUI((state) => state.pathPreview && state.pathPreviewSamples < 0);
  // The fast viewport blurs by depth while the lens is on (perspective only).
  const rasterDof = useProject(
    (state) => state.render.depthOfField && state.camera.projection === 'perspective',
  );
  // Not while a final render runs: that takes the renderer over (size, targets,
  // camera) and the blur pass must not draw into the middle of it.
  const finalRendering = useUI((state) => state.renderProgress.active);
  return (
    <>
      <ViewportBridge />
      <MaterialSync />
      <CameraRig />
      <EnvironmentRig />
      {/* After EnvironmentRig, so leaving "environment" background mode wins. */}
      <BackgroundSync />
      <StudioLights />
      <Ground />
      <SceneContent />
      <AutoFrame />
      {pathPreview && <PathTracePreview />}
      {rasterDof && !pathPreview && !finalRendering && <RasterDepthOfField />}
      {/* In the path traced preview it draws over the tracer's picture instead. */}
      <SelectionOutline />
      {/* In the path traced preview the handle is drawn from its own scene. */}
      <MoveTool />
      {(!pathPreview || preparing) && <PrintedSide />}
    </>
  );
}
