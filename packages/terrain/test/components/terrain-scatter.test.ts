import { readFileSync } from "node:fs";
import { Camera, InstancedMeshRenderer, MeshAsset, Vec3 } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { terrainAssetFromDefinition } from "../../src/assets/terrain-asset.js";
import { TerrainScatter } from "../../src/components/terrain-scatter.js";
import { Terrain } from "../../src/components/terrain.js";
import { TerrainErrorCode } from "../../src/errors.js";
import { createTerrainApp } from "../support/app.js";
import type { TerrainAppHarness } from "../support/app.js";

/** Samples per side of the fixture terrain. */
const RESOLUTION = 33;

/** The fixture's extent in metres. */
const WIDTH = 32;

/** A terrain with a scatter on it. */
interface ScatterFixture {
  /** The harness. */
  readonly harness: TerrainAppHarness;
  /** The terrain. */
  readonly terrain: Terrain;
  /** The scatter. */
  readonly scatter: TerrainScatter;
}

/**
 * Builds a terrain sloping along X, with two layers painted by slope, and a scatter on it.
 *
 * @param init - Overrides for the scatter's fields.
 * @returns The fixture.
 */
async function scatterFixture(init?: Partial<TerrainScatter>): Promise<ScatterFixture> {
  const harness = await createTerrainApp();
  const heights = new Float32Array(RESOLUTION * RESOLUTION);
  for (let iz = 0; iz < RESOLUTION; iz += 1) {
    for (let ix = 0; ix < RESOLUTION; ix += 1) {
      // Flat over the first half, a 45 degree ramp over the second.
      heights[iz * RESOLUTION + ix] = ix < RESOLUTION / 2 ? 0 : ix - RESOLUTION / 2;
    }
  }
  const handle = await terrainAssetFromDefinition(
    harness.app,
    {
      size: { width: WIDTH, depth: WIDTH, height: 32 },
      resolution: RESOLUTION,
      chunks: { size: 16, lodLevels: 2 },
      layers: [{ name: "grass" }, { name: "rock" }],
      splatRules: [
        { layer: "grass", slope: [0, 10] },
        { layer: "rock", slope: [30, 90] },
      ],
    },
    { heights },
  );
  const eye = harness.app.world.createEntity("Main Camera");
  eye.transform.localPosition.set(0, 40, -40);
  eye.transform.lookAt({ x: 0, y: 0, z: 0 });
  eye.addComponent(Camera, { near: 0.1, far: 500, fov: 60 });
  const entity = harness.app.world.createEntity("Terrain");
  const terrain = entity.addComponent(Terrain, { definition: handle });
  const scatter = entity.addComponent(TerrainScatter, {
    mesh: MeshAsset.plane(harness.app, { width: 1, height: 1 }),
    density: 0.2,
    maxInstances: 4000,
    ...init,
  });
  await harness.app.start();
  harness.step();
  harness.step();
  return { harness, terrain, scatter };
}

describe("TerrainScatter placement", () => {
  it("adds the instanced renderer it draws through", async () => {
    const { harness, scatter } = await scatterFixture();

    expect(scatter.entity.getComponent(InstancedMeshRenderer)).not.toBeNull();
    harness.dispose();
  });

  it("places roughly the instances the density asks for", async () => {
    const { harness, scatter } = await scatterFixture({ slope: { x: 0, y: 90 } });

    // 32 x 32 metres at 0.2 per square metre asks for 204, which rounds up to a 15 x 15 grid.
    expect(scatter.count).toBeGreaterThan(150);
    expect(scatter.count).toBeLessThanOrEqual(225);
    harness.dispose();
  });

  it("places nothing when the density is zero", async () => {
    const { harness, scatter } = await scatterFixture({ density: 0 });

    expect(scatter.count).toBe(0);
    harness.dispose();
  });

  it("caps the count at maxInstances", async () => {
    const { harness, scatter } = await scatterFixture({ density: 50, maxInstances: 32, slope: { x: 0, y: 90 } });

    expect(scatter.count).toBeLessThanOrEqual(32);
    harness.dispose();
  });

  it("places the same instances for the same seed", async () => {
    const first = await scatterFixture({ seed: 11, slope: { x: 0, y: 90 } });
    const second = await scatterFixture({ seed: 11, slope: { x: 0, y: 90 } });

    expect(second.scatter.count).toBe(first.scatter.count);
    first.harness.dispose();
    second.harness.dispose();
  });

  it("keeps to the slope band", async () => {
    const flat = await scatterFixture({ slope: { x: 0, y: 5 }, seed: 3 });
    const steep = await scatterFixture({ slope: { x: 30, y: 90 }, seed: 3 });

    expect(flat.scatter.count).toBeGreaterThan(0);
    expect(steep.scatter.count).toBeGreaterThan(0);
    expect(flat.scatter.count + steep.scatter.count).toBeLessThanOrEqual(225);
    flat.harness.dispose();
    steep.harness.dispose();
  });

  it("keeps to the height band", async () => {
    const low = await scatterFixture({ slope: { x: 0, y: 90 }, height: { x: -1, y: 1 }, seed: 3 });
    const high = await scatterFixture({ slope: { x: 0, y: 90 }, height: { x: 8, y: 100 }, seed: 3 });

    expect(low.scatter.count).toBeGreaterThan(0);
    expect(high.scatter.count).toBeGreaterThan(0);
    expect(low.scatter.count).not.toBe(high.scatter.count);
    low.harness.dispose();
    high.harness.dispose();
  });

  it("keeps to the layers it names", async () => {
    const everywhere = await scatterFixture({ slope: { x: 0, y: 90 }, seed: 5 });
    const onGrass = await scatterFixture({ slope: { x: 0, y: 90 }, layers: ["grass"], seed: 5 });

    expect(onGrass.scatter.count).toBeGreaterThan(0);
    expect(onGrass.scatter.count).toBeLessThan(everywhere.scatter.count);
    everywhere.harness.dispose();
    onGrass.harness.dispose();
  });

  it("refuses a layer the terrain does not declare", async () => {
    const { harness, scatter } = await scatterFixture({ slope: { x: 0, y: 90 } });
    scatter.layers = ["moss"];

    expect(() => scatter.regenerate()).toThrow(expect.objectContaining({ code: TerrainErrorCode.unknownLayer }));
    harness.dispose();
  });

  it("refuses to place without a terrain", async () => {
    const harness = await createTerrainApp();
    const scatter = harness.app.world.createEntity("Grass").addComponent(TerrainScatter);

    expect(() => scatter.regenerate()).toThrow(expect.objectContaining({ code: TerrainErrorCode.scatterNeedsTerrain }));
    harness.dispose();
  });

  it("finds the terrain on an ancestor entity", async () => {
    const { harness, terrain } = await scatterFixture();
    const child = harness.app.world.createEntity("Grass");
    child.setParent(terrain.entity);
    const scatter = child.addComponent(TerrainScatter, {
      mesh: MeshAsset.plane(harness.app, { width: 1, height: 1 }),
      density: 0.05,
      slope: { x: 0, y: 90 },
    });
    harness.step();

    expect(scatter.count).toBeGreaterThan(0);
    harness.dispose();
  });

  it("places again after a sculpt", async () => {
    const { harness, terrain, scatter } = await scatterFixture({ slope: { x: 0, y: 5 }, seed: 7 });
    const before = scatter.count;

    const raised = new Float32Array(RESOLUTION * RESOLUTION);
    for (let index = 0; index < raised.length; index += 1) {
      raised[index] = (index % RESOLUTION) * 2;
    }
    terrain.setHeights(0, 0, RESOLUTION, RESOLUTION, raised);
    harness.step();

    expect(scatter.count).not.toBe(before);
    harness.dispose();
  });

  it("empties the renderer when the scatter is removed", async () => {
    const { harness, scatter } = await scatterFixture({ slope: { x: 0, y: 90 } });
    const renderer = scatter.entity.requireComponent(InstancedMeshRenderer);

    expect(renderer.count).toBeGreaterThan(0);

    scatter.entity.removeComponent(scatter);
    harness.step();

    expect(renderer.count).toBe(0);
    harness.dispose();
  });

  it("stands instances along the surface normal when asked", async () => {
    const upright = await scatterFixture({ slope: { x: 0, y: 90 }, seed: 9, alignToNormal: false });
    const aligned = await scatterFixture({ slope: { x: 0, y: 90 }, seed: 9, alignToNormal: true });

    expect(aligned.scatter.count).toBe(upright.scatter.count);
    upright.harness.dispose();
    aligned.harness.dispose();
  });

  it("gives the renderer a LOD partner when one is named", async () => {
    const harness = await createTerrainApp();
    const lodMesh = MeshAsset.plane(harness.app, { width: 1, height: 1 });
    const fixtureApp = await scatterFixture({ slope: { x: 0, y: 90 }, lodMesh, lodDistance: 25 });
    const renderer = fixtureApp.scatter.entity.requireComponent(InstancedMeshRenderer);

    expect(renderer.lod?.distance).toBe(25);
    harness.dispose();
    fixtureApp.harness.dispose();
  });

  it("places nothing while the scatter is disabled", async () => {
    const { harness, scatter } = await scatterFixture({ slope: { x: 0, y: 90 } });
    const before = scatter.count;
    scatter.enabled = false;
    scatter.seed = 99;
    harness.step();

    expect(scatter.count).toBe(before);
    harness.dispose();
  });

  it("counts its instances through app.diagnostics", async () => {
    const { harness, scatter } = await scatterFixture({ slope: { x: 0, y: 90 } });
    const group = harness.app.diagnostics.group("terrain");

    expect(group?.get(group.index("scatterInstances"))).toBe(scatter.count);
    harness.dispose();
  });
});

describe("Terrain.colliderInit", () => {
  it("returns the fields a HeightfieldCollider declares", async () => {
    const { harness, terrain } = await scatterFixture();
    const init = terrain.colliderInit();

    expect(Object.keys(init).toSorted()).toEqual(["heights", "samplesX", "samplesZ", "size"]);
    expect(init.samplesX).toBe(RESOLUTION);
    expect(init.samplesZ).toBe(RESOLUTION);
    expect(init.heights).toHaveLength(RESOLUTION * RESOLUTION);
    expect(init.size).toEqual({ x: WIDTH, y: 32, z: WIDTH });
    harness.dispose();
  });

  it("matches the field names @ignifx/physics declares, without importing it", () => {
    // The plan's §5.4 rule is coupling by data: this reads the sibling package's source rather than
    // depending on it, so a rename over there fails here.
    const source = readFileSync(new URL("../../../physics/src/components/colliders.ts", import.meta.url), "utf8");
    const body = source.slice(source.indexOf("class HeightfieldCollider"));

    for (const field of ["heights", "samplesX", "samplesZ", "size"]) {
      expect(body).toContain(`declare ${field}`);
    }
    expect(source).toContain("function heightfieldSchema");
  });

  it("covers only the region it is given, and offsets the shape to match", async () => {
    const { harness, terrain } = await scatterFixture();
    const init = terrain.colliderInit({ x: 0, z: 0, width: 5, depth: 5 });

    expect(init.samplesX).toBe(5);
    expect(init.heights).toHaveLength(25);
    expect(init.size.x).toBeCloseTo(4, 5);
    expect(terrain.regionCenter({ x: 0, z: 0, width: 5, depth: 5 }, new Vec3()).x).toBeCloseTo(-WIDTH / 2 + 2, 5);
    harness.dispose();
  });

  it("writes the rows from the largest Z to the smallest, which is what Babylon Lite reads", async () => {
    // The regression this pins: ascending rows mirror the physics ground in Z
    // (`packages/physics/test/terrain-heightfield.test.ts` drives the pair end to end).
    const { harness, terrain } = await scatterFixture();
    terrain.setHeights(1, 2, 1, 1, Float32Array.from([7]));
    const init = terrain.colliderInit();

    const row = RESOLUTION - 1 - 2;
    expect(init.heights[row * RESOLUTION + 1]).toBeCloseTo(7, 5);
    expect(init.heights[2 * RESOLUTION + 1]).not.toBeCloseTo(7, 5);
    harness.dispose();
  });

  it("keeps the column order along X", async () => {
    const { harness, terrain } = await scatterFixture();
    terrain.setHeights(3, RESOLUTION - 1, 1, 1, Float32Array.from([11]));
    const init = terrain.colliderInit();

    // The last Z row is the first row out, so the edited sample is at column 3 of row 0.
    expect(init.heights[3]).toBeCloseTo(11, 5);
    harness.dispose();
  });

  it("reports a region's centre in the terrain's local frame", async () => {
    const { harness, terrain } = await scatterFixture();

    expect(terrain.regionCenter({ x: 0, z: 0, width: RESOLUTION, depth: RESOLUTION }, new Vec3())).toEqual(
      expect.objectContaining({ x: 0, y: 0, z: 0 }),
    );
    const offset = terrain.regionCenter({ x: 0, z: 8, width: 9, depth: 9 }, new Vec3());
    expect(offset.x).toBeCloseTo(-WIDTH / 2 + 4, 5);
    expect(offset.z).toBeCloseTo(-WIDTH / 2 + 12, 5);
    harness.dispose();
  });

  it("refuses a region centre outside the field", async () => {
    const { harness, terrain } = await scatterFixture();

    expect(() => terrain.regionCenter({ x: RESOLUTION, z: 0, width: 4, depth: 4 }, new Vec3())).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.regionOutOfRange }),
    );
    harness.dispose();
  });

  it("refuses a region smaller than two samples on a side", async () => {
    const { harness, terrain } = await scatterFixture();

    expect(() => terrain.colliderInit({ x: 0, z: 0, width: 1, depth: 4 })).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.regionOutOfRange }),
    );
    harness.dispose();
  });

  it("refuses a region outside the field", async () => {
    const { harness, terrain } = await scatterFixture();

    expect(() => terrain.colliderInit({ x: RESOLUTION, z: 0, width: 4, depth: 4 })).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.regionOutOfRange }),
    );
    harness.dispose();
  });
});
