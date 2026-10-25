import { APP_VERSION } from './version';

/**
 * One line naming this Kaamos version, browser, system and graphics chip, for
 * feedback. Most early problems depend on the browser and the GPU, so the
 * feedback form gets this line filled in for the user.
 */

function browserName(agent: string): string {
  const pick = (pattern: RegExp, name: string) => {
    const match = agent.match(pattern);
    return match ? `${name} ${match[1]}` : null;
  };
  return (
    pick(/Edg\/(\d+)/, 'Edge') ??
    pick(/OPR\/(\d+)/, 'Opera') ??
    pick(/Firefox\/(\d+)/, 'Firefox') ??
    pick(/Chrome\/(\d+)/, 'Chrome') ??
    (/Safari\//.test(agent) ? (pick(/Version\/([\d.]+)/, 'Safari') ?? 'Safari') : null) ??
    'Unknown browser'
  );
}

function systemName(agent: string): string {
  if (/iPhone|iPad/.test(agent)) return 'iOS';
  if (/Mac OS X/.test(agent)) return 'macOS';
  if (/Windows/.test(agent)) return 'Windows';
  if (/Android/.test(agent)) return 'Android';
  if (/Linux/.test(agent)) return 'Linux';
  return 'Unknown system';
}

let cachedGpu: string | null = null;

/** The graphics chip as WebGL reports it (browsers may round it off). */
function gpuName(): string {
  if (cachedGpu) return cachedGpu;
  let name = 'Unknown GPU';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const value = debug
        ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
      if (typeof value === 'string' && value) name = value;
      // Give the throwaway context back at once; browsers allow only a few.
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    } else {
      name = 'No WebGL2';
    }
  } catch {
    /* keep "Unknown GPU" */
  }
  cachedGpu = name;
  return name;
}

export function systemInfoLine(): string {
  const agent = navigator.userAgent;
  return `Kaamos ${APP_VERSION} · ${browserName(agent)} · ${systemName(agent)} · ${gpuName()}`;
}
