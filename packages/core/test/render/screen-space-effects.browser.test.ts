import { afterEach, describe, expect, it } from "vitest";
import { frameGraphTasks } from "../../src/lite/gpu/scene-inputs.js";
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
  settle,
  SETTLE_FRAMES,
} from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { EnvironmentAsset } from "../../src/render/environment-asset.js";

/**
 * `PostProcessStack.contactShadows` and `.ssgi` on a real device: each pass changes the frame in
 * its direction, and a stack enabling neither adds no task.
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
 * @param boxShade - The box's base colour, the same in every channel; the floor stays white.
 * @returns The running app and its stack.
 */
async function buildScene(
  hdr: boolean,
  withEnvironment = false,
  boxShade = 0.9,
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
  const boxMaterial =
    boxShade === 0.9
      ? white
      : createMaterialAsset(
          running.app,
          pbrMaterialDefinition({
            baseColor: { r: boxShade, g: boxShade, b: boxShade, a: 1 },
            metallic: 0,
            roughness: 1,
          }),
          [],
        );
  const box = running.world.createEntity("Box");
  box.transform.localPosition.set(0, 0.75, 0);
  box.addComponent(MeshRenderer, { mesh: MeshAsset.box(running.app, { size: 1.5 }), materials: [boxMaterial] });
  const stack = eye.addComponent(PostProcessStack);
  await running.start();
  await settle(running, SETTLE_FRAMES * 2);
  return { running, stack };
}

/**
 * The mean luminance of a captured frame, or of a square in its middle.
 *
 * @param running - The running app.
 * @param half - Half the square's edge in pixels; the whole frame when omitted.
 * @returns The mean, 0 to 255.
 */
async function meanLuminance(running: BrowserApp, half?: number): Promise<number> {
  const frame = await running.app.renderer.captureScreenshot();
  const centreX = frame.width >> 1;
  const centreY = frame.height >> 1;
  let total = 0;
  let count = 0;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      if (half !== undefined && (Math.abs(x - centreX) > half || Math.abs(y - centreY) > half)) {
        continue;
      }
      const index = (y * frame.width + x) * 4;
      total += pixelLuminance({
        r: frame.data[index] ?? 0,
        g: frame.data[index + 1] ?? 0,
        b: frame.data[index + 2] ?? 0,
        a: 255,
      });
      count += 1;
    }
  }
  return total / count;
}

/** Half the edge of the square, in pixels, that lies inside the box in every frame of {@link buildScene}. */
const BOX_HALF = 6;

describe("PostProcessStack scene-colour passes", () => {
  it("contact shadows darken the floor where the box stands", async () => {
    const device = gpuDeviceErrors();
    try {
      const { running, stack } = await buildScene(false);
      expect(running.renderer.sceneInputsUserCount).toBe(0);
      const before = await meanLuminance(running);
      Object.assign(stack.contactShadows, { enabled: true, intensity: 3, length: 2, samples: 16 });
      await settle(running, SETTLE_FRAMES * 4);
      expect(running.renderer.sceneInputsUserCount).toBe(1);
      const after = await meanLuminance(running);
      expect(after).toBeLessThan(before - 0.5);
      stack.contactShadows.enabled = false;
      await settle(running);
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
      await settle(running, SETTLE_FRAMES * 6);
      expect(running.renderer.sceneInputsUserCount).toBe(1);
      expect(await meanLuminance(running)).toBeGreaterThan(before + 0.5);
      expect(device.errors).toEqual([]);
    } finally {
      device.stop();
    }
  }, 90_000);

  it("SSGI lights a surface by its own colour: a white box gains, a black one does not", async () => {
    const device = gpuDeviceErrors();
    try {
      // Lite's own composite added the bounce without the surface's colour, which lit a black
      // surface like a white one and washed the frame out.
      const white = await buildScene(true);
      const whiteBefore = await meanLuminance(white.running, BOX_HALF);
      Object.assign(white.stack.ssgi, { enabled: true, intensity: 3, radius: 3 });
      await settle(white.running, SETTLE_FRAMES * 6);
      const whiteGain = (await meanLuminance(white.running, BOX_HALF)) - whiteBefore;
      expect(whiteGain).toBeGreaterThan(1);
      white.running.dispose();

      const black = await buildScene(true, false, 0);
      const blackBefore = await meanLuminance(black.running, BOX_HALF);
      Object.assign(black.stack.ssgi, { enabled: true, intensity: 3, radius: 3 });
      await settle(black.running, SETTLE_FRAMES * 6);
      const blackGain = (await meanLuminance(black.running, BOX_HALF)) - blackBefore;
      expect(Math.abs(blackGain)).toBeLessThan(0.5);
      expect(device.errors).toEqual([]);
    } finally {
      device.stop();
    }
  }, 120_000);

  it("SSGI keeps drawing when its denoise passes, resolution and rays change, and across a resize", async () => {
    const device = gpuDeviceErrors();
    try {
      const { running, stack } = await buildScene(true);
      const before = await meanLuminance(running);
      Object.assign(stack.ssgi, { enabled: true, intensity: 3, radius: 3 });
      await settle(running, SETTLE_FRAMES * 6);
      const taskCount = (): number => frameGraphTasks(running.renderer.scene)?.length ?? 0;
      const withFourPasses = taskCount();
      // Each of these rebuilds the pass; a rebuild once freed the scene colour its composite wrote.
      stack.ssgi.denoisePasses = 0;
      await settle(running, SETTLE_FRAMES * 6);
      expect(taskCount()).toBe(withFourPasses - 4);
      expect(await meanLuminance(running)).toBeGreaterThan(before + 0.5);
      stack.ssgi.denoisePasses = 2;
      stack.ssgi.halfResolution = false;
      stack.ssgi.rays = 4;
      await settle(running, SETTLE_FRAMES * 6);
      expect(await meanLuminance(running)).toBeGreaterThan(before + 0.5);

      // Lite's loop snaps a laid-out canvas to its CSS box, which rebuilds the frame graph.
      const grown = SIZE + 32;
      running.canvas.style.width = `${String(grown)}px`;
      running.canvas.style.height = `${String(grown)}px`;
      await settle(running, SETTLE_FRAMES * 6);
      expect(running.canvas.width).toBeGreaterThan(SIZE);
      const resized = await meanLuminance(running);

      // Off again: the bounce leaves the frame, which is a different size now, so it is compared
      // with the frame just before.
      stack.ssgi.enabled = false;
      await settle(running, SETTLE_FRAMES * 2);
      expect(running.renderer.sceneInputsUserCount).toBe(0);
      expect(await meanLuminance(running)).toBeLessThan(resized - 0.5);
      expect(running.errors).toEqual([]);
      expect(device.errors).toEqual([]);
    } finally {
      device.stop();
    }
  }, 120_000);

  it("contact shadows and SSGI together keep the frame lit without HDR", async () => {
    const device = gpuDeviceErrors();
    try {
      // Two passes: on the plain path the second one used to write the lazily allocated scene
      // colour, which Lite reallocates under the scene task: "Destroyed texture" and a black frame.
      const { running, stack } = await buildScene(false);
      const before = await meanLuminance(running);
      stack.contactShadows.enabled = true;
      Object.assign(stack.ssgi, { enabled: true, intensity: 3, radius: 3, environmentDiffuse: 1 });
      await settle(running, SETTLE_FRAMES * 6);
      expect(running.renderer.sceneInputsUserCount).toBe(1);
      expect(await meanLuminance(running)).toBeGreaterThan(before * 0.5);
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
      await settle(running, SETTLE_FRAMES * 4);
      expect(await meanLuminance(running)).toBeLessThan(before - 0.5);
      expect(device.errors).toEqual([]);
    } finally {
      device.stop();
    }
  }, 90_000);
});
