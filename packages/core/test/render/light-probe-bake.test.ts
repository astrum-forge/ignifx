import { afterEach, describe, expect, it, vi } from "vitest";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import { bakeLightProbes, lightBakeTerms } from "../../src/render/light-probe-bake.js";
import { Light } from "../../src/render/light.js";
import {
  createMaterialAsset,
  pbrMaterialDefinition,
  standardMaterialDefinition,
} from "../../src/render/material-asset.js";
import { MeshAsset } from "../../src/render/mesh-asset.js";
import { MeshRenderer } from "../../src/render/mesh-renderer.js";
import { createModelAsset, MODEL_ASSET_TYPE } from "../../src/render/model-asset.js";
import { Model } from "../../src/render/model.js";
import { glbOf } from "./support/gltf-bytes.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";

/**
 * `bakeLightProbes` (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step B4): the CPU bake runs
 * headless and matches the analytic answers for a sky, a directional light, a shadow and one bounce.
 */

let harness: RenderHarness | null = null;

afterEach(() => {
  vi.restoreAllMocks();
  harness?.dispose();
  harness = null;
});

const ONE_PROBE = {
  origin: { x: 0, y: 0, z: 0 },
  cellSize: { x: 1, y: 1, z: 1 },
  counts: { x: 1, y: 1, z: 1 },
} as const;

/**
 * Adds a white, rough, square quad facing up at a height.
 *
 * @param h - The harness.
 * @param y - Its height.
 * @param half - Half its side.
 */
function addQuad(h: RenderHarness, y: number, half: number): void {
  const mesh = MeshAsset.fromData(h.app, "quad", {
    positions: Float32Array.from([-half, 0, -half, half, 0, -half, half, 0, half, -half, 0, half]),
    normals: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
  });
  const white = createMaterialAsset(
    h.app,
    pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
    [],
  );
  const entity = h.world.createEntity("Quad");
  entity.transform.localPosition.set(0, y, 0);
  entity.addComponent(MeshRenderer, { mesh, materials: [white] });
}

/**
 * Adds a white directional light shining straight down.
 *
 * @param h - The harness.
 */
function addSun(h: RenderHarness): void {
  const sun = h.world.createEntity("Sun");
  sun.transform.localPosition.set(0, 10, 0);
  sun.transform.lookAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  sun.addComponent(Light, { type: "directional", intensity: 1 });
}

describe("bakeLightProbes", () => {
  it("bakes a uniform sky to its radiance, with no direction", async () => {
    harness = await createRenderHarness();
    const { data, triangles, skipped } = await bakeLightProbes(harness.world, {
      ...ONE_PROBE,
      sky: { r: 1, g: 0.5, b: 0, a: 1 },
    });
    expect(triangles).toBe(0);
    expect(skipped).toBe(0);
    expect(data.coefficients[0]).toBeCloseTo(1, 6);
    expect(data.coefficients[1]).toBeCloseTo(0.5, 6);
    for (const index of [3, 4, 6, 7, 9, 10]) {
      expect(Math.abs(data.coefficients[index] ?? 1)).toBeLessThan(0.02);
    }
  });

  it("adds a visible directional light as a clamped-cosine lobe only when asked", async () => {
    harness = await createRenderHarness();
    addSun(harness);
    harness.frame();
    const { data } = await bakeLightProbes(harness.world, { ...ONE_PROBE, directLight: "include" });
    expect(data.coefficients[0]).toBeCloseTo(0.25, 3);
    expect(data.coefficients[3]).toBeCloseTo(0.5, 3);
    // The default leaves direct light to the real-time light, so an empty world bakes black.
    const bounceOnly = await bakeLightProbes(harness.world, ONE_PROBE);
    expect(bounceOnly.data.coefficients.every((value) => value === 0)).toBe(true);
  });

  it("drops a light a surface hides, and bounces one it lights", async () => {
    harness = await createRenderHarness();
    addSun(harness);
    addQuad(harness, 1, 1);
    harness.frame();
    const shaded = await bakeLightProbes(harness.world, { ...ONE_PROBE, rays: 64, directLight: "include" });
    expect(shaded.triangles).toBe(2);
    expect(shaded.data.coefficients[0]).toBeCloseTo(0, 6);
    harness.dispose();

    harness = await createRenderHarness();
    addSun(harness);
    addQuad(harness, -1, 1000);
    harness.frame();
    const both = { ...ONE_PROBE, rays: 256, maxDistance: 1e6 };
    const lit = await bakeLightProbes(harness.world, { ...both, directLight: "include" });
    expect(lit.skipped).toBe(0);
    // The lobe from above (c0 0.25, up 0.5) plus a white floor of radiance 1 below (c0 0.5, up -0.5).
    expect(lit.data.coefficients[0]).toBeCloseTo(0.75, 1);
    expect(Math.abs(lit.data.coefficients[3] ?? 1)).toBeLessThan(0.05);
    // Without the lobe only the floor's bounce is left, and the floor still sees the sun.
    const bounce = await bakeLightProbes(harness.world, both);
    expect(bounce.data.coefficients[0]).toBeCloseTo(0.5, 1);
    expect(bounce.data.coefficients[3]).toBeCloseTo(-0.5, 1);
  });

  it("adds hemispheric light as sky and ground, and point lights by distance", async () => {
    harness = await createRenderHarness();
    harness.world.createEntity("Sky").addComponent(Light, { type: "hemispheric", intensity: 1 });
    harness.frame();
    const hemi = await bakeLightProbes(harness.world, { ...ONE_PROBE, rays: 256, directLight: "include" });
    // White above, black below: half the sphere at radiance 1.
    expect(hemi.data.coefficients[0]).toBeCloseTo(0.5, 2);
    expect(hemi.data.coefficients[3]).toBeCloseTo(0.5, 1);
    // A real-time hemispheric light keeps lighting the scene, so by default the probe does not
    // store what it sees of it: that was the light counted twice under a volume.
    const runtime = await bakeLightProbes(harness.world, { ...ONE_PROBE, rays: 256 });
    expect(runtime.data.coefficients.every((value) => value === 0)).toBe(true);
    harness.dispose();

    harness = await createRenderHarness();
    const h = harness;
    const lamp = h.world.createEntity("Lamp");
    lamp.transform.localPosition.set(0, 2, 0);
    lamp.addComponent(Light, { type: "point", intensity: 4, range: 10 });
    const far = h.world.createEntity("Far lamp");
    far.transform.localPosition.set(0, 50, 0);
    far.addComponent(Light, { type: "point", intensity: 4, range: 10 });
    h.world.createEntity("Off").addComponent(Light, { type: "point", intensity: 0 });
    h.world.createEntity("Sky").addComponent(Light, { type: "hemispheric", intensity: 0.5 });
    const floor = MeshAsset.fromData(h.app, "floor", {
      positions: Float32Array.from([-5, 0, -5, 5, 0, -5, 5, 0, 5, -5, 0, 5]),
      normals: Float32Array.from([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
      indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    });
    const grey = createMaterialAsset(
      h.app,
      standardMaterialDefinition({ diffuse: { r: 0.5, g: 0.5, b: 0.5, a: 1 } }),
      [],
    );
    const ground = h.world.createEntity("Floor");
    ground.transform.localPosition.set(0, -1, 0);
    ground.addComponent(MeshRenderer, { mesh: floor, materials: [grey] });
    h.world.createEntity("Bare").addComponent(MeshRenderer, { mesh: floor });
    const hidden = h.world.createEntity("Hidden");
    hidden.addComponent(MeshRenderer, { mesh: floor });
    hidden.active = false;
    h.frame();
    const mixed = await bakeLightProbes(h.world, { ...ONE_PROBE, rays: 64, directLight: "include" });
    expect(mixed.triangles).toBe(4);
    // The lamp 2 m above: intensity 4 / 2² = 1 as a lobe (c0 0.25, up 0.5), plus sky and bounce.
    expect(mixed.data.coefficients[0]).toBeGreaterThan(0.25);
    expect(mixed.data.coefficients[3]).toBeGreaterThan(0.25);
    expect(mixed.data.coefficients.every((value) => Number.isFinite(value))).toBe(true);
  });

  it.each([
    ["realtime", "exclude", false],
    ["realtime", "include", true],
    ["mixed", "exclude", false],
    ["mixed", "include", false],
    ["baked", "exclude", true],
    ["baked", "include", true],
  ] as const)("stores a %s light's direct light under %s: %s", (mode, directLight, direct) => {
    expect(lightBakeTerms(mode, directLight)).toEqual({ direct, bounce: true });
  });

  it("follows each light's bakeMode", async () => {
    harness = await createRenderHarness();
    const sun = harness.world.createEntity("Sun");
    sun.transform.lookAt({ x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 });
    const light = sun.addComponent(Light, { type: "directional", intensity: 1, bakeMode: "baked" });
    harness.world.createEntity("Sky").addComponent(Light, { type: "hemispheric", intensity: 1, bakeMode: "mixed" });
    harness.frame();
    expect(new Light().bakeMode).toBe("realtime");
    const baked = await bakeLightProbes(harness.world, { ...ONE_PROBE, rays: 64 });
    // The baked sun's lobe only: the mixed hemispheric light keeps its direct light to run time.
    expect(baked.data.coefficients[0]).toBeCloseTo(0.25, 3);
    expect(baked.data.coefficients[3]).toBeCloseTo(0.5, 3);
    light.bakeMode = "mixed";
    const mixed = await bakeLightProbes(harness.world, { ...ONE_PROBE, rays: 64, directLight: "include" });
    expect(mixed.data.coefficients.every((value) => value === 0)).toBe(true);
  });

  it("bakes a gradient or harmonic sky for rays that miss", async () => {
    harness = await createRenderHarness();
    const white = { r: 1, g: 1, b: 1, a: 1 };
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const gradient = await bakeLightProbes(harness.world, {
      ...ONE_PROBE,
      rays: 512,
      sky: { kind: "gradient", sky: white, horizon: white, ground: black },
    });
    // White above; below, from white at the horizon to black straight down (mean ½): c0 = ¾.
    expect(gradient.data.coefficients[0]).toBeCloseTo(0.75, 2);
    expect(gradient.data.coefficients[3]).toBeGreaterThan(0.2);
    const ambient = 0.5 / 0.282_094_791_773_878_1;
    const harmonics = await bakeLightProbes(harness.world, {
      ...ONE_PROBE,
      sky: { kind: "sh9", coefficients: [ambient, ambient, ambient, ...Array.from({ length: 24 }, () => 0)] },
    });
    expect(harmonics.data.coefficients[0]).toBeCloseTo(0.5, 6);
    const refused: unknown = await bakeLightProbes(harness.world, {
      ...ONE_PROBE,
      sky: { kind: "sh9", coefficients: [1, 2, 3] },
    }).catch((error: unknown) => error);
    expect(isIgnifxError(refused) ? refused.code : null).toBe("IGX-0734");
  });

  it("traces primitives and headless glTF models, and names what it skips", async () => {
    harness = await createRenderHarness();
    const h = harness;
    addSun(h);
    // A 1000 m box under the probe, its top 0.5 m below it: a white floor of radiance 1.
    const box = MeshAsset.box(h.app, { width: 1000, height: 1, depth: 1000 });
    const white = createMaterialAsset(
      h.app,
      pbrMaterialDefinition({ baseColor: { r: 1, g: 1, b: 1, a: 1 }, metallic: 0, roughness: 1 }),
      [],
    );
    const floor = h.world.createEntity("Floor");
    floor.transform.localPosition.set(0, -1, 0);
    floor.addComponent(MeshRenderer, { mesh: box, materials: [white] });
    h.frame();
    const both = { ...ONE_PROBE, rays: 256, maxDistance: 1e6 };
    const primitive = await bakeLightProbes(h.world, both);
    expect(primitive.triangles).toBe(12);
    expect(primitive.skipped).toBe(0);
    expect(primitive.data.coefficients[0]).toBeCloseTo(0.5, 1);
    floor.active = false;

    // The same floor as a glTF model: one red triangle pair, read from the bytes a headless load keeps.
    const half = 500;
    const quad = [-half, 0, -half, half, 0, -half, half, 0, half];
    const other = [-half, 0, -half, half, 0, half, -half, 0, half];
    const bytes = glbOf([
      { positions: quad, baseColor: [1, 0, 0, 1] },
      { positions: other, baseColor: [1, 0, 0, 1] },
    ]);
    const model = h.app.assets.register(createModelAsset("floor.glb", null, null, bytes), { type: MODEL_ASSET_TYPE });
    const ground = h.world.createEntity("Model floor");
    ground.transform.localPosition.set(0, -0.5, 0);
    ground.addComponent(Model, { model });
    const bare = h.app.assets.register(createModelAsset("gpu.glb", null, null), { type: MODEL_ASSET_TYPE });
    h.world.createEntity("No bytes").addComponent(Model, { model: bare });
    h.frame();
    const gltf = await bakeLightProbes(h.world, both);
    expect(gltf.triangles).toBe(2);
    expect(gltf.skipped).toBe(1);
    expect(gltf.skips).toEqual([
      expect.objectContaining({
        entity: "No bytes",
        component: "ignifx/Model",
        reason: expect.stringContaining("headless"),
      }),
    ]);
    expect(gltf.data.coefficients[0]).toBeCloseTo(0.5, 1);
    expect(gltf.data.coefficients[1]).toBeCloseTo(0, 6);
  });

  it.each([
    ["fractional counts", { counts: { x: 1.5, y: 1, z: 1 } }],
    ["too many probes along X", { counts: { x: 2000, y: 1, z: 1 } }],
    ["a NaN origin", { origin: { x: Number.NaN, y: 0, z: 0 } }],
    ["a tiny cell", { cellSize: { x: 1e-40, y: 1, z: 1 } }],
    ["too many rays", { rays: 5000 }],
    ["fractional rays", { rays: 1.5 }],
    ["an infinite distance", { maxDistance: Number.POSITIVE_INFINITY }],
    ["an unknown directLight", { directLight: "both" as "include" }],
    ["a non-finite sky", { sky: { r: Number.NaN, g: 0, b: 0, a: 1 } }],
    ["an unknown sky kind", { sky: { kind: "cube" } as never }],
  ])("refuses %s with IGX-0734 before tracing", async (_name, patch) => {
    harness = await createRenderHarness();
    const failure: unknown = await bakeLightProbes(harness.world, { ...ONE_PROBE, ...patch }).catch(
      (error: unknown) => error,
    );
    expect(isIgnifxError(failure) ? failure.code : null).toBe("IGX-0734");
  });

  it("reports progress per probe and stops when aborted", async () => {
    harness = await createRenderHarness();
    const grid = { ...ONE_PROBE, counts: { x: 2, y: 2, z: 1 }, rays: 8 };
    const seen: [number, number][] = [];
    const baked = await bakeLightProbes(harness.world, {
      ...grid,
      onProgress: (done, total) => {
        seen.push([done, total]);
      },
    });
    expect(baked.data.coefficients).toHaveLength(48);
    expect(seen).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);

    const controller = new AbortController();
    const stopped = bakeLightProbes(harness.world, {
      ...grid,
      signal: controller.signal,
      onProgress: (done) => {
        if (done === 2) {
          controller.abort(new Error("stop"));
        }
      },
    });
    await expect(stopped).rejects.toThrow("stop");
    const early = new AbortController();
    early.abort(new Error("never started"));
    await expect(bakeLightProbes(harness.world, { ...grid, signal: early.signal })).rejects.toThrow("never started");
  });

  it("yields to the host only once a slice of work is spent", async () => {
    harness = await createRenderHarness();
    const grid = { ...ONE_PROBE, counts: { x: 3, y: 1, z: 1 }, rays: 4 };
    const timeout = vi.spyOn(globalThis, "setTimeout");
    let step = 0;
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (now += step));
    await bakeLightProbes(harness.world, grid);
    expect(timeout).not.toHaveBeenCalled();
    step = 10;
    const controller = new AbortController();
    const baked = bakeLightProbes(harness.world, {
      ...grid,
      signal: controller.signal,
      onProgress: (done) => {
        if (done === 1) {
          // Lands at the yield after the first probe: the slice is spent, so the bake checks again.
          queueMicrotask(() => {
            controller.abort(new Error("stop"));
          });
        }
      },
    });
    await expect(baked).rejects.toThrow("stop");
    expect(timeout).toHaveBeenCalledTimes(1);
  });
});
