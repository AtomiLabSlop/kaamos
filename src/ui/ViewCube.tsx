import { useEffect, useRef, useState } from 'react';
import { Matrix4, Quaternion } from 'three';
import { applyView } from '../actions';
import { VIEW_PRESETS, viewport } from '../scene/viewportApi';
import type { Vec3 } from '../store/types';
import { Tip } from './controls';

/**
 * View cube: shows which way the model is turned, and every part of it is a
 * click target that moves the camera to a standard view.
 *
 * Each face is a 3 × 3 grid. The middle cell is the face itself (Front, Top…),
 * the cells on its edges are the 12 edge views (Top Front, Front Right…), and
 * the cells in its corners are the 8 corner views (Top Front Right…). A view is
 * the sum of the face directions it touches, so the cell's direction is the
 * face normal plus its neighbours' normals.
 *
 * The scene is Y up, and a view is named for the side the camera looks from:
 * Front is +Z, Right +X, Back −Z, Left −X, Top +Y, Bottom −Y. The cube is drawn
 * in those same world axes, so its labels cannot disagree with what a click
 * does (and the keys 1–7 still pick the same standard views).
 *
 * At rest the labels, the cube's outline and a translucent panel-coloured fill
 * are drawn; the fill keeps the cube readable over any background, light or
 * dark. Hovering a zone
 * fills it in amber, and the fill runs across the faces it touches: a corner
 * lights up as one hexagon, an edge as one strip that bends round it. Every
 * cell carries its direction as a key, and all cells with the key under the
 * pointer light up together. The face zones are the largest (60 % of a face);
 * edge and corner zones take the remaining 20 % on each side.
 *
 * Faces are CSS 3D planes. The viewport only draws on demand, so nothing here
 * can wait for a redraw: a light animation-frame loop reads the camera's
 * rotation and rewrites the six transforms only when it has changed. It touches
 * the DOM directly, so turning the model never re-renders React.
 */

const SIZE = 136; // the widget's edge, px
const EDGE = 68; // the cube's edge, px
const HALF = EDGE / 2;
const PERSPECTIVE = 420;

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** `up` is the way up on the face when it is read from outside; `n` points out of it. */
const FACES = [
  { id: 'front', n: [0, 0, 1] as Vec3, up: [0, 1, 0] as Vec3 },
  { id: 'right', n: [1, 0, 0] as Vec3, up: [0, 1, 0] as Vec3 },
  { id: 'back', n: [0, 0, -1] as Vec3, up: [0, 1, 0] as Vec3 },
  { id: 'left', n: [-1, 0, 0] as Vec3, up: [0, 1, 0] as Vec3 },
  // Seen from above the screen's up is −Z, from below it is +Z (see VIEW_PRESETS).
  { id: 'top', n: [0, 1, 0] as Vec3, up: [0, 0, -1] as Vec3 },
  { id: 'bottom', n: [0, -1, 0] as Vec3, up: [0, 0, 1] as Vec3 },
].map((face) => {
  // right = up × n, so that right × up = n and the text reads correctly.
  const right = cross(face.up, face.n);
  const cells = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const across = col - 1; // −1 left … +1 right on the face
      const rise = 1 - row; // +1 top … −1 bottom on the face
      const direction: Vec3 = [
        face.n[0] + right[0] * across + face.up[0] * rise,
        face.n[1] + right[1] * across + face.up[1] * rise,
        face.n[2] + right[2] * across + face.up[2] * rise,
      ];
      cells.push({ across, rise, direction });
    }
  }
  return {
    ...face,
    right,
    preset: VIEW_PRESETS.find((preset) => preset.id === face.id)!,
    cells,
  };
});

/** "Top Front Right view": vertical side first, then front/back, then left/right. */
function viewName([x, y, z]: Vec3) {
  const parts = [
    y > 0 ? 'Top' : y < 0 ? 'Bottom' : '',
    z > 0 ? 'Front' : z < 0 ? 'Back' : '',
    x < 0 ? 'Left' : x > 0 ? 'Right' : '',
  ].filter(Boolean);
  return `${parts.join(' ')} view`;
}

function goTo(direction: Vec3, face: (typeof FACES)[number], middle: boolean) {
  // The middle cell is the face's own preset, which already keeps clear of the poles.
  applyView(middle ? face.preset.direction : direction);
}

export function ViewCube() {
  const [hover, setHover] = useState<string | null>(null);
  const faceEls = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let frame = 0;
    const last = [NaN, NaN, NaN, NaN];
    const inverse = new Quaternion();
    const rotation = new Matrix4();

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const camera = viewport.camera;
      if (!camera) return;
      const q = camera.quaternion;
      if (q.x === last[0] && q.y === last[1] && q.z === last[2] && q.w === last[3]) return;
      last[0] = q.x;
      last[1] = q.y;
      last[2] = q.z;
      last[3] = q.w;

      inverse.copy(q).invert();
      rotation.makeRotationFromQuaternion(inverse);
      const e = rotation.elements;

      // World vector → screen, in CSS terms: x right, y down, z toward the viewer.
      const toScreen = (v: Vec3): Vec3 => [
        e[0] * v[0] + e[4] * v[1] + e[8] * v[2],
        -(e[1] * v[0] + e[5] * v[1] + e[9] * v[2]),
        e[2] * v[0] + e[6] * v[1] + e[10] * v[2],
      ];

      FACES.forEach((face, i) => {
        const el = faceEls.current[i];
        if (!el) return;
        const r = toScreen(face.right);
        const d = toScreen([-face.up[0], -face.up[1], -face.up[2]]);
        const n = toScreen(face.n);
        el.style.transform =
          `matrix3d(${r[0]},${r[1]},${r[2]},0,${d[0]},${d[1]},${d[2]},0,` +
          `${n[0]},${n[1]},${n[2]},0,${n[0] * HALF},${n[1] * HALF},${n[2] * HALF},1)`;
      });
    };

    tick();
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    // Pointer events stop here: a click on the cube is not a click on the scene
    // behind it, which would otherwise clear the selection.
    <div
      className="pointer-events-auto relative select-none"
      style={{ width: SIZE, height: SIZE, perspective: PERSPECTIVE }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      data-testid="view-cube"
    >
      <div className="absolute inset-0" style={{ transformStyle: 'preserve-3d' }}>
        {FACES.map((face, i) => (
          <div
            key={face.id}
            ref={(el) => {
              faceEls.current[i] = el;
            }}
            className="absolute grid border border-ink-dim/70 bg-panel/70"
            style={{
              width: EDGE,
              height: EDGE,
              left: (SIZE - EDGE) / 2,
              top: (SIZE - EDGE) / 2,
              gridTemplateColumns: '0.22fr 0.56fr 0.22fr',
              gridTemplateRows: '0.22fr 0.56fr 0.22fr',
              backfaceVisibility: 'hidden',
            }}
          >
            {face.cells.map((cell) => {
              const middle = cell.across === 0 && cell.rise === 0;
              const shortcut = middle ? face.preset.shortcut : null;
              const key = cell.direction.join(',');
              return (
                <Tip
                  key={`${cell.across}${cell.rise}`}
                  text={`${viewName(cell.direction)}${shortcut ? `  ·  ${shortcut}` : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => goTo(cell.direction, face, middle)}
                    onPointerEnter={() => setHover(key)}
                    onPointerLeave={() => setHover((current) => (current === key ? null : current))}
                    aria-label={viewName(cell.direction)}
                    className={`grid place-items-center uppercase ${
                      hover === key ? 'bg-amber/55' : ''
                    } ${middle ? 'font-semibold tracking-wide' : ''} ${
                      middle && hover === key ? 'text-ink' : 'text-ink-dim'
                    }`}
                    style={{ fontSize: 11 }}
                  >
                    {middle ? face.preset.label : ''}
                  </button>
                </Tip>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
