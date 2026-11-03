import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { Environment } from "../../src/render/environment.js";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { PostProcessStack } from "../../src/render/post-process-stack.js";
import {
  createBrowserApp,
  fixtureUrl,
  gpuDeviceErrors,
  pixelLuminance,
  SETTLE_FRAMES,
} from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { EnvironmentAsset } from "../../src/render/environment-asset.js";

/**
 * `PostProcessStack.contactShadows` and `.ssgi` on a real device (GI plan steps G10 and G11): each
 * pass changes the frame in its direction, and a stack enabling neither adds no task.
 */

/** The canvas edge. Small keeps SwiftShader fast. */
const SIZE = 64;

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Builds a white floor with a box standing on it, a sun, and a stack with every effect off.
 *
 * @param hdr - Whether `rendering.hdr` is on.
 * @param withEnvironment - Whether an `.env` lights the scene too.
 * @returns The running app and its stack.
 */
async function buildScene(
  hdr: boolean,
  withEnvironment = false,
): Promise<{ readonly running: BrowserApp; readonly stack: PostProcessStack }> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    assets: [
      { address: "environments/studio.env", url: fixtureUrl("studio.env"), type: "environment" },
      { address: "environments/brdf-lut.png", url: fixtureUrl("brdf-lut.png"), type: "texture" },
    ],
    settings: {
      rendering: {
        hdr,
        msaaSamples: 1,
        brdfLut: "environments/brdf-lut.png",
        features: { postProcessing: true },
      },
    },
  });
  harness = running;
  if (withEnvironment) {
    const environment = running.world.createEntity("Environment").addComponent(Environment, {});
    environment.environment = await running.app.assets.loadAsync<EnvironmentAsset>("environments/studio.env");
  }
  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 3, -3);
  eye.transform.lookAt({ x: 0, y: 0.5, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 50, fov: 60, clearColor: { r: 0, g: 0, b: 0, a: 1 } });
  const sun = running.world.createEntity("Sun");
  sun.transform.localPosition.set(2, 6, 1);
  sun.transform.lookAt({ x: 0, y: 0, z: 0 });
  sun.addComponent(Light, { type: "directional", intensity: 2 });
  const white = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 0.9, g: 0.9, b: 0.9, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  running.world
    .createEntity("Floor")
    .addComponent(MeshRenderer, { mesh: MeshAsset.ground(running.app, { width: 10, height: 10 }), materials: [white] });
  const box = running.world.createEntity("Box");
  box.transform.localPosition.set(0, 0.75, 0);
  box.addComponent(MeshRenderer, { mesh: MeshAsset.box(running.app, { size: 1.5 }), materials: [white] });
  const stack = eye.addComponent(PostProcessStack);
  await running.start();
  await running.advance(SETTLE_FRAMES * 2);
  return { running, stack };
}

/**
 * The mean luminance of a whole captured frame.
 *
 * @param running - The running app.
 * @returns The mean, 0 to 255.
 */
async function meanLuminance(running: BrowserApp): Promise<number> {
  const frame = await running.app.renderer.captureScreenshot();
  let total = 0;
  let count = 0;
  for (let index = 0; index < frame.data.length; index += 4) {
    total += pixelLuminance({
      r: frame.data[index] ?? 0,
      g: frame.data[index + 1] ?? 0,
      b: frame.data[index + 2] ?? 0,
      a: 255,
    });
    count += 1;
  }
  return total / count;
}

describe("PostProcessStack scene-colour passes", () => {
  it("contact shadows darken the floor where the box stands", async () => {
    const device = gpuDeviceErrors();
    try {
      const { running, stack } = await buildScene(false);
      expect(running.renderer.sceneInputsUserCount).toBe(0);
      const before = await meanLuminance(running);
      Object.assign(stack.contactShadows, { enabled: true, intensity: 3, length: 2, samples: 16 });
      await running.advance(SETTLE_FRAMES * 4);
      expect(running.renderer.sceneInputsUserCount).toBe(1);
      const after = await meanLuminance(running);
      expect(after).toBeLessThan(before - 0.5);
      stack.contactShadows.enabled = false;
      await running.advance(SETTLE_FRAMES);
      expect(running.renderer.sceneInputsUserCount).toBe(0);
      expect(Math.abs((await meanLuminance(running)) - before)).toBeLessThan(0.5);
      expect(device.errors).toEqual([]);
    } finally {
      device.stop();
    }
  }, 90_000);

  it("SSGI brightens the scene with the floor's bounce, under HDR", async () => {
    const device = gpuDeviceErrors();
    try {
      const { running, stack } = await buildScene(true);
      const before = await meanLuminance(running);
      Object.assign(stack.ssgi, { enabled: true, intensity: 3, radius: 3, environmentDiffuse: 1 });
      await running.advance(SETTLE_FRAMES * 6);
      expect(running.renderer.sceneInputsUserCount).toBe(1);
      expect(await meanLuminance(running)).toBeGreaterThan(before + 0.5);
      expect(device.errors).toEqual([]);
    } finally {
      device.stop();
    }
  }, 90_000);

  it("turns the environment's diffuse light down while SSGI runs", async () => {
    const device = gpuDeviceErrors();
    try {
      const { running, stack } = await buildScene(true, true);
      const before = await meanLuminance(running);
      // No bounce added, all environment diffuse removed: only the plugin changes the frame.
      Object.assign(stack.ssgi, { enabled: true, intensity: 0, environmentDiffuse: 0 });
      await running.advance(SETTLE_FRAMES * 4);
      expect(await meanLuminance(running)).toBeLessThan(before - 0.5);
      expect(device.errors).toEqual([]);
    } finally {
      device.stop();
    }
  }, 90_000);
});
