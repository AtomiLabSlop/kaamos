import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import { Group, Matrix4, Object3D, Quaternion, Scene, Vector3 } from 'three';
import { useProject } from '../store/project';
import { useUI } from '../store/ui';
import { HELPER_FLAG, nodeIdOf } from './viewportApi';
import { volumeCentroidLocal } from './volumeCentroid';

/**
 * The Move tool: a handle on the selected part for moving or turning it.
 *
 * The handle sits at the part's volume centroid, not at its origin (a bottle's
 * origin is the middle of its base). It drives a proxy object standing at the
 * centroid, and the part follows: moving shifts it by the same world offset,
 * turning rotates it about the centroid. Every change is written straight back
 * to the project as an ordinary transform, so the Transform fields, undo and
 * saved projects all see it. Orbit controls pause while a handle is held (drei
 * does that).
 *
 * In the raster view the handle is a flagged helper in the scene. The path
 * traced preview would trace it, so there it lives in a scene of its own that
 * is drawn over the tracer's picture (the selection outline does the same).
 */
export function MoveTool() {
  const active = useUI((state) => state.moveTool);
  const mode = useUI((state) => state.moveMode);
  const pathPreview = useUI((state) => state.pathPreview);
  const selectedNodeId = useUI((state) => state.selectedNodeId);
  const shown = useProject((state) =>
    selectedNodeId ? (state.nodes[selectedNodeId]?.visible ?? false) : false,
  );
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const [target, setTarget] = useState<Object3D | null>(null);

  // Holding Shift while turning snaps the angle to 45 degree steps.
  const [shiftHeld, setShiftHeld] = useState(false);
  useEffect(() => {
    const update = (event: KeyboardEvent) => setShiftHeld(event.shiftKey);
    const clear = () => setShiftHeld(false);
    window.addEventListener('keydown', update);
    window.addEventListener('keyup', update);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', update);
      window.removeEventListener('keyup', update);
      window.removeEventListener('blur', clear);
    };
  }, []);

  const proxy = useMemo(() => new Group(), []);
  const overlay = useMemo(() => new Scene(), []);
  // The centroid in the part's own frame; it follows the part wherever it goes.
  const centroid = useRef(new Vector3());
  const hasCentroid = useRef(false);
  const dragging = useRef(false);
  const start = useRef({
    centre: new Vector3(),
    world: new Matrix4(),
    parentInverse: new Matrix4(),
  });

  // The part's Three.js object is found by the id its element carries. It is
  // looked up again a frame later because a part that was only just imported
  // may not have been drawn yet.
  useEffect(() => {
    if (!active || !selectedNodeId || !shown) {
      setTarget(null);
      return;
    }
    const find = () => {
      let found: Object3D | null = null;
      scene.traverse((object) => {
        if (!found && nodeIdOf(object) === selectedNodeId) found = object;
      });
      return found;
    };
    setTarget(find());
    const frame = requestAnimationFrame(() => setTarget(find()));
    return () => cancelAnimationFrame(frame);
  }, [active, selectedNodeId, shown, scene]);

  // The centroid is measured when a part is picked, not while it is dragged.
  useEffect(() => {
    hasCentroid.current = false;
    if (!target) return;
    centroid.current.copy(volumeCentroidLocal(target));
    hasCentroid.current = true;
    invalidate();
  }, [target, invalidate]);

  // Keeps the handle on the part when it is moved by anything else (the
  // Transform fields, undo, a loaded project). Not while the handle is held.
  const world = useMemo(() => new Vector3(), []);
  useFrame(() => {
    if (!target || !hasCentroid.current || dragging.current) return;
    target.updateWorldMatrix(true, false);
    world.copy(centroid.current).applyMatrix4(target.matrixWorld);
    if (world.distanceToSquared(proxy.position) > 1e-18 || proxy.quaternion.w !== 1) {
      proxy.position.copy(world);
      proxy.quaternion.identity();
      invalidate();
    }
  });

  // Path traced preview: draw the handle over the tracer's picture, after the
  // preview's own draw (priority 1). The handle ignores depth.
  useFrame(
    () => {
      if (!pathPreview || !target) return;
      const previousAutoClear = gl.autoClear;
      const previousTarget = gl.getRenderTarget();
      gl.autoClear = false;
      gl.setRenderTarget(null);
      gl.render(overlay, camera);
      gl.autoClear = previousAutoClear;
      gl.setRenderTarget(previousTarget);
    },
    pathPreview ? 2 : 0,
  );

  const quaternion = useMemo(() => new Quaternion(), []);
  const scratch = useMemo(
    () => ({
      next: new Matrix4(),
      turn: new Matrix4(),
      shift: new Matrix4(),
      back: new Matrix4(),
      position: new Vector3(),
      scale: new Vector3(),
      offset: new Vector3(),
    }),
    [],
  );

  if (!target || !selectedNodeId) return null;

  const begin = () => {
    dragging.current = true;
    target.updateWorldMatrix(true, false);
    start.current.centre.copy(proxy.position);
    start.current.world.copy(target.matrixWorld);
    if (target.parent) {
      target.parent.updateWorldMatrix(true, false);
      start.current.parentInverse.copy(target.parent.matrixWorld).invert();
    } else {
      start.current.parentInverse.identity();
    }
  };

  const commit = () => {
    const { centre, world: startWorld, parentInverse } = start.current;
    const { next, turn, shift, back, position, scale, offset } = scratch;

    if (mode === 'translate') {
      offset.copy(proxy.position).sub(centre);
      next.makeTranslation(offset.x, offset.y, offset.z).multiply(startWorld);
    } else {
      // Turn about the centroid, as the world-space turn the handle reports.
      turn.makeRotationFromQuaternion(proxy.quaternion);
      shift.makeTranslation(centre.x, centre.y, centre.z);
      back.makeTranslation(-centre.x, -centre.y, -centre.z);
      next.copy(shift).multiply(turn).multiply(back).multiply(startWorld);
    }
    next.premultiply(parentInverse).decompose(position, quaternion, scale);
    target.position.copy(position);
    target.quaternion.copy(quaternion);

    const patch =
      mode === 'translate'
        ? { position: [position.x, position.y, position.z] as [number, number, number] }
        : {
            position: [position.x, position.y, position.z] as [number, number, number],
            rotation: [target.rotation.x, target.rotation.y, target.rotation.z] as [
              number,
              number,
              number,
            ],
          };
    useProject.getState().setNodeTransform(selectedNodeId, patch);
  };

  const finish = () => {
    dragging.current = false;
    // The handle always stands upright in world space; the next frame puts it
    // back on the part's centroid.
    proxy.quaternion.identity();
    invalidate();
  };

  const handle = (
    <>
      <primitive object={proxy} />
      <TransformControls
        object={proxy}
        mode={mode}
        size={0.8}
        rotationSnap={mode === 'rotate' && shiftHeld ? Math.PI / 4 : null}
        onMouseDown={begin}
        onObjectChange={commit}
        onMouseUp={finish}
      />
    </>
  );

  if (pathPreview) return createPortal(handle, overlay);
  return <group userData={{ [HELPER_FLAG]: true }}>{handle}</group>;
}
