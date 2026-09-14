import { IgnifxError } from "@ignifx/core";
import type { ErrorContext } from "@ignifx/core";

/**
 * The diagnostic codes `@ignifx/particles-2d` owns. Particles sit in the `17` range of
 * `docs/architecture/15-devtools-and-diagnostics.md` §1, and this package takes `IGX-1750`–`1799`
 * (`@ignifx/particles` has `1700`–`1749`), so every code here reads `IGX-175#`.
 *
 * An extension owns its own codes and hands them to the app through
 * `ExtensionContext.registerErrorCodes` (`docs/architecture/04-extensions.md` §3). The clamp
 * warning a 2D system logs is `IGX-1702`, because it is the same budget `@ignifx/particles` owns.
 */

/**
 * Every diagnostic code `@ignifx/particles-2d` can throw or log, keyed by an intention-revealing
 * name so call sites read as prose and the compiler catches typos (coding standards §5.2).
 *
 * @example
 * ```ts
 * throw particles2DError(Particles2DErrorCode.noDefinition, "torch has no definition.", {
 *   context: { entity: "torch", method: "play" },
 * });
 * ```
 *
 * @public
 */
export const Particles2DErrorCode = {
  /** A second `particles2D()` extension was registered on one app. */
  duplicateExtension: "IGX-1751",
  /** A `ParticleSystem2D` method that needs a definition ran without one. */
  noDefinition: "IGX-1752",
  /** `emit` or `simulate` was given a value that is not a finite number in range. */
  invalidArgument: "IGX-1753",
  /** A `ParticleSystem2D` has a definition but no loaded atlas, so it draws nothing. */
  atlasNotLoaded: "IGX-1754",
  /** A `ParticleSystem2D` was attached to an app that never registered `particles2D()`. */
  extensionMissing: "IGX-1755",
  /** A `ParticleSystem2D` names a sorting layer the project does not declare; `"Default"` was used. */
  unknownSortingLayer: "IGX-1756",
} as const;

/**
 * The union of the codes the `Particles2DErrorCode` table declares.
 *
 * @public
 */
export type Particles2DErrorCode = (typeof Particles2DErrorCode)[keyof typeof Particles2DErrorCode];

/**
 * The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
 * Context keys appear in braces, matching the core table's convention.
 *
 * @public
 */
export const PARTICLES_2D_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  "IGX-1751": "The particles2D() extension is already registered on this app.",
  "IGX-1752": "{entity} has a ParticleSystem2D with no definition, so {method}() cannot run.",
  "IGX-1753": "{method} needs {expected}, not {value}.",
  "IGX-1754": "{entity} has a ParticleSystem2D whose atlas is {state}, not loaded; it draws nothing.",
  "IGX-1755": "{entity} has a ParticleSystem2D, but the particles2D() extension is not registered.",
  "IGX-1756": "{entity} draws particles on the undeclared sorting layer {layer}; {fallback} was used.",
});

/**
 * Options accepted by {@link particles2DError}: the same subset of `IgnifxErrorOptions` this
 * package uses.
 *
 * @public
 */
export interface Particles2DErrorOptions {
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
 * @param code - The code from the `Particles2DErrorCode` table.
 * @param message - The actionable development sentence.
 * @param options - Context identifiers, a remedy hint, and the wrapped cause.
 * @returns The error to throw or to reject with.
 *
 * @example
 * ```ts
 * throw particles2DError(Particles2DErrorCode.invalidArgument, "emit needs a count, not -1.", {
 *   context: { method: "emit", expected: "a finite non-negative count", value: -1 },
 * });
 * ```
 *
 * @public
 */
export function particles2DError(
  code: Particles2DErrorCode,
  message: string,
  options?: Particles2DErrorOptions,
): IgnifxError {
  return new IgnifxError(code, message, {
    ...(options?.context === undefined ? {} : { context: options.context }),
    ...(options?.hint === undefined ? {} : { hint: options.hint }),
    ...(options?.cause === undefined ? {} : { cause: options.cause }),
  });
}
