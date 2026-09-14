import { createRay, Vec3 } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { TerrainErrorCode } from "../../src/errors.js";
import { createTerrainHit, HeightField } from "../../src/heightfield/height-field.js";
import type { TerrainSize } from "../../src/definition/types.js";
import type { Ray } from "@ignifx/core";

/** A 3x3 field two metres on a side, so a sample is one metre apart. */
const SIZE: TerrainSize = { width: 2, depth: 2, height: 10 };

/**
 * A ray pointing straight down from a world point.
 *
 * @param x - The origin X.
 * @param y - The origin Y.
 * @param z - The origin Z.
 * @param length - How far the ray reaches.
 * @returns The ray.
 */
function downRay(x: number, y: number, z: number, length: number): Ray {
  const ray = createRay();
  ray.origin.x = x;
  ray.origin.y = y;
  ray.origin.z = z;
  ray.direction.x = 0;
  ray.direction.y = -1;
  ray.direction.z = 0;
  ray.length = length;
  return ray;
}

/**
 * A 3x3 field whose heights are the values given, row-major.
 *
 * @param heights - Nine heights in metres.
 * @returns The field.
 */
function field3(heights: readonly number[]): HeightField {
  return new HeightField(3, SIZE, Float32Array.from(heights));
}

describe("HeightField sampling", () => {
  it("reads a corner sample exactly", () => {
    const field = field3([1, 0, 0, 0, 0, 0, 0, 0, 9]);

    expect(field.heightAt(-1, -1)).toBeCloseTo(1, 6);
    expect(field.heightAt(1, 1)).toBeCloseTo(9, 6);
  });

  it("reads the centre of a quad as the mean of its four corners", () => {
    const field = field3([0, 2, 0, 4, 6, 0, 0, 0, 0]);

    expect(field.heightAt(-0.5, -0.5)).toBeCloseTo((0 + 2 + 4 + 6) / 4, 6);
  });

  it("interpolates along one axis", () => {
    const field = field3([0, 10, 0, 0, 10, 0, 0, 0, 0]);

    expect(field.heightAt(-0.25, -1)).toBeCloseTo(7.5, 6);
  });

  it("clamps a point outside the field to its nearest edge", () => {
    const field = field3([5, 5, 5, 5, 5, 5, 5, 5, 5]);

    expect(field.heightAt(-100, -100)).toBeCloseTo(5, 6);
    expect(field.heightAt(100, 100)).toBeCloseTo(5, 6);
  });

  it("clamps sample indices to the grid", () => {
    const field = field3([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    expect(field.sample(-5, -5)).toBe(1);
    expect(field.sample(99, 99)).toBe(9);
  });

  it("maps a sample to a local coordinate and back", () => {
    const field = field3(Array.from<number>({ length: 9 }).fill(0));

    expect(field.sampleToLocalX(0)).toBeCloseTo(-1, 6);
    expect(field.sampleToLocalZ(2)).toBeCloseTo(1, 6);
    expect(field.localToSampleX(-1)).toBeCloseTo(0, 6);
    expect(field.localToSampleZ(1)).toBeCloseTo(2, 6);
  });
});

describe("HeightField normals and slope", () => {
  it("answers a flat field with straight up", () => {
    const normal = field3(Array.from<number>({ length: 9 }).fill(3)).normalAt(0, 0, new Vec3());

    expect(normal.y).toBeCloseTo(1, 6);
    expect(normal.x).toBeCloseTo(0, 6);
    expect(normal.z).toBeCloseTo(0, 6);
  });

  it("tilts the normal away from a rising slope", () => {
    const field = field3([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    const normal = field.normalAt(0, 0, new Vec3());

    expect(normal.x).toBeLessThan(0);
    expect(Math.hypot(normal.x, normal.y, normal.z)).toBeCloseTo(1, 6);
  });

  it("reports a 45 degree slope for a one-metre rise over one metre", () => {
    const field = field3([0, 1, 2, 0, 1, 2, 0, 1, 2]);

    expect(field.slopeAt(0, 0)).toBeCloseTo(45, 4);
  });

  it("takes a sample normal from the full-resolution neighbours", () => {
    const field = field3([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    const atSample = field.sampleNormal(1, 1, new Vec3());
    const atPoint = field.normalAt(0, 0, new Vec3());

    expect(atSample.x).toBeCloseTo(atPoint.x, 6);
  });
});

describe("HeightField.raycast", () => {
  it("hits a flat field from above", () => {
    const field = field3(Array.from<number>({ length: 9 }).fill(2));
    const ray = downRay(0, 8, 0, 20);
    const hit = createTerrainHit();

    expect(field.raycast(ray, hit)).toBe(true);
    expect(hit.point.y).toBeCloseTo(2, 2);
    expect(hit.distance).toBeCloseTo(6, 2);
    expect(hit.normal.y).toBeCloseTo(1, 4);
  });

  it("misses when the ray points away from the surface", () => {
    const field = field3(Array.from<number>({ length: 9 }).fill(2));
    const ray = downRay(0, 8, 0, 20);
    ray.direction.y = 1;

    expect(field.raycast(ray, createTerrainHit())).toBe(false);
  });

  it("misses when the ray runs beside the field", () => {
    const field = field3(Array.from<number>({ length: 9 }).fill(2));

    expect(field.raycast(downRay(50, 8, 50, 20), createTerrainHit())).toBe(false);
  });

  it("misses when the ray is too short to reach the surface", () => {
    const field = field3(Array.from<number>({ length: 9 }).fill(2));

    expect(field.raycast(downRay(0, 8, 0, 1), createTerrainHit())).toBe(false);
  });

  it("reports an immediate hit for a ray that starts below the surface", () => {
    const field = field3([0, 0, 0, 0, 4, 0, 0, 0, 0]);
    const ray = downRay(0, 1, 0, 5);
    const hit = createTerrainHit();

    expect(field.raycast(ray, hit)).toBe(true);
    expect(hit.distance).toBeCloseTo(0, 4);
  });

  it("misses when the direction is zero", () => {
    const field = field3(Array.from<number>({ length: 9 }).fill(2));
    const ray = downRay(0, 8, 0, 20);
    ray.direction.y = 0;

    expect(field.raycast(ray, createTerrainHit())).toBe(false);
  });

  it("hits a slope where the surface rises to meet the ray", () => {
    const field = field3([0, 0, 0, 4, 4, 4, 8, 8, 8]);
    const ray = createRay();
    ray.origin.x = 0;
    ray.origin.y = 5;
    ray.origin.z = -1;
    ray.direction.x = 0;
    ray.direction.y = 0;
    ray.direction.z = 1;
    ray.length = 4;
    const hit = createTerrainHit();

    expect(field.raycast(ray, hit)).toBe(true);
    expect(hit.point.z).toBeGreaterThan(-1);
  });
});

describe("HeightField.setHeights", () => {
  it("overwrites the rectangle it is given", () => {
    const field = field3(Array.from<number>({ length: 9 }).fill(0));

    field.setHeights(1, 1, 2, 2, Float32Array.from([1, 2, 3, 4]));

    expect([...field.heights]).toEqual([0, 0, 0, 0, 1, 2, 0, 3, 4]);
  });

  it("refuses a rectangle that leaves the field", () => {
    const field = field3(Array.from<number>({ length: 9 }).fill(0));

    expect(() => field.setHeights(2, 2, 2, 2, new Float32Array(4))).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.regionOutOfRange }),
    );
  });

  it("refuses fewer heights than the rectangle needs", () => {
    const field = field3(Array.from<number>({ length: 9 }).fill(0));

    expect(() => field.setHeights(0, 0, 2, 2, new Float32Array(3))).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.regionOutOfRange }),
    );
  });

  it("refuses a fractional rectangle", () => {
    const field = field3(Array.from<number>({ length: 9 }).fill(0));

    expect(() => field.assertRegion(0.5, 0, 1, 1)).toThrow(
      expect.objectContaining({ code: TerrainErrorCode.regionOutOfRange }),
    );
  });
});

describe("HeightField.minMax", () => {
  it("reports the lowest and highest sample of a rectangle", () => {
    const field = field3([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const out = new Float32Array(2);

    field.minMax(1, 1, 2, 2, out);

    expect([...out]).toEqual([4, 8]);
  });

  it("answers an empty rectangle with zeroes", () => {
    const field = field3([1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const out = new Float32Array(2);

    field.minMax(10, 10, 1, 1, out);

    expect([...out]).toEqual([0, 0]);
  });
});
