import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Vector3,
  type Material,
  type Mesh,
  type MeshPhysicalMaterial,
  type OrthographicCamera,
  type Scene,
} from 'three';
import { printDirection } from '../materials/projectUv';
import { useProject } from '../store/project';
import { nodeIdOf, viewport } from './viewportApi';

/**
 * Keeps a part that is printed on one side only, such as a bottle's label,
 * out of the glass's refraction while its printed side faces the camera.
 *
 * Glass refracts a picture of everything opaque in the scene — including the
 * label, which sits on the outside and in front of the glass. The glass then
 * showed warped, mirrored copies of the label beside the real one. A part
 * drawn as "transparent" is left out of that picture and drawn over the glass
 * afterwards, which is right while its printed side faces the camera. From the
 * other side the label really is behind the glass, so it goes back into the
 * picture and shows through. The path tracer needs none of this: it follows
 * the light and never saw the problem.
 */

const centre = new Vector3();
const direction = new Vector3();
const toCamera = new Vector3();

/** Materials this has switched to blended drawing. */
const forced = new Set<Material>();

const baseTransparent = (material: Material) =>
  material.opacity < 1 && ((material as MeshPhysicalMaterial).transmission ?? 0) <= 0;

function update(scene: Scene, active: boolean) {
  const camera = viewport.camera;
  const wanted = new Set<Material>();

  if (active && camera) {
    const { nodes, materials } = useProject.getState();
    const orthographic = (camera as OrthographicCamera).isOrthographicCamera === true;
    scene.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      const id = nodeIdOf(mesh);
      const node = id ? nodes[id] : undefined;
      const def = node?.materialId ? materials[node.materialId] : undefined;
      if (!def || !def.mapSingleSided || Object.keys(def.maps ?? {}).length === 0) return;

      const local = printDirection(mesh.geometry, def.mapProjection ?? 'auto');
      if (!local) return;

      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (!mesh.geometry.boundingBox) return;
      mesh.geometry.boundingBox.getCenter(centre).applyMatrix4(mesh.matrixWorld);
      direction.copy(local).transformDirection(mesh.matrixWorld);
      if (orthographic) camera.getWorldDirection(toCamera).negate();
      else toCamera.subVectors(camera.position, centre);

      if (direction.dot(toCamera) > 0) {
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          wanted.add(material);
        }
      }
    });
  }

  for (const material of wanted) {
    if (!material.transparent) material.transparent = true;
    forced.add(material);
  }
  for (const material of forced) {
    if (wanted.has(material)) continue;
    material.transparent = baseTransparent(material);
    forced.delete(material);
  }
}

/** Put every material this touched back, for a renderer that must not see it. */
export function releasePrintedSides() {
  for (const material of forced) material.transparent = baseTransparent(material);
  forced.clear();
}

/**
 * Draws with the labels kept out of the glass's refraction, then puts every
 * material back. For a renderer that draws the scene itself now and then: the
 * path tracer shows an ordinary raster picture until it has enough samples (at
 * the start, and again after every camera move), and that picture is the one
 * that showed the ghost labels.
 */
export function rasterWithPrintedSides(scene: Scene, draw: () => void) {
  update(scene, true);
  try {
    draw();
  } finally {
    releasePrintedSides();
  }
}

export function PrintedSide() {
  const scene = useThree((state) => state.scene);

  useFrame(() => update(scene, true));
  useEffect(() => () => releasePrintedSides(), []);

  return null;
}
