import { IgnifxError } from "@ignifx/core";
import type { ErrorContext } from "@ignifx/core";

/**
 * The diagnostic codes `@ignifx/devtools` owns. `docs/architecture/15-devtools-and-diagnostics.md`
 * §1 gives the whole `15xx` range to devtools, and `@ignifx/core` already spends `IGX-1501`–
 * `IGX-1549` on `app.diagnostics` and the logging front end, so this package starts at
 * **`IGX-1550`** and owns `IGX-1550`–`IGX-1599`.
 *
 * The table lives here rather than in `@ignifx/core`'s `CoreErrorCode`: an extension owns its own
 * codes and hands them to the app through `ExtensionContext.registerErrorCodes`
 * (`docs/architecture/04-extensions.md` §3).
 */

/**
 * Every diagnostic code `@ignifx/devtools` can throw or log, keyed by an intention-revealing name
 * so call sites read as prose and the compiler catches typos (coding standards §5.2).
 *
 * @example
 * ```ts
 * throw devtoolsError(DevtoolsErrorCode.unknownPanel, "scene-graph is not a devtools panel.", {
 *   context: { panel: "scene-graph" },
 * });
 * ```
 *
 * @public
 */
export const DevtoolsErrorCode = {
  /** A second `devtools()` extension was registered on one app. */
  duplicateExtension: "IGX-1550",
  /** A DOM-only member was reached on a host with no document, and did nothing. */
  headlessNoOp: "IGX-1551",
  /** `app.devtools.panel(name)` was given a name no panel is registered under. */
  unknownPanel: "IGX-1552",
  /** An inspector write targeted a field the schema marks `readonly` or `hidden`. */
  readonlyField: "IGX-1553",
  /** An inspector write could not be decoded into the field's value type. */
  fieldWriteFailed: "IGX-1554",
  /** The Assets panel's reload button was pressed on an asset service with no reload entry point. */
  assetReloadUnsupported: "IGX-1555",
  /** `reloadScenes` is on but neither core nor `app.hotReload` can re-instantiate a scene. */
  sceneReloadUnsupported: "IGX-1556",
  /** "Select in world" was used on an app whose renderer cannot pick. */
  pickUnavailable: "IGX-1557",
} as const;

/**
 * The union of the codes the `DevtoolsErrorCode` table declares.
 *
 * @public
 */
export type DevtoolsErrorCode = (typeof DevtoolsErrorCode)[keyof typeof DevtoolsErrorCode];

/**
 * The one-line message template of every code, as `ExtensionContext.registerErrorCodes` wants it.
 * Context keys appear in braces, matching the core table's convention.
 *
 * @public
 */
export const DEVTOOLS_ERROR_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  "IGX-1550": "The devtools() extension is already registered on this app.",
  "IGX-1551": "{member} did nothing: this app has no DOM to mount the devtools overlay in.",
  "IGX-1552": "{panel} is not a devtools panel.",
  "IGX-1553": "{field} of {component} is not editable in the inspector.",
  "IGX-1554": "{field} of {component} could not be set from the inspector: {reason}.",
  "IGX-1555": "{address} cannot be reloaded: app.assets has no reload entry point in this build.",
  "IGX-1556": "{scene} cannot be reloaded: neither app.hotReload nor app.world can re-instantiate it.",
  "IGX-1557": "Select in world did nothing: this app's renderer cannot pick.",
});

/**
 * Options accepted by {@link devtoolsError}: the same subset of `IgnifxErrorOptions` this package
 * uses.
 *
 * @public
 */
export interface DevtoolsErrorOptions {
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
 * @param code - The code from the `DevtoolsErrorCode` table.
 * @param message - The actionable development sentence.
 * @param options - Context identifiers, a remedy hint, and the wrapped cause.
 * @returns The error to throw or to report.
 *
 * @example
 * ```ts
 * throw devtoolsError(DevtoolsErrorCode.unknownPanel, "physics2d is not a devtools panel.", {
 *   context: { panel: "physics2d" },
 * });
 * ```
 *
 * @public
 */
export function devtoolsError(code: DevtoolsErrorCode, message: string, options?: DevtoolsErrorOptions): IgnifxError {
  return new IgnifxError(code, message, {
    ...(options?.context === undefined ? {} : { context: options.context }),
    ...(options?.hint === undefined ? {} : { hint: options.hint }),
    ...(options?.cause === undefined ? {} : { cause: options.cause }),
  });
}
