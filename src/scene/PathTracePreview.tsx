import { useEffect, useRef } from 'react';
import { patchSubsurface } from '../render/subsurface';
import { useFrame, useThree } from '@react-three/fiber';
import {
  HalfFloatType,
  Matrix4,
  type Scene,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import {
  type PathTracerModule,
  MAX_BOUNCES,
  transmissiveBounceBudget,
  loadPathTracer,
  prepareMaterials,
  patchNanGuard,
  tilesPerSideFor,
} from '../render/pathTracedRender';
import { currentLens } from '../render/depthOfField';
import { useProject } from '../store/project';
import { useUI } from '../store/ui';
import { hideForRender, subjectBounds } from './viewportApi';
import { rasterWithPrintedSides } from './PrintedSide';

/**
 * The viewport, path traced.
 *
 * While this is mounted the canvas shows the library's progressive path tracer
 * instead of the rasteriser: it keeps adding samples while the view is still,
 * starts over when the camera moves, and follows edits to the project. It is
 * the same engine as the final path-traced render, only unfinished — the
 * viewport says "Path traced preview" and a sample count the whole time, and
 * nothing here is written to an image.
 *
 * Differences from a final render, all deliberate: fewer bounces, a quarter of
 * the pixels on a high-density screen, no depth of field, and no folding of
 * `envMapIntensity` into the colour (that trick restores the old colour
 * afterwards, which would undo an edit made while the preview was running).
 */

type Tracer = InstanceType<PathTracerModule['WebGLPathTracer']>;

/**
 * The same bounce budget as the final render, so glass looks the same in the
 * preview and in the result. A smaller budget cut paths short inside the glass
 * and left it black.
 */
function applyBounces(tracer: Tracer) {
  const bounces = Math.min(Math.max(1, Math.round(useProject.getState().render.bounces)), MAX_BOUNCES);
  tracer.bounces = bounces;
  tracer.transmissiveBounces = transmissiveBounceBudget(bounces);
}

/**
 * After a material, light or environment edit the tracer starts over from
 * nothing. Instead of showing noise, the last converged picture is kept on
 * screen and the new samples are blended in over the part that changed (the
 * whole picture for a light or the environment). The old picture goes once the
 * new one has this many samples, or at once when the camera moves.
 */
const HOLD_SAMPLES = 32;
/** Extra room around a changed part, as a fraction of its size, for reflections nearby. */
const REGION_PAD = 0.12;

interface Hold {
  target: WebGLRenderTarget | null;
  active: boolean;
  /** Changed region in CSS pixels, origin lower left; null = whole picture. */
  region: { x: number; y: number; w: number; h: number } | null;
}

interface TracerInternals {
  _quad: {
    material: { map: unknown; opacity: number; blending: number };
    render: (renderer: unknown) => void;
  };
  rasterizeScene: boolean;
}

/** Screen rectangle (CSS pixels) covering the parts that use these materials. */
function changedRegion(
  materialIds: Set<string>,
  camera: import('three').Camera,
  width: number,
  height: number,
) {
  const nodes = useProject.getState().nodes;
  const box = subjectBoundsOf(
    Object.keys(nodes).filter((id) => {
      const materialId = nodes[id].materialId;
      return materialId !== null && materialIds.has(materialId);
    }),
  );
  if (!box) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const corner = new Vector3();
  for (let i = 0; i < 8; i++) {
    corner
      .set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z)
      .project(camera);
    // Behind the camera or far outside: not worth a rectangle.
    if (corner.z > 1) return null;
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
  }
  const padX = (maxX - minX) * REGION_PAD;
  const padY = (maxY - minY) * REGION_PAD;
  const x0 = Math.max(-1, minX - padX);
  const x1 = Math.min(1, maxX + padX);
  const y0 = Math.max(-1, minY - padY);
  const y1 = Math.min(1, maxY + padY);
  if (x1 <= x0 || y1 <= y0) return null;
  return {
    x: Math.floor(((x0 + 1) / 2) * width),
    y: Math.floor(((y0 + 1) / 2) * height),
    w: Math.ceil(((x1 - x0) / 2) * width),
    h: Math.ceil(((y1 - y0) / 2) * height),
  };
}

function subjectBoundsOf(nodeIds: string[]) {
  let union: ReturnType<typeof subjectBounds> = null;
  for (const id of nodeIds) {
    const box = subjectBounds(id);
    if (!box) continue;
    if (union) union.union(box);
    else union = box.clone();
  }
  return union;
}

function limitNow() {
  return useProject.getState().render.previewSamples;
}

export function PathTracePreview() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);

  const tracer = useRef<Tracer | null>(null);
  const limit = useProject((state) => state.render.previewSamples);
  useEffect(() => invalidate(), [limit, invalidate]);
  // The loop sleeps once the limit is reached, so a lens edit has to wake it.
  const lensSignature = useProject(
    (state) =>
      `${state.render.depthOfField}|${state.render.fStop}|${state.render.focusDistance}|${state.camera.fov}`,
  );
  useEffect(() => invalidate(), [lensSignature, invalidate]);
  const lastView = useRef({ world: new Matrix4(), projection: new Matrix4() });
  const lastReport = useRef({ samples: -1, at: 0 });
  const bufferSize = useRef(new Vector2());
  const lib = useRef<PathTracerModule | null>(null);
  const lensCamera = useRef<InstanceType<PathTracerModule['PhysicalCamera']> | null>(null);
  const lensKey = useRef('');
  const hold = useRef<Hold>({ target: null, active: false, region: null });
  const canvasSize = useRef(new Vector2());

  useEffect(() => {
    let disposed = false;
    let building = false;
    let rebuildAgain = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lightUpdate = false;
    // What changed since the last refresh: material ids, or the whole picture.
    const changedMaterials = new Set<string>();
    let changedEverything = false;
    let worker: { dispose?: () => void } | null = null;
    let created: Tracer | null = null;

    useUI.getState().setPathPreviewSamples(-1);
    const restoreHelpers = hideForRender({ dropGround: false, dropRasterOnly: true });
    let restoreMaterials = () => {};

    const prepare = () => {
      restoreMaterials();
      restoreMaterials = prepareMaterials(scene, { foldEnvIntensity: false });
    };

    const build = async () => {
      if (!created) return;
      if (building) {
        rebuildAgain = true;
        return;
      }
      building = true;
      hold.current.active = false; // a rebuilt scene has nothing to hold
      changedMaterials.clear();
      changedEverything = false;
      try {
        prepare();
        if (worker) await created.setSceneAsync(scene, camera);
        else created.setScene(scene, camera);
        if (!disposed) {
          tracer.current = created;
          lensKey.current = ''; // the rebuilt tracer holds the plain camera
          // The loop only runs when asked to, and nothing else asks once the
          // build is done, so ask.
          useUI.getState().setPathPreviewSamples(0);
          invalidate();
        }
      } catch (error) {
        console.error('Path traced preview could not build the scene', error);
        useUI.getState().toast(
          'error',
          'Path traced preview stopped',
          'The scene could not be prepared. Switching back to the normal viewport.',
        );
        useUI.getState().setPathPreview(false);
      } finally {
        building = false;
      }
      if (rebuildAgain && !disposed) {
        rebuildAgain = false;
        void build();
      }
    };

    /** Cheap path for edits that move no geometry: materials, lights, environment. */
    const refresh = () => {
      const active = tracer.current;
      if (!active) return;
      if (building) {
        // A scene build in progress was prepared before this edit (a light
        // switched off, say) and would be thrown away silently otherwise.
        rebuildAgain = true;
        return;
      }
      keepPicture(active);
      prepare();
      // Lights can sit in a rotated group; read their world matrices as they are now.
      scene.updateMatrixWorld(true);
      applyBounces(active);
      active.updateMaterials();
      active.updateLights();
      active.updateEnvironment();
    };

    /** Copies the picture on screen aside before the tracer starts over. */
    const keepPicture = (active: Tracer) => {
      const state = hold.current;
      const everything = changedEverything || changedMaterials.size === 0;
      const region = everything
        ? null
        : (gl.getSize(canvasSize.current),
          changedRegion(changedMaterials, camera, canvasSize.current.x, canvasSize.current.y));
      changedMaterials.clear();
      changedEverything = false;

      if (state.active) {
        // Already holding a picture that has not been replaced yet: keep it, and
        // widen the area that is being redrawn.
        if (!region || !state.region) state.region = null;
        else {
          const x0 = Math.min(state.region.x, region.x);
          const y0 = Math.min(state.region.y, region.y);
          const x1 = Math.max(state.region.x + state.region.w, region.x + region.w);
          const y1 = Math.max(state.region.y + state.region.h, region.y + region.h);
          state.region = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        }
        return;
      }
      if (active.samples < active.minSamples) return; // nothing converged to keep

      const source = active.target;
      if (
        !state.target ||
        state.target.width !== source.width ||
        state.target.height !== source.height
      ) {
        state.target?.dispose();
        state.target = new WebGLRenderTarget(source.width, source.height, { type: HalfFloatType });
      }
      const internals = active as unknown as TracerInternals;
      const quad = internals._quad;
      const previous = {
        map: quad.material.map,
        opacity: quad.material.opacity,
        blending: quad.material.blending,
      };
      const previousTarget = gl.getRenderTarget();
      quad.material.map = source.texture;
      quad.material.opacity = 1;
      quad.material.blending = 0; // NoBlending
      gl.setRenderTarget(state.target);
      quad.render(gl);
      gl.setRenderTarget(previousTarget);
      quad.material.map = previous.map;
      quad.material.opacity = previous.opacity;
      quad.material.blending = previous.blending;

      state.active = true;
      state.region = region;
    };

    const schedule = (geometryChanged: boolean) => {
      if (geometryChanged) lightUpdate = false;
      else if (!timer) lightUpdate = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (lightUpdate) refresh();
        else void build();
        lightUpdate = false;
      }, 250);
    };

    const unsubscribe = useProject.subscribe((state, previous) => {
      if (state === previous) return;
      // Putting an image on a part can give it UV coordinates, which live in
      // the geometry the tracer already holds, so that counts as a geometry edit.
      const geometryChanged =
        state.nodes !== previous.nodes ||
        state.models !== previous.models ||
        (state.materials !== previous.materials &&
          uvSignature(state.materials) !== uvSignature(previous.materials));
      const anything =
        geometryChanged ||
        state.materials !== previous.materials ||
        state.lights !== previous.lights ||
        state.environment !== previous.environment ||
        state.render.bounces !== previous.render.bounces;
      if (state.materials !== previous.materials) {
        for (const id of Object.keys(state.materials)) {
          if (state.materials[id] !== previous.materials[id]) changedMaterials.add(id);
        }
      }
      if (
        state.lights !== previous.lights ||
        state.environment !== previous.environment ||
        state.render.bounces !== previous.render.bounces
      ) {
        changedEverything = true;
      }
      if (anything) schedule(geometryChanged);
    });

    void (async () => {
      let lib_: PathTracerModule;
      try {
        lib_ = await loadPathTracer();
      } catch {
        useUI.getState().toast(
          'error',
          'Path traced preview unavailable',
          'The path tracer could not be loaded. Check the network connection.',
        );
        useUI.getState().setPathPreview(false);
        return;
      }
      if (disposed) return;
      lib.current = lib_;

      const instance = new lib_.WebGLPathTracer(gl);
      patchNanGuard(instance);
      patchSubsurface(instance);
      created = instance;
      applyBounces(instance);
      // Until it has enough samples the tracer draws a raster picture itself, at
      // the start and after every camera move; keep the label out of the glass's
      // refraction in that picture too, as the ordinary viewport does.
      instance.rasterizeSceneCallback = (rasterScene, rasterCamera) =>
        rasterWithPrintedSides(rasterScene as Scene, () => gl.render(rasterScene, rasterCamera));
      instance.multipleImportanceSampling = true;
      instance.filterGlossyFactor = 0.5;
      instance.textureSize = new Vector2(1024, 1024);
      // A high-density screen has four times the pixels to trace.
      instance.renderScale = gl.getPixelRatio() > 1 ? 0.5 : 1;

      try {
        const { ParallelMeshBVHWorker } = await import('three-mesh-bvh/worker');
        const instanceWorker = new ParallelMeshBVHWorker();
        instance.setBVHWorker(instanceWorker);
        worker = instanceWorker as unknown as { dispose?: () => void };
      } catch {
        worker = null;
      }
      if (!disposed) await build();
    })();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      tracer.current = null;
      hold.current.target?.dispose();
      hold.current = { target: null, active: false, region: null };
      created?.dispose();
      worker?.dispose?.();
      restoreMaterials();
      restoreHelpers();
      useUI.getState().setPathPreviewSamples(0);
      // Hand the canvas back to the rasteriser.
      invalidate();
    };
  }, [gl, scene, camera, invalidate]);

  // Priority 1 makes this loop do the drawing instead of R3F, which would
  // otherwise rasterise over the top.
  useFrame(() => {
    const active = tracer.current;
    if (!active) {
      // Until the scene is built, show the ordinary view rather than a blank.
      // Drawn once per request, not in a loop: building can take a while and
      // a busy loop would starve it.
      gl.render(scene, camera);
      return;
    }

    // Tiles follow the traced size, which is the drawing buffer times the
    // preview's render scale, so a large window does not mean large pieces of
    // GPU work.
    gl.getDrawingBufferSize(bufferSize.current);
    const scale = active.renderScale || 1;
    const tiles = tilesPerSideFor(bufferSize.current.x * scale, bufferSize.current.y * scale);
    if (active.tiles.x !== tiles || active.tiles.y !== tiles) active.tiles.set(tiles, tiles);

    camera.updateMatrixWorld();

    // Depth of field: the tracer only blurs through the library's physical
    // camera, so while the lens is on it traces a copy of the viewport camera
    // that carries the aperture and focus distance (the same lens the final
    // render uses). Changing the lens starts the accumulation over.
    const lens = camera.type === 'PerspectiveCamera' ? currentLens() : null;
    const key = lens ? `${lens.bokehSize}|${lens.focusDistance}` : '';
    const traced = active as unknown as { camera: unknown };
    if (lens && lib.current) {
      const physical = (lensCamera.current ??= new lib.current.PhysicalCamera());
      physical.copy(camera as never, false);
      physical.apertureBlades = 0;
      physical.apertureRotation = 0;
      physical.anamorphicRatio = 1;
      physical.updateMatrixWorld(true);
      physical.bokehSize = lens.bokehSize;
      physical.focusDistance = lens.focusDistance;
      traced.camera = physical;
    } else {
      traced.camera = camera;
    }
    const lensChanged = key !== lensKey.current;
    lensKey.current = key;

    const view = lastView.current;
    if (
      lensChanged ||
      !view.world.equals(camera.matrixWorld) ||
      !view.projection.equals(camera.projectionMatrix)
    ) {
      view.world.copy(camera.matrixWorld);
      view.projection.copy(camera.projectionMatrix);
      active.updateCamera();
      hold.current.active = false; // the old picture no longer matches the view
    }

    // Holding the last converged picture: show it, then let the tracer draw the
    // new samples over the changed area only.
    const held = hold.current;
    const internals = active as unknown as TracerInternals;
    if (held.active && held.target && active.samples >= Math.min(HOLD_SAMPLES, limitNow())) {
      held.active = false;
    }
    internals.rasterizeScene = !(held.active && held.target);
    let scissored = false;
    if (held.active && held.target) {
      const quad = internals._quad;
      const previous = {
        map: quad.material.map,
        opacity: quad.material.opacity,
        blending: quad.material.blending,
      };
      quad.material.map = held.target.texture;
      quad.material.opacity = 1;
      quad.material.blending = 0; // NoBlending
      gl.setRenderTarget(null);
      quad.render(gl);
      quad.material.map = previous.map;
      quad.material.opacity = previous.opacity;
      quad.material.blending = previous.blending;
      if (held.region) {
        gl.setScissorTest(true);
        gl.setScissor(held.region.x, held.region.y, held.region.w, held.region.h);
        scissored = true;
      }
    }

    // At the limit the tracer stops adding samples and only redraws what it
    // has, and the loop stops asking for frames, so the GPU goes idle.
    const limit = useProject.getState().render.previewSamples;
    const done = active.samples >= limit;
    active.pausePathTracing = done;
    active.renderSample();
    if (scissored) gl.setScissorTest(false);

    const now = performance.now();
    const samples = Math.min(Math.floor(active.samples), limit);
    if (samples !== lastReport.current.samples && (done || now - lastReport.current.at > 400)) {
      lastReport.current = { samples, at: now };
      useUI.getState().setPathPreviewSamples(samples);
    }
    if (!done) invalidate();
  }, 1);

  return null;
}

/** Which materials carry images, and how they project; a change means new UVs. */
function uvSignature(
  materials: Record<string, { maps?: object; mapProjection?: string; mapSingleSided?: boolean }>,
) {
  return Object.entries(materials)
    .map(([id, m]) =>
      Object.keys(m.maps ?? {}).length > 0
        ? `${id}:${m.mapProjection ?? 'auto'}:${m.mapSingleSided ? 1 : 0}`
        : '',
    )
    .join('|');
}
