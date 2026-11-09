import { afterEach, describe, expect, it } from "vitest";
import { createLightmapAsset } from "../../src/render/lightmap-asset.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { TextureAsset } from "../../src/render/texture-asset.js";
import {
  addCameraAndLight,
  createBrowserApp,
  gpuDeviceErrors,
  pixelLuminance,
  SETTLE_FRAMES,
} from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";

/**
 * `MeshRenderer.lightmap` (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step B3): a white quad
 * whose UV2 spans a lightmap black on its left texel and white on its right reads dark on one half
 * and lit on the other, but only on a static entity.
 */

/** The canvas edge. */
const SIZE = 64;

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Renders the quad and reads a pixel on each half.
 *
 * @param isStatic - Whether the quad's entity is static.
 * @returns The luminance left and right of centre, and how many renderers draw a lightmap.
 */
async function quad(isStatic: boolean): Promise<{ left: number; right: number; lightmapped: number }> {
  const gpu = gpuDeviceErrors();
  try {
    return await render(isStatic, gpu.errors);
  } finally {
    gpu.stop();
  }
}

/**
 * {@link quad}'s body, while the device's errors are collected.
 *
 * @param isStatic - Whether the quad's entity is static.
 * @param deviceErrors - The device's uncaptured errors so far.
 * @returns As {@link quad}.
 */
async function render(
  isStatic: boolean,
  deviceErrors: readonly string[],
): Promise<{ left: number; right: number; lightmapped: number }> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    settings: { rendering: { msaaSamples: 1 } },
  });
  harness = running;
  const { app, world } = running;
  addCameraAndLight(running, 3);
  const mesh = MeshAsset.fromData(app, "quad", {
    positions: Float32Array.of(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0),
    normals: Float32Array.of(0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1),
    uvs: Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1),
    uvs2: Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1),
    indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
  });
  const material = createMaterialAsset(
    app,
    pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1, doubleSided: true }),
    [],
  );
  const texture = TextureAsset.fromPixels(app, "half-black", Uint8Array.of(0, 0, 0, 255, 255, 255, 255, 255), 2, 1);
  const entity = world.createEntity("Quad");
  entity.isStatic = isStatic;
  entity.addComponent(MeshRenderer, {
    mesh,
    materials: [material],
    lightmap: { asset: createLightmapAsset(app, texture), mode: "shadowmap", level: 1, gamma: false, uv2: true },
  });
  await running.start();
  await running.advance(SETTLE_FRAMES * 3);
  expect(running.errors).toEqual([]);
  const y = SIZE >> 1;
  const left = pixelLuminance(await running.pixelAt(Math.round(SIZE * 0.4), y));
  const right = pixelLuminance(await running.pixelAt(Math.round(SIZE * 0.6), y));
  const lightmapped = running.renderer.lightmapHost?.count ?? 0;
  // A lightmap composed without the uv2 varying fails to compile and only shows up here.
  expect(deviceErrors.slice(0, 1)).toEqual([]);
  running.dispose();
  harness = null;
  return { left, right, lightmapped };
}

describe("MeshRenderer.lightmap", () => {
  it("darkens the half of a static quad whose lightmap texel is black", async () => {
    const result = await quad(true);
    const message = JSON.stringify(result);
    expect(result.lightmapped, message).toBe(1);
    expect(Math.min(result.left, result.right), message).toBeLessThan(25);
    expect(Math.max(result.left, result.right), message).toBeGreaterThan(60);
  }, 120_000);

  it("leaves a non-static quad unlightmapped", async () => {
    const result = await quad(false);
    const message = JSON.stringify(result);
    expect(result.lightmapped, message).toBe(0);
    expect(Math.min(result.left, result.right), message).toBeGreaterThan(60);
  }, 120_000);
});
