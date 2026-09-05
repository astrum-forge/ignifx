import { defineConfig } from "tsdown";

/**
 * A bundled ESM build, for `pnpm build` parity with `packages/*`.
 *
 * Nothing depends on the output: `package.json#exports` points at `src/index.ts` so that
 * `eslint.config.ts` — which ESLint loads before any build has run — can import the plugin from
 * source (Node strips the types). The build exists to prove the sources bundle cleanly and to keep
 * `turbo run build` uniform across the workspace.
 */
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "es2023",
  outDir: "dist",
  sourcemap: true,
  clean: true,
  treeshake: true,
  // No declarations: nothing imports the bundle (`exports` points at `src/index.ts`), and generating
  // them would need the TypeScript programmatic API, which `packages/*` deliberately avoids by
  // emitting from `isolatedDeclarations` instead (ADR-0007).
  dts: false,
  // ESLint and typescript-eslint are the host's, not the plugin's, exactly as they are at runtime.
  deps: { neverBundle: ["eslint", "@typescript-eslint/utils"] },
});
