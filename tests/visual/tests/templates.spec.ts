// oxlint-disable no-underscore-dangle -- `window.__ignifxReady` is a test hook, and the double
// underscore is what says it is not part of the game's API. The visual suite reads it by name.
import { expect, test } from "playwright/test";
import type { Page } from "playwright/test";

/**
 * The template scenes `create-ignifx` scaffolds, each against a committed golden, plus the front
 * end Phase 12 added to all four: a title screen, a pause menu, a settings screen with volume
 * sliders and an interactive rebinding page, and a save file.
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
 * is the authored scene, and it does not depend on how long the browser took to get there. A
 * `?static=1` scene also leaves the whole front end out — no title screen, no save read, no menu —
 * and hides the DOM overlay (`app.ui.visible = false`), so a golden never depends on how the runner
 * draws a system font. The 3D templates go further and leave the controllers and the camera rigs
 * out altogether, placing the camera by hand: a rig that damps towards its target would otherwise
 * make the picture a function of how many frames had elapsed.
 *
 * `?hud=1` is the one flag that puts the overlay back into a static scene. It exists for the
 * gallery capture script, which wants a settled frame *with* the HUD on it; no golden uses it.
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

/** Every template, with the port it is previewed on. */
const TEMPLATES = [
  ["2d-topdown", TOPDOWN],
  ["2d-sidescroller", SIDESCROLLER],
  ["3d-third-person", THIRD_PERSON],
  ["3d-first-person", FIRST_PERSON],
] as const;

/**
 * Opens a template and waits for it to say it is on screen.
 *
 * @param page - The page under test.
 * @param url - The template URL, query flags included.
 * @returns The list the page's uncaught errors are collected into.
 */
async function openScene(page: Page, url: string): Promise<string[]> {
  const failures: string[] = [];
  page.on("pageerror", (error) => {
    failures.push(error.message);
  });
  await page.goto(url, { waitUntil: "load" });
  const status = await page.evaluate(() => window.__ignifxReady);
  expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
  expect(status, "the browser did not give the template a WebGPU device").toBe("ready");
  return failures;
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

  // A Y-sorted tilemap with a collision layer, props with colliders, the shrines the run is scored
  // in, and the character at the spawn point the objects layer names.
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

  // A textured courtyard under a gradient sky, with a shadow-casting sun, six seeded crates, three
  // beacons, the rigged character at its spawn and the companion at its post.
  test("3d-third-person", async ({ page }) => {
    await openScene(page, `${THIRD_PERSON}/?static=1`);
    await expect(page).toHaveScreenshot("3d-third-person.png", { maxDiffPixelRatio: 0.05 });
  });

  // The same room from inside the character's head, with the view model and the prop welded to the
  // rig's `hand` node in the corner of the frame and three pedestals ahead.
  test("3d-first-person", async ({ page }) => {
    await openScene(page, `${FIRST_PERSON}/?static=1`);
    await expect(page).toHaveScreenshot("3d-first-person.png", { maxDiffPixelRatio: 0.05 });
  });
});

/**
 * The Phase 12 exit criterion, in the four templates that have to meet it: *"polish of the four
 * templates: art, audio, menus, settings/rebinding screens, save/load"*
 * (`docs/plan/engineering-plan.md`, Phase 12).
 *
 * These open each template **without** `?static=1`, because the overlay is exactly what a golden
 * hides: the point here is that the DOM is right, not that the pixels are. Every screen is the
 * template's own `MenuScreen` (`src/menus/menu-screen.ts`), so the selectors are `data-menu` on the
 * panel and `data-row` on each row.
 */
test.describe("template front end", () => {
  test.use({ viewport: { width: 640, height: 480 } });

  for (const [name, url] of TEMPLATES) {
    test(`${name}: boots into a title screen with the loading screen gone`, async ({ page }) => {
      const failures = await openScene(page, `${url}/`);

      // One overlay root, mounted as the canvas's sibling, with the loading screen dismissed once
      // the preload settled.
      await expect(page.locator(".ignifx-ui-root")).toHaveCount(1);
      await expect(page.locator(".ignifx-ui-loading")).toBeHidden();

      const title = page.locator('[data-menu="title"]');
      await expect(title).toBeVisible();
      // No save on a fresh profile, so "Continue" is present but disabled.
      await expect(title.locator('[data-row="continue"]')).toHaveAttribute("data-disabled", "");
      await expect(title.locator('[data-row="new-game"]')).toBeVisible();

      await title.locator('[data-row="new-game"]').click();
      await expect(title).toBeHidden();
      expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
    });

    test(`${name}: Escape opens the pause menu and the settings screen`, async ({ page }) => {
      const failures = await openScene(page, `${url}/`);
      await page.locator('[data-menu="title"] [data-row="new-game"]').click();

      await holdKey(page, "Escape");
      const pause = page.locator('[data-menu="pause"]');
      await expect(pause).toBeVisible();
      await expect(pause.locator('[data-row="resume"]')).toBeVisible();
      await expect(pause.locator('[data-row="save"]')).toBeVisible();
      await expect(pause.locator('[data-row="quit"]')).toBeVisible();

      await pause.locator('[data-row="pause-settings"]').click();
      const settings = page.locator('[data-menu="settings"]');
      await expect(settings).toBeVisible();
      // Three bus sliders and the resolution scale, all of them native range inputs.
      await expect(settings.locator(".menu-row-slider")).toHaveCount(4);
      await expect(settings.locator('[data-row="master"] .menu-row-value')).toHaveText(/%$/u);

      // Escape backs out of the settings screen to the pause menu, and again to the game.
      await holdKey(page, "Escape");
      await expect(settings).toBeHidden();
      await expect(pause).toBeVisible();
      await pause.locator('[data-row="resume"]').click();
      await expect(pause).toBeHidden();
      expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
    });

    test(`${name}: the rebinding page lists a binding per control scheme`, async ({ page }) => {
      const failures = await openScene(page, `${url}/`);
      const settings = page.locator('[data-menu="settings"]');
      await page.locator('[data-menu="title"] [data-row="title-settings"]').click();
      await expect(settings).toBeVisible();
      await settings.locator('[data-row="bindings"]').click();

      const bindings = page.locator('[data-menu="bindings"]');
      await expect(bindings).toBeVisible();
      // One heading per scheme that actually binds something, and at least one keyboard row.
      await expect(bindings.locator('[data-row^="scheme-"]')).not.toHaveCount(0);
      await expect(bindings.locator('[data-row^="bind-KeyboardMouse-"]').first()).toBeVisible();
      // A binding row shows the path a player reads, not `<Keyboard>/escape`.
      await expect(bindings.locator('[data-row^="bind-KeyboardMouse-"] .menu-row-value').first()).not.toHaveText(/^</u);

      await holdKey(page, "Escape");
      await expect(bindings).toBeHidden();
      expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
    });

    test(`${name}: an interactive rebind takes effect and survives a reload`, async ({ page }) => {
      const failures = await openScene(page, `${url}/`);
      await page.locator('[data-menu="title"] [data-row="title-settings"]').click();
      await page.locator('[data-menu="settings"] [data-row="bindings"]').click();
      const bindings = page.locator('[data-menu="bindings"]');
      const row = bindings.locator('[data-row^="bind-KeyboardMouse-"]').first();
      const before = await row.locator(".menu-row-value").innerText();

      await row.click();
      // The click's own mouse release must land before the rebind starts listening, or the rebind
      // catches `<Mouse>/leftButton` instead of the key. `performInteractiveRebind` settles from a
      // `PreUpdate`, so one frame is enough; a quarter of a second is generous.
      await page.waitForTimeout(250);
      await expect(row.locator(".menu-row-value")).not.toHaveText(before);
      await holdKey(page, "j");
      await expect(row.locator(".menu-row-value")).toHaveText(/j$/iu);

      // The override is written to `app.storage.namespace("settings")`, so it comes back.
      await openScene(page, `${url}/`);
      await page.locator('[data-menu="title"] [data-row="title-settings"]').click();
      await page.locator('[data-menu="settings"] [data-row="bindings"]').click();
      await expect(bindings.locator('[data-row^="bind-KeyboardMouse-"] .menu-row-value').first()).toHaveText(/j$/iu);

      // Clean up, so the next test in this file starts on a fresh profile.
      await bindings.locator('[data-row="reset-bindings"]').click();
      await expect(bindings.locator('[data-row^="bind-KeyboardMouse-"] .menu-row-value').first()).toHaveText(before);
      expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
    });

    test(`${name}: a saved game is offered as Continue after a reload`, async ({ page }) => {
      const failures = await openScene(page, `${url}/`);
      await page.locator('[data-menu="title"] [data-row="new-game"]').click();
      await holdKey(page, "Escape");
      await page.locator('[data-menu="pause"] [data-row="save"]').click();
      // The write goes through `app.storage`, which is IndexedDB in a browser; the toast is the
      // page's own signal that it settled.
      await expect(page.locator(".ignifx-ui-toast").first()).toBeVisible();

      await openScene(page, `${url}/`);
      const title = page.locator('[data-menu="title"]');
      await expect(title).toBeVisible();
      await expect(title.locator('[data-row="continue"]')).not.toHaveAttribute("data-disabled", "");
      await title.locator('[data-row="continue"]').click();
      await expect(title).toBeHidden();

      // Clean up, so the next test in this file starts on a fresh profile.
      await holdKey(page, "Escape");
      await page.locator('[data-menu="pause"] [data-row="pause-settings"]').click();
      await page.locator('[data-menu="settings"] [data-row="delete-save"]').click();
      await page.locator(".ignifx-ui-dialog-button", { hasText: /^(Yes|Oui)$/u }).click();
      await expect(page.locator('[data-menu="settings"] [data-row="delete-save"]')).toHaveAttribute(
        "data-disabled",
        "",
      );
      expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
    });
  }

  // `app.i18n` owns every menu string in every template, and `?locale=fr` is the proof.
  test("3d-third-person: ?locale=fr localizes the title screen, the menu and the HUD", async ({ page }) => {
    await openScene(page, `${THIRD_PERSON}/?locale=fr`);
    const title = page.locator('[data-menu="title"]');
    await expect(title.locator('[data-row="new-game"]')).toHaveText("Nouvelle partie");
    await title.locator('[data-row="new-game"]').click();
    await expect(page.locator(".hud")).toContainText("compagnon");
    await holdKey(page, "Escape");
    await expect(page.locator('[data-menu="pause"] .menu-title')).toHaveText("En pause");
    await expect(page.locator('[data-menu="pause"] [data-row="resume"]')).toHaveText("Reprendre");
  });
});
