/** Shared by both rendering backends so callers can handle either the same way. */

export class RenderError extends Error {}

/** Thrown when the user cancels; not a failure, and reported as such. */
export class RenderAborted extends Error {}

/** What a path traced render had accumulated when it was last saved to memory. */
export interface RenderCheckpoint {
  width: number;
  height: number;
  /** Samples averaged into `data`. */
  samples: number;
  /** The tracer's float RGBA buffer, rows bottom to top as WebGL reads them. */
  data: Float32Array;
}

/**
 * The graphics context was lost mid-render. Carries the last checkpoint, if
 * one was taken, so the render can carry on from it once the view is back.
 */
export class RenderContextLost extends RenderError {
  constructor(
    message: string,
    readonly checkpoint: RenderCheckpoint | null,
  ) {
    super(message);
  }
}
