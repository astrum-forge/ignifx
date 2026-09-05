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
 * `channel: "chromium"` is **required**, not a preference (measured 2026-09-05, Phase 2 spike
 * S2.1). Playwright's default headless browser is the old `chrome-headless-shell`, which has no
 * compositor: a WebGPU canvas renders for two or three presented frames and then the device is lost
 * with `A valid external Instance reference no longer exists`. It happens with raw WebGPU as well
 * as through Babylon Lite, and on the default adapter as well as on SwiftShader, so it is the
 * runner and not the renderer. The full Chromium binary (`channel: "chromium"`, Playwright's new
 * headless mode) sustains the loop indefinitely, which is what every multi-frame rendering test
 * needs.
 *
 * `coverage` is a root-level option in Vitest 5 — it is ignored inside `projects[].test`.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["packages/*/src/**/*.ts", "tools/*/src/**/*.ts"],
      // GPU-only files cannot be reached from Node. They are covered by the `browser` project
      // (`*.browser.test.ts`); measuring them in the unit run would report a number no unit test
      // can move. `src/lite/gpu/**` is the adapter's device-only half (Phase 2, R1) and
      // `src/render/gpu/**` is the render layer's, under the same rule: a module lives there when
      // every line of it needs `engine._device`.
      exclude: ["packages/*/src/lite/render.ts", "packages/*/src/lite/gpu/**", "packages/*/src/render/gpu/**"],
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
          include: ["packages/*/test/**/*.test.ts", "tools/*/test/**/*.test.ts", "benchmarks/**/*.test.ts"],
          exclude: ["**/*.browser.test.ts", "**/node_modules/**", "**/dist/**"],
        },
      },
      {
        test: {
          name: "browser",
          include: ["packages/*/test/**/*.browser.test.ts"],
          // `vitest bench` adds a benchmark variant to every project (`benchmarkOnly` overrides
          // `benchmark.enabled`), and a browser variant of the headless scenes would only measure
          // Chromium's coarse timer. An empty `include` is what actually leaves it with no files.
          benchmark: { include: [] },
          exclude: ["**/node_modules/**", "**/dist/**"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              // `launchOptions`, not `launch` — the provider silently ignores unknown keys.
              launchOptions: {
                channel: "chromium",
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
