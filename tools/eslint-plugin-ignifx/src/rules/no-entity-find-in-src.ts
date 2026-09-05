import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { staticKeyName } from "../util/ast.ts";
import { createRule } from "../util/create-rule.ts";
import { matchesAnyGlob } from "../util/path-match.ts";
import type { TSESTree } from "@typescript-eslint/utils";

/**
 * `02-scene-graph.md` §4 and `03-scripting-and-components.md` §8: `entity.find("Body/Arm.L")` is
 * deliberately fragile — renaming or reparenting an entity silently breaks it at runtime. Serialized
 * `entityRef`/`componentRef` fields and `requireComponent` are the supported way to link objects.
 * `find` stays available for tests, examples, and tools, where a hard-coded path is the point.
 *
 * The rule keys off a *string-literal* argument, which is what separates `Entity.find(path)` from
 * `Array.prototype.find(callback)` without needing type information.
 */

/** Files the rule applies to. */
const DEFAULT_INCLUDE = ["**/src/**"] as const;

/** Files where a hard-coded entity path is legitimate. */
const DEFAULT_EXCLUDE = [
  "**/*.test.ts",
  "**/*.browser.test.ts",
  "**/examples/**",
  "**/tools/**",
  "**/scripts/**",
] as const;

/** Options accepted by `ignifx/no-entity-find-in-src`. */
export interface Options {
  /** Globs of files the rule applies to. */
  readonly include: readonly string[];
  /** Globs of files exempted from the rule. */
  readonly exclude: readonly string[];
}

/**
 * The `entity.find(path)` rule.
 *
 * @internal
 */
export const noEntityFindInSrc = createRule<[Partial<Options>?], "entityFind">({
  name: "no-entity-find-in-src",
  meta: {
    type: "problem",
    docs: {
      description: 'Forbid path-based `entity.find("…")` outside tests, examples, and tools (02-scene-graph.md §4).',
    },
    messages: {
      entityFind:
        "Path-based lookup breaks when an entity is renamed or reparented. Declare an `entityRef`/" +
        "`componentRef` field, or cache the result of `requireComponent` in `awake`; `find` is allowed " +
        "only in tests, examples, and tools (02-scene-graph.md §4).",
    },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          include: { type: "array", items: { type: "string" } },
          exclude: { type: "array", items: { type: "string" } },
        },
      },
    ],
    defaultOptions: [{}],
  },
  create(context, [option]) {
    const include = option?.include ?? DEFAULT_INCLUDE;
    const exclude = option?.exclude ?? DEFAULT_EXCLUDE;

    const filename = context.filename;
    if (!matchesAnyGlob(filename, include) || matchesAnyGlob(filename, exclude)) {
      return {};
    }

    return {
      CallExpression: (node: TSESTree.CallExpression): void => {
        const { callee } = node;
        if (callee.type !== AST_NODE_TYPES.MemberExpression) {
          return;
        }
        if (staticKeyName(callee.property, callee.computed) !== "find") {
          return;
        }
        const [argument] = node.arguments;
        if (argument === undefined) {
          return;
        }
        const isPathLiteral =
          (argument.type === AST_NODE_TYPES.Literal && typeof argument.value === "string") ||
          argument.type === AST_NODE_TYPES.TemplateLiteral;
        if (isPathLiteral) {
          context.report({ node, messageId: "entityFind" });
        }
      },
    };
  },
});
