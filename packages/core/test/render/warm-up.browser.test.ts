import { afterEach, describe, expect, it } from "vitest";
import {
  createCameraUnderNode,
  setCameraClipPlanes,
  setCameraPerspective,
  setSceneCamera,
} from "../../src/lite/camera.js";
import { addMeshToScene, createBoxMesh, setMeshMaterial } from "../../src/lite/gpu/mesh.js";
import { captureFrame } from "../../src/lite/gpu/screenshot-capture.js";
import { warmUpMaterials } from "../../src/lite/gpu/warm-up.js";
import { addLightToScene, createHemisphericLightInWorld } from "../../src/lite/light.js";
import { registerFrameCallback } from "../../src/lite/loop.js";
import { createPbrMaterialFromProps } from "../../src/lite/material.js";
import { createNode } from "../../src/lite/node.js";
import { Camera } from "../../src/render/camera.js";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { advanceFrames, createRenderHarness } from "../lite/render/fixtures/gpu-harness.js";
import { createBrowserApp, pixelLuminance, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { RenderHarness } from "../lite/render/fixtures/gpu-harness.js";

/**
 * The condition ADR-0014 does not state, and the guard `app.renderer.warmUpAtStart` grew because of
 * it: **a warm-up probe registered into a scene that has no lights leaves every later mesh of that
 * family undrawn.** Not dim — the scene's render pass presents nothing at all, clear colour
 * included.
 *
 * Measured on Chromium + SwiftShader, 2026-09-05. The spike behind ADR-0014 (`S2.2`,
 * `test/lite/render/warm-up.browser.test.ts`) never saw it because it always registered a light and
 * a camera before warming up, which is the shape a game that loads its scene before `start()` has.
 * The shape that breaks is an app that starts empty and builds its world afterwards — which is what
 * a test, an editor, and a loading screen all do.
 *
 * The first suite pins the raw Lite behaviour so a version bump that fixes it fails loudly and the
 * guard can go. The second pins the guard: an app that starts empty renders.
 */

let adapter: RenderHarness | null = null;
let browser: BrowserApp | null = null;

afterEach(() => {
  adapter?.dispose();
  adapter = null;
  browser?.dispose();
  browser = null;
});

/**
 * Counts the pixels of the next capture that are not pure black.
 *
 * @param harness - The running adapter harness.
 * @returns How many of the capture's pixels carry any colour at all.
 */
async function litPixels(harness: RenderHarness): Promise<number> {
  const frame = await captureFrame(harness.engine);
  let count = 0;
  for (let index = 0; index < frame.data.length; index += 4) {
    if ((frame.data[index] ?? 0) + (frame.data[index + 1] ?? 0) + (frame.data[index + 2] ?? 0) > 0) {
      count += 1;
    }
  }
  return count;
}

/**
 * Builds a registered scene on a red background and adds a lit box to it from inside the
 * before-render callback — the shape `app.start()` produces.
 *
 * @param options - The combination being measured.
 * @param options.warmUp - Whether a material family is warmed up before registration.
 * @param options.lightAtRegister - Whether the scene already has a light when it registers.
 * @returns How many pixels the capture shows.
 */
async function measure(options: { readonly warmUp: boolean; readonly lightAtRegister: boolean }): Promise<number> {
  const harness = await createRenderHarness({
    size: 32,
    msaaSamples: 1,
    beforeRegister: (engine, scene) => {
      scene.clearColor = { r: 1, g: 0, b: 0, a: 1 };
      if (options.lightAtRegister) {
        addLightToScene(scene, createHemisphericLightInWorld(1));
      }
      if (options.warmUp) {
        warmUpMaterials(engine, scene, [createPbrMaterialFromProps({ metallic: 0, roughness: 1 })]);
      }
    },
  });
  adapter = harness;
  if (!options.lightAtRegister) {
    addLightToScene(harness.scene, createHemisphericLightInWorld(1));
  }
  const cameraNode = createNode("camera");
  cameraNode.position.set(0, 0, -4);
  const camera = createCameraUnderNode(cameraNode);
  setCameraPerspective(camera, 60);
  setCameraClipPlanes(camera, 0.1, 100);
  setSceneCamera(harness.scene, camera);

  let added = false;
  registerFrameCallback(harness.scene, () => {
    if (added) {
      return;
    }
    added = true;
    const box = createBoxMesh(harness.engine, 2);
    setMeshMaterial(box, createPbrMaterialFromProps({ metallic: 0, roughness: 1 }));
    addMeshToScene(harness.scene, box);
  });
  await advanceFrames(harness, 30);
  return litPixels(harness);
}

describe("a warm-up probe in a scene with no lights", () => {
  it("stops the render pass presenting anything at all", async () => {
    expect(await measure({ warmUp: true, lightAtRegister: false })).toBe(0);
  });
});

describe("the three cases that do work", () => {
  it("renders with no warm-up at all", async () => {
    expect(await measure({ warmUp: false, lightAtRegister: false })).toBeGreaterThan(0);
  });

  it("renders when a light was in the scene at registration", async () => {
    expect(await measure({ warmUp: true, lightAtRegister: true })).toBeGreaterThan(0);
  });

  it("renders when a light was in the scene and nothing was warmed", async () => {
    expect(await measure({ warmUp: false, lightAtRegister: true })).toBeGreaterThan(0);
  });
});

describe("the guard, through the app", () => {
  it("renders an app that starts empty and builds its world afterwards", async () => {
    const running = await createBrowserApp({ size: 32 });
    browser = running;
    // Nothing existed at `start()`, so no probes were installed.
    const eye = running.world.createEntity("Main Camera");
    eye.transform.localPosition.set(0, 0, -4);
    eye.addComponent(Camera, { near: 0.1, far: 100 });
    running.world.createEntity("Sun").addComponent(Light, { type: "hemispheric", intensity: 1 });
    const mesh = MeshAsset.box(running.app, { size: 2 });
    const material = createMaterialAsset(running.app, pbrMaterialDefinition({ metallic: 0, roughness: 1 }), []);
    running.world.createEntity("Cube").addComponent(MeshRenderer, { mesh, materials: [material] });

    await running.advance(SETTLE_FRAMES * 2);
    expect(pixelLuminance(await running.centrePixel())).toBeGreaterThan(20);
    expect(running.errors).toEqual([]);
  });

  it("renders an app whose world already had a light when it started", async () => {
    const running = await createBrowserApp({ size: 32, startEmpty: false });
    browser = running;
    const eye = running.world.createEntity("Main Camera");
    eye.transform.localPosition.set(0, 0, -4);
    eye.addComponent(Camera, { near: 0.1, far: 100 });
    running.world.createEntity("Sun").addComponent(Light, { type: "hemispheric", intensity: 1 });
    await running.start();

    const mesh = MeshAsset.box(running.app, { size: 2 });
    const material = createMaterialAsset(running.app, pbrMaterialDefinition({ metallic: 0, roughness: 1 }), []);
    running.world.createEntity("Cube").addComponent(MeshRenderer, { mesh, materials: [material] });
    await running.advance(SETTLE_FRAMES * 2);
    expect(pixelLuminance(await running.centrePixel())).toBeGreaterThan(20);
  });
});
