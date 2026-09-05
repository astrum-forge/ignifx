import { CORE_ERROR_MESSAGES, CoreErrorCode, isValidErrorCode, type ErrorCode } from "./error-codes.js";
import { IgnifxError } from "./ignifx-error.js";

/**
 * What the registry knows about one code.
 *
 * @public
 */
export interface ErrorCodeDescription {
  /** The code itself. */
  readonly code: ErrorCode;
  /** The one-line message template; context keys appear in braces. */
  readonly message: string;
  /** The extension that owns the code (`"@ignifx/core"` for the codes in `CoreErrorCode`). */
  readonly owner: string;
}

/**
 * The per-app table of every diagnostic code the running game can produce. Devtools resolves codes
 * to messages through it, and `ExtensionContext.registerErrorCodes` writes to it.
 *
 * @remarks
 * There is one registry per {@link App}, never a module-level one (`CONSTITUTION.md` §3.5, §3.6):
 * two apps in one test process must not see each other's extensions.
 *
 * @public
 */
export interface ErrorCodeRegistry {
  /**
   * Adds a block of codes.
   *
   * @param codes - A map of `IGX-####` code to one-line message template.
   * @param owner - The extension name recorded as the owner of every code in the block.
   * @throws IgnifxError with code `IGX-1502` when a key is not a valid code, or `IGX-1501` when a
   * code is already registered.
   */
  register(codes: Readonly<Record<string, string>>, owner: string): void;

  /**
   * Looks a code up.
   *
   * @param code - The code to describe.
   * @returns The description, or `null` when the code was never registered — an unknown code is an
   * expected absence, not a failure (coding standards §5.5).
   */
  describe(code: string): ErrorCodeDescription | null;

  /**
   * Reports whether a code is known.
   *
   * @param code - The code to test.
   * @returns `true` when the code has been registered.
   */
  isRegistered(code: string): boolean;
}

/** The owner recorded for the codes `@ignifx/core` ships with. */
const CORE_OWNER = "@ignifx/core";

class ErrorCodeRegistryImpl implements ErrorCodeRegistry {
  readonly #entries = new Map<string, ErrorCodeDescription>();

  register(codes: Readonly<Record<string, string>>, owner: string): void {
    for (const entry of Object.entries(codes)) {
      const code = entry[0];
      if (!isValidErrorCode(code)) {
        throw new IgnifxError(
          CoreErrorCode.malformedErrorCode,
          `${code} is not a valid IGX-#### code in a known range.`,
          { context: { code, owner }, hint: "Codes are IGX- plus four digits in an allocated subsystem range." },
        );
      }
      const existing = this.#entries.get(code);
      if (existing !== undefined) {
        throw new IgnifxError(CoreErrorCode.duplicateErrorCode, `The error code ${code} is already registered.`, {
          context: { code, owner, existingOwner: existing.owner },
          hint: "Third-party extensions allocate codes in the IGX-9### range.",
        });
      }
      this.#entries.set(code, { code, message: entry[1], owner });
    }
  }

  describe(code: string): ErrorCodeDescription | null {
    return this.#entries.get(code) ?? null;
  }

  isRegistered(code: string): boolean {
    return this.#entries.has(code);
  }
}

/**
 * Creates an error code registry pre-loaded with the codes `@ignifx/core` owns.
 *
 * @returns A registry owned by one app.
 *
 * @example
 * ```ts
 * const registry = createErrorCodeRegistry();
 * registry.register({ "IGX-9001": "The {thing} was not spawned." }, "game/spawner");
 * registry.describe("IGX-0701")?.message; // "WebGPU is not available in this environment."
 * ```
 *
 * @public
 */
export function createErrorCodeRegistry(): ErrorCodeRegistry {
  const registry = new ErrorCodeRegistryImpl();
  registry.register(CORE_ERROR_MESSAGES, CORE_OWNER);
  return registry;
}
