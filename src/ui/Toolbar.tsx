import { useState } from 'react';
import { useProject } from '../store/project';
import { useUI } from '../store/ui';
import {
  importModel,
  openProject,
  redo,
  resetScene,
  saveProject,
  takeScreenshot,
  undo,
} from '../actions';
import { Button, IconButton, Tip } from './controls';
import markUrl from '../assets/kaamos-mark.png';
import wordmarkUrl from '../assets/kaamos-wordmark.png';
import { APP_VERSION } from '../lib/version';

/** Hours and minutes in the viewer's own clock. */
const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });

export function Toolbar() {
  const name = useProject((state) => state.name);
  const setProjectName = useProject((state) => state.setProjectName);
  const canUndo = useProject((state) => state.canUndo);
  const canRedo = useProject((state) => state.canRedo);

  const leftOpen = useUI((state) => state.leftOpen);
  const rightOpen = useUI((state) => state.rightOpen);
  const renderWindowOpen = useUI((state) => state.renderWindowOpen);
  const toggleLeft = useUI((state) => state.toggleLeft);
  const toggleRight = useUI((state) => state.toggleRight);
  const toggleRenderWindow = useUI((state) => state.toggleRenderWindow);
  const setHotkeysOpen = useUI((state) => state.setHotkeysOpen);
  const setAboutOpen = useUI((state) => state.setAboutOpen);
  const viewTool = useUI((state) => state.viewTool);
  const setViewTool = useUI((state) => state.setViewTool);
  const rendering = useUI((state) => state.renderProgress.active);
  const lastSavedAt = useUI((state) => state.lastSavedAt);
  const autosavedAt = useUI((state) => state.autosavedAt);
  const unsaved = useUI((state) => state.unsaved);
  const hasModels = useProject((state) => state.modelOrder.length > 0);

  const [draft, setDraft] = useState<string | null>(null);

  return (
    <header className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line bg-panel pl-4 pr-3">
      <Tip text="About Kaamos — known limitations and feedback">
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          aria-label="About Kaamos"
          className="flex shrink-0 cursor-pointer items-center gap-3 rounded-sm pr-3 hover:opacity-80"
        >
          <img src={markUrl} alt="" width={28} height={28} className="h-[28px] w-[28px]" />
          <img src={wordmarkUrl} alt="Kaamos" height={17} className="relative -top-[2px] h-[17px] w-auto" />
          <span className="text-label leading-none tabular-nums text-ink-dim" data-testid="app-version">
            {APP_VERSION}
          </span>
        </button>
      </Tip>

      <span className="mx-2 h-5 w-px bg-line" />

      <input
        value={draft ?? name}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          setDraft(null);
          const next = event.target.value.trim();
          if (next && next !== name) setProjectName(next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          if (event.key === 'Escape') {
            setDraft(null);
            (event.target as HTMLInputElement).blur();
          }
        }}
        aria-label="Project name"
        className="h-[28px] w-[160px] rounded-md border border-transparent bg-transparent px-2 text-ctl text-ink hover:border-line focus:border-line focus:bg-well"
      />

      {/* When the project was last saved to a file, to the minute. A dot means
          there are changes since; the automatic backup time is in the tip. */}
      <Tip
        text={
          `${lastSavedAt ? `Saved to a file at ${clock(lastSavedAt)}.` : 'Not saved to a file yet.'}` +
          (unsaved && hasModels ? ' There are changes since.' : '') +
          (autosavedAt ? ` Automatic backup in this browser at ${clock(autosavedAt)}.` : '')
        }
      >
        <span
          className="flex shrink-0 items-center gap-1 text-label whitespace-nowrap text-ink-dim tabular-nums"
          data-testid="saved-at"
        >
          {unsaved && hasModels && <span className="size-1.5 rounded-full bg-amber" />}
          {lastSavedAt ? `Saved ${clock(lastSavedAt)}` : 'Not saved'}
        </span>
      </Tip>

      <span className="mx-0.5 h-5 w-px bg-line" />

      <IconButton
        icon="plus"
        onClick={resetScene}
        tip="New scene — remove everything and start over"
        label="New scene"
      />
      <IconButton icon="open" onClick={() => void openProject()} tip="Open project  ·  ⌘O" />
      <IconButton icon="save" onClick={saveProject} tip="Save project  ·  ⌘S" />

      <span className="mx-0.5 h-5 w-px bg-line" />

      <IconButton icon="undo" onClick={undo} disabled={!canUndo} tip="Undo  ·  ⌘Z" />
      <IconButton
        icon="redo"
        onClick={redo}
        disabled={!canRedo}
        tip="Redo  ·  ⇧⌘Z"
      />

      <span className="mx-0.5 h-5 w-px bg-line" />

      {/* What the left mouse button does in the viewport. Each tip also says how
          to get the same movement while Select is active. */}
      <IconButton
        icon="select"
        active={viewTool === 'select'}
        onClick={() => setViewTool('select')}
        label="Select tool"
        tip="Select — click a part to select it. Drag to orbit the view, Shift + drag or right mouse button to pan, scroll to zoom"
      />
      <IconButton
        icon="pan"
        active={viewTool === 'pan'}
        onClick={() => setViewTool(viewTool === 'pan' ? 'select' : 'pan')}
        label="Pan tool"
        tip="Pan — drag to slide the view. With Select: Shift + left mouse button, or right mouse button"
      />
      <IconButton
        icon="orbit"
        active={viewTool === 'orbit'}
        onClick={() => setViewTool(viewTool === 'orbit' ? 'select' : 'orbit')}
        label="Orbit tool"
        tip="Orbit — drag to turn the view around the model. With Select: left mouse button drag"
      />
      <IconButton
        icon="zoom"
        active={viewTool === 'zoom'}
        onClick={() => setViewTool(viewTool === 'zoom' ? 'select' : 'zoom')}
        label="Zoom tool"
        tip="Zoom — drag up or down to move closer or further. With Select: scroll wheel, two-finger scroll, or middle mouse button drag"
      />

      <div className="flex-1" />

      {/* The working order: bring something in, choose resources, set up the
          scene, render, capture. */}
      <Button icon="import" onClick={() => void importModel()} tip="Import a model  ·  ⌘I">
        Import
      </Button>
      <Button
        icon="material"
        active={leftOpen}
        onClick={toggleLeft}
        label="Materials"
        tip="Materials — click to apply to the selection, or drag onto an object"
      >
        Materials
      </Button>
      <Button
        icon="project"
        active={rightOpen}
        onClick={toggleRight}
        label="Project"
        tip="Project — scene, material, environment, lighting, camera"
      >
        Project
      </Button>
      <Button
        tone={rendering ? 'default' : 'primary'}
        icon="render"
        active={renderWindowOpen}
        onClick={toggleRenderWindow}
        label="Render window"
        tip="Open the Render window: output, quality and history"
      >
        Render
      </Button>
      <IconButton
        icon="screenshot"
        onClick={() => void takeScreenshot()}
        disabled={rendering}
        tip="Screenshot — save the real-time preview as a PNG (not a final render)"
        label="Screenshot"
      />

      <span className="mx-0.5 h-5 w-px bg-line" />

      <IconButton
        icon="keyboard"
        onClick={() => setHotkeysOpen(true)}
        tip="Hotkeys overview  ·  K"
        label="Hotkeys overview"
      />
      <IconButton
        icon="help"
        onClick={() => setAboutOpen(true)}
        tip="About Kaamos — known limitations and feedback"
        label="About Kaamos"
      />
    </header>
  );
}
