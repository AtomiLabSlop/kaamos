import { useEffect, useState } from 'react';
import { selectRootIds, useProject, useRootIds, useSceneStats } from '../store/project';
import { useUI } from '../store/ui';
import { formatCount } from '../lib/util';
import { Icon } from './Icon';
import { Button, EmptyNote, IconButton, PanelTitle } from './controls';
import { TextField as S2TextField } from '@react-spectrum/s2';

/**
 * Scene hierarchy.
 *
 * Mirrors the structure that came in with the file. Each row subscribes to its
 * own node, so renaming or hiding one object does not re-render the tree.
 */

/** The row the last plain or Cmd/Ctrl click landed on; Shift extends from it. */
let anchorId: string | null = null;
/** Set by a click on a tree row, so the list does not slide away under the pointer. */
let lastTreeClick = 0;

/** Node ids in the order the rows are drawn (collapsed branches left out). */
function visibleIds(): string[] {
  const state = useProject.getState();
  const nodes = state.nodes;
  const rootIds = selectRootIds(state);
  const expandedMap = useUI.getState().expandedNodeIds;
  const out: string[] = [];
  const walk = (id: string, depth: number) => {
    const node = nodes[id];
    if (!node) return;
    out.push(id);
    if (expandedMap[id] ?? depth === 0) for (const child of node.childIds) walk(child, depth + 1);
  };
  for (const id of rootIds) walk(id, 0);
  return out;
}

/** Click on a row, Finder style: Cmd/Ctrl toggles one, Shift takes the range from the anchor. */
function clickRow(id: string, event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
  lastTreeClick = Date.now();
  const ui = useUI.getState();
  const current =
    ui.groupNodeIds.length > 0 ? ui.groupNodeIds : ui.selectedNodeId ? [ui.selectedNodeId] : [];
  if (event.metaKey || event.ctrlKey) {
    anchorId = id;
    ui.selectNodes(
      current.includes(id) ? current.filter((other) => other !== id) : [...current, id],
    );
    return;
  }
  if (event.shiftKey && anchorId) {
    const order = visibleIds();
    const from = order.indexOf(anchorId);
    const to = order.indexOf(id);
    if (from >= 0 && to >= 0) {
      const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
      ui.selectNodes(from <= to ? range : range.reverse());
      return;
    }
  }
  anchorId = id;
  ui.selectNode(id);
}

function Row({ id, depth }: { id: string; depth: number }) {
  const node = useProject((state) => state.nodes[id]);
  const materialName = useProject((state) =>
    node?.materialId ? (state.materials[node.materialId]?.name ?? null) : null,
  );

  const selected = useUI(
    (state) => state.selectedNodeId === id || state.groupNodeIds.includes(id),
  );
  const expanded = useUI((state) => state.expandedNodeIds[id] ?? depth === 0);
  const selectNode = useUI((state) => state.selectNode);
  const toggleExpanded = useUI((state) => state.toggleNodeExpanded);
  const dragMaterialId = useUI((state) => state.dragMaterialId);

  const setNodeVisible = useProject((state) => state.setNodeVisible);
  const renameNode = useProject((state) => state.renameNode);
  const assignMaterial = useProject((state) => state.assignMaterial);
  const assignMaterialToModel = useProject((state) => state.assignMaterialToModel);

  const [editing, setEditing] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);

  if (!node) return null;

  const hasChildren = node.childIds.length > 0;

  const applyDraggedMaterial = () => {
    if (!dragMaterialId) return;
    if (node.kind === 'mesh') assignMaterial(id, dragMaterialId);
    else assignMaterialToModel(node.modelId, dragMaterialId);
    useUI.getState().setDragMaterial(null);
    selectNode(id);
  };

  return (
    <>
      <div
        data-node-row={id}
        className={`group relative mx-1 flex h-[30px] select-none items-center gap-1.5 rounded-md pr-0.5 ${
          selected ? 'bg-amber-wash' : 'hover:bg-hover'
        } ${dropTarget && dragMaterialId ? 'ring-2 ring-amber ring-inset' : ''}`}
        style={{ paddingLeft: 4 + depth * 14 }}
        onPointerEnter={() => dragMaterialId && setDropTarget(true)}
        onPointerLeave={() => setDropTarget(false)}
        onPointerUp={() => {
          setDropTarget(false);
          applyDraggedMaterial();
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => toggleExpanded(id)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
            aria-expanded={expanded}
            className="grid size-[18px] shrink-0 place-items-center rounded-sm text-ink-faint hover:text-ink"
          >
            <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} />
          </button>
        ) : (
          <span className="size-[18px] shrink-0" />
        )}

        <span
          className={`shrink-0 ${selected ? 'text-amber' : 'text-ink-faint'}`}
          aria-hidden="true"
        >
          <Icon name={node.kind === 'group' ? 'folder' : 'cube'} size={15} />
        </span>

        {editing ? (
          <S2TextField
            aria-label="Object name"
            size="S"
            autoFocus
            defaultValue={node.name}
            onBlur={(event) => {
              renameNode(id, (event.target as HTMLInputElement).value.trim() || node.name);
              setEditing(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
              if (event.key === 'Escape') setEditing(false);
            }}
            UNSAFE_style={{ flex: 1, minWidth: 0 }}
          />
        ) : (
          <button
            type="button"
            onClick={(event) => clickRow(id, event)}
            onDoubleClick={() => setEditing(true)}
            title={materialName ? `${node.name} — ${materialName}` : node.name}
            className={`min-w-0 flex-1 truncate text-left text-ctl ${
              node.visible ? (selected ? 'text-ink' : 'text-ink') : 'text-ink-faint'
            }`}
          >
            {node.name}
          </button>
        )}

        {node.kind === 'mesh' && materialName && (
          <span className="hidden max-w-[72px] shrink-0 truncate text-label text-ink-faint group-hover:inline lg:inline">
            {materialName}
          </span>
        )}

        <span
          className={`shrink-0 ${
            node.visible ? 'opacity-0 group-hover:opacity-100 focus-within:opacity-100' : ''
          }`}
        >
          <IconButton
            icon={node.visible ? 'eye' : 'eyeOff'}
            size={22}
            tip={node.visible ? 'Hide' : 'Show'}
            label={node.visible ? `Hide ${node.name}` : `Show ${node.name}`}
            onClick={() => setNodeVisible(id, !node.visible)}
          />
        </span>

      </div>

      {expanded &&
        node.childIds.map((childId) => (
          <Row key={childId} id={childId} depth={depth + 1} />
        ))}
    </>
  );
}

export function SceneTree() {
  const rootIds = useRootIds();
  const stats = useSceneStats();

  // A part picked anywhere but in this list (the view, a material's Select parts)
  // brings its row to the middle of the list.
  const selectedId = useUI((state) => state.selectedNodeId);
  const hiddenCount = useProject(
    (state) => Object.values(state.nodes).filter((node) => !node.visible).length,
  );
  const showAllNodes = useProject((state) => state.showAllNodes);
  useEffect(() => {
    if (!selectedId) return;
    if (Date.now() - lastTreeClick < 400) return;
    // After a frame, so rows that were just expanded to reveal it exist.
    const frame = requestAnimationFrame(() =>
      document
        .querySelector(`[data-node-row="${selectedId}"]`)
        ?.scrollIntoView({ block: 'center' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PanelTitle>Scene</PanelTitle>

      <div className="scroll-y min-h-0 flex-1 py-1">
        {rootIds.length === 0 ? (
          <EmptyNote>
            No models yet. Import one from the toolbar, drop a file on the viewport,
            or load the example bottle from the empty scene.
          </EmptyNote>
        ) : (
          rootIds.map((id) => <Row key={id} id={id} depth={0} />)
        )}
      </div>

      {stats.meshes > 0 && (
        <div className="flex h-7 shrink-0 items-center gap-3 border-t border-line pl-2.5 pr-1 text-label text-ink-faint">
          <span data-num>{formatCount(stats.meshes)} objects</span>
          <span data-num className="min-w-0 flex-1 truncate">
            {formatCount(stats.triangles)} triangles
          </span>
          <Button
            icon="eye"
            disabled={hiddenCount === 0}
            onClick={showAllNodes}
            tip={
              hiddenCount === 0
                ? 'Every part is visible'
                : `Show the ${hiddenCount} hidden ${hiddenCount === 1 ? 'part' : 'parts'}`
            }
          >
            Show all
          </Button>
        </div>
      )}
    </div>
  );
}
