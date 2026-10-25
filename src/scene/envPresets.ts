import type {
  AreaLight,
  EnvPresetId,
  EnvironmentSettings,
  Vec3,
} from '../store/types';

/**
 * Environments are built in the browser rather than loaded as HDRI files.
 *
 * Each rig is a small scene of emissive panels — the same softboxes, strips
 * and bounce cards a photographer would set up — rendered into a cube map and
 * used as the scene environment. That means every preset is a real lighting
 * configuration with no asset download, no licensing question and no network
 * dependency, and the intensity and rotation controls act on it exactly as
 * they would on a loaded HDRI. Uploaded .hdr files take the same code path.
 */

export interface PanelSpec {
  form: 'rect' | 'circle' | 'ring';
  position: Vec3;
  /** Point the panel faces. Defaults to the origin. */
  target?: Vec3;
  scale: [number, number];
  intensity: number;
  color: string;
  /**
   * How far in from the panel's edge its brightness starts falling away, 0 to
   * 1. High values give a very diffuse source whose reflection has no visible
   * outline; low values keep a crisper, more directional highlight.
   */
  softness?: number;
}

export interface EnvRig {
  id: EnvPresetId;
  name: string;
  /** Vertical gradient of the surrounding dome: [top, bottom]. */
  dome: [string, string];
  panels: PanelSpec[];
}

/** Default edge rolloff when a panel does not specify one. */
export const DEFAULT_SOFTNESS = 0.55;

/**
 * Compensates a panel's intensity for the light its rolloff removes.
 *
 * A panel with soft edges emits roughly half what a flat one of the same size
 * would, so without this every rig would dim as soon as the rolloff was
 * introduced. Applying the correction here keeps the intensity numbers in the
 * presets meaning what they always meant.
 */
export function panelGain(softness: number, form: PanelSpec['form']) {
  const perAxis = 1 - softness / 2;
  const area = form === 'circle' ? perAxis * perAxis * 0.88 : perAxis * perAxis;
  return 1 / Math.max(area * 0.93, 0.05);
}

export const ENV_RIGS: Record<EnvPresetId, EnvRig> = {
  'soft-studio': {
    id: 'soft-studio',
    name: 'Soft studio',
    dome: ['#3e444b', '#15171a'],
    panels: [
      // Broad overhead softbox — the main source, and very diffuse.
      { form: 'rect', position: [0, 5, 0.6], scale: [9, 9], intensity: 2.6, color: '#ffffff', softness: 0.7 },
      // Wrapping fills either side, slightly different temperatures so the
      // model picks up some variation across its highlights.
      { form: 'rect', position: [-4.4, 1.8, 3.6], scale: [6, 6], intensity: 1.1, color: '#eef3ff', softness: 0.75 },
      { form: 'rect', position: [4.4, 1.4, 3.2], scale: [5, 5], intensity: 0.85, color: '#fff4e6', softness: 0.75 },
      // Low backdrop glow to separate the silhouette.
      { form: 'rect', position: [0, 2.2, -5], scale: [7, 3.5], intensity: 1.2, color: '#ffffff', softness: 0.8 },
    ],
  },

  'product-photo': {
    id: 'product-photo',
    name: 'Product photography',
    dome: ['#53595f', '#1f2328'],
    panels: [
      { form: 'rect', position: [1.6, 4.6, 3], scale: [6, 6], intensity: 3.2, color: '#ffffff', softness: 0.6 },
      { form: 'rect', position: [-4.6, 1.6, 1.6], scale: [6.5, 6.5], intensity: 1.25, color: '#eef2f8', softness: 0.75 },
      // Narrow strips behind pick out the edges — the classic product rim.
      // Kept crisper, because a rim highlight wants a defined edge.
      { form: 'rect', position: [2.8, 2.1, -3.8], scale: [1.1, 5.5], intensity: 4, color: '#ffffff', softness: 0.35 },
      { form: 'rect', position: [-2.8, 2.1, -3.8], scale: [1.1, 5.5], intensity: 2.6, color: '#ffffff', softness: 0.35 },
      // Bounce card below, standing in for a white sweep.
      { form: 'rect', position: [0, -2.2, 1.6], scale: [9, 9], intensity: 0.55, color: '#ffffff', softness: 0.85 },
    ],
  },

  'high-contrast': {
    id: 'high-contrast',
    name: 'High contrast',
    dome: ['#14171a', '#050607'],
    panels: [
      // One small, hard source and a cool counter-edge. Everything else dark.
      { form: 'rect', position: [2.6, 4, 2.4], scale: [1.5, 1.5], intensity: 16, color: '#ffffff', softness: 0.3 },
      { form: 'rect', position: [-3, 1.6, -2.6], scale: [0.8, 3.2], intensity: 7, color: '#cfe0ff', softness: 0.3 },
    ],
  },

  /**
   * A high-key white surround: the dome itself is the light.
   *
   * The other rigs are dark rooms with bright panels in them, which is right
   * for a product that needs to be carved out of shadow. This is the opposite
   * — a white cyclorama where light arrives from every direction at once. It
   * is what glass, frosted acrylic and pale packaging need, because those
   * materials are read through what they transmit and the soft gradients
   * across them, not through contrast.
   */
  'white-studio': {
    id: 'white-studio',
    name: 'High key white',
    dome: ['#ffffff', '#dfe3e6'],
    panels: [
      // Very large and very diffuse: these shape the gradients rather than
      // creating distinct highlights.
      { form: 'rect', position: [0, 6, 1.5], scale: [16, 16], intensity: 1.5, color: '#ffffff', softness: 0.9 },
      { form: 'rect', position: [-5.5, 2, 4.5], scale: [11, 11], intensity: 0.8, color: '#ffffff', softness: 0.92 },
      { form: 'rect', position: [5.5, 2, 4.5], scale: [11, 11], intensity: 0.8, color: '#ffffff', softness: 0.92 },
      // A broad panel behind keeps the backdrop from going grey behind the
      // subject, which is what separates high key from merely bright.
      { form: 'rect', position: [0, 2, -6], scale: [13, 9], intensity: 1.2, color: '#ffffff', softness: 0.9 },
    ],
  },

  'outdoor-daylight': {
    id: 'outdoor-daylight',
    name: 'Outdoor daylight',
    dome: ['#4d7fbe', '#cdd6dc'],
    panels: [
      // The sun: small and nearly hard-edged.
      { form: 'circle', position: [4.5, 6, 2.6], scale: [1.1, 1.1], intensity: 20, color: '#fff3dd', softness: 0.22 },
      // Warm ground bounce, facing up.
      {
        form: 'rect',
        position: [0, -3, 0],
        target: [0, 4, 0],
        scale: [16, 16],
        intensity: 0.7,
        color: '#b5a68a',
        softness: 0.9,
      },
    ],
  },
};

export const ENV_RIG_LIST = Object.values(ENV_RIGS);

/* ------------------------------------------------------------------ *
   Lighting presets

   A preset is a complete configuration: which environment rig, how bright,
   what colour temperature, the ground shadow, and the set of studio lights.
   Applying one replaces all of it, so the result is reproducible.
 * ------------------------------------------------------------------ */

type LightSpec = Omit<AreaLight, 'id'>;

export interface LightingPreset {
  id: EnvPresetId;
  name: string;
  hint: string;
  environment: Partial<EnvironmentSettings>;
  lights: LightSpec[];
}

const light = (
  name: string,
  position: Vec3,
  size: [number, number],
  intensity: number,
  color = '#ffffff',
  aimHeight = 0.35,
): LightSpec => ({
  name,
  enabled: true,
  color,
  intensity,
  width: size[0],
  height: size[1],
  position,
  aimHeight,
});

export const LIGHTING_PRESETS: LightingPreset[] = [
  {
    id: 'soft-studio',
    name: 'Soft studio',
    hint: 'Broad overhead source with wrapping fill. Forgiving on most shapes.',
    environment: {
      source: 'studio',
      presetId: 'soft-studio',
      intensity: 1,
      temperature: 6500,
      backgroundMode: 'gradient',
      backgroundTopColor: '#2c3137',
      backgroundColor: '#17191c',
      groundColor: '#1a1c1f',
      groundRoughness: 0.28,
      groundReflection: 0.45,
      groundReflectionFade: 2.6,
      shadowEnabled: true,
      shadowOpacity: 0.55,
      shadowBlur: 3,
      shadowSpread: 1.9,
    },
    lights: [
      light('Key', [0.6, 3.2, 2.8], [3, 3], 5),
      light('Fill', [-3.2, 1.5, 2.2], [3.5, 3.5], 1.6),
    ],
  },
  {
    id: 'product-photo',
    name: 'Product photography',
    hint: 'Key, fill and rim. Crisp highlights with clean edge separation.',
    environment: {
      source: 'studio',
      presetId: 'product-photo',
      intensity: 0.85,
      temperature: 6200,
      backgroundMode: 'gradient',
      backgroundTopColor: '#3a4046',
      backgroundColor: '#1b1e22',
      groundColor: '#202327',
      groundRoughness: 0.24,
      groundReflection: 0.5,
      groundReflectionFade: 2.6,
      shadowEnabled: true,
      shadowOpacity: 0.55,
      shadowBlur: 1.8,
      shadowSpread: 1.8,
    },
    lights: [
      light('Key', [2.2, 3, 2.6], [2.2, 2.2], 9),
      light('Fill', [-2.9, 1.4, 2], [3.2, 3.2], 2.4),
      light('Rim', [0.2, 2.4, -3.1], [2.6, 1.3], 6),
    ],
  },
  {
    id: 'high-contrast',
    name: 'High contrast',
    hint: 'Single hard source. Deep shadow, strong form.',
    environment: {
      source: 'studio',
      presetId: 'high-contrast',
      intensity: 0.4,
      temperature: 6000,
      backgroundMode: 'color',
      backgroundColor: '#0a0b0d',
      groundColor: '#0e1012',
      groundRoughness: 0.2,
      groundReflection: 0.55,
      groundReflectionFade: 2.2,
      shadowEnabled: true,
      shadowOpacity: 0.8,
      shadowBlur: 1,
      shadowSpread: 1.5,
    },
    lights: [light('Key', [2.6, 3.4, 1.8], [0.9, 0.9], 22)],
  },
  {
    id: 'white-studio',
    name: 'High key white',
    hint: 'Bright white surround, barely any shadow. For glass and pale products.',
    environment: {
      source: 'studio',
      presetId: 'white-studio',
      intensity: 1,
      temperature: 6500,
      backgroundMode: 'gradient',
      backgroundTopColor: '#ffffff',
      backgroundColor: '#e9ecee',
      groundColor: '#f1f3f4',
      groundRoughness: 0.16,
      groundReflection: 0.3,
      groundReflectionFade: 3.4,
      shadowEnabled: true,
      // Barely there: on a white sweep the product is grounded by a hint of
      // contact, not by a shadow you would notice.
      shadowOpacity: 0.2,
      shadowBlur: 4.5,
      shadowSpread: 2.4,
    },
    // The dome is doing nearly all the work, so one gentle shaping light is
    // enough to keep the form from going completely flat.
    lights: [light('Shaper', [1.6, 2.8, 3], [4, 4], 2.2)],
  },
  {
    id: 'outdoor-daylight',
    name: 'Outdoor daylight',
    hint: 'Sun and sky, with warm bounce from the ground.',
    environment: {
      source: 'studio',
      presetId: 'outdoor-daylight',
      intensity: 1.25,
      temperature: 5600,
      backgroundMode: 'gradient',
      backgroundTopColor: '#5b86c4',
      backgroundColor: '#cdd6dc',
      groundColor: '#8d8578',
      groundRoughness: 0.55,
      groundReflection: 0.12,
      groundReflectionFade: 2,
      shadowEnabled: true,
      shadowOpacity: 0.6,
      shadowBlur: 1.2,
      shadowSpread: 1.7,
    },
    lights: [light('Sun', [4, 5, 2.8], [1, 1], 14, '#fff2d8')],
  },
];

export const DEFAULT_ENVIRONMENT: EnvironmentSettings = {
  lightsFollowRotation: false,
  source: 'studio',
  presetId: 'soft-studio',
  customKey: null,
  customName: null,
  resolution: 1024,
  intensity: 1,
  rotation: 0,
  temperature: 6500,
  backgroundMode: 'gradient',
  backgroundColor: '#17191c',
  backgroundTopColor: '#2c3137',
  groundEnabled: true,
  groundColor: '#1a1c1f',
  groundRoughness: 0.28,
  groundMetalness: 0,
  groundReflection: 0.45,
  groundReflectionFade: 2.6,
  shadowEnabled: true,
  shadowOpacity: 0.55,
  shadowBlur: 3,
  shadowSpread: 1.9,
};
