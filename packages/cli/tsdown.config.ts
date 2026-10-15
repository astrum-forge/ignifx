import { defineConfig } from "tsdown";
import manifest from "./package.json" with { type: "json" };

/**
 * ESM-only Node build with two entries: the library barrel and the `create-ignifx` executable.
 * Declarations are emitted from `isolatedDeclarations`, so this build needs neither the TypeScript
 * programmatic API nor the TS 6 shim (ADR-0007). tsdown's shebang handling keeps the `#!` line of
 * `src/bin.ts` and marks `dist/bin.js` executable.
 *
 * `fixedExtension` is off and `hash` is off deliberately: `platform: "node"` would otherwise emit
 * `.mjs` (the package is already `"type": "module"`, so `.js` is unambiguous and matches every
 * other package) and would give the shared chunk a content hash, which changes the published file
 * list on every build.
 */
export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts", "src/ignifx/bin.ts"],
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
  // Stamps `VERSION` (`src/version.ts`) with the version Changesets wrote into `package.json`.
  define: { IGNIFX_BUILD_VERSION: JSON.stringify(manifest.version) },
});
