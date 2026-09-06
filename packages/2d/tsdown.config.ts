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
  // Peer and runtime dependencies are resolved by the consumer, never bundled
  // (00-overview.md §2.1). `@babylonjs/lite` is the adapter boundary and belongs here too
  // (00-overview.md §3) — without it the whole of Lite lands in this package's bundle.
  deps: { neverBundle: ["@babylonjs/lite", "@ignifx/core"] },
});
