import { useEffect } from 'react';
import { useUI, type Toast } from '../store/ui';
import { selectIsEmpty, useProject } from '../store/project';
import { cancelCadImport, cancelRender, confirmCadImport, exportRender } from '../actions';
import { Button, IconButton, Modal, Segmented } from './controls';
import type { CadDetail } from '../io/importCad';
import { Icon, type IconName } from './Icon';
import { describeRender, formatDuration } from '../lib/util';

const TOAST_STYLE: Record<string, { icon: IconName; ring: string; tint: string }> = {
  info: { icon: 'info', ring: 'border-line', tint: 'text-ink-dim' },
  success: { icon: 'check', ring: 'border-ok/40', tint: 'text-ok' },
  warn: { icon: 'alert', ring: 'border-amber-dim', tint: 'text-amber' },
  error: { icon: 'alert', ring: 'border-danger/50', tint: 'text-danger' },
};

export function Toasts() {
  const toasts = useUI((state) => state.toasts);
  const dismiss = useUI((state) => state.dismissToast);
  const history = useUI((state) => state.toastHistory);
  const open = useUI((state) => state.toastHistoryOpen);
  const setOpen = useUI((state) => state.setToastHistoryOpen);

  const renderToast = (toast: Toast, key: string, onClose?: () => void, at?: number) => {
    const style = TOAST_STYLE[toast.kind] ?? TOAST_STYLE.info;
    return (
      <div
        key={key}
        className={`pointer-events-auto flex gap-2 rounded-sm border bg-raised px-2.5 py-2 shadow-xl ${style.ring}`}
      >
        <span className={`mt-px shrink-0 ${style.tint}`}>
          <Icon name={style.icon} size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-ctl text-ink">{toast.message}</p>
          {toast.detail && (
            <p className="mt-0.5 text-label leading-snug text-ink-dim">{toast.detail}</p>
          )}
          {at !== undefined && (
            <p className="mt-0.5 text-label text-ink-faint tabular-nums">
              {new Date(at).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
        </div>
        {onClose && <IconButton icon="close" size={18} tip="Dismiss" onClick={onClose} />}
      </div>
    );
  };

  return (
    // Drawn inside the viewport, in its upper right corner. Pointer events stop
    // here so that dismissing a toast is not also a click on the scene behind.
    <div
      aria-live="polite"
      className="pointer-events-none absolute top-2.5 right-2.5 z-40 flex w-[300px] max-w-[calc(100%-20px)] flex-col items-end gap-1.5"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
    >
      <div className="pointer-events-auto rounded-sm border border-line bg-panel/85 p-0.5 backdrop-blur-sm">
        <IconButton
          icon="bell"
          size={24}
          active={open}
          tip="Notification history — the last ten messages"
          onClick={() => setOpen(!open)}
        />
      </div>
      {open && (
        <div
          className="pointer-events-auto flex max-h-[60vh] w-full flex-col gap-1.5 overflow-y-auto rounded-sm border border-line bg-panel/95 p-1.5 shadow-xl"
          data-testid="toast-history"
        >
          {history.length === 0 ? (
            <p className="px-1 py-1 text-label text-ink-dim">No notifications yet.</p>
          ) : (
            [...history].reverse().map((toast) => renderToast(toast, `h-${toast.id}`, undefined, toast.at))
          )}
        </div>
      )}
      {!open && toasts.map((toast) => renderToast(toast, toast.id, () => dismiss(toast.id)))}
    </div>
  );
}

export function ConfirmDialog() {
  const confirmation = useUI((state) => state.confirmation);
  const close = useUI((state) => state.closeConfirmation);

  if (!confirmation) return null;

  const cancel = () => {
    confirmation.onCancel?.();
    close();
  };

  return (
    <Modal
      title={confirmation.title}
      onClose={cancel}
      footer={
        <>
          <Button onClick={cancel}>Cancel</Button>
          <Button
            tone={confirmation.destructive ? 'danger' : 'primary'}
            onClick={() => {
              confirmation.onConfirm();
              close();
            }}
          >
            {confirmation.confirmLabel}
          </Button>
        </>
      }
    >
      {confirmation.body}
    </Modal>
  );
}

const CAD_DETAIL_TEXT: Record<CadDetail, { use: string; cost: string }> = {
  standard: {
    use: 'Right for most work: viewing, assemblies, matte and glossy parts, and renders where the surface is not a mirror.',
    cost: 'Curved glass or chrome in a path-traced render can show faint facets as wavy or crinkled reflections.',
  },
  fine: {
    use: 'Choose it for glass, chrome and other mirror-like curved surfaces in a path-traced render, and for close-up product shots.',
    cost: 'On the example bottle it meant about 3× the triangles and about 3× the import time. Expect a slower import, a heavier viewport and a longer path-tracer start-up; a large assembly may become unwieldy.',
  },
};

/** Asks how finely a STEP or IGES file should be cut into triangles. */
export function CadDetailDialog() {
  const pending = useUI((state) => state.cadImport);
  const detail = useUI((state) => state.cadDetail);
  const setDetail = useUI((state) => state.setCadDetail);

  if (!pending) return null;
  const text = CAD_DETAIL_TEXT[detail];

  return (
    <Modal
      title="Import CAD model"
      onClose={cancelCadImport}
      footer={
        <>
          <Button onClick={cancelCadImport}>Cancel</Button>
          <Button tone="primary" onClick={() => confirmCadImport(detail)}>
            Import
          </Button>
        </>
      }
    >
      <p className="mb-2">
        <span className="text-ink">{pending.fileName}</span> is a CAD file, so its
        surfaces are cut into triangles on import. How finely is up to you.
      </p>
      <div className="mb-2.5 flex items-center gap-1.5">
        <Segmented<CadDetail>
          value={detail}
          onChange={setDetail}
          options={[
            { value: 'standard', label: 'Standard' },
            { value: 'fine', label: 'Fine' },
          ]}
        />
      </div>
      <p className="mb-1.5">
        <span className="text-ink">When: </span>
        {text.use}
      </p>
      <p className="mb-1.5">
        <span className="text-ink">{detail === 'fine' ? 'Downsides: ' : 'Limit: '}</span>
        {text.cost}
      </p>
      <p className="text-ink-faint">
        Chosen per model. To change it later, import the file again.
      </p>
    </Modal>
  );
}

export function BusyBar() {
  const busy = useUI((state) => state.busy);
  // In an empty scene the progress is shown in the viewport's own box instead.
  const isEmpty = useProject(selectIsEmpty);
  if (!busy || isEmpty) return null;

  return (
    <div
      role="status"
      className="pointer-events-none fixed bottom-3 left-1/2 z-80 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-raised px-3 py-1.5 shadow-xl"
    >
      <span className="size-2 animate-pulse rounded-full bg-amber" />
      <span className="text-label text-ink">{busy}</span>
    </div>
  );
}

/** Full-size view of a render — opened on completion and from the history strip. */
export function RenderPreview() {
  const previewId = useUI((state) => state.previewRenderId);
  const render = useUI(
    (state) => state.renders.find((item) => item.id === previewId) ?? null,
  );
  const close = useUI((state) => state.setPreviewRender);

  useEffect(() => {
    if (!render) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [render, close]);

  if (!render) return null;

  return (
    <div
      className="fixed inset-0 z-85 flex flex-col bg-shell/95"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close(null);
      }}
    >
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line px-3">
        <p className="text-title text-ink">
          {render.engine === 'pathtrace' ? 'Path-traced render' : 'Render'}
        </p>
        <p className="text-label text-ink-faint tabular-nums">
          {render.width} × {render.height} ·{' '}
          {describeRender(render.engine, render.samples)} ·{' '}
          {formatDuration(render.durationMs)}
        </p>
        <div className="flex-1" />
        <Button icon="export" onClick={() => void exportRender(render.id)}>
          Export PNG
        </Button>
        <IconButton icon="close" tip="Close  ·  Esc" onClick={() => close(null)} />
      </div>

      <div
        className="grid min-h-0 flex-1 place-items-center overflow-auto p-4"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) close(null);
        }}
      >
        <img
          src={render.url}
          alt={`Render at ${render.width} by ${render.height}`}
          className="max-h-full max-w-full object-contain"
          style={{
            background:
              'repeating-conic-gradient(#1c1f23 0% 25%, #15171a 0% 50%) 50%/16px 16px',
          }}
        />
      </div>
    </div>
  );
}

/**
 * Progress for a render in flight, over the whole window. The final renderers
 * resize and draw into the viewport's own canvas, so the viewport flickers
 * while one runs (the path tracer paints tile by tile). The backdrop is opaque
 * for that reason: the canvas is hidden, not merely dimmed.
 */
export function RenderProgress() {
  const progress = useUI((state) => state.renderProgress);

  useEffect(() => {
    if (!progress.active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelRender();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [progress.active]);

  if (!progress.active) return null;

  const fraction = progress.total > 0 ? progress.sample / progress.total : 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Rendering"
      className="fixed inset-0 z-95 grid place-items-center bg-shell p-4"
    >
      <div className="w-full max-w-[380px] rounded-md border border-line bg-panel p-4 shadow-xl">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-title text-ink">Rendering</p>
          <p className="text-ctl text-ink-dim tabular-nums">
            {progress.total > 0 ? `${Math.round(fraction * 100)}%` : ''}
          </p>
        </div>
        <p className="mt-0.5 text-label text-ink-faint">{progress.stage}</p>
        <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-well">
          <div
            className="h-full rounded-full bg-amber transition-[width] duration-150"
            style={{ width: `${fraction * 100}%` }}
          />
        </div>
        <div className="mt-3.5 flex items-center justify-between">
          <p className="text-label text-ink-faint">Esc cancels</p>
          <Button icon="stop" onClick={cancelRender}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
