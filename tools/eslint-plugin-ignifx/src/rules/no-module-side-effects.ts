import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { calleeName } from "../util/ast.ts";
import { createRule } from "../util/create-rule.ts";
import { matchesAnyGlob } from "../util/path-match.ts";
import type { TSESTree } from "@typescript-eslint/utils";

/**
 * `CONSTITUTION.md` §3.5 and coding standards §4: no module executes code, registers globals, or
 * allocates at import time. Module scope holds declarations and immutable constants only; caches
 * are created lazily inside functions and registration happens in `App` construction or an
 * extension's `register`. The rule is what makes `sideEffects: false` honest, which is what lets
 * bundlers drop unused engine modules (`CONSTITUTION.md` §2.5).
 */

/** Files the rule applies to. */
const DEFAULT_INCLUDE = ["**/src/**"] as const;

/**
 * Files exempted from the rule. `bin.ts` is a program entry point whose whole job is to run;
 * tests construct fixtures at module scope by design; and `tools/**` holds Node processes run once
 * by the toolchain, not tree-shakable engine modules (the same reasoning that exempts them from
 * `ignifx/no-console`).
 */
const DEFAULT_EXCLUDE = ["**/bin.ts", "**/*.test.ts", "**/*.browser.test.ts", "**/tools/**"] as const;

/**
 * Calls that declare rather than execute. `Script.define`/`Component.define` build a base class
 * from a schema (ADR-0004 replaced decorators with them) and `defineExtension`/`defineConfig`/
 * `defineSchema` only shape an object literal: none of them touch the DOM, allocate engine state,
 * or register a global, so they are safe at module scope.
 */
const DEFAULT_ALLOW_CALLEES = [
  "defineExtension",
  "defineConfig",
  "defineSchema",
  // `createServiceKey` returns `Object.freeze({ serviceName })` and nothing else, and its own TSDoc
  // (`packages/core/src/app/types.ts`) documents a module-scope `export const` as the way to
  // declare a service key. It is a declarative constant, not an import-time side effect.
  "createServiceKey",
  "Component.define",
  "Script.define",
] as const;

/** Typed-array constructors: coding standards §4 calls typed-array constants explicitly fine. */
const TYPED_ARRAY_CONSTRUCTORS = [
  "BigInt64Array",
  "BigUint64Array",
  "Float32Array",
  "Float64Array",
  "Int16Array",
  "Int32Array",
  "Int8Array",
  "Uint16Array",
  "Uint32Array",
  "Uint8Array",
  "Uint8ClampedArray",
] as const;

/** Statement types that branch or loop at module scope, i.e. run logic at import time. */
const CONTROL_FLOW_STATEMENTS = [
  AST_NODE_TYPES.BlockStatement,
  AST_NODE_TYPES.DoWhileStatement,
  AST_NODE_TYPES.ForInStatement,
  AST_NODE_TYPES.ForOfStatement,
  AST_NODE_TYPES.ForStatement,
  AST_NODE_TYPES.IfStatement,
  AST_NODE_TYPES.SwitchStatement,
  AST_NODE_TYPES.TryStatement,
  AST_NODE_TYPES.WhileStatement,
] as const;

/** Options accepted by `ignifx/no-module-side-effects`. */
export interface Options {
  /** Globs of files the rule applies to. */
  readonly include: readonly string[];
  /** Globs of files exempted from the rule. */
  readonly exclude: readonly string[];
  /** Dotted callee names that may be called in a module-scope initialiser. */
  readonly allowCallees: readonly string[];
}

/** The messages this rule can report. */
type MessageId = "controlFlowStatement" | "sideEffectInitializer" | "sideEffectStatement" | "topLevelAwait";

/**
 * Reports whether a call or `new` expression is one of the declarative forms module scope allows.
 *
 * @param node - The call or `new` expression.
 * @param allowCallees - Dotted callee names from the options.
 * @returns `true` when the expression itself is allowed; its arguments are still inspected.
 */
function isAllowedCall(
  node: TSESTree.CallExpression | TSESTree.NewExpression,
  allowCallees: readonly string[],
): boolean {
  const name = calleeName(node.callee);
  if (name === null) {
    return false;
  }
  if (node.type === AST_NODE_TYPES.NewExpression) {
    // `new Map()`/`new Set()` are deliberately NOT allowed: coding standards §4 says caches are
    // created lazily inside functions, so a module-scope collection is exactly the smell.
    return TYPED_ARRAY_CONSTRUCTORS.some((constructorName) => constructorName === name);
  }
  return (
    name === "Symbol" ||
    name === "Symbol.for" ||
    name === "Object.freeze" ||
    allowCallees.some((allowed) => allowed === name)
  );
}

/**
 * Walks up from a node to the `Program`, deciding whether it sits in a module-scope initialiser.
 *
 * @param node - The call, `new`, or `await` expression under inspection.
 * @param allowCallees - Dotted callee names from the options.
 * @returns `true` when the expression is evaluated at import time inside a variable initialiser or
 * an `export default` expression, and no reportable ancestor already covers it.
 */
function isReportableInitializerPosition(node: TSESTree.Node, allowCallees: readonly string[]): boolean {
  let inInitializer = false;
  let child: TSESTree.Node = node;
  let parent = node.parent;
  while (parent !== undefined) {
    if (isExecutionBoundaryOrStatement(parent)) {
      return false;
    }
    if (parent.type === AST_NODE_TYPES.AwaitExpression) {
      // The `await` is reported instead; reporting the awaited call as well would double up.
      return false;
    }
    if (
      (parent.type === AST_NODE_TYPES.CallExpression || parent.type === AST_NODE_TYPES.NewExpression) &&
      !isAllowedCall(parent, allowCallees)
    ) {
      // The outermost offending expression is the one worth reporting.
      return false;
    }
    if (parent.type === AST_NODE_TYPES.VariableDeclarator && parent.init === child) {
      inInitializer = true;
    }
    if (parent.type === AST_NODE_TYPES.ExportDefaultDeclaration) {
      inInitializer = true;
    }
    if (parent.type === AST_NODE_TYPES.Program) {
      return inInitializer;
    }
    child = parent;
    parent = parent.parent;
  }
  return false;
}

/**
 * Reports whether an ancestor ends the walk: either code that runs later (a function, class body or
 * static block) or a statement that the `Program` handler already reports as a whole.
 *
 * @param node - The ancestor being crossed.
 * @returns `true` when the walk must stop without reporting.
 */
function isExecutionBoundaryOrStatement(node: TSESTree.Node): boolean {
  return (
    node.type === AST_NODE_TYPES.FunctionDeclaration ||
    node.type === AST_NODE_TYPES.FunctionExpression ||
    node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    node.type === AST_NODE_TYPES.ClassBody ||
    node.type === AST_NODE_TYPES.StaticBlock ||
    node.type === AST_NODE_TYPES.TSModuleDeclaration ||
    node.type === AST_NODE_TYPES.ExpressionStatement
  );
}

/**
 * The import-time side-effect rule.
 *
 * @internal
 */
export const noModuleSideEffects = createRule<[Partial<Options>?], MessageId>({
  name: "no-module-side-effects",
  meta: {
    type: "problem",
    docs: {
      description: "Forbid executing code at module scope so every module is import-time pure (CONSTITUTION.md §3.5).",
    },
    messages: {
      sideEffectStatement:
        "Top-level statements run at import time. Move this into `App` construction, an extension's " +
        "`register`, or a function (CONSTITUTION.md §3.5, coding standards §4).",
      controlFlowStatement:
        "Branching or looping at module scope runs at import time and defeats tree shaking. " +
        "Move it into a function (CONSTITUTION.md §3.5).",
      sideEffectInitializer:
        "`{{expression}}` at module scope allocates or runs code at import time. Module scope holds " +
        "declarations and immutable constants only; create caches lazily inside functions " +
        "(coding standards §4).",
      topLevelAwait:
        "Top-level `await` makes importing this module asynchronous and ordering-dependent. " +
        "Await inside a function instead (CONSTITUTION.md §3.5).",
    },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          include: { type: "array", items: { type: "string" } },
          exclude: { type: "array", items: { type: "string" } },
          allowCallees: { type: "array", items: { type: "string" } },
        },
      },
    ],
    defaultOptions: [{}],
  },
  create(context, [option]) {
    const include = option?.include ?? DEFAULT_INCLUDE;
    const exclude = option?.exclude ?? DEFAULT_EXCLUDE;
    const allowCallees = option?.allowCallees ?? DEFAULT_ALLOW_CALLEES;

    const filename = context.filename;
    if (!matchesAnyGlob(filename, include) || matchesAnyGlob(filename, exclude)) {
      return {};
    }

    /**
     * Reports a top-level statement that is not a declaration.
     *
     * @param statement - One entry of `Program.body`, already unwrapped from any `export`.
     */
    function checkStatement(statement: TSESTree.Node): void {
      if (CONTROL_FLOW_STATEMENTS.some((type) => type === statement.type)) {
        context.report({ node: statement, messageId: "controlFlowStatement" });
        return;
      }
      if (statement.type !== AST_NODE_TYPES.ExpressionStatement) {
        return;
      }
      const { expression } = statement;
      if (expression.type === AST_NODE_TYPES.Literal) {
        // A directive prologue such as `"use strict"` is not a side effect.
        return;
      }
      if (expression.type === AST_NODE_TYPES.AwaitExpression) {
        context.report({ node: statement, messageId: "topLevelAwait" });
        return;
      }
      if (
        (expression.type === AST_NODE_TYPES.CallExpression || expression.type === AST_NODE_TYPES.NewExpression) &&
        isAllowedCall(expression, allowCallees)
      ) {
        return;
      }
      context.report({ node: statement, messageId: "sideEffectStatement" });
    }

    /**
     * Reports a call or `new` expression evaluated by a module-scope initialiser.
     *
     * @param node - The call or `new` expression.
     */
    function checkCall(node: TSESTree.CallExpression | TSESTree.NewExpression): void {
      if (isAllowedCall(node, allowCallees) || !isReportableInitializerPosition(node, allowCallees)) {
        return;
      }
      context.report({
        node,
        messageId: "sideEffectInitializer",
        data: { expression: context.sourceCode.getText(node.callee) },
      });
    }

    return {
      Program: (node): void => {
        for (const statement of node.body) {
          if (
            statement.type === AST_NODE_TYPES.ExportNamedDeclaration ||
            statement.type === AST_NODE_TYPES.ExportDefaultDeclaration
          ) {
            continue;
          }
          checkStatement(statement);
        }
      },
      CallExpression: checkCall,
      NewExpression: checkCall,
      AwaitExpression: (node): void => {
        if (isReportableInitializerPosition(node, allowCallees)) {
          context.report({ node, messageId: "topLevelAwait" });
        }
      },
    };
  },
});
