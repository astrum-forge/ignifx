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
    /**
     * The `?probe=1` gameplay hook each template installs (`src/gameplay-probe.ts`). Its snapshot
     * shape is the template's own, so it is `unknown` here and narrowed by a type guard per suite.
     */
    __ignifxGameplay?: { snapshot(): unknown };
  }
}

/**
 * How many presented frames a key is held for.
 *
 * `page.keyboard.press()` sends `keydown` and `keyup` with no delay between them, and both land in
 * the same frame: `@ignifx/input` applies its queue once per `PreUpdate`, so the control goes down
 * and back up before any script runs and `wasPressedThisFrame` is never true. Measured on
 * 2026-09-06 — `press()` does not open the pause menu, a hold across frames does. A human cannot
 * press a key for zero milliseconds, so this is a property of the test tool rather than a defect,
 * but it is the reason these tests do not use `press`.
 *
 * The hold is counted in **frames**, not milliseconds, because a frame is the unit the input queue
 * is drained on and its wall-clock length is a property of the machine. The original 200 ms was
 * measured on macOS; on GitHub's `ubuntu-latest` SwiftShader presents a 3D template at under two
 * frames a second, so 200 ms is less than half a frame and every key hold was swallowed — twelve
 * front-end tests failed there on 2026-09-07 for that reason alone, each burning its full timeout.
 * Counting frames is also what coding standards §10 asks for: no test sleeps on wall-clock time.
 */
const KEY_HOLD_FRAMES = 4;

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
 * Waits for the page to present frames. The engine drives its loop from `requestAnimationFrame`, so
 * a callback that runs after N of them has seen N engine ticks, however long the machine took over
 * them — which is what makes this safe on a software rasteriser and on a laptop alike.
 *
 * @param page - The page under test.
 * @param frames - How many presented frames to wait for.
 */
async function waitForFrames(page: Page, frames: number): Promise<void> {
  await page.evaluate(async (count: number) => {
    for (let index = 0; index < count; index += 1) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- frames are sequential by definition; awaiting them together would resolve on one frame N times over, which is the bug this helper exists to avoid.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    }
  }, frames);
}

/**
 * Presses and holds a key long enough for the engine to see the edge.
 *
 * @param page - The page under test.
 * @param key - The key to press.
 */
async function holdKey(page: Page, key: string): Promise<void> {
  await page.keyboard.down(key);
  await waitForFrames(page, KEY_HOLD_FRAMES);
  await page.keyboard.up(key);
  await waitForFrames(page, KEY_HOLD_FRAMES);
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
 * hides: the point here is that the DOM is right, not that the pixels are. Every screen is
 * `@ignifx/ui`'s `Menu` widget, driven by a `MenuStack` (`src/menus/game-menus.ts`), so the
 * selectors are the widget's: `data-menu` on the panel, `data-row` on each row, and the
 * `ignifx-ui-menu-*` classes on the pieces inside a row.
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
      await expect(settings.locator(".ignifx-ui-menu-row-slider")).toHaveCount(4);
      await expect(settings.locator('[data-row="master"] .ignifx-ui-menu-row-value')).toHaveText(/%$/u);

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
      await expect(
        bindings.locator('[data-row^="bind-KeyboardMouse-"] .ignifx-ui-menu-row-value').first(),
      ).not.toHaveText(/^</u);

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
      const before = await row.locator(".ignifx-ui-menu-row-value").innerText();

      await row.click();
      // The click's own mouse release must land before the rebind starts listening, or the rebind
      // catches `<Mouse>/leftButton` instead of the key. `performInteractiveRebind` settles from a
      // `PreUpdate`, so one frame is enough; four is generous. Frames rather than milliseconds for
      // the same reason as `KEY_HOLD_FRAMES`.
      await waitForFrames(page, KEY_HOLD_FRAMES);
      await expect(row.locator(".ignifx-ui-menu-row-value")).not.toHaveText(before);
      await holdKey(page, "j");
      await expect(row.locator(".ignifx-ui-menu-row-value")).toHaveText(/j$/iu);

      // The override is written to `app.storage.namespace("settings")`, so it comes back.
      await openScene(page, `${url}/`);
      await page.locator('[data-menu="title"] [data-row="title-settings"]').click();
      await page.locator('[data-menu="settings"] [data-row="bindings"]').click();
      await expect(bindings.locator('[data-row^="bind-KeyboardMouse-"] .ignifx-ui-menu-row-value').first()).toHaveText(
        /j$/iu,
      );

      // Clean up, so the next test in this file starts on a fresh profile.
      await bindings.locator('[data-row="reset-bindings"]').click();
      await expect(bindings.locator('[data-row^="bind-KeyboardMouse-"] .ignifx-ui-menu-row-value').first()).toHaveText(
        before,
      );
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
    await expect(page.locator('[data-menu="pause"] .ignifx-ui-menu-title')).toHaveText("En pause");
    await expect(page.locator('[data-menu="pause"] [data-row="resume"]')).toHaveText("Reprendre");
  });
});

// 2D gameplay. Everything below this line belongs to one `describe` block; nothing above it is
// touched.

/**
 * One reading of a 2D template's `?probe=1` hook, `window.__ignifxGameplay.snapshot()`.
 *
 * @remarks
 * The two templates expose the fields their own gameplay has — the side-scroller a grounded flag
 * and a respawn point, the top-down a camera and a list of lit shrines — so the shared half is
 * required here and the rest is optional. The hook's global declaration types its snapshot as
 * `unknown`: one name carries two shapes, and a declaration that was the union of both would let a
 * side-scroller test read `lit` and still compile, so each suite narrows with its own type guard.
 */
interface Gameplay2DSnapshot {
  /** The character's world position, in metres. */
  readonly position: { readonly x: number; readonly y: number };
  /** The score: coins taken, or shrines lit. */
  readonly score: number;
  /** Side-scroller only: whether the character is standing on something. */
  readonly grounded?: boolean;
  /** Side-scroller only: where a fall out of the level would put the character back. */
  readonly respawn?: { readonly x: number; readonly y: number };
  /** Top-down only: where the camera is, in metres. */
  readonly camera?: { readonly x: number; readonly y: number };
  /** Top-down only: the ids of the shrines that are lit. */
  readonly lit?: readonly string[];
}

/** How many presented frames pass between two readings of the probe while a key is held. */
const PROBE_POLL_FRAMES = 5;

/**
 * How many presented frames a walk is given before the test gives up. Generous on purpose: a frame
 * on SwiftShader carries more simulated time than a frame on a real GPU, never less, so a budget
 * counted in frames is an upper bound on both.
 */
const WALK_BUDGET_FRAMES = 600;

/** How many presented frames one jump's flight is sampled for. */
const FLIGHT_FRAMES = 90;

/**
 * The world x of the left edge of the top-down template's shrine pad. The pad is one cell wide, so
 * the character is over it anywhere between this and one metre further east.
 */
const SHRINE_PAD_LEFT = 25;

/**
 * How many presented frames the character is given to climb the first slope, from a standing start
 * at the spawn. Measured on 2026-09-08 at 65 fixed steps with the surface-aligned run and at about
 * 180 without it, so this is the number that would have failed before the fix and passes with a
 * wide margin after it.
 */
const SLOPE_BUDGET_FRAMES = 120;

/**
 * Reads the `?probe=1` hook.
 *
 * @param page - The page under test.
 * @returns The current reading.
 */
async function readProbe(page: Page): Promise<Gameplay2DSnapshot> {
  const reading = await readGameplayHook(page);
  if (!isGameplay2DSnapshot(reading)) {
    throw new Error("window.__ignifxGameplay.snapshot() did not answer with a 2D reading.");
  }
  return reading;
}

/**
 * Whether a probe reading has the fields every 2D template's snapshot carries.
 *
 * @param value - Whatever the page answered.
 * @returns `true` for a 2D reading.
 */
function isGameplay2DSnapshot(value: unknown): value is Gameplay2DSnapshot {
  return typeof value === "object" && value !== null && "position" in value && "score" in value;
}

/**
 * Calls the `?probe=1` hook in the page and answers with whatever it returned.
 *
 * @param page - The page under test.
 * @returns The raw reading, for a suite's type guard.
 */
function readGameplayHook(page: Page): Promise<unknown> {
  return page.evaluate((): unknown => {
    const hook = window.__ignifxGameplay;
    if (hook === undefined) {
      throw new Error("window.__ignifxGameplay is missing: the page was not opened with ?probe=1.");
    }
    return hook.snapshot();
  });
}

/**
 * Opens a template with its probe installed and leaves the title screen for the game.
 *
 * @param page - The page under test.
 * @param url - The template's origin.
 * @returns The list the page's uncaught errors are collected into.
 */
async function startGame(page: Page, url: string): Promise<string[]> {
  const failures = await openScene(page, `${url}/?probe=1`);
  await page.locator('[data-menu="title"] [data-row="new-game"]').click();
  // The click unpauses through `MenuController`, which reconciles the screen stack in `Update`;
  // a few frames later the world is running and the probe reads a moving character.
  await waitForFrames(page, KEY_HOLD_FRAMES);
  return failures;
}

/**
 * Holds one or more keys until a reading satisfies the predicate, or the budget runs out.
 *
 * @param page - The page under test.
 * @param keys - The keys to hold together.
 * @param done - What the test is waiting for.
 * @param budget - How many presented frames to allow.
 * @returns The last reading, and how many frames it took.
 */
async function holdUntil(
  page: Page,
  keys: readonly string[],
  done: (reading: Gameplay2DSnapshot) => boolean,
  budget: number = WALK_BUDGET_FRAMES,
): Promise<{ readonly reading: Gameplay2DSnapshot; readonly frames: number }> {
  for (const key of keys) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- key presses are ordered by definition; the browser applies them in the order they arrive.
    await page.keyboard.down(key);
  }
  let reading = await readProbe(page);
  let frames = 0;
  while (frames < budget && !done(reading)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- frames are sequential by definition, and the reading has to be of the frame that was just presented.
    await waitForFrames(page, PROBE_POLL_FRAMES);
    frames += PROBE_POLL_FRAMES;
    // oxlint-disable-next-line eslint/no-await-in-loop -- see above.
    reading = await readProbe(page);
  }
  for (const key of keys) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- see above.
    await page.keyboard.up(key);
  }
  await waitForFrames(page, 2);
  return { reading, frames };
}

/**
 * Jumps and reports how far the character rose.
 *
 * @remarks
 * The apex is sampled frame by frame rather than computed, because the point of the test is that
 * the *simulation* produces it. It always lands after the button is released: the full arc takes
 * 27 fixed steps to reach its top and the shortest clamped one 15, so a hold of 16 frames or fewer
 * is over before the character is.
 *
 * @param page - The page under test.
 * @param holdFrames - How many presented frames the jump button is held for.
 * @returns The rise, in metres.
 */
async function measureJump(page: Page, holdFrames: number): Promise<number> {
  const base = (await readProbe(page)).position.y;
  await page.keyboard.down("Space");
  await waitForFrames(page, holdFrames);
  await page.keyboard.up("Space");
  let apex = base;
  for (let index = 0; index < FLIGHT_FRAMES; index += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- frames are sequential by definition; the apex is the maximum over them.
    await waitForFrames(page, 1);
    // oxlint-disable-next-line eslint/no-await-in-loop -- see above.
    const reading = await readProbe(page);
    apex = Math.max(apex, reading.position.y);
    if (index > holdFrames + 6 && reading.grounded === true) {
      break;
    }
  }
  return apex - base;
}

/**
 * The gameplay half of the two 2D templates, driven through the `?probe=1` hook each of them
 * installs (`src/gameplay-probe.ts`) rather than through screenshots.
 *
 * ## Why a probe and not a golden
 *
 * A golden answers "does the scene still look like this"; none of the questions below are about
 * pixels. "A tap and a hold reach different heights" is two numbers, "the slope is climbed at
 * running speed" is a number against a frame budget, and "falling into the pit puts the character
 * back" is a coordinate. Photographing them would make the assertions weaker *and* the failures
 * harder to read. The four goldens above stay exactly as they are.
 *
 * ## Why the holds are counted in frames
 *
 * The same reason `KEY_HOLD_FRAMES` gives: a frame is the unit the input queue is drained on and
 * the fixed loop is stepped from, and its wall-clock length is a property of the machine. Every
 * budget here is therefore an upper bound that holds on a slow software rasteriser as well as on a
 * real GPU — a slower frame carries *more* simulated time, never less.
 *
 * The numbers the assertions are built on were measured on 2026-09-08, headlessly against the real
 * `level.tilemap.json` and again in Chromium on SwiftShader.
 */
test.describe("2d template gameplay", () => {
  test.use({ viewport: { width: 512, height: 288 } });

  // The coin at (12.5, 4.5) sits over the top of the level's first slope, so running right from the
  // spawn is enough to take it: the trigger fires, the coin leaves the board, the run autosaves and
  // the HUD counts it. Before `@ignifx/physics-2d` let a character controller through a sensor, the
  // coin was solid and this walk ended against it.
  test("2d-sidescroller: walking right takes the first coin, and it is scored, saved and shown", async ({ page }) => {
    const failures = await startGame(page, SIDESCROLLER);
    const before = await readProbe(page);
    expect(before.score, "the run starts with nothing taken").toBe(0);
    expect(before.position.x).toBeCloseTo(2.5, 1);

    const walk = await holdUntil(page, ["d"], (reading) => reading.score >= 1);
    expect(walk.reading.score, `no coin was taken in ${String(walk.frames)} frames`).toBe(1);
    // The coin is past the slope, so scoring it also proves the climb happened.
    expect(walk.reading.position.x).toBeGreaterThan(12);
    expect(walk.reading.position.y).toBeGreaterThan(3.9);

    // Taking a coin asks `SaveGame` for a checkpoint, and the checkpoint shows itself as a toast.
    await expect(page.locator(".ignifx-ui-toast").first()).toBeVisible();
    await expect(page.locator(".hud")).toHaveText(/1 coin/u);
    expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
  });

  // The whole of "variable jump height": one clamp on the release edge. A one-frame tap has to
  // clear a tile anyway — `minJumpHeight` is 1.1 m — and a held button has to reach the full
  // `jumpSpeed` arc of 3.42 m, which is what every coin over a plank is placed against. The bug
  // this replaces multiplied the rise by 0.45 on *every* step the button was up, so the same launch
  // reached 0.41 m or 3.42 m depending on how many frames the tap happened to cover.
  test("2d-sidescroller: a tapped jump clears a tile and a held jump reaches the plank", async ({ page }) => {
    const failures = await startGame(page, SIDESCROLLER);

    const tapped = await measureJump(page, 1);
    expect(tapped, "the shortest possible tap must still clear a tile").toBeGreaterThan(1);
    expect(tapped, "a tap must not reach the top of the arc").toBeLessThan(2);

    await waitForFrames(page, KEY_HOLD_FRAMES);
    const held = await measureJump(page, 16);
    // The planks sit three metres above the ground they are reached from.
    expect(held, "a held jump must reach the planks").toBeGreaterThan(3);
    expect(held, "and no further than the arc `jumpSpeed` and `riseGravity` describe").toBeLessThan(3.8);
    expect(held - tapped, "the two must be visibly different jumps").toBeGreaterThan(1);
    expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
  });

  // The level's first slope rises one metre over one cell at x = 8, and the run is rotated onto it,
  // so it is climbed at the run speed rather than at its cosine. The wall rule this depends on is
  // read from contact normals: the short-move test it replaces fired on every slope and collapsed
  // the stored speed each step, which is what made the hill a crawl.
  test("2d-sidescroller: the first slope is climbed at running speed", async ({ page }) => {
    const failures = await startGame(page, SIDESCROLLER);
    const climb = await holdUntil(page, ["d"], (reading) => reading.position.y >= 4, SLOPE_BUDGET_FRAMES);
    expect(
      climb.reading.position.y,
      `the character was at y = ${climb.reading.position.y.toFixed(2)} after ${String(climb.frames)} frames`,
    ).toBeGreaterThanOrEqual(4);
    expect(climb.reading.grounded, "and it should be standing on the shelf, not sailing over it").toBe(true);
    expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
  });

  // The pit at x = 20 to 24 has no floor. Falling into it used to be permanent — the character fell
  // for ever behind a camera clamped at the level's lower bound — and now puts it back on the last
  // ground it stood on, which is the lip it ran off, with the coins it had already taken.
  test("2d-sidescroller: falling into the pit puts the character back on its lip", async ({ page }) => {
    const failures = await startGame(page, SIDESCROLLER);
    const fall = await holdUntil(page, ["d"], (reading) => reading.position.y < -1);
    expect(
      fall.reading.position.y,
      `the character never reached the pit in ${String(fall.frames)} frames`,
    ).toBeLessThan(-1);
    const score = fall.reading.score;

    // Nothing is held now, so the only thing that can move the character is the respawn.
    const back = await holdUntil(page, [], (reading) => reading.position.y > 0, FLIGHT_FRAMES);
    expect(back.reading.position.y, "the fall should have ended").toBeGreaterThan(0);
    expect(back.reading.position.y).toBeCloseTo(3, 0);
    // The lip of the first pit, not the spawn and not the far side.
    expect(back.reading.position.x).toBeGreaterThan(19);
    expect(back.reading.position.x).toBeLessThan(21);
    expect(back.reading.respawn?.x).toBeCloseTo(back.reading.position.x, 1);
    expect(back.reading.score, "a fall costs progress through the level, not the coins already taken").toBe(score);
    expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
  });

  // The shrine is a trigger the size of the pad it is drawn on. Standing on it lights it, scores
  // the run and autosaves — and, before the same `@ignifx/physics-2d` fix, the pad was solid to the
  // character controller and the player simply walked into it. Getting there means stepping around
  // the barrel on the path, which is what the props are there to demonstrate.
  test("2d-topdown: walking onto the shrine pad lights it", async ({ page }) => {
    const failures = await startGame(page, TOPDOWN);
    const before = await readProbe(page);
    expect(before.score).toBe(0);
    expect(before.lit).toEqual([]);

    // South of the path's centre line first, to clear the barrel at (18.5, 10.2); then east until
    // the character is standing on the pad's column, then north onto the pad itself.
    //
    // The eastward leg stops at the pad's *left* edge rather than at its middle. A reading is taken
    // every `PROBE_POLL_FRAMES` frames and a frame on a loaded machine carries more simulated time
    // than one on an idle machine, so where the walk stops is only bounded from below — aiming at
    // 25.4 put it past the far edge of a one-metre pad on a busy run, and the character then walked
    // north beside the shrine instead of over it.
    const south = await holdUntil(page, ["s"], (reading) => reading.position.y <= 9.4);
    expect(south.reading.position.y, "the character should be south of the barrel's row").toBeLessThan(9.5);
    const east = await holdUntil(page, ["d"], (reading) => reading.position.x >= SHRINE_PAD_LEFT);
    expect(east.reading.position.x, "the walk east should end on the pad's column").toBeGreaterThan(SHRINE_PAD_LEFT);
    expect(east.reading.position.x, "and not past it").toBeLessThan(SHRINE_PAD_LEFT + 1);
    const lit = await holdUntil(page, ["w"], (reading) => reading.score >= 1);
    expect(lit.reading.lit, `the shrine did not light in ${String(lit.frames)} frames`).toEqual(["Shrine"]);
    expect(lit.reading.score).toBe(1);
    // The camera follows through a dead zone of 1.5 by 1, so it trails the character rather than
    // being pinned to it — but never by more than the dead zone plus a frame of damping.
    expect(Math.abs((lit.reading.camera?.x ?? 0) - lit.reading.position.x)).toBeLessThan(2);
    expect(Math.abs((lit.reading.camera?.y ?? 0) - lit.reading.position.y)).toBeLessThan(2);

    await expect(page.locator(".ignifx-ui-toast").first()).toBeVisible();
    await expect(page.locator(".hud")).toHaveText(/1 shrine lit/u);
    expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
  });
});

// 3D gameplay. Everything below this line belongs to one `describe` block; nothing above it is
// touched.

/**
 * One reading of a 3D template's `?probe=1` hook, `window.__ignifxGameplay.snapshot()`.
 *
 * @remarks
 * The shared half is required and each template's own extras are optional, for the same reason the
 * 2D interface above is shaped this way: one hook name carries two shapes, and a declaration that
 * was the union of both would let a first-person test read the boom and still compile.
 */
interface Gameplay3DSnapshot {
  /** The camera's orbit yaw, or the body's yaw, in degrees. */
  readonly yaw: number;
  /** The camera's orbit pitch, or the head's, in degrees. */
  readonly pitch: number;
  /** The character's world position, in metres. */
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  /** Whether the canvas holds the pointer. */
  readonly pointerLocked: boolean;
  /** Whether the world is stopped. */
  readonly paused: boolean;
  /** Third person only: where the boom ends after the collision sweep, in metres. */
  readonly boom?: number;
  /** Third person only: where the camera is, in metres. */
  readonly camera?: { readonly x: number; readonly y: number; readonly z: number };
  /** First person only: the head's local height above the capsule's centre, in metres. */
  readonly headHeight?: number;
}

/** The viewport these tests run at, and therefore where the middle of the canvas is. */
const CANVAS_CENTRE = { x: 320, y: 240 } as const;

/** Degrees of look per CSS pixel of mouse motion; both rigs are built with this `sensitivity`. */
const DEGREES_PER_PIXEL = 0.1;

/** How far the first-person head may travel from its rest height, in metres: `headBobAmplitude`. */
const HEAD_BOB_AMPLITUDE = 0.025;

/** Where the first-person head sits when the character is standing still, in metres: `EYE_OFFSET`. */
const HEAD_REST_HEIGHT = 0.72;

/** How many presented frames a look or a click is given to reach the rig. */
const SETTLE_FRAMES_3D = 8;

/** How many presented frames pass between two readings while a key or a stick is held. */
const POLL_FRAMES_3D = 5;

/** How many presented frames a walk or an orbit is given before the test gives up. */
const BUDGET_FRAMES_3D = 400;

/**
 * The last of a run of readings.
 *
 * @param readings - The readings, oldest first; never empty, because every poll takes one before
 * it starts.
 * @returns The newest reading.
 */
function newest(readings: readonly Gameplay3DSnapshot[]): Gameplay3DSnapshot {
  const last = readings.at(-1);
  if (last === undefined) {
    throw new Error("no probe readings were taken.");
  }
  return last;
}

/**
 * Reads a 3D template's `?probe=1` hook.
 *
 * @param page - The page under test.
 * @returns The current reading.
 */
async function read3D(page: Page): Promise<Gameplay3DSnapshot> {
  const reading = await readGameplayHook(page);
  if (!isGameplay3DSnapshot(reading)) {
    throw new Error("window.__ignifxGameplay.snapshot() did not answer with a 3D reading.");
  }
  return reading;
}

/**
 * Whether a probe reading has the fields every 3D template's snapshot carries.
 *
 * @param value - Whatever the page answered.
 * @returns `true` for a 3D reading.
 */
function isGameplay3DSnapshot(value: unknown): value is Gameplay3DSnapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    "yaw" in value &&
    "pitch" in value &&
    "position" in value &&
    "pointerLocked" in value
  );
}

/**
 * Opens a 3D template with its probe installed and leaves the title screen for the game.
 *
 * @param page - The page under test.
 * @param url - The template's origin.
 * @returns The list the page's uncaught errors are collected into.
 */
async function start3D(page: Page, url: string): Promise<string[]> {
  const failures = await openScene(page, `${url}/?probe=1`);
  await page.locator('[data-menu="title"] [data-row="new-game"]').click();
  await waitForFrames(page, SETTLE_FRAMES_3D);
  return failures;
}

/**
 * Moves the mouse to the middle of the canvas and then by a measured offset, so the delta the rig
 * sees is exactly the offset.
 *
 * @remarks
 * Playwright's mouse position is absolute and persists between calls, and a locked pointer turns
 * every move into a look — including the move back to the middle. Parking at the middle first,
 * and letting those frames present before the reading is taken, is what makes the second move the
 * only motion between the two readings.
 *
 * @param page - The page under test.
 * @param dx - CSS pixels to the right.
 * @param dy - CSS pixels down.
 * @returns The readings before and after the offset.
 */
async function lookBy(
  page: Page,
  dx: number,
  dy: number,
): Promise<{ readonly before: Gameplay3DSnapshot; readonly after: Gameplay3DSnapshot }> {
  await page.mouse.move(CANVAS_CENTRE.x, CANVAS_CENTRE.y);
  await waitForFrames(page, SETTLE_FRAMES_3D);
  const before = await read3D(page);
  await page.mouse.move(CANVAS_CENTRE.x + dx, CANVAS_CENTRE.y + dy);
  await waitForFrames(page, SETTLE_FRAMES_3D);
  return { before, after: await read3D(page) };
}

/**
 * Clicks the middle of the canvas, which is the gesture both rigs treat as "give me the pointer".
 *
 * @param page - The page under test.
 * @returns Whether the browser granted the lock.
 */
async function takePointer(page: Page): Promise<boolean> {
  await page.mouse.click(CANVAS_CENTRE.x, CANVAS_CENTRE.y);
  await waitForFrames(page, SETTLE_FRAMES_3D);
  return (await read3D(page)).pointerLocked;
}

/**
 * Holds one key until a reading satisfies the predicate, or the budget runs out.
 *
 * @param page - The page under test.
 * @param key - The key to hold, or `null` to poll without pressing anything.
 * @param done - What the test is waiting for.
 * @param budget - How many presented frames to allow.
 * @returns Every reading taken, oldest first.
 */
async function hold3DUntil(
  page: Page,
  key: string | null,
  done: (reading: Gameplay3DSnapshot) => boolean,
  budget: number = BUDGET_FRAMES_3D,
): Promise<readonly Gameplay3DSnapshot[]> {
  if (key !== null) {
    await page.keyboard.down(key);
  }
  const readings: Gameplay3DSnapshot[] = [await read3D(page)];
  let frames = 0;
  while (frames < budget && !done(newest(readings))) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- frames are sequential by definition, and each reading has to be of the frame that was just presented.
    await waitForFrames(page, POLL_FRAMES_3D);
    frames += POLL_FRAMES_3D;
    // oxlint-disable-next-line eslint/no-await-in-loop -- see above.
    readings.push(await read3D(page));
  }
  if (key !== null) {
    await page.keyboard.up(key);
  }
  await waitForFrames(page, 2);
  return readings;
}

/**
 * Pushes an on-screen stick to full deflection and holds it until the predicate is satisfied.
 *
 * @remarks
 * `VirtualJoystick` writes `<Virtual>/<control>` from `pointerdown`/`pointermove` on its own pad,
 * so a mouse press and drag over the pad is the same gesture a thumb makes. The offset is well past
 * the pad's 44-pixel radius, which is what full deflection means.
 *
 * @param page - The page under test.
 * @param control - The stick's `aria-label`, which `VirtualJoystick` sets to its control name.
 * @param dx - Which way to push, horizontally.
 * @param dy - Which way to push, vertically; negative is up.
 * @param done - What the test is waiting for.
 * @returns Every reading taken, oldest first.
 */
async function pushStickUntil(
  page: Page,
  control: string,
  dx: number,
  dy: number,
  done: (reading: Gameplay3DSnapshot) => boolean,
): Promise<readonly Gameplay3DSnapshot[]> {
  const pad = page.locator(`[aria-label="${control}"]`);
  const box = await pad.boundingBox();
  expect(box, `the on-screen ${control} stick is not on the page`).not.toBeNull();
  const centre = { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + dx, centre.y + dy);
  const readings: Gameplay3DSnapshot[] = [await read3D(page)];
  let frames = 0;
  while (frames < BUDGET_FRAMES_3D && !done(newest(readings))) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- frames are sequential by definition; see `hold3DUntil`.
    await waitForFrames(page, POLL_FRAMES_3D);
    frames += POLL_FRAMES_3D;
    // oxlint-disable-next-line eslint/no-await-in-loop -- see above.
    readings.push(await read3D(page));
  }
  await page.mouse.up();
  await waitForFrames(page, 2);
  return readings;
}

/**
 * The gameplay half of the two 3D templates, driven through the `?probe=1` hook each of them
 * installs (`src/gameplay-probe.ts`) rather than through screenshots. The four goldens above stay
 * exactly as they are.
 *
 * ## Pointer lock, and what a headless browser will and will not do
 *
 * Both rigs run with `lockPointerOnClick`, so mouse look waits for the lock and a hint line asks
 * the player for the click. Measured on 2026-09-08 in this suite's Chromium on macOS: a synthetic
 * `page.mouse.click` on the canvas **is** granted the lock, so the mouse half is tested for real —
 * but Escape does **not** release it the way a real browser does, and while the canvas holds the
 * pointer every synthetic click is routed to the canvas rather than to the menu that is on top of
 * it. Tests that need the menu therefore never take the lock, or give it back by hand.
 *
 * A runner that refuses the lock outright is still a possibility, so the two tests that can only
 * assert something once it is held skip themselves rather than fail. Everything the fixes are
 * really about — the hint, the gate on unlocked mouse look, the boom that no longer collapses into
 * the character, the head bob, the click that must not flip a pedestal — is asserted without it.
 *
 * ## Why some of it is driven with the on-screen sticks
 *
 * `<Virtual>` look is never gated on the lock, which makes a `hasTouch` context the one place a
 * test can turn the view with no lock at all. It is also the only way to cover the touch pads,
 * whose `scale(18)` processors were removed from both `game.input.json` in the same change.
 */
test.describe("3d template gameplay", () => {
  test.use({ viewport: { width: 640, height: 480 } });

  // The regression the hint exists for: with `lockPointerOnClick` on, a cursor crossing the canvas
  // is not a look gesture, and without a line saying so the first thing a player does is move the
  // mouse, see nothing happen, and conclude the demo is broken.
  test("3d-third-person: the hint asks for a click, and an unlocked mouse leaves the camera alone", async ({
    page,
  }) => {
    const failures = await start3D(page, THIRD_PERSON);
    const hint = page.locator(".lock-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(/Click to look/u);

    const before = await read3D(page);
    expect(before.pointerLocked).toBe(false);
    // Straight across the canvas and back, the way a cursor travels towards a menu button. Before
    // the rig gated it, this swung the camera through tens of degrees.
    await page.mouse.move(80, 80);
    await page.mouse.move(560, 400);
    await page.mouse.move(320, 120);
    await waitForFrames(page, SETTLE_FRAMES_3D);
    const after = await read3D(page);
    expect(after.yaw).toBeCloseTo(before.yaw, 4);
    expect(after.pitch).toBeCloseTo(before.pitch, 4);
    await expect(hint).toBeVisible();
    expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
  });

  // The other half of the same behaviour: once the browser hands the pointer over, the mouse orbits
  // at exactly `sensitivity` degrees per CSS pixel, and the hint takes itself away.
  test("3d-third-person: a click takes the pointer, the hint goes, and the mouse orbits", async ({ page }) => {
    const failures = await start3D(page, THIRD_PERSON);
    const locked = await takePointer(page);
    test.skip(!locked, "this browser refused the pointer lock; the click-to-lock path needs it");

    await expect(page.locator(".lock-hint")).toBeHidden();
    const yawed = await lookBy(page, 300, 0);
    expect(yawed.after.yaw - yawed.before.yaw).toBeCloseTo(300 * DEGREES_PER_PIXEL, 1);
    // Forward on the mouse aims the camera up, which lowers the boom's pitch. `invertY` is off and
    // the rigs normalise the axis per device, so this is the same direction a stick pushed up gives.
    const pitched = await lookBy(page, 0, -100);
    expect(pitched.after.pitch - pitched.before.pitch).toBeCloseTo(-100 * DEGREES_PER_PIXEL, 1);
    expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
  });

  // Movement is camera-relative through `mainCameraForward`, so W walks away from the camera
  // whichever way the rig is pointing, and the boom stays out at its full length in the open.
  test("3d-third-person: W walks the character along the camera's forward", async ({ page }) => {
    const failures = await start3D(page, THIRD_PERSON);
    const start = await read3D(page);
    expect(start.boom ?? 0).toBeGreaterThan(4);
    const readings = await hold3DUntil(page, "w", (reading) => {
      return Math.hypot(reading.position.x - start.position.x, reading.position.z - start.position.z) > 1.5;
    });
    const end = newest(readings);
    const moved = { x: end.position.x - start.position.x, z: end.position.z - start.position.z };
    const travelled = Math.hypot(moved.x, moved.z);
    expect(
      travelled,
      `the character did not walk in ${String(readings.length * POLL_FRAMES_3D)} frames`,
    ).toBeGreaterThan(1.5);

    // The camera's forward, from where it sits towards the character it frames.
    const eye = start.camera ?? start.position;
    const forward = { x: start.position.x - eye.x, z: start.position.z - eye.z };
    const cosine = (moved.x * forward.x + moved.z * forward.z) / (travelled * Math.hypot(forward.x, forward.z));
    expect(cosine, "W should walk away from the camera").toBeGreaterThan(0.9);
    expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
  });

  // Gamepad-free, and with no pointer lock taken, so the menu is the only thing the clicks can
  // reach. `paused` is read from the probe rather than inferred from the DOM.
  test("3d-third-person: Escape opens the pause menu and Resume gives the game back", async ({ page }) => {
    const failures = await start3D(page, THIRD_PERSON);
    expect((await read3D(page)).paused).toBe(false);
    const hint = page.locator(".lock-hint");
    await expect(hint).toBeVisible();

    await holdKey(page, "Escape");
    const pause = page.locator('[data-menu="pause"]');
    await expect(pause).toBeVisible();
    expect((await read3D(page)).paused).toBe(true);
    // The hint is about a click that would mean "choose a row" while a menu is up.
    await expect(hint).toBeHidden();

    await pause.locator('[data-row="resume"]').click();
    await expect(pause).toBeHidden();
    await waitForFrames(page, SETTLE_FRAMES_3D);
    expect((await read3D(page)).paused).toBe(false);
    await expect(hint).toBeVisible();
    expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
  });

  test("3d-first-person: the hint asks for a click, and an unlocked mouse leaves the view alone", async ({ page }) => {
    const failures = await start3D(page, FIRST_PERSON);
    const hint = page.locator(".lock-hint");
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(/Click to look/u);

    const before = await read3D(page);
    expect(before.pointerLocked).toBe(false);
    await page.mouse.move(80, 80);
    await page.mouse.move(560, 400);
    await page.mouse.move(320, 120);
    await waitForFrames(page, SETTLE_FRAMES_3D);
    const after = await read3D(page);
    expect(after.yaw).toBeCloseTo(before.yaw, 4);
    expect(after.pitch).toBeCloseTo(before.pitch, 4);
    expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
  });

  // The head bob is the "jumpy" the template shipped with: 0.035 m at the engine's default 1.8 bobs
  // per metre is seven bobs a second at a 4 m/s walk, which reads as a shake. It is 0.025 m at
  // 0.5 bobs per metre now — two bobs a second, a footfall cadence — and the bounds below are what
  // says so without depending on where in the cycle a frame happened to land.
  test("3d-first-person: walking bobs the head by the authored amount, and standing still does not", async ({
    page,
  }) => {
    const failures = await start3D(page, FIRST_PERSON);
    const idle = await hold3DUntil(page, null, (_reading) => false, POLL_FRAMES_3D * 3);
    for (const reading of idle) {
      expect(reading.headHeight ?? Number.NaN).toBeCloseTo(HEAD_REST_HEIGHT, 5);
    }

    const walked = await hold3DUntil(page, "w", (reading) => reading.position.z > 4.5);
    // A character wedged in scenery still *reports* a walking speed, and would still bob; asserting
    // that it actually travelled is what stops this test passing over a spawn that cannot move.
    expect(newest(walked).position.z, "the character did not walk forward").toBeGreaterThan(4.5);
    const heights = walked.map((reading) => reading.headHeight ?? Number.NaN);
    const low = Math.min(...heights);
    const high = Math.max(...heights);
    expect(low, "the head dipped further than headBobAmplitude").toBeGreaterThanOrEqual(
      HEAD_REST_HEIGHT - HEAD_BOB_AMPLITUDE - 0.001,
    );
    expect(high, "the head rose further than headBobAmplitude").toBeLessThanOrEqual(
      HEAD_REST_HEIGHT + HEAD_BOB_AMPLITUDE + 0.001,
    );
    expect(high - low, "the head did not bob at all").toBeGreaterThan(0.005);
    expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
  });

  /**
   * The two tests a `hasTouch` context buys: `<Virtual>` look is never gated on the pointer lock,
   * so the view can be turned with nothing held, and the on-screen pads are covered at the same
   * time. Both templates build the sticks from `navigator.maxTouchPoints`, and neither builds the
   * click-to-look hint here — a phone has no pointer to lock and telling it to click would be a lie.
   */
  test.describe("with the on-screen sticks", () => {
    test.use({ hasTouch: true });

    // The bug behind "the camera on the third-person example does not behave correctly". The boom
    // sweeps a sphere from the pivot out to the camera, and `app.physics.shapeCast` reports a hit
    // for every body in the world — `layerMask` only decides which entity it *names* — so
    // `collisionLayers` could not keep the character's own capsule out of the sweep. Orbiting past
    // it collapsed the boom to zero and put the camera inside the character's head, over roughly
    // half of every turn. The pivot now sits above the capsule and `minPitch` is 0, so a full orbit
    // in the open leaves the boom at its full length.
    test("3d-third-person: a full orbit on the look pad never collapses the boom", async ({ page }) => {
      const failures = await start3D(page, THIRD_PERSON);
      await expect(page.locator(".lock-hint")).toHaveCount(0);
      const start = await read3D(page);
      const readings = await pushStickUntil(page, "look", 70, 0, (reading) => reading.yaw - start.yaw >= 360);
      const end = newest(readings);
      expect(end.yaw - start.yaw, "the stick did not turn the camera all the way round").toBeGreaterThanOrEqual(360);

      const shortest = Math.min(...readings.map((reading) => reading.boom ?? 0));
      expect(shortest, "the boom collapsed during the orbit").toBeGreaterThan(4);
      expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
    });

    // `Interact` is bound to <kbd>E</kbd> *and* to the left mouse button, and the left mouse button
    // is also what asks for pointer lock. The click that gives the player their view back must not
    // flip whichever pedestal happens to be under the crosshair; `Interactor` reads
    // `InputAction.activeDevice` and ignores a mouse press until the lock is held.
    test("3d-first-person: an unlocked click does not toggle a pedestal, and E does", async ({ page }) => {
      const failures = await start3D(page, FIRST_PERSON);
      const hud = page.locator(".hud");
      // Down about ten degrees, which is where the pedestal straight ahead of the spawn sits.
      const aimed = await pushStickUntil(page, "look", 0, 70, (reading) => reading.pitch >= 9);
      expect(newest(aimed).pitch, "the look pad did not aim down").toBeGreaterThanOrEqual(9);
      await hold3DUntil(page, "w", (reading) => reading.position.z > 4.4);
      await expect(hud).toHaveText(/press E or click/u);
      await expect(hud).toHaveText(/No pedestals lit/u);

      // The click asks for the pointer, and that is all it may do.
      await page.mouse.click(CANVAS_CENTRE.x, CANVAS_CENTRE.y);
      await waitForFrames(page, SETTLE_FRAMES_3D);
      await expect(hud).toHaveText(/No pedestals lit/u);

      await holdKey(page, "e");
      await expect(hud).toHaveText(/1 pedestal lit/u);
      expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
    });
  });
});
