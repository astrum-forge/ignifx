import { describe, expect, it } from "vitest";
import { HeightField } from "../../src/heightfield/height-field.js";
import { hashFloats } from "../../src/heightfield/noise.js";
import { generateControlMaps, solidControlMaps } from "../../src/material/splat-rules.js";
import { createScatterPlacements, generateScatter, scatterCapacity } from "../../src/scatter/placement.js";
import type { ControlMaps } from "../../src/material/splat-rules.js";
import type { ScatterRules } from "../../src/scatter/placement.js";

/** Samples per side of the fixture field. */
const RESOLUTION = 33;

/** The fixture's extent in metres. */
const WIDTH = 32;

/**
 * A field that is flat over its first half and a 45 degree ramp over the second.
 *
 * @returns The field.
 */
function rampField(): HeightField {
  const heights = new Float32Array(RESOLUTION * RESOLUTION);
  for (let iz = 0; iz < RESOLUTION; iz += 1) {
    for (let ix = 0; ix < RESOLUTION; ix += 1) {
      heights[iz * RESOLUTION + ix] = ix < RESOLUTION / 2 ? 0 : ix - RESOLUTION / 2;
    }
  }
  return new HeightField(RESOLUTION, { width: WIDTH, depth: WIDTH, height: 32 }, heights);
}

/**
 * The rules every case starts from: everything accepted, one instance per five square metres.
 *
 * @param overrides - What to change.
 * @returns The rules.
 */
function rules(overrides?: Partial<ScatterRules>): ScatterRules {
  return {
    density: 0.2,
    layers: [],
    layerThreshold: 0.5,
    slopeMin: 0,
    slopeMax: 90,
    heightMin: -1000,
    heightMax: 1000,
    scaleMin: 1,
    scaleMax: 1,
    randomYaw: true,
    seed: 1,
    maxInstances: 5000,
    ...overrides,
  };
}

/**
 * Places instances and reports the placements and the count.
 *
 * @param field - The field.
 * @param control - The splat weights.
 * @param rule - The rules.
 * @returns The count and the positions written.
 */
function place(
  field: HeightField,
  control: ControlMaps,
  rule: ScatterRules,
): { readonly count: number; readonly positions: Float32Array } {
  const placements = createScatterPlacements(Math.max(1, scatterCapacity(field, rule.density, rule.maxInstances)));
  const count = generateScatter(field, control, rule, placements);
  return { count, positions: placements.positions.subarray(0, count * 3) };
}

describe("scatterCapacity", () => {
  it("multiplies the area by the density", () => {
    expect(scatterCapacity(rampField(), 0.5, 5000)).toBe(512);
  });

  it("never exceeds the cap", () => {
    expect(scatterCapacity(rampField(), 100, 40)).toBe(40);
  });

  it("answers zero for a zero density", () => {
    expect(scatterCapacity(rampField(), 0, 5000)).toBe(0);
  });
});

describe("generateScatter", () => {
  it("places every instance inside the field", () => {
    const field = rampField();
    const { count, positions } = place(field, solidControlMaps(RESOLUTION - 1, 1), rules());

    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < positions.length; index += 3) {
      expect(positions[index]).toBeGreaterThanOrEqual(-WIDTH / 2);
      expect(positions[index]).toBeLessThanOrEqual(WIDTH / 2);
      expect(positions[index + 2]).toBeGreaterThanOrEqual(-WIDTH / 2);
      expect(positions[index + 2]).toBeLessThanOrEqual(WIDTH / 2);
    }
  });

  it("puts every instance on the surface", () => {
    const field = rampField();
    const { positions } = place(field, solidControlMaps(RESOLUTION - 1, 1), rules());

    for (let index = 0; index < positions.length; index += 3) {
      const x = positions[index] ?? 0;
      const z = positions[index + 2] ?? 0;
      expect(positions[index + 1] ?? 0).toBeCloseTo(field.heightAt(x, z), 4);
    }
  });

  it("places the same instances for the same seed", () => {
    const field = rampField();
    const control = solidControlMaps(RESOLUTION - 1, 1);
    const first = place(field, control, rules({ seed: 42 }));
    const second = place(field, control, rules({ seed: 42 }));

    expect(second.count).toBe(first.count);
    expect(hashFloats(second.positions.slice())).toBe(hashFloats(first.positions.slice()));
  });

  it("places different instances for a different seed", () => {
    const field = rampField();
    const control = solidControlMaps(RESOLUTION - 1, 1);
    const first = place(field, control, rules({ seed: 42 }));
    const second = place(field, control, rules({ seed: 43 }));

    expect(hashFloats(second.positions.slice())).not.toBe(hashFloats(first.positions.slice()));
  });

  it("keeps every instance inside the slope band", () => {
    const field = rampField();
    const { count, positions } = place(field, solidControlMaps(RESOLUTION - 1, 1), rules({ slopeMax: 5 }));

    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < positions.length; index += 3) {
      expect(field.slopeAt(positions[index] ?? 0, positions[index + 2] ?? 0)).toBeLessThanOrEqual(5);
    }
  });

  it("keeps every instance inside the height band", () => {
    const field = rampField();
    const { count, positions } = place(field, solidControlMaps(RESOLUTION - 1, 1), rules({ heightMin: 5 }));

    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < positions.length; index += 3) {
      expect(positions[index + 1] ?? 0).toBeGreaterThanOrEqual(5);
    }
  });

  it("places only where a named layer is painted", () => {
    const field = rampField();
    const control = generateControlMaps(
      field,
      [
        { name: "grass", albedo: "", normal: null, tiling: 8, triplanar: false, color: { r: 1, g: 1, b: 1, a: 1 } },
        { name: "rock", albedo: "", normal: null, tiling: 8, triplanar: false, color: { r: 1, g: 1, b: 1, a: 1 } },
      ],
      [
        { layer: "grass", height: null, slope: [0, 10] },
        { layer: "rock", height: null, slope: [30, 90] },
      ],
    );
    const everywhere = place(field, control, rules());
    const onRock = place(field, control, rules({ layers: [1] }));

    expect(onRock.count).toBeGreaterThan(0);
    expect(onRock.count).toBeLessThan(everywhere.count);
  });

  it("writes a scale inside the range and a yaw inside one turn", () => {
    const field = rampField();
    const placements = createScatterPlacements(400);
    const count = generateScatter(
      field,
      solidControlMaps(RESOLUTION - 1, 1),
      rules({ scaleMin: 0.5, scaleMax: 2 }),
      placements,
    );

    for (let index = 0; index < count; index += 1) {
      expect(placements.scale[index]).toBeGreaterThanOrEqual(0.5);
      expect(placements.scale[index]).toBeLessThanOrEqual(2);
      expect(placements.yaw[index]).toBeGreaterThanOrEqual(0);
      expect(placements.yaw[index]).toBeLessThan(Math.PI * 2 + 1e-6);
    }
  });

  it("writes a zero yaw when random yaw is off", () => {
    const field = rampField();
    const placements = createScatterPlacements(400);
    const count = generateScatter(field, solidControlMaps(RESOLUTION - 1, 1), rules({ randomYaw: false }), placements);

    for (let index = 0; index < count; index += 1) {
      expect(placements.yaw[index]).toBe(0);
    }
  });

  it("writes unit normals", () => {
    const field = rampField();
    const placements = createScatterPlacements(400);
    const count = generateScatter(field, solidControlMaps(RESOLUTION - 1, 1), rules(), placements);

    for (let index = 0; index < count; index += 1) {
      const at = index * 3;
      expect(
        Math.hypot(placements.normals[at] ?? 0, placements.normals[at + 1] ?? 0, placements.normals[at + 2] ?? 0),
      ).toBeCloseTo(1, 5);
    }
  });

  it("places nothing when the output has no room", () => {
    const field = rampField();

    expect(generateScatter(field, solidControlMaps(RESOLUTION - 1, 1), rules(), createScatterPlacements(0))).toBe(0);
  });

  it("places nothing when no rule accepts a candidate", () => {
    const field = rampField();
    const { count } = place(field, solidControlMaps(RESOLUTION - 1, 1), rules({ heightMin: 1000, heightMax: 2000 }));

    expect(count).toBe(0);
  });
});
