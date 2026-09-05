import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { isScriptLikeClass, staticKeyName } from "../util/ast.ts";
import { createRule } from "../util/create-rule.ts";
import type { TSESTree } from "@typescript-eslint/utils";

/**
 * ADR-0010 and coding standards §5.3: promise continuations resume as microtasks after the whole
 * ignifx frame function has unwound, i.e. outside any lifecycle phase, so an `async` callback
 * silently breaks the deterministic ordering `CONSTITUTION.md` §3.1 promises. Frame-sequenced work
 * belongs in a generator coroutine; `async`/`await` stays the right tool for I/O.
 */

/**
 * The lifecycle callbacks the scheduler invokes, from `03-scripting-and-components.md` §2 plus the
 * component and hot-reload hooks of §7 and `15-devtools-and-diagnostics.md`.
 */
const LIFECYCLE_CALLBACKS = [
  "awake",
  "onEnable",
  "start",
  "fixedUpdate",
  "update",
  "lateUpdate",
  "onDisable",
  "onDestroy",
  "onCollisionEnter",
  "onCollisionStay",
  "onCollisionExit",
  "onTriggerEnter",
  "onTriggerExit",
  "onApplicationPause",
  "onApplicationFocus",
  "onAttach",
  "onDetach",
  "onHotReload",
] as const;

/** Base classes whose subclasses (directly or via `<Base>.define(...)`) are subject to the rule. */
const DEFAULT_BASE_CLASSES = ["Script", "Component"] as const;

/** Options accepted by `ignifx/no-async-lifecycle`. */
export interface Options {
  /** Additional callback names to treat as lifecycle callbacks. */
  readonly extraCallbacks: readonly string[];
  /**
   * Base classes that put a class in scope. A class outside this scope — the `App` implementation
   * with its `start(): Promise<void>`, say — may name a method `start` freely; only scripts and
   * components (or classes declaring `static typeId`) are lifecycle receivers.
   */
  readonly baseClasses: readonly string[];
}

/** The messages this rule can report. */
type MessageId = "asyncLifecycle" | "promiseLifecycle";

/**
 * Reports whether a return-type annotation says `Promise<…>`.
 *
 * @param returnType - The annotation node, when the member has one.
 * @returns `true` when the annotated type is a reference to `Promise`.
 */
function returnsPromise(returnType: TSESTree.TSTypeAnnotation | undefined): boolean {
  const annotation = returnType?.typeAnnotation;
  if (annotation === undefined || annotation.type !== AST_NODE_TYPES.TSTypeReference) {
    return false;
  }
  const { typeName } = annotation;
  return typeName.type === AST_NODE_TYPES.Identifier && typeName.name === "Promise";
}

/**
 * The `async` lifecycle rule.
 *
 * @internal
 */
export const noAsyncLifecycle = createRule<[Partial<Options>?], MessageId>({
  name: "no-async-lifecycle",
  meta: {
    type: "problem",
    docs: {
      description: "Forbid `async` or promise-returning lifecycle callbacks on components and scripts (ADR-0010).",
    },
    messages: {
      asyncLifecycle:
        "`{{name}}` is a lifecycle callback and must not be `async`: its continuation resumes as a " +
        "microtask after the frame, outside any phase. Use a coroutine (`this.startCoroutine`) for " +
        "frame-sequenced work, and `await` only inside it (ADR-0010).",
      promiseLifecycle:
        "`{{name}}` is a lifecycle callback and must not return a promise: the scheduler ignores the " +
        "result, so the work escapes the frame. Use a coroutine (`this.startCoroutine`) instead " +
        "(ADR-0010).",
    },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          extraCallbacks: { type: "array", items: { type: "string" } },
          baseClasses: { type: "array", items: { type: "string" } },
        },
      },
    ],
    defaultOptions: [{}],
  },
  create(context, [option]) {
    const callbacks: readonly string[] = [...LIFECYCLE_CALLBACKS, ...(option?.extraCallbacks ?? [])];
    const baseClasses = option?.baseClasses ?? DEFAULT_BASE_CLASSES;
    /** Whether each enclosing class, innermost last, is a script or component. */
    const classStack: boolean[] = [];

    /**
     * Records whether the class being entered is in scope.
     *
     * @param node - The class declaration or expression.
     */
    function enterClass(node: TSESTree.ClassDeclaration | TSESTree.ClassExpression): void {
      classStack.push(isScriptLikeClass(node, baseClasses));
    }

    /** Pops the innermost class. */
    function exitClass(): void {
      classStack.pop();
    }

    /**
     * Checks one class member.
     *
     * @param node - A method definition, or a property definition holding a function.
     */
    function checkMember(
      node: TSESTree.MethodDefinition | TSESTree.PropertyDefinition | TSESTree.TSAbstractMethodDefinition,
    ): void {
      if (classStack.at(-1) !== true) {
        return;
      }
      const name = staticKeyName(node.key, node.computed);
      if (name === null || !callbacks.some((callback) => callback === name)) {
        return;
      }
      const value = node.value;
      if (
        value === null ||
        (value.type !== AST_NODE_TYPES.FunctionExpression &&
          value.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
          value.type !== AST_NODE_TYPES.TSEmptyBodyFunctionExpression)
      ) {
        return;
      }
      if (value.async) {
        context.report({ node: node.key, messageId: "asyncLifecycle", data: { name } });
        return;
      }
      if (returnsPromise(value.returnType)) {
        context.report({ node: node.key, messageId: "promiseLifecycle", data: { name } });
      }
    }

    return {
      ClassDeclaration: enterClass,
      ClassExpression: enterClass,
      "ClassDeclaration:exit": exitClass,
      "ClassExpression:exit": exitClass,
      MethodDefinition: checkMember,
      PropertyDefinition: checkMember,
      TSAbstractMethodDefinition: checkMember,
    };
  },
});
