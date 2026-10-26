import { useProject } from '../../store/project';
import { useUI } from '../../store/ui';
import {
  Button,
  ColorField,
  Field,
  Hint,
  IconButton,
  Section,
  Slider,
  TextInput,
} from '../controls';
import { Icon } from './../Icon';

function setAxis(position: [number, number, number], axis: 0 | 1 | 2, value: number) {
  const next = [...position] as [number, number, number];
  next[axis] = value;
  return next;
}

export function LightPanel() {
  const lights = useProject((state) => state.lights);
  const addLight = useProject((state) => state.addLight);
  const updateLight = useProject((state) => state.updateLight);
  const duplicateLight = useProject((state) => state.duplicateLight);
  const removeLight = useProject((state) => state.removeLight);

  const selectedLightId = useUI((state) => state.selectedLightId);
  const selectLight = useUI((state) => state.selectLight);

  const selected = lights.find((light) => light.id === selectedLightId) ?? lights[0];

  return (
    <>
      <Section
        title="Studio lights"
        actions={
          lights.length > 0 ? (
            <IconButton
              icon="plus"
              tip="Add an area light"
              size={22}
              onClick={() => selectLight(addLight())}
            />
          ) : undefined
        }
      >
        {lights.length === 0 ? (
          <>
            <Hint>
              No studio lights. The environment is lighting the scene on its own —
              which is often enough. Add a light to shape a specific highlight, or
              pick a studio on the Environment tab for a ready-made set.
            </Hint>
            <div className="mt-2">
              <Button icon="plus" onClick={() => selectLight(addLight())}>
                Add area light
              </Button>
            </div>
          </>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {lights.map((light) => {
              const active = selected?.id === light.id;
              return (
                <li key={light.id}>
                  <div
                    className={`group flex h-[24px] items-center gap-1.5 rounded-sm px-1.5 ${
                      active ? 'bg-amber-wash' : 'hover:bg-hover'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        updateLight(light.id, { enabled: !light.enabled })
                      }
                      aria-label={light.enabled ? 'Turn off' : 'Turn on'}
                      className={`grid size-[16px] shrink-0 place-items-center ${
                        light.enabled ? 'text-amber' : 'text-ink-faint'
                      }`}
                    >
                      <Icon name="light" size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => selectLight(light.id)}
                      className={`min-w-0 flex-1 truncate text-left text-ctl ${
                        light.enabled ? 'text-ink' : 'text-ink-faint'
                      }`}
                    >
                      {light.name}
                    </button>
                    <span className="shrink-0 text-label text-ink-faint tabular-nums">
                      {light.intensity.toFixed(1)}
                    </span>
                    <span
                      className="size-[10px] shrink-0 rounded-full border border-line"
                      style={{ background: light.color }}
                      aria-hidden="true"
                    />
                    <IconButton
                      icon="trash"
                      tip="Remove"
                      size={18}
                      onClick={() => {
                        removeLight(light.id);
                        if (selectedLightId === light.id) selectLight(null);
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {lights.length > 0 && (
          <Hint>Show where the lights sit with the light button under the viewport, or H.</Hint>
        )}
      </Section>

      {selected && (
        <>
          <Section title={selected.name}>
            <Field label="Name">
              <TextInput label="Light name" value={selected.name} onChange={(name) => updateLight(selected.id, { name })} />
            </Field>
            <Field label="Colour">
              <ColorField
                value={selected.color}
                onChange={(color) => updateLight(selected.id, { color })}
              />
            </Field>
            <Slider
              label="Intensity"
              value={selected.intensity}
              onChange={(intensity) =>
                updateLight(selected.id, { intensity }, `light-${selected.id}-intensity`)
              }
              min={0}
              max={40}
              step={0.1}
              decimals={1}
              defaultValue={5}
            />
          </Section>

          <Section title="Size and placement">
            <Slider
              label="Width"
              tip="A larger source gives softer, broader highlights."
              value={selected.width}
              onChange={(width) =>
                updateLight(selected.id, { width }, `light-${selected.id}-width`)
              }
              min={0.05}
              max={12}
              step={0.05}
              defaultValue={2}
            />
            <Slider
              label="Height"
              value={selected.height}
              onChange={(height) =>
                updateLight(selected.id, { height }, `light-${selected.id}-height`)
              }
              min={0.05}
              max={12}
              step={0.05}
              defaultValue={2}
            />
            <Slider
              label="Position X" tip="Left–right (X), up–down (Y) and towards–away from the front view (Z), in studio units."
              value={selected.position[0]}
              onChange={(v) =>
                updateLight(
                  selected.id,
                  { position: setAxis(selected.position, 0, v) },
                  `light-${selected.id}-position`,
                )
              }
              min={-10}
              max={10}
              step={0.05}
            />
            <Slider
              label="Position Y"
              value={selected.position[1]}
              onChange={(v) =>
                updateLight(
                  selected.id,
                  { position: setAxis(selected.position, 1, v) },
                  `light-${selected.id}-position`,
                )
              }
              min={-2}
              max={10}
              step={0.05}
            />
            <Slider
              label="Position Z"
              value={selected.position[2]}
              onChange={(v) =>
                updateLight(
                  selected.id,
                  { position: setAxis(selected.position, 2, v) },
                  `light-${selected.id}-position`,
                )
              }
              min={-10}
              max={10}
              step={0.05}
            />
            <Slider
              label="Aim height"
              tip="The height on the model's vertical axis that the light points at."
              value={selected.aimHeight}
              onChange={(aimHeight) =>
                updateLight(selected.id, { aimHeight }, `light-${selected.id}-aim`)
              }
              min={-2}
              max={4}
              step={0.05}
              defaultValue={0.35}
            />

            <div className="mt-2.5 flex gap-1.5">
              <Button
                icon="copy"
                onClick={() => {
                  const id = duplicateLight(selected.id);
                  if (id) selectLight(id);
                }}
              >
                Duplicate
              </Button>
            </div>
          </Section>

          <div className="px-2.5 py-3">
            <Hint>
              Area lights give the long soft highlights that read as studio lighting.
              In this renderer they illuminate but do not cast shadow maps — grounding
              comes from the ground shadow on the Environment tab.
            </Hint>
          </div>
        </>
      )}
    </>
  );
}
