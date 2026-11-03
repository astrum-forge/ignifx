import { Vec2 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { Camera2D } from "../src/camera/camera-2d.js";
import { SpriteRenderer } from "../src/sprite/sprite-renderer.js";
import { createTwoDBrowserApp, fixtureAssets, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { TwoDBrowserApp, Rgba } from "./support/browser-harness.js";
import type { SpriteAtlasAsset } from "../src/atlas/sprite-atlas-asset.js";

/**
 * Sprites under `rendering.hdr` (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, step G3).
 *
 * A `SpriteRenderer` is its own rendering context: it opens a pass on the swapchain after the scene
 * has presented (`src/lite/gpu/sprite-renderer.ts`), so it never passes through the HDR output pass
 * and cannot be encoded twice. These tests pin that: a half-tinted sprite (a mid-tone, where a
 * second encode would show) and the `"mixed"` clear underneath it present the same bytes with HDR on
 * as with it off.
 */

let harness: TwoDBrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The blue frame of the fixture atlas. */
const BLUE = 2;

/** How far a channel may drift between the two paths. */
const TOLERANCE = 2;

/**
 * Draws one half-tinted blue sprite in the middle of a mid-grey `"mixed"` frame.
 *
 * @param hdr - Whether `rendering.hdr` is on.
 * @returns The centre pixel (the sprite) and a corner pixel (the scene's clear).
 */
async function render(hdr: boolean): Promise<{ readonly sprite: Rgba; readonly clear: Rgba }> {
  const running = await createTwoDBrowserApp({
    width: 64,
    height: 64,
    assets: fixtureAssets(),
    options: { mode: "mixed", pixelsPerUnit: 1 },
    settings: { rendering: { msaaSamples: 1, hdr, clearColor: { r: 0.5, g: 0.4, b: 0.3, a: 1 } } },
  });
  harness = running;
  running.world.createEntity("Camera").addComponent(Camera2D).orthographicSize = 32;
  const handle = running.app.assets.load<SpriteAtlasAsset>("2d/hero.atlas.json");
  await running.advance(SETTLE_FRAMES);
  await handle.promise;
  const entity = running.world.createEntity("Sprite");
  entity.transform.position2D = new Vec2(0, 0);
  const sprite = entity.addComponent(SpriteRenderer);
  sprite.sprite = handle.retain();
  sprite.frame = BLUE;
  sprite.color = { r: 0.5, g: 0.5, b: 0.5, a: 1 };
  await running.advance(SETTLE_FRAMES);
  const result = { sprite: await running.centrePixel(), clear: await running.pixelAt(2, 2) };
  expect(running.errors).toEqual([]);
  running.dispose();
  harness = null;
  return result;
}

/**
 * The largest per-channel difference between two pixels.
 *
 * @param a - One pixel.
 * @param b - The other.
 * @returns The difference, in bytes.
 */
function maxChannelDifference(a: Rgba, b: Rgba): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

describe("sprites under rendering.hdr", () => {
  it("present the same bytes as without HDR, over the same clear", async () => {
    const plain = await render(false);
    const hdr = await render(true);
    // A mid-tone, so a double encode (0.5 → 0.73) could not hide.
    expect(plain.sprite.b).toBeGreaterThan(60);
    expect(plain.sprite.b).toBeLessThan(200);
    expect(maxChannelDifference(hdr.sprite, plain.sprite)).toBeLessThanOrEqual(TOLERANCE);
    expect(maxChannelDifference(hdr.clear, plain.clear)).toBeLessThanOrEqual(TOLERANCE);
  }, 60_000);
});
