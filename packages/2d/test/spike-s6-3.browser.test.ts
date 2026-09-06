import { Vec2 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { Camera2D } from "../src/camera/camera-2d.js";
import { SpriteRenderer } from "../src/sprite/sprite-renderer.js";
import { createTwoDBrowserApp, fixtureAssets, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { Capture, Rgba, TwoDBrowserApp } from "./support/browser-harness.js";
import type { SpriteAtlasAsset } from "../src/atlas/sprite-atlas-asset.js";

/**
 * **Spike S6.3 — pixel-perfect** (`docs/plan/engineering-plan.md` Phase 6,
 * `docs/architecture/11-2d-toolkit.md` §4).
 *
 * The `checker.png` fixture is a 16x16 one-pixel magenta/black checkerboard: the worst case for any
 * filtering, because every texel borders four of the opposite colour. Crisp means every screen
 * pixel it covers is **pure** magenta or **pure** black; a single intermediate value is proof of a
 * blend.
 *
 * A display's device pixel ratio reaches a WebGPU app as the size of the swapchain backing store,
 * so 1x, 1.5x and 2x of a 64-CSS-pixel canvas are emulated as 64, 96 and 128 device pixels with the
 * reference resolution held at 64. That is the same arithmetic `Camera2D` sees on a real display.
 */

let harness: TwoDBrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The reference resolution the pixel-perfect camera scales by a whole number. */
const REFERENCE = 64;

/** How far a channel may drift on SwiftShader and still count as pure. */
const PURE_TOLERANCE = 6;

/** Whether a pixel is pure magenta or pure black — the checker's only two colours. */
function isPure(pixel: Rgba): boolean {
  const magenta =
    Math.abs(pixel.r - 255) <= PURE_TOLERANCE && pixel.g <= PURE_TOLERANCE && Math.abs(pixel.b - 255) <= PURE_TOLERANCE;
  const black = pixel.r <= PURE_TOLERANCE && pixel.g <= PURE_TOLERANCE && pixel.b <= PURE_TOLERANCE;
  return magenta || black;
}

/** Counts the pixels of a capture that are neither pure colour. */
function countBlended(shot: Capture): number {
  let blended = 0;
  for (let y = 0; y < shot.height; y += 1) {
    for (let x = 0; x < shot.width; x += 1) {
      if (!isPure(shot.at(x, y))) {
        blended += 1;
      }
    }
  }
  return blended;
}

/**
 * Renders the checker through a camera and returns the frame.
 *
 * @param backingStore - The swapchain size, in device pixels; the DPR emulation.
 * @param pixelPerfect - Whether the camera snaps zoom and position.
 * @param atlasAddress - Which checker atlas — `nearest` or `linear` sampling.
 * @param orthographicSize - The half-height a non-pixel-perfect camera uses.
 * @returns The captured frame and the zoom the camera resolved to.
 */
async function render(
  backingStore: number,
  pixelPerfect: boolean,
  atlasAddress: string,
  orthographicSize: number,
): Promise<{ shot: Capture; zoom: number }> {
  const running = await createTwoDBrowserApp({
    width: backingStore,
    height: backingStore,
    assets: fixtureAssets(),
    options: { pixelsPerUnit: 1 },
  });
  harness = running;
  const eye = running.world.createEntity("Camera");
  const camera = eye.addComponent(Camera2D);
  camera.pixelPerfect = pixelPerfect;
  camera.referenceResolution = { x: REFERENCE, y: REFERENCE };
  camera.orthographicSize = orthographicSize;
  const handle = running.app.assets.load<SpriteAtlasAsset>(atlasAddress);
  await running.advance(SETTLE_FRAMES);
  await handle.promise;
  const entity = running.world.createEntity("checker");
  entity.transform.position2D = new Vec2(0, 0);
  const sprite = entity.addComponent(SpriteRenderer);
  sprite.sprite = handle.retain();
  await running.advance(SETTLE_FRAMES);
  return { shot: await running.capture(), zoom: camera.zoom };
}

describe("S6.3 pixel-perfect", () => {
  for (const [label, backingStore, expectedZoom] of [
    ["1x", REFERENCE, 1],
    ["1.5x", Math.round(REFERENCE * 1.5), 1],
    ["2x", REFERENCE * 2, 2],
  ] as const) {
    it(`renders the checker crisp at DPR ${label}`, async () => {
      const { shot, zoom } = await render(backingStore, true, "2d/checker.atlas.json", 8);
      // Pixel-perfect scales the reference resolution by a whole number; 1.5x floors to 1.
      expect(zoom).toBe(expectedZoom);
      const blended = countBlended(shot);
      globalThis.console.log(
        `S6.3 dpr=${label} backingStore=${String(backingStore)} zoom=${String(zoom)} blendedPixels=${String(blended)}`,
      );
      expect(blended).toBe(0);
      expect(harness?.errors).toEqual([]);
    }, 60_000);
  }

  it("shows blended pixels without pixel-perfect at a fractional zoom", async () => {
    // The counter-example: a linear-sampled atlas at a deliberately fractional zoom. This is what
    // §4's bundle — integer zoom plus `nearest` sampling — exists to avoid, and it is the reason
    // the flag is not merely cosmetic.
    const { shot, zoom } = await render(REFERENCE, false, "2d/checker-linear.atlas.json", 5.3);
    expect(Number.isInteger(zoom)).toBe(false);
    const blended = countBlended(shot);
    globalThis.console.log(`S6.3 counterExample zoom=${zoom.toFixed(4)} blendedPixels=${String(blended)}`);
    expect(blended).toBeGreaterThan(0);
  }, 60_000);

  it("snaps a sub-pixel camera position to the grid", async () => {
    const running = await createTwoDBrowserApp({
      width: REFERENCE,
      height: REFERENCE,
      assets: fixtureAssets(),
      options: { pixelsPerUnit: 1 },
    });
    harness = running;
    const eye = running.world.createEntity("Camera");
    eye.transform.position2D = new Vec2(0.37, -0.62);
    const camera = eye.addComponent(Camera2D);
    camera.pixelPerfect = true;
    camera.referenceResolution = { x: REFERENCE, y: REFERENCE };
    const handle = running.app.assets.load<SpriteAtlasAsset>("2d/checker.atlas.json");
    await running.advance(SETTLE_FRAMES);
    await handle.promise;
    const entity = running.world.createEntity("checker");
    const sprite = entity.addComponent(SpriteRenderer);
    sprite.sprite = handle.retain();
    await running.advance(SETTLE_FRAMES);
    // The script keeps its sub-pixel position; only what is drawn is snapped.
    expect(camera.centre.x).toBe(0);
    expect(camera.centre.y).toBe(-1);
    expect(countBlended(await running.capture())).toBe(0);
  }, 60_000);
});
