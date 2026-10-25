/**
 * Types for occt-import-js, which ships none of its own.
 *
 * Mirrors the result structure documented in the package's README. Only the
 * parts this application reads are declared.
 */
declare module 'occt-import-js' {
  export interface OcctParams {
    linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot';
    linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value';
    linearDeflection?: number;
    angularDeflection?: number;
  }

  export interface OcctBrepFace {
    first: number;
    last: number;
    color: [number, number, number] | null;
  }

  export interface OcctMesh {
    name: string;
    color?: [number, number, number];
    brep_faces?: OcctBrepFace[];
    attributes: {
      position: { array: number[] };
      normal?: { array: number[] };
    };
    index: { array: number[] };
  }

  export interface OcctNode {
    name: string;
    meshes?: number[];
    children?: OcctNode[];
  }

  export interface OcctResult {
    success: boolean;
    root: OcctNode;
    meshes: OcctMesh[];
  }

  export interface OcctModule {
    ReadStepFile(content: Uint8Array, params: OcctParams | null): OcctResult;
    ReadIgesFile(content: Uint8Array, params: OcctParams | null): OcctResult;
    ReadBrepFile(content: Uint8Array, params: OcctParams | null): OcctResult;
  }

  const factory: (options?: {
    locateFile?: (path: string, prefix: string) => string;
  }) => Promise<OcctModule>;

  export default factory;
}

declare module 'occt-import-js/dist/occt-import-js.wasm?url' {
  const url: string;
  export default url;
}
