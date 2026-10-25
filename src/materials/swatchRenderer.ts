import {
  ACESFilmicToneMapping,
  Mesh,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  WebGLRenderer,
  type Texture,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { MaterialDef } from '../store/types';
import { applyDef } from './materialInstances';
import { MeshPhysicalMaterial } from 'three';

/**
 * Renders each library material as a lit sphere for the material panel.
 *
 * A flat colour chip cannot show roughness, metalness or clearcoat, which are
 * most of what distinguishes these materials — so the swatches are real
 * renders. They share one small offscreen renderer and a fixed neutral room
 * environment, so every swatch is comparable with every other regardless of
 * the studio lighting the user has set up in the scene.
 */

const SIZE = 96;

interface Rig {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  sphere: Mesh;
  material: MeshPhysicalMaterial;
  envMap: Texture;
}

let rig: Rig | null = null;
let unavailable = false;

function buildRig(): Rig | null {
  if (unavailable) return null;
  try {
    const renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'low-power',
    });
    renderer.setSize(SIZE, SIZE, false);
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;

    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const envMap = pmrem.fromScene(room, 0.04).texture;
    room.dispose();
    pmrem.dispose();

    const scene = new Scene();
    scene.environment = envMap;

    const camera = new PerspectiveCamera(28, 1, 0.1, 20);
    camera.position.set(0, 0, 4.1);

    const material = new MeshPhysicalMaterial();
    const sphere = new Mesh(new SphereGeometry(1, 64, 48), material);
    scene.add(sphere);

    return { renderer, scene, camera, sphere, material, envMap };
  } catch {
    // No second WebGL context available. The panel falls back to colour chips.
    unavailable = true;
    return null;
  }
}

const cache = new Map<string, string>();

const signature = (def: MaterialDef) =>
  [
    def.color,
    def.metalness,
    def.roughness,
    def.opacity,
    def.transmission,
    def.ior,
    def.thickness,
    def.attenuationColor,
    def.attenuationDistance,
    def.sssRadius,
    def.clearcoat,
    def.clearcoatRoughness,
    def.anisotropy,
    def.anisotropyRotation,
    def.envMapIntensity,
    def.sheen,
    def.sheenRoughness,
    def.sheenColor,
    def.emissive,
    def.emissiveIntensity,
    def.flatShading,
  ].join(',');

/**
 * A data URL for this material's swatch. Synchronous and memoized on the
 * material's values, so an unchanged material costs a map lookup.
 * Returns null when no WebGL context could be created.
 */
export function swatchFor(def: MaterialDef): string | null {
  const key = `${def.id}:${signature(def)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  rig ??= buildRig();
  if (!rig) return null;

  applyDef(rig.material, def, 1);
  // Transmission needs a backdrop to refract; the swatch has none, so show
  // glass as a lightly tinted shell instead of an invisible sphere.
  if (def.transmission > 0) {
    rig.material.transmission = Math.min(def.transmission, 0.82);
    rig.material.thickness = Math.max(def.thickness, 0.6);
  }
  rig.material.needsUpdate = true;

  rig.renderer.render(rig.scene, rig.camera);
  const url = rig.renderer.domElement.toDataURL('image/png');

  // Keep the cache from growing without bound as sliders move.
  if (cache.size > 160) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, url);
  return url;
}

export function disposeSwatchRenderer() {
  if (rig) {
    rig.sphere.geometry.dispose();
    rig.material.dispose();
    rig.envMap.dispose();
    rig.renderer.dispose();
    rig.renderer.forceContextLoss();
    rig = null;
  }
  cache.clear();
}
