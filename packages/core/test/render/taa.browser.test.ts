import { afterEach, describe, expect, it } from "vitest";
import { Quat } from "../../src/math/quat.js";
import { Camera } from "../../src/render/camera.js";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { createBrowserApp, gpuDeviceErrors, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { Entity } from "../../src/entity/entity.js";
import type { RenderCapture } from "../../src/render/renderer.js";

/**
 * `rendering.taa` on a real device (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, G5–G6): a
 * still scene converges to a stable image no blurrier than a tolerance, and a camera cut resets the
 * history.
 */

/** The canvas edge. Small keeps SwiftShader fast. */
const SIZE = 48;

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Builds a box turned 30° about the view axis, so its edges alias, in front of a black clear.
 *
 * @param taa - Whether `rendering.taa` is on.
 * @returns The running app and its camera entity.
 */
async function buildScene(taa: boolean): Promise<{ running: BrowserApp; eye: Entity }> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    settings: { rendering: { hdr: true, msaaSamples: 1, taa: { enabled: taa } } },
  });
  harness = running;
  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -6);
  eye.addComponent(Camera, { near: 0.1, far: 100, clearColor: { r: 0, g: 0, b: 0, a: 1 } });
  running.world.createEntity("Sky").addComponent(Light, { type: "hemispheric", intensity: 1 });
  const material = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  const cube = running.world.createEntity("Cube");
  Quat.fromEulerDegreesToRef(0, 0, 30, cube.transform.localRotation);
  cube.addComponent(MeshRenderer, { mesh: MeshAsset.box(running.app, { size: 2 }), materials: [material] });
  await running.start();
  await running.advance(SETTLE_FRAMES * 2);
  return { running, eye };
}

/**
 * The sum of squared luminance differences between neighbouring pixels: lower is blurrier.
 *
 * @param frame - The capture.
 * @returns The energy.
 */
function gradientEnergy(frame: RenderCapture): number {
  const luma = (x: number, y: number): number => {
    const index = (y * frame.width + x) * 4;
    return (
      0.2126 * (frame.data[index] ?? 0) + 0.7152 * (frame.data[index + 1] ?? 0) + 0.0722 * (frame.data[index + 2] ?? 0)
    );
  };
  let energy = 0;
  for (let y = 0; y < frame.height - 1; y += 1) {
    for (let x = 0; x < frame.width - 1; x += 1) {
      const centre = luma(x, y);
      energy += (luma(x + 1, y) - centre) ** 2 + (luma(x, y + 1) - centre) ** 2;
    }
  }
  return energy;
}

/**
 * The mean absolute byte difference between two captures.
 *
 * @param a - One capture.
 * @param b - The other, the same size.
 * @returns The mean difference, 0–255.
 */
function meanDifference(a: RenderCapture, b: RenderCapture): number {
  let sum = 0;
  for (let index = 0; index < a.data.length; index += 1) {
    sum += Math.abs((a.data[index] ?? 0) - (b.data[index] ?? 0));
  }
  return sum / a.data.length;
}

describe("rendering.taa", () => {
  it("converges on a still scene without blurring it past a tolerance", async () => {
    const device = gpuDeviceErrors();
    try {
      const plain = gradientEnergy(await (await buildScene(false)).running.app.renderer.captureScreenshot());
      harness?.dispose();
      harness = null;
      const { running } = await buildScene(true);
      expect(running.renderer.taa).not.toBeNull();
      await running.advance(30);
      const first = await running.app.renderer.captureScreenshot();
      await running.advance(1);
      const second = await running.app.renderer.captureScreenshot();
      // Converged: consecutive frames barely move although the projection is jittered each one.
      expect(meanDifference(first, second)).toBeLessThan(1.5);
      const energy = gradientEnergy(second);
      expect(plain).toBeGreaterThan(0);
      expect(energy).toBeGreaterThan(plain * 0.35);
      expect(running.errors).toEqual([]);
      expect(device.errors).toEqual([]);
    } finally {
      device.stop();
    }
  }, 90_000);

  it("resets the history on a camera cut and on request", async () => {
    const { running, eye } = await buildScene(true);
    const taa = running.renderer.taa;
    if (taa === null) {
      throw new Error("rendering.taa installed no passes");
    }
    await running.advance(4);
    const settled = taa.resetCount;
    expect(settled).toBeGreaterThanOrEqual(1);
    await running.advance(4);
    expect(taa.resetCount).toBe(settled);

    eye.transform.localPosition.set(0, 0, -60);
    await running.advance(4);
    expect(taa.resetCount).toBe(settled + 1);

    running.app.renderer.resetTemporalHistory();
    await running.advance(2);
    expect(taa.resetCount).toBe(settled + 2);
  }, 60_000);

  it("stays off without rendering.hdr and says so", async () => {
    const running = await createBrowserApp({
      size: SIZE,
      settings: { rendering: { hdr: false, taa: { enabled: true } } },
    });
    harness = running;
    expect(running.renderer.taa).toBeNull();
    expect(running.log.toArray().some((record) => record.message.includes("rendering.taa needs rendering.hdr"))).toBe(
      true,
    );
  }, 30_000);
});
