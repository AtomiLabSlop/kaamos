import { Matrix4, Mesh, Object3D, Vector3 } from 'three';
import { useProject } from '../store/project';
import { mmToWorld } from '../render/depthOfField';
import { nodeIdOf, viewport } from './viewportApi';

/** How far above the floor the lowest point is left, in millimetres. */
export const FLOOR_GAP_MM = 0.1;

/** The floor is the plane Y = 0 (`Ground.tsx`). */
const FLOOR_Y = 0;

function findNodeObject(nodeId: string): Object3D | null {
  const scene = viewport.scene;
  if (!scene) return null;
  let found: Object3D | null = null;
  scene.traverse((object) => {
    if (!found && nodeIdOf(object) === nodeId) found = object;
  });
  return found;
}

/** Lowest world-space Y over the visible vertices below `root`, or null. */
function lowestWorldY(root: Object3D): number | null {
  root.updateWorldMatrix(true, true);
  let lowest = Infinity;
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    for (let up: Object3D | null = mesh; up; up = up.parent) if (!up.visible) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position) return;
    const e = mesh.matrixWorld.elements;
    for (let i = 0; i < position.count; i++) {
      const y = e[1] * position.getX(i) + e[5] * position.getY(i) + e[9] * position.getZ(i) + e[13];
      if (y < lowest) lowest = y;
    }
  });
  return Number.isFinite(lowest) ? lowest : null;
}

/**
 * Moves a part straight down or up so that its lowest point, in the position
 * it is in now, rests FLOOR_GAP_MM above the floor. Returns false when the part
 * has nothing to measure.
 */
export function dropNodeToFloor(nodeId: string): boolean {
  const object = findNodeObject(nodeId);
  const node = useProject.getState().nodes[nodeId];
  if (!object || !node) return false;
  const lowest = lowestWorldY(object);
  if (lowest === null) return false;

  const shift = FLOOR_Y + mmToWorld(FLOOR_GAP_MM) - lowest;
  // The world-space shift expressed in the part's parent frame.
  const parentInverse = new Matrix4();
  if (object.parent) {
    object.parent.updateWorldMatrix(true, false);
    parentInverse.copy(object.parent.matrixWorld).invert();
  }
  const local = new Vector3(0, shift, 0)
    .applyMatrix4(parentInverse)
    .sub(new Vector3().applyMatrix4(parentInverse));

  useProject.getState().setNodeTransform(nodeId, {
    position: [node.position[0] + local.x, node.position[1] + local.y, node.position[2] + local.z],
  });
  return true;
}
