import { Vec2 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { Camera2D, DEFAULT_ORTHOGRAPHIC_SIZE } from "../../src/camera/camera-2d.js";
import { selectCamera } from "../../src/service/sync-system.js";
import { createTwoDApp } from "../support/app.js";
import type { TwoDAppHarness } from "../support/app.js";

/**
 * `Camera2D`'s arithmetic (`docs/architecture/11-2d-toolkit.md` §2.1 and §4). `resolve` is the
 * `@internal` entry point the sync system calls once per frame; driving it directly is what lets a
 * headless suite assert zoom, bounds, and pixel snapping without a surface.
 */

let harness: TwoDAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** Builds a headless app carrying one camera. */
async function createCamera(): Promise<Camera2D> {
  harness = await createTwoDApp();
  return harness.app.world.createEntity("camera").addComponent(Camera2D);
}

describe("defaults", () => {
  it("starts at the documented half-height and reference resolution", async () => {
    const camera = await createCamera();
    expect(camera.orthographicSize).toBe(DEFAULT_ORTHOGRAPHIC_SIZE);
    expect(camera.pixelPerfect).toBe(false);
    expect(camera.referenceResolution).toEqual({ x: 640, y: 360 });
    expect(camera.boundsMin).toBeNull();
    expect(camera.boundsMax).toBeNull();
    expect(camera.priority).toBe(0);
    expect(camera.zoom).toBe(1);
  });
});

describe("zoom", () => {
  it("fits orthographicSize metres into half the viewport height", async () => {
    const camera = await createCamera();
    camera.orthographicSize = 1.8;
    camera.resolve(0, 0, 640, 360, 100);
    expect(camera.zoom).toBeCloseTo(1, 12);
    camera.resolve(0, 0, 1280, 720, 100);
    expect(camera.zoom).toBeCloseTo(2, 12);
  });

  it("ignores orthographicSize when pixelPerfect scales the reference resolution", async () => {
    const camera = await createCamera();
    camera.pixelPerfect = true;
    camera.orthographicSize = 999;
    camera.resolve(0, 0, 1280, 720, 100);
    expect(camera.zoom).toBe(2);
    camera.resolve(0, 0, 960, 540, 100);
    // 540 / 360 is 1.5, which snaps down to a whole texel scale.
    expect(camera.zoom).toBe(1);
  });
});

describe("bounds", () => {
  it("keeps the viewport inside a bound wider than it", async () => {
    const camera = await createCamera();
    camera.orthographicSize = 1;
    camera.boundsMin = { x: -10, y: -10 };
    camera.boundsMax = { x: 10, y: 10 };
    camera.resolve(100, 100, 200, 200, 100);
    // Half the viewport is 1 m tall and 1 m wide at zoom 1, so the centre stops 1 m short.
    expect(camera.centre.x).toBeCloseTo(9, 10);
    expect(camera.centre.y).toBeCloseTo(9, 10);
  });

  it("centres on a bound narrower than the viewport rather than jittering", async () => {
    const camera = await createCamera();
    camera.orthographicSize = 5;
    camera.boundsMin = { x: -1, y: -1 };
    camera.boundsMax = { x: 1, y: 1 };
    camera.resolve(100, -100, 200, 200, 100);
    expect(camera.centre.x).toBeCloseTo(0, 10);
    expect(camera.centre.y).toBeCloseTo(0, 10);
  });

  it("leaves the centre alone when only one bound is set", async () => {
    const camera = await createCamera();
    camera.boundsMin = { x: 0, y: 0 };
    camera.resolve(50, 50, 200, 200, 100);
    expect(camera.centre.x).toBe(50);
  });
});

describe("pixel-perfect snapping", () => {
  it("snaps the camera centre to the pixel grid", async () => {
    const camera = await createCamera();
    camera.pixelPerfect = true;
    camera.resolve(1.234_56, -0.987_65, 640, 360, 100);
    // Zoom 1 at 100 px/m means the grid step is 1/100 m.
    expect(camera.centre.x * 100).toBeCloseTo(Math.round(1.234_56 * 100), 10);
    expect(camera.centre.y * 100).toBeCloseTo(Math.round(-0.987_65 * 100), 10);
  });

  it("leaves sub-pixel positions alone when the flag is off", async () => {
    const camera = await createCamera();
    camera.resolve(1.234_56, 0, 640, 360, 100);
    expect(camera.centre.x).toBeCloseTo(1.234_56, 10);
  });
});

describe("screen and world", () => {
  it("maps the viewport centre to the camera's own centre", async () => {
    const camera = await createCamera();
    camera.orthographicSize = 1.8;
    camera.resolve(3, -2, 640, 360, 100);
    const world = camera.screenToWorld(320, 180, new Vec2());
    expect(world.x).toBeCloseTo(3, 8);
    expect(world.y).toBeCloseTo(-2, 8);
  });

  it("round trips several points, corners included", async () => {
    const camera = await createCamera();
    camera.orthographicSize = 2.5;
    camera.resolve(1, 1, 800, 600, 64);
    for (const [x, y] of [
      [0, 0],
      [800, 600],
      [123, 456],
      [400, 300],
    ] as const) {
      const world = camera.screenToWorld(x, y, new Vec2());
      const screen = camera.worldToScreen(world, new Vec2());
      expect(screen.x).toBeCloseTo(x, 6);
      expect(screen.y).toBeCloseTo(y, 6);
    }
  });

  it("answers with the camera centre before the first sync has measured a viewport", async () => {
    const camera = await createCamera();
    const world = camera.screenToWorld(10, 10, new Vec2());
    expect(world.x).toBe(0);
    expect(world.y).toBe(0);
  });

  it("writes into a caller-owned vector", async () => {
    const camera = await createCamera();
    camera.resolve(0, 0, 640, 360, 100);
    const out = new Vec2();
    expect(camera.screenToWorld(1, 2, out)).toBe(out);
    expect(camera.worldToScreen({ x: 1, y: 2 }, out)).toBe(out);
  });
});

describe("selection", () => {
  it("picks the highest-priority enabled camera", async () => {
    harness = await createTwoDApp();
    const world = harness.app.world;
    const low = world.createEntity("low").addComponent(Camera2D);
    const high = world.createEntity("high").addComponent(Camera2D);
    high.priority = 10;
    expect(selectCamera(world)).toBe(high);
    high.enabled = false;
    expect(selectCamera(world)).toBe(low);
  });

  it("answers null when the world has no enabled camera", async () => {
    harness = await createTwoDApp();
    expect(selectCamera(harness.app.world)).toBeNull();
  });
});
