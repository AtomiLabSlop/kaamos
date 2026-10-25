import { useEffect, useMemo } from 'react';
import { BackSide, Color, EquirectangularReflectionMapping } from 'three';
import { Environment, Lightformer } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useProject } from '../store/project';
import { DEFAULT_SOFTNESS, ENV_RIGS, panelGain } from './envPresets';
import { gradientTexture, panelTexture } from './gradientTexture';
import { registry } from './registry';
import { temperatureScale } from '../lib/util';

/**
 * Scene lighting from an environment map.
 *
 * The studio presets are built here as a dome plus emissive panels, rendered
 * into a cube map by drei's `Environment`. The result is an ordinary
 * environment texture, so intensity and rotation behave exactly as they do for
 * an uploaded HDRI, and the custom-upload branch below shares the same props.
 *
 * The map is rebuilt only when the rig or the colour temperature changes
 * (`key`); intensity and rotation are cheap prop updates on the existing map.
 */

function tint(hex: string, scale: [number, number, number]) {
  const colour = new Color(hex);
  colour.r *= scale[0];
  colour.g *= scale[1];
  colour.b *= scale[2];
  return colour;
}

export function EnvironmentRig() {
  const env = useProject((state) => state.environment);
  const rig = ENV_RIGS[env.presetId] ?? ENV_RIGS['soft-studio'];
  const custom = registry.getEnvTexture(env.customKey);
  const useCustom = env.source === 'custom' && Boolean(custom);

  const scaleRgb = useMemo(() => temperatureScale(env.temperature), [env.temperature]);
  const dome = useMemo(() => gradientTexture(rig.dome[0], rig.dome[1]), [rig]);

  const showAsBackground = env.backgroundMode === 'environment';
  const rotation = useMemo<[number, number, number]>(
    () => [0, env.rotation, 0],
    [env.rotation],
  );

  if (useCustom && custom) {
    custom.mapping = EquirectangularReflectionMapping;
    return (
      <Environment
        map={custom}
        background={showAsBackground}
        environmentIntensity={env.intensity}
        environmentRotation={rotation}
        backgroundRotation={rotation}
      />
    );
  }

  return (
    <Environment
      key={`${rig.id}-${env.temperature}-${showAsBackground}-${env.resolution}`}
      frames={1}
      resolution={env.resolution}
      background={showAsBackground}
      environmentIntensity={env.intensity}
      environmentRotation={rotation}
      backgroundRotation={rotation}
    >
      {/* The surround. Everything the model reflects that is not a panel.
          Densely tessellated, because a mirror finish shows the facets of a
          coarse sphere as banding across the gradient. */}
      <mesh scale={50}>
        <sphereGeometry args={[1, 96, 64]} />
        <meshBasicMaterial map={dome} side={BackSide} toneMapped={false} />
      </mesh>

      {rig.panels.map((panel, index) => {
        const softness = panel.softness ?? DEFAULT_SOFTNESS;
        return (
          <Lightformer
            key={index}
            form={panel.form}
            position={panel.position}
            target={panel.target ?? [0, 0, 0]}
            scale={panel.scale}
            // The rolloff map is what stops a highlight reading as a white
            // rectangle with a hard outline; the gain puts back the light the
            // rolloff takes away.
            map={panelTexture(panel.form === 'circle' ? 'circle' : 'rect', softness)}
            intensity={panel.intensity * panelGain(softness, panel.form)}
            color={tint(panel.color, scaleRgb)}
          />
        );
      })}
    </Environment>
  );
}

/**
 * Viewport background. Rendered after `EnvironmentRig` so that when the
 * background mode moves away from the environment, this effect has the last
 * word on what the scene background becomes.
 */
export function BackgroundSync() {
  const mode = useProject((state) => state.environment.backgroundMode);
  const colour = useProject((state) => state.environment.backgroundColor);
  const top = useProject((state) => state.environment.backgroundTopColor);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    if (mode === 'environment') return;

    if (mode === 'color') {
      scene.background = new Color(colour);
      return;
    }

    const texture = gradientTexture(top, colour);
    texture.mapping = EquirectangularReflectionMapping;
    scene.background = texture;
  }, [mode, colour, top, scene]);

  return null;
}
