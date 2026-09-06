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
 * ## Why the check is a name heuristic and not a type check
 *
 * The rule keys off a *string-literal* argument, which is what separates `Entity.find(path)` from
 * `Array.prototype.find(callback)` without needing type information. The repository's ESLint pass
 * runs `typescript-eslint`'s **non**-type-checked configuration (`eslint.config.ts` uses
 * `configs.recommended` and sets no `projectService`), so no rule here has a `TypeChecker` to ask
 * "is this receiver an `Entity`?", and adding one would make `pnpm lint` build a program.
 *
 * That leaves one real false positive, and it is a *named* one: a service lookup by name. Two
 * `find(name: string)` methods exist in the engine — `Entity.find` and `@ignifx/input`'s
 * `InputActionsView.find` (`packages/input/src/actions/actions-view.ts`) — and the second is the
 * documented way for a script to resolve an action, so `actions.find("jump")` in a template's
 * `src/scripts/` was reported as a scene-graph mistake (recorded as a Phase 7 follow-up in
 * `docs/plan/engineering-plan.md`). {@link Options.allowedReceivers} names the receivers whose
 * `find` is a by-name lookup rather than a path lookup, and an array literal is skipped outright.
 *
 * ## Why the exclude list no longer carries `scripts/`
 *
 * `**\/scripts\/**` was meant to exempt the repository's own tooling under `/scripts/`, but the glob
 * matches any `scripts` segment at any depth — including `templates/<name>/src/scripts/`, which is
 * exactly where game scripts live and exactly where the rule is supposed to apply. Repository
 * tooling needs no exemption at all: `include` is `**\/src\/**` and no `scripts/` directory in this
 * workspace sits under a `src/`, so those files were never in scope to begin with.
 */

/** Files the rule applies to. */
const DEFAULT_INCLUDE = ["**/src/**"] as const;

/**
 * Files where a hard-coded entity path is legitimate.
 *
 * @remarks
 * Deliberately without a `scripts/` entry — see the module comment.
 */
const DEFAULT_EXCLUDE = ["**/*.test.ts", "**/*.browser.test.ts", "**/examples/**", "**/tools/**"] as const;

/**
 * Receivers whose `find(name)` looks a service entry up by name rather than walking the scene tree.
 *
 * @remarks
 * `actions` is `app.input.actions` (`InputActionsView.find`), the documented way to resolve an
 * `InputAction`. `assets` is here for the same reason and by symmetry: an address is a name, not a
 * scene path, so a by-address lookup must never read as a scene-graph mistake.
 */
const DEFAULT_ALLOWED_RECEIVERS = ["actions", "assets"] as const;

/** Options accepted by `ignifx/no-entity-find-in-src`. */
export interface Options {
  /** Globs of files the rule applies to. */
  readonly include: readonly string[];
  /** Globs of files exempted from the rule. */
  readonly exclude: readonly string[];
  /**
   * Receiver names whose `find(…)` is a by-name lookup, not a scene path. The name compared is the
   * last identifier of the receiver expression, so `actions` covers `app.input.actions.find("…")`
   * as well as a local `const actions = …`.
   */
  readonly allowedReceivers: readonly string[];
}

/**
 * The name a receiver expression ends in, which is what {@link Options.allowedReceivers} matches.
 *
 * @param receiver - The expression before `.find`.
 * @returns `app.input.actions` → `"actions"`, `actions` → `"actions"`, `getActions()` →
 * `"getActions"`, and `null` for anything with no static tail name.
 */
function receiverName(receiver: TSESTree.Node): string | null {
  if (receiver.type === AST_NODE_TYPES.Identifier) {
    return receiver.name;
  }
  if (receiver.type === AST_NODE_TYPES.MemberExpression) {
    return staticKeyName(receiver.property, receiver.computed);
  }
  if (receiver.type === AST_NODE_TYPES.CallExpression) {
    return receiverName(receiver.callee);
  }
  return null;
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
        "only in tests, examples, and tools (02-scene-graph.md §4). If this is a by-name service " +
        "lookup rather than a scene path, add its receiver to `allowedReceivers`.",
    },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          include: { type: "array", items: { type: "string" } },
          exclude: { type: "array", items: { type: "string" } },
          allowedReceivers: { type: "array", items: { type: "string" } },
        },
      },
    ],
    defaultOptions: [{}],
  },
  create(context, [option]) {
    const include = option?.include ?? DEFAULT_INCLUDE;
    const exclude = option?.exclude ?? DEFAULT_EXCLUDE;
    const allowedReceivers = option?.allowedReceivers ?? DEFAULT_ALLOWED_RECEIVERS;

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
        // An array literal's `find` takes a predicate; a string there is a type error, not a path.
        if (callee.object.type === AST_NODE_TYPES.ArrayExpression) {
          return;
        }
        const receiver = receiverName(callee.object);
        if (receiver !== null && allowedReceivers.some((allowed) => allowed === receiver)) {
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
