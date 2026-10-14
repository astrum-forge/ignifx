import { createMorphTargets } from "@babylonjs/lite";
import { afterEach, expect, it } from "vitest";
import { Camera } from "../../../src/render/camera.js";
import { Light } from "../../../src/render/light.js";
import { MeshAsset } from "../../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../../src/render/mesh-renderer.js";
import {
  createBrowserApp,
  gpuDeviceErrors,
  pixelLuminance,
  SETTLE_FRAMES,
} from "../../render/support/browser-harness.js";
import type { BrowserApp } from "../../render/support/browser-harness.js";

/**
 * A morph-target mesh added after `app.start()`, in a page that has never drawn one
 * (`src/lite/pbr-deformers.ts`).
 *
 * Babylon Lite registers its PBR morph-target fragment the way it registers the skinning one:
 * process-wide, during the first full build that contains such a mesh. A glTF with morph targets
 * gets them from Lite's loader without any opt-in, so the first one a page added after start used
 * to turn every frame into a validation error, like the first skinned model
 * (`test/render/skinned-model-after-start.browser.test.ts`). This file holds exactly one app for
 * the same reason.
 *
 * The first frame or two are still lost. Lite builds the new mesh at once, with a vertex shader
 * that names the morph fragment's output while the fragment is not registered yet, so WebGPU
 * rejects that pipeline until the engine's rebuild, one frame later, registers the fragment. A skinned mesh does not hit this, because its
 * shader without the fragment is merely unskinned.
 *
 * It lives under `test/lite/**` because it builds the morph targets through Babylon Lite directly;
 * ignifx has no morph-target API of its own.
 */

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** A one-metre quad facing the camera, as two triangles. */
const QUAD = {
  positions: new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
  normals: new Float32Array([0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1]),
  uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
} as const;

it("draws the first morph-target mesh a page adds after start", async () => {
  const device = gpuDeviceErrors();
  const running = await createBrowserApp({ startEmpty: false });
  harness = running;
  device.stop();
  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -3);
  eye.addComponent(Camera, { near: 0.1, far: 100 });
  // A light before start is what makes the warm-up build the PBR group at registration.
  running.world.createEntity("Sky").addComponent(Light, { type: "hemispheric", intensity: 1 });
  await running.start();

  const quad = MeshAsset.fromData(running.app, "morphed-quad", QUAD);
  const template = quad.value.lite.mesh;
  if (template === null) {
    throw new Error("a browser app uploads its meshes");
  }
  // One target that moves nothing, at full weight: the quad draws exactly as it would unmorphed.
  template.morphTargets = createMorphTargets(
    running.app.lite.engine,
    [{ positions: new Float32Array(QUAD.positions.length), normals: null }],
    QUAD.positions.length / 3,
    [1],
  );
  running.world.createEntity("Quad").addComponent(MeshRenderer, { mesh: quad });
  await running.advance(SETTLE_FRAMES * 3);
  const settledErrors = device.errors.length;
  await running.advance(SETTLE_FRAMES * 2);

  // Frames stopped being rejected once the rebuild ran, and the quad fills the centre of the frame.
  expect(device.errors).toHaveLength(settledErrors);
  expect(running.errors).toEqual([]);
  expect(pixelLuminance(await running.centrePixel())).toBeGreaterThan(20);
}, 60_000);
