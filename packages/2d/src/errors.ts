import { IgnifxError } from "@ignifx/core";
import type { ErrorContext } from "@ignifx/core";

/**
 * The diagnostic codes `@ignifx/2d` owns. The 2D subsystem sits in the `11` range of
 * `docs/architecture/15-devtools-and-diagnostics.md` §1, so every code reads `IGX-11##`.
 *
 * The `11` range is shared with `@ignifx/physics-2d`, which owns `IGX-1101` (registering both
 * `physics()` and `physics2d()` on one world — `docs/architecture/11-2d-toolkit.md` §8) and the
 * codes from `IGX-1130` up. The 2D toolkit owns `IGX-1102` through `IGX-1129`.
 *
 * The table lives here rather than in `@ignifx/core`'s `CoreErrorCode`: an extension owns its own
 * codes and hands them to the app through `ExtensionContext.registerErrorCodes`
 * (`docs/architecture/04-extensions.md` §3).
 */

/**
 * Every diagnostic code `@ignifx/2d` can throw or log, keyed by an intention-revealing name so call
 * sites read as prose and the compiler catches typos (coding standards §5.2).
 *
 * @example
 * ```ts
 * throw twoDError(TwoDErrorCode.unknownSortingLayer, "Foreground is not a declared sorting layer.", {
 *   context: { sortingLayer: "Foreground" },
 * });
 * ```
 *
 * @public
 */
export const TwoDErrorCode = {
  /** An atlas frame has no one-pixel extruded border, which a pixel-perfect camera will bleed. */
  atlasFrameNotExtruded: "IGX-1102",
  /** A `.atlas.json` file is not an `ignifx.spriteatlas` document this build can read. */
  invalidAtlasFile: "IGX-1103",
  /** A `.spriteanim.json` file is not an `ignifx.spriteanimation` document this build can read. */
  invalidAnimationFile: "IGX-1104",
  /** A `.tilemap.json` file is not an `ignifx.tilemap` document this build can read. */
  invalidTilemapFile: "IGX-1105",
  /** A sprite address names a frame the atlas does not declare. */
  unknownFrame: "IGX-1106",
  /** A component named a sorting layer the `sortingLayers` settings section does not declare. */
  unknownSortingLayer: "IGX-1107",
  /** `SpriteAnimator.play` named a clip the animation asset does not declare. */
  unknownClip: "IGX-1108",
  /** A tilemap importer was handed a document it cannot read, or an unsupported projection. */
  unsupportedImport: "IGX-1109",
  /** `app.twoD.registerTileObjectFactory` was called twice for one object type. */
  duplicateObjectFactory: "IGX-1110",
  /** A tile coordinate is outside the tilemap layer's bounds. */
  tileOutOfRange: "IGX-1111",
  /** A second `twoD()` extension was registered on one app. */
  duplicateExtension: "IGX-1112",
  /** A `SpriteLayerEffect` declared the `custom` kind without a WGSL fragment body. */
  missingShaderSource: "IGX-1113",
} as const;

/**
 * The union of the codes the `TwoDErrorCode` table declares.
 *
 * @public
 */
export type TwoDErrorCode = (typeof TwoDErrorCode)[keyof typeof TwoDErrorCode];

/**
 * The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
 * Context keys appear in braces, matching the core table's convention.
 *
 * @public
 */
export const TWO_D_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  "IGX-1102": "Atlas frame {frame} has no 1-px extruded border; a pixel-perfect camera will bleed it.",
  "IGX-1103": "{file} is not an ignifx.spriteatlas document this build can read.",
  "IGX-1104": "{file} is not an ignifx.spriteanimation document this build can read.",
  "IGX-1105": "{file} is not an ignifx.tilemap document this build can read.",
  "IGX-1106": "{atlas} declares no frame named {frame}.",
  "IGX-1107": "{sortingLayer} is not a sorting layer declared by the sortingLayers settings section.",
  "IGX-1108": "{asset} declares no clip named {clip}.",
  "IGX-1109": "{importer} cannot read this document: {reason}.",
  "IGX-1110": "A tile object factory for {type} is already registered.",
  "IGX-1111": "Cell {x},{y} is outside layer {layer}.",
  "IGX-1112": "The twoD() extension is already registered on this app.",
  "IGX-1113": "A custom SpriteLayerEffect needs a WGSL fragment body in its shader field.",
});

/**
 * Options accepted by {@link twoDError}: the same subset of `IgnifxErrorOptions` this package uses.
 *
 * @public
 */
export interface TwoDErrorOptions {
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
 * @param code - The code from the `TwoDErrorCode` table.
 * @param message - The actionable development sentence.
 * @param options - Context identifiers, a remedy hint, and the wrapped cause.
 * @returns The error to throw or to reject with.
 *
 * @example
 * ```ts
 * throw twoDError(TwoDErrorCode.unknownClip, "hero.spriteanim.json declares no clip named jump.", {
 *   context: { asset: "hero.spriteanim.json", clip: "jump" },
 * });
 * ```
 *
 * @public
 */
export function twoDError(code: TwoDErrorCode, message: string, options?: TwoDErrorOptions): IgnifxError {
  return new IgnifxError(code, message, {
    ...(options?.context === undefined ? {} : { context: options.context }),
    ...(options?.hint === undefined ? {} : { hint: options.hint }),
    ...(options?.cause === undefined ? {} : { cause: options.cause }),
  });
}
