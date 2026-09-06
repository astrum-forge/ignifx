import { configs as jsConfigs } from "@eslint/js";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import { flatConfigs as importXConfigs } from "eslint-plugin-import-x";
import { configs as jsdocConfigs } from "eslint-plugin-jsdoc";
import { configs as tsConfigs } from "typescript-eslint";
import ignifx from "eslint-plugin-ignifx";
import type { ESLint, Linter } from "eslint";

/**
 * ESLint runs only the rules Oxlint lacks (coding standards §6): JSDoc completeness, import
 * cycle/order checks, and the custom `ignifx/*` rules. Everything else is Oxlint's job.
 *
 * ADR-0007: typescript-eslint resolves the `typescript` alias, which points at
 * `@typescript/typescript6` — the TS 6 programmatic API — not at the TS 7 native compiler.
 */

const config: Linter.Config[] = [
  {
    ignores: [
      "**/dist/**",
      "**/.tsbuild/**",
      "**/.tsbuild-test/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.turbo/**",
      // Electron desktop build output: `out/**` is what `electron-vite build` writes and
      // `release/**` what `electron-builder` writes. Both are bundled JavaScript, and linting them
      // reports tens of thousands of JSDoc failures against code nobody wrote.
      "**/out/**",
      "**/release/**",
      // The pack-time copy of `templates/*`, rebuilt by `packages/cli`'s `prepack`.
      "packages/cli/templates/**",
    ],
  },
  jsConfigs.recommended,
  ...tsConfigs.recommended,
  jsdocConfigs["flat/recommended-typescript-error"],
  importXConfigs.recommended,
  importXConfigs.typescript,
  {
    name: "ignifx/gap-rules",
    files: ["**/*.ts", "**/*.mts"],
    plugins: {
      // typescript-eslint types a rule against its own `RuleContext` and a config against its own
      // `FlatConfig.Config`; ESLint 10's `RuleDefinition` and `ConfigObject` do not structurally
      // accept either, even though the runtime object is exactly what ESLint expects and loads.
      // This is the boundary between two typings of one object (coding standards §5.2), and the
      // only way across it is an assertion.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see above.
      ignifx: ignifx as unknown as ESLint.Plugin,
    },
    settings: {
      "import-x/resolver-next": [createTypeScriptImportResolver({ alwaysTryTypes: true })],
      // The Vite plugin's virtual modules exist only inside Vite; their types come from
      // `@ignifx/vite-plugin/client`, which the resolver cannot follow.
      "import-x/core-modules": ["virtual:ignifx/manifest", "virtual:ignifx/scripts"],
      // TSDoc and API Extractor require `@typeParam`; the plugin's default preference would
      // rewrite it to JSDoc's `@template` (CONSTITUTION.md §5.4).
      jsdoc: { tagNamePreference: { template: "typeParam" } },
    },
    rules: {
      // Oxlint owns everything typescript-eslint's recommended set duplicates.
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-redeclare": "off",

      // Gap rule 1 — public API documentation completeness (CONSTITUTION.md §5.4).
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          require: {
            ArrowFunctionExpression: true,
            ClassDeclaration: true,
            ClassExpression: true,
            FunctionDeclaration: true,
            MethodDefinition: true,
          },
          contexts: ["TSInterfaceDeclaration", "TSTypeAliasDeclaration"],
        },
      ],
      "jsdoc/require-description": ["error", { contexts: ["any"] }],
      "jsdoc/require-param-description": "error",
      "jsdoc/require-returns-description": "error",
      "jsdoc/no-types": "error",
      "jsdoc/tag-lines": "off",
      // TSDoc release tags and block tags API Extractor understands (CONSTITUTION.md §5.4).
      "jsdoc/check-tag-names": [
        "error",
        {
          definedTags: [
            "public",
            "beta",
            "alpha",
            "internal",
            "remarks",
            "packageDocumentation",
            "typeParam",
            "defaultValue",
            "sealed",
            "virtual",
            "override",
          ],
        },
      ],
      // TSDoc `@throws` carries prose, not a type annotation.
      "jsdoc/require-throws-type": "off",

      // Gap rule 2 — cycles and import hygiene (coding standards §4).
      "import-x/no-cycle": ["error", { maxDepth: Number.POSITIVE_INFINITY }],
      "import-x/no-self-import": "error",
      "import-x/no-useless-path-segments": "error",
      "import-x/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index", "type"],
          "newlines-between": "never",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],

      // Gap rule 3 — the ignifx custom rules (coding standards §6).
      "ignifx/no-lite-outside-adapter": "error",
      "ignifx/no-module-side-effects": "error",
      "ignifx/no-async-lifecycle": "error",
      "ignifx/signal-connect-owner": "error",
      "ignifx/no-entity-find-in-src": "error",
      "ignifx/schema-field-shadowing": "error",
      "ignifx/error-code-format": "error",
      "ignifx/no-console": "error",
    },
  },
  {
    name: "ignifx/node-scripts",
    files: ["**/scripts/**/*.{ts,mjs}"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
  {
    name: "ignifx/tests-and-tooling",
    files: ["**/test/**/*.ts", "**/*.test.ts", "**/scripts/**/*.{ts,mjs}", "**/*.config.ts", "eslint.config.ts"],
    rules: {
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-description": "off",
      "jsdoc/require-param": "off",
      "jsdoc/require-returns": "off",
    },
  },
  {
    // The website is an application, not a published package: it exports nothing (so the JSDoc
    // completeness rule has nothing to check) and renders at import time on purpose —
    // CONSTITUTION.md §3.5 governs published modules, not app entry points.
    name: "ignifx/website",
    files: ["website/**/*.ts"],
    rules: {
      "jsdoc/require-jsdoc": "off",
      "ignifx/no-module-side-effects": "off",
    },
  },
  {
    // The examples are applications for the same reason the website is: an example's entry point is
    // a `main.ts` that boots a game at import time, which is exactly what a reader is meant to copy.
    name: "ignifx/examples",
    files: ["examples/**/*.ts"],
    rules: {
      "jsdoc/require-jsdoc": "off",
      "ignifx/no-module-side-effects": "off",
    },
  },
  {
    // Templates are applications too: `create-ignifx` copies one as the user's starting point.
    name: "ignifx/templates",
    files: ["templates/**/*.ts"],
    rules: {
      "jsdoc/require-jsdoc": "off",
      "ignifx/no-module-side-effects": "off",
    },
  },
];

export default config;
