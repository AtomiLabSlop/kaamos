import { useProject } from '../../store/project';
import {
  cameraHeightRange,
  cameraOffsetReach,
  readCameraPose,
  setCameraHeight,
  setCameraRoll,
  setHeightOffset,
  setCameraDistance,
  cameraDistanceRange,
  targetDistance,
  viewport,
} from '../../scene/viewportApi';
import { useUI } from '../../store/ui';
import { mmToWorld, unitNote, worldToMm } from '../../render/depthOfField';
import { overwriteViewpoint, restoreViewpoint, saveViewpoint } from '../../actions';
import { useEffect, useRef, useState } from 'react';
import { TONE_MAPPING_LABELS } from '../../scene/CameraRig';
import type { Projection, ToneMappingId } from '../../store/types';
import {
  Button,
  Field,
  Hint,
  IconButton,
  NumberInput,
  Section,
  Segmented,
  Select,
  Slider,
  Toggle,
} from '../controls';
import { TextField as S2TextField } from '@react-spectrum/s2';

/**
 * The camera's position readouts, following the camera as it is orbited, panned,
 * framed or set from here. `refresh` is for changes the controls do not report
 * (roll turns the camera without moving it).
 */
function useCameraPose(projection: string) {
  const [pose, setPose] = useState(readCameraPose);
  const refresh = () => setPose(readCameraPose());
  useEffect(() => {
    // The controls are rebuilt with the camera when the projection changes.
    const controls = viewport.controls;
    const update = () => setPose(readCameraPose());
    update();
    controls?.addEventListener('change', update);
    return () => controls?.removeEventListener('change', update);
  }, [projection]);
  return { pose, refresh };
}

/** A millimetre slider over a span that always includes the current value. */
function MmSlider({
  label,
  tip,
  world,
  min,
  max,
  onChange,
}: {
  label: string;
  tip: string;
  world: number;
  min: number;
  max: number;
  onChange: (world: number) => void;
}) {
  const lo = worldToMm(Math.min(min, world));
  const hi = worldToMm(Math.max(max, world));
  const step = niceStep(hi - lo);
  return (
    <Slider
      label={label}
      tip={tip}
      value={worldToMm(world)}
      onChange={(mm) => onChange(mmToWorld(mm))}
      min={lo}
      max={hi}
      step={step}
      decimals={step < 1 ? 1 : 0}
      suffix="mm"
    />
  );
}

/** A small heading inside a section, for a group of related controls. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1.5 text-label font-medium text-ink">{title}</div>
      {children}
    </div>
  );
}

/** A step of 1, 2 or 5 times a power of ten that gives the slider about 200 stops. */
function niceStep(span: number) {
  const raw = Math.max(span / 200, 1e-6);
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power;
}

export function CameraPanel() {
  const camera = useProject((state) => state.camera);
  const viewpoints = useProject((state) => state.viewpoints);
  const updateCamera = useProject((state) => state.updateCamera);
  const render = useProject((state) => state.render);
  const updateRender = useProject((state) => state.updateRender);
  const pickingFocus = useUI((state) => state.pickingFocus);
  const setPickingFocus = useUI((state) => state.setPickingFocus);
  const perspective = camera.projection === 'perspective';
  const { pose, refresh } = useCameraPose(camera.projection);
  const heightRange = cameraHeightRange();
  const distanceRange = cameraDistanceRange();
  const reach = cameraOffsetReach();
  const focusWorld = render.focusDistance > 0 ? render.focusDistance : targetDistance();
  const removeViewpoint = useProject((state) => state.removeViewpoint);
  const renameViewpoint = useProject((state) => state.renameViewpoint);
  // The saved view whose name is being typed over, if any.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const cancelRename = useRef(false);

  return (
    <>
      <Section title="Lens">
        <Field label="Projection">
          <Segmented<Projection>
            value={camera.projection}
            onChange={(projection) => updateCamera({ projection })}
            options={[
              { value: 'perspective', label: 'Perspective' },
              { value: 'orthographic', label: 'Orthographic' },
            ]}
          />
        </Field>

        {camera.projection === 'perspective' ? (
          <Slider
            label="Field of view"
            tip="A long lens (low value) flattens perspective, which usually flatters a product."
            value={camera.fov}
            onChange={(fov) => updateCamera({ fov }, 'camera-fov')}
            min={8}
            max={90}
            step={1}
            decimals={0}
            suffix="°"
            defaultValue={35}
          />
        ) : (
          <Slider
            label="Frame height"
            tip="How much of the scene fits vertically, in scene units."
            value={camera.orthoZoom}
            onChange={(orthoZoom) => updateCamera({ orthoZoom }, 'camera-zoom')}
            min={0.2}
            max={20}
            step={0.05}
            defaultValue={2.6}
          />
        )}
      </Section>

      <Section title="Position">
        <Group title="Height">
          <MmSlider
            label="Camera height (aim fixed)"
            tip="How high the camera sits above the floor. It keeps looking at the same point, so it tilts as it rises or sinks."
            world={pose.height}
            min={heightRange.min}
            max={heightRange.max}
            onChange={(world) => {
              setCameraHeight(world);
              refresh();
            }}
          />
          <MmSlider
            label="Shift view"
            tip="Lifts the camera and the point it looks at together, without tilting: the view slides up or down. Zero is where the view was last framed."
            world={pose.heightOffset}
            min={-reach}
            max={reach}
            onChange={(world) => {
              setHeightOffset(world);
              refresh();
            }}
          />
        </Group>

        {perspective && (
          <Group title="Distance">
            <MmSlider
              label="Distance from subject"
              tip="Moves the camera towards or away from the point it looks at, without turning. The field of view stays as it is; to keep the subject's size while changing perspective, use the field of view."
              world={pose.distance}
              min={distanceRange.min}
              max={distanceRange.max}
              onChange={(world) => {
                setCameraDistance(world);
                refresh();
              }}
            />
          </Group>
        )}

        <Group title="Roll">
          <Slider
            label="Roll"
            tip="Turns the camera about its line of sight, which tilts the horizon. A standard view from the view cube levels it again."
            value={pose.roll}
            onChange={(degrees) => {
              setCameraRoll(degrees);
              refresh();
            }}
            min={-45}
            max={45}
            step={0.5}
            decimals={1}
            suffix="°"
            defaultValue={0}
          />
        </Group>
      </Section>

      <Section title="Exposure">
        <Slider
          label="Exposure"
          tip="Overall brightness, applied before tone mapping. The viewport and both render engines share it."
          value={camera.exposure}
          onChange={(exposure) => updateCamera({ exposure }, 'camera-exposure')}
          min={0.05}
          max={4}
          step={0.05}
          defaultValue={1}
        />
        <Field
          label="Tone mapping"
          tip="How high dynamic range is compressed into an image. AgX and ACES hold on to bright highlights; Linear clips them."
        >
          <Select<ToneMappingId>
            value={camera.toneMapping}
            onChange={(toneMapping) => updateCamera({ toneMapping })}
            options={TONE_MAPPING_LABELS.map((entry) => ({ value: entry.id, label: entry.label }))}
          />
        </Field>
        <Hint>White balance is the Temperature slider on the Environment tab.</Hint>
      </Section>

      <Section title="Depth of field">
        <Field
          label="Depth of field"
          tip="Blurs whatever lies in front of or behind the focal plane, as a real lens does. It appears in final renders; the viewport stays sharp."
        >
          <Toggle
            checked={render.depthOfField && perspective}
            disabled={!perspective}
            onChange={(depthOfField) => {
              // Start focused on what the view is orbiting rather than at zero.
              updateRender(
                depthOfField && render.focusDistance === 0
                  ? { depthOfField, focusDistance: targetDistance() }
                  : { depthOfField },
                'render-dof',
              );
              if (!depthOfField) setPickingFocus(false);
            }}
            label="Depth of field"
          />
        </Field>
        {!perspective && <Hint>Depth of field needs the perspective camera.</Hint>}

        {render.depthOfField && perspective && (
          <>
            <Field
              label="Focus distance"
              tip="Distance from the camera to the sharpest plane, in millimetres. Use the target button, then click the part that should be sharp."
            >
              <IconButton
                icon="target"
                size={22}
                active={pickingFocus}
                tip={
                  pickingFocus
                    ? 'Click a part in the view  ·  click here to cancel'
                    : 'Select Focal Point  ·  then click a part in the view'
                }
                onClick={() => setPickingFocus(!pickingFocus)}
              />
              <NumberInput
                value={worldToMm(focusWorld)}
                onChange={(mm) =>
                  updateRender({ focusDistance: mmToWorld(Math.max(mm, 1)) }, 'render-focus')
                }
                min={1}
                step={1}
                decimals={0}
                width={70}
                suffix="mm"
              />
            </Field>
            {pickingFocus && <Hint>Click the part that should be sharp.</Hint>}
            <Slider
              label="F-stop"
              tip="Virtual aperture. A high number keeps the whole scene sharp; a low number gives a shallow focus and more blur."
              value={render.fStop}
              onChange={(fStop) => updateRender({ fStop }, 'render-fstop')}
              min={1}
              max={22}
              step={0.1}
              decimals={1}
              defaultValue={2.8}
            />
            {unitNote() && <Hint>{unitNote()}</Hint>}
          </>
        )}
      </Section>

      <Section title="Saved viewpoints">
        {viewpoints.length === 0 ? (
          <Hint>
            Save a view to come back to it later. Saved views travel with the project
            file.
          </Hint>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {viewpoints.map((view) => (
              <li
                key={view.id}
                className="group flex h-[24px] items-center gap-1 rounded-sm px-1.5 hover:bg-hover"
              >
                {renamingId === view.id ? (
                  <S2TextField
                    aria-label="View name"
                    size="S"
                    autoFocus
                    defaultValue={view.name}
                    onFocus={(event) => (event.target as HTMLInputElement).select()}
                    onBlur={(event) => {
                      const next = (event.target as HTMLInputElement).value.trim();
                      if (next && !cancelRename.current) renameViewpoint(view.id, next);
                      cancelRename.current = false;
                      setRenamingId(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                      if (event.key === 'Escape') {
                        // Leave without keeping what was typed.
                        event.stopPropagation();
                        cancelRename.current = true;
                        (event.target as HTMLInputElement).blur();
                      }
                    }}
                    UNSAFE_style={{ flex: 1, minWidth: 0 }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => restoreViewpoint(view.id)}
                    className="min-w-0 flex-1 truncate text-left text-ctl text-ink"
                  >
                    {view.name}
                  </button>
                )}
                <IconButton
                  icon="save"
                  tip="Replace this saved view with the view you see now"
                  size={18}
                  onClick={() => overwriteViewpoint(view.id)}
                />
                <IconButton
                  icon="pencil"
                  tip="Rename this view"
                  size={18}
                  onClick={() => setRenamingId(view.id)}
                />
                <IconButton
                  icon="trash"
                  tip="Delete"
                  size={18}
                  onClick={() => removeViewpoint(view.id)}
                />
              </li>
            ))}
          </ul>
        )}
        <Button
          tone="primary"
          icon="plus"
          className="mt-2 w-full justify-center"
          tip="Save the current view as a new viewpoint"
          onClick={saveViewpoint}
        >
          Save current view
        </Button>
      </Section>
    </>
  );
}
