import {
  DoubleSide,
  FrontSide,
  MeshPhysicalMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from 'three';
import type { MaterialDef, TextureSlot } from '../store/types';
import { useProject } from '../store/project';
import { registry } from '../scene/registry';

/**
 * One Three.js material per library definition, shared by every mesh assigned
 * to it and updated in place.
 *
 * Material edits are the most frequent change in the app — a roughness drag
 * fires dozens of times a second. Writing straight onto the existing material
 * means the viewport updates on the next frame without React re-rendering the
 * scene graph, and meshes that share a material genuinely share one GPU
 * program.
 */

const instances = new Map<string, MeshPhysicalMaterial>();
/**
 * The same material without its images, for the faces that should not carry
 * them (the back of a label). Kept in step with the main one.
 */
const plainInstances = new Map<string, MeshPhysicalMaterial>();

/** Values that switch shader features on or off, so a change needs a recompile. */
const featureState = new Map<string, string>();

const SLOTS: TextureSlot[] = ['map', 'bumpMap', 'roughnessMap', 'normalMap'];

/**
 * One Texture per material and slot, built from the shared decoded bitmap. The
 * repeat, offset and rotation belong to the texture, so two materials using the
 * same image can place it differently.
 */
const textures = new Map<string, { key: string; texture: Texture }>();

/** Put the definition's images, and how they sit on the part, onto a material. */
function applyMaps(material: MeshPhysicalMaterial, def: MaterialDef) {
  let changed = false;
  for (const slot of SLOTS) {
    const cacheKey = `${def.id}:${slot}`;
    const ref = def.maps?.[slot];
    const image = ref ? registry.getImage(ref.key) : undefined;
    const cached = textures.get(cacheKey);

    if (!ref || !image) {
      if (cached) {
        cached.texture.dispose();
        textures.delete(cacheKey);
      }
      if (material[slot]) {
        material[slot] = null;
        changed = true;
      }
      continue;
    }

    let entry = cached;
    if (!entry || entry.key !== ref.key) {
      entry?.texture.dispose();
      const texture = new Texture(image.bitmap);
      texture.flipY = false; // the bitmap was flipped when decoded
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.colorSpace = slot === 'map' ? SRGBColorSpace : NoColorSpace;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
      entry = { key: ref.key, texture };
      textures.set(cacheKey, entry);
    }

    const { texture } = entry;
    texture.repeat.set(def.mapRepeat?.[0] ?? 1, def.mapRepeat?.[1] ?? 1);
    texture.offset.set(def.mapOffset?.[0] ?? 0, def.mapOffset?.[1] ?? 0);
    texture.center.set(0.5, 0.5);
    texture.rotation = ((def.mapRotation ?? 0) * Math.PI) / 180;
    texture.updateMatrix();

    if (material[slot] !== texture) {
      material[slot] = texture;
      changed = true;
    }
  }

  material.bumpScale = def.bumpScale ?? 1;
  material.normalScale.set(def.normalScale ?? 1, def.normalScale ?? 1);
  if (changed) material.needsUpdate = true;
}

function featureKey(def: MaterialDef) {
  return [
    def.transmission > 0 && !(def.sssRadius > 0),
    def.clearcoat > 0,
    def.sheen > 0,
    def.anisotropy > 0,
    def.flatShading,
    def.doubleSided,
    def.opacity < 1,
  ].join('|');
}

/**
 * Thickness is meant in studio units — the same for a product imported in
 * millimetres or in metres — but Three multiplies a material's thickness by the
 * mesh's world scale. Imports are scaled to fit the studio (×9.4 for the
 * example bottle in metres, ×0.0094 for the same bottle in millimetres), so the
 * raw value made glass refract through several bottle-widths of glass in one
 * case and through almost none in the other. Dividing by the model's fit scale
 * undoes that. Materials are shared across models, so the first model's scale
 * is used, as depth of field does.
 */
let thicknessScale = 1;

export function setThicknessScale(scale: number) {
  const next = Number.isFinite(scale) && scale > 0 ? scale : 1;
  if (next === thicknessScale) return false;
  thicknessScale = next;
  return true;
}

export function applyDef(
  material: MeshPhysicalMaterial,
  def: MaterialDef,
  scale = thicknessScale,
  stateKey = def.id,
) {
  material.name = def.name;
  material.color.set(def.color);
  material.metalness = def.metalness;
  material.roughness = def.roughness;

  // Transmission is rendered in its own pass and does not combine with alpha
  // blending, so only non-transmissive materials get blended transparency.
  const alphaBlend = def.opacity < 1 && (def.transmission <= 0 || def.sssRadius > 0);
  material.transparent = alphaBlend;
  material.opacity = def.opacity;
  material.depthWrite = !alphaBlend;

  // Subsurface scattering replaces transmission: the surface is opaque (so it
  // casts a solid shadow) and the radius travels to the path tracer in a field
  // the tracer reads but the app never uses (see render/subsurface.ts).
  const sss = def.sssRadius > 0;
  material.transmission = sss ? 0 : def.transmission;
  material.ior = def.ior;
  material.thickness = def.thickness * scale;
  material.attenuationColor.set(def.attenuationColor);
  material.attenuationDistance =
    !sss && def.attenuationDistance > 0 ? def.attenuationDistance * scale : Infinity;
  material.iridescence = 0;
  // Negative = subsurface radius. three's own default for the field is 100, so a
  // positive value must never mean "on" (it made whole cars scatter, 1.01.3).
  material.iridescenceThicknessRange = [sss ? -def.sssRadius * scale : 100, 400];

  material.clearcoat = def.clearcoat;
  material.clearcoatRoughness = def.clearcoatRoughness;

  material.anisotropy = def.anisotropy;
  material.anisotropyRotation = def.anisotropyRotation;

  material.envMapIntensity = def.envMapIntensity;

  material.sheen = def.sheen;
  material.sheenRoughness = def.sheenRoughness;
  material.sheenColor.set(def.sheenColor);

  material.emissive.set(def.emissive);
  material.emissiveIntensity = def.emissiveIntensity;

  material.side = def.doubleSided ? DoubleSide : FrontSide;
  material.flatShading = def.flatShading;

  const key = featureKey(def);
  if (featureState.get(stateKey) !== key) {
    featureState.set(stateKey, key);
    material.needsUpdate = true;
  }
}

/**
 * The material for a definition id, created on first use. Reads the store
 * directly rather than taking the definition as an argument so callers in the
 * render tree do not have to subscribe to material state.
 */
export function materialFor(id: string): MeshPhysicalMaterial | null {
  const existing = instances.get(id);
  if (existing) return existing;

  const def = useProject.getState().materials[id];
  if (!def) return null;

  const material = new MeshPhysicalMaterial();
  applyDef(material, def);
  applyMaps(material, def);
  instances.set(id, material);
  return material;
}

export function plainMaterialFor(id: string): MeshPhysicalMaterial | null {
  const existing = plainInstances.get(id);
  if (existing) return existing;
  const def = useProject.getState().materials[id];
  if (!def) return null;
  const material = new MeshPhysicalMaterial();
  applyDef(material, def, thicknessScale, `${id}:plain`);
  plainInstances.set(id, material);
  return material;
}

/** Push every definition onto its material and drop materials that are gone. */
export function syncMaterials(defs: Record<string, MaterialDef>) {
  for (const def of Object.values(defs)) {
    const material = instances.get(def.id);
    if (material) {
      applyDef(material, def);
      applyMaps(material, def);
    }
    const plain = plainInstances.get(def.id);
    if (plain) applyDef(plain, def, thicknessScale, `${def.id}:plain`);
  }

  for (const [id, material] of instances) {
    if (!defs[id]) {
      material.dispose();
      instances.delete(id);
      featureState.delete(id);
      plainInstances.get(id)?.dispose();
      plainInstances.delete(id);
      featureState.delete(`${id}:plain`);
      for (const slot of SLOTS) {
        const cacheKey = `${id}:${slot}`;
        textures.get(cacheKey)?.texture.dispose();
        textures.delete(cacheKey);
      }
    }
  }
}

export function disposeMaterialInstances() {
  for (const material of instances.values()) material.dispose();
  instances.clear();
  featureState.clear();
  for (const material of plainInstances.values()) material.dispose();
  plainInstances.clear();
  for (const entry of textures.values()) entry.texture.dispose();
  textures.clear();
}

export function materialInstanceCount() {
  return instances.size;
}
