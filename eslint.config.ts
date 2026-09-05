import { configs as jsConfigs } from "@eslint/js";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import { flatConfigs as importXConfigs } from "eslint-plugin-import-x";
import { configs as jsdocConfigs } from "eslint-plugin-jsdoc";
import { configs as tsConfigs } from "typescript-eslint";
import type { ESLint, Linter, Rule } from "eslint";

/**
 * ESLint runs only the rules Oxlint lacks (coding standards §6): JSDoc completeness, import
 * cycle/order checks, and the custom `ignifx/*` rules. Everything else is Oxlint's job.
 *
 * ADR-0007: typescript-eslint resolves the `typescript` alias, which points at
 * `@typescript/typescript6` — the TS 6 programmatic API — not at the TS 7 native compiler.
 */

/**
 * Builds a placeholder rule. The real implementations land in Phase 1 (engineering plan).
 *
 * @param description - What the finished rule will enforce.
 * @returns A rule module that reports nothing.
 */
function placeholder(description: string): Rule.RuleModule {
  return {
    meta: {
      type: "problem",
      docs: { description: `${description} (implemented in Phase 1)` },
      schema: [],
    },
    create: () => ({}),
  };
}

const ignifxPlugin: ESLint.Plugin = {
  meta: { name: "eslint-plugin-ignifx", version: "0.0.0" },
  rules: {
    "no-lite-outside-adapter": placeholder("@babylonjs/lite may only be imported from src/lite/**"),
    "no-module-side-effects": placeholder("modules must not execute code at import time"),
    "no-async-lifecycle": placeholder("lifecycle callbacks must not be async"),
    "signal-connect-owner": placeholder("Signal.connect inside a Script must pass an owner"),
    "no-entity-find-in-src": placeholder("entity.find() is allowed only in tests, examples and tools"),
    "schema-field-shadowing": placeholder("class fields must not shadow schema field names"),
    "error-code-format": placeholder("IgnifxError codes match IGX-#### in a registered range"),
    "no-console": placeholder("console calls are allowed only in the logging sink"),
  },
};

const config: Linter.Config[] = [
  {
    ignores: [
      "**/dist/**",
      "**/.tsbuild/**",
      "**/.tsbuild-test/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.turbo/**",
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
    plugins: { ignifx: ignifxPlugin },
    settings: {
      "import-x/resolver-next": [createTypeScriptImportResolver({ alwaysTryTypes: true })],
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
    files: ["scripts/**/*.{ts,mjs}"],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
  {
    name: "ignifx/tests-and-tooling",
    files: ["**/test/**/*.ts", "**/*.test.ts", "scripts/**/*.{ts,mjs}", "**/*.config.ts", "eslint.config.ts"],
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
];

export default config;
