import { afterEach, describe, expect, it } from "vitest";
import { Camera } from "../../src/render/camera.js";
import { Environment } from "../../src/render/environment.js";
import { Light } from "../../src/render/light.js";
import { createMaterialAsset, pbrMaterialDefinition } from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { ReflectionProbe } from "../../src/render/reflection-probe.js";
import { createBrowserApp, fixtureUrl, settle, SETTLE_FRAMES } from "./support/browser-harness.js";
import type { BrowserApp } from "./support/browser-harness.js";
import type { ColorLike } from "../../src/math/types.js";
import type { EnvironmentAsset } from "../../src/render/environment-asset.js";

/**
 * `ReflectionProbe` (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step B1): a mirror sphere in
 * front of the camera reflects the wall behind the camera, red on the left half and blue on the
 * right, once a probe has captured it. This checks the capture, the cube faces' orientation and the
 * material assignment end to end.
 */

/** The canvas edge. */
const SIZE = 64;

/** Pixels on the sphere left and right of its centre. */
const LEFT = { x: (SIZE >> 1) - 8, y: SIZE >> 1 } as const;
const RIGHT = { x: (SIZE >> 1) + 8, y: SIZE >> 1 } as const;

let harness: BrowserApp | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe("ReflectionProbe", () => {
  it.each([false, true])(
    "makes a mirror reflect the captured scene (hdr %s)",
    async (hdr) => {
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
      world.createEntity("Sky").addComponent(Light, { type: "hemispheric", intensity: 1 });
      const material = (
        baseColor: ColorLike,
        metallic: number,
        roughness: number,
      ): ReturnType<typeof createMaterialAsset> =>
        createMaterialAsset(app, pbrMaterialDefinition({ baseColor, metallic, roughness }), []);
      const wall = (name: string, x: number, colour: ColorLike): void => {
        const entity = world.createEntity(name);
        entity.transform.localPosition.set(x, 0, -6);
        entity.addComponent(MeshRenderer, {
          mesh: MeshAsset.box(app, { width: 10, height: 10, depth: 0.2 }),
          materials: [material(colour, 0, 1)],
        });
      };
      wall("Red wall", -5, { r: 1, g: 0, b: 0, a: 1 });
      wall("Blue wall", 5, { r: 0, g: 0, b: 1, a: 1 });
      world.createEntity("Mirror").addComponent(MeshRenderer, {
        mesh: MeshAsset.sphere(app, { diameter: 2, segments: 32 }),
        materials: [material({ r: 1, g: 1, b: 1, a: 1 }, 1, 0.05)],
      });
      world.createEntity("Probe", { position: { x: 0, y: 0, z: -1.5 } }).addComponent(ReflectionProbe, { size: 64 });
      await running.start();
      await settle(running, SETTLE_FRAMES * 3);
      expect(running.errors).toEqual([]);
      expect(running.renderer.reflectionProbeHost?.isActive).toBe(true);
      const left = await running.pixelAt(LEFT.x, LEFT.y);
      const right = await running.pixelAt(RIGHT.x, RIGHT.y);
      expect(left.r).toBeGreaterThan(left.b * 1.5 + 4);
      expect(right.b).toBeGreaterThan(right.r * 1.5 + 4);
    },
    120_000,
  );
});
