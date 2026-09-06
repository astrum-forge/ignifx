// oxlint-disable no-underscore-dangle -- `window.__ignifxReady` is a test hook, and the double
// underscore is what says it is not part of the game's API. The visual suite reads it by name.
import { expect, test } from "playwright/test";
import type { Page } from "playwright/test";

/**
 * The Phase 6 exit-criterion scenes (`docs/plan/engineering-plan.md`, Phase 6): the two 2D
 * templates `create-ignifx` scaffolds, each against a committed golden.
 *
 * ## The viewport
 *
 * 512 by 288 rather than the suite's default square. Both templates are authored against a
 * 320 by 180 reference resolution, and the side-scroller's camera derives its whole-number zoom
 * from `viewportHeight / 180` — at 288 pixels that is a zoom of 1, so one source texel is exactly
 * one screen pixel and the golden shows the art at its authored size.
 *
 * ## Determinism
 *
 * Both templates are opened with `?static=1`, which sets `time.timeScale = 0` **before**
 * `app.start()`. That is stronger than freezing the scene afterwards: no fixed step ever runs, so
 * no body falls, no clip advances and the camera never chases its target. The frame is the
 * authored scene, and it does not depend on how long the browser took to get there.
 *
 * ## Tolerances
 *
 * `maxDiffPixelRatio` is 0.02 for both, the same number the hello-cube scenes use. Pixel art
 * sampled `nearest` and drawn axis-aligned is as close to rasteriser-independent as a WebGPU frame
 * gets — there is no MSAA (`msaaSamples: 1` in each `ignifx.config.ts`), no filtering and no
 * lighting — so the budget exists for the platform difference between the macOS and Linux
 * SwiftShader builds rather than for anything the scenes do. The goldens carry no `{platform}`
 * segment, so both CI runners compare against the same image (see `playwright.config.ts`).
 *
 * The goldens in `__screenshots__/` were generated on macOS arm64 with Playwright's Chromium on
 * SwiftShader. Regenerate them only in a pull request that shows before and after images
 * (coding standards §10) — `pnpm --filter ignifx-visual-tests run test:visual:update`.
 */

declare global {
  interface Window {
    /** Resolves once the template has presented a settled frame. Set by each `main.ts`. */
    __ignifxReady: Promise<"ready" | "unsupported">;
  }
}

const TOPDOWN = "http://127.0.0.1:4175";
const SIDESCROLLER = "http://127.0.0.1:4176";

/**
 * Opens a template and waits for it to say it is on screen.
 *
 * @param page - The page under test.
 * @param url - The template URL, query flags included.
 */
async function openScene(page: Page, url: string): Promise<void> {
  const failures: string[] = [];
  page.on("pageerror", (error) => {
    failures.push(error.message);
  });
  await page.goto(url, { waitUntil: "load" });
  const status = await page.evaluate(() => window.__ignifxReady);
  expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
  expect(status, "the browser did not give the template a WebGPU device").toBe("ready");
}

test.describe("Phase 6 template scenes", () => {
  test.use({ viewport: { width: 512, height: 288 } });

  // A Y-sorted tilemap with a collision layer, props with colliders, and the character at the
  // spawn point the objects layer names.
  test("2d-topdown", async ({ page }) => {
    await openScene(page, `${TOPDOWN}/?static=1`);
    await expect(page).toHaveScreenshot("2d-topdown.png", { maxDiffPixelRatio: 0.02 });
  });

  // Three parallax bands behind a tilemap with slopes and one-way platforms, through a
  // pixel-perfect camera.
  test("2d-sidescroller", async ({ page }) => {
    await openScene(page, `${SIDESCROLLER}/?static=1`);
    await expect(page).toHaveScreenshot("2d-sidescroller.png", { maxDiffPixelRatio: 0.02 });
  });
});
