import { IgnifxError } from "@ignifx/core";
import type { ErrorContext } from "@ignifx/core";

/**
 * The diagnostic codes `@ignifx/terrain` owns: the `16` range of
 * `docs/architecture/15-devtools-and-diagnostics.md` §1. An extension owns its codes and hands them
 * to the app through `ExtensionContext.registerErrorCodes` (`04-extensions.md` §3).
 */

/**
 * Every diagnostic code `@ignifx/terrain` can throw or log, keyed by an intention-revealing name so
 * call sites read as prose and the compiler catches typos (coding standards §5.2).
 *
 * @example
 * ```ts
 * throw terrainError(TerrainErrorCode.invalidTerrainFile, "island.terrain.json names no layers.", {
 *   context: { file: "island.terrain.json" },
 * });
 * ```
 *
 * @public
 */
export const TerrainErrorCode = {
  /** A `.terrain.json` document, or a `defineTerrain` input, is not one this build can read. */
  invalidTerrainFile: "IGX-1601",
  /** `resolution` is not `2^n + 1`, or does not equal `chunks.size * chunksPerSide + 1`. */
  invalidResolution: "IGX-1602",
  /** An 8-bit heightmap was loaded; it terraces. Logged once, never thrown. */
  eightBitHeightmap: "IGX-1603",
  /** The terrain entity is rotated about Y, which the world-space queries do not honour. Logged once. */
  rotationUnsupported: "IGX-1604",
  /** A terrain declares no layer, or more than {@link MAX_TERRAIN_LAYERS} of them. */
  tooManyLayers: "IGX-1605",
  /** An image uses a PNG feature the built-in decoder does not read, or is not a PNG at all. */
  unsupportedImage: "IGX-1606",
  /** The layer textures of a terrain are not all the same size; a texture array needs equal layers. */
  layerSizeMismatch: "IGX-1607",
  /** A heightmap or a control map decoded to a sample count that does not match the declaration. */
  heightmapSizeMismatch: "IGX-1608",
  /** A query ran on a `Terrain` whose asset has not been delivered yet. */
  terrainNotLoaded: "IGX-1609",
  /** A region handed to `setHeights`, `setSplat`, or `colliderInit` falls outside the field. */
  regionOutOfRange: "IGX-1610",
  /** A splat rule or a scatter names a layer the terrain does not declare. */
  unknownLayer: "IGX-1611",
  /** A `TerrainScatter` found no `Terrain` on its entity or any ancestor. */
  scatterNeedsTerrain: "IGX-1612",
} as const;

/**
 * The union of the codes the `TerrainErrorCode` table declares.
 *
 * @public
 */
export type TerrainErrorCode = (typeof TerrainErrorCode)[keyof typeof TerrainErrorCode];

/**
 * The most layers one terrain may declare: two RGBA control maps, four channels each.
 *
 * @public
 */
export const MAX_TERRAIN_LAYERS = 8;

/**
 * The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
 * Context keys appear in braces, matching the core table's convention.
 *
 * @public
 */
export const TERRAIN_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  "IGX-1601": "{file} is not an ignifx.terrain document this build can read.",
  "IGX-1602": "{file} declares resolution {resolution}, which is not 2^n + 1 or does not fit its chunks.",
  "IGX-1603": "{file} loads an 8-bit heightmap, which terraces; convert it with `ignifx import heightmap`.",
  "IGX-1604": "{entity} is rotated about Y; Terrain queries honour translation and uniform XZ scale only.",
  "IGX-1605": "{file} declares {count} layers; a terrain takes 1 to 8.",
  "IGX-1606": "{file} is not an image the built-in decoder reads: {reason}.",
  "IGX-1607": "{file} layer {layer} is {width}x{height}; every layer texture must be {expectedWidth}x{expectedHeight}.",
  "IGX-1608": "{file} decoded to {actual} samples, not the {expected} its resolution declares.",
  "IGX-1609": "{entity} has no terrain field yet; wait for the asset to load before querying it.",
  "IGX-1610": "The region {x},{z} {width}x{depth} falls outside a {resolution}x{resolution} field.",
  "IGX-1611": "{file} names the layer {layer}, which the terrain does not declare.",
  "IGX-1612": "{entity} carries a TerrainScatter but no Terrain is on it or on any ancestor.",
});

/**
 * Options accepted by {@link terrainError}: the same subset of `IgnifxErrorOptions` this package
 * uses.
 *
 * @public
 */
export interface TerrainErrorOptions {
  /** Identifiers that locate the failure. */
  readonly context?: ErrorContext;
  /** One sentence telling the developer what to do about it. */
  readonly hint?: string;
  /** The failure being wrapped, when there is one. */
  readonly cause?: unknown;
}

/**
 * Builds an `IgnifxError` carrying one of this package's codes.
 *
 * @param code - The code from the `TerrainErrorCode` table.
 * @param message - The actionable development sentence.
 * @param options - Context identifiers, a remedy hint, and the wrapped cause.
 * @returns The error to throw or to reject with.
 *
 * @example
 * ```ts
 * throw terrainError(TerrainErrorCode.unknownLayer, "island.terrain.json names no layer moss.", {
 *   context: { file: "island.terrain.json", layer: "moss" },
 * });
 * ```
 *
 * @public
 */
export function terrainError(code: TerrainErrorCode, message: string, options?: TerrainErrorOptions): IgnifxError {
  return new IgnifxError(code, message, {
    ...(options?.context === undefined ? {} : { context: options.context }),
    ...(options?.hint === undefined ? {} : { hint: options.hint }),
    ...(options?.cause === undefined ? {} : { cause: options.cause }),
  });
}
