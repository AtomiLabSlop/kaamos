import { useProject, useSceneStats } from '../store/project';
import { useUI } from '../store/ui';
import { formatCount } from '../lib/util';
import { focalLengthMm } from '../render/depthOfField';

/**
 * Heads-up display: facts about the scene and the output, in the viewport's
 * corner. It reports only what the application actually knows. There is no
 * samples-per-second line because the viewport redraws on demand rather than
 * continuously, so a frame rate would be a number with nothing behind it.
 */


export function Hud({
  viewWidth,
  viewHeight,
}: {
  viewWidth: number;
  viewHeight: number;
}) {
  const show = useUI((state) => state.showHud);
  const stats = useSceneStats();
  const camera = useProject((state) => state.camera);
  const render = useProject((state) => state.render);
  const rendering = useUI((state) => state.renderProgress.active);
  const pathPreview = useUI((state) => state.pathPreview);

  if (!show) return null;

  const outputAspect = render.width / render.height;
  const wider = viewHeight > 0 && viewHeight * outputAspect > viewWidth + 1;

  const rows: [string, string][] = [
    ['Preview', pathPreview ? 'Real-time · path traced' : 'Real-time · raster'],
    ['Geometry', `${formatCount(stats.triangles)} triangles · ${formatCount(stats.meshes)} objects`],
    [
      'Camera',
      camera.projection === 'perspective'
        ? `Perspective · ${Math.round(focalLengthMm(camera.fov))} mm (35 mm equiv.)`
        : 'Orthographic',
    ],
    ['Output', `${render.width} × ${render.height}`],
  ];

  return (
    <div
      aria-label="Heads-up display"
      className="pointer-events-none rounded-lg border border-line bg-panel/80 px-2.5 py-2 backdrop-blur-sm"
    >
      <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-micro leading-tight">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-ink-faint">{label}</dt>
            <dd className="text-ink-dim tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {wider && (
        <p className="mt-1 max-w-[210px] text-micro leading-snug text-ink-faint">
          The output is wider than this view; the render shows more at the sides.
        </p>
      )}
      {rendering && <p className="mt-1 text-micro text-amber">Rendering…</p>}
    </div>
  );
}
