import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { Environment } from "../../src/render/environment.js";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { createBrowserApp, gpuDeviceErrors, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { PixelRgba } from "../../src/lite/screenshot.js";
import type { ToneMappingCurve } from "../../src/render/environment.js";

/**
 * AgX on a real device (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, step G13): Lite bakes the
 * curve into every PBR fragment on the plain path, and the HDR output pass runs the same WGSL once,
 * so the two present the same pixel.
 */

/** The canvas edge. Small keeps SwiftShader fast. */
const SIZE = 48;

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Renders an orange box under a dim hemispheric light and reads its centre.
 *
 * @param hdr - Whether `rendering.hdr` is on.
 * @param curve - The `Environment`'s tone-mapping curve.
 * @returns The centre pixel.
 */
async function centre(hdr: boolean, curve: ToneMappingCurve): Promise<PixelRgba> {
  harness?.dispose();
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    settings: { rendering: { hdr, msaaSamples: 1 } },
  });
  harness = running;
  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -6);
  eye.addComponent(Camera, { near: 0.1, far: 100, clearColor: { r: 0, g: 0, b: 0, a: 1 } });
  running.world.createEntity("Sky").addComponent(Light, { type: "hemispheric", intensity: 0.6 });
  running.world.createEntity("Environment").addComponent(Environment, {
    imageProcessing: { exposure: 1, contrast: 1, toneMapping: curve },
  });
  const material = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 0.93, g: 0.42, b: 0.16, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  running.world
    .createEntity("Cube")
    .addComponent(MeshRenderer, { mesh: MeshAsset.box(running.app, { size: 2 }), materials: [material] });
  await running.start();
  await running.advance(SETTLE_FRAMES * 3);
  return running.centrePixel();
}

/**
 * The largest per-channel difference between two pixels.
 *
 * @param left - One pixel.
 * @param right - The other.
 * @returns The difference, in bytes.
 */
function channelDistance(left: PixelRgba, right: PixelRgba): number {
  return Math.max(Math.abs(left.r - right.r), Math.abs(left.g - right.g), Math.abs(left.b - right.b));
}

describe("AgX tone mapping", () => {
  it("presents the same pixel on the plain path and through the HDR output pass", async () => {
    const device = gpuDeviceErrors();
    try {
      const plain = await centre(false, "agx");
      const hdr = await centre(true, "agx");
      expect(plain.r).toBeGreaterThan(40);
      expect(plain.r).toBeLessThan(250);
      expect(channelDistance(plain, hdr)).toBeLessThanOrEqual(2);
      expect(harness?.errors).toEqual([]);
      expect(device.errors).toEqual([]);
    } finally {
      device.stop();
    }
  }, 90_000);

  it("is a different curve from ACES and from none", async () => {
    const agx = await centre(false, "agx");
    const aces = await centre(false, "aces");
    const none = await centre(false, "none");
    expect(channelDistance(agx, aces)).toBeGreaterThan(4);
    expect(channelDistance(agx, none)).toBeGreaterThan(4);
  }, 120_000);
});
