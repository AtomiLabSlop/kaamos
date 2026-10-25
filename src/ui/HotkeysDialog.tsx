import { useUI } from '../store/ui';
import { VIEW_PRESETS } from '../scene/viewportApi';
import { Button, Modal } from './controls';

/**
 * Every shortcut the application binds, in one place. The list is written out
 * beside the bindings in App.tsx; the view shortcuts come from VIEW_PRESETS so
 * they cannot drift from what the keys actually do.
 */

const GENERAL: [string, string][] = [
  ['⌘ I', 'Import a model'],
  ['⌘ O', 'Open a project'],
  ['⌘ S', 'Save the project'],
  ['⌘ Z  /  ⇧ ⌘ Z', 'Undo  /  redo'],
  ['⌘ ↵', 'Render the image'],
  ['⇧ L', 'Lighting tab'],
  ['Delete', 'Delete the selection'],
  ['Esc', 'Deselect, or close the render view'],
  ['K', 'This list'],
];

const VIEW: [string, string][] = [
  ['A', 'Fit everything in view'],
  ['F', 'Frame the selection'],
  ['G', 'Toggle the grid'],
  ['H', 'Toggle light positions'],
  ...VIEW_PRESETS.map<[string, string]>((preset) => [
    preset.shortcut,
    `${preset.label} view`,
  ]),
];

function Table({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <section>
      <h3 className="mb-1 text-label text-ink-faint">{title}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map(([keys, action]) => (
          <div key={keys + action} className="contents">
            <dt className="font-mono text-label whitespace-nowrap text-ink">{keys}</dt>
            <dd className="text-ctl text-ink-dim">{action}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function HotkeysDialog() {
  const open = useUI((state) => state.hotkeysOpen);
  const setOpen = useUI((state) => state.setHotkeysOpen);
  if (!open) return null;

  return (
    <Modal
      title="Hotkeys overview"
      onClose={() => setOpen(false)}
      footer={<Button onClick={() => setOpen(false)}>Close</Button>}
    >
      <div className="flex flex-col gap-3">
        <Table title="General" rows={GENERAL} />
        <Table title="Viewport" rows={VIEW} />
        <p className="text-label text-ink-faint">
          Ctrl replaces ⌘ on Windows and Linux. Orbit with the left mouse button, pan
          with the right, zoom with the wheel.
        </p>
      </div>
    </Modal>
  );
}
