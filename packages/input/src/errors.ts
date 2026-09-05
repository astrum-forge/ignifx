import { IgnifxError } from "@ignifx/core";
import type { ErrorContext } from "@ignifx/core";

/**
 * The diagnostic codes `@ignifx/input` owns. The package sits in the `08` subsystem range of
 * `docs/architecture/15-devtools-and-diagnostics.md` §1, so every code reads `IGX-08##`.
 *
 * The table lives here rather than in `@ignifx/core`'s `CoreErrorCode`: an extension owns its own
 * codes and hands them to the app through `ExtensionContext.registerErrorCodes`, which is what
 * makes `app.services`-level tooling able to describe them (`docs/architecture/04-extensions.md`
 * §3).
 */

/**
 * Every diagnostic code `@ignifx/input` can throw, keyed by an intention-revealing name so call
 * sites read as prose and the compiler catches typos (coding standards §5.2).
 *
 * @example
 * ```ts
 * throw inputError(InputErrorCode.unknownAction, "No enabled action map declares jump.", {
 *   context: { action: "jump" },
 * });
 * ```
 *
 * @public
 */
export const InputErrorCode = {
  /** `app.input.actions.get(name)` found no such action in any enabled map. */
  unknownAction: "IGX-0801",
  /** A binding named a processor that is not one of the five built-in ones. */
  unknownProcessor: "IGX-0802",
  /** A binding path is malformed, or names a device or control that does not exist. */
  invalidBindingPath: "IGX-0803",
  /** `app.input.actions.map(name)` found no such action map. */
  unknownActionMap: "IGX-0804",
  /** An `.input.json` file is not an `ignifx.inputactions` document this build can read. */
  invalidActionsFile: "IGX-0805",
  /** A binding declared a composite that is not `2DVector`, `1DAxis`, or `ButtonWithModifier`. */
  unknownComposite: "IGX-0806",
  /** A second interactive rebind was started while one was still listening. */
  rebindInProgress: "IGX-0807",
  /** A saved override document is not an `ignifx.inputoverrides` document this build can read. */
  invalidOverrides: "IGX-0808",
  /** Pointer lock was requested on an app that has no DOM canvas to lock. */
  pointerLockUnavailable: "IGX-0809",
  /** Two actions in one map, or two maps in one asset, declared the same name. */
  duplicateName: "IGX-0810",
} as const;

/**
 * The union of the codes the `InputErrorCode` table declares.
 *
 * @public
 */
export type InputErrorCode = (typeof InputErrorCode)[keyof typeof InputErrorCode];

/**
 * The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
 * Context keys appear in braces, matching the core table's convention.
 *
 * @public
 */
export const INPUT_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  "IGX-0801": "{action} is not an action of any enabled map.",
  "IGX-0802": "{processor} is not a known input processor.",
  "IGX-0803": "{path} is not a valid binding path.",
  "IGX-0804": "{map} is not a registered action map.",
  "IGX-0805": "{file} is not an ignifx.inputactions document this build can read.",
  "IGX-0806": "{composite} is not a known binding composite.",
  "IGX-0807": "An interactive rebind of {action} is already listening.",
  "IGX-0808": "{file} is not an ignifx.inputoverrides document this build can read.",
  "IGX-0809": "Pointer lock needs a DOM canvas; this app has none.",
  "IGX-0810": "{name} is declared twice in {scope}.",
});

/**
 * Options accepted by {@link inputError}: the same subset of `IgnifxErrorOptions` this package uses.
 *
 * @public
 */
export interface InputErrorOptions {
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
 * @remarks
 * `IgnifxError`'s `code` parameter is the open template type `IGX-${number}`, so an `IGX-08##`
 * literal from the `InputErrorCode` table is accepted without an assertion.
 *
 * @param code - The code from the `InputErrorCode` table.
 * @param message - The actionable development sentence.
 * @param options - Context identifiers, a remedy hint, and the wrapped cause.
 * @returns The error to throw or to reject with.
 *
 * @example
 * ```ts
 * throw inputError(InputErrorCode.unknownActionMap, "UI is not a registered action map.", {
 *   context: { map: "UI" },
 * });
 * ```
 *
 * @public
 */
export function inputError(code: InputErrorCode, message: string, options?: InputErrorOptions): IgnifxError {
  return new IgnifxError(code, message, {
    ...(options?.context === undefined ? {} : { context: options.context }),
    ...(options?.hint === undefined ? {} : { hint: options.hint }),
    ...(options?.cause === undefined ? {} : { cause: options.cause }),
  });
}
