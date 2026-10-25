import type { MaterialDef } from '../store/types';

export type MaterialParams = Omit<MaterialDef, 'id' | 'name' | 'presetId' | 'builtIn'>;

export const MATERIAL_DEFAULTS: MaterialParams = {
  color: '#cccccc',
  metalness: 0,
  roughness: 0.5,
  opacity: 1,
  transmission: 0,
  ior: 1.5,
  thickness: 0.5,
  sssRadius: 0,
  clearcoat: 0,
  clearcoatRoughness: 0.05,
  anisotropy: 0,
  anisotropyRotation: 0,
  envMapIntensity: 1,
  sheen: 0,
  sheenRoughness: 0.4,
  sheenColor: '#ffffff',
  attenuationColor: '#ffffff',
  attenuationDistance: 0,
  emissive: '#ffffff',
  emissiveIntensity: 0,
  doubleSided: false,
  flatShading: false,
  maps: {},
  mapProjection: 'auto',
  mapRepeat: [1, 1],
  mapOffset: [0, 0],
  mapRotation: 0,
  mapSingleSided: false,
  bumpScale: 1,
  normalScale: 1,
};

/**
 * The folders of the material library. Every library material belongs to one;
 * a duplicate keeps its source's `presetId`, so it lands in the same folder.
 * `example-bottle` holds the materials the example bottle uses and nothing else,
 * kept apart from the general ones.
 */
export type MaterialGroupId =
  | 'plastic'
  | 'metal'
  | 'glass'
  | 'paint'
  | 'translucent'
  | 'fabric'
  | 'emissive'
  | 'example-bottle';

export const MATERIAL_GROUPS: { id: MaterialGroupId; name: string }[] = [
  { id: 'plastic', name: 'Plastic & rubber' },
  { id: 'metal', name: 'Metal' },
  { id: 'glass', name: 'Glass' },
  { id: 'paint', name: 'Paint & ceramic' },
  { id: 'translucent', name: 'Translucent' },
  { id: 'fabric', name: 'Fabric' },
  { id: 'emissive', name: 'Emissive' },
  { id: 'example-bottle', name: 'Example bottle' },
];

export interface MaterialPreset {
  id: string;
  name: string;
  group: MaterialGroupId;
  params: MaterialParams;
}

const preset = (
  id: string,
  name: string,
  group: MaterialGroupId,
  params: Partial<MaterialParams>,
): MaterialPreset => ({
  id,
  name,
  group,
  params: { ...MATERIAL_DEFAULTS, ...params },
});

/**
 * The library materials. Values are chosen to read correctly under the
 * studio environments in `scene/envPresets.ts` — metals rely almost entirely
 * on what the environment gives them to reflect.
 */
export const MATERIAL_PRESETS: MaterialPreset[] = [
  preset('matte-plastic', 'Matte plastic', 'plastic', {
    color: '#d5d7d9',
    roughness: 0.72,
  }),
  preset('glossy-plastic', 'Glossy plastic', 'plastic', {
    color: '#282b31',
    roughness: 0.2,
    clearcoat: 0.65,
    clearcoatRoughness: 0.08,
  }),
  preset('brushed-aluminium', 'Brushed aluminium', 'metal', {
    color: '#cdd0d2',
    metalness: 1,
    roughness: 0.34,
    anisotropy: 0.85,
    anisotropyRotation: Math.PI / 2,
  }),
  preset('polished-chrome', 'Polished chrome', 'metal', {
    color: '#f1f3f5',
    metalness: 1,
    roughness: 0.035,
  }),
  preset('stainless-steel', 'Stainless steel', 'metal', {
    color: '#b7bbbf',
    metalness: 1,
    roughness: 0.24,
    anisotropy: 0.3,
  }),
  preset('glass', 'Glass', 'glass', {
    color: '#ffffff',
    metalness: 0,
    roughness: 0.02,
    transmission: 1,
    ior: 1.52,
    thickness: 0.45,
    doubleSided: true,
    envMapIntensity: 1.2,
  }),
  /**
   * Roughness on a transmissive material is what blurs whatever is behind it.
   * Three renders the scene behind transmissive surfaces into a mip-mapped
   * buffer and picks the mip by roughness, so this is real blurred refraction
   * rather than a frosted-looking overlay.
   */
  preset('frosted-glass', 'Frosted glass', 'glass', {
    color: '#ffffff',
    metalness: 0,
    roughness: 0.28,
    transmission: 1,
    ior: 1.5,
    thickness: 0.25,
    doubleSided: true,
    envMapIntensity: 1.1,
  }),
  preset('rubber', 'Rubber', 'plastic', {
    color: '#16171a',
    roughness: 0.93,
    sheen: 0.22,
    sheenRoughness: 0.6,
    sheenColor: '#4a4a4a',
  }),
  preset('ceramic', 'Ceramic', 'paint', {
    color: '#f2efe8',
    roughness: 0.3,
    clearcoat: 0.9,
    clearcoatRoughness: 0.06,
  }),
  preset('matte-paint', 'Matte paint', 'paint', {
    color: '#5a6066',
    roughness: 0.62,
  }),
  preset('glossy-paint', 'Glossy paint', 'paint', {
    color: '#9c1d23',
    roughness: 0.14,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.1,
  }),

  /* ---- more metals ---- */
  preset('satin-aluminium', 'Satin aluminium', 'metal', {
    color: '#c9ccce',
    metalness: 1,
    roughness: 0.46,
    anisotropy: 0.4,
  }),
  preset('black-anodised', 'Black anodised aluminium', 'metal', {
    color: '#2a2b2e',
    metalness: 1,
    roughness: 0.36,
    anisotropy: 0.2,
  }),
  preset('titanium', 'Titanium', 'metal', {
    color: '#8e9094',
    metalness: 1,
    roughness: 0.3,
    anisotropy: 0.25,
  }),
  preset('gold', 'Gold', 'metal', {
    color: '#ffcf70',
    metalness: 1,
    roughness: 0.12,
  }),
  preset('brass', 'Brass', 'metal', {
    color: '#d9b05a',
    metalness: 1,
    roughness: 0.22,
  }),
  preset('copper', 'Copper', 'metal', {
    color: '#e3925f',
    metalness: 1,
    roughness: 0.16,
  }),
  /** Aged metals: the outer layer is a rough non-metal, so metalness drops and roughness rises. */
  preset('rusted-iron', 'Rusted iron', 'metal', {
    color: '#6b3f2a',
    metalness: 0.3,
    roughness: 0.86,
  }),
  preset('weathered-copper', 'Weathered copper', 'metal', {
    color: '#4f8f7d',
    metalness: 0.25,
    roughness: 0.7,
  }),

  /* ---- more plastics, crystal, car paint ---- */
  preset('white-gloss-plastic', 'White glossy plastic', 'plastic', {
    color: '#f4f4f2',
    roughness: 0.16,
    clearcoat: 0.5,
    clearcoatRoughness: 0.06,
  }),
  preset('soft-touch-plastic', 'Soft-touch plastic', 'plastic', {
    color: '#2b2d30',
    roughness: 0.6,
    sheen: 0.15,
    sheenRoughness: 0.7,
    sheenColor: '#555a60',
  }),
  preset('crystal', 'Crystal', 'glass', {
    color: '#ffffff',
    metalness: 0,
    roughness: 0.01,
    transmission: 1,
    ior: 1.7,
    thickness: 0.6,
    doubleSided: true,
    envMapIntensity: 1.3,
  }),
  /** No metallic flakes: a tinted metallic base under a clear coat is the closest this material model gets. */
  preset('car-paint', 'Car paint (blue)', 'paint', {
    color: '#1f3a5f',
    metalness: 0.45,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.15,
  }),
  preset('car-paint-silver', 'Car paint (silver)', 'paint', {
    color: '#b9bec4',
    metalness: 0.6,
    roughness: 0.26,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.15,
  }),

  /* ---- translucent: subsurface scattering in path traced views (sssRadius); with the radius at 0 they fall back to partial transmission with a tint ---- */
  preset('wax', 'Wax', 'translucent', {
    color: '#efe3c4',
    roughness: 0.45,
    transmission: 0.35,
    ior: 1.45,
    thickness: 0.6,
    attenuationColor: '#e0a050',
    attenuationDistance: 0.6,
    sssRadius: 0.25,
    doubleSided: true,
  }),
  preset('milk', 'Milk', 'translucent', {
    color: '#fbfbf8',
    roughness: 0.35,
    transmission: 0.5,
    ior: 1.35,
    thickness: 0.8,
    attenuationColor: '#f3eee0',
    attenuationDistance: 1.0,
    sssRadius: 0.3,
    doubleSided: true,
  }),
  preset('jade', 'Jade', 'translucent', {
    color: '#5fa37a',
    roughness: 0.25,
    transmission: 0.4,
    ior: 1.6,
    thickness: 0.6,
    clearcoat: 0.3,
    clearcoatRoughness: 0.1,
    attenuationColor: '#2e8a55',
    attenuationDistance: 0.35,
    sssRadius: 0.15,
    doubleSided: true,
  }),
  preset('marble', 'Marble', 'translucent', {
    color: '#ecebe8',
    roughness: 0.15,
    transmission: 0.12,
    ior: 1.5,
    thickness: 0.5,
    clearcoat: 0.4,
    clearcoatRoughness: 0.05,
    attenuationColor: '#e8e2d8',
    attenuationDistance: 1.5,
    sssRadius: 0.2,
    doubleSided: true,
  }),
  preset('skin', 'Skin', 'translucent', {
    color: '#e0a58f',
    roughness: 0.5,
    transmission: 0.15,
    ior: 1.4,
    thickness: 0.4,
    sheen: 0.2,
    sheenRoughness: 0.5,
    sheenColor: '#ffd9c9',
    attenuationColor: '#d2503a',
    attenuationDistance: 0.4,
    sssRadius: 0.12,
    doubleSided: true,
  }),

  /* ---- fabric ---- */
  preset('velvet', 'Velvet', 'fabric', {
    color: '#6b1f33',
    roughness: 0.9,
    sheen: 1,
    sheenRoughness: 0.35,
    sheenColor: '#d27a95',
  }),
  preset('cotton', 'Cotton', 'fabric', {
    color: '#e8e4da',
    roughness: 0.95,
    sheen: 0.5,
    sheenRoughness: 0.6,
    sheenColor: '#ffffff',
  }),
  preset('satin-fabric', 'Satin', 'fabric', {
    color: '#c9a7c6',
    roughness: 0.35,
    sheen: 1,
    sheenRoughness: 0.25,
    sheenColor: '#ffffff',
  }),

  /* ---- emissive: give off light ---- */
  preset('led-white', 'LED light', 'emissive', {
    color: '#f4f4f4',
    roughness: 0.4,
    emissive: '#ffffff',
    emissiveIntensity: 5,
  }),
  preset('warm-light', 'Warm light', 'emissive', {
    color: '#f4e6d2',
    roughness: 0.4,
    emissive: '#ffb35c',
    emissiveIntensity: 5,
  }),
  preset('neon-pink', 'Neon tube', 'emissive', {
    color: '#ffd0e0',
    roughness: 0.2,
    emissive: '#ff4f9a',
    emissiveIntensity: 8,
  }),

  /** A lightly tinted, clear liquid (pale whisky, tea): refracts like water, colours what passes through. */
  preset('amber-liquid', 'Liquid', 'example-bottle', {
    color: '#f0c69e',
    metalness: 0,
    roughness: 0.03,
    transmission: 1,
    ior: 1.36,
    thickness: 0.6,
    doubleSided: true,
  }),
  /** Own slot, so an image placed on a label doesn't spread to every matte plastic part. */
  preset('label-paper', 'Label', 'example-bottle', {
    color: '#ffffff',
    roughness: 0.7,
  }),
  preset('cork', 'Cork shank', 'example-bottle', {
    color: '#d49b64',
    roughness: 0.88,
  }),
  /** The example bottle's own glass: a separate slot, so editing the bottle leaves the general Glass alone. */
  preset('bottle-glass', 'Bottle', 'example-bottle', {
    color: '#ffffff',
    metalness: 0,
    roughness: 0.02,
    transmission: 1,
    ior: 1.52,
    thickness: 0.45,
    doubleSided: true,
    envMapIntensity: 1.2,
  }),
  /** The example bottle's black cap. */
  preset('bottle-cap', 'Cap', 'example-bottle', {
    color: '#0b0b0d',
    roughness: 0.32,
    clearcoat: 0.4,
    clearcoatRoughness: 0.1,
  }),
];

export const PRESETS_BY_ID = new Map(MATERIAL_PRESETS.map((p) => [p.id, p]));

export const DEFAULT_MATERIAL_PRESET = 'matte-plastic';

/** A library slot's id is stable, so project files survive a reorder. */
export const libraryMaterialId = (presetId: string) => `mat-${presetId}`;

/** The library folder a material belongs to, or null for one with no library origin. */
export function materialGroupOf(presetId: string | null): MaterialGroupId | null {
  return (presetId && PRESETS_BY_ID.get(presetId)?.group) || null;
}

export function buildLibraryMaterials(): {
  materials: Record<string, MaterialDef>;
  order: string[];
} {
  const materials: Record<string, MaterialDef> = {};
  const order: string[] = [];
  for (const p of MATERIAL_PRESETS) {
    const id = libraryMaterialId(p.id);
    materials[id] = {
      id,
      name: p.name,
      presetId: p.id,
      builtIn: true,
      ...p.params,
    };
    order.push(id);
  }
  return { materials, order };
}
