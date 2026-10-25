import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  DepthTexture,
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import { currentLens } from '../render/depthOfField';
import { useProject } from '../store/project';
import { mainViewTargets } from './viewportApi';

/**
 * Depth of field in the fast viewport.
 *
 * The scene is drawn into an off-screen buffer with its depth, and a second
 * pass blurs each pixel by how far its distance is from the focus distance, in
 * the real lens terms the final render uses (aperture from the F-stop and the
 * focal length, then the same similar-triangles size of blur at each distance).
 * It is a screen-space approximation: it cannot show what is hidden behind an
 * object, so the edges of blurred things are a little harder than in the path
 * traced preview or a final render, which do it properly. It is mounted only
 * while the lens is on, because any frame callback with a priority above zero
 * stops R3F drawing the scene by itself.
 */

/** Widest blur drawn, in pixels of the drawing buffer; keeps the pass cheap. */
const MAX_BLUR_PX = 30;
const TAPS = 44;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  #include <common>
  #include <packing>
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 texel;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform float focus;
  uniform float aperture;      // lens radius, world units
  uniform float pixelsPerUnit; // pixels per world unit at distance 1
  uniform float maxBlur;

  float viewDistance(vec2 uv) {
    float depth = texture2D(tDepth, uv).x;
    return -perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
  }

  // Radius, in pixels, of the blur disc for something at distance d.
  float blurRadius(float d) {
    return min(maxBlur, aperture * abs(d - focus) / max(d, 1e-5) * pixelsPerUnit / focus);
  }

  float noise(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }

  void main() {
    vec4 centre = texture2D(tColor, vUv);
    float centreDistance = viewDistance(vUv);
    float radius = blurRadius(centreDistance);
    vec4 sum = centre;
    float total = 1.0;
    if (radius > 0.4) {
      float turn = noise(gl_FragCoord.xy) * 6.2831853;
      sum = vec4(0.0);
      total = 0.0;
      for (int i = 0; i < ${TAPS}; i++) {
        float t = (float(i) + 0.5) / float(${TAPS});
        float angle = float(i) * 2.3999632 + turn;
        float reach = sqrt(t) * radius;
        vec2 uv = vUv + vec2(cos(angle), sin(angle)) * reach * texel;
        float d = viewDistance(uv);
        // A neighbour only contributes if its own blur reaches this far, so
        // sharp things do not smear into the blur around them.
        float own = blurRadius(d);
        float w = clamp(own - reach + 1.0, 0.0, 1.0);
        // Something nearer than this pixel always spills over it.
        if (d < centreDistance) w = max(w, clamp(radius - reach + 1.0, 0.0, 1.0) * step(0.4, own));
        sum += texture2D(tColor, uv) * w;
        total += w;
      }
      // The pixel itself, so a pixel with no contributing neighbours stays.
      sum += centre;
      total += 1.0;
    }
    gl_FragColor = sum / max(total, 1e-4);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function RasterDepthOfField() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);

  const target = useRef<WebGLRenderTarget | null>(null);
  const size = useMemo(() => new Vector2(), []);

  const post = useMemo(() => {
    const material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        texel: { value: new Vector2() },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 100 },
        focus: { value: 1 },
        aperture: { value: 0 },
        pixelsPerUnit: { value: 1 },
        maxBlur: { value: MAX_BLUR_PX },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const quadScene = new Scene();
    quadScene.add(quad);
    return { material, quad, quadScene, quadCamera: new OrthographicCamera(-1, 1, 1, -1, 0, 1) };
  }, []);

  // A lens edit has to redraw even though nothing in the scene moved.
  const signature = useProject(
    (state) =>
      `${state.render.fStop}|${state.render.focusDistance}|${state.camera.fov}`,
  );
  useEffect(() => invalidate(), [signature, invalidate]);

  useEffect(
    () => () => {
      target.current?.depthTexture?.dispose();
      target.current?.dispose();
      target.current = null;
      post.quad.geometry.dispose();
      post.material.dispose();
      invalidate();
    },
    [post, invalidate],
  );

  useFrame((state) => {
    // A final render stops the loop; never draw into its targets.
    if (state.frameloop === 'never') return;
    gl.getDrawingBufferSize(size);
    const width = Math.max(1, Math.floor(size.x));
    const height = Math.max(1, Math.floor(size.y));
    let buffer = target.current;
    if (!buffer || buffer.width !== width || buffer.height !== height) {
      buffer?.depthTexture?.dispose();
      buffer?.dispose();
      buffer = new WebGLRenderTarget(width, height, {
        type: HalfFloatType,
        samples: 4,
        depthTexture: new DepthTexture(width, height),
      });
      target.current = buffer;
      mainViewTargets.add(buffer);
    }

    const lens = camera instanceof PerspectiveCamera ? currentLens() : null;
    const previousTarget = gl.getRenderTarget();

    gl.setRenderTarget(buffer);
    gl.render(scene, camera);
    gl.setRenderTarget(previousTarget);

    const uniforms = post.material.uniforms;
    uniforms.tColor.value = buffer.texture;
    uniforms.tDepth.value = buffer.depthTexture;
    uniforms.texel.value.set(1 / width, 1 / height);
    if (camera instanceof PerspectiveCamera) {
      uniforms.cameraNear.value = camera.near;
      uniforms.cameraFar.value = camera.far;
      uniforms.pixelsPerUnit.value = height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    }
    // With no usable lens the aperture is zero and the pass is a plain copy.
    uniforms.aperture.value = lens ? lens.apertureRadius : 0;
    uniforms.focus.value = lens ? Math.max(lens.focusDistance, 1e-4) : 1;

    gl.render(post.quadScene, post.quadCamera);
  }, 1);

  return null;
}
