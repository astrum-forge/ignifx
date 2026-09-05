import { CoreErrorCode, type ErrorCode } from "./error-codes.js";

/**
 * The identifiers that make a failure actionable: entity and component uids, asset keys, layer
 * names, extension names. Values are primitives so the whole record survives being sent to a
 * devtools panel or a log sink without cloning engine objects.
 *
 * @public
 */
export type ErrorContext = Readonly<Record<string, string | number | boolean | null>>;

/**
 * How much of an error is spelled out in `Error.message`.
 *
 * @remarks
 * `"development"` writes the full sentence, the context values, and the hint. `"production"` keeps
 * the code and the *names* of the context keys and drops every value and the prose, so shipped
 * games neither leak content paths nor pay for message strings (`CONSTITUTION.md` §3.9). The
 * structured `code`, `context`, and `hint` properties are populated in both modes.
 *
 * @public
 */
export type ErrorFormatMode = "development" | "production";

/**
 * Options accepted by {@link IgnifxError}. Extends the standard `ErrorOptions`, so `cause` keeps
 * the original failure when an error is wrapped.
 *
 * @public
 */
export interface IgnifxErrorOptions extends ErrorOptions {
  /** Identifiers that locate the failure. Defaults to an empty record. */
  readonly context?: ErrorContext;
  /** One sentence telling the developer what to do about it. Defaults to `null`. */
  readonly hint?: string | null;
  /** How verbose `message` should be. Defaults to `"development"`. */
  readonly mode?: ErrorFormatMode;
}

/** Shared empty context so the common case allocates nothing. */
const EMPTY_CONTEXT: ErrorContext = {};

/**
 * Builds the `Error.message` of an {@link IgnifxError}.
 *
 * @remarks
 * Development messages read `IGX-0201: Mover requires Rigidbody. [entity=01J…] Hint: add it.`
 * Production messages read `IGX-0201 [entity]` — enough to look the code up in the registry and to
 * know which identifiers the `context` property carries, with no prose in the bundle.
 *
 * @param code - The stable diagnostic code.
 * @param message - The actionable development sentence.
 * @param context - Identifiers that locate the failure.
 * @param hint - A remedy sentence, or `null`.
 * @param mode - Whether to format for development or production.
 * @returns The formatted message.
 *
 * @example
 * ```ts
 * formatErrorMessage("IGX-0303", "Enemy is not a declared layer.", { layer: "Enemy" }, null, "production");
 * // "IGX-0303 [layer]"
 * ```
 *
 * @public
 */
export function formatErrorMessage(
  code: ErrorCode,
  message: string,
  context: ErrorContext,
  hint: string | null,
  mode: ErrorFormatMode,
): string {
  const keys = Object.keys(context);
  if (mode === "production") {
    return keys.length === 0 ? code : `${code} [${keys.join(", ")}]`;
  }
  let formatted = `${code}: ${message}`;
  if (keys.length > 0) {
    const parts: string[] = [];
    for (const key of keys) {
      parts.push(`${key}=${String(context[key] ?? null)}`);
    }
    formatted += ` [${parts.join(", ")}]`;
  }
  if (hint !== null && hint.length > 0) {
    formatted += ` Hint: ${hint}`;
  }
  return formatted;
}

/**
 * The error every ignifx API throws for misuse (`CONSTITUTION.md` §3.9). It always carries a stable
 * `IGX-####` `code` and the `context` identifiers needed to find the offending object,
 * so a production build can compact the human-readable half without losing meaning.
 *
 * @example
 * ```ts
 * try {
 *   world.instantiate(scene);
 * } catch (error) {
 *   if (isIgnifxError(error) && error.code === CoreErrorCode.sceneNotLoaded) {
 *     await scene.load();
 *   }
 * }
 * ```
 *
 * @public
 */
export class IgnifxError extends Error {
  /** The stable diagnostic code for this failure. */
  readonly code: ErrorCode;

  /** Identifiers that locate the failure (entity uid, component type id, asset key, …). */
  readonly context: ErrorContext;

  /** One sentence telling the developer how to fix it, or `null` when there is nothing to add. */
  readonly hint: string | null;

  /**
   * Creates an ignifx error.
   *
   * @param code - The stable `IGX-####` code for the failure.
   * @param message - An actionable description of what went wrong, used in development mode.
   * @param options - Context, hint, format mode, and the standard `cause`.
   */
  constructor(code: ErrorCode, message: string, options?: IgnifxErrorOptions) {
    const context = options?.context ?? EMPTY_CONTEXT;
    const hint = options?.hint ?? null;
    super(formatErrorMessage(code, message, context, hint, options?.mode ?? "development"), options);
    this.name = "IgnifxError";
    this.code = code;
    this.context = context;
    this.hint = hint;
  }
}

/**
 * Narrows an unknown value — a `catch` binding, a rejected promise, a signal payload — to an
 * {@link IgnifxError}.
 *
 * @param value - The value to test.
 * @returns `true` when the value is an ignifx error produced by this copy of `@ignifx/core`.
 *
 * @example
 * ```ts
 * app.onError.connect((report) => {
 *   if (isIgnifxError(report.error)) {
 *     console.warn(report.error.code, report.error.context);
 *   }
 * });
 * ```
 *
 * @public
 */
export function isIgnifxError(value: unknown): value is IgnifxError {
  return value instanceof IgnifxError;
}

/**
 * The default branch of an exhaustive `switch` (coding standards §5.2). The compiler rejects the
 * call as soon as a new union member is left unhandled, and at runtime it throws rather than
 * falling through silently.
 *
 * @param value - The value the type system proved impossible.
 * @param what - What was being switched over, for the message.
 * @throws IgnifxError with code `IGX-1505`; the function never returns.
 *
 * @example
 * ```ts
 * switch (level) {
 *   case "debug":
 *     return 10;
 *   default:
 *     return assertNever(level, "log level");
 * }
 * ```
 *
 * @public
 */
export function assertNever(value: never, what: string): never {
  throw new IgnifxError(CoreErrorCode.unreachableCase, `Unreachable case reached for ${what}.`, {
    context: { what, value: String(value) },
  });
}
