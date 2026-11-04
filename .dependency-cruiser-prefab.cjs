// @ts-check
/**
 * Keeps `@ignifx/core/prefab` (packages/core/src/prefab.ts) free of Babylon Lite: tools such as the
 * editor's main process load it to edit scene and prefab files without a renderer. Run by
 * `pnpm deps` after the main config.
 *
 * It is a config of its own because a reachability rule follows every edge, and the main config
 * keeps `import type` edges for its layering rules. Types are erased at build time, so this one
 * drops them (`tsPreCompilationDeps: false`) and checks only what the entry loads at run time.
 */
/* global module, require */
// The main config's options (resolution, tsconfig, exclusions) apply here unchanged.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const base = require("./.dependency-cruiser.cjs");

module.exports = {
  forbidden: [
    {
      name: "prefab-entry-lite-free",
      comment:
        "Nothing `@ignifx/core/prefab` loads may reach Babylon Lite or the adapter (`src/lite/**`). " +
        "Keep prefab-file helpers free of world and render code, or export them from `@ignifx/core` only.",
      severity: "error",
      from: { path: "^packages/core/src/prefab[.]ts$" },
      to: { path: ["^packages/core/src/lite/", "@babylonjs/lite"], reachable: true },
    },
  ],
  options: { ...base.options, tsPreCompilationDeps: false },
};
