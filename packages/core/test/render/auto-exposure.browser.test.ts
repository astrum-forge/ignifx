import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { createBrowserApp, gpuDeviceErrors, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";

/**
 * `rendering.autoExposure` on a real device (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, step
 * G14): the compute pass meters the HDR scene and writes `log2` of the exposure multiplier.
 */

/** The canvas edge. Small keeps SwiftShader fast. */
const SIZE = 48;

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Builds a white box under a hemispheric light, with auto exposure on, and lets it settle.
 *
 * @param intensity - The light's intensity.
 * @returns The running app.
 */
async function buildScene(intensity: number): Promise<BrowserApp> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    settings: {
      rendering: {
        hdr: true,
        msaaSamples: 1,
        autoExposure: { enabled: true, minEv: -10, maxEv: 10, speedUp: 50, speedDown: 50 },
      },
    },
  });
  harness = running;
  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -6);
  eye.addComponent(Camera, { near: 0.1, far: 100, clearColor: { r: 0, g: 0, b: 0, a: 1 } });
  running.world.createEntity("Sky").addComponent(Light, { type: "hemispheric", intensity });
  const material = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  running.world
    .createEntity("Cube")
    .addComponent(MeshRenderer, { mesh: MeshAsset.box(running.app, { size: 4 }), materials: [material] });
  await running.start();
  await running.advance(SETTLE_FRAMES * 3);
  return running;
}

/**
 * Reads the auto exposure texel: `log2` of the multiplier the output pass applies.
 *
 * @param running - The running app.
 * @returns The value.
 */
async function exposureLog2(running: BrowserApp): Promise<number> {
  const texture = running.renderer.presenter?.hdr?.exposureTexture?.texture;
  if (texture === undefined) {
    throw new Error("the app built no auto exposure pass");
  }
  // The device is Lite's private field; a test may reach it to read a texture back.
  const device: unknown = Reflect.get(running.renderer.engine, "_device");
  if (!(device instanceof GPUDevice)) {
    throw new Error("the engine holds no GPU device");
  }
  const buffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: 256 }, { width: 1, height: 1 });
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const value = new Float32Array(buffer.getMappedRange().slice(0, 4))[0] ?? Number.NaN;
  buffer.unmap();
  buffer.destroy();
  return value;
}

describe("rendering.autoExposure", () => {
  it("converges to a lower exposure for a bright scene than for a dark one", async () => {
    const device = gpuDeviceErrors();
    try {
      const bright = await exposureLog2(await buildScene(8));
      harness?.dispose();
      harness = null;
      const dark = await exposureLog2(await buildScene(0.05));
      expect(Number.isFinite(bright)).toBe(true);
      expect(Number.isFinite(dark)).toBe(true);
      expect(bright).toBeLessThan(0);
      // 160× less light is a little over 7 stops; leave room for the clipped histogram's bins.
      expect(dark - bright).toBeGreaterThan(5);
      expect(device.errors).toEqual([]);
    } finally {
      device.stop();
    }
  }, 60_000);
});
