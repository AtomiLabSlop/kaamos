import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  Color,
  DoubleSide,
  type Material,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  type Object3D,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
} from 'three';
import { useUI } from '../store/ui';
import { HELPER_FLAG, RASTER_ONLY_FLAG, SUBJECT_FLAG, mainViewTargets } from './viewportApi';

/**
 * Selection outline, drawn in screen space.
 *
 * The selected part (and everything under it) is drawn flat white into a mask,
 * and a full-screen pass draws an orange band where the mask ends. It replaces
 * drei's `<Outlines>`, which built an inflated copy of the mesh with merged
 * normals on every selection — seconds for a 100k-triangle part, and the copy
 * of a label lying 0.1 mm off the glass z-fought with the glass as stripes.
 * Here nothing is computed per selection, and there is no second surface to
 * fight with. The cost is one extra draw of the selected geometry per frame.
 *
 * The outline follows the whole silhouette, including parts hidden behind
 * other objects, which is how most modelling tools show a selection.
 */

const COLOUR = new Color('#e8a33d');
/** Band width in CSS pixels; scaled by the device pixel ratio. */
const WIDTH = 2;

const maskMaterial = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide });

function collectMeshes(root: Object3D, nodeId: string): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((object) => {
    if (object.userData?.[SUBJECT_FLAG] !== nodeId) return;
    object.traverse((child) => {
      const mesh = child as Mesh;
      if (mesh.isMesh && mesh.userData?.[SUBJECT_FLAG] !== undefined) out.push(mesh);
    });
  });
  return out;
}

function createCompositeMaterial(mask: WebGLRenderTarget) {
  const material = new ShaderMaterial({
    uniforms: {
      mask: { value: mask.texture },
      texel: { value: new Vector2(1, 1) },
      radius: { value: WIDTH },
      colour: { value: COLOUR },
      // 1 while a reflection or other off-screen pass draws the scene.
      skip: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D mask;
      uniform vec2 texel;
      uniform float radius;
      uniform vec3 colour;
      uniform float skip;
      varying vec2 vUv;
      void main() {
        if (skip > 0.5) discard;
        float inside = texture2D(mask, vUv).r;
        if (inside > 0.5) discard;
        float edge = 0.0;
        for (int x = -3; x <= 3; x++) {
          for (int y = -3; y <= 3; y++) {
            vec2 o = vec2(float(x), float(y));
            if (length(o) > radius + 0.5) continue;
            edge = max(edge, texture2D(mask, vUv + o * texel).r);
          }
        }
        if (edge < 0.5) discard;
        gl_FragColor = vec4(colour, 0.95);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  // The floor's mirror draws the whole scene into its own render target. This
  // quad is a screen-space overlay, so it must not be part of that picture:
  // mirrored, it showed as a ghost outline on the floor.
  material.onBeforeRender = (renderer) => {
    const target = renderer.getRenderTarget();
    material.uniforms.skip.value = target && !mainViewTargets.has(target) ? 1 : 0;
  };
  return material;
}

export function SelectionOutline() {
  const selectedNodeId = useUI((state) => state.selectedNodeId);
  const groupNodeIds = useUI((state) => state.groupNodeIds);
  const pathPreview = useUI((state) => state.pathPreview);
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);

  const mask = useMemo(() => new WebGLRenderTarget(1, 1, { depthBuffer: true }), []);
  const material = useMemo(() => createCompositeMaterial(mask), [mask]);
  const size = useMemo(() => new Vector2(), []);
  // The path traced preview cannot hold the quad (the tracer would trace it), so
  // there the outline is drawn on top of the tracer's picture from a scene of
  // its own.
  const overlay = useMemo(() => {
    const overlayScene = new Scene();
    const quad = new Mesh(new PlaneGeometry(1, 1), material);
    quad.frustumCulled = false;
    overlayScene.add(quad);
    return overlayScene;
  }, [material]);
  const overlayCamera = useMemo(() => new OrthographicCamera(-1, 1, 1, -1, 0, 1), []);

  useEffect(() => () => {
    mask.dispose();
    material.dispose();
  }, [mask, material]);

  useEffect(() => invalidate(), [selectedNodeId, groupNodeIds, pathPreview, invalidate]);

  // Raster: runs before the scene is drawn (priority 0), so the composite quad
  // below samples this frame's mask. Path traced preview: runs after it.
  useFrame(() => {
    if (!selectedNodeId) return;
    gl.getDrawingBufferSize(size);
    if (mask.width !== size.x || mask.height !== size.y) mask.setSize(size.x, size.y);
    const ratio = gl.getPixelRatio();
    material.uniforms.texel.value.set(1 / size.x, 1 / size.y);
    material.uniforms.radius.value = Math.min(3, WIDTH * ratio);

    const ids = groupNodeIds.length > 0 ? groupNodeIds : [selectedNodeId];
    const picked = new Set<Mesh>();
    for (const id of ids) for (const mesh of collectMeshes(scene, id)) picked.add(mesh);
    const meshes = [...picked].filter((mesh) => {
      let object: Object3D | null = mesh;
      while (object) {
        if (!object.visible) return false;
        object = object.parent;
      }
      return true;
    });

    const previousTarget = gl.getRenderTarget();
    const previousAutoClear = gl.autoClear;
    const previousClear = gl.getClearColor(new Color());
    const previousAlpha = gl.getClearAlpha();
    gl.setRenderTarget(mask);
    gl.setClearColor(0x000000, 1);
    gl.clear(true, true, false);
    gl.autoClear = false;
    for (const mesh of meshes) {
      const original = mesh.material as Material | Material[];
      mesh.material = maskMaterial;
      // Render the mesh alone; its world matrix is already current.
      const children = mesh.children;
      mesh.children = [];
      gl.render(mesh, camera);
      mesh.children = children;
      mesh.material = original;
    }
    gl.autoClear = previousAutoClear;
    gl.setClearColor(previousClear, previousAlpha);
    gl.setRenderTarget(previousTarget);

    if (pathPreview) {
      // After the preview's own draw (priority 1): lay the outline over it.
      gl.autoClear = false;
      gl.setRenderTarget(null);
      gl.render(overlay, overlayCamera);
      gl.autoClear = previousAutoClear;
      gl.setRenderTarget(previousTarget);
    }
  }, pathPreview ? 2 : 0);

  if (!selectedNodeId || pathPreview) return null;
  return (
    <mesh
      frustumCulled={false}
      renderOrder={10000}
      userData={{ [HELPER_FLAG]: true, [RASTER_ONLY_FLAG]: true }}
      material={material}
      // Drawn in clip space; its geometry is not where it appears, so it must
      // never be hit by picking.
      raycast={() => {}}
    >
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}
