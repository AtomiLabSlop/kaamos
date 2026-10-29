/**
 * Depth of field focuses on a plane (1.0x of the focal distance measured along
 * the camera's line of sight), as the viewport pick, the raster blur and every
 * other renderer do. three-gpu-pathtracer's WebGL shader instead focuses on a
 * sphere round the lens (distance along each ray), so a point picked off-centre
 * came out soft while the middle of the picture was sharp. This divides the
 * focus distance by the ray's cosine to the view axis, which turns the sphere
 * into the plane.
 */
const ANCHOR = 'vec3 focalPoint = ray.origin + normalize( ray.direction ) * physicalCamera.focusDistance;';
// Measured from the lens itself: the tracer's ray origin sits on the near plane.
const PLANE =
  'vec3 focalPoint = cameraWorldMatrix[ 3 ].xyz + normalize( ray.direction ) * physicalCamera.focusDistance / max( dot( normalize( ray.direction ), normalize( mat3( cameraWorldMatrix ) * vec3( 0.0, 0.0, - 1.0 ) ) ), 0.05 );';

/** Call with the other shader patches, before the scene is set. */
export function patchFocusPlane(tracer: unknown): boolean {
  const material = (tracer as { _pathTracer?: { material?: { fragmentShader?: string } } })
    ._pathTracer?.material;
  const source = material?.fragmentShader;
  if (!material || !source || source.split(ANCHOR).length !== 2) {
    console.warn('Path tracer focus plane could not be patched; the shader has changed');
    return false;
  }
  material.fragmentShader = source.replace(ANCHOR, PLANE);
  return true;
}
