import { IgnifxError } from "@ignifx/core";
import type { ErrorContext } from "@ignifx/core";

/**
 * The diagnostic codes `@ignifx/physics` owns. The package sits in the `09` subsystem range of
 * `docs/architecture/15-devtools-and-diagnostics.md` §1, so every code reads `IGX-09##`.
 *
 * The table lives here rather than in `@ignifx/core`'s `CoreErrorCode`: an extension owns its own
 * codes and hands them to the app through `ExtensionContext.registerErrorCodes`
 * (`docs/architecture/04-extensions.md` §3).
 */

/**
 * Every diagnostic code `@ignifx/physics` can throw or report, keyed by an intention-revealing name
 * so call sites read as prose and the compiler catches typos (coding standards §5.2).
 *
 * @example
 * ```ts
 * throw physicsError(PhysicsErrorCode.queryBeforeStep, "raycast() ran before the first step.", {
 *   context: { query: "raycast" },
 * });
 * ```
 *
 * @public
 */
export const PhysicsErrorCode = {
  /** An entity with colliders but no `Rigidbody` moved after its implicit static body was placed. */
  movedStaticBody: "IGX-0901",
  /** A query ran before the first completed fixed step, so Havok has no broadphase yet. */
  queryBeforeStep: "IGX-0902",
  /** The Havok WebAssembly module could not be loaded. */
  havokUnavailable: "IGX-0903",
  /** A `.physicsmaterial.json` file is not an `ignifx.physicsmaterial` document this build reads. */
  invalidMaterialFile: "IGX-0904",
  /** The `physics.collisionMatrix` setting names a layer the project does not declare. */
  unknownLayer: "IGX-0905",
  /** A `MeshCollider` has no geometry to build a shape from. */
  colliderGeometryUnavailable: "IGX-0906",
  /** A physics body was built for an entity that has a parent, whose node pose is not world space. */
  bodyOnChildEntity: "IGX-0907",
  /** The ADR-0013 collision drain refused to bind because Babylon Lite's internals moved. */
  internalDrainUnavailable: "IGX-0908",
} as const;

/**
 * The union of the codes the `PhysicsErrorCode` table declares.
 *
 * @public
 */
export type PhysicsErrorCode = (typeof PhysicsErrorCode)[keyof typeof PhysicsErrorCode];

/**
 * The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
 * Context keys appear in braces, matching the core table's convention.
 *
 * @public
 */
export const PHYSICS_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  "IGX-0901": "{entity} has colliders but no Rigidbody, and it moved after its static body was placed.",
  "IGX-0902": "{query} needs at least one completed fixed step before Havok can answer it.",
  "IGX-0903": "The Havok WebAssembly module could not be loaded from {url}.",
  "IGX-0904": "{file} is not an ignifx.physicsmaterial document this build can read.",
  "IGX-0905": "physics.collisionMatrix names the layer {layer}, which the project does not declare.",
  "IGX-0906": "{entity} has a MeshCollider with no geometry to build a shape from.",
  "IGX-0907": "{entity} carries a physics body but is not a root entity; Havok writes its local pose.",
  "IGX-0908": "The adapter-internal collision drain does not recognise Babylon Lite {version}.",
});

/**
 * Options accepted by {@link physicsError}: the same subset of `IgnifxErrorOptions` this package
 * uses.
 *
 * @public
 */
export interface PhysicsErrorOptions {
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
 * @param code - The code from the `PhysicsErrorCode` table.
 * @param message - The actionable development sentence.
 * @param options - Context identifiers, a remedy hint, and the wrapped cause.
 * @returns The error to throw or to reject with.
 *
 * @example
 * ```ts
 * throw physicsError(PhysicsErrorCode.unknownLayer, "physics.collisionMatrix names Enemy.", {
 *   context: { layer: "Enemy" },
 * });
 * ```
 *
 * @public
 */
export function physicsError(code: PhysicsErrorCode, message: string, options?: PhysicsErrorOptions): IgnifxError {
  return new IgnifxError(code, message, {
    ...(options?.context === undefined ? {} : { context: options.context }),
    ...(options?.hint === undefined ? {} : { hint: options.hint }),
    ...(options?.cause === undefined ? {} : { cause: options.cause }),
  });
}
