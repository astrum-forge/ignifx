import { afterEach, describe, expect, it } from "vitest";
import { isIgnifxError } from "../../src/errors/ignifx-error.js";
import {
  createLightProbeAsset,
  packLightProbeTexels,
  readLightProbeFile,
  sampleLightProbes,
  toHalfFloat,
  writeLightProbeFile,
} from "../../src/render/light-probe-asset.js";
import { LightProbeVolume } from "../../src/render/light-probe-volume.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type { LightProbeAsset, LightProbeData } from "../../src/render/light-probe-asset.js";

/**
 * Light probes (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step B2): the `.probes.json`
 * format, the CPU sampling the shader mirrors, the texel packing, and the component headless. The
 * shader itself is covered by `light-probe.browser.test.ts`.
 */

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * One probe with constant red light.
 *
 * @param red - The red level.
 * @returns Its 12 coefficients.
 */
function probe(red: number): number[] {
  return [red, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

/**
 * A 2×1×1 grid: probe 0 has constant light `left`, probe 1 constant light `right`, along X.
 *
 * @param left - Probe 0's red.
 * @param right - Probe 1's red.
 * @returns The grid.
 */
function twoProbes(left: number, right: number): LightProbeData {
  return {
    origin: { x: 0, y: 0, z: 0 },
    cellSize: { x: 2, y: 1, z: 1 },
    counts: { x: 2, y: 1, z: 1 },
    coefficients: [...probe(left), ...probe(right)],
  };
}

/**
 * The code of the error a call throws.
 *
 * @param run - The call.
 * @returns The code, or `null` when it did not throw an ignifx error.
 */
function codeOf(run: () => unknown): string | null {
  try {
    run();
  } catch (error) {
    return isIgnifxError(error) ? error.code : null;
  }
  return null;
}

const UP = { x: 0, y: 1, z: 0 };

describe(".probes.json", () => {
  it("round-trips through writeLightProbeFile and readLightProbeFile", () => {
    const data = twoProbes(1, 3);
    expect(readLightProbeFile(JSON.parse(JSON.stringify(writeLightProbeFile(data))), "a.probes.json")).toEqual(data);
  });

  it.each([
    ["no header", {}],
    ["a wrong version", { ...writeLightProbeFile(twoProbes(1, 1)), formatVersion: 2 }],
    ["a zero cell size", { ...writeLightProbeFile(twoProbes(1, 1)), cellSize: { x: 0, y: 1, z: 1 } }],
    ["a fractional count", { ...writeLightProbeFile(twoProbes(1, 1)), counts: { x: 1.5, y: 1, z: 1 } }],
    ["too many probes", { ...writeLightProbeFile(twoProbes(1, 1)), counts: { x: 2000, y: 1, z: 1 } }],
    ["too few coefficients", { ...writeLightProbeFile(twoProbes(1, 1)), coefficients: [1, 2, 3] }],
    ["a non-object grid", null],
  ])("rejects %s with IGX-0709", (_name, file) => {
    expect(codeOf(() => readLightProbeFile(file, "bad.probes.json"))).toBe("IGX-0709");
  });
});

describe("sampleLightProbes", () => {
  it("blends linearly between probes and clamps outside the grid", () => {
    const data = twoProbes(1, 3);
    expect(sampleLightProbes(data, 0, 0, 0, UP)[0]).toBeCloseTo(1);
    expect(sampleLightProbes(data, 1, 0, 0, UP)[0]).toBeCloseTo(2);
    expect(sampleLightProbes(data, 2, 0, 0, UP)[0]).toBeCloseTo(3);
    expect(sampleLightProbes(data, -5, 9, 9, UP)[0]).toBeCloseTo(1);
    expect(sampleLightProbes(data, 50, 0, 0, UP)[0]).toBeCloseTo(3);
  });

  it("evaluates the directional terms against the normal", () => {
    const data: LightProbeData = {
      origin: { x: 0, y: 0, z: 0 },
      cellSize: { x: 1, y: 1, z: 1 },
      counts: { x: 1, y: 1, z: 1 },
      coefficients: [1, 1, 1, 0.5, 0, 0, 0, 0.25, 0, 0, 0, 0.125],
    };
    expect(sampleLightProbes(data, 0, 0, 0, UP)).toEqual([1.5, 1, 1]);
    expect(sampleLightProbes(data, 0, 0, 0, { x: 0, y: 0, z: 1 })).toEqual([1, 1.25, 1]);
    expect(sampleLightProbes(data, 0, 0, 0, { x: 1, y: 0, z: 0 })).toEqual([1, 1, 1.125]);
  });
});

describe("packLightProbeTexels", () => {
  it("places coefficient c of probe i at texel i + countX·c, alpha 1", () => {
    const packed = packLightProbeTexels(twoProbes(1, 3));
    expect(packed.width).toBe(8);
    expect(packed.height).toBe(1);
    expect(packed.texels[0]).toBe(toHalfFloat(1));
    expect(packed.texels[4]).toBe(toHalfFloat(3));
    expect(packed.texels[3]).toBe(toHalfFloat(1));
  });
});

describe("toHalfFloat", () => {
  it.each([
    [0, 0x0000],
    [-0, 0x8000],
    [1, 0x3c00],
    [-2, 0xc000],
    [0.5, 0x3800],
    [65504, 0x7bff],
    [1e9, 0x7bff],
    [2 ** -24, 0x0001],
    [1e-10, 0x0000],
    [Number.NaN, 0x7e00],
  ])("converts %s", (value, bits) => {
    expect(toHalfFloat(value)).toBe(bits);
  });
});

describe("LightProbeVolume", () => {
  it("lights with nothing until its grid is loaded, and loads no GPU code headless", async () => {
    harness = await createRenderHarness();
    const volume = harness.world.createEntity("Probes").addComponent(LightProbeVolume);
    expect(volume.intensity).toBe(1);
    expect(volume.loadedProbes()).toBeNull();
    volume.probes = createLightProbeAsset(harness.app, twoProbes(1, 2));
    const loaded: LightProbeAsset | null = volume.loadedProbes();
    expect(loaded?.data.counts.x).toBe(2);
    await harness.settle();
    expect(harness.renderer.lightProbeHost).toBeNull();
    expect(harness.errors).toEqual([]);
  });

  it("loads a .probes.json through the asset service", async () => {
    harness = await createRenderHarness();
    const h = harness;
    h.net.canned.set(
      h.app.assets.resolveUrl("lighting/hall.probes.json"),
      JSON.stringify(writeLightProbeFile(twoProbes(1, 2))),
    );
    const asset = await h.app.assets.loadAsync<LightProbeAsset>("lighting/hall.probes.json");
    expect(asset.value.data.coefficients).toHaveLength(24);
  });
});
