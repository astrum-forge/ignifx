import { defineConfig, devices } from "playwright/test";
import type { PlaywrightTestConfig } from "playwright/test";

/**
 * The visual golden suite (coding standards §10): one screenshot per Phase 2 exit-criterion scene,
 * compared against a committed golden with a per-scene tolerance.
 *
 * ## Chromium, not the headless shell
 *
 * `channel: "chromium"` is required, not a preference. Playwright's default headless browser is
 * `chrome-headless-shell`, which has no compositor: a WebGPU canvas presents two or three frames
 * and then the device is lost with `A valid external Instance reference no longer exists`
 * (measured 2026-09-05, Phase 2 spike S2.1 — the same finding that pins `vitest.config.ts`).
 * `--use-webgpu-adapter=swiftshader` pins the software adapter so a golden does not depend on the
 * host GPU, which is what standards §10 asks of CI.
 *
 * On Linux those two flags are not enough: the adapter and device come up, but the first present
 * to a canvas destroys the device (`A valid external Instance reference no longer exists`, measured
 * 2026-09-06 in Playwright's `v1.63.0-noble` image, arm64, and on GitHub's ubuntu runner). Routing
 * SwiftShader through Vulkan and ANGLE — `--enable-features=Vulkan --use-vulkan=swiftshader
 * --use-angle=swiftshader` — keeps it alive; `--use-angle=vulkan` alone does not, and the Vulkan
 * flags return a null adapter on macOS (ADR-0009, "WebGPU flags"), hence the platform switch in
 * `chromiumArgs`. `vitest.config.ts` carries the same switch; change both together.
 *
 * ## One golden per scene, not one per platform
 *
 * Playwright's default `snapshotPathTemplate` puts `{platform}` in the path, which would mean a
 * macOS golden and a Linux golden per scene — two files that can drift apart silently, and only
 * one of which any given contributor can regenerate. The template below drops the platform, so
 * macOS and Linux CI compare against the *same* image and the per-scene `maxDiffPixelRatio` has to
 * absorb the rasteriser difference between the two SwiftShader builds. The trade-off is a looser
 * tolerance in exchange for a golden that cannot rot on the platform nobody runs locally.
 *
 * ## Determinism
 *
 * Every scene is opened with `?static=1`, which stops `time.timeScale` and pins the animated
 * transforms, and the page resolves `window.__ignifxReady` only after it has presented a settled
 * frame. Nothing here sleeps on wall-clock time (standards §10).
 *
 * ## Two projects, because they need different machines
 *
 * `goldens` is everything here except `frame-time.spec.ts`: image comparisons, which SwiftShader
 * makes reproducible anywhere. It is `pnpm test:visual`, and it is the required CI check. It now
 * includes `tests/examples.spec.ts`, the website's runnable examples, whose pages come from the
 * site build previewed on 4179.
 *
 * `frame-budget` is `frame-time.spec.ts` alone: a *measurement* of engine CPU per frame against the
 * ceilings in `benchmarks/baselines.json`. Those ceilings were recorded on one machine, and a
 * shared CI runner is not it — GitHub's `ubuntu-latest` measured a 2.0 ms median for `2d-topdown`
 * against a 1.0 ms ceiling on 2026-09-06, and could not finish either 3D template's 420 frames
 * inside the 240 s per-test timeout, where the recording machine takes 60 to 70 s. Enforcing the
 * ceiling there measures the runner, which is the same mistake the spec's own header rejects for
 * frames per second. It is `pnpm test:frame-budget`, it runs on macOS in CI, and it is what a
 * re-record runs (`README.md`).
 */

/** One `webServer` entry. Playwright does not export `TestConfigWebServer` by name. */
type PreviewServer = Extract<NonNullable<PlaywrightTestConfig["webServer"]>, unknown[]>[number];

/** Where each example is previewed from. `tests/scenes.spec.ts` holds the matching URLs. */
const PORTS: Readonly<Record<string, number>> = {
  "ignifx-example-hello-cube": 4173,
  "ignifx-example-gltf-viewer": 4174,
  "ignifx-template-2d-topdown": 4175,
  "ignifx-template-2d-sidescroller": 4176,
  "ignifx-template-3d-third-person": 4177,
  "ignifx-template-3d-first-person": 4178,
};

/**
 * Where the whole website is previewed from.
 *
 * @remarks
 * `tests/examples.spec.ts` and the examples half of `tests/frame-time.spec.ts` open their pages
 * here rather than on a per-example port, because a website example is not a package: it is a page
 * in one multi-page build that shares its vendor chunk and its asset manifest with every other
 * example, and a template's run page is that template rebuilt under `--base /examples/<name>/run/`.
 * The only honest thing to measure and to photograph is the deployed artefact, so this entry runs
 * the real site build and previews `website/dist`.
 */
const WEBSITE_PORT = 4179;

/**
 * The canvas the goldens are taken at. Small keeps SwiftShader honest and the images reviewable.
 *
 * `tests/templates.spec.ts` overrides it with a 16:9 viewport: the 2D templates are authored
 * against a 320x180 reference resolution, and a square window would show a strip of level nobody
 * designed, and the two 3D templates frame their static camera for the same aspect.
 */
const VIEWPORT = { width: 512, height: 512 };

/** Whether this run is on CI. */
const isCi = process.env["CI"] !== undefined && process.env["CI"] !== "";

/**
 * Builds an example and previews the build output, which is what a golden should be taken of.
 *
 * @param packageName - The workspace package.
 * @param port - The port `vite preview` binds.
 * @returns One `webServer` entry.
 */
function preview(packageName: string, port: number): PreviewServer {
  return {
    command:
      `pnpm --filter ${packageName} run build && ` +
      `pnpm --filter ${packageName} exec vite preview --host 127.0.0.1 --port ${String(port)} --strictPort`,
    url: `http://127.0.0.1:${String(port)}/`,
    reuseExistingServer: !isCi,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  };
}

/**
 * Builds the whole website and previews `website/dist`.
 *
 * @remarks
 * The readiness `url` is a run page rather than `/`, so the suite cannot start against a `dist/`
 * whose examples half has not been written yet — and, incidentally, so a failure says which page is
 * missing rather than "the server did not answer".
 *
 * @param port - The port `vite preview` binds.
 * @returns One `webServer` entry.
 */
function previewWebsite(port: number): PreviewServer {
  return {
    command:
      `pnpm --filter @ignifx/website run build && ` +
      `pnpm --filter @ignifx/website exec vite preview --host 127.0.0.1 --port ${String(port)} --strictPort`,
    url: `http://127.0.0.1:${String(port)}/examples/hello-cube/run/`,
    reuseExistingServer: !isCi,
    // The site, the examples and every template in the catalogue, from cold.
    timeout: 600_000,
    stdout: "ignore",
    stderr: "pipe",
  };
}

/** Chromium flags for a SwiftShader WebGPU adapter; see the module comment for the Linux half. */
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

const config: PlaywrightTestConfig = defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCi,
  retries: 0,
  reporter: isCi ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 120_000,
  expect: { timeout: 30_000 },
  // No `{platform}` — see the module comment.
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  // Two projects, run separately and on different machines — see the module comment. Neither adds
  // a `use` of its own: the per-suite viewports are `test.use` calls inside the two spec files.
  projects: [
    { name: "goldens", testIgnore: /frame-time\.spec\.ts$/u },
    { name: "frame-budget", testMatch: /frame-time\.spec\.ts$/u },
  ],
  use: {
    ...devices["Desktop Chrome"],
    channel: "chromium",
    headless: true,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    launchOptions: {
      args: [...chromiumArgs],
    },
  },
  webServer: [
    preview("ignifx-example-hello-cube", PORTS["ignifx-example-hello-cube"] ?? 4173),
    preview("ignifx-example-gltf-viewer", PORTS["ignifx-example-gltf-viewer"] ?? 4174),
    preview("ignifx-template-2d-topdown", PORTS["ignifx-template-2d-topdown"] ?? 4175),
    preview("ignifx-template-2d-sidescroller", PORTS["ignifx-template-2d-sidescroller"] ?? 4176),
    preview("ignifx-template-3d-third-person", PORTS["ignifx-template-3d-third-person"] ?? 4177),
    preview("ignifx-template-3d-first-person", PORTS["ignifx-template-3d-first-person"] ?? 4178),
    previewWebsite(WEBSITE_PORT),
  ],
});

export default config;
