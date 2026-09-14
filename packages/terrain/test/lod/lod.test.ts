import { Mat4 } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { Frustum } from "../../src/lod/frustum.js";
import { distanceToBox, LOD_HYSTERESIS, lodThreshold, selectLod } from "../../src/lod/lod-select.js";

/** The terrain's `chunks.lodDistance` in these suites. */
const LOD_DISTANCE = 96;

/** How many levels a chunk carries. */
const LEVELS = 4;

/**
 * A view-projection matrix looking down `+Z` from the origin.
 *
 * @returns Its column-major elements.
 */
function forwardViewProjection(): Float32Array {
  const projection = Mat4.perspectiveLH(60, 1, 0.1, 100);
  const view = Mat4.lookAtLH({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 });
  return Mat4.multiplyToRef(projection.elements, view.elements, new Mat4()).elements;
}

describe("lodThreshold", () => {
  it("doubles with every level", () => {
    expect(lodThreshold(1, LOD_DISTANCE, 1)).toBe(96);
    expect(lodThreshold(2, LOD_DISTANCE, 1)).toBe(192);
    expect(lodThreshold(3, LOD_DISTANCE, 1)).toBe(384);
  });

  it("scales with the bias", () => {
    expect(lodThreshold(1, LOD_DISTANCE, 2)).toBe(192);
  });
});

describe("selectLod", () => {
  it("keeps the finest level close to the camera", () => {
    expect(selectLod(0, LOD_DISTANCE, 1, LEVELS, 0)).toBe(0);
  });

  it("switches to the next level well past its threshold", () => {
    expect(selectLod(LOD_DISTANCE * (1 + LOD_HYSTERESIS) + 1, LOD_DISTANCE, 1, LEVELS, 0)).toBe(1);
  });

  it("keeps the current level inside the hysteresis band", () => {
    const inside = LOD_DISTANCE * (1 + LOD_HYSTERESIS * 0.5);

    expect(selectLod(inside, LOD_DISTANCE, 1, LEVELS, 0)).toBe(0);
    expect(selectLod(inside, LOD_DISTANCE, 1, LEVELS, 1)).toBe(1);
  });

  it("drops back to a finer level once the camera is well inside the threshold", () => {
    expect(selectLod(LOD_DISTANCE * (1 - LOD_HYSTERESIS) - 1, LOD_DISTANCE, 1, LEVELS, 1)).toBe(0);
  });

  it("never goes past the coarsest level", () => {
    expect(selectLod(1e6, LOD_DISTANCE, 1, LEVELS, 0)).toBe(LEVELS - 1);
  });

  it("clamps a current level outside the range", () => {
    expect(selectLod(0, LOD_DISTANCE, 1, LEVELS, 99)).toBe(0);
    expect(selectLod(0, LOD_DISTANCE, 1, LEVELS, -5)).toBe(0);
  });

  it("does not flip while the camera sits exactly on a threshold", () => {
    let level = 0;
    for (let frame = 0; frame < 10; frame += 1) {
      level = selectLod(LOD_DISTANCE, LOD_DISTANCE, 1, LEVELS, level);
    }

    expect(level).toBe(0);
  });
});

describe("distanceToBox", () => {
  it("reports zero inside the box", () => {
    expect(distanceToBox(0, 0, 0, [-1, -1, -1, 1, 1, 1])).toBe(0);
  });

  it("measures to the nearest face", () => {
    expect(distanceToBox(4, 0, 0, [-1, -1, -1, 1, 1, 1])).toBeCloseTo(3, 6);
  });

  it("measures to the nearest face from below the box too", () => {
    expect(distanceToBox(-4, 0, 0, [-1, -1, -1, 1, 1, 1])).toBeCloseTo(3, 6);
    expect(distanceToBox(0, -4, -4, [-1, -1, -1, 1, 1, 1])).toBeCloseTo(Math.hypot(3, 3), 6);
  });

  it("measures to a corner", () => {
    expect(distanceToBox(4, 5, 0, [-1, -1, -1, 1, 1, 1])).toBeCloseTo(Math.hypot(3, 4), 6);
  });

  it("reads a box from an offset", () => {
    const boxes = new Float32Array([0, 0, 0, 0, 0, 0, -1, -1, -1, 1, 1, 1]);

    expect(distanceToBox(4, 0, 0, boxes, 6)).toBeCloseTo(3, 6);
  });
});

describe("Frustum", () => {
  it("reports itself invalid for a matrix that is not a projection", () => {
    const frustum = new Frustum();

    expect(frustum.setFromViewProjection(new Float32Array(16))).toBe(false);
    expect(frustum.isValid).toBe(false);
  });

  it("accepts everything while it is invalid, so nothing is culled by mistake", () => {
    const frustum = new Frustum();
    frustum.setFromViewProjection(new Float32Array(16));

    expect(frustum.intersectsBox(1e6, 1e6, 1e6, 1e6 + 1, 1e6 + 1, 1e6 + 1)).toBe(true);
  });

  it("rejects a matrix that is too short", () => {
    expect(new Frustum().setFromViewProjection([1, 2, 3])).toBe(false);
  });

  it("accepts a box in front of the camera", () => {
    const frustum = new Frustum();
    frustum.setFromViewProjection(forwardViewProjection());

    expect(frustum.intersectsBox(-1, -1, 8, 1, 1, 10)).toBe(true);
  });

  it("rejects a box behind the camera", () => {
    const frustum = new Frustum();
    frustum.setFromViewProjection(forwardViewProjection());

    expect(frustum.intersectsBox(-1, -1, -20, 1, 1, -10)).toBe(false);
  });

  it("rejects a box beyond the far plane", () => {
    const frustum = new Frustum();
    frustum.setFromViewProjection(forwardViewProjection());

    expect(frustum.intersectsBox(-1, -1, 500, 1, 1, 600)).toBe(false);
  });

  it("rejects a box off to one side", () => {
    const frustum = new Frustum();
    frustum.setFromViewProjection(forwardViewProjection());

    expect(frustum.intersectsBox(500, -1, 8, 600, 1, 10)).toBe(false);
  });

  it("accepts a box that straddles the near plane", () => {
    const frustum = new Frustum();
    frustum.setFromViewProjection(forwardViewProjection());

    expect(frustum.intersectsBox(-1, -1, -1, 1, 1, 1)).toBe(true);
  });

  it("normalises its planes", () => {
    const frustum = new Frustum();
    frustum.setFromViewProjection(forwardViewProjection());

    for (let plane = 0; plane < 6; plane += 1) {
      const at = plane * 4;
      const length = Math.hypot(frustum.planes[at] ?? 0, frustum.planes[at + 1] ?? 0, frustum.planes[at + 2] ?? 0);
      expect(length).toBeCloseTo(1, 5);
    }
  });
});
