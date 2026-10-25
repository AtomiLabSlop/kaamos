import { useProject } from '../../store/project';
import { ENV_RIGS, LIGHTING_PRESETS } from '../../scene/envPresets';
import { uploadEnvironment } from '../../actions';
import type { BackgroundMode } from '../../store/types';
import {
  Button,
  ColorField,
  Field,
  Hint,
  Section,
  Segmented,
  Select,
  Slider,
  Toggle,
} from '../controls';
import { Icon } from '../Icon';

const DEG = 180 / Math.PI;

/**
 * Project > Environment: what surrounds and lights the product.
 *
 * Choosing a studio is the one place the look is set. A studio is a complete
 * configuration (environment rig, brightness, temperature, background, ground
 * shadow and studio lights), so picking one gives a reproducible starting
 * point; everything below then fine-tunes it. The Lighting tab holds only the
 * studio lights themselves.
 */
export function EnvironmentPanel() {
  const env = useProject((state) => state.environment);
  const updateEnvironment = useProject((state) => state.updateEnvironment);
  const applyLightingPreset = useProject((state) => state.applyLightingPreset);
  const shadowResolution = useProject((state) => state.render.shadowResolution);
  const updateRender = useProject((state) => state.updateRender);
  const usingHdri = env.source === 'custom';

  const choice = (
    key: string,
    active: boolean,
    onClick: () => void,
    swatch: React.ReactNode,
    name: string,
    hint: string,
  ) => (
    <button
      key={key}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-sm border p-1 text-left transition-colors ${
        active ? 'border-amber-dim bg-amber-wash' : 'border-transparent hover:border-line hover:bg-hover'
      }`}
    >
      {swatch}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-ctl ${active ? 'text-amber' : 'text-ink'}`}>{name}</span>
        <span className="block text-label leading-snug text-ink-faint">{hint}</span>
      </span>
    </button>
  );

  return (
    <>
      <Section
        title="Studio"
        hint="A studio sets the environment, background, ground shadow and studio lights together. Undo with ⌘Z."
      >
        <div className="flex flex-col gap-0.5">
          {LIGHTING_PRESETS.map((preset) => {
            const rig = ENV_RIGS[preset.id];
            return choice(
              preset.id,
              !usingHdri && env.presetId === preset.id,
              () => applyLightingPreset(preset.id),
              <span
                aria-hidden="true"
                className="h-8 w-10 shrink-0 rounded-sm border border-line"
                style={{ background: `linear-gradient(${rig.dome[0]}, ${rig.dome[1]})` }}
              />,
              preset.name,
              preset.hint,
            );
          })}
          {env.customKey &&
            choice(
              'hdri',
              usingHdri,
              () => updateEnvironment({ source: 'custom' }),
              <span className="grid h-8 w-10 shrink-0 place-items-center rounded-sm border border-line bg-well text-ink-faint">
                <Icon name="image" />
              </span>,
              env.customName ?? 'HDRI file',
              'Your HDRI file. Studio lights are kept as they are.',
            )}
        </div>
        <div className="mt-2">
          <Button icon="import" onClick={() => void uploadEnvironment()}>
            {env.customKey ? 'Load another HDRI…' : 'Load HDRI file…'}
          </Button>
          <Hint>Radiance (.hdr) and OpenEXR (.exr) are supported.</Hint>
        </div>
      </Section>

      <Section title="Adjust">
        <Slider
          label="Intensity"
          value={env.intensity}
          onChange={(intensity) => updateEnvironment({ intensity }, 'env-intensity')}
          min={0}
          max={4}
          step={0.05}
          defaultValue={1}
        />
        <Slider
          label="Rotation"
          tip="Turns the environment around the model, which moves every reflection and highlight."
          value={env.rotation * DEG}
          onChange={(degrees) => updateEnvironment({ rotation: degrees / DEG }, 'env-rotation')}
          min={0}
          max={360}
          step={1}
          decimals={0}
          suffix="°"
          defaultValue={0}
        />
        <Field
          label="Lights follow"
          tip="Turn the studio lights with the environment, so the lighting keeps its shape and the whole set turns around the model. Off: the lights stay where they are."
        >
          <Toggle
            checked={env.lightsFollowRotation}
            onChange={(lightsFollowRotation) => updateEnvironment({ lightsFollowRotation })}
            label="Lights follow rotation"
          />
        </Field>
        {!usingHdri && (
          <>
            <Slider
              label="Temperature"
              tip="Colour of the studio light, which is also the white balance. Lower is warmer, higher is cooler. 6500 K is neutral daylight."
              value={env.temperature}
              onChange={(temperature) => updateEnvironment({ temperature }, 'env-temperature')}
              min={2000}
              max={12000}
              step={100}
              decimals={0}
              suffix="K"
              defaultValue={6500}
            />
            <Field
              label="Map detail"
              tip="Size of the environment map. Polished metals sample its finest level, so this is what decides whether a mirror finish reflects cleanly or in visible blocks."
            >
              <Select
                value={String(env.resolution)}
                onChange={(value) => updateEnvironment({ resolution: Number(value) })}
                options={[
                  { value: '512', label: '512 — fastest' },
                  { value: '1024', label: '1024 — balanced' },
                  { value: '2048', label: '2048 — sharpest' },
                ]}
              />
            </Field>
          </>
        )}
      </Section>

      <Section title="Background">
        <Field label="Show">
          <Segmented<BackgroundMode>
            value={env.backgroundMode}
            onChange={(backgroundMode) => updateEnvironment({ backgroundMode })}
            options={[
              { value: 'gradient', label: 'Gradient' },
              { value: 'color', label: 'Colour' },
              { value: 'environment', label: 'Environment' },
            ]}
          />
        </Field>

        {env.backgroundMode === 'gradient' && (
          <>
            <Field label="Top">
              <ColorField
                value={env.backgroundTopColor}
                onChange={(backgroundTopColor) =>
                  updateEnvironment({ backgroundTopColor })
                }
              />
            </Field>
            <Field label="Bottom">
              <ColorField
                value={env.backgroundColor}
                onChange={(backgroundColor) => updateEnvironment({ backgroundColor })}
              />
            </Field>
          </>
        )}

        {env.backgroundMode === 'color' && (
          <Field label="Colour">
            <ColorField
              value={env.backgroundColor}
              onChange={(backgroundColor) => updateEnvironment({ backgroundColor })}
            />
          </Field>
        )}

        {env.backgroundMode === 'environment' && (
          <Hint>
            Shows the environment itself behind the model. Rotation moves it with the
            lighting.
          </Hint>
        )}
      </Section>

      <Section title="Ground">
        <Field label="Ground plane">
          <Toggle
            checked={env.groundEnabled}
            onChange={(groundEnabled) => updateEnvironment({ groundEnabled })}
            label="Ground plane"
          />
        </Field>
        {env.groundEnabled && (
          <>
            <Field label="Colour">
              <ColorField
                value={env.groundColor}
                onChange={(groundColor) => updateEnvironment({ groundColor })}
              />
            </Field>
            <Slider
              label="Roughness"
              tip="Sharpens or smears both the environment on the floor and the product's reflection in it."
              value={env.groundRoughness}
              onChange={(groundRoughness) =>
                updateEnvironment({ groundRoughness }, 'ground-roughness')
              }
              defaultValue={0.28}
            />
            <Slider
              label="Metallic"
              value={env.groundMetalness}
              onChange={(groundMetalness) =>
                updateEnvironment({ groundMetalness }, 'ground-metalness')
              }
              defaultValue={0}
            />
            <Slider
              label="Reflection"
              tip="How strongly the product is mirrored in the floor. Zero turns the mirror off entirely, which is the cheaper setting."
              value={env.groundReflection}
              onChange={(groundReflection) =>
                updateEnvironment({ groundReflection }, 'ground-reflection')
              }
              defaultValue={0.45}
            />
            <Slider
              label="Reflection fade"
              tip="How far the reflection carries across the floor before it disappears."
              value={env.groundReflectionFade}
              onChange={(groundReflectionFade) =>
                updateEnvironment({ groundReflectionFade }, 'ground-reflection-fade')
              }
              min={0.5}
              max={12}
              step={0.1}
              decimals={1}
              defaultValue={2.6}
              disabled={env.groundReflection <= 0}
            />
            {env.groundReflection > 0 && (
              <Hint>
                The reflection is a mirrored render of the scene, so it costs a
                second pass over the geometry each frame.
              </Hint>
            )}
          </>
        )}
      </Section>

      <Section title="Ground shadow">
        <Field label="Shadow">
          <Toggle
            checked={env.shadowEnabled}
            onChange={(shadowEnabled) => updateEnvironment({ shadowEnabled })}
            label="Ground shadow"
          />
        </Field>
        {env.shadowEnabled && (
          <>
            <Slider
              label="Strength"
              value={env.shadowOpacity}
              onChange={(shadowOpacity) =>
                updateEnvironment({ shadowOpacity }, 'shadow-opacity')
              }
              defaultValue={0.55}
            />
            <Slider
              label="Softness"
              value={env.shadowBlur}
              onChange={(shadowBlur) => updateEnvironment({ shadowBlur }, 'shadow-blur')}
              min={0}
              max={8}
              step={0.1}
              decimals={1}
              defaultValue={3}
            />
            <Slider
              label="Area"
              tip="The shadow area as a multiple of the product's own footprint. It scales with the model, so the detail stays on the product rather than on empty floor. Widen it if a soft shadow is being cut off."
              value={env.shadowSpread}
              onChange={(shadowSpread) =>
                updateEnvironment({ shadowSpread }, 'shadow-spread')
              }
              min={1.05}
              max={6}
              step={0.05}
              decimals={2}
              suffix="×"
              defaultValue={1.9}
            />
            <Field label="Detail" tip="Resolution of the ground shadow map, in the viewport and in renders.">
              <Select
                value={String(shadowResolution)}
                onChange={(value) => updateRender({ shadowResolution: Number(value) })}
                options={[
                  { value: '512', label: '512' },
                  { value: '1024', label: '1024' },
                  { value: '2048', label: '2048' },
                ]}
              />
            </Field>
            <Hint>
              A soft contact shadow rendered from the ground up. Area lights
              illuminate but do not cast shadow maps.
            </Hint>
          </>
        )}
      </Section>
    </>
  );
}
