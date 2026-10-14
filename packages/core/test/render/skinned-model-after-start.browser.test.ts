import { afterEach, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { Light } from "../../src/render/light.js";
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
 * A skinned model loaded after `app.start()`, in a page that has never drawn one
 * (`docs/architecture/07-rendering.md` §2.2, `src/lite/pbr-deformers.ts`).
 *
 * Babylon Lite registers its PBR skinning fragment process-wide, during the first full build that
 * contains a skinned mesh. The first skinned model a page added after start used to get a bind-group
 * layout cached without that fragment, and from the next rebuild on WebGPU rejected every frame
 * ("Binding entry sampler not set") and the canvas stayed black. Later apps in the same page were
 * fine, so this file holds exactly one app: Vitest runs every browser test file in its own iframe,
 * with its own copy of Lite's modules.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

it("draws the first skinned model a page loads after start", async () => {
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
  // A light before start is what makes the warm-up build the PBR group at registration.
  running.world.createEntity("Sky").addComponent(Light, { type: "hemispheric", intensity: 1 });
  await running.start();

  const handle = await running.app.assets.loadAsync<ModelAsset>("models/rig.glb");
  running.world.createEntity("Rig").addComponent(Model, { model: handle });
  await running.advance(SETTLE_FRAMES * 3);

  expect(device.errors).toEqual([]);
  expect(running.errors).toEqual([]);
  // The camera looks straight at the rig's torso; a rejected frame leaves the canvas black.
  expect(pixelLuminance(await running.centrePixel())).toBeGreaterThan(20);
}, 60_000);
