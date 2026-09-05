import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { isScriptLikeClass, staticKeyName } from "../util/ast.ts";
import { createRule } from "../util/create-rule.ts";
import type { TSESLint, TSESTree } from "@typescript-eslint/utils";

/**
 * `02-scene-graph.md` §8: `Signal.connect` takes an optional `owner`, and the connection is
 * auto-disconnected when that owner is destroyed. A script that connects without an owner keeps the
 * handler — and the whole script instance — alive after its entity is gone, which is the classic
 * leak this rule exists to prevent. Scripts should always pass `owner: this`.
 */

/** Base classes whose subclasses are subject to the rule. */
const DEFAULT_BASE_CLASSES = ["Script", "Component"] as const;

/** Options accepted by `ignifx/signal-connect-owner`. */
export interface Options {
  /** Names of base classes (directly, or via `<Base>.define(...)`) that put a class in scope. */
  readonly baseClasses: readonly string[];
}

/** The messages this rule can report. */
type MessageId = "missingOwner" | "ownerNotDeclared";

/**
 * The `Signal.connect` owner rule.
 *
 * @internal
 */
export const signalConnectOwner = createRule<[Partial<Options>?], MessageId>({
  name: "signal-connect-owner",
  meta: {
    type: "problem",
    fixable: "code",
    docs: {
      description:
        "Require `owner` on `Signal.connect` calls made inside a script or component (02-scene-graph.md §8).",
    },
    messages: {
      missingOwner:
        "`connect` inside a script or component must pass an owner so the connection is dropped when " +
        "the owner is destroyed. Add `{ owner: this }` (02-scene-graph.md §8).",
      ownerNotDeclared:
        "The options passed to `connect` have no `owner`, so this connection outlives the script that " +
        "made it. Add `owner: this` (02-scene-graph.md §8).",
    },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          baseClasses: { type: "array", items: { type: "string" } },
        },
      },
    ],
    defaultOptions: [{}],
  },
  create(context, [option]) {
    const baseClasses = option?.baseClasses ?? DEFAULT_BASE_CLASSES;
    const classStack: boolean[] = [];

    /**
     * Pushes a class onto the stack, remembering whether it is a script or component.
     *
     * @param node - The class being entered.
     */
    function enterClass(node: TSESTree.ClassDeclaration | TSESTree.ClassExpression): void {
      classStack.push(isScriptLikeClass(node, baseClasses));
    }

    /** Pops the innermost class off the stack. */
    function exitClass(): void {
      classStack.pop();
    }

    return {
      ClassDeclaration: enterClass,
      "ClassDeclaration:exit": exitClass,
      ClassExpression: enterClass,
      "ClassExpression:exit": exitClass,
      CallExpression: (node): void => {
        if (classStack.at(-1) !== true) {
          return;
        }
        const { callee } = node;
        if (callee.type !== AST_NODE_TYPES.MemberExpression) {
          return;
        }
        if (staticKeyName(callee.property, callee.computed) !== "connect") {
          return;
        }
        const [handler, options] = node.arguments;
        if (handler === undefined || handler.type === AST_NODE_TYPES.SpreadElement) {
          return;
        }
        if (options === undefined) {
          context.report({
            node,
            messageId: "missingOwner",
            fix: (fixer: TSESLint.RuleFixer): TSESLint.RuleFix => fixer.insertTextAfter(handler, ", { owner: this }"),
          });
          return;
        }
        if (options.type !== AST_NODE_TYPES.ObjectExpression) {
          // `connect(handler, options)` — the options are computed elsewhere, so the rule cannot
          // tell whether they carry an owner. Reporting here would be a guess.
          return;
        }
        const hasSpread = options.properties.some((property) => property.type === AST_NODE_TYPES.SpreadElement);
        if (hasSpread) {
          return;
        }
        const hasOwner = options.properties.some(
          (property) =>
            property.type === AST_NODE_TYPES.Property && staticKeyName(property.key, property.computed) === "owner",
        );
        if (!hasOwner) {
          context.report({ node: options, messageId: "ownerNotDeclared" });
        }
      },
    };
  },
});
