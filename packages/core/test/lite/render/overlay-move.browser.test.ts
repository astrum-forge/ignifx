import {
  addToScene,
  createBox,
  createSpriteRenderer,
  createStandardMaterial,
  getRenderingContexts,
  registerScene,
  registerSpriteRenderer,
} from "@babylonjs/lite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addCameraAndLight, createBrowserApp, SETTLE_FRAMES } from "../../render/support/browser-harness.js";
import type { BrowserApp } from "../../render/support/browser-harness.js";
import type * as Lite from "@babylonjs/lite";

/**
 * A render overlay whose move to the end of the context list fails (`docs/architecture/07-rendering.md`
 * §2.10): the failure is reported through `app.onError` and the move is tried again on the next frame.
 *
 * `registerScene` is wrapped so a test can make one call reject, the way a lost device or a pipeline
 * that does not compile would. The wrapper calls Lite's own function otherwise, so the render scene
 * registers as usual.
 */

vi.mock("@babylonjs/lite", async (importOriginal) => {
  const lite = await importOriginal<typeof Lite>();
  return { ...lite, registerScene: vi.fn(lite.registerScene) };
});

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
  vi.mocked(registerScene).mockClear();
});

/**
 * Starts an app with a camera, an open overlay holding a box, and a sprite renderer about to be
 * registered after it.
 *
 * @param failures - How many of the overlay's next registrations reject.
 * @returns The app and the overlay's scene.
 */
async function overlayFollowedBySprites(failures: number): Promise<{ running: BrowserApp; scene: object }> {
  const running = await createBrowserApp({ size: 32, startEmpty: false });
  harness = running;
  addCameraAndLight(running, 4);
  await running.start();
  const overlay = await running.app.renderer.openOverlay();
  const box = createBox(running.renderer.engine, { size: 1 });
  box.material = createStandardMaterial();
  addToScene(overlay.lite.scene, box);
  await running.advance(2);
  for (let failure = 0; failure < failures; failure += 1) {
    vi.mocked(registerScene).mockRejectedValueOnce(new Error(`registration ${String(failure + 1)} failed`));
  }
  registerSpriteRenderer(createSpriteRenderer(running.renderer.engine, { layers: [], clear: false }));
  await running.advance(SETTLE_FRAMES);
  return { running, scene: overlay.lite.scene };
}

describe("a render overlay whose move fails", () => {
  it("reports the failure through app.onError and moves on the next frame", async () => {
    const { running, scene } = await overlayFollowedBySprites(1);

    expect(running.errors.map((report) => String(report.error))).toEqual(["Error: registration 1 failed"]);
    expect(running.errors[0]?.source).toBe("system");
    expect(getRenderingContexts(running.renderer.engine).at(-1)).toBe(scene);
  }, 60_000);

  it("gives up after three attempts and stays detached, reporting each", async () => {
    const { running, scene } = await overlayFollowedBySprites(3);

    expect(running.errors).toHaveLength(3);
    expect(getRenderingContexts(running.renderer.engine)).not.toContain(scene);
  }, 60_000);
});
