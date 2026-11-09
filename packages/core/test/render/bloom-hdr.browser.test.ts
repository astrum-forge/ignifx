import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { PostProcessStack } from "../../src/render/post-process-stack.js";
import { createBrowserApp, gpuDeviceErrors, pixelLuminance, settle, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";

/**
 * HDR bloom on a real device (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, step G12): the mip
 * chain exists, and a bright sphere lights the black pixels around it.
 */

/** The canvas edge. 64 gives the chain six mips of at least one pixel. */
const SIZE = 64;

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Builds a small, very bright sphere in the middle of a black frame.
 *
 * @param bloom - Whether the camera's stack asks for bloom.
 * @returns The running app and its stack.
 */
async function buildScene(bloom: boolean): Promise<{ running: BrowserApp; stack: PostProcessStack }> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    settings: { rendering: { hdr: true, msaaSamples: 1, features: { postProcessing: true } } },
  });
  harness = running;
  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -6);
  eye.addComponent(Camera, { near: 0.1, far: 100, clearColor: { r: 0, g: 0, b: 0, a: 1 } });
  const stack = eye.addComponent(PostProcessStack);
  stack.bloom.enabled = bloom;
  stack.bloom.intensity = 0.3;
  running.world.createEntity("Sky").addComponent(Light, { type: "hemispheric", intensity: 40 });
  const material = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  running.world
    .createEntity("Sphere")
    .addComponent(MeshRenderer, { mesh: MeshAsset.sphere(running.app, { diameter: 0.8 }), materials: [material] });
  await running.start();
  // The bloom chunk loads on the first frame that asks for it; give it time to land and record.
  await settle(running, SETTLE_FRAMES * 3);
  return { running, stack };
}

/**
 * The summed luminance of a ring of pixels around the centre, outside the sphere.
 *
 * @param running - The running app.
 * @returns The sum.
 */
async function haloLuminance(running: BrowserApp): Promise<number> {
  const centre = SIZE >> 1;
  const offsets = [
    [12, 0],
    [-12, 0],
    [0, 12],
    [0, -12],
  ] as const;
  const pixels = await Promise.all(offsets.map(([dx, dy]) => running.pixelAt(centre + dx, centre + dy)));
  return pixels.reduce((sum, pixel) => sum + pixelLuminance(pixel), 0);
}

describe("HDR bloom", () => {
  it("builds its mip chain and brightens the frame around a bright sphere", async () => {
    const device = gpuDeviceErrors();
    try {
      const plain = await haloLuminance((await buildScene(false)).running);
      harness?.dispose();
      harness = null;

      const { running, stack } = await buildScene(true);
      const bloom = stack.hdrBloom;
      expect(bloom).not.toBeNull();
      expect(bloom?.mips.length).toBe(6);
      expect(bloom?.mips[0]?.texture.width).toBe(SIZE / 2);
      expect(bloom?.mips[0]?.texture.format).toBe("rgba16float");
      expect(bloom?.mips[5]?.texture.width).toBe(1);
      const glowing = await haloLuminance(running);
      expect(glowing).toBeGreaterThan(plain + 4);
      expect(device.errors).toEqual([]);
    } finally {
      device.stop();
    }
  }, 60_000);
});
