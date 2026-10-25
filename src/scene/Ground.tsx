import { Grid } from '@react-three/drei';
import { useProject } from '../store/project';
import { useUI } from '../store/ui';
import { GroundShadow } from './GroundShadow';
import { ReflectiveGround } from './ReflectiveGround';
import { GROUND_FLAG, HELPER_FLAG } from './viewportApi';

/**
 * Ground plane and grid.
 *
 * The grid carries the helper flag so the final renderer can take it out of
 * the image — it is an aid for working, not part of the picture. The ground
 * plane is not flagged: it is part of the shot.
 */

const GROUND_Y = 0;

export function Ground() {
  const env = useProject((state) => state.environment);
  const showGrid = useUI((state) => state.showGrid);

  return (
    <>
      {env.groundEnabled && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, GROUND_Y, 0]}
          userData={{ [GROUND_FLAG]: true }}
          receiveShadow
        >
          {/* Large enough that its edge stays well outside a product framing. */}
          <planeGeometry args={[400, 400]} />
          <meshStandardMaterial
            color={env.groundColor}
            roughness={env.groundRoughness}
            metalness={env.groundMetalness}
          />
        </mesh>
      )}

      {/* Order matters: the floor is opaque and writes depth, the reflection
          adds to it, and the shadow goes over both so it darkens the
          reflection as well as the floor. */}
      <ReflectiveGround />
      <GroundShadow />

      {showGrid && (
        <Grid
          position={[0, GROUND_Y + 0.006, 0]}
          args={[20, 20]}
          userData={{ [HELPER_FLAG]: true }}
          cellSize={0.1}
          cellThickness={0.5}
          cellColor="#2f343a"
          sectionSize={1}
          sectionThickness={0.9}
          sectionColor="#3f464e"
          fadeDistance={22}
          fadeStrength={1.4}
          infiniteGrid
          followCamera={false}
        />
      )}
    </>
  );
}
