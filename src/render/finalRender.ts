import {
  OrthographicCamera,
  PerspectiveCamera,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import { applyCameraRoll, hideForRender, isViewportReady, viewport } from '../scene/viewportApi';
import { nextFrame } from '../lib/util';
import { encodePng, readTarget } from './encodeImage';
import { RenderAborted, RenderError } from './renderErrors';

/**
 * Final render.
 *
 * This is not a path tracer. It is the same physically based rasteriser the
 * viewport uses, driven offscreen at the output resolution and accumulated over
 * many passes. Each pass jitters the camera by a fraction of a pixel, and, when
 * an aperture is set, across the area of the lens. Averaging the passes gives
 * genuine anti-aliasing and genuine optical depth of field — both of which come
 * from the sampling, not from a post-process blur — at a resolution that is
 * independent of the window.
 *
 * What it does not give you: light that bounces. Indirect illumination comes
 * from the environment map alone, as it does in the viewport. A render at 64
 * passes is a clean, high-resolution version of what you are already looking
 * at, which is why the interface calls it "accumulated passes" rather than
 * "samples" and never calls the result path-traced.
 */

export const MAX_DIMENSION = 4096;
export const MAX_PIXELS = 12_000_000;
export const MAX_SAMPLES = 256;

export interface FinalRenderOptions {
  width: number;
  height: number;
  samples: number;
  /** Lens radius in world units. 0 renders everything in focus. */
  aperture: number;
  /** 0 focuses on the orbit target. */
  focusDistance: number;
  transparentBackground: boolean;
  /** Vertical extent in world units, for orthographic output. */
  orthoZoom: number;
  onProgress?: (sample: number, total: number, stage: string) => void;
  signal?: AbortSignal;
}

export interface FinalRenderOutput {
  blob: Blob;
  url: string;
  width: number;
  height: number;
  samples: number;
  durationMs: number;
}

export { RenderAborted, RenderError } from './renderErrors';

/** Low-discrepancy sequence — spreads samples far more evenly than random. */
function halton(index: number, base: number) {
  let result = 0;
  let fraction = 1 / base;
  let i = index;
  while (i > 0) {
    result += fraction * (i % base);
    i = Math.floor(i / base);
    fraction /= base;
  }
  return result;
}

export async function renderFinal(
  options: FinalRenderOptions,
): Promise<FinalRenderOutput> {
  if (!isViewportReady()) {
    throw new RenderError('The viewport is not ready yet.');
  }

  const gl = viewport.gl!;
  const scene = viewport.scene!;
  const camera = viewport.camera!;

  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height));
  const samples = Math.min(Math.max(1, Math.round(options.samples)), MAX_SAMPLES);

  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new RenderError(`Each side must be ${MAX_DIMENSION} px or less.`);
  }
  if (width * height > MAX_PIXELS) {
    throw new RenderError(
      `${width}×${height} is above the ${(MAX_PIXELS / 1_000_000).toFixed(0)} megapixel limit.`,
    );
  }

  const started = performance.now();
  const report = options.onProgress ?? (() => {});

  /* ---- save everything we are about to change ---- */
  const previousTarget = gl.getRenderTarget();
  const previousBackground = scene.background;
  const previousClearAlpha = gl.getClearAlpha();
  const previousPosition = camera.position.clone();
  const previousQuaternion = camera.quaternion.clone();
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
  // The viewport refracts at reduced size; the image gets the full-size picture.
  const previousTransmissionScale = gl.transmissionResolutionScale;
  gl.transmissionResolutionScale = 1;
  // The grid, selection outline and light wireframes are for working in the
  // viewport and have no business in the output image. A transparent render
  // also drops the backdrop, so the product comes out as a cut-out with its
  // ground shadow carried in the alpha channel.
  const restoreHelpers = hideForRender({
    dropGround: options.transparentBackground,
  });

  const target = new WebGLRenderTarget(width, height, {
    type: UnsignedByteType,
    // Tone mapping and the sRGB transfer function are applied on the way into
    // this target, exactly as they are for the canvas.
    colorSpace: SRGBColorSpace,
    depthBuffer: true,
    stencilBuffer: false,
    samples: 0,
  });

  // Accumulating in float avoids the banding an 8-bit running average would
  // introduce after a dozen passes.
  const accumulator = new Float32Array(width * height * 4);
  const readBuffer = new Uint8Array(width * height * 4);

  const focusPoint = new Vector3();
  const forward = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  const orbitTarget = viewport.controls?.target.clone() ?? new Vector3();

  const canDoDof = camera instanceof PerspectiveCamera && options.aperture > 0;
  const focusDistance =
    options.focusDistance > 0
      ? options.focusDistance
      : Math.max(previousPosition.distanceTo(orbitTarget), 0.01);

  if (canDoDof) {
    forward.copy(orbitTarget).sub(previousPosition);
    if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
    forward.normalize();
    focusPoint.copy(previousPosition).addScaledVector(forward, focusDistance);
    right.crossVectors(forward, new Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
    right.normalize();
    up.crossVectors(right, forward).normalize();
  }

  try {
    if (options.transparentBackground) {
      scene.background = null;
      gl.setClearAlpha(0);
    } else {
      gl.setClearAlpha(1);
    }

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

    gl.setRenderTarget(target);

    for (let index = 0; index < samples; index += 1) {
      if (options.signal?.aborted) throw new RenderAborted('Render cancelled');

      // Sub-pixel offset: this is what produces the anti-aliasing.
      const jitterX = halton(index + 1, 2) - 0.5;
      const jitterY = halton(index + 1, 3) - 0.5;
      camera.setViewOffset(width, height, jitterX, jitterY, width, height);

      if (canDoDof) {
        // A point on the lens disc, re-aimed at the focal plane. Averaging
        // these views is what blurs everything off that plane.
        const radius = Math.sqrt(halton(index + 1, 5)) * options.aperture;
        const angle = halton(index + 1, 7) * Math.PI * 2;
        camera.position
          .copy(previousPosition)
          .addScaledVector(right, Math.cos(angle) * radius)
          .addScaledVector(up, Math.sin(angle) * radius);
        camera.lookAt(focusPoint);
        applyCameraRoll(camera);
      }

      gl.render(scene, camera);

      await readTarget(gl, target, width, height, readBuffer);

      for (let i = 0; i < accumulator.length; i += 1) {
        accumulator[i] += readBuffer[i];
      }

      report(index + 1, samples, `Pass ${index + 1} of ${samples}`);
      // Hand the frame back to the browser so the progress bar moves and the
      // interface keeps responding.
      await nextFrame();
    }

    report(samples, samples, 'Encoding PNG');

    const blob = await encodePng(accumulator, width, height, samples);

    return {
      blob,
      url: URL.createObjectURL(blob),
      width,
      height,
      samples,
      durationMs: performance.now() - started,
    };
  } finally {
    /* ---- put everything back ---- */
    target.dispose();
    restoreHelpers();

    camera.clearViewOffset();
    camera.position.copy(previousPosition);
    camera.quaternion.copy(previousQuaternion);
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

    scene.background = previousBackground;
    gl.setClearAlpha(previousClearAlpha);
    gl.setRenderTarget(previousTarget);
    gl.transmissionResolutionScale = previousTransmissionScale;

    // `colorSpace` on a target is a texture property; nothing global changed,
    // but the canvas does need one frame to come back.
    viewport.setFrameloop?.('demand');
    viewport.invalidate?.();
  }
}

/** Approximate idea of cost, to warn before a very long render. */
export function estimateRenderWork(width: number, height: number, samples: number) {
  const megapixels = (width * height) / 1_000_000;
  return megapixels * samples;
}

export const RESOLUTION_PRESETS: { label: string; width: number; height: number }[] = [
  { label: '1280 × 960', width: 1280, height: 960 },
  { label: '1600 × 1200', width: 1600, height: 1200 },
  { label: '1920 × 1080', width: 1920, height: 1080 },
  { label: '2048 × 2048', width: 2048, height: 2048 },
  { label: '2560 × 1440', width: 2560, height: 1440 },
  { label: '3000 × 2250', width: 3000, height: 2250 },
];

export const SAMPLE_PRESETS = [1, 8, 16, 24, 32, 64, 128, 256];
