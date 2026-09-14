import { IgnifxError } from "@ignifx/core";
import type { ErrorContext } from "@ignifx/core";

// This package owns `IGX-1700`-`1749` (`@ignifx/particles-2d` has `1750`-`1799`;
// `docs/architecture/15-devtools-and-diagnostics.md` §1). An extension keeps its own table and
// hands it to the app through `ExtensionContext.registerErrorCodes`.

/**
 * Every diagnostic code `@ignifx/particles` can throw or log, keyed by an intention-revealing name
 * so call sites read as prose and the compiler catches typos (coding standards §5.2).
 *
 * @example
 * ```ts
 * throw particlesError(ParticlesErrorCode.invalidParticlesFile, "fire.particles.json declares no main.", {
 *   context: { file: "fire.particles.json", reason: "main is missing" },
 * });
 * ```
 *
 * @public
 */
export const ParticlesErrorCode = {
  /** A `.particles.json` document, or a `defineParticles` input, is not an `ignifx.particles` document this build can read. */
  invalidParticlesFile: "IGX-1701",
  /** A `ParticleSystem` asked for more capacity than the `app.particles.maxParticles` budget has left; it was clamped. */
  budgetExceeded: "IGX-1702",
  /** A second `particles()` extension was registered on one app. */
  duplicateExtension: "IGX-1703",
  /** `particleDefinition` named a preset that does not exist. */
  unknownPreset: "IGX-1704",
  /** A `ParticleSystem` method that needs a definition ran without one. */
  noDefinition: "IGX-1705",
  /** The generated particle shader failed to load or to build a material. */
  shaderFailed: "IGX-1706",
  /** `emit`, `simulate`, or a value argument was not a finite number in range. */
  invalidArgument: "IGX-1707",
} as const;

/**
 * The union of the codes the `ParticlesErrorCode` table declares.
 *
 * @public
 */
export type ParticlesErrorCode = (typeof ParticlesErrorCode)[keyof typeof ParticlesErrorCode];

/**
 * The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
 * Context keys appear in braces, matching the core table's convention.
 *
 * @public
 */
export const PARTICLES_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  "IGX-1701": "{file} is not an ignifx.particles document this build can read: {reason}.",
  "IGX-1702":
    "{entity} asked for {capacity} particles, but only {available} of the {budget} particle budget remain; the system was clamped.",
  "IGX-1703": "The particles() extension is already registered on this app.",
  "IGX-1704": "{preset} is not a particle preset; the presets are {presets}.",
  "IGX-1705": "{entity} has a ParticleSystem with no definition, so {method}() cannot run.",
  "IGX-1706": "The particle shader for {definition} could not be built: {message}.",
  "IGX-1707": "{method} needs {expected}, not {value}.",
});

/**
 * Options accepted by {@link particlesError}: the same subset of `IgnifxErrorOptions` this package
 * uses.
 *
 * @public
 */
export interface ParticlesErrorOptions {
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
 * @param code - The code from the `ParticlesErrorCode` table.
 * @param message - The actionable development sentence.
 * @param options - Context identifiers, a remedy hint, and the wrapped cause.
 * @returns The error to throw or to reject with.
 *
 * @example
 * ```ts
 * throw particlesError(ParticlesErrorCode.unknownPreset, "lava is not a particle preset.", {
 *   context: { preset: "lava" },
 * });
 * ```
 *
 * @public
 */
export function particlesError(
  code: ParticlesErrorCode,
  message: string,
  options?: ParticlesErrorOptions,
): IgnifxError {
  return new IgnifxError(code, message, {
    ...(options?.context === undefined ? {} : { context: options.context }),
    ...(options?.hint === undefined ? {} : { hint: options.hint }),
    ...(options?.cause === undefined ? {} : { cause: options.cause }),
  });
}
