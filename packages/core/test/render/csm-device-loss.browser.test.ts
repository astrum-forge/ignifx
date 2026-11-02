import { afterEach, describe, expect, it } from "vitest";
import { forceDeviceLossForTesting } from "../../src/lite/gpu/device-loss.js";
import { Camera } from "../../src/render/camera.js";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { createBrowserApp, pixelLuminance, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { ShadowTechniqueName } from "../../src/render/light.js";

/**
 * A forced device loss with cascaded shadows (`docs/architecture/07-rendering.md` §4).
 *
 * The templates shipped ESM shadows because Babylon Lite 1.27.0 rebuilt only ESM generators after a
 * lost device. Lite 1.34.0's `lib/shadow/shadow-recovery.js` also rebuilds CSM ones (and still
 * refuses PCF with error 721), so this test pins that CSM recovers before the templates rely on it.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The canvas edge. */
const SIZE = 64;

/** The scene the test drives. */
interface ShadowScene {
  /** The running app. */
  readonly running: BrowserApp;
  /** The casting light. */
  readonly sun: Light;
}

/**
 * Builds a white ground with a box floating above it, lit by one tilted directional light that
 * casts with the given technique and the cascade knobs set away from Lite's defaults. Seen from
 * above, the box's top is lit, so the only dark pixels are its shadow on the ground.
 *
 * @param technique - The shadow technique.
 * @returns The scene.
 */
async function buildScene(technique: ShadowTechniqueName): Promise<ShadowScene> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    settings: { rendering: { msaaSamples: 1, features: { shadows: true, deviceLostRecovery: true } } },
  });
  harness = running;

  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 9, -0.01);
  eye.transform.lookAt({ x: 0, y: 0, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 60, fov: 60 });

  const sun = running.world.createEntity("Sun");
  sun.transform.localPosition.set(-6, 8, 0.001);
  sun.transform.lookAt({ x: 0, y: 0, z: 0 });
  const light = sun.addComponent(Light, {
    type: "directional",
    intensity: 1.5,
    shadows: {
      enabled: true,
      technique,
      mapSize: 512,
      stabilizeCascades: true,
      cascadeLambda: 0.7,
      cascadeBlend: 0.2,
    },
  });

  const white = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  running.world.createEntity("Ground").addComponent(MeshRenderer, {
    mesh: MeshAsset.ground(running.app, { width: 30, height: 30, subdivisions: 1 }),
    materials: [white],
    castShadows: false,
  });
  const box = running.world.createEntity("Box");
  box.transform.localPosition.set(0, 1.5, 0);
  box.addComponent(MeshRenderer, { mesh: MeshAsset.box(running.app, { size: 1 }), materials: [white] });

  await running.start();
  await running.advance(SETTLE_FRAMES * 4);
  return { running, sun: light };
}

/**
 * Reads the frame's luminance, one value per pixel.
 *
 * @param running - The running app.
 * @returns The luminances, 0 to 255, row by row.
 */
async function luminances(running: BrowserApp): Promise<number[]> {
  const frame = await running.app.renderer.captureScreenshot();
  const values: number[] = [];
  for (let index = 0; index < frame.width * frame.height; index += 1) {
    values.push(
      pixelLuminance({
        r: frame.data[index * 4] ?? 0,
        g: frame.data[index * 4 + 1] ?? 0,
        b: frame.data[index * 4 + 2] ?? 0,
        a: 255,
      }),
    );
  }
  return values;
}

/**
 * Counts the pixels clearly darker than the lit ground.
 *
 * @param values - The frame's luminances.
 * @returns How many pixels are darker than half the brightest one.
 */
function darkPixels(values: readonly number[]): number {
  const brightest = Math.max(...values);
  return values.filter((value) => value < brightest / 2).length;
}

describe("a forced device loss with cascaded shadows", () => {
  it("recovers, and the shadow comes back", async () => {
    const { running, sun } = await buildScene("csm");
    let recovered = 0;
    const failures: unknown[] = [];
    let announceRecovery: (() => void) | null = null;
    const recoveryHappened = new Promise<void>((resolve) => {
      announceRecovery = resolve;
    });
    running.app.events.onDeviceRecovered.connect(() => {
      recovered += 1;
      announceRecovery?.();
    });
    running.app.events.onDeviceRecoveryFailed.connect((reason) => {
      failures.push(reason);
    });

    const before = await luminances(running);
    forceDeviceLossForTesting(running.app.lite.engine);
    await Promise.race([recoveryHappened, running.advance(300)]);

    expect(failures).toEqual([]);
    expect(recovered).toBe(1);

    await running.advance(SETTLE_FRAMES * 4);
    const after = await luminances(running);
    const shadowBefore = darkPixels(before);
    const shadowAfter = darkPixels(after);
    expect(shadowBefore).toBeGreaterThan(20);
    expect(Math.abs(shadowAfter - shadowBefore)).toBeLessThanOrEqual(shadowBefore * 0.1);
    const meanDifference = before.reduce((sum, value, index) => sum + Math.abs(value - (after[index] ?? 0)), 0);
    expect(meanDifference / before.length).toBeLessThan(2);

    // The dark pixels were the shadow: with casting switched off they go.
    sun.shadows.enabled = false;
    await running.advance(SETTLE_FRAMES * 2);
    expect(darkPixels(await luminances(running))).toBeLessThan(shadowBefore / 4);
  }, 60_000);
});
