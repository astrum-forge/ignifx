// Throwaway (spike S4): the browser project on the host GPU (Metal on macOS) instead of SwiftShader.
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/core/test/lite/spikes/gi/*.browser.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { channel: "chromium", args: ["--enable-unsafe-webgpu"] } }),
      instances: [{ browser: "chromium" }],
    },
  },
});
