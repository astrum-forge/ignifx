import { defineConfig } from "tsdown";

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
  // Nothing is resolved at runtime from another package yet; entries are added here with the
  // dependencies that Phase 2 introduces.
  deps: { neverBundle: [] },
});
