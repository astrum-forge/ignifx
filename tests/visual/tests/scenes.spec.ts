// oxlint-disable no-underscore-dangle -- `window.__ignifxReady` is a test hook, and the double
// underscore is what says it is not part of the game's API. The visual suite reads it by name.
import { expect, test } from "playwright/test";
import type { Page } from "playwright/test";

/**
 * The four Phase 2 exit-criterion scenes (`docs/plan/engineering-plan.md`, Phase 2): a hello cube,
 * a PBR model with image-based lighting and shadows, an orthographic camera, and a post-process
 * stack — each against a committed golden.
 *
 * ## The defects the first rounds of goldens recorded are fixed
 *
 * The goldens generated on 2026-09-06 showed a scene lit from the wrong direction with no shadow
 * anywhere, and a post-process scene that was uniformly black. Both were engine defects, both are
 * fixed, and every golden here was regenerated afterwards: the hello cube casts a shadow across the
 * floor, and the post-process scene is a real image with a visible bloom. ADR-0002, "Corrections
 * after the visual suite", has the write-ups.
 *
 * The glTF viewer's model cast no shadow either — a separate defect, because `Model` declared
 * `castShadows` and nothing ever added its meshes to a generator's caster list (only `MeshRenderer`
 * implemented `collectCasters`), leaving its floor a shadow *catcher* with nothing to catch. That is
 * fixed too, and `gltf-viewer.png`/`gltf-viewer-post.png` were regenerated with the Box's shadow on
 * the floor. See `README.md`.
 *
 * ## Tolerances
 *
 * `maxDiffPixelRatio` is per scene, as standards §10 requires, and each is set from what the scene
 * actually contains rather than from one house number:
 *
 * | Scene                 | Ratio | Why                                                       |
 * | --------------------- | ----- | ---------------------------------------------------------- |
 * | hello cube            | 0.02  | One MSAA-resolved silhouette over a flat gradient          |
 * | orthographic camera   | 0.02  | Same scene, same edges, a different projection             |
 * | PBR model, IBL        | 0.03  | IBL specular varies with the prefiltered-probe sampler     |
 * | post-process stack    | 0.05  | Bloom and SMAA both spread a rasteriser difference around  |
 *
 * The goldens in `__screenshots__/` were generated on macOS arm64 with Playwright 1.63's Chromium
 * on SwiftShader. Regenerate them only in a pull request that shows before and after images
 * (standards §10) — `pnpm --filter ignifx-visual-tests run test:visual:update`.
 */

declare global {
  interface Window {
    /** Resolves once the example has presented a settled frame. Set by each example's `main.ts`. */
    __ignifxReady: Promise<"ready" | "unsupported">;
  }
}

const HELLO_CUBE = "http://127.0.0.1:4173";
const GLTF_VIEWER = "http://127.0.0.1:4174";

/**
 * Opens a scene and waits for it to say it is on screen.
 *
 * @param page - The page under test.
 * @param url - The example URL, query flags included.
 */
async function openScene(page: Page, url: string): Promise<void> {
  const failures: string[] = [];
  page.on("pageerror", (error) => {
    failures.push(error.message);
  });
  await page.goto(url, { waitUntil: "load" });
  const status = await page.evaluate(() => window.__ignifxReady);
  expect(failures, `the page reported errors: ${failures.join(" | ")}`).toEqual([]);
  expect(status, "the browser did not give the example a WebGPU device").toBe("ready");
}

test.describe("Phase 2 golden scenes", () => {
  test("hello cube", async ({ page }) => {
    await openScene(page, `${HELLO_CUBE}/?static=1`);
    await expect(page).toHaveScreenshot("hello-cube.png", { maxDiffPixelRatio: 0.02 });
  });

  test("orthographic camera", async ({ page }) => {
    await openScene(page, `${HELLO_CUBE}/?static=1&ortho=1`);
    await expect(page).toHaveScreenshot("hello-cube-orthographic.png", { maxDiffPixelRatio: 0.02 });
  });

  test("PBR model with image based lighting over a shadow catcher", async ({ page }) => {
    await openScene(page, `${GLTF_VIEWER}/?static=1`);
    await expect(page).toHaveScreenshot("gltf-viewer.png", { maxDiffPixelRatio: 0.03 });
  });

  // The chain reads the offscreen colour the scene was rendered into, which is what
  // `rendering.features.postProcessing` (declared in the example's `ignifx.config.ts`) buys.
  test("post-process stack", async ({ page }) => {
    await openScene(page, `${GLTF_VIEWER}/?static=1&post=1`);
    await expect(page).toHaveScreenshot("gltf-viewer-post.png", { maxDiffPixelRatio: 0.05 });
  });
});
