import { defineConfig } from "vitest/config";

// The website's tests live in their own project rather than in the root `vitest.config.ts`, because
// the root `node` project is what `pnpm test` runs with coverage thresholds over `packages/*/src`
// — a site that emits HTML has nothing to contribute to that number, and adding it would only make
// the root run depend on `website/dist` existing. Run them with
// `pnpm --filter @ignifx/website build && pnpm --filter @ignifx/website test`, which is the order
// `.github/workflows/website.yml` uses.
export default defineConfig({
  test: {
    name: "website",
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
