import { MaterialLibrary } from './MaterialLibrary';

/**
 * The Materials window (left): the material presets, applied by clicking with
 * an object selected or by dragging onto one.
 *
 * It used to be a three-tab Library. Environments now live on Project >
 * Environment, and the Models tab only repeated the toolbar's Import button and
 * the empty-scene box, so both tabs were removed to give each action one home.
 */
export function LibraryWindow() {
  return (
    <aside
      aria-label="Materials"
      className="flex w-[246px] shrink-0 flex-col border-r border-line bg-panel"
    >
      <div className="flex h-8 shrink-0 items-center border-b border-line px-2.5">
        <h2 className="text-ctl text-ink">Materials</h2>
      </div>
      <MaterialLibrary />
    </aside>
  );
}
