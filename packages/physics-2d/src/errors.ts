import { IgnifxError } from "@ignifx/core";
import type { ErrorContext } from "@ignifx/core";

/**
 * The diagnostic codes `@ignifx/physics-2d` owns. 2D physics shares the `11` subsystem range with
 * the 2D toolkit (`docs/architecture/15-devtools-and-diagnostics.md` §1,
 * `docs/architecture/11-2d-toolkit.md` §8), so the range is split: `@ignifx/2d` owns
 * `IGX-1101`–`IGX-1149` and this package owns `IGX-1150` upwards.
 *
 * `IGX-1101` is the one exception. `11-2d-toolkit.md` §8 names it by number — "registering both
 * throws `IGX-1101`" — and only this package can detect the condition, so this package registers
 * it. An app's error-code registry refuses a duplicate registration
 * (`packages/core/src/errors/error-code-registry.ts`), so `@ignifx/2d` must not declare it.
 */

/**
 * Every diagnostic code `@ignifx/physics-2d` can throw or report.
 *
 * @example
 * ```ts
 * throw physics2DError(Physics2DErrorCode.queryBeforeStep, "raycast() ran before the first step.", {
 *   context: { query: "raycast" },
 * });
 * ```
 *
 * @public
 */
export const Physics2DErrorCode = {
  /** Both `physics()` and `physics2d()` are registered on one world (`11-2d-toolkit.md` §8). */
  bothPhysicsExtensions: "IGX-1101",
  /** The Rapier WebAssembly module could not be instantiated. */
  rapierUnavailable: "IGX-1150",
  /** An entity with 2D colliders but no `Rigidbody2D` moved after its static body was placed. */
  movedStaticBody: "IGX-1151",
  /** A collider's layer index is outside the sixteen Rapier's interaction groups can express. */
  layerOutOfRange: "IGX-1152",
  /** A query ran before the first completed fixed step, so Rapier has no broadphase yet. */
  queryBeforeStep: "IGX-1153",
  /** A `.physicsmaterial.json` file is not an `ignifx.physicsmaterial` document this build reads. */
  invalidMaterialFile: "IGX-1154",
  /** The `physics2d.collisionMatrix` setting names a layer the project does not declare. */
  unknownLayer: "IGX-1155",
  /** A collider's geometry is degenerate: too few points, or a hull Rapier refused to build. */
  colliderGeometryInvalid: "IGX-1156",
  /** A 2D body was built for an entity that has a parent, whose pose is not world space. */
  bodyOnChildEntity: "IGX-1157",
} as const;

/**
 * The union of the codes the `Physics2DErrorCode` table declares.
 *
 * @public
 */
export type Physics2DErrorCode = (typeof Physics2DErrorCode)[keyof typeof Physics2DErrorCode];

/**
 * The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
 *
 * @public
 */
export const PHYSICS_2D_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  "IGX-1101": "A world uses either physics() or physics2d(), and {extension} found the other already there.",
  "IGX-1150": "The Rapier 2D WebAssembly module could not be instantiated.",
  "IGX-1151": "{entity} has 2D colliders but no Rigidbody2D, and it moved after its body was placed.",
  "IGX-1152": "{entity} is on layer {layer}, which is outside the sixteen layers Rapier 2D can filter by.",
  "IGX-1153": "{query} needs at least one completed fixed step before Rapier can answer it.",
  "IGX-1154": "{file} is not an ignifx.physicsmaterial document this build can read.",
  "IGX-1155": "physics2d.collisionMatrix names the layer {layer}, which the project does not declare.",
  "IGX-1156": "{entity} has a 2D collider whose geometry Rapier cannot build a shape from.",
  "IGX-1157": "{entity} carries a 2D physics body but is not a root entity; Rapier writes its world pose.",
});

/**
 * Options accepted by {@link physics2DError}.
 *
 * @public
 */
export interface Physics2DErrorOptions {
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
 * @param code - The code from the `Physics2DErrorCode` table.
 * @param message - The actionable development sentence.
 * @param options - Context identifiers, a remedy hint, and the wrapped cause.
 * @returns The error to throw or to reject with.
 *
 * @example
 * ```ts
 * throw physics2DError(Physics2DErrorCode.unknownLayer, "physics2d.collisionMatrix names Enemy.", {
 *   context: { layer: "Enemy" },
 * });
 * ```
 *
 * @public
 */
export function physics2DError(
  code: Physics2DErrorCode,
  message: string,
  options?: Physics2DErrorOptions,
): IgnifxError {
  return new IgnifxError(code, message, {
    ...(options?.context === undefined ? {} : { context: options.context }),
    ...(options?.hint === undefined ? {} : { hint: options.hint }),
    ...(options?.cause === undefined ? {} : { cause: options.cause }),
  });
}
