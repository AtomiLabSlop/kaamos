import { useProject } from '../../store/project';
import { useUI } from '../../store/ui';
import {
  MAX_DIMENSION,
  MAX_PIXELS,
  RESOLUTION_PRESETS,
} from '../../render/finalRender';
import { clamp } from '../../lib/util';
import { Field, IconButton, NumberInput, Select } from '../controls';

/**
 * Output size, in the Render window.
 *
 * Both edit the same render settings, so a change in one shows in the other.
 * "Lock aspect" keeps the ratio when one dimension is typed; it is interface
 * state, not part of the project file.
 */

export const ASPECTS: { label: string; w: number; h: number }[] = [
  { label: '1 : 1', w: 1, h: 1 },
  { label: '4 : 3', w: 4, h: 3 },
  { label: '3 : 2', w: 3, h: 2 },
  { label: '16 : 9', w: 16, h: 9 },
  { label: '21 : 9', w: 21, h: 9 },
  { label: '4 : 5', w: 4, h: 5 },
  { label: '9 : 16', w: 9, h: 16 },
];

const MIN_DIMENSION = 16;
const clampDimension = (value: number) =>
  clamp(Math.round(value), MIN_DIMENSION, MAX_DIMENSION);

/** The preset whose ratio matches the current size to within a pixel of rounding. */
export function matchingAspect(width: number, height: number) {
  return ASPECTS.find((entry) => Math.abs(width * entry.h - height * entry.w) <= entry.w);
}

export function OutputSizeFields() {
  const width = useProject((state) => state.render.width);
  const height = useProject((state) => state.render.height);
  const updateRender = useProject((state) => state.updateRender);
  const lock = useUI((state) => state.lockAspect);
  const setLock = useUI((state) => state.setLockAspect);

  const setWidth = (next: number) => {
    const w = clampDimension(next);
    updateRender(
      lock ? { width: w, height: clampDimension((w * height) / width) } : { width: w },
      'render-width',
    );
  };
  const setHeight = (next: number) => {
    const h = clampDimension(next);
    updateRender(
      lock ? { height: h, width: clampDimension((h * width) / height) } : { height: h },
      'render-height',
    );
  };

  const matchingPreset = RESOLUTION_PRESETS.find(
    (preset) => preset.width === width && preset.height === height,
  );
  const aspect = matchingAspect(width, height);
  const tooBig = width * height > MAX_PIXELS;

  return (
    <>
      <Field label="Size">
        <NumberInput
          value={width}
          onChange={setWidth}
          label="Width"
          min={MIN_DIMENSION}
          max={MAX_DIMENSION}
          step={16}
          decimals={0}
          width={58}
        />
        <IconButton
          icon={lock ? 'lock' : 'unlock'}
          active={lock}
          size={22}
          tip={
            lock
              ? 'Aspect ratio locked — editing one side moves the other'
              : 'Aspect ratio free'
          }
          label="Lock aspect ratio"
          onClick={() => setLock(!lock)}
        />
        <NumberInput
          value={height}
          onChange={setHeight}
          label="Height"
          min={MIN_DIMENSION}
          max={MAX_DIMENSION}
          step={16}
          decimals={0}
          width={58}
        />
      </Field>

      <Field label="Preset">
        <Select
          label="Preset"
          value={matchingPreset?.label ?? 'custom'}
          onChange={(label) => {
            const preset = RESOLUTION_PRESETS.find((p) => p.label === label);
            if (preset) updateRender({ width: preset.width, height: preset.height });
          }}
          options={[
            ...(matchingPreset ? [] : [{ value: 'custom', label: 'Custom' }]),
            ...RESOLUTION_PRESETS.map((preset) => ({
              value: preset.label,
              label: preset.label,
            })),
          ]}
        />
      </Field>

      <Field
        label="Aspect"
        tip="Keeps the width and changes the height to the chosen ratio."
      >
        <Select
          label="Aspect"
          value={aspect?.label ?? 'custom'}
          onChange={(label) => {
            const entry = ASPECTS.find((a) => a.label === label);
            if (entry) {
              updateRender(
                { height: clampDimension((width * entry.h) / entry.w) },
                'render-height',
              );
            }
          }}
          options={[
            ...(aspect ? [] : [{ value: 'custom', label: 'Custom' }]),
            ...ASPECTS.map((entry) => ({ value: entry.label, label: entry.label })),
          ]}
        />
      </Field>

      {tooBig && (
        <p className="mt-1 text-label text-danger">
          Above the {(MAX_PIXELS / 1_000_000).toFixed(0)} MP limit. Reduce the size.
        </p>
      )}
    </>
  );
}
