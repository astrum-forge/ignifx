import { Vec2 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { Camera2D } from "../src/camera/camera-2d.js";
import { SpriteRenderer } from "../src/sprite/sprite-renderer.js";
import {
  createTwoDBrowserApp,
  distanceTo,
  fixtureAssets,
  pixelsDiffer,
  SETTLE_FRAMES,
} from "./support/browser-harness.js";
import type { TwoDBrowserApp } from "./support/browser-harness.js";
import type { SpriteAtlasAsset } from "../src/atlas/sprite-atlas-asset.js";

/**
 * The half of `@ignifx/2d` a headless suite cannot reach: a sprite's texels on a real device
 * (`docs/architecture/11-2d-toolkit.md` §1 and §2.2).
 *
 * The `hero.png` fixture is a 2x2 grid of flat 32x32 frames — red, green, blue, yellow — chosen so
 * a single texel identifies which frame reached the screen. The CI adapter is SwiftShader, so
 * colour assertions carry a generous per-channel tolerance (coding standards §10).
 *
 * The two `idle` frames author a **bottom-centre** pivot and the two `run` frames take the default
 * centre, so the suite uses `run` wherever it wants a sprite centred on its entity and `idle` where
 * it is testing the pivot itself.
 */

/** `run_0`: pure blue, centre pivot. */
const BLUE = 2;

/** `run_1`: pure yellow, centre pivot. */
const YELLOW = 3;

/** `idle_0`: pure red, bottom-centre pivot. */
const RED_BOTTOM_PIVOT = 0;

let harness: TwoDBrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** How far a channel may drift on a software rasteriser and still count as the same colour. */
const TOLERANCE = 24;

/** A running app with a camera and one loaded hero atlas. */
interface Scene {
  readonly running: TwoDBrowserApp;
  readonly camera: Camera2D;
  readonly atlas: SpriteAtlasAsset;
}

/** Builds a 64x64 app whose camera shows exactly 64 layer pixels of world. */
async function createScene(size = 64): Promise<Scene> {
  // `pixelsPerUnit: 1` makes one world metre exactly one layer pixel, so a 32-px frame is 32 units
  // wide and every assertion below can be read straight off the canvas.
  const running = await createTwoDBrowserApp({
    width: size,
    height: size,
    assets: fixtureAssets(),
    options: { pixelsPerUnit: 1 },
  });
  harness = running;
  const eye = running.world.createEntity("Camera");
  const camera = eye.addComponent(Camera2D);
  // A half-height of `size / 2` metres at 1 px per metre fills the canvas exactly, so zoom is 1.
  camera.orthographicSize = size / 2;
  const handle = running.app.assets.load<SpriteAtlasAsset>("2d/hero.atlas.json");
  await running.advance(SETTLE_FRAMES);
  const atlas = await handle.promise;
  return { running, camera, atlas };
}

/** Adds a sprite at a world position, with one pixel per metre. */
function addSprite(scene: Scene, x: number, y: number, frame: number): SpriteRenderer {
  const entity = scene.running.world.createEntity(`sprite-${String(frame)}`);
  entity.transform.position2D = new Vec2(x, y);
  const sprite = entity.addComponent(SpriteRenderer);
  sprite.sprite = scene.running.app.assets.load<SpriteAtlasAsset>("2d/hero.atlas.json").retain();
  sprite.frame = frame;
  return sprite;
}

describe("the sprite renderer", () => {
  it("registers a second rendering context on the app's surface", async () => {
    const scene = await createScene();
    addSprite(scene, 0, 0, BLUE);
    await scene.running.advance(SETTLE_FRAMES);
    expect(scene.running.app.twoD.lite.renderer).not.toBeNull();
    expect(scene.running.app.twoD.layers.length).toBeGreaterThan(0);
    expect(scene.running.errors).toEqual([]);
  });

  it("draws a sprite's own colour at the pixel the camera puts it on", async () => {
    const scene = await createScene();
    // 1 px per metre and a 32-px frame: a centre-pivoted sprite at the origin covers the middle
    // 32 pixels of the canvas.
    addSprite(scene, 0, 0, BLUE);
    await scene.running.advance(SETTLE_FRAMES);
    const centre = await scene.running.centrePixel();
    expect(distanceTo(centre, 0, 0, 255)).toBeLessThan(TOLERANCE);
  });

  it("draws a different frame's colour when the frame changes", async () => {
    const scene = await createScene();
    const sprite = addSprite(scene, 0, 0, BLUE);
    await scene.running.advance(SETTLE_FRAMES);
    sprite.frame = YELLOW;
    await scene.running.advance(SETTLE_FRAMES);
    const centre = await scene.running.centrePixel();
    expect(distanceTo(centre, 255, 255, 0)).toBeLessThan(TOLERANCE);
  });

  it("moves a sprite when its transform moves", async () => {
    const scene = await createScene();
    const sprite = addSprite(scene, 0, 0, BLUE);
    await scene.running.advance(SETTLE_FRAMES);
    const before = await scene.running.pixelAt(8, 32);
    sprite.entity.transform.position2D = new Vec2(-24, 0);
    await scene.running.advance(SETTLE_FRAMES);
    const after = await scene.running.pixelAt(8, 32);
    expect(pixelsDiffer(before, after)).toBe(true);
    expect(distanceTo(after, 0, 0, 255)).toBeLessThan(TOLERANCE);
  });

  it("respects the +Y-up world when placing a sprite", async () => {
    const scene = await createScene();
    // A sprite 24 m up must land in the TOP half of the screen, because layer pixels run +Y down.
    addSprite(scene, 0, 24, YELLOW);
    await scene.running.advance(SETTLE_FRAMES);
    const top = await scene.running.pixelAt(32, 8);
    const bottom = await scene.running.pixelAt(32, 56);
    expect(distanceTo(top, 255, 255, 0)).toBeLessThan(TOLERANCE);
    expect(distanceTo(bottom, 255, 255, 0)).toBeGreaterThan(TOLERANCE);
  });

  it("hangs a bottom-pivoted frame above its entity", async () => {
    // `idle_0` pivots at its bottom edge, so a sprite at the origin occupies the world from y=0 up
    // — the top half of the canvas — rather than straddling it. This is what makes a character's
    // feet, not its middle, sit on the ground.
    const scene = await createScene();
    addSprite(scene, 0, 0, RED_BOTTOM_PIVOT);
    await scene.running.advance(SETTLE_FRAMES);
    expect(distanceTo(await scene.running.pixelAt(32, 16), 255, 0, 0)).toBeLessThan(TOLERANCE);
    expect(distanceTo(await scene.running.pixelAt(32, 48), 255, 0, 0)).toBeGreaterThan(TOLERANCE);
  });

  it("tints a sprite by its colour field", async () => {
    const scene = await createScene();
    const sprite = addSprite(scene, 0, 0, BLUE);
    sprite.color = { r: 1, g: 1, b: 0.5, a: 1 };
    await scene.running.advance(SETTLE_FRAMES);
    const centre = await scene.running.centrePixel();
    expect(centre.b).toBeLessThan(220);
    expect(centre.b).toBeGreaterThan(60);
  });

  it("hides a disabled sprite", async () => {
    const scene = await createScene();
    const sprite = addSprite(scene, 0, 0, BLUE);
    await scene.running.advance(SETTLE_FRAMES);
    const shown = await scene.running.centrePixel();
    sprite.enabled = false;
    await scene.running.advance(SETTLE_FRAMES);
    const hidden = await scene.running.centrePixel();
    expect(pixelsDiffer(shown, hidden)).toBe(true);
  });
});

describe("Y-sort", () => {
  it("swaps two overlapping sprites' draw order when their world Y swaps", async () => {
    const running = await createTwoDBrowserApp({
      width: 64,
      height: 64,
      assets: fixtureAssets(),
      options: { ySort: { Default: true }, pixelsPerUnit: 1 },
    });
    harness = running;
    const eye = running.world.createEntity("Camera");
    const camera = eye.addComponent(Camera2D);
    camera.orthographicSize = 32;
    const handle = running.app.assets.load<SpriteAtlasAsset>("2d/hero.atlas.json");
    await running.advance(SETTLE_FRAMES);
    await handle.promise;

    /** A sprite at a world Y, drawing one flat colour. */
    const place = (y: number, frame: number): SpriteRenderer => {
      const entity = running.world.createEntity(`s${String(frame)}`);
      entity.transform.position2D = new Vec2(0, y);
      const sprite = entity.addComponent(SpriteRenderer);
      sprite.sprite = running.app.assets.load<SpriteAtlasAsset>("2d/hero.atlas.json").retain();
      sprite.frame = frame;
      return sprite;
    };
    // Two 32-px sprites four metres apart overlap heavily. Lite sorts ascending on pixel Y, and
    // layer pixels run +Y down, so the sprite that is *lower* in the world draws last — in front.
    const yellow = place(2, 3);
    const blue = place(-2, 2);
    await running.advance(SETTLE_FRAMES);
    const first = await running.centrePixel();
    // The lower sprite — blue, at y = -2 — wins the overlap.
    expect(distanceTo(first, 0, 0, 255)).toBeLessThan(TOLERANCE);

    yellow.entity.transform.position2D = new Vec2(0, -2);
    blue.entity.transform.position2D = new Vec2(0, 2);
    await running.advance(SETTLE_FRAMES);
    const second = await running.centrePixel();
    // Now yellow is the lower one, so it wins instead.
    expect(distanceTo(second, 255, 255, 0)).toBeLessThan(TOLERANCE);
    expect(running.errors).toEqual([]);
  });
});

describe("picking", () => {
  it("resolves a viewport pixel back to the entity that drew it", async () => {
    const scene = await createScene();
    const sprite = addSprite(scene, 0, 0, BLUE);
    await scene.running.advance(SETTLE_FRAMES);
    const hit = scene.running.app.twoD.pickAt(32, 32);
    expect(hit).not.toBeNull();
    expect(hit?.component).toBe(sprite);
    expect(hit?.entity).toBe(sprite.entity);
    expect(hit?.u).toBeGreaterThanOrEqual(0);
    expect(hit?.u).toBeLessThanOrEqual(1);
  });

  it("misses a pixel no sprite covers", async () => {
    const scene = await createScene();
    addSprite(scene, 0, 0, BLUE);
    await scene.running.advance(SETTLE_FRAMES);
    expect(scene.running.app.twoD.pickAt(1, 1)).toBeNull();
  });

  it("ignores a sprite marked unpickable", async () => {
    const scene = await createScene();
    const sprite = addSprite(scene, 0, 0, BLUE);
    sprite.pickable = false;
    await scene.running.advance(SETTLE_FRAMES);
    expect(scene.running.app.twoD.pickAt(32, 32)).toBeNull();
  });
});

describe("the atlas on a device", () => {
  it("uploads the fixture image and reports its frames", async () => {
    const scene = await createScene();
    expect(scene.atlas.frameCount).toBe(4);
    expect(scene.atlas.lite.atlas).not.toBeNull();
    expect(scene.atlas.isReleased).toBe(false);
    expect(scene.atlas.lite.atlas?.textureSizePx).toEqual([64, 64]);
  });
});
