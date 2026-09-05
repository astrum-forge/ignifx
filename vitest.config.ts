import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/**
 * Two projects (coding standards §10):
 * - `node`    — headless unit tests on Lite's null engine (`*.test.ts`).
 * - `browser` — real Chromium with WebGPU for GPU-touching code (`*.browser.test.ts`).
 *
 * Chromium flags, measured on macOS arm64 with Playwright 1.63's bundled headless shell
 * (2026-09-05): `--enable-unsafe-webgpu` alone is enough to get `navigator.gpu` **and** an adapter;
 * `--use-webgpu-adapter=swiftshader` pins the software adapter so results do not depend on the
 * host GPU, which is what coding standards §10 requires of CI. Adding `--enable-features=Vulkan`
 * and `--use-angle=vulkan` — the documented Linux combination — makes `requestAdapter()` return
 * `null` on macOS, so those two flags belong in the Linux CI job, not here.
 *
 * WebGPU also needs a secure context: an adapter is only handed out on `http://127.0.0.1`/https
 * pages, never on `about:blank`.
 *
 * `coverage` is a root-level option in Vitest 5 — it is ignored inside `projects[].test`.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["packages/*/src/**/*.ts"],
      // GPU-only adapter files cannot be reached from Node. They are covered by the `browser`
      // project (`*.browser.test.ts`); measuring them in the unit run would report a number no
      // unit test can move.
      exclude: ["packages/*/src/lite/render.ts"],
      // CONSTITUTION.md §6.2: 80% floor everywhere, 90% for core. The glob entry keeps the core
      // floor in place once packages that only owe 80% are added.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        "packages/core/src/**": {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
      },
    },
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["packages/*/test/**/*.test.ts"],
          exclude: ["**/*.browser.test.ts", "**/node_modules/**", "**/dist/**"],
        },
      },
      {
        test: {
          name: "browser",
          include: ["packages/*/test/**/*.browser.test.ts"],
          exclude: ["**/node_modules/**", "**/dist/**"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              // `launchOptions`, not `launch` — the provider silently ignores unknown keys.
              launchOptions: {
                args: ["--enable-unsafe-webgpu", "--use-webgpu-adapter=swiftshader"],
              },
            }),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
