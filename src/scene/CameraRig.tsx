import { useEffect, useRef } from 'react';
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CineonToneMapping,
  LinearToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  ReinhardToneMapping,
  MOUSE,
  type ToneMapping,
} from 'three';
import { OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useProject } from '../store/project';
import { useUI } from '../store/ui';
import type { ToneMappingId, Vec3 } from '../store/types';
import { applyCameraRoll, dollyForFov, fovBasis, savedPose } from './viewportApi';

export const TONE_MAPPINGS: Record<ToneMappingId, ToneMapping> = {
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
  neutral: NeutralToneMapping,
  reinhard: ReinhardToneMapping,
  cineon: CineonToneMapping,
  linear: LinearToneMapping,
  none: NoToneMapping,
};

export const TONE_MAPPING_LABELS: { id: ToneMappingId; label: string }[] = [
  { id: 'neutral', label: 'Khronos Neutral' },
  { id: 'agx', label: 'AgX' },
  { id: 'aces', label: 'ACES Filmic' },
  { id: 'reinhard', label: 'Reinhard' },
  { id: 'cineon', label: 'Cineon' },
  { id: 'linear', label: 'Linear' },
  { id: 'none', label: 'None' },
];

const INITIAL_POSITION: Vec3 = [2.5, 1.9, 3];
const INITIAL_TARGET: Vec3 = [0, 0.55, 0];

/**
 * Cameras, orbit controls and the renderer's tone response.
 *
 * Switching projection replaces the camera object, so the current pose is
 * tracked here and reapplied to the new camera — otherwise the view would jump
 * back to its default every time the user toggled orthographic.
 */
export function CameraRig() {
  const projection = useProject((state) => state.camera.projection);
  const fov = useProject((state) => state.camera.fov);
  const orthoZoom = useProject((state) => state.camera.orthoZoom);
  const exposure = useProject((state) => state.camera.exposure);
  const toneMapping = useProject((state) => state.camera.toneMapping);

  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const controls = useThree((state) => state.controls) as OrbitControlsImpl | null;
  const viewTool = useUI((state) => state.viewTool);

  // A canvas rebuilt after a lost graphics context starts from the saved view.
  const start = useRef<{ position: Vec3; target: Vec3 }>(
    savedPose.value ?? { position: INITIAL_POSITION, target: INITIAL_TARGET },
  ).current;
  const pose = useRef<{ position: Vec3; target: Vec3 }>(start);

  // Tone mapping is part of the program cache key in Three.js, so changing it
  // picks up new shader programs without touching the materials.
  useEffect(() => {
    gl.toneMapping = TONE_MAPPINGS[toneMapping] ?? NeutralToneMapping;
    gl.toneMappingExposure = exposure;
  }, [gl, toneMapping, exposure]);

  // Keep a record of where the camera is, for projection switches and for
  // saving viewpoints.
  useEffect(() => {
    if (!controls) return;
    const record = () => {
      pose.current = {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      };
    };
    controls.addEventListener('change', record);
    record();
    return () => controls.removeEventListener('change', record);
  }, [controls, camera]);

  // Drei's orbit controls re-aim the camera with a level horizon in a priority -1
  // frame callback; roll is turned on top of that, just before the draw.
  useFrame(() => applyCameraRoll(camera));

  // Dolly zoom: a change of field of view moves the camera so the subject keeps
  // its size on screen and only the perspective changes. `fovBasis` is the FOV
  // the present distance was matched to, which also makes undo follow along and
  // keeps a restored viewpoint (which sets position and FOV together) untouched.
  useEffect(() => {
    if (projection !== 'perspective' || !controls) return;
    if (fovBasis.value === null) {
      fovBasis.value = fov;
      return;
    }
    if (fovBasis.value === fov) return;
    const from = fovBasis.value;
    fovBasis.value = fov;
    dollyForFov(from, fov);
  }, [fov, projection, controls]);

  const previousCamera = useRef(camera);
  useEffect(() => {
    if (previousCamera.current === camera) return;
    previousCamera.current = camera;
    const { position, target } = pose.current;
    // Let R3F finish swapping the default camera and rebuilding the controls
    // before restoring the pose onto them.
    const frame = requestAnimationFrame(() => {
      camera.position.set(...position);
      if (controls) {
        controls.target.set(...target);
        controls.update();
      } else {
        camera.lookAt(target[0], target[1], target[2]);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [camera, controls]);

  return (
    <>
      {projection === 'perspective' ? (
        /* Framing the scene recomputes these from its size; the starting
           values keep the ratio sane before anything is loaded. */
        <PerspectiveCamera
          makeDefault
          fov={fov}
          near={0.05}
          far={500}
          position={start.position}
        />
      ) : (
        /* `orthoZoom` is the vertical extent in world units, which is a
           meaningful number to put in a properties panel. drei's orthographic
           camera works in pixel-sized frustum bounds, so convert. */
        <OrthographicCamera
          makeDefault
          zoom={size.height / Math.max(orthoZoom, 0.01)}
          near={-200}
          far={400}
          position={start.position}
        />
      )}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.09}
        rotateSpeed={0.85}
        panSpeed={0.9}
        zoomSpeed={0.9}
        screenSpacePanning
        /* The toolbar's view tools change only the left button; the middle button
           and the right button always zoom and pan. */
        mouseButtons={{
          LEFT: viewTool === 'pan' ? MOUSE.PAN : viewTool === 'zoom' ? MOUSE.DOLLY : MOUSE.ROTATE,
          MIDDLE: MOUSE.DOLLY,
          RIGHT: MOUSE.PAN,
        }}
        minDistance={0.05}
        maxDistance={150}
        /* The full sphere, so the camera can be taken directly underneath the
           product just as it can be taken directly overhead. The floor, its
           shadow and its reflection all face upwards and cull away when seen
           from below, so going under shows the product's underside rather
           than the back of a plane. */
        minPolarAngle={0}
        maxPolarAngle={Math.PI}
        target={start.target}
      />
    </>
  );
}
