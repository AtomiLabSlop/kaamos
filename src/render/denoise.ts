import { NoBlending, ShaderMaterial, type Texture } from 'three';

/**
 * The denoiser for path-traced renders.
 *
 * `three-gpu-pathtracer` ships an edge-preserving blur: each neighbour is
 * weighted by how close its colour is to the centre pixel's, and by distance.
 * The colour distance is taken on the raw linear radiance, against a fixed
 * threshold (0.03). That is the wrong yardstick for a bright surface. Noise is
 * proportional to brightness, so on glass reflecting a lit floor the grain is
 * several times the threshold, every neighbour looks like an edge, and nothing
 * is averaged — while a dark wall, whose noise is far below it, comes out
 * perfectly clean. That is the pattern of a render with clean surroundings and
 * grainy glass.
 *
 * Here the distance is taken after compressing each channel with x / (1 + x).
 * A step of a given size then counts for less the brighter it is, as it does
 * to the eye, so the same threshold smooths grain at every brightness and still
 * holds a real edge (a silhouette, a label) apart.
 */

export interface DenoiseParams {
  /** Blur radius in pixels (standard deviation). */
  sigma: number;
  /** Colour difference, after compression, above which a neighbour counts as an edge. */
  threshold: number;
}

export type DenoiseStrength = 'light' | 'medium' | 'strong';

export interface DenoisePreset {
  denoise: DenoiseParams;
  despeckle: DespeckleParams | null;
}

/**
 * Measured on the bottle scene (see README, "Grainy glass"). Light keeps the
 * most detail, Strong smooths hardest and softens fine edges.
 */
export const DENOISE_PRESETS: Record<DenoiseStrength, DenoisePreset> = {
  light: { denoise: { sigma: 5, threshold: 0.1 }, despeckle: { radius: 2, factor: 3 } },
  medium: { denoise: { sigma: 5, threshold: 0.1 }, despeckle: { radius: 2, factor: 2 } },
  strong: { denoise: { sigma: 5, threshold: 0.2 }, despeckle: { radius: 2, factor: 2 } },
};

export const DENOISE_DEFAULTS: DenoiseParams = { sigma: 5, threshold: 0.1 };

export function createDenoiseMaterial(
  DenoiseMaterialClass: new (parameters: object) => ShaderMaterial,
  map: Texture,
  parameters: object,
  params: DenoiseParams = DENOISE_DEFAULTS,
): ShaderMaterial {
  const material = new DenoiseMaterialClass({ map, ...parameters });

  const compress = /* glsl */ `
    vec4 compressRadiance( vec4 c ) { return vec4( c.rgb / ( 1.0 + c.rgb ), c.a ); }
  `;
  const before = material.fragmentShader;
  const after = before
    .replace('vec4 smartDeNoise(', `${compress}\n vec4 smartDeNoise(`)
    .replace(
      'vec4 dC = walkPx - centrPx;',
      'vec4 dC = compressRadiance( walkPx ) - compressRadiance( centrPx );',
    );

  // If the library's shader ever changes shape, fall back to its own rather
  // than shipping a half-patched one.
  if (after !== before && after.includes('compressRadiance( walkPx )')) {
    material.fragmentShader = after;
    material.needsUpdate = true;
  }

  material.uniforms.sigma.value = params.sigma;
  material.uniforms.threshold.value = params.threshold;
  return material;
}

/**
 * Firefly filter, run before the blur.
 *
 * Glass is the one surface a path tracer cannot aim light at: a ray inside it
 * can only find a small bright source by chance, so a few samples arrive
 * carrying hundreds of times the light of their neighbours. Those samples are
 * far above any edge threshold, so the blur cannot remove them, and they show
 * as white grain. This caps each pixel at a multiple of the mean of the pixels
 * around it. It costs a little brightness in a real, very small highlight, and
 * that is the trade: grain-free glass for a slightly softer sparkle.
 */
export interface DespeckleParams {
  /** Neighbourhood radius in pixels, 1 to 3. */
  radius: number;
  /** A pixel brighter than this multiple of its neighbours' mean is capped. */
  factor: number;
}

export const DESPECKLE_DEFAULTS: DespeckleParams = { radius: 2, factor: 3 };

export function createDespeckleMaterial(
  map: Texture,
  params: DespeckleParams = DESPECKLE_DEFAULTS,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      map: { value: map },
      radius: { value: Math.min(3, Math.max(1, Math.round(params.radius))) },
      factor: { value: params.factor },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float radius;
      uniform float factor;
      varying vec2 vUv;

      float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }

      void main() {
        vec2 size = vec2( textureSize( map, 0 ) );
        vec4 centre = texture2D( map, vUv );
        float sum = 0.0;
        float count = 0.0;
        for ( int x = -3; x <= 3; x ++ ) {
          for ( int y = -3; y <= 3; y ++ ) {
            if ( ( x == 0 && y == 0 ) || abs( float( x ) ) > radius || abs( float( y ) ) > radius ) continue;
            vec4 n = texture2D( map, vUv + vec2( float( x ), float( y ) ) / size );
            sum += luma( n.rgb * n.a );
            count += 1.0;
          }
        }
        float mean = sum / max( count, 1.0 );
        float limit = factor * mean + 0.02;
        float l = luma( centre.rgb * centre.a );
        if ( l > limit ) centre.rgb *= limit / l;
        gl_FragColor = centre;
      }
    `,
    depthTest: false,
    depthWrite: false,
    blending: NoBlending,
  });
}
