import { afterEach, describe, expect, it } from "vitest";
import { forceDeviceLossForTesting } from "../../src/lite/gpu/device-loss.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { addCameraAndLight, createBrowserApp, pixelsDiffer, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { DeviceLostInfo } from "../../src/app/types.js";

/**
 * Device loss and recovery through `app.events`
 * (`docs/architecture/07-rendering.md` §4).
 *
 * Two Lite rules govern the setup, and `createApp` follows both: recovery is enabled on the engine
 * **before any resource exists**, because the capture that stamps a recovery source onto a texture
 * is installed by that call; and a forced loss throws unless a recovery strategy is already
 * registered, which is what keeps `disposeEngine` from looking like a crash
 * (`src/lite/gpu/device-loss.ts`).
 *
 * The scene is deliberately untextured. ADR-0002's validation recorded that recovery works for
 * untextured meshes even when it is enabled after resources exist, and that the ordering rule is
 * there to protect *textures*; keeping this scene to geometry and a material means the test
 * measures the ignifx wiring rather than the sharpest edge of Lite's own recovery.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Builds a lit scene on an app with device-loss recovery switched on.
 *
 * @param recovery - Whether the `deviceLostRecovery` rendering feature is on.
 * @returns The running app.
 */
async function buildScene(recovery = true): Promise<BrowserApp> {
  const running = await createBrowserApp({
    size: 48,
    startEmpty: false,
    settings: { rendering: { msaaSamples: 1, features: { deviceLostRecovery: recovery } } },
  });
  harness = running;
  addCameraAndLight(running, 4);
  const mesh = MeshAsset.box(running.app, { size: 2 });
  const material = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  running.world.createEntity("Cube").addComponent(MeshRenderer, { mesh, materials: [material] });
  await running.start();
  await running.advance(SETTLE_FRAMES * 2);
  return running;
}

describe("a forced device loss", () => {
  it("fans out to app.events and comes back with the same picture", async () => {
    const running = await buildScene();
    const lost: DeviceLostInfo[] = [];
    let recovered = 0;
    const failures: unknown[] = [];
    let announceRecovery: (() => void) | null = null;
    // Recovery requests a replacement device asynchronously, so the wait is on the event itself
    // rather than on a frame count; the frame budget is only the ceiling that keeps a broken
    // recovery from hanging the suite (a software adapter under load needs well over ten frames).
    const recoveryHappened = new Promise<void>((resolve) => {
      announceRecovery = resolve;
    });
    running.app.events.onDeviceLost.connect((info) => {
      lost.push(info);
    });
    running.app.events.onDeviceRecovered.connect(() => {
      recovered += 1;
      announceRecovery?.();
    });
    running.app.events.onDeviceRecoveryFailed.connect((reason) => {
      failures.push(reason);
    });

    const before = await running.centrePixel();
    forceDeviceLossForTesting(running.app.lite.engine);
    await Promise.race([recoveryHappened, running.advance(300)]);

    expect(lost).toHaveLength(1);
    expect(typeof lost[0]?.message).toBe("string");
    expect(recovered).toBe(1);
    expect(failures).toEqual([]);

    await running.advance(SETTLE_FRAMES * 3);
    const after = await running.centrePixel();
    // §4: recovery is best effort, but for an untextured scene the picture is expected to come back
    // unchanged. The tolerance is one 8-bit step, for a software rasteriser's rounding.
    expect(pixelsDiffer(before, after, 2)).toBe(false);
  });

  it("throws when the project never opted in, because Lite has no strategy to run", async () => {
    const running = await buildScene(false);
    expect(() => {
      forceDeviceLossForTesting(running.app.lite.engine);
    }).toThrow();
  });
});
