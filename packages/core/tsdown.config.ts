import { defineConfig } from "tsdown";
import manifest from "./package.json" with { type: "json" };

/**
 * ESM-only library build. Declarations are emitted from `isolatedDeclarations`, so this build
 * needs neither the TypeScript programmatic API nor the TS 6 shim (ADR-0007).
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "neutral",
  target: "es2023",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  treeshake: true,
  dts: { isolatedDeclarations: true },
  // Stamps `VERSION` (`src/app/version.ts`) with the version Changesets wrote into `package.json`.
  define: { IGNIFX_BUILD_VERSION: JSON.stringify(manifest.version) },
  // The adapter boundary is a runtime dependency, never bundled (00-overview.md §3).
  deps: { neverBundle: ["@babylonjs/lite"] },
});
