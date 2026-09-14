import { createApp, createManualClock, Vec3 } from "@ignifx/core";
import { Terrain, terrain, terrainAssetFromDefinition } from "@ignifx/terrain";
import { describe, expect, it } from "vitest";
import { HeightfieldCollider } from "../src/components/colliders.js";
import { physics } from "../src/extension.js";
import { loadHavokForTests } from "./lite/fixtures/havok.js";
import type { App } from "@ignifx/core";

/**
 * The one place `@ignifx/terrain` and `@ignifx/physics` are checked against each other
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §5.4). `Terrain.colliderInit()` couples the two
 * by data, so nothing enforces that the two agree except a test that drives both.
 *
 * It lives here rather than in `packages/terrain/test` because the layering rule lets physics see
 * terrain and not the other way round: a terrain must cost no physics code
 * (`docs/architecture/00-overview.md` §2.1).
 *
 * The regression it guards: the collider used to be mirrored in Z, because Babylon Lite reads the
 * sample array the way its own ground-mesh path writes it — rows from the largest Z to the
 * smallest (`lib/physics/havok-heightfield.js`).
 */

/** Samples per side of the fixture terrain. */
const RESOLUTION = 33;

/** The fixture's extent in metres, so one sample is two metres. */
const WIDTH = 64;

/** How high the probe rays start. */
const RAY_HEIGHT = 200;

/** How far a probe ray reaches. */
const RAY_LENGTH = 500;

/** Metres of slack between a ray hit and the queried height; the grid is two metres wide. */
const TOLERANCE = 0.05;

/**
 * Heights that differ along **both** axes, so a mirror, a transpose, and a swap all show up.
 *
 * @returns The heights, in metres.
 */
function slopedHeights(): Float32Array {
  const heights = new Float32Array(RESOLUTION * RESOLUTION);
  for (let iz = 0; iz < RESOLUTION; iz += 1) {
    for (let ix = 0; ix < RESOLUTION; ix += 1) {
      heights[iz * RESOLUTION + ix] = iz + ix * 0.5;
    }
  }
  return heights;
}

/**
 * Builds a headless app with both extensions and one terrain of {@link slopedHeights}.
 *
 * @returns The app and its terrain, stepped far enough that the terrain has built.
 */
async function createTerrainWorld(): Promise<{ readonly app: App; readonly ground: Terrain }> {
  const havok = await loadHavokForTests();
  const app = await createApp({
    headless: true,
    clock: createManualClock(),
    logLevel: "silent",
    extensions: [physics({ havok }), terrain()],
  });
  const definition = await terrainAssetFromDefinition(
    app,
    {
      size: { width: WIDTH, depth: WIDTH, height: 64 },
      resolution: RESOLUTION,
      chunks: { size: 8, lodLevels: 2 },
    },
    { heights: slopedHeights() },
  );
  const entity = app.world.createEntity("Ground");
  const ground = entity.addComponent(Terrain, { definition });
  await app.start();
  app.step(1 / 60);
  app.step(1 / 60);
  return { app, ground };
}

/**
 * Drops a ray onto the physics world and reports where it landed.
 *
 * @param app - The app.
 * @param x - The world X.
 * @param z - The world Z.
 * @returns The hit height in metres, or `null` for a miss.
 */
function groundUnder(app: App, x: number, z: number): number | null {
  const hit = app.physics.raycast({ x, y: RAY_HEIGHT, z }, { x: 0, y: -1, z: 0 }, RAY_LENGTH);
  return hit === null ? null : hit.point.y;
}

describe("a HeightfieldCollider built from Terrain.colliderInit", () => {
  it("puts the physics ground where heightAt says it is, at every off-centre point", async () => {
    const { app, ground } = await createTerrainWorld();
    ground.entity.addComponent(HeightfieldCollider, ground.colliderInit());
    app.step(1 / 60);
    app.step(1 / 60);

    // Off-centre in Z, in X, and in both, with signs that a mirror or a transpose would swap.
    for (const [x, z] of [
      [0, 0],
      [0, 20],
      [0, -20],
      [20, 0],
      [-20, 0],
      [30, 50 - 64],
      [-30, -10],
      [10, -24],
      [-10, 24],
    ] as const) {
      const hit = groundUnder(app, x, z);
      expect(hit, `ray at (${String(x)}, ${String(z)}) missed the collider`).not.toBeNull();
      expect(hit ?? 0, `ray at (${String(x)}, ${String(z)})`).toBeCloseTo(ground.heightAt(x, z), 1);
    }
    app.dispose();
  });

  it("is not mirrored in Z", async () => {
    const { app, ground } = await createTerrainWorld();
    ground.entity.addComponent(HeightfieldCollider, ground.colliderInit());
    app.step(1 / 60);
    app.step(1 / 60);

    // The fixture rises with Z, so the mirrored answer is a different number at every off-centre
    // point; asserting the difference is what makes the regression impossible to reintroduce.
    const near = groundUnder(app, 0, -20) ?? 0;
    const far = groundUnder(app, 0, 20) ?? 0;

    expect(far).toBeGreaterThan(near);
    expect(Math.abs(far - ground.heightAt(0, -20))).toBeGreaterThan(1);
    app.dispose();
  });

  it("follows the terrain after a sculpt", async () => {
    const { app, ground } = await createTerrainWorld();
    const collider = ground.entity.addComponent(HeightfieldCollider, ground.colliderInit());
    app.step(1 / 60);
    app.step(1 / 60);

    const patch = new Float32Array(9 * 9).fill(50);
    ground.setHeights(16, 20, 9, 9, patch);
    Object.assign(collider, ground.colliderInit());
    collider.rebuild();
    app.step(1 / 60);
    app.step(1 / 60);

    // Samples x 16..24, z 20..28 cover local x 0..16, z 8..24.
    expect(groundUnder(app, 8, 16) ?? 0).toBeCloseTo(50, 1);
    expect(groundUnder(app, 8, 16) ?? 0).toBeCloseTo(ground.heightAt(8, 16), 1);
    app.dispose();
  });

  it("moves the ground with the terrain's entity", async () => {
    const { app, ground } = await createTerrainWorld();
    ground.entity.transform.localPosition.set(0, 10, 0);
    ground.entity.addComponent(HeightfieldCollider, ground.colliderInit());
    app.step(1 / 60);
    app.step(1 / 60);

    expect(groundUnder(app, 0, 20) ?? 0).toBeCloseTo(ground.heightAt(0, 20), 1);
    app.dispose();
  });

  it("covers only its region, centred on the collider's own entity", async () => {
    const { app, ground } = await createTerrainWorld();
    const region = { x: 0, z: 8, width: 17, depth: 17 };
    // A HeightfieldCollider ignores `Collider.center`, so the patch goes on a child entity placed
    // at the region's centre; `regionCenter` is what reports it.
    const patch = app.world.createEntity("Ground patch");
    patch.setParent(ground.entity);
    patch.transform.localPosition.copyFrom(ground.regionCenter(region, new Vec3()));
    patch.addComponent(HeightfieldCollider, ground.colliderInit(region));
    app.step(1 / 60);
    app.step(1 / 60);

    // Inside the region the collider agrees with the terrain; outside it there is nothing to hit.
    for (const [x, z] of [
      [-16, 0],
      [-8, 12],
      [-24, -12],
    ] as const) {
      expect(groundUnder(app, x, z) ?? 0, `inside the region at (${String(x)}, ${String(z)})`).toBeCloseTo(
        ground.heightAt(x, z),
        1,
      );
    }
    expect(groundUnder(app, 24, 0)).toBeNull();
    app.dispose();
  });

  it("reports the same sample count and extent the field declares", async () => {
    const { app, ground } = await createTerrainWorld();
    const init = ground.colliderInit();

    expect(init.samplesX).toBe(RESOLUTION);
    expect(init.samplesZ).toBe(RESOLUTION);
    expect(init.heights).toHaveLength(RESOLUTION * RESOLUTION);
    expect(init.size.x).toBeCloseTo(WIDTH, TOLERANCE);
    expect(init.size.z).toBeCloseTo(WIDTH, TOLERANCE);
    app.dispose();
  });
});
