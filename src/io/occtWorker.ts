import occtFactory, { type OcctParams, type OcctResult } from 'occt-import-js';
import wasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url';

/**
 * Tessellates CAD files off the main thread.
 *
 * OpenCascade's reader is synchronous and can take several seconds on a real
 * assembly, which would freeze the interface if it ran on the main thread.
 * The decoder is 7.6 MB of WebAssembly, so it is also deliberately kept out of
 * the application bundle — the browser only fetches it the first time someone
 * imports a STEP or IGES file.
 */

export interface OcctRequest {
  bytes: ArrayBuffer;
  format: 'step' | 'iges';
  params: OcctParams;
}

export type OcctResponse =
  | { ok: true; result: OcctResult }
  | { ok: false; error: string };

self.onmessage = async (event: MessageEvent<OcctRequest>) => {
  const { bytes, format, params } = event.data;

  try {
    const occt = await occtFactory({ locateFile: () => wasmUrl });
    const content = new Uint8Array(bytes);
    const result =
      format === 'iges'
        ? occt.ReadIgesFile(content, params)
        : occt.ReadStepFile(content, params);

    const response: OcctResponse = { ok: true, result };
    self.postMessage(response);
  } catch (error) {
    const response: OcctResponse = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
