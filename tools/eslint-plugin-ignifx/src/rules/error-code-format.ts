import { calleeName, staticStringValue } from "../util/ast.ts";
import { createRule } from "../util/create-rule.ts";
import type { TSESTree } from "@typescript-eslint/utils";

/**
 * `CONSTITUTION.md` §3.9 and `15-devtools-and-diagnostics.md` §1: every misuse throws an
 * `IgnifxError` carrying a stable `IGX-####` code, because production builds compact the message
 * and keep only the code. The four digits are a registered two-digit subsystem range followed by a
 * two-digit ordinal: `01` lifecycle, `02` components, `03` scenes, `04` extensions, `05` assets,
 * `06` serialization, `07` rendering, `08` input, `09` physics, `10` audio, `11` 2D, `12` 3D,
 * `13` UI, `14` platform, `15` devtools, and `9x` reserved for third-party extensions.
 */

/** The prefix that marks a string as an ignifx diagnostic code. */
// The one place in the repository where a bare `IGX-` string is the prefix itself, not a code.
// eslint-disable-next-line ignifx/error-code-format -- this literal defines the prefix.
const CODE_PREFIX = "IGX-";

/** `IGX-` followed by exactly four digits — the shape, before the range is considered. */
const CODE_SHAPE = /^IGX-\d{4}$/u;

/** The shape plus a registered subsystem range (`01`–`15`) or the third-party range (`9x`). */
const REGISTERED_CODE = /^IGX-(?:0[1-9]|1[0-5]|9\d)\d\d$/u;

/**
 * Decides whether a bare string is meant to *be* a code rather than to *mention* one. A code never
 * contains whitespace, so `"IGX-0303 [layer]"` — a formatted message or a test expectation — is left
 * alone, while `"IGX-303"` is reported. A malformed code embedded inside a longer sentence is the
 * known false negative of that trade-off; codes passed to an error constructor are checked whatever
 * they look like, which is where it matters.
 *
 * @param value - The string value of a literal.
 * @returns `true` when the string should be validated as a code.
 */
function isCodeCandidate(value: string): boolean {
  return value.startsWith(CODE_PREFIX) && !/\s/u.test(value);
}

/** Constructors whose first argument is an error code. */
const DEFAULT_ERROR_CONSTRUCTORS = ["IgnifxError"] as const;

/** Options accepted by `ignifx/error-code-format`. */
export interface Options {
  /** Constructor names whose first string argument must be a valid code. */
  readonly errorConstructors: readonly string[];
}

/** The messages this rule can report. */
type MessageId = "badFormat" | "badFormatInError" | "unregisteredRange" | "unregisteredRangeInError";

/**
 * The error-code format rule.
 *
 * @internal
 */
export const errorCodeFormat = createRule<[Partial<Options>?], MessageId>({
  name: "error-code-format",
  meta: {
    type: "problem",
    docs: {
      description:
        "Require ignifx diagnostic codes to read `IGX-####` in a registered range (15-devtools-and-diagnostics.md §1).",
    },
    messages: {
      badFormat:
        "`{{code}}` is not a diagnostic code. Codes read `IGX-` followed by exactly four digits, " +
        "for example `IGX-0501` (15-devtools-and-diagnostics.md §1).",
      unregisteredRange:
        "`{{code}}` uses the unregistered range `{{range}}xx`. Registered ranges are 01–15 for engine " +
        "subsystems and 9x for third-party extensions (15-devtools-and-diagnostics.md §1).",
      badFormatInError:
        "The first argument of `{{constructor}}` is the diagnostic code and must read `IGX-` followed " +
        "by exactly four digits; `{{code}}` does not (CONSTITUTION.md §3.9).",
      unregisteredRangeInError:
        "`{{constructor}}` was given the code `{{code}}`, whose range `{{range}}xx` is not registered. " +
        "Registered ranges are 01–15 for engine subsystems and 9x for third-party extensions " +
        "(15-devtools-and-diagnostics.md §1).",
    },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          errorConstructors: { type: "array", items: { type: "string" } },
        },
      },
    ],
    defaultOptions: [{}],
  },
  create(context, [option]) {
    const errorConstructors = option?.errorConstructors ?? DEFAULT_ERROR_CONSTRUCTORS;
    const reportedByConstructor = new Set<TSESTree.Node>();

    /**
     * Reports a code string, choosing the message that says where the code was found.
     *
     * @param node - The literal holding the code.
     * @param code - The code text.
     * @param constructorName - The constructor the code was passed to, or `null` for a bare literal.
     */
    function reportCode(node: TSESTree.Node, code: string, constructorName: string | null): void {
      const range = code.slice(CODE_PREFIX.length, CODE_PREFIX.length + 2);
      if (!CODE_SHAPE.test(code)) {
        context.report({
          node,
          messageId: constructorName === null ? "badFormat" : "badFormatInError",
          data: { code, constructor: constructorName ?? "" },
        });
        return;
      }
      if (!REGISTERED_CODE.test(code)) {
        context.report({
          node,
          messageId: constructorName === null ? "unregisteredRange" : "unregisteredRangeInError",
          data: { code, range, constructor: constructorName ?? "" },
        });
      }
    }

    return {
      NewExpression: (node): void => {
        const name = calleeName(node.callee);
        if (name === null || !errorConstructors.some((constructorName) => constructorName === name)) {
          return;
        }
        const [first] = node.arguments;
        if (first === undefined) {
          return;
        }
        const code = staticStringValue(first);
        if (code === null) {
          // A `ErrorCode.foo` reference is checked where the registry declares it.
          return;
        }
        reportedByConstructor.add(first);
        reportCode(first, code, name);
      },
      Literal: (node): void => {
        if (reportedByConstructor.has(node) || typeof node.value !== "string") {
          return;
        }
        if (isCodeCandidate(node.value)) {
          reportCode(node, node.value, null);
        }
      },
      TemplateLiteral: (node): void => {
        if (reportedByConstructor.has(node)) {
          return;
        }
        const value = staticStringValue(node);
        if (value !== null && isCodeCandidate(value)) {
          reportCode(node, value, null);
        }
      },
    };
  },
});
