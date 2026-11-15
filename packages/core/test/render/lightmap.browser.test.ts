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
  settle,
  SETTLE_FRAMES,
} from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";

/**
 * `MeshRenderer.lightmap` (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step B3): a white quad
 * whose UV2 spans a lightmap black on its left texel and white on its right reads dark on one half
 * and lit on the other, but only on a static entity. Two quads sharing one atlas through their
 * `.lightmap.json` placements (GI plan §5, spike P2) each read only their own half of it.
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
  await settle(running, SETTLE_FRAMES * 3);
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

  it("gives two renderers sharing an atlas each their own square of it", async () => {
    const gpu = gpuDeviceErrors();
    try {
      const running = await createBrowserApp({
        size: SIZE,
        startEmpty: false,
        settings: { rendering: { msaaSamples: 1 } },
      });
      harness = running;
      const { app, world } = running;
      addCameraAndLight(running, 3);
      // Two quads, 0.9 wide, either side of the centre; each one's UV2 spans the unit square.
      const quadAt = (x0: number): ReturnType<typeof MeshAsset.fromData> => {
        const x1 = x0 + 0.9;
        return MeshAsset.fromData(app, `quad ${String(x0)}`, {
          positions: Float32Array.of(x0, -1, 0, x1, -1, 0, x1, 1, 0, x0, 1, 0),
          normals: Float32Array.of(0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1),
          uvs: Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1),
          uvs2: Float32Array.of(0, 0, 1, 0, 1, 1, 0, 1),
          indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
        });
      };
      const material = createMaterialAsset(
        app,
        pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1, doubleSided: true }),
        [],
      );
      // Eight texels: the left four black, the right four white, so bilinear filtering stays pure
      // within each half away from the seam.
      const texels = new Uint8Array(8 * 4);
      for (let index = 4; index < 8; index += 1) {
        texels.fill(255, index * 4, index * 4 + 4);
      }
      for (let index = 0; index < 4; index += 1) {
        texels[index * 4 + 3] = 255;
      }
      const texture = TextureAsset.fromPixels(app, "atlas", texels, 8, 1);
      const dark = world.createEntity("Dark");
      const lit = world.createEntity("Lit");
      const atlas = createLightmapAsset(app, texture, {
        [dark.uid]: { scale: { x: 0.5, y: 1 }, offset: { x: 0, y: 0 } },
        [lit.uid]: { scale: { x: 0.5, y: 1 }, offset: { x: 0.5, y: 0 } },
      });
      for (const [entity, x0] of [
        [dark, -1],
        [lit, 0.1],
      ] as const) {
        entity.isStatic = true;
        entity.addComponent(MeshRenderer, {
          mesh: quadAt(x0),
          materials: [material],
          lightmap: { asset: atlas, mode: "shadowmap", level: 1, gamma: false, uv2: true },
        });
      }
      await running.start();
      await settle(running, SETTLE_FRAMES * 3);
      expect(running.errors).toEqual([]);
      const y = SIZE >> 1;
      const at = async (fraction: number): Promise<number> =>
        pixelLuminance(await running.pixelAt(Math.round(SIZE * fraction), y));
      // Two points on each quad, at different UV2 u; whichever side the camera puts each quad on,
      // a quad's two points agree only if it samples one half of the atlas.
      const one = [await at(0.22), await at(0.34)];
      const other = [await at(0.66), await at(0.78)];
      const message = JSON.stringify({ one, other, lightmapped: running.renderer.lightmapHost?.count });
      expect(running.renderer.lightmapHost?.count, message).toBe(2);
      expect(gpu.errors.slice(0, 1)).toEqual([]);
      const darkSide = Math.max(...one) < Math.max(...other) ? one : other;
      const litSide = darkSide === one ? other : one;
      expect(Math.max(...darkSide), message).toBeLessThan(25);
      expect(Math.min(...litSide), message).toBeGreaterThan(60);
    } finally {
      gpu.stop();
    }
  }, 120_000);
});
