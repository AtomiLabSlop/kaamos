import { LightPanel } from './LightPanel';

/**
 * Project > Lighting: the studio's area lights. The studio itself (environment,
 * brightness, temperature, background, shadow and a starting set of lights) is
 * chosen on the Environment tab; this tab edits the lights it left behind.
 */
export function LightingPanel() {
  return <LightPanel />;
}
