/**
 * Subsurface scattering for the path tracer (1.01.0).
 *
 * three-gpu-pathtracer has no subsurface model, so this patches its fragment
 * shader at run time, the same way `patchNanGuard` does. The method is a
 * volumetric random walk inside the closed mesh:
 *
 *  1. At a front-face hit of a subsurface material the normal BSDF decides
 *     between the glossy coat (reflection, as for any dielectric) and entering.
 *  2. A ray that enters starts a walk: it flies a random distance (exponential,
 *     mean = the scatter radius), scatters isotropically, multiplies its weight
 *     by the single-scatter albedo, and repeats until the next distance reaches
 *     the mesh boundary.
 *  3. At the exit point the surface acts as a white diffuse emitter: direct
 *     light is sampled there and the path continues with a diffuse bounce.
 *
 * The material is told apart through a field the tracer already reads and the
 * app never uses: `iridescenceThicknessRange[0]` (the packed
 * `iridescenceThicknessMinimum`) carries the scatter radius in world units; a
 * NEGATIVE value (minus the radius, because three's own default is +100) on a material with no iridescence turns the walk on. The surface
 * colour is the diffuse reflectance A the user picks; it is turned into the
 * single-scatter albedo with the van de Hulst style fit from Chiang et al.,
 * "Practical and Controllable Subsurface Scattering for Production Path
 * Tracing" (SIGGRAPH 2016 talk), so A is roughly the colour of a thick slab.
 *
 * Limits, on purpose: one mean free path for all three channels (the colour
 * comes from the albedo only), the exit is Lambertian whatever the exit
 * surface's own finish, only closed meshes behave, and the walk is capped at
 * `STEPS` scatters (the last leg then goes straight to the boundary, so no
 * energy is thrown away, the light just exits a little close to the entry).
 */

/** Scatter events per walk before the walk is forced out through the boundary. */
const STEPS = 48;

const HELPERS = /* glsl */ `
	// ---- Kaamos subsurface scattering ----
	#define KAAMOS_SSS_STEPS ${STEPS}

	uint kaamosSssState = 1u;

	uint kaamosPcg( uint v ) {

		uint s = v * 747796405u + 2891336453u;
		uint w = ( ( s >> ( ( s >> 28u ) + 4u ) ) ^ s ) * 277803737u;
		return ( w >> 22u ) ^ w;

	}

	float kaamosSssRand() {

		kaamosSssState = kaamosPcg( kaamosSssState );
		return max( float( kaamosSssState ) / 4294967295.0, 1e-6 );

	}

	// diffuse reflectance A -> single-scatter albedo (Chiang et al. 2016)
	vec3 kaamosAlbedoToAlpha( vec3 a ) {

		a = clamp( a, vec3( 0.0 ), vec3( 0.999 ) );
		vec3 s = sqrt( 9.59217 + 41.6808 * a + 17.7126 * a * a );
		vec3 t = 4.09712 + 4.20863 * a - s;
		return clamp( 1.0 - t * t, vec3( 0.0 ), vec3( 1.0 ) );

	}

	// Walks inside the mesh from startPoint along startDir. Returns false if the
	// walk is lost (no boundary found, which means an open mesh).
	bool kaamosSubsurfaceWalk(
		vec3 startPoint, vec3 startDir, float meanFreePath, vec3 alpha,
		out vec3 exitPoint, out vec3 exitNormal, out vec3 exitSmoothNormal, out vec3 weight
	) {

		vec3 p = startPoint;
		vec3 d = normalize( startDir );
		weight = vec3( 1.0 );
		exitPoint = p;
		exitNormal = - d;
		exitSmoothNormal = - d;

		for ( int k = 0; k < KAAMOS_SSS_STEPS; k ++ ) {

			SurfaceHit hit;
			bool found = bvhIntersectFirstHit( bvh, p, d, hit.faceIndices, hit.faceNormal, hit.barycoord, hit.side, hit.dist );
			if ( ! found ) {

				return false;

			}

			float t = - log( kaamosSssRand() ) * meanFreePath;
			if ( t >= hit.dist || k == KAAMOS_SSS_STEPS - 1 ) {

				exitPoint = p + d * hit.dist;

				// outward normal: the geometric normal that points along the ray
				vec3 ng = hit.faceNormal;
				if ( dot( ng, d ) < 0.0 ) ng = - ng;
				vec3 ns = normalize( textureSampleBarycoord( attributesArray, ATTR_NORMAL, hit.barycoord, hit.faceIndices.xyz ).xyz );
				if ( dot( ns, ng ) < 0.0 ) ns = - ns;
				exitNormal = ng;
				exitSmoothNormal = ns;
				return true;

			}

			p += d * t;
			d = sampleSphere( vec2( kaamosSssRand(), kaamosSssRand() ) );
			weight *= alpha;

		}

		return false;

	}

	void main() {
`;

/**
 * Replaces the entry BSDF sample: a subsurface material is sampled as a
 * dielectric whose transmitted half enters the walk. The shadow/light sampling
 * that follows sees only the glossy coat.
 */
const SAMPLE_BLOCK = /* glsl */ `
						float kaamosRadius = - material.iridescenceThicknessMinimum;
						bool kaamosSss =
							hitType == SURFACE_HIT && ! surf.volumeParticle &&
							kaamosRadius > 0.0 && material.iridescence == 0.0 &&
							surfaceHit.side == 1.0;
						vec3 kaamosAlbedo = surf.color;
						if ( kaamosSss ) {

							surf.transmission = 1.0;
							surf.metalness = 0.0;
							surf.color = vec3( 1.0 );

						}

						scatterRec = bsdfSample( - ray.direction, surf );

						if ( kaamosSss ) {

							// light sampling below sees the glossy coat only
							surf.transmission = 0.0;
							surf.color = vec3( 0.0 );

						}
`;

/** Replaces "prepare for next ray": the walk, then a diffuse exit. */
const NEXT_RAY_BLOCK = /* glsl */ `
						// prepare for next ray
						if ( kaamosSss && isBelowSurface ) {

							kaamosSssState = kaamosPcg(
								uint( gl_FragCoord.x ) * 1973u + uint( gl_FragCoord.y ) * 9277u +
								uint( seed ) * 26699u + sobolBounceIndex * 6271u + uint( i + 64 ) * 1013u
							);

							vec3 walkPoint, walkNormal, walkSmooth, walkWeight;
							if ( ! kaamosSubsurfaceWalk(
								hitPoint, scatterRec.direction, kaamosRadius,
								kaamosAlbedoToAlpha( kaamosAlbedo ),
								walkPoint, walkNormal, walkSmooth, walkWeight
							) ) {

								break;

							}

							state.throughputColor *= walkWeight;

							// the exit: a white diffuse surface facing out
							SurfaceRecord exitSurf = surf;
							exitSurf.faceNormal = walkNormal;
							exitSurf.normal = walkSmooth;
							exitSurf.clearcoatNormal = walkSmooth;
							exitSurf.frontFace = true;
							exitSurf.transmission = 0.0;
							exitSurf.metalness = 0.0;
							exitSurf.color = vec3( 1.0 );
							exitSurf.roughness = 1.0;
							exitSurf.filteredRoughness = 1.0;
							exitSurf.clearcoat = 0.0;
							exitSurf.sheen = 0.0;
							exitSurf.iridescence = 0.0;
							exitSurf.specularIntensity = 0.0;
							exitSurf.normalBasis = getBasisFromNormal( walkSmooth );
							exitSurf.normalInvBasis = inverse( exitSurf.normalBasis );
							exitSurf.clearcoatBasis = exitSurf.normalBasis;
							exitSurf.clearcoatInvBasis = exitSurf.normalInvBasis;

							vec3 exitOrigin = stepRayOrigin( walkPoint, walkNormal, walkNormal, 0.0 );
							state.transmissiveRay = false;
							state.isShadowRay = false;

							#if FEATURE_MIS

							gl_FragColor.rgb += directLightContribution( walkSmooth, exitSurf, state, exitOrigin );

							#endif

							scatterRec = bsdfSample( walkSmooth, exitSurf );
							if ( scatterRec.pdf <= 0.0 || ! isDirectionValid( scatterRec.direction, exitSurf.normal, exitSurf.faceNormal ) ) {

								break;

							}

							state.throughputColor *= scatterRec.color / scatterRec.pdf;
							if ( kaamosNotFiniteColor( state.throughputColor ) ) {

								break;

							}

							ray.direction = scatterRec.direction;
							ray.origin = exitOrigin;

						} else {

							ray.direction = scatterRec.direction;
							ray.origin = hitPoint;

						}
`;

/** Number of times a shader fragment appears, for the "has the shader changed" check. */
function count(source: string, needle: string | RegExp): number {
  if (typeof needle === 'string') return source.split(needle).length - 1;
  return (source.match(new RegExp(needle.source, needle.flags.includes('g') ? needle.flags : needle.flags + 'g')) ?? []).length;
}

const SAMPLE_ANCHOR = 'scatterRec = bsdfSample( - ray.direction, surf );';
const NEXT_RAY_ANCHOR = /\/\/ prepare for next ray\s+ray\.direction = scatterRec\.direction;\s+ray\.origin = hitPoint;/;
const MAIN_ANCHOR = 'void main() {';

/**
 * Adds subsurface scattering to a `WebGLPathTracer`'s shader. Call it after
 * `patchNanGuard`, before the scene is set. Returns false (and warns) when the
 * library's shader no longer has the expected shape, in which case materials
 * with a scatter radius simply render as the dielectric they are underneath.
 */
export function patchSubsurface(tracer: unknown): boolean {
  const material = (tracer as { _pathTracer?: { material?: { fragmentShader?: string } } })
    ._pathTracer?.material;
  const source = material?.fragmentShader;
  if (
    !material ||
    !source ||
    count(source, SAMPLE_ANCHOR) !== 1 ||
    count(source, NEXT_RAY_ANCHOR) !== 1 ||
    count(source, MAIN_ANCHOR) !== 1
  ) {
    console.warn('Path tracer subsurface scattering could not be patched; the shader has changed');
    return false;
  }
  if (source.includes('kaamosSubsurfaceWalk')) return true;

  // Reuses the finite check from patchNanGuard when present, otherwise defines it.
  const finite = source.includes('bool kaamosNotFinite( vec3 v )')
    ? 'bool kaamosNotFiniteColor( vec3 v ) { return kaamosNotFinite( v ); }'
    : 'bool kaamosNotFiniteColor( vec3 v ) { return any( isnan( v ) ) || any( isinf( v ) ); }';

  material.fragmentShader = source
    .replace(MAIN_ANCHOR, `${finite}\n${HELPERS}`)
    .replace(SAMPLE_ANCHOR, SAMPLE_BLOCK.trim())
    .replace(NEXT_RAY_ANCHOR, NEXT_RAY_BLOCK.trim());
  return true;
}
