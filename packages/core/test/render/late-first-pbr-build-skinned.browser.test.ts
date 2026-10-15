import { afterEach, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { Model } from "../../src/render/model.js";
import {
  createBrowserApp,
  fixtureUrl,
  gpuDeviceErrors,
  pixelLuminance,
  SETTLE_FRAMES,
} from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { ModelAsset } from "../../src/render/model-asset.js";

/**
 * The first skinned model in a scene whose PBR material group was first built **after** start
 * (`src/lite/shadow.ts`, `MaterialCacheResets`).
 *
 * The scene starts with no light, so the warm-up builds no PBR group at registration. A light and a
 * plain PBR box arrive later, and the box's runtime build is the first PBR build the scene sees, so
 * it is the first time Lite registers its PBR cache reset. When the skinned rig then arrives, the
 * render layer has to clear Lite's bind-group layouts before the rebuild that composes the skinning
 * fragment; if it had not learnt that reset, WebGPU would reject every later frame.
 *
 * One test per file: the skinning fragment is registered process-wide, and Vitest gives every
 * browser test file its own copy of Lite's modules.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

it("draws a skinned model that arrives after the scene's first, late, PBR build", async () => {
  const device = gpuDeviceErrors();
  const running = await createBrowserApp({
    startEmpty: false,
    assets: [{ address: "models/rig.glb", url: fixtureUrl("3d/rig.glb"), type: "model" }],
  });
  harness = running;
  device.stop();
  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 1, -3);
  eye.addComponent(Camera, { near: 0.1, far: 100 });
  await running.start();
  await running.advance(SETTLE_FRAMES);

  running.world.createEntity("Sky").addComponent(Light, { type: "hemispheric", intensity: 1 });
  await running.advance(SETTLE_FRAMES);
  const white = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  const box = running.world.createEntity("Box");
  box.transform.localPosition.set(3, 0, 2);
  box.addComponent(MeshRenderer, { mesh: MeshAsset.box(running.app, { size: 1 }), materials: [white] });
  await running.advance(SETTLE_FRAMES * 3);
  expect(device.errors).toEqual([]);

  const handle = await running.app.assets.loadAsync<ModelAsset>("models/rig.glb");
  running.world.createEntity("Rig").addComponent(Model, { model: handle });
  await running.advance(SETTLE_FRAMES * 3);

  expect(device.errors).toEqual([]);
  expect(running.errors).toEqual([]);
  // The camera looks straight at the rig's torso; a rejected frame leaves the canvas black.
  expect(pixelLuminance(await running.centrePixel())).toBeGreaterThan(20);
}, 60_000);
