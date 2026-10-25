export const clamp = (v: number, min: number, max: number) =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const DEG = Math.PI / 180;

let counter = 0;
/** Short, collision-free-enough ids. Not security sensitive. */
export function uid(prefix = 'id') {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/**
 * Round for display, dropping a trailing fraction but never touching the
 * integer part — 1600 formatted to 0 decimals must stay 1600, not 16.
 */
export function fmt(value: number, decimals = 2) {
  if (!Number.isFinite(value)) return '—';
  const text = value.toFixed(decimals);
  if (!text.includes('.')) return text;
  return text.replace(/0+$/, '').replace(/\.$/, '');
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatCount(n: number) {
  return n.toLocaleString('en-US');
}

export function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function timeAgo(timestamp: number, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/**
 * Approximate sRGB for a black-body temperature, after Tanner Helland's
 * widely used curve fit. Normalized so 6500 K is close to white.
 */
export function kelvinToRgb(kelvin: number): [number, number, number] {
  const t = clamp(kelvin, 1000, 15000) / 100;

  let r: number;
  let g: number;
  let b: number;

  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }

  if (t >= 66) {
    b = 255;
  } else if (t <= 19) {
    b = 0;
  } else {
    b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  }

  return [
    clamp(r, 0, 255) / 255,
    clamp(g, 0, 255) / 255,
    clamp(b, 0, 255) / 255,
  ];
}

/** Multiply a hex colour by a temperature tint, returning linear factors. */
export function temperatureScale(kelvin: number): [number, number, number] {
  const [r, g, b] = kelvinToRgb(kelvin);
  const [nr, ng, nb] = kelvinToRgb(6500);
  return [r / nr, g / ng, b / nb];
}

export async function fileToArrayBuffer(file: File | Blob): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** How a finished render describes its own quality setting. */
export function describeRender(engine: 'raster' | 'pathtrace', count: number) {
  const unit = engine === 'pathtrace' ? 'sample' : 'pass';
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}
