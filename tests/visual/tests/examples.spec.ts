// oxlint-disable no-underscore-dangle -- `window.__ignifxReady` is a test hook, and the double
// underscore is what says it is not part of the game's API. The visual suite reads it by name.
import { expect, test } from "playwright/test";
import { CATALOGUE } from "../../../website/examples/catalogue.ts";
import type { ExampleEntry } from "../../../website/examples/catalogue.ts";
import type { Page } from "playwright/test";

/**
 * The website's runnable examples, each against a committed golden
 * (`website/plan/04-examples-platform.md` §6, `08-execution.md` §4.4).
 *
 * These are the pages a visitor actually opens. They are served from the **site build**, not from
 * an example's own dev server: `playwright.config.ts`'s last `webServer` entry runs
 * `pnpm --filter @ignifx/website build` and previews `website/dist` on port 4179, so every golden
 * here is a golden of the deployed artefact — the run page at its real URL, its assets at their
 * hashed URLs under `/examples/assets/`, the shared vendor chunk shared.
 *
 * ## What is being defended
 *
 * An example is the site's proof, so a broken one has to fail CI before it reaches the site. The
 * failure modes this catches are not subtle: an asset whose address no longer resolves under
 * `/examples/`, a `PostProcessStack` that presents black because its feature was not declared, a
 * light that shades from the wrong side, a model that lost its shadow, a texture bound while it was
 * still loading. Every one of those has happened in this repository at least once
 * (`tests/visual/README.md`, "Four engine defects these goldens found").
 *
 * ## The viewport, and the URLs
 *
 * 640 by 360: 16:9, which is the aspect every example is composed for, and small enough to keep
 * SwiftShader honest and the images reviewable.
 *
 * A kit example is opened at `?static=1&nopanel=1&seed=1` — the same URL
 * `website/examples/_tools/capture-posters.ts` captures the poster from, so the golden and the
 * poster are the same frame at two sizes. `?static=1` stops the clock **before** `app.start()`, so
 * no fixed step ever runs and the frame is exactly what was authored rather than the scene a few
 * hundred milliseconds after it loaded. `?nopanel=1` leaves the parameter panel off, because a
 * golden should not depend on how the runner draws a system font, and `?seed=1` pins anything an
 * example randomises (nothing does yet; the kit's generator exists so that stays true).
 *
 * A **template** entry is a different thing: its run page is the template's own build, with its own
 * flags and no kit at all. It is opened at `?static=1&hud=1`, the frame `capture-posters.ts` takes
 * for it, which is the authored scene with the DOM overlay left on.
 *
 * ## Tolerances
 *
 * `maxDiffPixelRatio` is per example, as coding standards §10 requires, and each one below carries
 * its reason. The goldens were generated on macOS arm64 with Playwright 1.63's Chromium on
 * SwiftShader; `snapshotPathTemplate` drops the platform segment, so the same image is compared on
 * macOS and on Linux CI and the tolerance has to absorb the difference between two SwiftShader
 * builds. Regenerate only in a pull request that shows before and after images (standards §10):
 * `pnpm --filter ignifx-visual-tests run test:visual:update`.
 */

declare global {
  interface Window {
    /** Resolves once the example has presented a settled frame. Set by the kit, or by a template. */
    __ignifxReady: Promise<"ready" | "unsupported">;
  }
}

/** Where the site build is previewed. `playwright.config.ts` owns the number. */
const SITE = "http://127.0.0.1:4179";

/** What a golden allows, per example, and why. */
interface Golden {
  /** The catalogue slug, which is also the golden's file stem. */
  readonly slug: string;
  /** `maxDiffPixelRatio`. */
  readonly tolerance: number;
  /** One line: what in this frame needs the tolerance it has. */
  readonly reason: string;
}

/**
 * Every catalogue slug, with its tolerance.
 *
 * @remarks
 * Written out rather than derived, because a tolerance is a judgement about what a particular frame
 * contains and there is no honest default. The first test below asserts that this list and
 * `CATALOGUE` name the same slugs, so adding an example to the site without a golden fails here
 * rather than shipping unwatched.
 */
const GOLDENS: readonly Golden[] = [
  {
    slug: "hello-cube",
    tolerance: 0.02,
    reason: "one MSAA-resolved silhouette and one soft shadow edge over a flat, unlit floor",
  },
  {
    slug: "pbr-model",
    tolerance: 0.05,
    reason: "IBL specular, an ESM shadow and a bloom pass each spread a subpixel difference across the frame",
  },
  {
    slug: "2d-topdown",
    tolerance: 0.02,
    reason: "nearest-sampled axis-aligned pixel art, no MSAA and no lighting, plus the HUD's system font",
  },
  {
    slug: "2d-sidescroller",
    tolerance: 0.02,
    reason: "nearest-sampled axis-aligned pixel art, no MSAA and no lighting, plus the HUD's system font",
  },
  {
    slug: "3d-third-person",
    tolerance: 0.05,
    reason: "a PCF shadow edge and anisotropic floor mips across a 4x MSAA frame round differently per rasteriser",
  },
  {
    slug: "3d-first-person",
    tolerance: 0.05,
    reason: "a PCF shadow edge and anisotropic floor mips across a 4x MSAA frame round differently per rasteriser",
  },
  {
    slug: "tilemap",
    tolerance: 0.01,
    reason:
      "nearest-sampled axis-aligned tiles at a whole-number zoom: every pixel is a texel, so almost nothing may move",
  },
  {
    slug: "sprite-animation",
    tolerance: 0.01,
    reason: "nearest-sampled pixel-art sprites on a flat sky and a static ground strip; no MSAA, no lighting",
  },
  {
    slug: "platformer-controller",
    tolerance: 0.01,
    reason: "nearest-sampled tiles and one sprite frozen before the first fixed step; no MSAA, no lighting",
  },
  {
    slug: "physics-2d",
    tolerance: 0.01,
    reason: "a frozen stack of nearest-sampled crates and coins over flat ground; no MSAA, no lighting",
  },
  {
    slug: "model-loading",
    tolerance: 0.03,
    reason: "IBL specular on a normal-mapped wooden post, plus one long PCF shadow edge across a tiled grid floor",
  },
  {
    slug: "material-grid",
    tolerance: 0.04,
    reason: "thirty-six spheres whose whole content is a prefiltered probe reflection: every mip choice shows",
  },
  {
    slug: "skinned-animation",
    tolerance: 0.03,
    reason: "a skinned pose resolved on the GPU, with flat-shaded facet edges and a soft shadow over a grid floor",
  },
  {
    slug: "third-person",
    tolerance: 0.04,
    reason:
      "four PCF shadow edges over a tiled grid floor at 4x MSAA, and a flat-shaded rig whose facet edges resolve " +
      "differently per rasteriser",
  },
  {
    slug: "animator",
    tolerance: 0.05,
    reason:
      "a skinned pose blended from two clips on the GPU: every facet edge on the fox and its whole soft shadow " +
      "move together when a rasteriser rounds a joint matrix differently",
  },
  {
    slug: "lights",
    tolerance: 0.04,
    reason:
      "two PCF shadow edges, a point light's falloff across a tiled grid floor, and two alpha-blended gizmos over " +
      "all of it",
  },
  {
    slug: "shadows",
    tolerance: 0.04,
    reason: "nine PCF shadow edges over a grid floor that runs to forty metres, every one of them a filtered lookup",
  },
  {
    slug: "ibl",
    tolerance: 0.04,
    reason: "fourteen spheres whose whole content is a prefiltered probe reflection: every mip choice shows",
  },
  {
    slug: "tone-mapping",
    tolerance: 0.03,
    reason: "a normal-mapped glTF under IBL plus six emissive spheres, all of it through the ACES curve",
  },
  {
    slug: "physics-playground",
    tolerance: 0.03,
    reason:
      "fourteen MSAA-resolved silhouettes and their soft PCF shadows over a tiled grid floor: every crate edge " +
      "and every ball's terminator is a place two SwiftShader builds may round differently",
  },
  {
    slug: "character-controller",
    tolerance: 0.03,
    reason:
      "one capsule and three flat-shaded slabs at 4x MSAA, with a soft PCF shadow across a ramp and a grid floor " +
      "that runs to the edge of the frame",
  },
  {
    slug: "input-actions",
    tolerance: 0.02,
    reason: "thirty flat unlit panels behind 4x MSAA edges, plus one PCF shadow under the rover",
  },
  {
    slug: "audio-mixer",
    tolerance: 0.02,
    reason: "flat unlit geometry with no shadows: only the MSAA edges of the faders, the pads and the floor ring move",
  },
  {
    slug: "rebinding",
    tolerance: 0.02,
    reason: "four flat unlit caps and one lit sphere behind 4x MSAA edges, plus its soft shadow on the floor",
  },
  {
    slug: "bloom",
    tolerance: 0.05,
    reason: "a bloom pass spreads a blurred halo round ten emitters, and three of them clip to white",
  },
  {
    slug: "picking",
    tolerance: 0.05,
    reason: "seven PCF shadows and 4x MSAA silhouettes over anisotropic grid mips running to the horizon",
  },
  {
    slug: "ui-overlay",
    tolerance: 0.06,
    reason: "GPU-shaped glyphs and a DOM panel in the runner's system font, over PCF shadows and MSAA edges",
  },
  {
    slug: "devtools",
    tolerance: 0.06,
    reason: "380 px of the overlay's own DOM text, including the selected entity's id, which is new on every load",
  },
];

/**
 * The tolerance for one slug.
 *
 * @param slug - The catalogue slug.
 * @returns The `maxDiffPixelRatio`, or `null` when {@link GOLDENS} does not name it.
 */
function toleranceFor(slug: string): number | null {
  return GOLDENS.find((golden: Golden) => golden.slug === slug)?.tolerance ?? null;
}

/**
 * The run-page URL, query flags included, for one catalogue entry.
 *
 * @param entry - The catalogue entry.
 * @returns The URL to open.
 */
function urlFor(entry: ExampleEntry): string {
  const flags = entry.template === undefined ? "?static=1&nopanel=1&seed=1" : "?static=1&hud=1";
  return `${SITE}/examples/${entry.slug}/run/${flags}`;
}

/**
 * Opens a run page and waits for it to say it is on screen.
 *
 * @param page - The page under test.
 * @param url - The run-page URL, query flags included.
 */
async function openExample(page: Page, url: string): Promise<void> {
  const failures: string[] = [];
  page.on("pageerror", (error) => {
    failures.push(error.message);
  });
  await page.goto(url, { waitUntil: "load" });
  const status = await page.evaluate(() => window.__ignifxReady);
  expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
  expect(status, "the browser did not give the example a WebGPU device").toBe("ready");
}

test.describe("website examples", () => {
  // 16:9, the aspect every example is composed for.
  test.use({ viewport: { width: 640, height: 360 } });
  // A template's run page builds a whole game, and a cold SwiftShader adapter is not quick.
  test.setTimeout(180_000);

  test("every catalogue entry has a golden, and every golden has a catalogue entry", () => {
    const catalogued = CATALOGUE.map((entry: ExampleEntry) => entry.slug).toSorted();
    const covered = GOLDENS.map((golden: Golden) => golden.slug).toSorted();
    expect(covered, "add the new slug to GOLDENS with its tolerance and a reason, and commit its golden").toEqual(
      catalogued,
    );
  });

  for (const entry of CATALOGUE) {
    test(`${entry.slug}: the run page matches its golden`, async ({ page }) => {
      const tolerance = toleranceFor(entry.slug);
      expect(tolerance, `GOLDENS has no tolerance for ${entry.slug}`).not.toBeNull();
      await openExample(page, urlFor(entry));
      // An array, not `examples/<slug>.png`: `snapshotPathTemplate`'s `{arg}` sanitises a slash
      // out of a single-string name — measured 2026-09-07, it wrote `__screenshots__/
      // examples-hello-cube.png` — while the array form is Playwright's documented way to nest a
      // snapshot, and puts it at `__screenshots__/examples/<slug>.png` as `08-execution.md` §4.4
      // asks.
      await expect(page).toHaveScreenshot(["examples", `${entry.slug}.png`], {
        maxDiffPixelRatio: tolerance ?? 0,
      });
    });
  }
});
