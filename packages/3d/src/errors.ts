import { IgnifxError } from "@ignifx/core";
import type { ErrorContext } from "@ignifx/core";

/**
 * The diagnostic codes `@ignifx/3d` owns. The 3D toolkit sits in the `12` range of
 * `docs/architecture/15-devtools-and-diagnostics.md` §1, so every code reads `IGX-12##`.
 *
 * The table lives here rather than in `@ignifx/core`'s `CoreErrorCode`: an extension owns its own
 * codes and hands them to the app through `ExtensionContext.registerErrorCodes`
 * (`docs/architecture/04-extensions.md` §3).
 */

/**
 * Every diagnostic code `@ignifx/3d` can throw or log, keyed by an intention-revealing name so call
 * sites read as prose and the compiler catches typos (coding standards §5.2).
 *
 * @example
 * ```ts
 * throw threeDError(ThreeDErrorCode.unknownState, "hero.animator.json declares no state named jump.", {
 *   context: { asset: "hero.animator.json", state: "jump" },
 * });
 * ```
 *
 * @public
 */
export const ThreeDErrorCode = {
  /** A `.animator.json` file is not an `ignifx.animator` document this build can read. */
  invalidAnimatorFile: "IGX-1201",
  /** `Animator.play` or a transition named a state the document does not declare. */
  unknownState: "IGX-1202",
  /** `setFloat`/`setInt`/`setBool`/`setTrigger` named a parameter the document does not declare. */
  unknownParameter: "IGX-1203",
  /** A parameter was written with a value of the wrong kind for its declaration. */
  parameterKindMismatch: "IGX-1204",
  /** A navigation query ran before the Recast plugin had finished loading, or before a bake. */
  navigationNotReady: "IGX-1205",
  /** The Recast WebAssembly module could not be loaded at all. */
  navigationUnavailable: "IGX-1206",
  /** A `NavMeshAgent` could not join its crowd because the surface's `maxAgents` is full. */
  crowdFull: "IGX-1207",
  /** A `NavMeshObstacle` needs a surface baked with `maxObstacles` greater than zero. */
  obstaclesNotEnabled: "IGX-1208",
  /** A `NavMeshSurface` was baked with no source geometry, so every query fails. */
  emptyNavMesh: "IGX-1209",
  /** A pre-baked `.navmesh.bin` was named; Babylon Lite 1.27.0 cannot deserialize one. */
  prebakedNavMeshUnsupported: "IGX-1210",
  /** A rig needs the main camera and the world has none enabled. */
  noMainCamera: "IGX-1211",
  /** A controller named an input action the loaded action maps do not declare. */
  unknownInputAction: "IGX-1212",
  /** A second `threeD()` extension was registered on one app. */
  duplicateExtension: "IGX-1213",
  /** A `LodGroup` level names a renderer that is not under the group's entity. */
  invalidLodLevel: "IGX-1214",
} as const;

/**
 * The union of the codes the `ThreeDErrorCode` table declares.
 *
 * @public
 */
export type ThreeDErrorCode = (typeof ThreeDErrorCode)[keyof typeof ThreeDErrorCode];

/**
 * The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
 * Context keys appear in braces, matching the core table's convention.
 *
 * @public
 */
export const THREE_D_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  "IGX-1201": "{file} is not an ignifx.animator document this build can read.",
  "IGX-1202": "{asset} declares no state named {state}.",
  "IGX-1203": "{asset} declares no parameter named {parameter}.",
  "IGX-1204": "The parameter {parameter} is a {kind} and cannot take this value.",
  "IGX-1205": "Navigation is not ready yet: {reason}.",
  "IGX-1206": "The Recast navigation module could not be loaded.",
  "IGX-1207": "The crowd of {surface} is full at {maxAgents} agents.",
  "IGX-1208": "{surface} was baked with maxObstacles 0, so it carries no tile cache for obstacles.",
  "IGX-1209": "{surface} was baked from no source geometry; every navigation query will fail.",
  "IGX-1210": "Pre-baked navmesh assets are not supported by the pinned Babylon Lite; bake at runtime.",
  "IGX-1211": "{component} needs an enabled Camera in the world and found none.",
  "IGX-1212": "{component} reads the input action {action}, which no loaded action map declares.",
  "IGX-1213": "The threeD() extension is already registered on this app.",
  "IGX-1214": "{renderer} is not a MeshRenderer this LodGroup can switch.",
});

/**
 * Options accepted by {@link threeDError}: the same subset of `IgnifxErrorOptions` this package
 * uses.
 *
 * @public
 */
export interface ThreeDErrorOptions {
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
 * @param code - The code from the `ThreeDErrorCode` table.
 * @param message - The actionable development sentence.
 * @param options - Context identifiers, a remedy hint, and the wrapped cause.
 * @returns The error to throw or to reject with.
 *
 * @example
 * ```ts
 * throw threeDError(ThreeDErrorCode.unknownParameter, "hero.animator.json declares no speed.", {
 *   context: { asset: "hero.animator.json", parameter: "speed" },
 * });
 * ```
 *
 * @public
 */
export function threeDError(code: ThreeDErrorCode, message: string, options?: ThreeDErrorOptions): IgnifxError {
  return new IgnifxError(code, message, {
    ...(options?.context === undefined ? {} : { context: options.context }),
    ...(options?.hint === undefined ? {} : { hint: options.hint }),
    ...(options?.cause === undefined ? {} : { cause: options.cause }),
  });
}
