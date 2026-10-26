import { useNodePath, useProject } from '../../store/project';
import { useUI } from '../../store/ui';
import { deleteSelectedNode, dropSelectedToFloor } from '../../actions';
import {
  Button,
  EmptyNote,
  Field,
  Hint,
  Section,
  Segmented,
  TextInput,
  Vector3Field,
} from '../controls';
import { formatCount } from '../../lib/util';

const DEG = 180 / Math.PI;

export function ObjectPanel() {
  const selectedNodeId = useUI((state) => state.selectedNodeId);
  const moveTool = useUI((state) => state.moveTool);
  const moveMode = useUI((state) => state.moveMode);
  const setMoveTool = useUI((state) => state.setMoveTool);
  const setMoveMode = useUI((state) => state.setMoveMode);
  const node = useProject((state) =>
    selectedNodeId ? state.nodes[selectedNodeId] : null,
  );
  const path = useNodePath(selectedNodeId);
  const materials = useProject((state) => state.materials);
  const hasOriginal = useProject((state) =>
    selectedNodeId ? state.models[node?.modelId ?? '']?.source === 'file' : false,
  );

  const renameNode = useProject((state) => state.renameNode);
  const setNodeTransform = useProject((state) => state.setNodeTransform);
  const assignMaterial = useProject((state) => state.assignMaterial);
  const assignMaterialToModel = useProject((state) => state.assignMaterialToModel);

  if (!node || !selectedNodeId) {
    return (
      <EmptyNote>
        Nothing selected. Click an object in the viewport or the hierarchy to see its
        transform and material.
      </EmptyNote>
    );
  }

  const materialName = node.materialId ? (materials[node.materialId]?.name ?? null) : null;

  return (
    <>
      <Section title="Object">
        <Field label="Name">
          <TextInput label="Object name" value={node.name} onChange={(name) => renameNode(selectedNodeId, name)} />
        </Field>

        {path.length > 1 && (
          <Field label="In" tip="Where this object sits in the file's hierarchy">
            <span className="min-w-0 flex-1 truncate text-label text-ink-faint">
              {path
                .slice(0, -1)
                .map((ancestor) => ancestor.name)
                .join(' / ')}
            </span>
          </Field>
        )}

        <Field label="Type">
          <span className="text-label text-ink-faint">
            {node.kind === 'group'
              ? `Group · ${node.childIds.length} child${node.childIds.length === 1 ? '' : 'ren'}`
              : `Mesh · ${formatCount(node.triangles ?? 0)} triangles`}
          </span>
        </Field>

        {node.kind === 'mesh' && (
          <Field label="Material">
            <span className="min-w-0 flex-1 truncate text-label text-ink-dim">
              {materialName ?? 'From the file'}
            </span>
          </Field>
        )}
        {hasOriginal && (node.kind === 'group' || node.materialId !== null) && (
          <div className="mt-1.5">
            <Button
              icon="reset"
              onClick={() =>
                node.kind === 'mesh'
                  ? assignMaterial(selectedNodeId, null)
                  : assignMaterialToModel(node.modelId, null)
              }
              tip="Go back to the material that came with the file, including any textures"
            >
              {node.kind === 'mesh' ? "Use the file's material" : "Use the file's materials"}
            </Button>
          </div>
        )}
        <Hint>
          {node.kind === 'mesh'
            ? 'Apply a material by clicking it in the Materials window, or drag it onto the object.'
            : 'Clicking a material in the Materials window applies it to every part of this group.'}
        </Hint>
      </Section>

      <Section title="Transform">
        <div className="mb-2 flex items-center gap-1.5">
          <Button
            icon="move"
            active={moveTool}
            onClick={() => setMoveTool(!moveTool)}
            tip="Show a handle in the viewport to move or turn the selected part by dragging it"
          >
            Move tool
          </Button>
          {moveTool && (
            <Segmented
              value={moveMode}
              onChange={setMoveMode}
              options={[
                { value: 'translate', label: 'Move', tip: 'Drag an arrow or plane to slide the part' },
                { value: 'rotate', label: 'Turn', tip: 'Drag a ring to turn the part around that axis. Hold Shift to turn in 45° steps' },
              ]}
            />
          )}
        </div>
        <Field label="Position">
          <Vector3Field
            value={node.position}
            onChange={(position) => setNodeTransform(selectedNodeId, { position })}
            step={0.01}
          />
        </Field>
        <Field label="Rotation" tip="Degrees, applied in XYZ order">
          <Vector3Field
            value={[
              node.rotation[0] * DEG,
              node.rotation[1] * DEG,
              node.rotation[2] * DEG,
            ]}
            decimals={1}
            step={1}
            onChange={(next) =>
              setNodeTransform(selectedNodeId, {
                rotation: [next[0] / DEG, next[1] / DEG, next[2] / DEG],
              })
            }
          />
        </Field>
        <Field label="Scale">
          <Vector3Field
            value={node.scale}
            onChange={(scale) => setNodeTransform(selectedNodeId, { scale })}
            step={0.01}
          />
        </Field>

        <div className="mt-2.5 flex gap-1.5">
          <Button
            onClick={() =>
              setNodeTransform(selectedNodeId, {
                position: [0, 0, 0],
                rotation: [0, 0, 0],
                scale: [1, 1, 1],
              })
            }
            icon="reset"
          >
            Reset
          </Button>
          <Button
            onClick={dropSelectedToFloor}
            tip="Move the part straight down or up so its lowest point, as it is turned now, rests 0.1 mm above the floor"
          >
            Drop to floor
          </Button>
          <Button
            tone="danger"
            icon="trash"
            onClick={deleteSelectedNode}
            tip="Delete this object  ·  Delete. Undo with ⌘Z."
          >
            Delete
          </Button>
        </div>
      </Section>
    </>
  );
}
