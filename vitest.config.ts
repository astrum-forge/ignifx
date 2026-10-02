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
 * and `--use-angle=vulkan` — the combination the plan named for Linux — makes `requestAdapter()`
 * return `null` on macOS. On Linux (measured 2026-09-06, Playwright's `v1.63.0-noble` image and
 * GitHub's ubuntu runner) the two base flags give an adapter and a device, but the first present
 * to a canvas destroys the device; `--enable-features=Vulkan --use-vulkan=swiftshader
 * --use-angle=swiftshader` keeps it alive, so `chromiumArgs` below switches on the platform.
 * `tests/visual/playwright.config.ts` carries the same switch; change both together (ADR-0009).
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
/** Every headless test file, across the `node`, `node-isolated`, and `perf` projects. */
const NODE_INCLUDE = [
  "packages/*/test/**/*.test.ts",
  "tools/*/test/**/*.test.ts",
  // The documentation harness (`scripts/**`) is tooling, not a package, so its tests live beside it
  // rather than under `packages/`.
  "scripts/test/**/*.test.ts",
  "benchmarks/**/*.test.ts",
];

const NODE_EXCLUDE = ["**/*.browser.test.ts", "**/node_modules/**", "**/dist/**"];

/**
 * Files that replace a module with `vi.mock`. The `node` project shares one module graph per
 * worker, where a mock either never applies or leaks into the next file, so these keep Vitest's
 * per-file isolation. A new `vi.mock` caller belongs here.
 */
const ISOLATED = [
  "packages/core/test/render/rebuild-serialisation.test.ts",
  // Everything that imports `test/support/electron-mock.ts`.
  "packages/electron/test/**/*.test.ts",
];

/**
 * Tests that assert a wall-clock or heap measurement, or build every app. They fail on a loaded
 * machine (`devtools-closed` and `spike-s6-1` went red on CI beside the unit suite in 2026-09), so
 * they are the `perf` project and run alone.
 */
const PERF = [
  "benchmarks/alloc.test.ts",
  "benchmarks/bundle-size.test.ts",
  "benchmarks/devtools-closed.test.ts",
  "packages/2d/test/lite/spike-s6-1-node.test.ts",
];

/** Chromium flags for a SwiftShader WebGPU adapter; the Linux half is explained above. */
const chromiumArgs: string[] =
  process.platform === "linux"
    ? [
        "--enable-unsafe-webgpu",
        "--use-webgpu-adapter=swiftshader",
        "--enable-features=Vulkan",
        "--use-vulkan=swiftshader",
        "--use-angle=swiftshader",
      ]
    : ["--enable-unsafe-webgpu", "--use-webgpu-adapter=swiftshader"];

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      // `text-summary`, not `text`: the per-file table is ~400 lines nobody reads in a terminal or a CI log;
      // the lcov file carries the detail (the CI job uploads it).
      reporter: ["text-summary", "lcov"],
      include: ["packages/*/src/**/*.ts", "tools/*/src/**/*.ts"],
      // GPU-only files cannot be reached from Node. They are covered by the `browser` project
      // (`*.browser.test.ts`); measuring them in the unit run would report a number no unit test
      // can move. `src/lite/gpu/**` is the adapter's device-only half (Phase 2, R1) and
      // `src/render/gpu/**` is the render layer's, under the same rule: a module lives there when
      // every line of it needs `engine._device`.
      exclude: [
        "packages/*/src/lite/render.ts",
        "packages/*/src/lite/gpu/**",
        "packages/*/src/render/gpu/**",
        // `src/lite/web/**` is an adapter's browser-only half (Web Audio), under the same rule as gpu/**.
        "packages/*/src/lite/web/**",
        // `src/platform/web/**` (the WebGPU adapter probe behind `app.platform.webgpu`) and
        // `src/storage/web/**` (the IndexedDB storage backend) are browser-only halves under the
        // same rule: every line of them needs `navigator.gpu` or `indexedDB`. Both are covered by
        // the `browser` project (`packages/core/test/platform/*.browser.test.ts`).
        "packages/*/src/platform/web/**",
        "packages/*/src/storage/web/**",
      ],
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
          include: NODE_INCLUDE,
          exclude: [...NODE_EXCLUDE, ...ISOLATED, ...PERF],
          // One module graph per worker instead of one per file: importing the engine is more than
          // half of a unit run, and sharing it takes the suite from ~28 s to ~12 s (2026-10-02,
          // 8 cores). It holds because a test owns what it creates (`afterEach` disposes the app),
          // and a file that cannot share — one that replaces a module — goes in `ISOLATED`.
          isolate: false,
          pool: "threads",
        },
      },
      {
        test: {
          name: "node-isolated",
          environment: "node",
          include: ISOLATED,
          exclude: NODE_EXCLUDE,
        },
      },
      {
        test: {
          name: "perf",
          environment: "node",
          include: PERF,
          exclude: NODE_EXCLUDE,
          // A timing assertion is only as good as the machine is quiet, so these run one file at a
          // time and never beside the unit suite (`pnpm test:perf`, the CI `perf` job).
          fileParallelism: false,
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
                args: chromiumArgs,
              },
            }),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
