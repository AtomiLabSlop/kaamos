import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMaterialUsage, useProject } from '../store/project';
import { useUI } from '../store/ui';
import { swatchFor } from '../materials/swatchRenderer';
import { MATERIAL_GROUPS, materialGroupOf } from '../materials/presets';
import type { MaterialDef } from '../store/types';
import { Section, Tip } from './controls';
import { Icon } from './Icon';

/**
 * Material library.
 *
 * Swatches are real renders of each material on a sphere under a fixed neutral
 * environment (see `swatchRenderer.ts`) — roughness, metalness and clearcoat
 * are most of what separates these materials, and a flat colour chip shows none
 * of it.
 *
 * Applying a material: click a swatch to put it on the selection, or drag one
 * onto an object in the viewport or a row in the hierarchy. The drag is handled
 * with pointer events rather than HTML drag-and-drop, because the drop target
 * may be inside the WebGL canvas, which native drag-and-drop cannot address.
 */

function Swatch({ def, size = 34 }: { def: MaterialDef; size?: number }) {
  const url = swatchFor(def);
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full"
        style={{ width: size, height: size }}
        draggable={false}
      />
    );
  }
  // No second WebGL context available — fall back to the base colour.
  return (
    <span
      className="shrink-0 rounded-full border border-line"
      style={{ width: size, height: size, background: def.color }}
    />
  );
}

function DragGhost({ def }: { def: MaterialDef }) {
  const [point, setPoint] = useState({ x: -100, y: -100 });

  useEffect(() => {
    const onMove = (event: PointerEvent) =>
      setPoint({ x: event.clientX, y: event.clientY });
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  return createPortal(
    <div
      className="pointer-events-none fixed z-100 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-lg border border-amber-dim bg-raised px-2 py-1.5 shadow-xl"
      style={{ left: point.x, top: point.y }}
    >
      <Swatch def={def} size={18} />
      <span className="text-label text-ink">{def.name}</span>
    </div>,
    document.body,
  );
}

export function MaterialLibrary() {
  const materialOrder = useProject((state) => state.materialOrder);
  const materials = useProject((state) => state.materials);
  const usage = useMaterialUsage();

  // Folders start closed. When a part starts using a material that no part used
  // a moment ago (an import's default material, or the example bottle's), the
  // folder holding it opens, so the user sees where it came from.
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const seenMaterials = useRef<Set<string> | null>(null);
  useEffect(() => {
    const used = Object.keys(usage).filter((id) => usage[id] > 0);
    const seen = seenMaterials.current;
    if (seen) {
      const fresh = used.filter((id) => !seen.has(id));
      if (fresh.length > 0) {
        setOpenFolders((previous) => {
          const next = { ...previous };
          for (const id of fresh) {
            next[materialGroupOf(materials[id]?.presetId ?? null) ?? 'other'] = true;
          }
          return next;
        });
      }
    }
    seenMaterials.current = new Set(used);
  }, [usage, materials]);

  const pickedMaterialId = useUI((state) => state.selectedMaterialId);
  const selectedNodeId = useUI((state) => state.selectedNodeId);
  // The part's own material wins, as in the Material tab; a group has none, so
  // the last swatch clicked stands in.
  const partMaterialId = useProject((state) =>
    selectedNodeId ? (state.nodes[selectedNodeId]?.materialId ?? null) : null,
  );
  const selectedMaterialId = partMaterialId ?? pickedMaterialId;
  const dragMaterialId = useUI((state) => state.dragMaterialId);
  const selectMaterial = useUI((state) => state.selectMaterial);
  const setDragMaterial = useUI((state) => state.setDragMaterial);

  const assignMaterial = useProject((state) => state.assignMaterial);
  const assignMaterialToModel = useProject((state) => state.assignMaterialToModel);

  // Picking a part shows its material: the folder holding it opens and the
  // swatch scrolls into view.
  useEffect(() => {
    if (!selectedNodeId || !partMaterialId) return;
    const group = materialGroupOf(materials[partMaterialId]?.presetId ?? null) ?? 'other';
    setOpenFolders((previous) => (previous[group] ? previous : { ...previous, [group]: true }));
    const frame = requestAnimationFrame(() =>
      document
        .querySelector(`[data-material-id="${partMaterialId}"]`)
        ?.scrollIntoView({ block: 'nearest' }),
    );
    return () => cancelAnimationFrame(frame);
    // Only a change of part (or of the material it uses) should do this, not
    // an edit to any material's values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodeId, partMaterialId]);

  // Any release of the pointer ends a drag, whether or not it hit a target.
  useEffect(() => {
    if (!dragMaterialId) return;
    const end = () => window.setTimeout(() => setDragMaterial(null), 0);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [dragMaterialId, setDragMaterial]);

  const apply = (materialId: string) => {
    const node = selectedNodeId ? useProject.getState().nodes[selectedNodeId] : null;
    // Nothing selected: the click only picks the material for editing.
    if (!node) return;
    if (node.kind === 'mesh') assignMaterial(node.id, materialId);
    else assignMaterialToModel(node.modelId, materialId);
  };

  const dragged = dragMaterialId ? materials[dragMaterialId] : null;

  // Library folders, in their fixed order; a material is filed by where it came
  // from, so a duplicate sits beside its source. One with no library origin goes
  // in a folder of its own, last.
  const folders = [
    ...MATERIAL_GROUPS.map((group) => ({ id: group.id as string, name: group.name, ids: [] as string[] })),
    { id: 'other', name: 'Other', ids: [] as string[] },
  ];
  for (const id of materialOrder) {
    const def = materials[id];
    if (!def) continue;
    const groupId = materialGroupOf(def.presetId) ?? 'other';
    folders.find((folder) => folder.id === groupId)?.ids.push(id);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="scroll-y min-h-0 flex-1"
        onClick={(event) => {
          // A click on empty ground in the library lets go of the material (and
          // of the part, whose material the Material tab would otherwise show).
          if ((event.target as HTMLElement).closest('button, [data-material-id]')) return;
          useUI.getState().deselectMaterial();
          useUI.getState().selectNode(null);
        }}
      >
        {folders
          .filter(
            (folder) =>
              folder.ids.length > 0 &&
              // The bottle's own materials only appear once a part uses one, that is
              // once the example (or a project holding it) is in the scene.
              (folder.id !== 'example-bottle' || folder.ids.some((id) => usage[id] > 0)),
          )
          .map((folder) => (
            <Section
              key={folder.id}
              title={`${folder.name} · ${folder.ids.length}`}
              open={openFolders[folder.id] ?? false}
              onOpenChange={(open) =>
                setOpenFolders((previous) => ({ ...previous, [folder.id]: open }))
              }
            >
              <ul className="-mx-1 grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-1.5">
                {folder.ids.map((id) => {
                  const def = materials[id];
                  const isSelected = selectedMaterialId === id;

                  return (
                    <li key={id} data-material-id={id}>
                      <Tip text={`${def.name}\nChange material properties, or drag the material onto an object.`}>
                        <button
                          type="button"
                          onClick={() => {
                            selectMaterial(id);
                            apply(id);
                          }}
                          onPointerDown={(event) => {
                            // Left button only; start a drag without capturing, so
                            // the release lands on whatever is underneath.
                            if (event.button !== 0) return;
                            selectMaterial(id);
                            setDragMaterial(id);
                          }}
                          className={`flex w-full flex-col items-center gap-1.5 rounded-lg px-1 pt-2 pb-1.5 transition-colors ${
                            isSelected
                              ? 'bg-amber-wash ring-2 ring-amber ring-inset'
                              : 'hover:bg-hover'
                          }`}
                        >
                          <Swatch def={def} size={40} />
                          <span
                            className={`line-clamp-2 w-full text-center text-label leading-tight hyphens-auto ${
                              isSelected ? 'text-amber' : 'text-ink-dim'
                            }`}
                          >
                            {def.name}
                          </span>
                        </button>
                      </Tip>
                    </li>
                  );
                })}
              </ul>
            </Section>
          ))}

        <p className="p-2.5 text-label leading-snug text-ink-faint">
          Click to apply to the selection, or drag onto an object. Click here to let go.
        </p>
      </div>

      {dragged && <DragGhost def={dragged} />}
    </div>
  );
}

export { Swatch as MaterialSwatch };

/** Shown in the right panel when a material is being edited. */
export function MaterialBadge({ def }: { def: MaterialDef }) {
  return (
    <span className="flex items-center gap-2">
      <Swatch def={def} size={26} />
      <span className="min-w-0 truncate text-ctl text-ink">{def.name}</span>
      {def.builtIn && (
        <Tip text="Library material. Editable, and resettable to its original values.">
          <span className="shrink-0 text-ink-faint">
            <Icon name="info" size={12} />
          </span>
        </Tip>
      )}
    </span>
  );
}
