/** Shared by both rendering backends so callers can handle either the same way. */

export class RenderError extends Error {}

/** Thrown when the user cancels; not a failure, and reported as such. */
export class RenderAborted extends Error {}
