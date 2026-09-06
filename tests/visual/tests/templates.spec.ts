// oxlint-disable no-underscore-dangle -- `window.__ignifxReady` is a test hook, and the double
// underscore is what says it is not part of the game's API. The visual suite reads it by name.
import { expect, test } from "playwright/test";
import type { Page } from "playwright/test";

/**
 * The template scenes `create-ignifx` scaffolds, each against a committed golden: the two 2D
 * templates of Phase 6 and the two 3D templates of Phase 7, all four with the Phase 8 overlay.
 *
 * ## The viewport
 *
 * 512 by 288 rather than the suite's default square. The 2D templates are authored against a
 * 320 by 180 reference resolution, and the side-scroller's camera derives its whole-number zoom
 * from `viewportHeight / 180` — at 288 pixels that is a zoom of 1, so one source texel is exactly
 * one screen pixel and the golden shows the art at its authored size. The 3D templates frame their
 * `?static=1` camera for the same 16:9 aspect.
 *
 * ## Determinism
 *
 * All four templates are opened with `?static=1`, which sets `time.timeScale = 0` **before**
 * `app.start()`. That is stronger than freezing the scene afterwards: no fixed step ever runs, so
 * no body falls, no clip advances, no navmesh is baked and no camera chases its target. The frame
 * is the authored scene, and it does not depend on how long the browser took to get there. The 3D
 * templates go further and leave the controllers and the camera rigs out of a `?static=1` scene
 * altogether, placing the camera by hand: a rig that damps towards its target would otherwise make
 * the picture a function of how many frames had elapsed. They also hide the DOM overlay
 * (`app.ui.visible = false`), so a golden never depends on how the runner draws a system font.
 *
 * ## Tolerances
 *
 * `maxDiffPixelRatio` is **0.02** for the two 2D templates and **0.05** for the two 3D ones.
 *
 * Pixel art sampled `nearest` and drawn axis-aligned is as close to rasteriser-independent as a
 * WebGPU frame gets — there is no MSAA (`msaaSamples: 1` in each 2D `ignifx.config.ts`), no
 * filtering and no lighting — so 0.02 exists for the platform difference between the macOS and
 * Linux SwiftShader builds rather than for anything the scenes do. It is the same number the
 * hello-cube scenes use.
 *
 * The 3D templates are the noisy end of the same suite and get the same budget `gltf-viewer` uses.
 * They are lit by a shadow-casting directional light through a 4x MSAA target, their textures are
 * mip-mapped and anisotropically filtered across a floor that runs to the horizon, and the shadow
 * map is resolved with PCF — every one of those is a place where two SwiftShader builds may round
 * a subpixel differently, and a shadow edge that moves by one texel across a 24-metre floor is
 * already more than 2% of the frame. 0.05 is still far below "a different scene": the frames
 * differ by fewer than 7,400 of 147,456 pixels before the suite complains, which no geometry,
 * camera or material change can hide behind.
 *
 * The goldens carry no `{platform}` segment, so both CI runners compare against the same image
 * (see `playwright.config.ts`).
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

/**
 * How long `Escape` is held, in milliseconds.
 *
 * `page.keyboard.press()` sends `keydown` and `keyup` with no delay between them, and both land in
 * the same frame: `@ignifx/input` applies its queue once per `PreUpdate`, so the control goes down
 * and back up before any script runs and `wasPressedThisFrame` is never true. Measured on
 * 2026-09-06 — `press()` does not open the pause menu, `down()` + 200 ms + `up()` does. A human
 * cannot press a key for zero milliseconds, so this is a property of the test tool rather than a
 * defect, but it is the reason these tests do not use `press`.
 */
const KEY_HOLD_MS = 200;

const TOPDOWN = "http://127.0.0.1:4175";
const SIDESCROLLER = "http://127.0.0.1:4176";
const THIRD_PERSON = "http://127.0.0.1:4177";
const FIRST_PERSON = "http://127.0.0.1:4178";

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

/**
 * Presses and holds a key long enough for the engine to see the edge.
 *
 * @param page - The page under test.
 * @param key - The key to press.
 */
async function holdKey(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(KEY_HOLD_MS);
  await page.keyboard.up(key);
  await page.waitForTimeout(KEY_HOLD_MS);
}

test.describe("template scenes", () => {
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

  // A textured courtyard with a shadow-casting sun, six seeded crates, the rigged character at its
  // spawn and the companion at its post, from the fixed `?static=1` vantage.
  test("3d-third-person", async ({ page }) => {
    await openScene(page, `${THIRD_PERSON}/?static=1`);
    await expect(page).toHaveScreenshot("3d-third-person.png", { maxDiffPixelRatio: 0.05 });
  });

  // The same room from inside the character's head, with the view model and the prop welded to the
  // rig's `hand` node in the corner of the frame and two pedestals ahead.
  test("3d-first-person", async ({ page }) => {
    await openScene(page, `${FIRST_PERSON}/?static=1`);
    await expect(page).toHaveScreenshot("3d-first-person.png", { maxDiffPixelRatio: 0.05 });
  });
});

/**
 * The Phase 8 exit criterion, in the four templates that have to meet it: *"templates use the
 * loading screen and a pause menu"* (`docs/plan/engineering-plan.md`, Phase 8).
 *
 * These open each template **without** `?static=1`, because the overlay is exactly what a golden
 * hides: the point here is that the DOM is right, not that the pixels are.
 */
test.describe("template overlays", () => {
  test.use({ viewport: { width: 512, height: 288 } });

  for (const [name, url] of [
    ["2d-topdown", TOPDOWN],
    ["2d-sidescroller", SIDESCROLLER],
    ["3d-third-person", THIRD_PERSON],
    ["3d-first-person", FIRST_PERSON],
  ] as const) {
    test(`${name}: the loading screen closes and the pause menu opens`, async ({ page }) => {
      const failures: string[] = [];
      page.on("pageerror", (error) => {
        failures.push(error.message);
      });
      await page.goto(`${url}/`, { waitUntil: "load" });
      expect(await page.evaluate(() => window.__ignifxReady)).toBe("ready");

      // One overlay root, mounted as the canvas's sibling, with the loading screen dismissed once
      // the preload settled and the dialog built but not shown.
      await expect(page.locator(".ignifx-ui-root")).toHaveCount(1);
      await expect(page.locator(".ignifx-ui-loading")).toBeHidden();
      await expect(page.locator(".ignifx-ui-dialog")).toBeHidden();

      await holdKey(page, "Escape");
      await expect(page.locator(".ignifx-ui-dialog")).toBeVisible();
      await expect(page.locator(".ignifx-ui-dialog-title")).toHaveText("Paused");
      await expect(page.locator(".ignifx-ui-dialog-button")).toHaveCount(2);

      await page.locator(".ignifx-ui-dialog-button", { hasText: "Resume" }).click();
      await expect(page.locator(".ignifx-ui-dialog")).toBeHidden();
      expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
    });
  }

  // `app.i18n` owns every menu string in this template, and `?locale=fr` is the proof.
  test("3d-third-person: ?locale=fr localizes the menu and the HUD", async ({ page }) => {
    await page.goto(`${THIRD_PERSON}/?locale=fr`, { waitUntil: "load" });
    expect(await page.evaluate(() => window.__ignifxReady)).toBe("ready");
    await expect(page.locator(".hud")).toContainText("compagnon");
    await holdKey(page, "Escape");
    await expect(page.locator(".ignifx-ui-dialog-title")).toHaveText("En pause");
    await expect(page.locator(".ignifx-ui-dialog-button").first()).toHaveText("Reprendre");
  });
});
