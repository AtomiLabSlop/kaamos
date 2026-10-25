import { useEffect, useMemo, useRef } from 'react';
import {
  Box3,
  DoubleSide,
  Mesh,
  NoBlending,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { useThree } from '@react-three/fiber';
import { useProject } from '../store/project';
import { nodeIdOf, RASTER_ONLY_FLAG, subjectBounds } from './viewportApi';

/**
 * Soft ground shadow.
 *
 * Area lights in Three.js illuminate but cast no shadow map, so the shadow that
 * grounds a product on its sweep is rendered here instead.
 *
 * The subject is drawn into an off-screen buffer from a camera placed *below*
 * the floor looking up. Ordinary depth testing then keeps, for each pixel, the
 * surface nearest the camera — which is the lowest surface in that column — and
 * the shader darkens it according to how close to the floor it sits. Blurred,
 * that gives a firm contact shadow where the product touches down and a soft
 * falloff under parts that overhang, which is how a shadow on a seamless
 * backdrop behaves.
 *
 * Looking up rather than down is what lets plain depth testing pick the lowest
 * surface. The cost is a mirrored buffer, undone by the texture transform set
 * in `createRig`.
 *
 * It recomputes only when the scene or the shadow settings change — the result
 * does not depend on the view camera — so it costs nothing per frame.
 */

const SHADOW_Y = 0.002;
/** How far below the floor the shadow camera sits. */
const CAMERA_DROP = 1;

const CASTER_VERTEX = /* glsl */ `
  varying float vHeight;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vHeight = world.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const CASTER_FRAGMENT = /* glsl */ `
  uniform float maxHeight;
  varying float vHeight;
  void main() {
    float t = clamp(vHeight / maxHeight, 0.0, 1.0);
    // Falls off faster than linear, so contact stays tight while raised parts
    // contribute only a broad, light darkening.
    float a = pow(1.0 - t, 1.7);
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  }
`;

const BLUR_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Five-tap Gaussian using linear sampling; run per axis for a separable blur. */
const BLUR_FRAGMENT = /* glsl */ `
  uniform sampler2D tSource;
  uniform vec2 direction;
  varying vec2 vUv;
  void main() {
    vec4 sum = texture2D(tSource, vUv) * 0.2270270270;
    sum += texture2D(tSource, vUv + direction * 1.3846153846) * 0.3162162162;
    sum += texture2D(tSource, vUv - direction * 1.3846153846) * 0.3162162162;
    sum += texture2D(tSource, vUv + direction * 3.2307692308) * 0.0702702703;
    sum += texture2D(tSource, vUv - direction * 3.2307692308) * 0.0702702703;
    gl_FragColor = sum;
  }
`;

interface ShadowRig {
  target: WebGLRenderTarget;
  scratch: WebGLRenderTarget;
  camera: OrthographicCamera;
  caster: ShaderMaterial;
  blur: ShaderMaterial;
  quadScene: Scene;
  quadCamera: OrthographicCamera;
  resolution: number;
  dispose(): void;
}

function createRig(resolution: number): ShadowRig {
  const target = new WebGLRenderTarget(resolution, resolution, {
    depthBuffer: true,
    stencilBuffer: false,
  });
  const scratch = new WebGLRenderTarget(resolution, resolution, {
    depthBuffer: false,
    stencilBuffer: false,
  });

  // Undo the mirroring that comes from looking up at the subject rather than
  // down at it, so the buffer lands on the ground plane the right way round.
  target.texture.repeat.set(1, -1);
  target.texture.offset.set(0, 1);

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.up.set(0, 0, 1);

  const caster = new ShaderMaterial({
    vertexShader: CASTER_VERTEX,
    fragmentShader: CASTER_FRAGMENT,
    uniforms: { maxHeight: { value: 1 } },
    // Depth testing already picks one surface per pixel, so the fragment is
    // written straight out with no blending.
    blending: NoBlending,
    depthTest: true,
    depthWrite: true,
    side: DoubleSide,
  });

  const blur = new ShaderMaterial({
    vertexShader: BLUR_VERTEX,
    fragmentShader: BLUR_FRAGMENT,
    uniforms: {
      tSource: { value: null },
      direction: { value: new Vector2() },
    },
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  });

  const quadScene = new Scene();
  const quad = new Mesh(new PlaneGeometry(2, 2), blur);
  quad.frustumCulled = false;
  quadScene.add(quad);
  const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  return {
    target,
    scratch,
    camera,
    caster,
    blur,
    quadScene,
    quadCamera,
    resolution,
    dispose() {
      target.dispose();
      scratch.dispose();
      caster.dispose();
      blur.dispose();
      quad.geometry.dispose();
    },
  };
}

/** True for the subject and its descendants; false for ground, grid, helpers. */
function isSubject(object: Object3D) {
  let current: Object3D | null = object;
  while (current) {
    if (nodeIdOf(current)) return true;
    current = current.parent;
  }
  return false;
}

interface UpdateOptions {
  spread: number;
  blurAmount: number;
}

function updateShadow(
  gl: WebGLRenderer,
  scene: Scene,
  rig: ShadowRig,
  plane: Mesh | null,
  { spread, blurAmount }: UpdateOptions,
) {
  const bounds: Box3 | null = subjectBounds();

  const previousTarget = gl.getRenderTarget();
  const previousOverride = scene.overrideMaterial;
  const previousBackground = scene.background;
  const previousAutoClear = gl.autoClear;
  const previousClearAlpha = gl.getClearAlpha();

  // Everything that is not the subject steps out of the way for one render.
  const hidden: Object3D[] = [];
  scene.traverse((object) => {
    if (!(object as Mesh).isMesh || !object.visible) return;
    if (isSubject(object)) return;
    object.visible = false;
    hidden.push(object);
  });

  try {
    scene.overrideMaterial = rig.caster;
    scene.background = null;
    gl.autoClear = false;

    gl.setRenderTarget(rig.target);
    gl.setClearAlpha(0);
    gl.clear(true, true, false);

    let extent = 1;

    if (bounds) {
      const centre = bounds.getCenter(new Vector3());
      const size = bounds.getSize(new Vector3());
      const height = Math.max(bounds.max.y, 0.05);

      // The shadow area is sized from the product's own footprint rather than
      // fixed in scene units. A fixed area spends most of the buffer on empty
      // floor, which is what makes the shadow look low-resolution next to a
      // small object — and leaves a large one clipped.
      const footprint = Math.max(size.x, size.z) * 0.5;
      const half = Math.max(footprint * spread, 0.2);
      extent = half * 2;

      rig.caster.uniforms.maxHeight.value = height * 1.1;

      rig.camera.left = -half;
      rig.camera.right = half;
      rig.camera.top = half;
      rig.camera.bottom = -half;
      rig.camera.near = CAMERA_DROP * 0.5;
      rig.camera.far = CAMERA_DROP + height * 1.4 + 0.5;
      rig.camera.position.set(centre.x, -CAMERA_DROP, centre.z);
      rig.camera.lookAt(centre.x, 0, centre.z);
      rig.camera.updateProjectionMatrix();
      rig.camera.updateMatrixWorld(true);

      gl.render(scene, rig.camera);

      if (plane) {
        plane.position.set(centre.x, SHADOW_Y, centre.z);
        // The display plane is a unit quad scaled to match the area that was
        // just rendered, so the two always agree.
        plane.scale.set(extent, extent, 1);
      }
    }

    /* ---- separable blur, ping-ponging between the two targets ----
       The blur is sized in scene units rather than texels, so softness means
       the same thing whatever the buffer resolution or how far the shadow is
       spread. Without this the pool stays tighter than the product's own
       footprint and is hidden behind it from any raised viewpoint. */
    const worldRadius = blurAmount * 0.075;
    const texels = (worldRadius / Math.max(extent, 0.1)) * rig.resolution * 0.35;
    if (bounds && texels > 0.01) {
      scene.overrideMaterial = null;
      const step = texels / rig.resolution;

      const pass = (
        source: WebGLRenderTarget,
        into: WebGLRenderTarget,
        dx: number,
        dy: number,
      ) => {
        rig.blur.uniforms.tSource.value = source.texture;
        rig.blur.uniforms.direction.value.set(dx, dy);
        gl.setRenderTarget(into);
        gl.clear(true, false, false);
        gl.render(rig.quadScene, rig.quadCamera);
      };

      pass(rig.target, rig.scratch, step, 0);
      pass(rig.scratch, rig.target, 0, step);
      // A second, wider pass turns the Gaussian into the broader falloff that
      // a large soft source actually produces.
      pass(rig.target, rig.scratch, step * 2.1, 0);
      pass(rig.scratch, rig.target, 0, step * 2.1);
    }
  } finally {
    for (const object of hidden) object.visible = true;
    scene.overrideMaterial = previousOverride;
    scene.background = previousBackground;
    gl.autoClear = previousAutoClear;
    gl.setClearAlpha(previousClearAlpha);
    gl.setRenderTarget(previousTarget);
  }
}

export function GroundShadow() {
  const enabled = useProject((state) => state.environment.shadowEnabled);
  const opacity = useProject((state) => state.environment.shadowOpacity);
  const spread = useProject((state) => state.environment.shadowSpread);
  const blurAmount = useProject((state) => state.environment.shadowBlur);
  const resolution = useProject((state) => state.render.shadowResolution);
  // Node identity changes exactly when geometry, transforms or visibility do.
  const nodes = useProject((state) => state.nodes);

  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const planeRef = useRef<Mesh>(null);

  const rig = useMemo(() => createRig(resolution), [resolution]);
  useEffect(() => () => rig.dispose(), [rig]);

  useEffect(() => {
    if (!enabled) return;
    // One frame of delay, so newly mounted geometry is in the scene graph.
    const frame = requestAnimationFrame(() => {
      updateShadow(gl, scene, rig, planeRef.current, { spread, blurAmount });
      invalidate();
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, spread, blurAmount, nodes, gl, scene, rig, invalidate]);

  if (!enabled) return null;

  return (
    <mesh
      ref={planeRef}
      rotation-x={-Math.PI / 2}
      position={[0, SHADOW_Y, 0]}
      userData={{ [RASTER_ONLY_FLAG]: true }}
      renderOrder={2}
    >
      {/* Sized imperatively in `updateShadow`, to match the rendered area. */}
      <planeGeometry args={[1, 1]} />
      {/* The shadow lives entirely in the buffer's alpha channel; the colour
          is flat black and `opacity` scales how far it goes. */}
      {/* A decal on the floor: the polygon offset pulls it towards the camera
          in depth so it always wins against the ground plane a couple of
          millimetres below, while still being hidden behind the product. */}
      <meshBasicMaterial
        map={rig.target.texture}
        transparent
        opacity={opacity}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-6}
        polygonOffsetUnits={-6}
        toneMapped={false}
      />
    </mesh>
  );
}
