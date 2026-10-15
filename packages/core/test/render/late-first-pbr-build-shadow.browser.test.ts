import { afterEach, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { Light } from "../../src/render/light.js";
import {
  createMaterialAsset,
  pbrMaterialDefinition,
  standardMaterialDefinition,
} from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { createPixelRgba, samplePixel } from "../../src/lite/screenshot.js";
import { createBrowserApp, gpuDeviceErrors, pixelLuminance, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { CapturedFrame } from "../../src/lite/screenshot.js";
import type { BrowserApp } from "./support/browser-harness.js";

/**
 * A shadow turned on in a scene whose PBR material group was first built **after** start
 * (`src/lite/shadow.ts`, `MaterialCacheResets`).
 *
 * The scene starts with no light and Standard materials only, so nothing PBR is built at
 * registration. Two directional lights arrive later, one of them casting, then the ground switches
 * to a PBR material (the box, which casts, stays Standard): Lite's runtime build of that swap is the first time it registers its
 * PBR cache reset, and no ignifx rebuild follows it. Turning the second light's shadows on keeps the
 * receivers on the same cached bind-group layout key with one more shadow map, so the render layer
 * has to clear Lite's layouts first, which it can only do once it has confirmed that reset.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** The canvas edge. */
const SIZE = 64;

/**
 * Counts the pixels that got materially darker between two captures.
 *
 * @param before - The earlier capture.
 * @param after - The later capture.
 * @returns How many pixels lost at least a fifth of their luminance.
 */
function darkenedPixels(before: CapturedFrame, after: CapturedFrame): number {
  const a = createPixelRgba();
  const b = createPixelRgba();
  let darker = 0;
  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      if (samplePixel(before, x, y, a) !== null && samplePixel(after, x, y, b) !== null) {
        darker += pixelLuminance(b) < pixelLuminance(a) * 0.8 ? 1 : 0;
      }
    }
  }
  return darker;
}

it("casts a second shadow switched on after the scene's first, late, PBR build", async () => {
  const device = gpuDeviceErrors();
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    settings: { rendering: { msaaSamples: 1, features: { shadows: true } } },
  });
  harness = running;
  device.stop();
  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 9, -0.01);
  eye.transform.lookAt({ x: 0, y: 0, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 100, fov: 60 });
  // The scene starts with Standard materials only, so registration builds no PBR group.
  const plain = createMaterialAsset(running.app, standardMaterialDefinition(), []);
  const ground = running.world.createEntity("Ground").addComponent(MeshRenderer, {
    mesh: MeshAsset.ground(running.app, { width: 30, height: 30, subdivisions: 1 }),
    materials: [plain],
    castShadows: false,
  });
  const boxEntity = running.world.createEntity("Box");
  boxEntity.transform.localPosition.set(0, 1.5, 0);
  boxEntity.addComponent(MeshRenderer, {
    mesh: MeshAsset.box(running.app, { size: 1 }),
    materials: [plain],
  });
  await running.start();
  await running.advance(SETTLE_FRAMES);

  const addLight = (name: string, x: number, casts: boolean): Light => {
    const entity = running.world.createEntity(name);
    entity.transform.localPosition.set(x, 8, 0.001);
    entity.transform.lookAt({ x: 0, y: 0, z: 0 });
    return entity.addComponent(Light, {
      type: "directional",
      intensity: 0.6,
      shadows: { enabled: casts, mapSize: 512 },
    });
  };
  addLight("Left", -6, true);
  const right = addLight("Right", 6, false);
  await running.advance(SETTLE_FRAMES);

  // A material swap is not a topology change, so nothing but Lite's own runtime build runs: the
  // first PBR build of this scene, and the first time Lite registers the PBR cache reset.
  const white = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  ground.materials = [white];
  await running.advance(SETTLE_FRAMES * 4);
  expect(device.errors).toEqual([]);
  const unshadowed = await running.app.renderer.captureScreenshot();

  right.shadows.enabled = true;
  await running.advance(SETTLE_FRAMES * 4);

  expect(device.errors).toEqual([]);
  expect(running.errors).toEqual([]);
  expect(right.isCastingShadows).toBe(true);
  // Every receiver keeps its cached layout key with a second shadow map; without fresh layouts its
  // bind group no longer matches the layout and WebGPU rejects every frame.
  const shadowed = await running.app.renderer.captureScreenshot();
  expect(darkenedPixels(unshadowed, shadowed)).toBeGreaterThan(20);
}, 60_000);
