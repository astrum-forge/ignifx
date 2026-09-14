import { afterEach, describe, expect, it } from "vitest";
import { Camera2D } from "../src/camera/camera-2d.js";
import { createTwoDBrowserApp, distanceTo, fixtureAssets, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { TwoDBrowserApp } from "./support/browser-harness.js";
import type { SpriteAtlasAsset } from "../src/atlas/sprite-atlas-asset.js";
import type { SpriteBatch } from "../src/service/sprite-batch.js";

/**
 * A `SpriteBatch` on a real WebGPU device
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §2.2).
 *
 * The node suite proves the arithmetic; this proves the pixels — that a thousand
 * entity-less sprites written by index actually reach the screen through the same Lite layer a
 * `SpriteRenderer` draws through, and that lowering `count` takes them off it.
 *
 * `run_0` of the `hero.png` fixture is a flat blue 32x32 frame sampled `nearest`, so a
 * heavily minified copy of it is still exactly blue. The CI adapter is SwiftShader, so the colour
 * assertions carry a per-channel tolerance (coding standards §10).
 */

/** `run_0`: pure blue, centre pivot. */
const BLUE = 2;

/** The canvas edge, in device pixels. */
const SIZE = 64;

/** How many sprites the batch draws. */
const SPRITES = 1000;

/** Columns of the grid the batch lays out; 25 x 40 is exactly {@link SPRITES}. */
const COLUMNS = 25;

/** Rows of the grid the batch lays out. */
const ROWS = SPRITES / COLUMNS;

/** How far a channel may drift on a software rasteriser and still count as the same colour. */
const TOLERANCE = 24;

let harness: TwoDBrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** A running app whose camera shows exactly 64 layer pixels of world, with the atlas loaded. */
async function createScene(): Promise<{ readonly running: TwoDBrowserApp; readonly batch: SpriteBatch }> {
  // `pixelsPerUnit: 1` makes one world metre one layer pixel, so every coordinate below can be read
  // straight off the canvas.
  const running = await createTwoDBrowserApp({
    width: SIZE,
    height: SIZE,
    assets: fixtureAssets(),
    options: { pixelsPerUnit: 1 },
  });
  harness = running;
  const camera = running.world.createEntity("Camera").addComponent(Camera2D);
  camera.orthographicSize = SIZE / 2;
  const atlas = running.app.assets.load<SpriteAtlasAsset>("2d/hero.atlas.json");
  await running.advance(SETTLE_FRAMES);
  await atlas.promise;
  const batch = running.app.twoD.createSpriteBatch({ atlas, capacity: SPRITES });
  batch.count = SPRITES;
  // A grid of slightly oversized tiles, so the whole canvas is the interior of some sprite and no
  // assertion below lands on a seam.
  const stepX = SIZE / COLUMNS;
  const stepY = SIZE / ROWS;
  for (let slot = 0; slot < SPRITES; slot += 1) {
    const column = slot % COLUMNS;
    const row = Math.floor(slot / COLUMNS);
    const x = -SIZE / 2 + stepX * (column + 0.5);
    const y = SIZE / 2 - stepY * (row + 0.5);
    batch.write(slot, x, y, stepX + 1, stepY + 1, BLUE, 0, 1, 1, 1, 1);
  }
  await running.advance(SETTLE_FRAMES);
  return { running, batch };
}

describe("a sprite batch on a device", () => {
  it("draws a thousand entity-less sprites", async () => {
    const scene = await createScene();
    const capture = await scene.running.capture();
    expect(distanceTo(capture.at(4, 4), 0, 0, 255)).toBeLessThan(TOLERANCE);
    expect(distanceTo(capture.at(SIZE >> 1, SIZE >> 1), 0, 0, 255)).toBeLessThan(TOLERANCE);
    expect(distanceTo(capture.at(SIZE - 5, SIZE - 5), 0, 0, 255)).toBeLessThan(TOLERANCE);
    expect(scene.running.app.twoD.layers).toHaveLength(1);
    expect(scene.running.errors).toEqual([]);
  });

  it("takes the sprites off the screen when count drops, and puts them back", async () => {
    const scene = await createScene();
    scene.batch.count = 0;
    await scene.running.advance(SETTLE_FRAMES);
    const cleared = await scene.running.centrePixel();
    expect(distanceTo(cleared, 0, 0, 255)).toBeGreaterThan(TOLERANCE);

    scene.batch.count = SPRITES;
    await scene.running.advance(SETTLE_FRAMES);
    const restored = await scene.running.centrePixel();
    expect(distanceTo(restored, 0, 0, 255)).toBeLessThan(TOLERANCE);
    expect(scene.running.errors).toEqual([]);
  });

  it("stops drawing once disposed", async () => {
    const scene = await createScene();
    scene.batch.dispose();
    await scene.running.advance(SETTLE_FRAMES);
    const centre = await scene.running.centrePixel();
    expect(distanceTo(centre, 0, 0, 255)).toBeGreaterThan(TOLERANCE);
    expect(scene.running.app.twoD.layers[0]?.count).toBe(0);
    expect(scene.running.errors).toEqual([]);
  });
});
