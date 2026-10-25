import { useProject } from '../store/project';
import { targetDistance } from '../scene/viewportApi';
import type { ModelFormat } from '../store/types';

/**
 * Depth of field in real-world terms.
 *
 * The scene is measured in "world units", and every import is scaled so its
 * largest side is a fixed number of them. A lens aperture only means something
 * against the real size of the object, so the real size is recovered from the
 * file's own unit and the scale held on the model's root node.
 */

/** Focal length on a 36 × 24 mm sensor that gives this vertical field of view. */
export function focalLengthMm(fovDegrees: number) {
  return 12 / Math.tan((fovDegrees * Math.PI) / 360);
}

/**
 * Metres per file unit. CAD formats are in millimetres by convention and glTF
 * is defined in metres. OBJ carries no unit at all; millimetres is a guess
 * that suits product models, and the Camera panel says so.
 */
const FILE_UNIT_METRES: Record<ModelFormat, number> = {
  step: 0.001,
  iges: 0.001,
  obj: 0.001,
  stl: 0.001,
  glb: 1,
  gltf: 1,
};

/** The unit assumption that applies to the first model, for the panel's note. */
export function unitNote(): string | null {
  const model = Object.values(useProject.getState().models)[0];
  if (!model?.format) return null;
  if (model.format === 'obj') return 'OBJ files carry no unit; millimetres assumed.';
  if (model.format === 'stl') return 'STL files carry no unit; millimetres assumed.';
  return model.format === 'glb' || model.format === 'gltf'
    ? 'Sizes taken from the file in metres.'
    : 'Sizes taken from the file in millimetres.';
}

/** Real metres that one world unit stands for, judged from the first model. */
export function metresPerWorldUnit(): number {
  const { models, nodes } = useProject.getState();
  const model = Object.values(models)[0];
  if (!model) return 1;
  const unit = FILE_UNIT_METRES[model.format ?? 'glb'] ?? 1;
  const scale = nodes[model.rootNodeId]?.scale?.[0] ?? 1;
  return scale > 0 ? unit / scale : unit;
}

export const worldToMm = (world: number) => world * metresPerWorldUnit() * 1000;
export const mmToWorld = (mm: number) => mm / 1000 / metresPerWorldUnit();

export interface LensSettings {
  /** Lens radius in world units; what the raster engine needs. */
  apertureRadius: number;
  /** What the path tracer calls the aperture diameter, in its own (metre) units. */
  bokehSize: number;
  /** Distance from the camera to the plane of sharp focus, in world units. */
  focusDistance: number;
}

/** The lens to render with, or null when depth of field is off or unusable. */
export function currentLens(): LensSettings | null {
  const { render, camera } = useProject.getState();
  if (!render.depthOfField || camera.projection !== 'perspective') return null;
  const perMetre = metresPerWorldUnit();
  const diameterMm = focalLengthMm(camera.fov) / Math.max(render.fStop, 0.1);
  return {
    apertureRadius: diameterMm / 2 / 1000 / perMetre,
    // The path tracer treats world units as metres, so the real diameter is
    // restated in those units.
    bokehSize: diameterMm / perMetre,
    focusDistance: render.focusDistance > 0 ? render.focusDistance : targetDistance(),
  };
}
