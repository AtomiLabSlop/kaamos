import {
  Color,
  DataUtils,
  NoBlending,
  OrthographicCamera,
  PerspectiveCamera,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  HalfFloatType,
  type Mesh,
  type Object3D,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { patchFocusPlane } from './focusPlane';
import { patchSubsurface } from './subsurface';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { releasePrintedSides } from '../scene/PrintedSide';
import { hideForRender, isViewportReady, viewport } from '../scene/viewportApi';
import { nextFrame } from '../lib/util';
import { encodePng, readTarget } from './encodeImage';
import { RenderAborted, RenderError } from './renderErrors';
import { splitMultiMaterialMeshes } from './splitMultiMaterial';
import { DENOISE_PRESETS, type DenoiseStrength, createDenoiseMaterial, createDespeckleMaterial } from './denoise';

/**
 * Path-traced final render.
 *
 * This is a second, independent backend to the accumulating rasteriser in
 * `finalRender.ts`, and the difference is what light is allowed to do. The
 * rasteriser shades each surface once from the environment map; nothing a
 * surface emits or reflects ever reaches another surface. This traces rays:
 * light bounces, so a red part casts a red tint on the white one beside it,
 * a concave corner darkens on its own, glass refracts what is actually behind
 * it rather than a flat capture of it, and area lights throw real soft shadows
 * whose edges sharpen near the contact point.
 *
 * It is also far slower, which is the whole trade. The viewport stays on the
 * rasteriser; this runs only when a final image is asked for.
 *
 * The work is done by `three-gpu-pathtracer`, which builds a bounding-volume
 * hierarchy over the scene and runs the tracing in a fragment shader. It reads
 * the same `MeshPhysicalMaterial`s the viewport uses, so the material library
 * needs no second definition — the one real divergence is noted in
 * `prepareMaterials` below.
 *
 * Deprecation: the library marks `WebGLPathTracer` as superseded by a WebGPU
 * implementation. The WebGPU one needs its own renderer and its own scene, so
 * taking it would mean maintaining a second copy of the scene graph; the WebGL
 * class shares ours and still works. When the app moves to WebGPU, this file
 * is where that switch happens.
 */

export const MAX_BOUNCES = 20;

/**
 * A ray through a bottle crosses glass wall, liquid and glass wall again — six
 * or more surfaces before it leaves, more with a reflection inside — and a ray
 * that runs out of transmissive bounces mid-glass ends black. A floor of six
 * left no margin, so glass could render dark depending on the sampled paths.
 */
export const transmissiveBounceBudget = (bounces: number) =>
  Math.min(Math.max(bounces, 12), MAX_BOUNCES);

/** Handy sample counts: roughly a preview, a check, a proof and a final. */
export const PATH_SAMPLE_PRESETS = [16, 64, 128, 256, 512, 1024];

export interface PathTracedOptions {
  width: number;
  height: number;
  /** Rays per pixel. The only real quality control. */
  samples: number;
  /** How many times a ray may bounce before it is given up on. */
  bounces: number;
  transparentBackground: boolean;
  /** Smooths the remaining grain. Cheap, and costs a little fine detail. */
  denoise: boolean;
  /** How hard the denoiser works; ignored when `denoise` is off. */
  denoiseStrength?: DenoiseStrength;
  /** Vertical extent in world units, for orthographic output. */
  orthoZoom: number;
  /** Lens for depth of field, in the tracer's metre-like units. Null keeps everything sharp. */
  lens?: { bokehSize: number; focusDistance: number } | null;
  onProgress?: (sample: number, total: number, stage: string) => void;
  signal?: AbortSignal;
}

export interface PathTracedOutput {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  samples: number;
  durationMs: number;
}

/** Loaded on demand — the tracer is a large module and most sessions never render. */
export type PathTracerModule = typeof import('three-gpu-pathtracer');
let modulePromise: Promise<PathTracerModule> | null = null;
export const loadPathTracer = () => (modulePromise ??= import('three-gpu-pathtracer'));

/**
 * `isCompiling` exists on the class but is missing from the library's shipped
 * type declarations. Reading it through this keeps the gap in one place
 * instead of scattering casts through the render loop.
 */
const isCompiling = (tracer: object) =>
  Boolean((tracer as { isCompiling?: boolean }).isCompiling);

/**
 * Resolves the tracer's accumulated float buffer into a displayable image.
 *
 * The library has an equivalent internally, but it is not part of its public
 * surface, and this is a dozen lines. `toneMapping` and `linearToOutputTexel`
 * are injected by Three for any `ShaderMaterial`, so the result goes through
 * exactly the tone curve and transfer function the viewport uses.
 */
function createResolveMaterial(map: Texture) {
  return new ShaderMaterial({
    uniforms: { map: { value: map } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      void main() {
        gl_FragColor = texture2D(map, vUv);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
  });
}

/**
 * Reconciles the scene's materials with what the tracer expects, and returns a
 * function that puts every borrowed value back.
 */
export function prepareMaterials(
  scene: Scene,
  { foldEnvIntensity = true }: { foldEnvIntensity?: boolean } = {},
): () => void {
  const restores: (() => void)[] = [splitMultiMaterialMeshes(scene)];
  const seen = new Set<object>();

  /* The tracer merges meshes in the order of their uuids, which Three makes
     random on every page load, so the same scene reached the GPU in a
     different triangle and material order each time — matching the faults
     that came and went between reloads. Fixed uuids (in scene order) make the
     order the same every time; the originals are put back afterwards. */
  const ordered: { uuid: string }[] = [];
  scene.traverse((object) => {
    const mesh = object as { isMesh?: boolean; visible: boolean; uuid: string };
    if (mesh.isMesh && mesh.visible) ordered.push(mesh);
  });
  ordered.forEach((mesh, rank) => {
    const original = mesh.uuid;
    mesh.uuid = `kaamos-mesh-${String(rank).padStart(5, '0')}`;
    restores.push(() => {
      mesh.uuid = original;
    });
  });

  scene.traverse((object) => {
    const mesh = object as { isMesh?: boolean; material?: unknown; visible: boolean };
    if (!mesh.isMesh || !mesh.material || !mesh.visible) return;

    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object' || seen.has(entry)) continue;
      seen.add(entry);

      const material = entry as {
        envMapIntensity?: number;
        emissive?: Color;
        color?: Color;
        transmission?: number;
      };

      /* The tracer reads `emissive` without checking for it, so a material
         that has none — a basic material, or a custom shader on something
         imported — would bring the whole render down. Lending one for the
         duration means such a surface renders as unlit rather than taking
         everything with it. */
      if (!material.emissive) {
        material.emissive = new Color(0, 0, 0);
        restores.push(() => {
          delete material.emissive;
        });
      }

      /* `envMapIntensity` has no equivalent in a path tracer, which lights
         every surface from the real environment at full strength. The viewport
         uses it to tune how strongly a metal picks up its surroundings, so
         folding it into the colour keeps a material that was tuned in the
         preview looking the way it did there. Restored verbatim rather than by
         dividing, which would compound rounding across repeated renders. */
      /* Volumetric glass (thickness > 0) with an infinite attenuation distance
         has gone black on some GPUs: the tracer computes
         -log(colour) / distance and exp() of that times the path length, and
         an infinity there can turn into NaN. A huge but finite distance gives
         the same clear glass without the infinity. */
      const volumetric = material as { thickness?: number; attenuationDistance?: number };
      if ((volumetric.thickness ?? 0) > 0 && volumetric.attenuationDistance === Infinity) {
        volumetric.attenuationDistance = 1e6;
        restores.push(() => {
          volumetric.attenuationDistance = Infinity;
        });
      }

      const intensity = material.envMapIntensity;
      const colour = material.color;
      /* Not for transmissive materials: there the colour tints the light passing
         through, once for every surface crossed, so a Reflection of 1.2 would
         brighten whatever is seen through a bottle by 1.2 per wall (about 3×
         through a bottle with liquid in it) and wash the glass out. */
      const transmissive = (material.transmission ?? 0) > 0;
      if (
        foldEnvIntensity &&
        !transmissive &&
        typeof intensity === 'number' &&
        intensity !== 1 &&
        colour
      ) {
        const { r, g, b } = colour;
        restores.push(() => {
          colour.r = r;
          colour.g = g;
          colour.b = b;
        });
        colour.multiplyScalar(intensity);
      }
    }
  });

  return () => {
    for (const restore of restores) restore();
  };
}

/**
 * The tracer drops a path whose throughput has become NaN or infinite, using
 * `isnan` / `isinf`. Safari's shader compiler assumes such values never occur
 * and removes those tests, so every total-internal-reflection step inside
 * volumetric glass (which divides by a zero probability) lets an infinity
 * through and the pixel goes black; Chrome keeps the tests and only loses the
 * odd sample. Reading the exponent bits does the same check in a way the
 * compiler cannot optimise away.
 */
export function patchNanGuard(tracer: unknown) {
  const material = (tracer as { _pathTracer?: { material?: { fragmentShader?: string } } })
    ._pathTracer?.material;
  const guard = 'any( isnan( state.throughputColor ) ) || any( isinf( state.throughputColor ) )';
  const marker = '#define INFINITY 1e20';
  const source = material?.fragmentShader;
  if (!material || !source || !source.includes(guard) || !source.includes(marker)) {
    console.warn('Path tracer NaN guard could not be patched; the shader has changed');
    return;
  }
  material.fragmentShader = source
    .replace(
      marker,
      `${marker}\nbool kaamosNotFinite( vec3 v ) { uvec3 b = floatBitsToUint( v ); return any( equal( b & uvec3( 0x7f800000u ), uvec3( 0x7f800000u ) ) ); }`,
    )
    .replace(guard, 'kaamosNotFinite( state.throughputColor )');
}

/**
 * What the tracer ended up with as its environment: size and average colour of
 * the map it samples. A black or NaN average here would explain glass and
 * liquid, which see nothing but the environment, rendering black.
 */
function describeEnvironment(tracer: unknown, scene: Scene): string {
  const source = scene.environment as (Texture & { constructor: { name: string } }) | null;
  const lead = `scene.environment: ${source ? source.constructor.name : 'none'}, intensity ${scene.environmentIntensity}`;
  const info = (tracer as { _pathTracer?: { material?: { envMapInfo?: { map?: Texture } } } })
    ._pathTracer?.material?.envMapInfo;
  const image = info?.map?.image as { data?: ArrayLike<number>; width?: number; height?: number } | undefined;
  const data = image?.data;
  if (!data || !image?.width || !image.height) return `${lead}; tracer map: none`;

  const half = data instanceof Uint16Array;
  const step = 4 * Math.max(1, Math.floor((image.width * image.height) / 4096));
  let r = 0, g = 0, b = 0, n = 0, bad = 0;
  for (let i = 0; i + 2 < data.length; i += step) {
    const read = (k: number) => (half ? DataUtils.fromHalfFloat(data[i + k]) : data[i + k]);
    const pr = read(0), pg = read(1), pb = read(2);
    if (!Number.isFinite(pr + pg + pb)) { bad++; continue; }
    r += pr; g += pg; b += pb; n++;
  }
  const f = (v: number) => (n ? (v / n).toFixed(4) : 'n/a');
  return `${lead}; tracer map ${image.width}x${image.height}, mean rgb ${f(r)} ${f(g)} ${f(b)}, non-finite samples ${bad}/${n + bad}`;
}

/** One console line per mesh: the material values the tracer was given. */
function logMaterialTable(scene: Scene, elapsedMs: number, tracer: unknown) {
  const rows: Record<string, unknown>[] = [];
  scene.traverse((object) => {
    const mesh = object as { isMesh?: boolean; name: string; visible: boolean; material?: unknown };
    if (!mesh.isMesh || !mesh.visible) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    list.forEach((entry, index) => {
      const m = entry as Record<string, any> | undefined;
      if (!m) return;
      rows.push({
        mesh: mesh.name || '(unnamed)',
        slot: index,
        material: m.name || m.type,
        colour: m.color?.getHexString?.(),
        metal: m.metalness,
        rough: m.roughness,
        trans: m.transmission,
        ior: m.ior,
        thick: m.thickness,
        attDist: m.attenuationDistance,
        side: m.side,
        map: Boolean(m.map),
        bump: Boolean(m.bumpMap),
      });
    });
  });
  // What the tracer's own material texture holds for each entry: floats 44-55
  // are the thin-film flag, attenuation colour and distance, opacity, alpha
  // test and side. A value here that differs from the table above would mean
  // the material was mangled on its way to the GPU.
  const packed = (tracer as { _pathTracer?: { material?: { materials?: { image?: { data?: ArrayLike<number> } } } } })
    ._pathTracer?.material?.materials?.image?.data;
  const packedRows: string[] = [];
  if (packed) {
    const stride = 47 * 4;
    for (let i = 0; i < rows.length && (i + 1) * stride <= packed.length; i++) {
      const base = i * stride + 44;
      const part = Array.from({ length: 12 }, (_, k) => Number(packed[base + k]));
      packedRows.push(`${i}: ${part.map((v) => (Number.isFinite(v) ? +v.toPrecision(4) : String(v))).join(' ')}`);
    }
  }
  // Plain text, because Safari's table view cannot be copied from.
  console.log(
    `Path tracer material table (scene ready after ${Math.round(elapsedMs)} ms, ${rows.length} entries)\n` +
      describeEnvironment(tracer, scene) +
      '\n' +
      JSON.stringify(rows, null, 1) +
      '\npacked floats 44-55 per entry (thinFilm, -, -, -, attR, attG, attB, attDist, alphaMap, opacity, alphaTest, side)\n' +
      (packedRows.join('\n') || '(tracer material texture not reachable)'),
  );
}

/**
 * How many tiles per side an image of this size is cut into, so that no single
 * piece of GPU work is too long (see the note in `renderPathTraced`). Shared by
 * the final render and the path traced preview, whose tiles used to be the
 * library's fixed 3 x 3 and so grew with the window.
 */
export function tilesPerSideFor(width: number, height: number, triangles = 0): number {
  const base = isWebKitBrowser() ? 60000 : 200000;
  // A heavy scene makes every pixel dearer, so a tile must be smaller to stay
  // under the browser's limit on one piece of GPU work: above half a million
  // triangles the budget shrinks in proportion (a 2.3 M triangle scene with
  // 119 textures lost Chrome's graphics context at 200 000 pixels a tile).
  const heavy = triangles > 500000 ? 500000 / triangles : 1;
  const tilePixels = Math.max(30000, base * heavy);
  return Math.min(14, Math.max(3, Math.ceil(Math.sqrt((width * height) / tilePixels))));
}

/** Triangles in the visible meshes of a scene. */
function countTriangles(scene: Object3D): number {
  let total = 0;
  scene.traverseVisible((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry;
    total += geometry.index
      ? geometry.index.count / 3
      : (geometry.getAttribute('position')?.count ?? 0) / 3;
  });
  return Math.round(total);
}

/** Safari, and every browser on iOS, which all use WebKit's WebGL. */
function isWebKitBrowser(): boolean {
  const agent = globalThis.navigator?.userAgent ?? '';
  const ios = /iPad|iPhone|iPod/.test(agent);
  const safari = /Safari/.test(agent) && !/Chrome|Chromium|Android|Edg|OPR/.test(agent);
  return ios || safari;
}

/** True when sampled pixels are all the same colour (and the same alpha). */
function isFlatPicture(buffer: Uint8Array, width: number, height: number, transparent: boolean) {
  const stepX = Math.max(1, Math.floor(width / 64));
  const stepY = Math.max(1, Math.floor(height / 64));
  const first = [buffer[0], buffer[1], buffer[2], buffer[3]];
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * 4;
      if (
        Math.abs(buffer[i] - first[0]) > 2 ||
        Math.abs(buffer[i + 1] - first[1]) > 2 ||
        Math.abs(buffer[i + 2] - first[2]) > 2 ||
        (transparent && Math.abs(buffer[i + 3] - first[3]) > 2)
      ) {
        return false;
      }
    }
  }
  return true;
}

export async function renderPathTraced(
  options: PathTracedOptions,
): Promise<PathTracedOutput> {
  if (!isViewportReady()) throw new RenderError('The viewport is not ready yet.');

  const gl = viewport.gl as WebGLRenderer;
  const scene = viewport.scene as Scene;
  const camera = viewport.camera!;

  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height));
  const samples = Math.max(1, Math.round(options.samples));
  // The last stage reported, so a failure that carries no message of its own
  // can at least say where it happened.
  let stage = 'Starting';
  const report = (done: number, total: number, label: string) => {
    stage = label;
    options.onProgress?.(done, total, label);
  };
  const started = performance.now();

  report(0, samples, 'Loading the path tracer');
  let PathTracerLib: PathTracerModule;
  try {
    PathTracerLib = await loadPathTracer();
  } catch {
    throw new RenderError(
      'The path tracer could not be loaded. Check the network connection, or ' +
        'switch the engine back to Accumulated raster.',
    );
  }

  if (options.signal?.aborted) throw new RenderAborted('Render cancelled');

  /* ---- save every piece of renderer and camera state we touch ---- */
  const previousTarget = gl.getRenderTarget();
  const previousSize = gl.getSize(new Vector2());
  const previousPixelRatio = gl.getPixelRatio();
  const previousToneMapping = gl.toneMapping;
  const previousClearAlpha = gl.getClearAlpha();
  const previousPerspAspect =
    camera instanceof PerspectiveCamera ? camera.aspect : null;
  const previousOrtho =
    camera instanceof OrthographicCamera
      ? {
          left: camera.left,
          right: camera.right,
          top: camera.top,
          bottom: camera.bottom,
          zoom: camera.zoom,
        }
      : null;

  viewport.setFrameloop?.('never');
  // The contact shadow and the planar mirror are rasteriser stand-ins for
  // exactly the light transport this engine computes properly, so they go.
  const restoreHelpers = hideForRender({
    dropGround: options.transparentBackground,
    dropRasterOnly: true,
  });
  // The label's refraction workaround is a rasteriser matter; the tracer gets
  // the plain materials.
  releasePrintedSides();
  const restoreMaterials = prepareMaterials(scene);
  // The tracer writes alpha 0 only where a ray escapes to a null background, so
  // a transparent render needs the background removed while the scene is
  // handed over, as the raster engine does.
  const previousBackground = scene.background;
  if (options.transparentBackground) scene.background = null;

  let tracer: InstanceType<PathTracerModule['WebGLPathTracer']> | null = null;
  let output: WebGLRenderTarget | null = null;
  let quad: FullScreenQuad | null = null;
  let despeckled: WebGLRenderTarget | null = null;

  try {
    /* ---- the tracer sizes itself from the drawing buffer ----
       Unlike the rasteriser, which renders into a target of any size, this one
       reads the renderer's own buffer, so the canvas is resized for the
       duration. `updateStyle: false` leaves the element's CSS size alone, and
       the progress overlay covers it meanwhile. */
    gl.setPixelRatio(1);
    gl.setSize(width, height, false);

    if (camera instanceof PerspectiveCamera) {
      camera.aspect = width / height;
    } else if (camera instanceof OrthographicCamera) {
      camera.left = -width / 2;
      camera.right = width / 2;
      camera.top = height / 2;
      camera.bottom = -height / 2;
      camera.zoom = height / Math.max(options.orthoZoom, 0.01);
    }
    camera.updateProjectionMatrix();

    // Depth of field needs the library's physical camera, which carries the
    // aperture and focus distance. It is a copy, so the viewport's own camera
    // is never swapped out.
    let tracerCamera: PerspectiveCamera | OrthographicCamera = camera;
    if (options.lens && camera instanceof PerspectiveCamera) {
      const physical = new PathTracerLib.PhysicalCamera();
      // copy() takes the aperture fields from the source, which a plain camera
      // lacks: they would become undefined (NaN in the shader, a flat picture).
      physical.copy(camera, false);
      physical.apertureBlades = 0;
      physical.apertureRotation = 0;
      physical.anamorphicRatio = 1;
      physical.updateMatrixWorld(true);
      physical.bokehSize = options.lens.bokehSize;
      physical.focusDistance = options.lens.focusDistance;
      tracerCamera = physical;
    }

    tracer = new PathTracerLib.WebGLPathTracer(gl);
    patchNanGuard(tracer);
    patchSubsurface(tracer);
    patchFocusPlane(tracer);
    // Everything below turns off the interactive behaviour: no warm-up delay,
    // no low-resolution preview, no fade-in, and no drawing to the canvas,
    // because the result is read from the target instead.
    tracer.renderToCanvas = false;
    tracer.renderDelay = 0;
    tracer.minSamples = 0;
    tracer.fadeDuration = 0;
    tracer.enablePathTracing = true;
    tracer.pausePathTracing = false;
    tracer.renderScale = 1;
    tracer.bounces = Math.min(Math.max(1, Math.round(options.bounces)), MAX_BOUNCES);
    // Light passing through glass is cheap compared with a diffuse bounce and
    // matters more for a product shot, so it gets its own, higher budget.
    tracer.transmissiveBounces = transmissiveBounceBudget(tracer.bounces);
    /* The library draws one tile per call, and the GPU is given one tile's work
       at a time. Safari drops the whole WebGL context when a single piece of
       work runs too long, which ended renders with "context lost" at the
       default 1600 x 1200 split into the library's 3 x 3 tiles (about 213 000
       pixels each, through glass). Smaller tiles keep each piece short, at the
       price of more frames per sample, so a render takes longer. Chrome coped
       with the 3 x 3 default, so only WebKit browsers get the small tiles. */
    const tilesPerSide = tilesPerSideFor(width, height, countTriangles(scene));
    tracer.tiles.set(tilesPerSide, tilesPerSide);
    // Importance sampling aims rays at the lights rather than hoping to hit
    // them, which is most of what keeps a small bright source from producing
    // a storm of white speckles.
    tracer.multipleImportanceSampling = true;
    // Blurs very sharp glossy reflections a little as they bounce. It trades a
    // touch of accuracy for a large reduction in fireflies.
    tracer.filterGlossyFactor = 0.5;
    tracer.textureSize = new Vector2(2048, 2048);

    /* ---- build the ray acceleration structure ----
       Every ray has to find what it hits, which means a bounding-volume
       hierarchy over the whole scene. Built on worker threads when they can be
       started, because a CAD assembly of a few million triangles takes long
       enough that doing it on the main thread would freeze the window.
       `setSceneAsync` requires the worker, so the fallback uses the
       synchronous path rather than failing. */
    report(0, samples, 'Building the ray acceleration structure');

    let bvhWorker: { dispose?: () => void } | null = null;
    try {
      const { ParallelMeshBVHWorker } = await import('three-mesh-bvh/worker');
      const worker = new ParallelMeshBVHWorker();
      tracer.setBVHWorker(worker);
      bvhWorker = worker as unknown as { dispose?: () => void };
    } catch {
      bvhWorker = null;
    }

    if (bvhWorker) {
      try {
        await tracer.setSceneAsync(scene, tracerCamera, {
          onProgress: (fraction: number) =>
            report(0, samples, `Building geometry  ${Math.round(fraction * 100)}%`),
        });
      } finally {
        bvhWorker.dispose?.();
      }
    } else {
      // Blocks until the hierarchy is built; the progress overlay is already up.
      tracer.setScene(scene, tracerCamera);
    }

    if (options.signal?.aborted) throw new RenderAborted('Render cancelled');

    // What the tracer was handed, for comparing a good render with a bad one.
    logMaterialTable(scene, performance.now() - started, tracer);

    // Shader compilation happens on the first sample and can take seconds.
    report(0, samples, 'Compiling shaders');
    while (isCompiling(tracer)) {
      tracer.renderSample();
      await nextFrame();
      if (options.signal?.aborted) throw new RenderAborted('Render cancelled');
    }

    /* ---- trace ---- */
    // The library renders one *tile* per call (3×3 by default), so a sample
    // takes nine calls and the call count says nothing about whether the tracer
    // is stuck. Stalling therefore means the sample count has stopped moving,
    // not that many calls were made. A fixed call budget of a few times the
    // sample count tripped at about 90 samples and cut real renders short.
    // The library advances its sample counter on the CPU for every tile it
    // draws, so the count only stops while it believes a shader is compiling.
    // That can happen again mid-render and, for a glass scene on Safari, take
    // longer than a couple of hundred frames; so stalling is judged in
    // seconds, not calls.
    let lastProgress = performance.now();
    let lastSamples = tracer.samples;
    while (tracer.samples < samples) {
      if (options.signal?.aborted) throw new RenderAborted('Render cancelled');

      // The library counts samples on the CPU, so a render whose graphics context
      // was lost halfway carries on counting and ends as a flat grey picture.
      // Stop the moment the context is gone, and say so.
      if (gl.getContext().isContextLost()) {
        throw new RenderError(
          `The graphics context was lost after about ${Math.floor(tracer.samples)} of ${samples} ` +
            'samples (the GPU reset, usually because the picture is large or the render long). ' +
            'Try a smaller output size or fewer samples.',
        );
      }
      tracer.renderSample();
      const done = Math.min(Math.floor(tracer.samples), samples);
      report(done, samples, `Sample ${done} of ${samples}`);

      // Hand the frame back so the progress bar moves and Cancel stays live.
      await nextFrame();

      const now = performance.now();
      if (tracer.samples > lastSamples) {
        lastSamples = tracer.samples;
        lastProgress = now;
      } else if (now - lastProgress > 5000) {
        // A lost graphics context leaves a compile that never finishes.
        if (gl.getContext().isContextLost()) {
          throw new RenderError(
            'The graphics context was lost during the render (the GPU reset, ' +
              'usually because a frame was too heavy). Try a smaller output size ' +
              'or fewer samples, or switch the engine back to Accumulated raster.',
          );
        }
        if (now - lastProgress > 90000) {
          throw new RenderError(
            'The path tracer stopped making progress for 90 seconds. Try fewer ' +
              'samples, or switch the engine back to Accumulated raster.',
          );
        }
      }
    }

    /* ---- resolve the accumulated float buffer into an 8-bit image ----
       Both materials below apply tone mapping and the sRGB transfer function
       in their own shader, so the renderer's tone mapping is switched off for
       this pass to keep it from being applied a second time. */
    report(samples, samples, options.denoise ? 'Denoising' : 'Encoding PNG');

    output = new WebGLRenderTarget(width, height, {
      type: UnsignedByteType,
      colorSpace: SRGBColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
    });

    // The denoiser tone maps and encodes in its own shader, so it replaces the
    // resolve pass rather than preceding it.
    let resolveMaterial: ShaderMaterial;
    if (options.denoise) {
      const preset = DENOISE_PRESETS[options.denoiseStrength ?? 'medium'];
      let source: Texture = tracer.target.texture;
      if (preset.despeckle) {
        // Firefly pass first: it clips isolated bright samples (light that
        // reached the camera through glass by chance) so the blur has nothing
        // to smear. Half float keeps the radiance unclamped between passes.
        despeckled = new WebGLRenderTarget(width, height, { type: HalfFloatType, depthBuffer: false });
        const dq = new FullScreenQuad(createDespeckleMaterial(tracer.target.texture, preset.despeckle));
        gl.setRenderTarget(despeckled);
        dq.render(gl);
        dq.material.dispose();
        dq.dispose();
        source = despeckled.texture;
      }
      resolveMaterial = createDenoiseMaterial(
        PathTracerLib.DenoiseMaterial,
        source,
        { depthTest: false, depthWrite: false, blending: NoBlending },
        preset.denoise,
      );
    } else {
      resolveMaterial = createResolveMaterial(tracer.target.texture);
    }

    // The resolve shaders read `toneMapping` as a shader define, so it has to
    // be set while they compile, not switched off first.
    quad = new FullScreenQuad(resolveMaterial);
    gl.setRenderTarget(output);
    gl.setClearAlpha(options.transparentBackground ? 0 : 1);
    gl.clear(true, false, false);
    quad.render(gl);

    const buffer = new Uint8Array(width * height * 4);
    report(samples, samples, 'Reading the image back from the GPU');
    await readTarget(gl, output, width, height, buffer);

    if (gl.getContext().isContextLost()) {
      throw new RenderError(
        'The graphics context was lost before the image could be read back, so the picture would be empty. ' +
          'Try a smaller output size or fewer samples.',
      );
    }
    // Measured, not assumed: a picture that is one single colour all over has
    // not been rendered (a scene always has at least a background and a floor).
    if (isFlatPicture(buffer, width, height, Boolean(options.transparentBackground))) {
      throw new RenderError(
        `The render finished but the picture is one flat colour (${width} × ${height}, ${samples} samples). ` +
          'The GPU most likely gave up on it without telling the page. Try a smaller output size, ' +
          'fewer samples, or depth of field off, and report if it keeps happening.',
      );
    }

    report(samples, samples, 'Encoding PNG');
    const blob = await encodePng(buffer, width, height);

    return {
      blob,
      url: URL.createObjectURL(blob),
      width,
      height,
      samples,
      durationMs: performance.now() - started,
    };
  } catch (error) {
    if (error instanceof RenderAborted || error instanceof RenderError) throw error;
    if (error instanceof Error && error.message) throw error;
    // Some failures arrive as `undefined` (a worker or the GPU rejecting with
    // nothing). Name the stage, and keep whatever was thrown for the console.
    console.error('Path tracer failure without a message', { stage, error });
    throw new RenderError(
      `The path tracer failed during "${stage.replace(/\s+\d+%$/, '')}" without saying why.`,
    );
  } finally {
    /* ---- put everything back ---- */
    quad?.material.dispose();
    quad?.dispose();
    output?.dispose();
    despeckled?.dispose();
    tracer?.dispose();
    restoreMaterials();
    restoreHelpers();
    scene.background = previousBackground;

    if (camera instanceof PerspectiveCamera && previousPerspAspect !== null) {
      camera.aspect = previousPerspAspect;
    }
    if (camera instanceof OrthographicCamera && previousOrtho) {
      camera.left = previousOrtho.left;
      camera.right = previousOrtho.right;
      camera.top = previousOrtho.top;
      camera.bottom = previousOrtho.bottom;
      camera.zoom = previousOrtho.zoom;
    }
    camera.updateProjectionMatrix();

    gl.toneMapping = previousToneMapping;
    gl.setClearAlpha(previousClearAlpha);
    gl.setPixelRatio(previousPixelRatio);
    gl.setSize(previousSize.x, previousSize.y, false);
    gl.setRenderTarget(previousTarget);

    viewport.setFrameloop?.('demand');
    viewport.invalidate?.();
  }
}
