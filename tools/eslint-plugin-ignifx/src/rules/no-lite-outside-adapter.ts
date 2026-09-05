import { AST_NODE_TYPES } from "@typescript-eslint/utils";
import { createRule } from "../util/create-rule.ts";
import { isUnderDirectory, matchesAnyGlob } from "../util/path-match.ts";
import type { TSESTree } from "@typescript-eslint/utils";

/**
 * `CONSTITUTION.md` §3.4 and coding standards §4: `@babylonjs/lite` and the native/WASM physics
 * libraries move fast and are isolated behind an adapter directory. Only `src/lite/**` (and, for
 * an extension, its own adapter directory) may import them; everything else goes through the
 * documented `.lite` escape hatches.
 */

/** Packages that may only be reached from an adapter directory. */
const DEFAULT_PACKAGES = ["@babylonjs/lite", "@babylonjs/havok", "@dimforge/rapier2d-compat"] as const;

/** Directory suffixes that count as adapter directories. */
const DEFAULT_ADAPTER_DIRECTORIES = ["src/lite/"] as const;

/**
 * Adapter *compatibility* tests are the one place outside the adapter that legitimately imports
 * Lite: they pin the Lite behaviour the adapter relies on (`00-overview.md` §3, upgrade procedure),
 * which they can only do by calling Lite directly. `*.test.ts` on its own is not enough of a
 * signal, so the allowance is scoped to files under a package's `test/` directory — plus the
 * fixture modules such a test imports, which are part of the same never-published test code.
 */
const DEFAULT_ALLOW = ["**/test/**/*.test.ts", "**/test/**/*.browser.test.ts", "**/test/**/fixtures/**"] as const;

/** Options accepted by `ignifx/no-lite-outside-adapter`. */
export interface Options {
  /** Package names (prefix-matched, so subpaths count) that are adapter-only. */
  readonly packages: readonly string[];
  /** Directory suffixes whose files may import those packages. */
  readonly adapterDirectories: readonly string[];
  /** Globs of files exempted from the rule entirely. */
  readonly allow: readonly string[];
}

/**
 * Reports whether an import specifier names one of the restricted packages, counting subpaths.
 *
 * @param specifier - The module specifier as written in the source.
 * @param packages - The restricted package names.
 * @returns The matched package name, or `null`.
 */
function restrictedPackage(specifier: string, packages: readonly string[]): string | null {
  return packages.find((name) => specifier === name || specifier.startsWith(`${name}/`)) ?? null;
}

/**
 * The adapter-boundary rule.
 *
 * @internal
 */
export const noLiteOutsideAdapter = createRule<[Partial<Options>?], "liteOutsideAdapter">({
  name: "no-lite-outside-adapter",
  meta: {
    type: "problem",
    docs: {
      description:
        "Restrict `@babylonjs/lite` and native physics packages to the adapter directory (CONSTITUTION.md §3.4).",
    },
    messages: {
      liteOutsideAdapter:
        "'{{package}}' may only be imported from an adapter directory ({{directories}}). " +
        "Add what you need to the adapter with a test and TSDoc, then import it from there " +
        "(CONSTITUTION.md §3.4, coding standards §4).",
    },
    schema: [
      {
        type: "object",
        additionalProperties: false,
        properties: {
          packages: { type: "array", items: { type: "string" } },
          adapterDirectories: { type: "array", items: { type: "string" } },
          allow: { type: "array", items: { type: "string" } },
        },
      },
    ],
    defaultOptions: [{}],
  },
  create(context, [option]) {
    const packages = option?.packages ?? DEFAULT_PACKAGES;
    const adapterDirectories = option?.adapterDirectories ?? DEFAULT_ADAPTER_DIRECTORIES;
    const allow = option?.allow ?? DEFAULT_ALLOW;

    const filename = context.filename;
    if (isUnderDirectory(filename, adapterDirectories) || matchesAnyGlob(filename, allow)) {
      return {};
    }

    /**
     * Reports the source node when it names a restricted package.
     *
     * @param source - The module-specifier node of an import, re-export, or `require` call.
     */
    function check(source: TSESTree.Node | null): void {
      if (source === null || source.type !== AST_NODE_TYPES.Literal || typeof source.value !== "string") {
        return;
      }
      const matched = restrictedPackage(source.value, packages);
      if (matched === null) {
        return;
      }
      context.report({
        node: source,
        messageId: "liteOutsideAdapter",
        data: { package: matched, directories: adapterDirectories.join(", ") },
      });
    }

    return {
      ImportDeclaration: (node): void => {
        check(node.source);
      },
      ExportAllDeclaration: (node): void => {
        check(node.source);
      },
      ExportNamedDeclaration: (node): void => {
        check(node.source);
      },
      ImportExpression: (node): void => {
        check(node.source);
      },
      CallExpression: (node): void => {
        if (node.callee.type !== AST_NODE_TYPES.Identifier || node.callee.name !== "require") {
          return;
        }
        const [first] = node.arguments;
        check(first ?? null);
      },
    };
  },
});
