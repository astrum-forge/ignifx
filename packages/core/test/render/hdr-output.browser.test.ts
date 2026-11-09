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
 * `rendering.hdr` on a real device (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, step G2): the
 * scene lands in an `rgba16float` target with values above 1, and one output pass tone maps it onto
 * the swapchain.
 */

/** The canvas edge. Small keeps SwiftShader fast. */
const SIZE = 48;

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Builds a white box lit by a hemispheric light bright enough to push linear colour above 1.
 *
 * @param options - Scene options.
 * @param options.hdr - Whether `rendering.hdr` is on.
 * @param options.msaaSamples - The MSAA sample count.
 * @param options.postProcessing - Whether the post-processing feature and an SMAA stack are on.
 * @param options.intensity - The light's intensity; the default 8 pushes linear colour past 1.
 * @returns The running app.
 */
async function buildScene(options: {
  readonly hdr: boolean;
  readonly msaaSamples?: number;
  readonly postProcessing?: boolean;
  readonly intensity?: number;
}): Promise<BrowserApp> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    settings: {
      rendering: {
        hdr: options.hdr,
        msaaSamples: options.msaaSamples ?? 1,
        features: { postProcessing: options.postProcessing === true },
      },
    },
  });
  harness = running;
  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -6);
  eye.addComponent(Camera, { near: 0.1, far: 100, clearColor: { r: 0, g: 0, b: 0, a: 1 } });
  running.world.createEntity("Sky").addComponent(Light, { type: "hemispheric", intensity: options.intensity ?? 8 });
  const material = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  running.world
    .createEntity("Cube")
    .addComponent(MeshRenderer, { mesh: MeshAsset.box(running.app, { size: 2 }), materials: [material] });
  if (options.postProcessing === true) {
    running.world.createEntity("Post").addComponent(PostProcessStack).smaa.enabled = true;
  }
  await running.start();
  await settle(running, SETTLE_FRAMES * 2);
  return running;
}

/**
 * Converts one IEEE half float to a number.
 *
 * @param half - The 16 bits.
 * @returns The value.
 */
function halfToFloat(half: number): number {
  const sign = (half & 0x80_00) === 0 ? 1 : -1;
  const exponent = (half >> 10) & 0x1f;
  const fraction = half & 0x3_ff;
  if (exponent === 0) {
    return sign * 2 ** -14 * (fraction / 1024);
  }
  if (exponent === 31) {
    return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
  }
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

/**
 * Reads the centre texel of the HDR scene target.
 *
 * @param running - The running app, built with `hdr: true`.
 * @returns The red channel, linear.
 */
async function hdrCentre(running: BrowserApp): Promise<number> {
  const hdr = running.renderer.presenter?.hdr;
  if (hdr === undefined || hdr === null) {
    throw new Error("the app built no HDR output pass");
  }
  // The device is Lite's private field; a test may reach it to read a texture back.
  const device: unknown = Reflect.get(running.renderer.engine, "_device");
  if (!(device instanceof GPUDevice)) {
    throw new Error("the engine holds no GPU device");
  }
  const texture = hdr.sceneTexture.texture;
  const buffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture, origin: { x: texture.width >> 1, y: texture.height >> 1 } },
    { buffer, bytesPerRow: 256 },
    { width: 1, height: 1 },
  );
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const halves = new Uint16Array(buffer.getMappedRange().slice(0, 8));
  buffer.unmap();
  buffer.destroy();
  return halfToFloat(halves[0] ?? 0);
}

describe("rendering.hdr", () => {
  it("keeps linear colour above 1 in an rgba16float scene target", async () => {
    const running = await buildScene({ hdr: true });
    expect(running.renderer.presenter?.hdr?.sceneTexture.texture.format).toBe("rgba16float");
    expect(await hdrCentre(running)).toBeGreaterThan(1.5);
    expect(pixelLuminance(await running.centrePixel())).toBeGreaterThan(200);
  }, 60_000);

  it("presents what the plain path presents, within half-float rounding", async () => {
    // A dim light, so the box is a mid-tone and a wrong curve or a double encode would show.
    const plain = pixelLuminance(await (await buildScene({ hdr: false, intensity: 0.5 })).centrePixel());
    harness?.dispose();
    harness = null;
    const hdr = pixelLuminance(await (await buildScene({ hdr: true, intensity: 0.5 })).centrePixel());
    expect(plain).toBeGreaterThan(40);
    expect(plain).toBeLessThan(220);
    expect(Math.abs(hdr - plain)).toBeLessThanOrEqual(2);
  }, 60_000);

  it("resolves a 4x MSAA rgba16float target without a validation error", async () => {
    const device = gpuDeviceErrors();
    try {
      const running = await buildScene({ hdr: true, msaaSamples: 4 });
      expect(await hdrCentre(running)).toBeGreaterThan(1.5);
      expect(pixelLuminance(await running.centrePixel())).toBeGreaterThan(200);
      expect(device.errors).toEqual([]);
    } finally {
      device.stop();
    }
  }, 60_000);

  it("tone maps before a post-process chain, which then reads encoded colour", async () => {
    const device = gpuDeviceErrors();
    try {
      const alone = await buildScene({ hdr: true, intensity: 0.5 });
      expect(alone.renderer.presenter?.isPresentEnabled).toBe(true);
      const plain = pixelLuminance(await alone.centrePixel());
      alone.dispose();
      harness = null;
      // The chain reads the output pass's encoded colour: were it recorded first, it would read a
      // target nobody wrote and present black, and were it fed linear colour the box would clip.
      const chained = await buildScene({ hdr: true, postProcessing: true, intensity: 0.5 });
      expect(chained.renderer.presenter?.isPresentEnabled).toBe(false);
      expect(Math.abs(pixelLuminance(await chained.centrePixel()) - plain)).toBeLessThanOrEqual(4);
      expect(device.errors).toEqual([]);
    } finally {
      device.stop();
    }
  }, 60_000);
});
