import { Vector3 } from 'three';
import type { Vec3 } from '../store/types';
import { useProject } from '../store/project';
import { subjectBounds } from './viewportApi';

const Y_AXIS = new Vector3(0, 1, 0);

/** Lowest height a placed light may take; the floor is at Y = 0. */
const MIN_HEIGHT = 0.15;

/**
 * Where an area light goes so that it lights a clicked spot: out along the
 * surface normal, aimed back at the spot. The distance follows the size of the
 * subject, so a large import gets a light that is as far out as a small one is.
 * Light positions are stored in the frame the lights are edited in, which is
 * turned with the environment when the lights follow it, so a world point is
 * turned back into that frame first.
 */
export function lightForSpot(point: Vec3, normal: Vec3): { position: Vec3; aimPoint: Vec3 } {
  const { environment } = useProject.getState();
  const bounds = subjectBounds();
  const radius = bounds ? bounds.getSize(new Vector3()).length() / 2 : 0.8;
  const distance = Math.max(radius * 2, 1.5);

  const spot = new Vector3(...point);
  const out = new Vector3(...normal).normalize();
  const position = spot.clone().addScaledVector(out, distance);

  if (environment.lightsFollowRotation && environment.rotation !== 0) {
    spot.applyAxisAngle(Y_AXIS, -environment.rotation);
    position.applyAxisAngle(Y_AXIS, -environment.rotation);
  }
  // A surface that faces down would put the light under the floor.
  position.y = Math.max(position.y, MIN_HEIGHT);

  return {
    position: [position.x, position.y, position.z],
    aimPoint: [spot.x, spot.y, spot.z],
  };
}
