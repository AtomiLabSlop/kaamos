import { memo, useLayoutEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { MeshStandardMaterial } from 'three';
import { useProject } from '../store/project';
import { materialFor, plainMaterialFor } from '../materials/materialInstances';
import { applyFaceSplit, applyProjection, canSplitFaces } from '../materials/projectUv';
import { registry } from './registry';
import { SUBJECT_FLAG } from './viewportApi';

/**
 * One scene node, rendered from project state.
 *
 * Each instance subscribes only to its own node,
 * so editing one object re-renders one component. The meshes carry no event
 * handlers — the viewport raycasts pointer input itself (see `pickNodeAt`).
 */

/** Used when a mesh has neither an assigned nor an original material. */
const fallbackMaterial = new MeshStandardMaterial({
  color: '#9a9ea3',
  roughness: 0.55,
  metalness: 0,
});

export const NodeView = memo(function NodeView({ id }: { id: string }) {
  const node = useProject((state) => state.nodes[id]);

  // Parts without UVs get their image projected on. Only parts whose material
  // actually carries an image are touched.
  const geometryKey = node?.geometryKey;
  const projection = useProject((state) => {
    const material = node?.materialId ? state.materials[node.materialId] : undefined;
    return material && Object.keys(material.maps ?? {}).length > 0
      ? (material.mapProjection ?? 'auto')
      : null;
  });
  const singleSided = useProject((state) => {
    const material = node?.materialId ? state.materials[node.materialId] : undefined;
    return Boolean(
      material && material.mapSingleSided && Object.keys(material.maps ?? {}).length > 0,
    );
  });
  const invalidate = useThree((state) => state.invalidate);
  useLayoutEffect(() => {
    if (!projection) {
      // No image any more: put a split part back as it was.
      const geometry = registry.getGeometry(geometryKey);
      if (geometry && applyFaceSplit(geometry, false, 'auto')) invalidate();
      return;
    }
    const geometry = registry.getGeometry(geometryKey);
    if (!geometry) return;
    const changedUv = applyProjection(geometry, projection);
    const changedSplit = applyFaceSplit(geometry, singleSided, projection);
    if (changedUv || changedSplit) invalidate();
  }, [projection, singleSided, geometryKey, invalidate]);

  // Whether this part is drawn as two material groups (image side and plain).
  const split =
    singleSided &&
    projection !== null &&
    Boolean(node?.materialId) &&
    (() => {
      const geometry = registry.getGeometry(geometryKey);
      return geometry ? canSplitFaces(geometry, projection) : false;
    })();
  const materialId = node?.materialId ?? null;
  const splitMaterial = useMemo(() => {
    if (!split || !materialId) return null;
    const main = materialFor(materialId);
    const plain = plainMaterialFor(materialId);
    return main && plain ? [main, plain] : null;
  }, [split, materialId]);

  if (!node) return null;

  const userData = { [SUBJECT_FLAG]: id };

  if (node.kind === 'group') {
    return (
      <group
        position={node.position}
        rotation={node.rotation}
        scale={node.scale}
        visible={node.visible}
        userData={userData}
      >
        {node.childIds.map((childId) => (
          <NodeView key={childId} id={childId} />
        ))}
      </group>
    );
  }

  const source = registry.getGeometry(node.geometryKey);
  if (!source) return null;
  const geometry = source;

  const material =
    splitMaterial ??
    (node.materialId ? materialFor(node.materialId) : registry.getOriginalMaterial(id)) ??
    fallbackMaterial;

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={node.position}
      rotation={node.rotation}
      scale={node.scale}
      visible={node.visible}
      castShadow
      receiveShadow
      userData={userData}
    >
      {node.childIds.map((childId) => (
        <NodeView key={childId} id={childId} />
      ))}
    </mesh>
  );
});

export function disposeFallbackMaterial() {
  fallbackMaterial.dispose();
}
