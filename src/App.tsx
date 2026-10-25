import { DesktopNotice } from './ui/DesktopNotice';
import { useEffect } from 'react';
import { useUI } from './store/ui';
import { Toolbar } from './ui/Toolbar';
import { LibraryWindow } from './ui/LibraryWindow';
import { ProjectWindow } from './ui/ProjectWindow';
import { RenderWindow } from './ui/RenderWindow';
import { HotkeysDialog } from './ui/HotkeysDialog';
import { AboutDialog } from './ui/AboutDialog';
import { Viewport } from './ui/Viewport';
import {
  BusyBar,
  CadDetailDialog,
  ConfirmDialog,
  RenderPreview,
  RenderProgress,
} from './ui/Overlays';
import { TooltipLayer } from './ui/controls';
import { VIEW_PRESETS } from './scene/viewportApi';
import {
  applyView,
  deleteSelectedNode,
  fitSelected,
  fitView,
  importModel,
  openProject,
  redo,
  runRender,
  saveProject,
  undo,
} from './actions';
import { disposeSwatchRenderer } from './materials/swatchRenderer';
import { disposeMaterialInstances } from './materials/materialInstances';
import { disposeFallbackMaterial } from './scene/NodeView';
import { disposeGradientTextures } from './scene/gradientTexture';
import { disposeDracoLoader } from './io/importModel';
import { registry } from './scene/registry';
import { startAutosave } from './io/autosave';

/** True when the user is typing, so shortcuts should stay out of the way. */
function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveProject();
        return;
      }
      if (mod && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void openProject();
        return;
      }
      if (mod && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        void importModel();
        return;
      }
      if (mod && event.key === 'Enter') {
        event.preventDefault();
        void runRender();
        return;
      }

      if (isTyping(event.target) || mod) return;

      switch (event.key.toLowerCase()) {
        case 'k':
          event.preventDefault();
          useUI.getState().setHotkeysOpen(true);
          break;
        case 'l':
          if (event.shiftKey) {
            event.preventDefault();
            useUI.getState().showProjectTab('lighting');
          }
          break;
        case 'a':
          event.preventDefault();
          fitView();
          break;
        case 'f':
          event.preventDefault();
          fitSelected();
          break;
        case 'g':
          event.preventDefault();
          useUI.getState().setShowGrid(!useUI.getState().showGrid);
          break;
        case 'h':
          event.preventDefault();
          useUI
            .getState()
            .setShowLightHelpers(!useUI.getState().showLightHelpers);
          break;
        case 'delete':
        case 'backspace':
          event.preventDefault();
          deleteSelectedNode();
          break;
        case 'escape':
          if (useUI.getState().paintBrush) useUI.getState().setPaintBrush(false);
          else useUI.getState().selectNode(null);
          break;
        default: {
          const preset = VIEW_PRESETS.find((entry) => entry.shortcut === event.key);
          if (preset) {
            event.preventDefault();
            applyView(preset.direction);
          }
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Release GPU resources when the tab goes away. */
function useDisposeOnUnload() {
  useEffect(() => {
    const release = () => {
      disposeMaterialInstances();
      disposeSwatchRenderer();
      disposeFallbackMaterial();
      disposeGradientTextures();
      disposeDracoLoader();
      registry.disposeAll();
    };
    window.addEventListener('pagehide', release);
    return () => window.removeEventListener('pagehide', release);
  }, []);
}

export default function App() {
  useEffect(() => startAutosave(), []);
  useShortcuts();
  useDisposeOnUnload();

  const leftOpen = useUI((state) => state.leftOpen);
  const rightOpen = useUI((state) => state.rightOpen);

  return (
    <TooltipLayer>
      <div className="flex h-full flex-col overflow-hidden bg-shell text-ink">
        <Toolbar />

        <div className="flex min-h-0 flex-1">
          {leftOpen && <LibraryWindow />}

          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Viewport />
          </main>

          {rightOpen && <ProjectWindow />}
        </div>
      </div>

      <RenderWindow />
      <BusyBar />
      <ConfirmDialog />
      <CadDetailDialog />
      <RenderPreview />
      <HotkeysDialog />
      <AboutDialog />
      <RenderProgress />
      <DesktopNotice />
    </TooltipLayer>
  );
}
