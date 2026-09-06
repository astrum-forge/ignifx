import { Vec3 } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { ThreeDErrorCode } from "../../src/errors.js";
import { NavMeshAgent } from "../../src/navigation/nav-mesh-agent.js";
import { NavMeshObstacle } from "../../src/navigation/nav-mesh-obstacle.js";
import { NavMeshSurface } from "../../src/navigation/nav-mesh-surface.js";
import { boxGeometry, floorGeometry } from "../support/geometry.js";
import { createThreeDApp } from "../support/harness.js";
import type { ThreeDAppHarness } from "../support/harness.js";
import type { Entity } from "@ignifx/core";

/**
 * Navigation, headless (`docs/architecture/12-3d-toolkit.md` §5, and the Phase 7 exit criteria).
 *
 * Every test here runs in plain Node with no GPU and no canvas: `createNavigationPluginAsync`
 * resolves against the WebAssembly Babylon Lite inlines as a `data:` URL, so nothing has to be
 * copied into `ignifx.assets.public` and nothing has to be served
 * (`docs/adr/0017-navigation-wasm.md`).
 */

/** The Recast parameters a 20x20 floor with a wall wants. */
const BAKE = {
  cellSize: 0.2,
  cellHeight: 0.2,
  agentRadius: 0.5,
  agentHeight: 2,
  agentClimb: 0.4,
} as const;

/**
 * Builds a world with a 20x20 floor and, optionally, a wall down the middle.
 *
 * @param harness - The app harness.
 * @param withWall - Whether to add the wall.
 * @param seed - The navigation seed.
 * @returns The baked surface and its entity.
 */
async function buildLevel(
  harness: ThreeDAppHarness,
  withWall: boolean,
  seed: number = 1234,
): Promise<{ surface: NavMeshSurface; entity: Entity }> {
  const entity = harness.world.createEntity("Level");
  const surface = entity.addComponent(NavMeshSurface, { ...BAKE, randomSeed: seed, bakeOnAwake: false });
  const floor = floorGeometry(10);
  surface.addSource(floor.positions, floor.indices, null);
  if (withWall) {
    // A wall from z = -7 to z = 7 at x = 0, leaving a gap at each end.
    const wall = boxGeometry([0, 1, 0], [0.5, 1, 7]);
    surface.addSource(wall.positions, wall.indices, null);
  }
  await surface.bake();
  return { surface, entity };
}

describe("NavMeshSurface", () => {
  it("bakes headlessly and snaps a point onto the mesh", async () => {
    const harness = await createThreeDApp();
    const { surface } = await buildLevel(harness, false);
    expect(surface.isBaked).toBe(true);
    expect(surface.sourceCount).toBe(1);
    // Recast snaps within a small vertical window, so the probe sits just above the floor.
    const snapped = surface.closestPoint({ x: 3, y: 0.1, z: -2 });
    expect(snapped).not.toBeNull();
    expect(snapped?.x).toBeCloseTo(3, 1);
    expect(snapped?.z).toBeCloseTo(-2, 1);
    harness.dispose();
  });

  it("routes a path around a wall", async () => {
    const harness = await createThreeDApp();
    const { surface } = await buildLevel(harness, true);
    const corners = surface.findPath({ x: -8, y: 0, z: 0 }, { x: 8, y: 0, z: 0 });
    expect(corners.length).toBeGreaterThan(2);
    let furthest = 0;
    for (const corner of corners) {
      furthest = Math.max(furthest, Math.abs(corner.z));
    }
    // A straight line would keep |z| at zero; going round the wall's end needs |z| past 5.
    expect(furthest).toBeGreaterThan(5);
    harness.dispose();
  });

  it("reports a wall with a navmesh raycast", async () => {
    const harness = await createThreeDApp();
    const { surface } = await buildLevel(harness, true);
    expect(surface.raycast({ x: -8, y: 0, z: 0 }, { x: 8, y: 0, z: 0 })).not.toBeNull();
    expect(surface.raycast({ x: -8, y: 0, z: -9 }, { x: 8, y: 0, z: -9 })).toBeNull();
    harness.dispose();
  });

  it("answers empty and null before it is baked", async () => {
    const harness = await createThreeDApp();
    const entity = harness.world.createEntity("Level");
    const surface = entity.addComponent(NavMeshSurface, { bakeOnAwake: false });
    expect(surface.isBaked).toBe(false);
    expect(surface.findPath(Vec3.zero(), Vec3.one())).toEqual([]);
    expect(surface.closestPoint(Vec3.zero())).toBeNull();
    expect(surface.raycast(Vec3.zero(), Vec3.one())).toBeNull();
    harness.dispose();
  });

  it("reports IGX-1209 when it has no geometry at all", async () => {
    const harness = await createThreeDApp();
    const errors: unknown[] = [];
    harness.app.onError.connect((report) => {
      errors.push(report.error);
    });
    const entity = harness.world.createEntity("Empty");
    const surface = entity.addComponent(NavMeshSurface, { bakeOnAwake: false });
    expect(await surface.bake()).toBe(false);
    expect(errors).toContainEqual(expect.objectContaining({ code: ThreeDErrorCode.emptyNavMesh }));
    harness.dispose();
  });

  it("warns about a pre-baked navmesh, which the pinned Babylon Lite cannot read", async () => {
    const harness = await createThreeDApp();
    const entity = harness.world.createEntity("Level");
    const surface = entity.addComponent(NavMeshSurface, {
      ...BAKE,
      bakeOnAwake: false,
      prebaked: "3d/level.navmesh.bin",
    });
    const floor = floorGeometry(10);
    surface.addSource(floor.positions, floor.indices, null);
    await surface.bake();
    const logged = harness.sink.toArray().some((record) => record.message.includes("pre-baked"));
    expect(logged).toBe(true);
    harness.dispose();
  });

  it("clears its hand-added sources on request", async () => {
    const harness = await createThreeDApp();
    const entity = harness.world.createEntity("Level");
    const surface = entity.addComponent(NavMeshSurface, { bakeOnAwake: false });
    const floor = floorGeometry(5);
    surface.addSource(floor.positions, floor.indices, null);
    expect(surface.sourceCount).toBe(1);
    surface.clearSources();
    expect(surface.sourceCount).toBe(0);
    harness.dispose();
  });

  it("applies a world matrix to a source", async () => {
    const harness = await createThreeDApp();
    const entity = harness.world.createEntity("Level");
    const surface = entity.addComponent(NavMeshSurface, { ...BAKE, bakeOnAwake: false });
    const floor = floorGeometry(10);
    // Translate the floor 20 metres along +X.
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 20, 0, 0, 1];
    surface.addSource(floor.positions, floor.indices, matrix);
    await surface.bake();
    const snapped = surface.closestPoint({ x: 20, y: 0, z: 0 });
    expect(snapped?.x).toBeCloseTo(20, 0);
    harness.dispose();
  });
});

describe("NavMeshAgent", () => {
  it("reaches its destination and fires onArrived exactly once", async () => {
    const harness = await createThreeDApp();
    const { surface } = await buildLevel(harness, false);
    const walker = harness.world.createEntity("Walker", { position: { x: -8, y: 0, z: 0 } });
    const agent = walker.addComponent(NavMeshAgent, { speed: 4, acceleration: 20, stoppingDistance: 0.6 });
    let arrivals = 0;
    agent.onArrived.connect(() => {
      arrivals += 1;
    });

    // One step to let the system join the crowd, then aim.
    harness.step();
    expect(agent.isOnNavMesh).toBe(true);
    expect(agent.setDestination({ x: 8, y: 0, z: 0 })).toBe(true);
    expect(agent.isStopped).toBe(false);

    harness.stepMany(400);
    expect(arrivals).toBe(1);
    expect(agent.isStopped).toBe(true);
    expect(walker.transform.position.x).toBeGreaterThan(6);
    expect(surface.isBaked).toBe(true);

    // Standing still afterwards must not fire again.
    harness.stepMany(60);
    expect(arrivals).toBe(1);
    harness.dispose();
  });

  it("produces identical positions for two runs of one seed", async () => {
    const trail = async (): Promise<number[]> => {
      const harness = await createThreeDApp();
      await buildLevel(harness, true, 4242);
      const walker = harness.world.createEntity("Walker", { position: { x: -8, y: 0, z: 0 } });
      const agent = walker.addComponent(NavMeshAgent, { speed: 4, acceleration: 20 });
      harness.step();
      agent.setDestination({ x: 8, y: 0, z: 0 });
      const samples: number[] = [];
      for (let frame = 0; frame < 120; frame += 1) {
        harness.step();
        const position = walker.transform.position;
        samples.push(position.x, position.y, position.z);
      }
      harness.dispose();
      return samples;
    };
    expect(await trail()).toEqual(await trail());
  });

  it("refuses to join a crowd that is full, and says so", async () => {
    const harness = await createThreeDApp();
    const errors: unknown[] = [];
    harness.app.onError.connect((report) => {
      errors.push(report.error);
    });
    const entity = harness.world.createEntity("Level");
    const surface = entity.addComponent(NavMeshSurface, { ...BAKE, bakeOnAwake: false, maxAgents: 1 });
    const floor = floorGeometry(10);
    surface.addSource(floor.positions, floor.indices, null);
    await surface.bake();

    harness.world.createEntity("A").addComponent(NavMeshAgent);
    const second = harness.world.createEntity("B").addComponent(NavMeshAgent);
    harness.step();
    expect(second.isOnNavMesh).toBe(false);
    expect(errors).toContainEqual(expect.objectContaining({ code: ThreeDErrorCode.crowdFull }));
    harness.dispose();
  });

  it("answers with infinity and refuses orders while off the mesh", async () => {
    const harness = await createThreeDApp();
    const agent = harness.world.createEntity("Loner").addComponent(NavMeshAgent);
    expect(agent.isOnNavMesh).toBe(false);
    expect(agent.remainingDistance).toBe(Number.POSITIVE_INFINITY);
    expect(agent.setDestination(Vec3.zero())).toBe(false);
    agent.stop();
    expect(agent.isStopped).toBe(true);
    harness.dispose();
  });

  it("stops where it stands", async () => {
    const harness = await createThreeDApp();
    await buildLevel(harness, false);
    const walker = harness.world.createEntity("Walker", { position: { x: -5, y: 0, z: 0 } });
    const agent = walker.addComponent(NavMeshAgent, { speed: 4 });
    harness.step();
    agent.setDestination({ x: 5, y: 0, z: 0 });
    harness.stepMany(30);
    const before = walker.transform.position.x;
    agent.stop();
    harness.stepMany(60);
    expect(agent.isStopped).toBe(true);
    expect(walker.transform.position.x).toBeCloseTo(before, 0);
    harness.dispose();
  });
});

describe("NavMeshObstacle", () => {
  it("refuses to carve a surface with no tile cache and says why", async () => {
    const harness = await createThreeDApp();
    const errors: unknown[] = [];
    harness.app.onError.connect((report) => {
      errors.push(report.error);
    });
    await buildLevel(harness, false);
    const crate = harness.world.createEntity("Crate", { position: { x: 0, y: 0, z: 0 } });
    crate.addComponent(NavMeshObstacle, { shape: "box", size: { x: 2, y: 2, z: 2 } });
    harness.step();
    expect(errors).toContainEqual(expect.objectContaining({ code: ThreeDErrorCode.obstaclesNotEnabled }));
    harness.dispose();
  });

  it("carves a tile-cache surface and fills the hole back in", async () => {
    const harness = await createThreeDApp();
    const entity = harness.world.createEntity("Level");
    const surface = entity.addComponent(NavMeshSurface, {
      ...BAKE,
      bakeOnAwake: false,
      maxObstacles: 4,
      tileSize: 32,
    });
    const floor = floorGeometry(10);
    surface.addSource(floor.positions, floor.indices, null);
    await surface.bake();

    const crate = harness.world.createEntity("Crate", { position: { x: 0, y: 0, z: 0 } });
    const obstacle = crate.addComponent(NavMeshObstacle, { shape: "cylinder", radius: 2, height: 2 });
    harness.step();
    expect(obstacle.isCarved).toBe(true);
    obstacle.remove();
    expect(obstacle.isCarved).toBe(false);
    harness.dispose();
  });
});

describe("app.navigation", () => {
  it("loads Recast lazily and answers queries against the first baked surface", async () => {
    const harness = await createThreeDApp();
    expect(harness.app.navigation.isLoaded).toBe(false);
    expect(harness.app.navigation.primarySurface).toBeNull();
    expect(harness.app.navigation.findPath(Vec3.zero(), Vec3.one())).toEqual([]);

    let ready = 0;
    harness.app.navigation.onReady.connect(() => {
      ready += 1;
    });
    const { surface } = await buildLevel(harness, false);
    expect(harness.app.navigation.isLoaded).toBe(true);
    expect(ready).toBe(1);
    expect(harness.app.navigation.primarySurface).toBe(surface);
    expect(harness.app.navigation.surfaces).toHaveLength(1);
    expect(harness.app.navigation.findPath({ x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }).length).toBeGreaterThan(0);
    expect(harness.app.navigation.closestPoint({ x: 1, y: 0.1, z: 1 })).not.toBeNull();
    expect(harness.app.navigation.raycast({ x: -5, y: 0, z: 0 }, { x: 5, y: 0, z: 0 })).toBeNull();
    harness.dispose();
  });

  it("refuses to hand out a plugin once the app is disposed", async () => {
    const harness = await createThreeDApp();
    const navigation = harness.app.navigation;
    harness.dispose();
    await expect(navigation.acquirePlugin()).rejects.toThrow(
      expect.objectContaining({ code: ThreeDErrorCode.navigationUnavailable }),
    );
  });
});
