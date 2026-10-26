import { useEffect, useMemo, useRef } from 'react';
import { Color, type RectAreaLight } from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { RectAreaLightHelper } from 'three/examples/jsm/helpers/RectAreaLightHelper.js';
import { useHelper } from '@react-three/drei';
import { useProject } from '../store/project';
import { useUI } from '../store/ui';
import type { AreaLight } from '../store/types';
import { temperatureScale } from '../lib/util';

/**
 * Studio lights, as rectangular area lights.
 *
 * Area lights are what give product renders their long soft highlights across
 * curved surfaces, which a point or spot light cannot do. They do not cast
 * shadow maps in Three.js — grounding comes from the soft ground shadow in
 * `Ground.tsx` instead. That trade-off is noted in the README.
 */

RectAreaLightUniformsLib.init();

function AreaLightItem({
  light,
  scaleRgb,
  showHelper,
}: {
  light: AreaLight;
  scaleRgb: [number, number, number];
  showHelper: boolean;
}) {
  const ref = useRef<RectAreaLight>(null!);

  // Aim at the subject rather than exposing raw rotation, which is far easier
  // to control from a properties panel.
  useEffect(() => {
    const aim = light.aimPoint;
    if (aim) ref.current?.lookAt(aim[0], aim[1], aim[2]);
    else ref.current?.lookAt(0, light.aimHeight, 0);
  }, [light.position, light.aimHeight, light.aimPoint, light.width, light.height]);

  useHelper(showHelper ? ref : false, RectAreaLightHelper);

  const colour = useMemo(() => {
    const value = new Color(light.color);
    value.r *= scaleRgb[0];
    value.g *= scaleRgb[1];
    value.b *= scaleRgb[2];
    return value;
  }, [light.color, scaleRgb]);

  return (
    <rectAreaLight
      ref={ref}
      position={light.position}
      width={light.width}
      height={light.height}
      intensity={light.intensity}
      color={colour}
    />
  );
}

export function StudioLights() {
  const lights = useProject((state) => state.lights);
  const temperature = useProject((state) => state.environment.temperature);
  const showHelpers = useUI((state) => state.showLightHelpers);
  const follow = useProject((state) => state.environment.lightsFollowRotation);
  const rotation = useProject((state) => state.environment.rotation);

  const scaleRgb = useMemo(() => temperatureScale(temperature), [temperature]);

  // The environment turns about Y by `rotation` (the same sense as an object);
  // with the option on the lights are carried round by the same angle.
  return (
    <group rotation={[0, follow ? rotation : 0, 0]}>
      {lights
        .filter((light) => light.enabled)
        .map((light) => (
          <AreaLightItem
            key={light.id}
            light={light}
            scaleRgb={scaleRgb}
            showHelper={showHelpers}
          />
        ))}
    </group>
  );
}
