import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { Environment } from "../../src/render/environment.js";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { createBrowserApp, fixtureUrl, pixelLuminance, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { EnvironmentAsset } from "../../src/render/environment-asset.js";

/**
 * `rendering.ambientOcclusion` (`docs/plan/2026-11-gi-phase-1-execution-plan.md`, steps G8 and G9):
 * the inside corner between a floor and a wall gets darker under environment light, and a scene lit
 * only by a direct light does not change.
 */

/** The canvas edge. */
const SIZE = 64;

/** A wall pixel just above the floor line (the corner) and one high on the wall, away from it. */
const CORNER = { x: SIZE >> 1, y: 44 } as const;
const OPEN_WALL = { x: SIZE >> 1, y: 16 } as const;

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * Renders the corner and reads the two pixels' luminance.
 *
 * @param options - Whether AO is on, which light the scene has, and whether HDR is on.
 * @param options.ao - Whether `rendering.ambientOcclusion` is on.
 * @param options.light - An environment cube map only, or a hemispheric light only.
 * @param options.hdr - Whether `rendering.hdr` is on.
 * @returns The corner and open-wall luminance.
 */
async function corner(options: {
  readonly ao: boolean;
  readonly light: "environment" | "direct";
  readonly hdr?: boolean;
}): Promise<{ corner: number; open: number }> {
  const running = await createBrowserApp({
    size: SIZE,
    startEmpty: false,
    assets: [
      { address: "environments/studio.env", url: fixtureUrl("studio.env"), type: "environment" },
      { address: "environments/brdf-lut.png", url: fixtureUrl("brdf-lut.png"), type: "texture" },
    ],
    settings: {
      rendering: {
        msaaSamples: 1,
        hdr: options.hdr === true,
        brdfLut: "environments/brdf-lut.png",
        ambientOcclusion: { enabled: options.ao, quality: "full", radius: 1, intensity: 1.5, falloff: 0.5 },
      },
    },
  });
  harness = running;
  const eye = running.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 0, -3);
  eye.addComponent(Camera, { near: 0.1, far: 50 });
  const environment = running.world.createEntity("Environment").addComponent(Environment, {});
  if (options.light === "environment") {
    environment.environment = await running.app.assets.loadAsync<EnvironmentAsset>("environments/studio.env");
  } else {
    running.world.createEntity("Sky").addComponent(Light, { type: "hemispheric", intensity: 1 });
  }
  const white = createMaterialAsset(
    running.app,
    pbrMaterialDefinition({ baseColor: { r: 0.8, g: 0.8, b: 0.8, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  const floor = running.world.createEntity("Floor");
  floor.transform.localPosition.set(0, -1.1, 0);
  floor.addComponent(MeshRenderer, {
    mesh: MeshAsset.box(running.app, { width: 8, height: 0.2, depth: 8 }),
    materials: [white],
  });
  const wall = running.world.createEntity("Wall");
  wall.transform.localPosition.set(0, 2, 1.1);
  wall.addComponent(MeshRenderer, {
    mesh: MeshAsset.box(running.app, { width: 8, height: 6, depth: 0.2 }),
    materials: [white],
  });
  await running.start();
  await running.advance(SETTLE_FRAMES * 3);
  expect(running.errors).toEqual([]);
  expect(running.renderer.isAmbientOcclusionActive).toBe(options.ao);
  const near = pixelLuminance(await running.pixelAt(CORNER.x, CORNER.y));
  const far = pixelLuminance(await running.pixelAt(OPEN_WALL.x, OPEN_WALL.y));
  harness.dispose();
  harness = null;
  return { corner: near, open: far };
}

describe("rendering.ambientOcclusion", () => {
  it.each([false, true])(
    "darkens the corner under environment light (hdr %s)",
    async (hdr) => {
      const off = await corner({ ao: false, light: "environment", hdr });
      const on = await corner({ ao: true, light: "environment", hdr });
      // The corner loses light; the open wall, with no occluder within the radius, barely changes.
      expect(on.corner).toBeLessThan(off.corner * 0.9);
      expect(Math.abs(on.open - off.open)).toBeLessThan(off.open * 0.08 + 2);
    },
    120_000,
  );

  it("leaves direct light unchanged", async () => {
    const off = await corner({ ao: false, light: "direct" });
    const on = await corner({ ao: true, light: "direct" });
    expect(Math.abs(on.corner - off.corner)).toBeLessThanOrEqual(2);
    expect(Math.abs(on.open - off.open)).toBeLessThanOrEqual(2);
  }, 120_000);
});
