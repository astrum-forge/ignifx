import { defineConfig } from "tsdown";

/**
 * ESM-only library build. Declarations are emitted from `isolatedDeclarations`, so this build
 * needs neither the TypeScript programmatic API nor the TS 6 shim (ADR-0007).
 *
 * Two entries: the page half (`.`), which runs in the scene view and the play view, and the Vite
 * plugin (`./vite`), which runs in the dev server's Node process. They share no module, so the
 * build emits no shared chunk; `hash: false` keeps the file names stable either way.
 */
export default defineConfig({
  entry: ["src/index.ts", "src/vite.ts"],
  format: ["esm"],
  platform: "neutral",
  fixedExtension: false,
  hash: false,
  target: "es2023",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  treeshake: true,
  dts: { isolatedDeclarations: true },
  // Peer dependencies are resolved by the consumer, never bundled (00-overview.md §2.1). Bundling
  // `@ignifx/core` would give the scene view a second copy of `Component`.
  // The plugin half imports Node built-ins, which Vite provides; the neutral platform does not know them.
  deps: { neverBundle: ["@babylonjs/lite", "@ignifx/core", "@ignifx/vite-plugin", "vite", /^node:/u] },
});
