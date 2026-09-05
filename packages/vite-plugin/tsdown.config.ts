import { defineConfig } from "tsdown";

/**
 * ESM-only Node build. The plugin runs inside Vite's Node process — it reads the asset tree, hashes
 * files, and emits bundle entries — so `platform: "node"` is what the output must be built for.
 * Declarations are emitted from `isolatedDeclarations`, so this build needs neither the TypeScript
 * programmatic API nor the TS 6 shim (ADR-0007).
 *
 * `fixedExtension` and `hash` are off for the same reason as in `@ignifx/cli`: the package is
 * already `"type": "module"`, so `.js` is unambiguous, and a content-hashed chunk name would change
 * the published file list on every build.
 *
 * `vite` is a peer dependency and is externalized by tsdown automatically; nothing else is resolved
 * at runtime from another package.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  fixedExtension: false,
  hash: false,
  target: "es2023",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  treeshake: true,
  dts: { isolatedDeclarations: true },
  deps: { neverBundle: [] },
});
