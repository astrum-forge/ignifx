import { forceWebGpuDeviceLossForTesting } from "@babylonjs/lite";
import { Camera, Light, MeshAsset, MeshRenderer, Vec2 } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { Camera2D } from "../../src/camera/camera-2d.js";
import { SpriteRenderer } from "../../src/sprite/sprite-renderer.js";
import { createTwoDBrowserApp, distanceTo, fixtureAssets, SETTLE_FRAMES } from "../support/browser-harness.js";
import type { SpriteAtlasAsset } from "../../src/atlas/sprite-atlas-asset.js";
import type { TwoDBrowserApp } from "../support/browser-harness.js";
import type { DeviceLostInfo } from "@ignifx/core";

/**
 * The two things about the sprite renderer that only a real device can answer
 * (`docs/architecture/11-2d-toolkit.md` §1, `07-rendering.md` §4).
 *
 * This file lives under `test/lite/**` because it imports `@babylonjs/lite` to force a device loss;
 * that is the one directory outside `src/lite/**` the adapter-boundary rule allows.
 */

let harness: TwoDBrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** How far a channel may drift on SwiftShader and still count as the same colour. */
const TOLERANCE = 24;

describe('"mixed" mode', () => {
  it("composites a sprite over the 3D scene instead of clearing it away", async () => {
    // `twoD.mode: "mixed"` passes `clear: false` to `createSpriteRenderer`, so the sprite pass
    // preserves what the render scene left in the framebuffer (`index.d.ts` 12222). In `"sprite"`
    // mode the sprite pass owns the frame and clears it, and the 3D scene would be invisible.
    const running = await createTwoDBrowserApp({
      width: 64,
      height: 64,
      assets: fixtureAssets(),
      options: { mode: "mixed", pixelsPerUnit: 1 },
    });
    harness = running;

    // A lit box filling the frame, so there is something for the sprite to sit on top of.
    const eye = running.world.createEntity("Main Camera");
    eye.transform.localPosition.set(0, 0, -4);
    eye.addComponent(Camera, { near: 0.1, far: 100 });
    running.world.createEntity("Sun").addComponent(Light, { type: "hemispheric", intensity: 1 });
    using box = MeshAsset.box(running.app, { size: 3 });
    const cube = running.world.createEntity("Box");
    cube.addComponent(MeshRenderer).mesh = box.retain();

    const flat = running.world.createEntity("Camera2D");
    const camera2d = flat.addComponent(Camera2D);
    camera2d.orthographicSize = 32;

    const handle = running.app.assets.load<SpriteAtlasAsset>("2d/hero.atlas.json");
    await running.advance(SETTLE_FRAMES * 2);
    await handle.promise;

    // The 3D box alone: not black, and not the sprite's colour.
    const meshPixel = await running.pixelAt(32, 8);
    expect(meshPixel.r + meshPixel.g + meshPixel.b).toBeGreaterThan(20);

    const entity = running.world.createEntity("sprite");
    entity.transform.position2D = new Vec2(0, 0);
    const sprite = entity.addComponent(SpriteRenderer);
    sprite.sprite = handle.retain();
    // `run_0` is pure blue with a centre pivot, so it covers the middle 32 pixels.
    sprite.frame = 2;
    await running.advance(SETTLE_FRAMES * 2);

    const shot = await running.capture();
    // The sprite wins at its own pixels …
    expect(distanceTo(shot.at(32, 32), 0, 0, 255)).toBeLessThan(TOLERANCE);
    // … and the 3D scene survives where the sprite does not cover it.
    const survivor = shot.at(32, 4);
    expect(distanceTo(survivor, 0, 0, 255)).toBeGreaterThan(TOLERANCE);
    expect(survivor.r + survivor.g + survivor.b).toBeGreaterThan(20);
    expect(running.errors).toEqual([]);
  }, 60_000);
});

describe("device loss", () => {
  it("brings the sprite back after a forced loss", async () => {
    const running = await createTwoDBrowserApp({
      width: 64,
      height: 64,
      assets: fixtureAssets(),
      options: { pixelsPerUnit: 1 },
      settings: { rendering: { msaaSamples: 1, features: { deviceLostRecovery: true } } },
    });
    harness = running;
    const eye = running.world.createEntity("Camera");
    eye.addComponent(Camera2D).orthographicSize = 32;
    const handle = running.app.assets.load<SpriteAtlasAsset>("2d/hero.atlas.json");
    await running.advance(SETTLE_FRAMES);
    await handle.promise;
    const entity = running.world.createEntity("sprite");
    const sprite = entity.addComponent(SpriteRenderer);
    sprite.sprite = handle.retain();
    sprite.frame = 2;
    await running.advance(SETTLE_FRAMES * 2);

    const before = await running.centrePixel();
    expect(distanceTo(before, 0, 0, 255)).toBeLessThan(TOLERANCE);

    const lost: DeviceLostInfo[] = [];
    let announce: (() => void) | null = null;
    const recovered = new Promise<void>((resolve) => {
      announce = resolve;
    });
    running.app.events.onDeviceLost.connect((info) => lost.push(info));
    running.app.events.onDeviceRecovered.connect(() => announce?.());

    forceWebGpuDeviceLossForTesting(running.app.lite.engine);
    await Promise.race([recovered, running.advance(300)]);
    expect(lost).toHaveLength(1);

    await running.advance(SETTLE_FRAMES * 3);
    const after = await running.centrePixel();
    // Recovery is best effort, but a sprite whose atlas was retained comes back unchanged.
    expect(distanceTo(after, 0, 0, 255)).toBeLessThan(TOLERANCE);
  }, 60_000);
});
