import type { MaterialDef, TextureSlot } from '../store/types';

/**
 * The example model offered in the empty scene. It is an
 * ordinary GLB file served with the app, and goes through the same importer as
 * anything the user drops in, so it is embedded in saved projects like any
 * other import. Nothing loads it automatically.
 */
export const EXAMPLE_MODEL = {
  id: 'examplebottle',
  name: 'Example bottle',
  hint: 'GLB · mesh',
  fileName: 'examplebottle.glb',
  url: `${import.meta.env.BASE_URL}models/examplebottle.glb`,
} as const;

/**
 * Materials for the example's parts, by part name. The GLB carries none, so
 * without these the liquid shows the opaque default through the glass.
 */
export const EXAMPLE_MATERIALS: Record<string, string> = {
  Bottle: 'bottle-glass',
  Label: 'label-paper',
  Liquid: 'amber-liquid',
  'Cork shank': 'cork',
  Cap: 'bottle-cap',
};

/**
 * Images the example's materials start with: the label artwork (padded to the
 * label's proportions so it isn't stretched) and a cork-grain bump map. Each is
 * set only where the material has no image in that slot yet, so a material the
 * user has already changed is left alone.
 */
export const EXAMPLE_IMAGES: {
  preset: string;
  slot: TextureSlot;
  file: string;
  patch: Partial<MaterialDef>;
}[] = [
  {
    preset: 'label-paper',
    slot: 'map',
    file: 'kaamos-label.jpg',
    // The label wraps a quarter of the bottle, so it is mapped around the axis,
    // and only its outer face carries the print.
    patch: { mapProjection: 'cylinder', mapSingleSided: true },
  },
  {
    preset: 'cork',
    slot: 'bumpMap',
    file: 'cork-bump.png',
    // Around the stopper, repeated so the grain is cork-sized rather than stretched.
    patch: { mapProjection: 'cylinder', mapRepeat: [4, 2], bumpScale: 3 },
  },
];

export async function fetchExampleImage(file: string): Promise<{ bytes: ArrayBuffer; name: string }> {
  // `no-cache` makes the browser ask the server whether the file changed (a cheap
  // 304 when it has not). The artwork keeps its file name when it is replaced, so
  // without this a browser keeps showing the old one from its cache.
  const response = await fetch(`${import.meta.env.BASE_URL}textures/${file}`, {
    cache: 'no-cache',
  });
  if (!response.ok) throw new Error(`${file} could not be loaded (HTTP ${response.status}).`);
  return { bytes: await response.arrayBuffer(), name: file };
}

/**
 * The liquid was modelled as exactly the glass cavity, so its surface and the
 * glass's inner wall are one surface (28.4 mm from the axis, opposite normals),
 * and a path tracer cannot order two coincident transparent surfaces: rays were
 * lost and the glass rendered black. Shrinking the liquid cured that but left
 * an air gap that refracted wrongly. So it is grown 0.5 % instead, which sinks
 * its wall ~0.14 mm into the glass, as in the original model. Scaled about the
 * part's origin (the bottle's axis and base). An experiment: if the black glass
 * persists, this was not the cause.
 */
export const EXAMPLE_LIQUID = { part: 'Liquid', scale: 1.005 } as const;

export async function fetchExampleModel(): Promise<File> {
  // Revalidate, as for the textures: the file keeps its name when it is replaced.
  const response = await fetch(EXAMPLE_MODEL.url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`The example model could not be loaded (HTTP ${response.status}).`);
  }
  return new File([await response.arrayBuffer()], EXAMPLE_MODEL.fileName);
}

/**
 * The label sits in the +X/+Z quadrant of the GLB (45 degrees between those
 * axes), so the example's root is turned 45 degrees clockwise seen from above
 * (-45 degrees about Y) to put the label's centre toward the front view (+Z).
 */
export const EXAMPLE_ROTATION_Y = -Math.PI / 4;
