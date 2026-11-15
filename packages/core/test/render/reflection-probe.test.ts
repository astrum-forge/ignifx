import { afterEach, describe, expect, it } from "vitest";
import {
  ReflectionProbe,
  resolveReflectionProbeRefreshMode,
  resolveReflectionProbeSize,
  reflectionProbeBlendLayout,
  REFLECTION_PROBE_GRID_CELLS,
  selectReflectionProbe,
} from "../../src/render/reflection-probe.js";
import { createRenderHarness } from "./support/render-harness.js";
import type { RenderHarness } from "./support/render-harness.js";
import type { ReflectionProbeCandidate } from "../../src/render/reflection-probe.js";

/**
 * `ReflectionProbe` (`docs/plan/2026-11-gi-phase-2-execution-plan.md`, step B1): the settings, the
 * refresh request, the face size, and which probe a point reflects. The capture itself needs a
 * device and is covered by `reflection-probe.browser.test.ts`.
 */

let harness: RenderHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/**
 * A probe at a point.
 *
 * @param x - World X.
 * @param box - The full box size along each axis, or `null`.
 * @returns The candidate.
 */
function probeAt(x: number, box: number | null = null): ReflectionProbeCandidate {
  return { x, y: 0, z: 0, box: box === null ? null : { x: box, y: box, z: box } };
}

describe("ReflectionProbe", () => {
  it("starts from the schema defaults and keeps one refresh request until it is read", async () => {
    harness = await createRenderHarness();
    const probe = harness.world.createEntity("Probe").addComponent(ReflectionProbe);
    expect(probe.size).toBe(128);
    expect(probe.refreshMode).toBe("once");
    expect(probe.boxProjection).toBeNull();
    expect(probe.blendDistance).toBe(0);
    expect(probe.cullingMask).toEqual([]);
    expect(probe.consumeRefreshRequest()).toBe(false);
    probe.refresh();
    probe.refresh();
    expect(probe.consumeRefreshRequest()).toBe(true);
    expect(probe.consumeRefreshRequest()).toBe(false);
  });

  it("loads no GPU code on a headless app", async () => {
    harness = await createRenderHarness();
    harness.world.createEntity("Probe").addComponent(ReflectionProbe, { refreshMode: "everyFrame" });
    await harness.settle();
    await harness.settle();
    expect(harness.renderer.reflectionProbeHost).toBeNull();
    expect(harness.errors).toEqual([]);
  });
});

describe("resolveReflectionProbeSize", () => {
  it.each([
    [128, 128],
    [200, 128],
    [1, 16],
    [5000, 1024],
    [Number.NaN, 128],
  ])("reads %s as %s", (size, expected) => {
    expect(resolveReflectionProbeSize(size)).toBe(expected);
  });

  it("clamps to a quality tier's cap", () => {
    expect(resolveReflectionProbeSize(1024, 64)).toBe(64);
    expect(resolveReflectionProbeSize(32, 256)).toBe(32);
    expect(resolveReflectionProbeSize(Number.NaN, 64)).toBe(64);
  });
});

describe("selectReflectionProbe", () => {
  it("returns -1 with no probe", () => {
    expect(selectReflectionProbe(0, 0, 0, [])).toBe(-1);
  });

  it("picks the closest probe when no box holds the point", () => {
    expect(selectReflectionProbe(4, 0, 0, [probeAt(0), probeAt(5), probeAt(10, 2)])).toBe(1);
  });

  it("prefers a box that holds the point over a closer probe, and the smaller of two boxes", () => {
    expect(selectReflectionProbe(4, 0, 0, [probeAt(10, 20), probeAt(4.5)])).toBe(0);
    expect(selectReflectionProbe(4, 0, 0, [probeAt(10, 20), probeAt(0, 10)])).toBe(1);
    expect(selectReflectionProbe(4, 0, 0, [probeAt(0, 10), probeAt(10, 20)])).toBe(0);
  });

  it("skips holes in the list", () => {
    const sparse: ReflectionProbeCandidate[] = [];
    sparse[1] = probeAt(1);
    expect(selectReflectionProbe(0, 0, 0, sparse)).toBe(1);
  });
});

describe("resolveReflectionProbeRefreshMode", () => {
  it("reads everyFrame as once below the high tier and keeps the other modes", () => {
    expect(resolveReflectionProbeRefreshMode("everyFrame", false)).toBe("once");
    expect(resolveReflectionProbeRefreshMode("everyFrame", true)).toBe("everyFrame");
    expect(resolveReflectionProbeRefreshMode("once", false)).toBe("once");
  });
});

describe("reflectionProbeBlendLayout", () => {
  /**
   * A box probe with a blend distance.
   *
   * @param x - World X.
   * @param box - The full box size.
   * @param blendDistance - Its blend distance.
   * @returns The candidate.
   */
  const blending = (
    x: number,
    box: number | null,
    blendDistance: number,
  ): ReflectionProbeCandidate & { blendDistance: number } => ({ ...probeAt(x, box), blendDistance });

  it("blends only two or more box probes, one with a blend distance", () => {
    expect(reflectionProbeBlendLayout([])).toBeNull();
    expect(reflectionProbeBlendLayout([blending(0, 4, 1)])).toBeNull();
    expect(reflectionProbeBlendLayout([blending(0, 4, 0), blending(3, 4, 0)])).toBeNull();
    expect(reflectionProbeBlendLayout([blending(0, 4, 1), blending(3, null, 1)])).toBeNull();
    expect(reflectionProbeBlendLayout([blending(0, 4, 1), blending(3, 4, 0)])).not.toBeNull();
  });

  it("shrinks each inner box by the blend distance and bounds the grid by the boxes", () => {
    const layout = reflectionProbeBlendLayout([blending(0, 4, 0.5), blending(5, null, 1), blending(3, 4, 3)]);
    expect(layout?.volumes.map((volume) => volume.index)).toEqual([0, 2]);
    expect(layout?.volumes[0]?.inner).toEqual([3, 3, 3]);
    expect(layout?.volumes[0]?.outer).toEqual([4, 4, 4]);
    expect(layout?.volumes[1]?.inner).toEqual([0, 0, 0]);
    expect(layout?.volumes[1]?.position).toEqual([3, 0, 0]);
    expect(layout?.minimum).toEqual([-2, -2, -2]);
    expect(layout?.maximum).toEqual([5, 2, 2]);
    expect(layout?.cellSize).toBe(7 / REFLECTION_PROBE_GRID_CELLS);
  });

  it("puts the smallest box first, so a probe nested in a bigger box is not hidden", () => {
    const layout = reflectionProbeBlendLayout([blending(0, 10, 1), blending(1, 2, 0.5), blending(2, 10, 0)]);
    expect(layout?.volumes.map((volume) => volume.index)).toEqual([1, 0, 2]);
  });
});
