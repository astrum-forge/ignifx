import { afterEach, describe, expect, it } from "vitest";
import { Camera2D } from "../../src/camera/camera-2d.js";
import { ParallaxLayer } from "../../src/sprite/parallax-layer.js";
import { createTwoDApp } from "../support/app.js";
import type { LiteSprite2DLayer } from "../../src/lite/types.js";
import type { SpriteLayerEntry } from "../../src/service/layer-registry.js";
import type { TwoDAppHarness } from "../support/app.js";

/**
 * `ParallaxLayer` (`docs/architecture/11-2d-toolkit.md` §2.6): a per-layer view offset applied
 * after the camera has written its own view, which is what gives a side-scroller depth.
 *
 * The entries are hand-built stubs rather than real Lite layers: this suite is about the
 * arithmetic, and a real layer needs an uploaded atlas and therefore a GPU. The browser suite
 * covers the real thing.
 */

let harness: TwoDAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * A stub layer entry carrying only the view the arithmetic touches.
 *
 * The cast is deliberate: `Sprite2DLayer` is pure data with a dozen fields the offset never reads,
 * and faking the two it does read is what keeps this suite on the null engine.
 */
function stubEntry(sortingLayer: string, screenSpace = false): SpriteLayerEntry {
  const layer = { view: { positionPx: [0, 0], zoom: 1, rotation: 0 } } as unknown as LiteSprite2DLayer;
  return { key: `${sortingLayer}|x|alpha|world`, sortingLayer, layer, screenSpace, count: 0, ySort: false };
}

/** A camera resolved at a known world centre. */
async function createRig(centreX: number, centreY: number): Promise<{ camera: Camera2D; layer: ParallaxLayer }> {
  const created = await createTwoDApp();
  harness = created;
  const camera = created.app.world.createEntity("camera").addComponent(Camera2D);
  camera.resolve(centreX, centreY, 640, 360, 100);
  const layer = created.app.world.createEntity("sky").addComponent(ParallaxLayer);
  return { camera, layer };
}

describe("defaults", () => {
  it("starts at half speed on the Default layer", async () => {
    const { layer } = await createRig(0, 0);
    expect(layer.sortingLayer).toBe("Default");
    expect(layer.factor).toEqual({ x: 0.5, y: 1 });
    expect(layer.repeatX).toBe(false);
    expect(layer.repeatWidth).toBe(0);
  });
});

describe("the offset", () => {
  it("leaves a layer moving with the camera untouched", async () => {
    const { camera, layer } = await createRig(10, 5);
    layer.factor = { x: 1, y: 1 };
    const entry = stubEntry("Default");
    layer.applyTo([entry], camera, 100);
    expect(entry.layer.view.positionPx).toEqual([0, 0]);
  });

  it("slides a half-speed layer back by half the camera's pixel position", async () => {
    const { camera, layer } = await createRig(10, 5);
    layer.factor = { x: 0.5, y: 0.5 };
    const entry = stubEntry("Default");
    layer.applyTo([entry], camera, 100);
    // The camera is at (1000, -500) in layer pixels; half of that is subtracted.
    expect(entry.layer.view.positionPx[0]).toBeCloseTo(-500, 6);
    expect(entry.layer.view.positionPx[1]).toBeCloseTo(250, 6);
  });

  it("pins a zero-factor layer to the world origin", async () => {
    const { camera, layer } = await createRig(10, 0);
    layer.factor = { x: 0, y: 0 };
    const entry = stubEntry("Default");
    layer.applyTo([entry], camera, 100);
    expect(entry.layer.view.positionPx[0]).toBeCloseTo(-1000, 6);
  });

  it("skips a layer on another sorting layer", async () => {
    const { camera, layer } = await createRig(10, 0);
    layer.factor = { x: 0, y: 0 };
    const entry = stubEntry("Background");
    layer.applyTo([entry], camera, 100);
    expect(entry.layer.view.positionPx).toEqual([0, 0]);
  });

  it("skips a screen-space layer", async () => {
    const { camera, layer } = await createRig(10, 0);
    layer.factor = { x: 0, y: 0 };
    const entry = stubEntry("Default", true);
    layer.applyTo([entry], camera, 100);
    expect(entry.layer.view.positionPx).toEqual([0, 0]);
  });
});

describe("repetition", () => {
  it("wraps the offset into one repetition", async () => {
    const { camera, layer } = await createRig(10, 0);
    layer.factor = { x: 0, y: 1 };
    layer.repeatX = true;
    layer.repeatWidth = 3;
    const entry = stubEntry("Default");
    layer.applyTo([entry], camera, 100);
    // The raw offset is 1000 px; one repetition is 300 px, so 1000 mod 300 is 100.
    expect(entry.layer.view.positionPx[0]).toBeCloseTo(-100, 6);
  });

  it("wraps a negative camera position into a positive remainder", async () => {
    const { camera, layer } = await createRig(-10, 0);
    layer.factor = { x: 0, y: 1 };
    layer.repeatX = true;
    layer.repeatWidth = 3;
    const entry = stubEntry("Default");
    layer.applyTo([entry], camera, 100);
    // -1000 mod 300 is -100, which wraps to +200.
    expect(entry.layer.view.positionPx[0]).toBeCloseTo(-200, 6);
  });

  it("ignores repetition with no width", async () => {
    const { camera, layer } = await createRig(10, 0);
    layer.factor = { x: 0, y: 1 };
    layer.repeatX = true;
    layer.repeatWidth = 0;
    const entry = stubEntry("Default");
    layer.applyTo([entry], camera, 100);
    expect(entry.layer.view.positionPx[0]).toBeCloseTo(-1000, 6);
  });
});
