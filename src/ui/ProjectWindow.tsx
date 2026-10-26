import { useUI, type ProjectTab } from '../store/ui';
import { Icon, type IconName } from './Icon';
import { Tip } from './controls';
import { SceneTree } from './SceneTree';
import { CameraPanel } from './panels/CameraPanel';
import { EnvironmentPanel } from './panels/EnvironmentPanel';
import { LightingPanel } from './panels/LightingPanel';
import { MaterialPanel } from './panels/MaterialPanel';
import { ObjectPanel } from './panels/ObjectPanel';

/** Width of the Project window; the Render window opens beside it. */
export const PROJECT_WINDOW_WIDTH = 336;

/**
 * The Project window: everything that describes the scene, in five tabs.
 * Its content follows the selection — pick a part and Material shows that
 * part's material; pick nothing and Scene shows the whole tree.
 */

export const PROJECT_TABS: {
  id: ProjectTab;
  label: string;
  icon: IconName;
  tip: string;
}[] = [
  { id: 'scene', label: 'Scene', icon: 'cube', tip: 'Scene tree and the selected object' },
  { id: 'material', label: 'Material', icon: 'material', tip: 'Material of the selection' },
  { id: 'environment', label: 'Environment', icon: 'globe', tip: 'Studio or HDRI, background, ground, shadow' },
  { id: 'lighting', label: 'Lighting', icon: 'light', tip: 'Studio lights' },
  { id: 'camera', label: 'Camera', icon: 'camera', tip: 'Lens, exposure, depth of field, views' },
];

export function ProjectWindow() {
  const tab = useUI((state) => state.projectTab);
  const setTab = useUI((state) => state.setProjectTab);
  const current = PROJECT_TABS.find((entry) => entry.id === tab) ?? PROJECT_TABS[0];

  return (
    <aside
      aria-label="Project"
      style={{ width: PROJECT_WINDOW_WIDTH }}
      className="flex shrink-0 flex-col border-l border-line bg-panel"
    >
      <div
        role="tablist"
        aria-label="Project"
        className="flex h-8 shrink-0 items-stretch border-b border-line"
      >
        {PROJECT_TABS.map((entry) => {
          const active = tab === entry.id;
          return (
            <Tip key={entry.id} text={entry.tip}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={entry.label}
                onClick={() => setTab(entry.id)}
                className={`relative grid flex-1 place-items-center transition-colors ${
                  active ? 'text-amber' : 'text-ink-faint hover:text-ink'
                }`}
              >
                <Icon name={entry.icon} />
                {active && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-amber" />}
              </button>
            </Tip>
          );
        })}
      </div>

      <div className="flex h-6 shrink-0 items-center border-b border-line px-2.5 text-label text-ink-faint">
        Project <span className="mx-1">›</span>
        <span className="text-ink-dim">{current.label}</span>
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'scene' && (
          <div className="flex h-full flex-col">
            <div className="flex min-h-[150px] basis-[46%] flex-col border-b border-line">
              <SceneTree />
            </div>
            <div className="scroll-y min-h-0 flex-1">
              <ObjectPanel />
            </div>
          </div>
        )}
        {tab !== 'scene' && (
          <div className="scroll-y h-full">
            {tab === 'material' && <MaterialPanel />}
            {tab === 'environment' && <EnvironmentPanel />}
            {tab === 'lighting' && <LightingPanel />}
            {tab === 'camera' && <CameraPanel />}
          </div>
        )}
      </div>
    </aside>
  );
}
