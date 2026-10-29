/**
 * Serializable project model.
 *
 * Nothing in this file may hold a Three.js object. GPU-backed resources
 * (geometries, textures, original file bytes) live in `scene/registry.ts`
 * and are referenced from here by string key, which keeps project state
 * cloneable for undo/redo and writable as JSON.
 */

export type Vec3 = [number, number, number];

export type ModelFormat = 'glb' | 'gltf' | 'obj' | 'stl' | '3mf' | 'step' | 'iges';

export type NodeId = string;

export interface SceneNode {
  id: NodeId;
  /** Owning model, so a whole import can be removed in one action. */
  modelId: string;
  parentId: NodeId | null;
  childIds: NodeId[];
  name: string;
  kind: 'group' | 'mesh';
  visible: boolean;
  position: Vec3;
  /** Euler XYZ, radians. */
  rotation: Vec3;
  scale: Vec3;
  /** Registry key for the mesh geometry. Meshes only. */
  geometryKey?: string;
  /**
   * Assigned library material, or null to keep the material that came in
   * with the file (which may carry textures the editor cannot represent).
   */
  materialId: string | null;
  /** Triangle count, for the scene statistics readout. */
  triangles?: number;
}

export interface ModelAsset {
  id: string;
  name: string;
  source: 'file';
  fileName?: string;
  format?: ModelFormat;
  /** Bytes are kept in the registry under this key so projects can embed them. */
  fileKey?: string;
  /** How finely a STEP or IGES file was tessellated. Reopening reproduces it. */
  cadDetail?: 'standard' | 'fine';
  rootNodeId: NodeId;
  addedAt: number;
}

/** The image slots a material can carry. Each holds a registry image key. */
export type TextureSlot = 'map' | 'bumpMap' | 'roughnessMap' | 'normalMap';

export interface TextureRef {
  /** Key into the registry's image store, which also feeds project files. */
  key: string;
  /** File name shown in the panel. */
  name: string;
}

/**
 * How an image is laid onto a part. 'auto' uses the model's own UV
 * coordinates when it has them and a front projection when it does not; the
 * others project the image onto the part's bounding box regardless.
 */
export type MapProjection = 'auto' | 'front' | 'side' | 'top' | 'cylinder';

export interface MaterialDef {
  id: string;
  name: string;
  /** Library preset this was created from, for the reset action. */
  presetId: string | null;
  /** A library slot. Editable and resettable, but not deletable. */
  builtIn: boolean;
  color: string;
  metalness: number;
  roughness: number;
  opacity: number;
  transmission: number;
  ior: number;
  thickness: number;
  /** Colour light takes on inside the material (jade, wax, skin). Used when the distance is above 0. */
  attenuationColor: string;
  /** Studio units light travels before it has taken on the full attenuation colour. 0 = off. */
  attenuationDistance: number;
  /**
   * Subsurface scattering: mean free path of light inside the material, in studio
   * units. 0 = off. Above 0 the path tracer scatters light through the closed
   * volume and ignores transmission, thickness and attenuation; the fast
   * viewport shows a plain surface.
   */
  sssRadius: number;
  clearcoat: number;
  clearcoatRoughness: number;
  /** Directional roughness, for brushed and machined metals. */
  anisotropy: number;
  anisotropyRotation: number;
  envMapIntensity: number;
  sheen: number;
  sheenRoughness: number;
  sheenColor: string;
  /** Light the surface gives off. 0 = none; above 0 it also lights the scene in path traced views. */
  emissive: string;
  emissiveIntensity: number;
  doubleSided: boolean;
  flatShading: boolean;
  /** Images by slot. Absent slots carry no image. */
  maps: Partial<Record<TextureSlot, TextureRef>>;
  mapProjection: MapProjection;
  /** How many times the image repeats across the part; 1 fits it exactly. */
  mapRepeat: [number, number];
  mapOffset: [number, number];
  /** Degrees. */
  mapRotation: number;
  /**
   * Images only on the faces that face the projection (the outer side of a
   * label); the other faces get the plain material. Needs a projection other
   * than the model's own UVs.
   */
  mapSingleSided: boolean;
  bumpScale: number;
  normalScale: number;
}

export interface AreaLight {
  id: string;
  name: string;
  enabled: boolean;
  color: string;
  intensity: number;
  width: number;
  height: number;
  position: Vec3;
  /** Height on the Y axis the light aims at; X/Z of the aim point are 0. */
  aimHeight: number;
  /** A point the light aims at instead of the vertical axis (set by placing a light on the model). */
  aimPoint?: Vec3;
}

export type EnvPresetId =
  | 'soft-studio'
  | 'product-photo'
  | 'high-contrast'
  | 'outdoor-daylight'
  | 'white-studio';

export type BackgroundMode = 'color' | 'environment' | 'gradient';

export interface EnvironmentSettings {
  /** 'studio' builds the environment procedurally; 'custom' uses an upload. */
  source: 'studio' | 'custom';
  presetId: EnvPresetId;
  customKey: string | null;
  customName: string | null;
  /**
   * Cube map size per face. Sharp materials sample the finest mip, so this is
   * what decides whether a mirror finish reflects cleanly or in blocks.
   */
  resolution: number;
  intensity: number;
  /** Radians around Y. */
  rotation: number;
  /** The studio lights turn with the environment (about the model's vertical axis). */
  lightsFollowRotation: boolean;
  /** Kelvin. Tints the procedural environment and the studio lights. */
  temperature: number;
  backgroundMode: BackgroundMode;
  backgroundColor: string;
  backgroundTopColor: string;
  groundEnabled: boolean;
  groundColor: string;
  groundRoughness: number;
  groundMetalness: number;
  /** Strength of the product's mirrored image in the floor, 0 to 1. */
  groundReflection: number;
  /** How far across the floor that reflection carries before it fades out. */
  groundReflectionFade: number;
  shadowEnabled: boolean;
  shadowOpacity: number;
  shadowBlur: number;
  shadowSpread: number;
}

export type Projection = 'perspective' | 'orthographic';

export type ToneMappingId =
  | 'aces'
  | 'agx'
  | 'neutral'
  | 'reinhard'
  | 'cineon'
  | 'linear'
  | 'none';

export interface CameraSettings {
  projection: Projection;
  fov: number;
  orthoZoom: number;
  exposure: number;
  toneMapping: ToneMappingId;
}

export interface Viewpoint {
  id: string;
  name: string;
  position: Vec3;
  target: Vec3;
  projection: Projection;
  fov: number;
  orthoZoom: number;
  /** Depth of field at the time of saving. Absent in views saved before 1.00.36, which leave it alone. */
  lens?: { depthOfField: boolean; fStop: number; focusDistance: number };
}

/**
 * Which renderer produces the final image.
 *
 * 'raster' is the viewport's own renderer, accumulated; 'pathtrace' traces
 * rays and simulates light bouncing between surfaces.
 */
export type RenderEngine = 'raster' | 'pathtrace';

export interface RenderSettings {
  engine: RenderEngine;
  /** Rays per pixel for the path tracer, kept apart from the raster passes. */
  pathSamples: number;
  /** The path-traced viewport preview stops adding samples at this count. */
  previewSamples: number;
  /** How many times a traced ray may bounce. */
  bounces: number;
  /** Smooth the remaining grain in a path-traced image. */
  denoise: boolean;
  /** How hard the denoiser smooths; only used when `denoise` is on. */
  denoiseStrength: 'light' | 'medium' | 'strong';
  width: number;
  height: number;
  /** Accumulation passes. Each adds anti-aliasing and depth-of-field detail. */
  samples: number;
  /** Blur what lies off the focal plane. Needs a perspective camera. */
  depthOfField: boolean;
  /** Virtual aperture. Low values blur more. */
  fStop: number;
  /** Distance to the focal plane, in world units. 0 means the orbit target. */
  focusDistance: number;
  transparentBackground: boolean;
  shadowResolution: number;
}

export interface RenderResult {
  id: string;
  url: string;
  width: number;
  height: number;
  samples: number;
  /** Which backend produced it, so the history can say. */
  engine: RenderEngine;
  createdAt: number;
  durationMs: number;
}

/** The whole of the saveable document. */
export interface ProjectState {
  name: string;
  nodes: Record<NodeId, SceneNode>;
  models: Record<string, ModelAsset>;
  modelOrder: string[];
  materials: Record<string, MaterialDef>;
  materialOrder: string[];
  lights: AreaLight[];
  environment: EnvironmentSettings;
  camera: CameraSettings;
  viewpoints: Viewpoint[];
  render: RenderSettings;
}
