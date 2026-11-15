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
 * material assignment end to end. Two overlapping box probes with a `blendDistance` (step B1b),
 * each capturing only one coloured wall, make one mirror red at one end, blue at the other and both
 * in between.
 */

/** The canvas edge. */
const SIZE = 64;

/** Pixels on the sphere left and right of its centre. */
const LEFT = { x: (SIZE >> 1) - 8, y: SIZE >> 1 } as const;
const RIGHT = { x: (SIZE >> 1) + 8, y: SIZE >> 1 } as const;

let harness: BrowserApp | null = null;

/** The two channels a red-or-blue check reads. */
interface RedBlue {
  readonly r: number;
  readonly b: number;
}

/**
 * Whether a pixel is clearly red.
 *
 * @param c - The pixel.
 * @returns `true` when red dominates blue.
 */
function isRed(c: RedBlue): boolean {
  return c.r > c.b * 1.5 + 4;
}

/**
 * Whether a pixel is clearly blue.
 *
 * @param c - The pixel.
 * @returns `true` when blue dominates red.
 */
function isBlue(c: RedBlue): boolean {
  return c.b > c.r * 1.5 + 4;
}

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

  it("blends two overlapping box probes across a mirror", async () => {
    const running = await createBrowserApp({
      size: SIZE,
      startEmpty: false,
      assets: [
        { address: "environments/studio.env", url: fixtureUrl("studio.env"), type: "environment" },
        { address: "environments/brdf-lut.png", url: fixtureUrl("brdf-lut.png"), type: "texture" },
      ],
      settings: { rendering: { msaaSamples: 1, brdfLut: "environments/brdf-lut.png" } },
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
    // Two walls behind the camera on two layers; each probe captures one of them.
    const wall = (name: string, layer: string, colour: ColorLike): void => {
      const entity = world.createEntity(name);
      entity.layer = world.layers.indexOf(layer);
      entity.transform.localPosition.set(0, 0, -6);
      entity.addComponent(MeshRenderer, {
        mesh: MeshAsset.box(app, { width: 20, height: 20, depth: 0.2 }),
        materials: [material(colour, 0, 1)],
      });
    };
    wall("Red wall", "Water", { r: 1, g: 0, b: 0, a: 1 });
    wall("Blue wall", "IgnoreRaycast", { r: 0, g: 0, b: 1, a: 1 });
    // A flat mirror filling the view (the 60° camera sees x in ±1.73 at its depth).
    world.createEntity("Mirror").addComponent(MeshRenderer, {
      mesh: MeshAsset.box(app, { width: 8, height: 4, depth: 0.1 }),
      materials: [material({ r: 1, g: 1, b: 1, a: 1 }, 1, 0.05)],
    });
    // Boxes 6 wide at x = ±2.5 overlap over x in [-0.5, 0.5]; each probe has full weight only
    // within 1.5 of its centre's side (inner box x in [±1, ±4]), so the centre of the view blends.
    for (const [name, x, layer] of [
      ["Red probe", -2.5, "Water"],
      ["Blue probe", 2.5, "IgnoreRaycast"],
    ] as const) {
      world.createEntity(name, { position: { x, y: 0, z: -1.5 } }).addComponent(ReflectionProbe, {
        size: 64,
        boxProjection: { x: 6, y: 6, z: 12 },
        blendDistance: 1.5,
        cullingMask: [layer],
      });
    }
    await running.start();
    await settle(running, SETTLE_FRAMES * 6);
    expect(running.errors).toEqual([]);
    const y = SIZE >> 1;
    const left = await running.pixelAt(4, y);
    const centre = await running.pixelAt(SIZE >> 1, y);
    const right = await running.pixelAt(SIZE - 5, y);
    const message = JSON.stringify({ left, centre, right });
    expect((isRed(left) && isBlue(right)) || (isBlue(left) && isRed(right)), message).toBe(true);
    // Between the probes both colours show, neither dominating as at the ends.
    expect(Math.min(centre.r, centre.b), message).toBeGreaterThan(8);
    expect(isRed(centre) || isBlue(centre), message).toBe(false);
  }, 120_000);
});
