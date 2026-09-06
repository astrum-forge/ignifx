import { defineConfig } from "playwright/test";
import type { PlaywrightTestConfig } from "playwright/test";

/**
 * The Electron desktop suite's own config (`tests/visual/tests/desktop.spec.ts`).
 *
 * It is separate from `playwright.config.ts` for two reasons, both of them properties of what is
 * being launched rather than preferences:
 *
 * - The golden suite previews six Vite builds over HTTP through `webServer`, and pins
 *   `channel: "chromium"` with a SwiftShader adapter so an image does not depend on the host GPU.
 *   The desktop suite launches an **Electron binary** with its own Chromium and the machine's real
 *   GPU, and starts no server at all: the app serves itself over `ignifx://`.
 * - Its assertions are about behaviour, not about pixels, so it needs neither a golden directory nor
 *   a fixed viewport.
 *
 * Run it with `pnpm test:desktop`, after
 * `pnpm --filter ignifx-template-3d-third-person run build:desktop`. Every test skips itself with a
 * clear message when that build is missing.
 */

/** Whether this run is on CI. */
const isCi = process.env["CI"] !== undefined && process.env["CI"] !== "";

const config: PlaywrightTestConfig = defineConfig({
  testDir: "./tests",
  testMatch: "desktop.spec.ts",
  fullyParallel: false,
  // One Electron process at a time: they contend for the GPU, and a device-loss test is not
  // something to run beside another window on the same adapter.
  workers: 1,
  forbidOnly: isCi,
  retries: 0,
  reporter: isCi ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 180_000,
  expect: { timeout: 60_000 },
  use: { trace: "retain-on-failure" },
});

export default config;
