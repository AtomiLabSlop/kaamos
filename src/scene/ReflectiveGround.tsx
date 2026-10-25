import { useEffect, useMemo } from 'react';
import { AdditiveBlending, Color, PlaneGeometry, Vector3, type ShaderMaterial } from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { useThree } from '@react-three/fiber';
import { useProject } from '../store/project';
import { GROUND_FLAG, RASTER_ONLY_FLAG, subjectBounds } from './viewportApi';

/**
 * The product's reflection in the floor.
 *
 * A standard material can only reflect the environment map, never the model
 * standing on it — which is why the floor's gloss controls appear to do
 * nothing on a dark backdrop. This adds the missing half: a planar mirror that
 * renders the scene from the reflected camera and lays the result over the
 * floor, blurred by the floor's roughness and fading out with distance.
 *
 * It is drawn additively over the lit ground rather than replacing it, so the
 * floor keeps its own shading and the reflection can never punch a hole in it.
 * The ground shadow is drawn afterwards, so it darkens the reflection too.
 *
 * Three's `Reflector` updates from `onBeforeRender`, which matters: it means
 * the reflection is recomputed for whichever camera is rendering, so it stays
 * correct during the final render — at output resolution, and re-jittered with
 * every accumulation pass rather than frozen at the viewport's framing.
 */

const REFLECTION_Y = 0.004;
const REFLECTION_RESOLUTION = 1024;

const VERTEX = /* glsl */ `
  uniform mat4 textureMatrix;
  varying vec4 vReflectUv;
  varying vec3 vWorldPosition;

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    vReflectUv = textureMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec3 color;
  uniform float reflectivity;
  uniform float blurRadius;
  uniform float fadeDistance;
  uniform vec2 centre;

  varying vec4 vReflectUv;
  varying vec3 vWorldPosition;

  vec3 tap(vec2 offset) {
    vec4 uv = vReflectUv;
    // Scaling by w keeps the offset constant in screen space after the
    // projective divide, so the blur does not swell towards the horizon.
    uv.xy += offset * uv.w;
    return texture2DProj(tDiffuse, uv).rgb;
  }

  void main() {
    float dist = distance(vWorldPosition.xz, centre);
    float fade = 1.0 - smoothstep(fadeDistance * 0.25, fadeDistance, dist);
    if (fade <= 0.002) discard;

    vec3 viewDir = isOrthographic
      ? normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]))
      : normalize(cameraPosition - vWorldPosition);
    float facing = clamp(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0, 1.0);
    // Every surface reflects more at a grazing angle than head on.
    float fresnel = pow(1.0 - facing, 4.0);

    // A rough floor scatters more the further the reflected detail has to
    // travel, which is what makes a reflection smear out with distance.
    float radius = blurRadius * (0.3 + dist * 0.6);

    vec3 sum = tap(vec2(0.0));
    for (int i = 0; i < 8; i++) {
      float angle = float(i) * 0.7853981634;
      vec2 dir = vec2(cos(angle), sin(angle));
      sum += tap(dir * radius);
      sum += tap(dir * radius * 0.5);
    }
    vec3 reflection = sum / 17.0;

    float amount = reflectivity * mix(0.35, 1.0, fresnel) * fade;
    gl_FragColor = vec4(reflection * color * amount, 1.0);

    #include <colorspace_fragment>
  }
`;

export function ReflectiveGround() {
  const enabled = useProject((state) => state.environment.groundEnabled);
  const reflectivity = useProject((state) => state.environment.groundReflection);
  const roughness = useProject((state) => state.environment.groundRoughness);
  const fadeDistance = useProject((state) => state.environment.groundReflectionFade);
  // Node identity changes when the model does, which is when the reflection
  // needs recentring on a new subject.
  const nodes = useProject((state) => state.nodes);

  const reflector = useMemo(() => {
    const instance = new Reflector(new PlaneGeometry(1, 1), {
      textureWidth: REFLECTION_RESOLUTION,
      textureHeight: REFLECTION_RESOLUTION,
      clipBias: 0.003,
      // No multisampling: the seventeen-tap blur below softens the reflection
      // well past the point where edge aliasing in it could show.
      multisample: 0,
      shader: {
        name: 'GroundReflectionShader',
        uniforms: {
          color: { value: new Color(0xffffff) },
          tDiffuse: { value: null },
          textureMatrix: { value: null },
          reflectivity: { value: 0.45 },
          blurRadius: { value: 0.01 },
          fadeDistance: { value: 3 },
          centre: { value: [0, 0] },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
      },
    });

    const material = instance.material as ShaderMaterial;
    material.transparent = true;
    material.blending = AdditiveBlending;
    material.depthWrite = false;
    material.toneMapped = false;
    // The scene is already tone mapped on its way into the reflection buffer,
    // so only the transfer function is applied on the way out.
    material.polygonOffset = true;
    material.polygonOffsetFactor = -5;
    material.polygonOffsetUnits = -5;

    instance.rotation.x = -Math.PI / 2;
    instance.position.y = REFLECTION_Y;
    instance.renderOrder = 1;
    instance.userData[GROUND_FLAG] = true;
    instance.userData[RASTER_ONLY_FLAG] = true;

    return instance;
  }, []);

  useEffect(() => () => reflector.dispose(), [reflector]);

  const material = reflector.material as ShaderMaterial;
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    material.uniforms.reflectivity.value = reflectivity;
    // Roughness drives the blur: a polished floor mirrors, a satin one smears.
    material.uniforms.blurRadius.value = roughness * roughness * 0.09;
    material.uniforms.fadeDistance.value = fadeDistance;
    invalidate();
  }, [material, reflectivity, roughness, fadeDistance, invalidate]);

  // Centre and size the mirror on the subject, one frame after it mounts.
  useEffect(() => {
    if (!enabled) return;
    const frame = requestAnimationFrame(() => {
      const bounds = subjectBounds();
      const centre = bounds ? bounds.getCenter(new Vector3()) : new Vector3();
      const extent = Math.max(fadeDistance, 0.5) * 2.4;
      reflector.position.set(centre.x, REFLECTION_Y, centre.z);
      reflector.scale.set(extent, extent, 1);
      material.uniforms.centre.value = [centre.x, centre.z];
      invalidate();
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, fadeDistance, nodes, reflector, material, invalidate]);

  if (!enabled || reflectivity <= 0) return null;

  return <primitive object={reflector} />;
}
