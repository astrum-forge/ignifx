import { errorCodeFormat } from "./rules/error-code-format.ts";
import { noAsyncLifecycle } from "./rules/no-async-lifecycle.ts";
import { noConsole } from "./rules/no-console.ts";
import { noEntityFindInSrc } from "./rules/no-entity-find-in-src.ts";
import { noLiteOutsideAdapter } from "./rules/no-lite-outside-adapter.ts";
import { noModuleSideEffects } from "./rules/no-module-side-effects.ts";
import { schemaFieldShadowing } from "./rules/schema-field-shadowing.ts";
import { signalConnectOwner } from "./rules/signal-connect-owner.ts";
import type { TSESLint } from "@typescript-eslint/utils";

/**
 * `eslint-plugin-ignifx` — the eight repository rules of coding standards §6 that Oxlint cannot
 * express. The plugin is workspace-internal: it is never published, and `eslint.config.ts` is its
 * only consumer.
 *
 * @packageDocumentation
 */

/**
 * The package version. The plugin is `private`, so there is no release to drift from; ESLint only
 * uses this string in `--print-config` output and cache keys.
 */
const PLUGIN_VERSION = "0.0.0";

/**
 * Every rule this plugin provides, keyed by the name used in `eslint.config.ts`.
 *
 * @internal
 */
export const rules = {
  "error-code-format": errorCodeFormat,
  "no-async-lifecycle": noAsyncLifecycle,
  "no-console": noConsole,
  "no-entity-find-in-src": noEntityFindInSrc,
  "no-lite-outside-adapter": noLiteOutsideAdapter,
  "no-module-side-effects": noModuleSideEffects,
  "schema-field-shadowing": schemaFieldShadowing,
  "signal-connect-owner": signalConnectOwner,
} as const;

/**
 * The flat-config block that turns every rule on as an error.
 *
 * @internal
 */
const recommended: TSESLint.FlatConfig.Config = {
  name: "ignifx/recommended",
  files: ["**/*.ts", "**/*.mts"],
  rules: {
    "ignifx/error-code-format": "error",
    "ignifx/no-async-lifecycle": "error",
    "ignifx/no-console": "error",
    "ignifx/no-entity-find-in-src": "error",
    "ignifx/no-lite-outside-adapter": "error",
    "ignifx/no-module-side-effects": "error",
    "ignifx/schema-field-shadowing": "error",
    "ignifx/signal-connect-owner": "error",
  },
};

/**
 * The plugin object ESLint consumes.
 *
 * @remarks
 * Coding standards §4 bans default exports except for configuration; an ESLint plugin is
 * configuration, and ESLint's own convention is a default export, so this is that exception. A
 * named {@link rules} export is provided as well for tests.
 *
 * @internal
 */
const plugin = {
  meta: { name: "eslint-plugin-ignifx", version: PLUGIN_VERSION },
  rules,
  configs: { recommended },
} satisfies TSESLint.FlatConfig.Plugin;

export default plugin;
