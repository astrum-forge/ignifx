import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { Environment } from "../../src/render/environment.js";
import { createLightProbeAsset } from "../../src/render/light-probe-asset.js";
import { LightProbeVolume } from "../../src/render/light-probe-volume.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { createBrowserApp, fixtureUrl, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { PixelRgba } from "../../src/lite/screenshot.js";
import type { EnvironmentAsset } from "../../src/render/environment-asset.js";

/**
 * `LightProbeVolume` (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step B2): a white, rough
 * sphere lit only by the environment turns red inside a grid of red probes, with HDR off and on.
 */

/** The canvas edge. */
const SIZE = 64;

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Renders the sphere and reads its centre.
 *
 * @param withVolume - Whether a red probe grid surrounds it.
 * @param hdr - Whether `rendering.hdr` is on.
 * @returns The centre pixel.
 */
async function sphere(withVolume: boolean, hdr: boolean): Promise<PixelRgba> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    assets: [
      { address: "environments/studio.env", url: fixtureUrl("studio.env"), type: "environment" },
      { address: "environments/brdf-lut.png", url: fixtureUrl("brdf-lut.png"), type: "texture" },
    ],
    settings: { rendering: { msaaSamples: 1, hdr, brdfLut: "environments/brdf-lut.png" } },
  });
  harness = running;
  const { app, world } = running;
  const eye = world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -3);
  eye.addComponent(Camera, { near: 0.1, far: 50 });
  const environment = world.createEntity("Environment").addComponent(Environment, {});
  environment.environment = await app.assets.loadAsync<EnvironmentAsset>("environments/studio.env");
  world.createEntity("Ball").addComponent(MeshRenderer, {
    mesh: MeshAsset.sphere(app, { diameter: 2, segments: 32 }),
    materials: [
      createMaterialAsset(
        app,
        pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
        [],
      ),
    ],
  });
  if (withVolume) {
    const red = [0.8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const probes = createLightProbeAsset(app, {
      origin: { x: -2, y: -2, z: -2 },
      cellSize: { x: 4, y: 4, z: 4 },
      counts: { x: 2, y: 2, z: 2 },
      coefficients: Array.from({ length: 8 }, () => red).flat(),
    });
    world.createEntity("Probes").addComponent(LightProbeVolume, { probes });
  }
  await running.start();
  await running.advance(SETTLE_FRAMES * 3);
  expect(running.errors).toEqual([]);
  expect(running.renderer.lightProbeHost?.isLighting ?? false).toBe(withVolume);
  const centre = await running.centrePixel();
  running.dispose();
  harness = null;
  return centre;
}

describe("LightProbeVolume", () => {
  it.each([false, true])(
    "replaces the environment's diffuse light with the probes' (hdr %s)",
    async (hdr) => {
      const plain = await sphere(false, hdr);
      const lit = await sphere(true, hdr);
      // Under the studio environment the ball is near grey; inside red probes it turns red.
      expect(Math.abs(plain.r - plain.g)).toBeLessThan(40);
      expect(lit.r).toBeGreaterThan(lit.g * 2 + 10);
      expect(lit.g).toBeLessThan(plain.g);
    },
    120_000,
  );
});
