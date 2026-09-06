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

/** Chromium flags for a SwiftShader WebGPU adapter; see the module comment for the Linux half. */
const chromiumArgs: readonly string[] =
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
  use: {
    ...devices["Desktop Chrome"],
    channel: "chromium",
    headless: true,
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
    launchOptions: {
      args: chromiumArgs,
    },
  },
  webServer: [
    preview("ignifx-example-hello-cube", PORTS["ignifx-example-hello-cube"] ?? 4173),
    preview("ignifx-example-gltf-viewer", PORTS["ignifx-example-gltf-viewer"] ?? 4174),
    preview("ignifx-template-2d-topdown", PORTS["ignifx-template-2d-topdown"] ?? 4175),
    preview("ignifx-template-2d-sidescroller", PORTS["ignifx-template-2d-sidescroller"] ?? 4176),
    preview("ignifx-template-3d-third-person", PORTS["ignifx-template-3d-third-person"] ?? 4177),
    preview("ignifx-template-3d-first-person", PORTS["ignifx-template-3d-first-person"] ?? 4178),
  ],
});

export default config;
