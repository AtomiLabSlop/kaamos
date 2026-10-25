import { useEffect, useReducer, useRef } from 'react';
import { useProject } from '../store/project';
import { useUI } from '../store/ui';
import { MAX_PIXELS, SAMPLE_PRESETS } from '../render/finalRender';
import { MAX_BOUNCES, PATH_SAMPLE_PRESETS } from '../render/pathTracedRender';
import { cancelRender, exportRender, runRender } from '../actions';
import { loadRenderDefaults, saveRenderDefaults } from '../store/renderDefaults';
import { DEFAULT_RENDER } from '../store/project';
import { describeRender, formatDuration, timeAgo } from '../lib/util';
import type { RenderEngine, RenderSettings } from '../store/types';
import {
  Button,
  Field,
  Hint,
  IconButton,
  Segmented,
  Select,
  Slider,
  Toggle,
  Tip,
} from './controls';
import { OutputSizeFields } from './panels/OutputSize';

/**
 * The Render window: output, quality and history for the final image.
 *
 * It floats over the viewport and can be dragged by its title bar. The wording
 * is deliberate. The viewport is always a real-time preview; the final image
 * comes from one of two engines, and the window names which, what each one
 * actually simulates and what it costs, rather than leaving the user to guess
 * why one takes a second and the other a minute.
 */

const WIDTH = 520;
const MARGIN = 8;

function defaultPosition() {
  // Beside the Project window, below the toolbar.
  return {
    x: Math.max(MARGIN, window.innerWidth - 304 - WIDTH - 16),
    y: 84,
  };
}

/** Keep at least the title bar on screen, whatever the window size. */
function clamp(point: { x: number; y: number }) {
  return {
    x: Math.min(Math.max(MARGIN - WIDTH + 120, point.x), window.innerWidth - 120),
    y: Math.min(Math.max(0, point.y), Math.max(0, window.innerHeight - 40)),
  };
}

export function RenderWindow() {
  const open = useUI((state) => state.renderWindowOpen);
  const pos = useUI((state) => state.renderWindowPos);
  const setPos = useUI((state) => state.setRenderWindowPos);
  const setOpen = useUI((state) => state.setRenderWindowOpen);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const showFrame = useUI((state) => state.showFrame);
  const setShowFrame = useUI((state) => state.setShowFrame);
  // Re-render on window resize so the position below is clamped to the new
  // size; the window can then never be lost off-screen.
  const [, onResize] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const settings = useProject((state) => state.render);
  const perspective = useProject((state) => state.camera.projection === 'perspective');
  const dofOn = useProject((state) => state.render.depthOfField) && perspective;
  const fStop = useProject((state) => state.render.fStop);
  const updateRender = useProject((state) => state.updateRender);

  const progress = useUI((state) => state.renderProgress);
  const renders = useUI((state) => state.renders);
  const previewId = useUI((state) => state.previewRenderId);
  const setPreview = useUI((state) => state.setPreviewRender);
  const removeRender = useUI((state) => state.removeRender);
  const clearRenders = useUI((state) => state.clearRenders);

  // Esc closes the window, unless a full-size preview or a render is on top.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const state = useUI.getState();
      if (event.key === 'Escape' && !state.previewRenderId && !state.renderProgress.active) {
        const target = event.target;
        if (target instanceof HTMLElement && target.closest('[aria-label="Render window"]')) {
          state.setRenderWindowOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const tracing = settings.engine === 'pathtrace';

  const saveDefaults = () => {
    const { showFrame: frame, lockAspect } = useUI.getState();
    const ok = saveRenderDefaults(settings, { showFrame: frame, lockAspect });
    useUI.getState().toast(
      ok ? 'info' : 'error',
      ok ? 'Saved as default' : 'Could not save',
      ok
        ? 'New scenes and the next visit start from these render settings.'
        : 'This browser would not store it (a private window, or storage blocked).',
    );
  };

  const restoreDefaults = () => {
    const saved = loadRenderDefaults();
    const builtIn = {
      engine: DEFAULT_RENDER.engine,
      width: DEFAULT_RENDER.width,
      height: DEFAULT_RENDER.height,
      samples: DEFAULT_RENDER.samples,
      pathSamples: DEFAULT_RENDER.pathSamples,
      bounces: DEFAULT_RENDER.bounces,
      denoise: DEFAULT_RENDER.denoise,
      denoiseStrength: DEFAULT_RENDER.denoiseStrength,
      transparentBackground: DEFAULT_RENDER.transparentBackground,
    };
    updateRender({ ...builtIn, ...saved.render }, 'render-defaults');
    setShowFrame(saved.showFrame ?? true);
    useUI.getState().setLockAspect(saved.lockAspect ?? true);
    useUI.getState().toast('info', 'Default render settings restored');
  };
  const megapixels = (settings.width * settings.height) / 1_000_000;
  const tooBig = settings.width * settings.height > MAX_PIXELS;
  const at = clamp(pos ?? defaultPosition());

  const onTitlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    drag.current = { dx: event.clientX - at.x, dy: event.clientY - at.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onTitlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setPos(clamp({ x: event.clientX - drag.current.dx, y: event.clientY - drag.current.dy }));
  };
  const onTitlePointerUp = () => {
    drag.current = null;
  };

  return (
    <section
      role="dialog"
      aria-label="Render window"
      className="fixed z-60 flex flex-col rounded-md border border-line-strong bg-panel shadow-2xl"
      style={{ left: at.x, top: at.y, width: WIDTH, maxHeight: 'calc(100vh - 104px)' }}
    >
      <div
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={onTitlePointerUp}
        onPointerCancel={onTitlePointerUp}
        className="flex h-9 shrink-0 cursor-grab touch-none items-center gap-2 border-b border-line px-2.5 active:cursor-grabbing"
      >
        <h2 className="text-title font-medium text-ink">Render</h2>
        <span className="text-label text-ink-faint tabular-nums">
          {settings.width} × {settings.height} ·{' '}
          {tracing
            ? `${settings.pathSamples} sample${settings.pathSamples === 1 ? '' : 's'}`
            : `${settings.samples} pass${settings.samples === 1 ? '' : 'es'}`}{' '}
          · {megapixels.toFixed(1)} MP
        </span>
        <div className="flex-1" />

        {progress.active ? (
          <>
            <span className="text-label text-ink-dim tabular-nums">{progress.stage}</span>
            <div className="h-[3px] w-20 overflow-hidden rounded-full bg-well">
              <div
                className="h-full bg-amber"
                style={{
                  width: `${progress.total > 0 ? (progress.sample / progress.total) * 100 : 0}%`,
                }}
              />
            </div>
            <Button icon="stop" onClick={cancelRender}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            tone="primary"
            icon="render"
            onClick={() => void runRender()}
            disabled={tooBig}
            label="Render image"
            tip="Render at full resolution  ·  ⌘↵"
          >
            Render
          </Button>
        )}
        <IconButton
          icon="close"
          tip="Close  ·  Esc"
          label="Close render window"
          size={22}
          onClick={() => setOpen(false)}
        />
      </div>

      <div className="scroll-y min-h-0 flex-1">
        <div className="border-b border-line px-3 py-2.5">
          <p className="mb-2 text-label text-ink-dim">Output</p>

          <OutputSizeFields />

          <Field
            label="Show frame"
            tip="Outline in the viewport what the final image will contain. Both engines keep the camera's vertical view and let the width follow the aspect ratio."
          >
            <Toggle checked={showFrame} onChange={setShowFrame} label="Show frame" />
          </Field>
          <div className="mb-3.5">
            <Hint>Draws an outline in the viewport showing what the final image will contain.</Hint>
          </div>

          <Field
            label="Transparent"
            tip="Render the background as alpha, for placing the product on another backdrop. Renders are saved as PNG."
          >
            <Toggle
              checked={settings.transparentBackground}
              onChange={(transparentBackground) => updateRender({ transparentBackground })}
              label="Transparent background"
            />
          </Field>
        </div>

        <div className="border-b border-line px-3 py-2.5">
            <p className="mb-2 text-label text-ink-dim">Quality</p>

            {/* Full width rather than in a Field: this column is narrow, and
                "Path traced" does not fit beside an 86px label. */}
            <div className="mb-2.5 flex items-center gap-1.5">
              <Segmented<RenderEngine>
                value={settings.engine}
                onChange={(engine) => updateRender({ engine })}
                options={[
                  {
                    value: 'raster',
                    label: 'Raster',
                    tip: 'Fast. Shades each surface once from the environment — the same as the viewport.',
                  },
                  {
                    value: 'pathtrace',
                    label: 'Path traced',
                    tip: 'Slow. Follows light as it bounces, which gives colour bleed, real soft shadows and true refraction.',
                  },
                ]}
              />
            </div>

            {tracing ? (
              <>
                <Slider
                  label="Samples"
                  tip="Rays traced per pixel. Noise falls as the square root of this, so halving the grain takes four times as many."
                  value={settings.pathSamples}
                  onChange={(pathSamples) =>
                    updateRender(
                      { pathSamples: Math.round(pathSamples) },
                      'render-path-samples',
                    )
                  }
                  min={8}
                  max={2048}
                  step={8}
                  decimals={0}
                  defaultValue={128}
                />

                <div className="mb-2.5 flex gap-1">
                  {PATH_SAMPLE_PRESETS.map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => updateRender({ pathSamples: count })}
                      className={`h-[18px] flex-1 rounded-sm border text-micro tabular-nums transition-colors ${
                        settings.pathSamples === count
                          ? 'border-amber-dim bg-amber-wash text-amber'
                          : 'border-line text-ink-faint hover:text-ink'
                      }`}
                    >
                      {count}
                    </button>
                  ))}
                </div>

                <Slider
                  label="Bounces"
                  tip="How many surfaces a ray may strike before it is given up on. Two is enough for a matte product; glass and polished metal need more."
                  value={settings.bounces}
                  onChange={(bounces) =>
                    updateRender({ bounces: Math.round(bounces) }, 'render-bounces')
                  }
                  min={1}
                  max={MAX_BOUNCES}
                  step={1}
                  decimals={0}
                  defaultValue={5}
                />

                <Field
                  label="Denoise"
                  tip="Smooths what grain is left. Fast, and it costs a little of the finest detail — turn it off for a very high sample count."
                >
                  <Toggle
                    checked={settings.denoise}
                    onChange={(denoise) => updateRender({ denoise })}
                    label="Denoise"
                  />
                </Field>

                {settings.denoise && (
                  <div className="mb-2.5 flex items-center gap-1.5">
                    <Segmented<RenderSettings['denoiseStrength']>
                      value={settings.denoiseStrength}
                      onChange={(denoiseStrength) => updateRender({ denoiseStrength })}
                      options={[
                        { value: 'light', label: 'Light', tip: 'Keeps the most fine detail; leaves some grain in glass.' },
                        { value: 'medium', label: 'Medium', tip: 'Removes most grain from glass and keeps edges sharp.' },
                        { value: 'strong', label: 'Strong', tip: 'Smoothest result; softens fine edges a little. More samples is the real cure for glass.' },
                      ]}
                    />
                  </div>
                )}

                <div className="mt-2 border-t border-line pt-2">
                  <Hint>
                    Light bounces between surfaces, so colour carries from one part
                    to the next, corners darken on their own and glass refracts what
                    is really behind it. Expect tens of seconds to minutes.
                  </Hint>
                  <Hint>
                    {dofOn
                      ? `Depth of field is on (f/${fStop.toFixed(1)}). Change it on the Camera tab.`
                      : 'Depth of field is off. Turn it on in the Camera tab.'}
                  </Hint>
                </div>
              </>
            ) : (
              <>
                <Slider
                  label="Passes"
                  tip="Each pass re-renders the frame with a sub-pixel offset and averages the result. More passes mean cleaner edges and smoother depth of field."
                  value={settings.samples}
                  onChange={(samples) =>
                    updateRender({ samples: Math.round(samples) }, 'render-samples')
                  }
                  min={1}
                  max={256}
                  step={1}
                  decimals={0}
                  defaultValue={24}
                />

                <div className="mb-2.5 flex gap-1">
                  {SAMPLE_PRESETS.map((count) => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => updateRender({ samples: count })}
                      className={`h-[18px] flex-1 rounded-sm border text-micro tabular-nums transition-colors ${
                        settings.samples === count
                          ? 'border-amber-dim bg-amber-wash text-amber'
                          : 'border-line text-ink-faint hover:text-ink'
                      }`}
                    >
                      {count}
                    </button>
                  ))}
                </div>

                <Hint>
                  {dofOn
                    ? `Depth of field is on (f/${fStop.toFixed(1)}). Change it on the Camera tab.`
                    : 'Depth of field is off. Turn it on in the Camera tab.'}
                </Hint>

                <div className="mt-2 border-t border-line pt-2">
                  <Hint>
                    The same renderer as the viewport, at output resolution and
                    averaged over the passes above. Light does not bounce between
                    surfaces — switch the engine for that.
                  </Hint>
                </div>
              </>
            )}
        </div>

        <div className="border-b border-line px-3 py-2.5">
          <p className="mb-2 text-label text-ink-dim">Defaults</p>
          <div className="flex gap-1.5">
            <Button
              onClick={saveDefaults}
              tip="Keep the output and quality settings above (size, frame, transparency, engine, samples, bounces, denoise) in this browser, for new scenes and the next visit."
            >
              Save as default
            </Button>
            <Button
              onClick={restoreDefaults}
              tip="Set the output and quality settings back to the saved defaults, or to the built-in ones if none are saved."
            >
              Restore default
            </Button>
          </div>
        </div>

        <div className="border-b border-line px-3 py-2.5">
          <p className="mb-2 text-label text-ink-dim">Viewport preview</p>
          <Field
            label="Stop at"
            tip="The path traced preview in the viewport adds samples until it reaches this count, then stops so the GPU can rest. Moving the camera or editing the scene starts it again."
          >
            <Select
              value={String(settings.previewSamples)}
              onChange={(value) => updateRender({ previewSamples: Number(value) })}
              options={[64, 128, 256, 512, 1024, 2048].map((n) => ({ value: String(n), label: `${n} samples` }))}
            />
          </Field>
        </div>

        <div className="px-3 py-2.5">
<div className="mb-2 flex items-center gap-2">
              <p className="text-label text-ink-dim">History</p>
              <div className="flex-1" />
              {renders.length > 0 && (
                <IconButton
                  icon="trash"
                  tip="Clear render history"
                  size={20}
                  onClick={clearRenders}
                />
              )}
            </div>

            {renders.length === 0 ? (
              <Hint>
                Renders appear here. They are kept in this tab only — export the ones
                you want to keep.
              </Hint>
            ) : (
              <div className="scroll-y min-h-0 flex-1">
                <ul className="flex flex-wrap gap-1.5">
                  {renders.map((render) => {
                    const active = previewId === render.id;
                    return (
                      <li key={render.id}>
                        <div
                          className={`group relative overflow-hidden rounded-sm border ${
                            active ? 'border-amber-dim' : 'border-line'
                          }`}
                        >
                          <Tip
                            text={`${render.width}×${render.height} · ${describeRender(render.engine, render.samples)} · ${formatDuration(render.durationMs)}${render.engine === 'pathtrace' ? ' · path traced' : ''}`}
                          >
                            <button
                              type="button"
                              onClick={() => setPreview(render.id)}
                              className="block"
                            >
                              <img
                                src={render.url}
                                alt={`Render at ${render.width} by ${render.height}`}
                                className="block h-[70px] w-auto max-w-[130px] object-contain"
                                style={{
                                  background:
                                    'repeating-conic-gradient(#1c1f23 0% 25%, #15171a 0% 50%) 50%/10px 10px',
                                }}
                              />
                            </button>
                          </Tip>

                          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-shell/85 px-1 py-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            <span className="text-micro text-ink-faint tabular-nums">
                              {timeAgo(render.createdAt)}
                            </span>
                            <span className="flex">
                              <IconButton
                                icon="export"
                                tip="Export PNG"
                                size={16}
                                onClick={() => void exportRender(render.id)}
                              />
                              <IconButton
                                icon="close"
                                tip="Discard"
                                size={16}
                                onClick={() => removeRender(render.id)}
                              />
                            </span>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
        </div>
      </div>
    </section>
  );
}
