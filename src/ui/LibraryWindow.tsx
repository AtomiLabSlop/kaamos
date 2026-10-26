import { MaterialLibrary } from './MaterialLibrary';
import { PanelTitle } from './controls';

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
      className="flex w-[272px] shrink-0 flex-col border-r border-line bg-panel"
    >
      <PanelTitle>Materials</PanelTitle>
      <MaterialLibrary />
    </aside>
  );
}
