import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { createRule } from "../util/create-rule.ts";
import { matchesAnyGlob } from "../util/path-match.ts";
import type { TSESTree } from "@typescript-eslint/utils";

/**
 * Coding standards §5.5: no `console.*` outside the logging sink — engine and game code report
 * through `app.log`/`ctx.log`, which routes to `app.diagnostics` and the devtools overlay and can be
 * silenced per level in production.
 *
 * Oxlint's `no-console` already reports the same shape. This rule exists because the *allowlist* is
 * a repository decision (coding standards §6 lists `ignifx/no-console` in the ESLint table): the
 * sink itself, build scripts, CLI entry points, configuration files, repository tooling, and the
 * website are all legitimate places to write to stdout, and that list lives here as rule options
 * rather than as a growing pile of Oxlint overrides.
 */

/** Files where writing to the console is the intended behaviour. */
const DEFAULT_ALLOW = [
  "**/src/log/**",
  "**/scripts/**",
  "**/bin.ts",
  "**/*.config.ts",
  "**/tools/**",
  "**/website/**",
  "**/test/**",
  "**/*.test.ts",
  "**/*.browser.test.ts",
] as const;

/** Options accepted by `ignifx/no-console`. */
export interface Options {
  /** Globs of files allowed to call `console`. */
  readonly allow: readonly string[];
}

/**
 * The console rule.
 *
 * @internal
 */
export const noConsole = createRule<[Partial<Options>?], "console">({
  name: "no-console",
  meta: {
    type: "problem",
    docs: {
      description: "Forbid `console` outside the logging sink and the repository's tooling (coding standards §5.5).",
    },
    messages: {
      console:
        "`console` is only available in the logging sink. Report through `app.log`/`ctx.log` so the " +
        "message reaches diagnostics and the devtools overlay (coding standards §5.5).",
    },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          allow: { type: "array", items: { type: "string" } },
        },
      },
    ],
    defaultOptions: [{}],
  },
  create(context, [option]) {
    const allow = option?.allow ?? DEFAULT_ALLOW;
    if (matchesAnyGlob(context.filename, allow)) {
      return {};
    }

    return {
      MemberExpression: (node: TSESTree.MemberExpression): void => {
        if (node.object.type === AST_NODE_TYPES.Identifier && node.object.name === "console") {
          context.report({ node, messageId: "console" });
        }
      },
    };
  },
});
