import { BufferAttribute, BufferGeometry, Mesh, type Material, type Scene } from 'three';

/**
 * The tracer gives every mesh exactly one material: it numbers a mesh's
 * triangles by the mesh's position in its (randomly ordered) list, while its
 * list of materials has one entry per array slot. A mesh with a material array,
 * such as a label whose back carries no print, therefore shifts every mesh
 * sorted after it onto the wrong material, and which meshes those are changes
 * with each page load (glass black, liquid white, a cap turned to glass).
 *
 * So for the duration of the render each such mesh is replaced by one mesh per
 * material group, sharing its vertices, and the original is hidden.
 */
export function splitMultiMaterialMeshes(scene: Scene): () => void {
  const added: Mesh[] = [];
  const hidden: Mesh[] = [];

  const targets: Mesh[] = [];
  scene.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh && mesh.visible && Array.isArray(mesh.material) && mesh.parent) {
      targets.push(mesh);
    }
  });

  for (const mesh of targets) {
    const materials = mesh.material as Material[];
    const geometry = mesh.geometry as BufferGeometry;
    if (geometry.groups.length === 0) continue;
    const source = geometry.index;

    for (const group of geometry.groups) {
      const material = materials[group.materialIndex ?? 0];
      if (!material || group.count <= 0) continue;

      const part = new BufferGeometry();
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        part.setAttribute(name, attribute);
      }
      const indices = new Uint32Array(group.count);
      for (let i = 0; i < group.count; i++) {
        indices[i] = source ? source.getX(group.start + i) : group.start + i;
      }
      part.setIndex(new BufferAttribute(indices, 1));

      const piece = new Mesh(part, material);
      piece.name = `${mesh.name} (material ${group.materialIndex})`;
      mesh.matrix.decompose(piece.position, piece.quaternion, piece.scale);
      mesh.parent!.add(piece);
      added.push(piece);
    }

    mesh.visible = false;
    hidden.push(mesh);
  }

  scene.updateMatrixWorld(true);

  return () => {
    for (const piece of added) {
      piece.parent?.remove(piece);
      piece.geometry.dispose();
    }
    for (const mesh of hidden) mesh.visible = true;
  };
}
