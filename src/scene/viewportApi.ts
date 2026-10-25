import {
  Box3,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  Sphere,
  Vector2,
  Vector3,
  type Mesh,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { Projection, Vec3, Viewpoint } from '../store/types';

/**
 * A handle on the live renderer, held outside React.
 *
 * Toolbar buttons, keyboard shortcuts and the final renderer all need to act on
 * the actual Three.js objects. Routing those through React state would make
 * every camera nudge re-render the tree, so the viewport registers itself here
 * once and callers reach it imperatively.
 */

export interface ViewportHandle {
  gl: WebGLRenderer | null;
  scene: Scene | null;
  camera: PerspectiveCamera | OrthographicCamera | null;
  controls: OrbitControlsImpl | null;
  /** Pauses R3F's own loop while the final renderer drives the GPU. */
  setFrameloop: ((mode: 'always' | 'demand' | 'never') => void) | null;
  /** Requests a redraw. The viewport only draws when asked. */
  invalidate: (() => void) | null;
}

/** Ask the viewport to redraw after changing something imperatively. */
export const requestRedraw = () => viewport.invalidate?.();

export const viewport: ViewportHandle = {
  gl: null,
  scene: null,
  camera: null,
  controls: null,
  setFrameloop: null,
  invalidate: null,
};

/**
 * Where the camera was when the graphics context was lost, so the rebuilt
 * canvas can start from the same view instead of the default one.
 */
export const savedPose: {
  value: { position: [number, number, number]; target: [number, number, number] } | null;
} = { value: null };

export const isViewportReady = () =>
  Boolean(viewport.gl && viewport.scene && viewport.camera);

/**
 * Size of the picture glass refracts, relative to the view. Three keeps one such
 * picture per camera, multisampled, half-float and mip-mapped, so at full size
 * on a high-density screen it is the largest buffer the viewport holds, and the
 * floor's mirror camera adds another. Half size quarters that, and refraction
 * is blurred anyway. A final raster render sets it back to 1.
 */
export const VIEWPORT_TRANSMISSION_SCALE = 0.5;

/** Marks objects that make up the subject, as opposed to studio helpers. */
export const SUBJECT_FLAG = 'rmNodeId';

/**
 * Marks objects that exist to help the user work — the grid, selection
 * outlines, light wireframes. They belong in the viewport and never in a
 * rendered image.
 */
export const HELPER_FLAG = 'rmHelper';

export function nodeIdOf(object: Object3D): string | null {
  const value = object.userData?.[SUBJECT_FLAG];
  return typeof value === 'string' ? value : null;
}

/**
 * Marks the backdrop. A render with a transparent background drops it, so the
 * product comes out as a cut-out with its shadow carried in the alpha channel
 * rather than sitting on an opaque floor.
 */
export const GROUND_FLAG = 'rmGround';

/**
 * Marks something the rasteriser needs but a path tracer must not see.
 *
 * The contact shadow and the planar floor reflection are both stand-ins for
 * light transport the viewport's renderer cannot do. A path tracer computes
 * the real shadow and the real reflection from the floor's own material, so
 * including these would double them up — and they are drawn with materials
 * (a basic material, a custom shader) that a path tracer has no way to
 * describe in the first place.
 */
export const RASTER_ONLY_FLAG = 'rmRasterOnly';

export function isHelper(object: Object3D): boolean {
  if (object.userData?.[HELPER_FLAG] === true) return true;
  // Three's own helpers name themselves, which covers the light wireframes.
  return /Helper$/.test(object.type);
}

/**
 * Hide every working aid — and optionally the backdrop — returning a function
 * that puts them back. Used by the final renderer so the output image contains
 * only the scene itself.
 */
export function hideForRender(
  options: { dropGround?: boolean; dropRasterOnly?: boolean } = {},
): () => void {
  const scene = viewport.scene;
  if (!scene) return () => {};

  const hidden: Object3D[] = [];
  scene.traverse((object) => {
    if (!object.visible) return;
    const drop =
      isHelper(object) ||
      (options.dropGround === true && object.userData?.[GROUND_FLAG] === true) ||
      (options.dropRasterOnly === true &&
        object.userData?.[RASTER_ONLY_FLAG] === true);
    if (drop) {
      object.visible = false;
      hidden.push(object);
    }
  });

  return () => {
    for (const object of hidden) object.visible = true;
  };
}

function isUnderNode(object: Object3D, nodeId: string) {
  let current: Object3D | null = object.parent;
  while (current) {
    if (nodeIdOf(current) === nodeId) return true;
    current = current.parent;
  }
  return false;
}

/**
 * Bounding box of imported and sample geometry, ignoring the grid, ground and
 * light helpers. Pass a node id to bound just that object and its children.
 */
export function subjectBounds(nodeId?: string | null): Box3 | null {
  const scene = viewport.scene;
  if (!scene) return null;

  const box = new Box3();
  let found = false;

  scene.updateMatrixWorld(true);
  scene.traverse((object) => {
    const own = nodeIdOf(object);
    if (!own || !object.visible) return;
    if (nodeId && own !== nodeId && !isUnderNode(object, nodeId)) return;

    const geometry = (object as Mesh).geometry;
    if (!geometry) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;

    box.union(geometry.boundingBox.clone().applyMatrix4(object.matrixWorld));
    found = true;
  });

  return found && !box.isEmpty() ? box : null;
}

const FALLBACK_BOX = () =>
  new Box3(new Vector3(-0.6, 0, -0.6), new Vector3(0.6, 1.2, 0.6));

const DEFAULT_DIRECTION = new Vector3(1, 0.62, 1).normalize();

/** Distance at which a sphere of `radius` fills the frame comfortably. */
function fitDistance(radius: number, camera: PerspectiveCamera, margin: number) {
  const vertical = (camera.fov * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * Math.max(camera.aspect, 0.2));
  const limiting = Math.min(vertical, horizontal);
  return (radius / Math.max(Math.sin(limiting / 2), 0.01)) * margin;
}

/**
 * Move the camera so the given bounds fill the frame, keeping the current
 * viewing direction unless one is given. Returns the orthographic zoom that
 * matches the same framing, for the caller to write back to the store.
 */
export function frameBounds(
  box: Box3,
  direction?: Vector3,
  margin = 1.25,
): { orthoZoom: number } | null {
  const camera = viewport.camera;
  const controls = viewport.controls;
  if (!camera) return null;

  const centre = box.getCenter(new Vector3());
  const radius = Math.max(box.getBoundingSphere(new Sphere()).radius, 1e-4);

  let dir: Vector3;
  if (direction) {
    dir = direction.clone().normalize();
  } else {
    const from = controls?.target ?? centre;
    dir = camera.position.clone().sub(from);
    if (dir.lengthSq() < 1e-8) dir = DEFAULT_DIRECTION.clone();
    else dir.normalize();
  }

  const distance =
    camera instanceof PerspectiveCamera
      ? fitDistance(radius, camera, margin)
      : radius * 4;

  camera.position.copy(centre).addScaledVector(dir, distance);
  // Depth precision is governed almost entirely by the near plane, and the
  // ground, its shadow and the grid sit within a few millimetres of each
  // other. A near/far ratio in the thousands resolves that comfortably; the
  // very small near plane this used to set did not, and the three surfaces
  // fought for the same depth values.
  camera.near = Math.max(radius * 0.05, 0.01);
  camera.far = Math.max(distance * 12, radius * 400);
  camera.updateProjectionMatrix();

  if (controls) {
    controls.target.copy(centre);
    controls.update();
  } else {
    camera.lookAt(centre);
  }

  markHome();

  // The orthographic equivalent of this framing, expressed as the vertical
  // extent in world units, for the caller to write back to the store.
  const size = box.getSize(new Vector3());
  const span = Math.max(size.x, size.y, size.z) || 1;
  return { orthoZoom: span * margin };
}

export const VIEW_PRESETS: {
  id: string;
  label: string;
  shortcut: string;
  direction: Vec3;
}[] = [
  { id: 'front', label: 'Front', shortcut: '1', direction: [0, 0, 1] },
  { id: 'right', label: 'Right', shortcut: '2', direction: [1, 0, 0] },
  { id: 'back', label: 'Back', shortcut: '3', direction: [0, 0, -1] },
  { id: 'left', label: 'Left', shortcut: '4', direction: [-1, 0, 0] },
  // A hair of Z keeps the up vector from degenerating at the poles, where a
  // view direction exactly parallel to it leaves the camera's roll undefined.
  { id: 'top', label: 'Top', shortcut: '5', direction: [0, 1, 0.0001] },
  { id: 'bottom', label: 'Bottom', shortcut: '6', direction: [0, -1, 0.0001] },
  { id: 'three-quarter', label: 'Three-quarter', shortcut: '7', direction: [1, 0.62, 1] },
];

/**
 * The field of view the camera's current distance belongs to. Changing the FOV
 * moves the camera back or in (a dolly zoom) so the subject keeps its size on
 * screen and only the perspective changes; this is the FOV that distance was
 * last matched to. Anything that sets the camera's position and FOV together
 * (restoring a saved viewpoint) sets this too, so no dolly is added on top.
 */
export const fovBasis: { value: number | null } = { value: null };

/**
 * Moves the camera along its line of sight so an object at the orbit target
 * keeps the same apparent size when the vertical FOV goes from `from` to `to`
 * degrees: distance × tan(fov / 2) stays constant.
 */
export function dollyForFov(from: number, to: number) {
  const camera = viewport.camera;
  const controls = viewport.controls;
  if (!(camera instanceof PerspectiveCamera) || !controls) return;
  const tanFrom = Math.tan((from * Math.PI) / 360);
  const tanTo = Math.tan((to * Math.PI) / 360);
  if (!(tanFrom > 0) || !(tanTo > 0)) return;

  const offset = camera.position.clone().sub(controls.target);
  if (offset.lengthSq() < 1e-12) return;
  const distance = offset.length() * (tanFrom / tanTo);
  camera.position.copy(controls.target).addScaledVector(offset.normalize(), distance);

  // Keep the clip planes in step with the new distance (see frameBounds).
  const box = subjectBounds() ?? FALLBACK_BOX();
  const radius = Math.max(box.getBoundingSphere(new Sphere()).radius, 1e-4);
  camera.near = Math.max(radius * 0.05, 0.01);
  camera.far = Math.max(distance * 12, radius * 400);
  camera.updateProjectionMatrix();
  controls.update();
  requestRedraw();
}

export function frameAll(margin = 1.3) {
  return frameBounds(subjectBounds() ?? FALLBACK_BOX(), undefined, margin);
}

/** Frames several parts together. */
export function frameNodes(nodeIds: string[], margin = 1.5) {
  const box = new Box3();
  for (const id of nodeIds) {
    const part = subjectBounds(id);
    if (part) box.union(part);
  }
  return box.isEmpty() ? null : frameBounds(box, undefined, margin);
}

export function frameNode(nodeId: string, margin = 1.5) {
  const box = subjectBounds(nodeId);
  return box ? frameBounds(box, undefined, margin) : null;
}

export function applyViewDirection(direction: Vec3, margin = 1.3) {
  cameraRoll.angle = 0; // a standard view has a level horizon
  return frameBounds(
    subjectBounds() ?? FALLBACK_BOX(),
    new Vector3(...direction),
    margin,
  );
}

export function readCameraState(
  projection: Projection,
  fov: number,
  orthoZoom: number,
): Omit<Viewpoint, 'id' | 'name'> | null {
  const camera = viewport.camera;
  if (!camera) return null;
  const target = viewport.controls?.target ?? new Vector3();
  return {
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [target.x, target.y, target.z],
    projection,
    fov,
    orthoZoom,
  };
}

export function applyCameraState(position: Vec3, target: Vec3) {
  const camera = viewport.camera;
  if (!camera) return;
  cameraRoll.angle = 0; // saved views do not carry a roll
  camera.position.set(...position);
  if (viewport.controls) {
    viewport.controls.target.set(...target);
    viewport.controls.update();
  } else {
    camera.lookAt(new Vector3(...target));
  }
  markHome();
}

export function currentTarget(): Vec3 {
  const target = viewport.controls?.target;
  return target ? [target.x, target.y, target.z] : [0, 0, 0];
}

const raycaster = new Raycaster();
const pointer = new Vector2();

/**
 * The node under a pointer position, given in normalized device coordinates.
 *
 * Selection and material drops are raycast here rather than through per-mesh
 * React event handlers: it keeps the mesh elements free of event props, and it
 * lets the viewport decide for itself whether a pointer release was a click or
 * the end of an orbit drag.
 */
/**
 * Three's raycaster ignores `visible`, so a hidden part would still be struck
 * and block what is inside it. A hit counts only if it and every ancestor are
 * shown.
 */
function isShown(object: Object3D) {
  let current: Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

export function pickNodeAt(ndcX: number, ndcY: number): string | null {
  const { scene, camera } = viewport;
  if (!scene || !camera) return null;

  pointer.set(ndcX, ndcY);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(scene.children, true);

  for (const hit of hits) {
    if (!isShown(hit.object)) continue;
    // Walk up from the hit: the owning node may be an ancestor of the object
    // that was struck.
    let current: Object3D | null = hit.object;
    while (current) {
      const nodeId = nodeIdOf(current);
      if (nodeId) return nodeId;
      current = current.parent;
    }
  }
  return null;
}

/**
 * Depth, along the view direction, of the model surface under a point. This is
 * the distance to the plane that is sharp when that point is chosen as the
 * focal point. Null when the click lands on nothing.
 */
export function pickDepthAt(ndcX: number, ndcY: number): number | null {
  const { scene, camera } = viewport;
  if (!scene || !camera) return null;

  pointer.set(ndcX, ndcY);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(scene.children, true);
  const forward = camera.getWorldDirection(new Vector3());

  for (const hit of hits) {
    if (!isShown(hit.object)) continue;
    let current: Object3D | null = hit.object;
    while (current) {
      if (nodeIdOf(current)) {
        return Math.max(hit.point.clone().sub(camera.position).dot(forward), 0.001);
      }
      current = current.parent;
    }
  }
  return null;
}

/** Distance from the camera to the orbit target, for depth-of-field defaults. */
/** Height of the camera above the scene's origin plane (the floor), in world units. */
export function cameraHeight() {
  return viewport.camera?.position.y ?? 0;
}

/**
 * Moves the camera straight up or down. The orbit target stays where it is, so
 * the camera keeps looking at the same point and tilts as it rises.
 */
export function setCameraHeight(y: number) {
  const camera = viewport.camera;
  if (!camera || !Number.isFinite(y)) return;
  camera.position.y = y;
  viewport.controls?.update();
  requestRedraw();
}

/**
 * How the camera was last framed (a view, Fit all, a restored viewpoint). The
 * offset sliders measure from here, and "sideways" means this view's horizontal
 * right-hand direction, which stays fixed while the camera is orbited.
 */
const home = { target: new Vector3(), right: new Vector3(1, 0, 0), set: false };

function markHome() {
  const camera = viewport.camera;
  if (!camera) return;
  home.target.copy(viewport.controls?.target ?? new Vector3());
  home.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
  home.right.y = 0;
  if (home.right.lengthSq() < 1e-6) home.right.set(1, 0, 0);
  else home.right.normalize();
  home.set = true;
}

/**
 * Roll: turning the camera about its line of sight, which tilts the horizon.
 * The orbit controls re-aim the camera with a fixed up direction every frame,
 * which would undo it, so it is applied after them (CameraRig, every frame) and
 * by the renderer that re-aims the camera itself. Radians.
 */
export const cameraRoll = { angle: 0 };

export function applyCameraRoll(camera: Object3D) {
  if (cameraRoll.angle !== 0) camera.rotateZ(cameraRoll.angle);
}

export function setCameraRoll(degrees: number) {
  cameraRoll.angle = (degrees * Math.PI) / 180;
  viewport.controls?.update();
  requestRedraw();
}

/** Camera position readouts, in world units (roll in degrees). */
export interface CameraPose {
  /** Camera height above the floor. */
  height: number;
  /** How far the aim point has been lifted from where the view was framed. */
  heightOffset: number;
  /** How far the camera sits to the side of the aim point. */
  side: number;
  /** How far the aim point has been moved sideways from where the view was framed. */
  sideOffset: number;
  roll: number;
}

export function readCameraPose(): CameraPose {
  const camera = viewport.camera;
  if (!camera) return { height: 0, heightOffset: 0, side: 0, sideOffset: 0, roll: 0 };
  if (!home.set) markHome();
  const target = viewport.controls?.target ?? new Vector3();
  const moved = target.clone().sub(home.target);
  const lateral = camera.position.clone().sub(target);
  return {
    height: camera.position.y,
    heightOffset: moved.y,
    side: lateral.dot(home.right),
    sideOffset: moved.dot(home.right),
    roll: (cameraRoll.angle * 180) / Math.PI,
  };
}

/** Moves the camera and the point it aims at together: no turning, only sliding. */
function slideBoth(delta: Vector3) {
  const camera = viewport.camera;
  if (!camera) return;
  camera.position.add(delta);
  viewport.controls?.target.add(delta);
  viewport.controls?.update();
  requestRedraw();
}

export function setHeightOffset(value: number) {
  slideBoth(new Vector3(0, value - readCameraPose().heightOffset, 0));
}

export function setSideOffset(value: number) {
  slideBoth(home.right.clone().multiplyScalar(value - readCameraPose().sideOffset));
}

/** Moves the camera sideways while it keeps looking at the same point, so it turns. */
export function setSide(value: number) {
  const camera = viewport.camera;
  if (!camera) return;
  camera.position.addScaledVector(home.right, value - readCameraPose().side);
  viewport.controls?.update();
  requestRedraw();
}

/** How far the offset sliders reach either way: a few subject sizes. */
export function cameraOffsetReach(): number {
  const box = subjectBounds() ?? FALLBACK_BOX();
  return Math.max(box.getBoundingSphere(new Sphere()).radius, 1e-4) * 3;
}

/** The slider's span: from the subject's lowest point to well above its top. */
export function cameraHeightRange(): { min: number; max: number } {
  const box = subjectBounds() ?? FALLBACK_BOX();
  const radius = Math.max(box.getBoundingSphere(new Sphere()).radius, 1e-4);
  const current = cameraHeight();
  return {
    min: Math.min(box.min.y, current),
    max: Math.max(box.max.y + radius * 4, current),
  };
}

export function targetDistance() {
  const camera = viewport.camera;
  if (!camera) return 4;
  const target = viewport.controls?.target ?? new Vector3();
  return Math.max(camera.position.distanceTo(target), 0.01);
}

/**
 * Render targets that hold the main picture (the depth-of-field pass draws the
 * scene into one). Screen-space overlays such as the selection outline draw
 * into these; they skip every other off-screen target, like the floor mirror's.
 */
export const mainViewTargets = new WeakSet<object>();
