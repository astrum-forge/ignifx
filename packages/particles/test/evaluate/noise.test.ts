import { describe, expect, it } from "vitest";
import { gradientNoise, noise3 } from "../../src/evaluate/noise.js";

describe("gradientNoise", () => {
  it("is zero at every lattice corner, as gradient noise is by construction", () => {
    const scratch = new Uint32Array(3);
    for (const point of [
      [0, 0, 0],
      [1, 2, 3],
      [-4, 7, -1],
    ] as const) {
      expect(gradientNoise(point[0], point[1], point[2], scratch)).toBeCloseTo(0, 6);
    }
  });

  it("repeats for the same point and differs for a nearby one", () => {
    const scratch = new Uint32Array(3);
    const first = gradientNoise(0.3, 0.7, 1.1, scratch);
    expect(gradientNoise(0.3, 0.7, 1.1, scratch)).toBe(first);
    expect(gradientNoise(0.4, 0.7, 1.1, scratch)).not.toBe(first);
  });

  it("stays inside the amplitude gradient noise can reach", () => {
    const scratch = new Uint32Array(3);
    let largest = 0;
    for (let index = 0; index < 2000; index += 1) {
      const value = gradientNoise(index * 0.137, index * -0.291, index * 0.073, scratch);
      largest = Math.max(largest, Math.abs(value));
    }
    expect(largest).toBeGreaterThan(0.1);
    expect(largest).toBeLessThan(Math.sqrt(3));
  });

  it("is continuous: two points a thousandth apart differ by very little", () => {
    const scratch = new Uint32Array(3);
    const here = gradientNoise(0.31, 0.72, 1.13, scratch);
    const there = gradientNoise(0.311, 0.72, 1.13, scratch);
    expect(Math.abs(there - here)).toBeLessThan(0.02);
  });
});

describe("noise3", () => {
  it("decorrelates its three channels", () => {
    const scratch = new Uint32Array(3);
    const out = new Float32Array(3);
    noise3(0.3, 0.7, 1.1, 1, scratch, out);
    expect(out[0]).not.toBe(out[1]);
    expect(out[1]).not.toBe(out[2]);
  });

  it("adds half the amplitude at twice the frequency for a second octave", () => {
    const scratch = new Uint32Array(3);
    const one = new Float32Array(3);
    const two = new Float32Array(3);
    noise3(0.3, 0.7, 1.1, 1, scratch, one);
    noise3(0.3, 0.7, 1.1, 2, scratch, two);
    const second = 0.5 * gradientNoise(0.6, 1.4, 2.2, scratch);
    expect(two[0]).toBeCloseTo((one[0] ?? 0) + second, 6);
  });

  it("returns the same array it was handed", () => {
    const scratch = new Uint32Array(3);
    const out = new Float32Array(3);
    expect(noise3(1, 2, 3, 1, scratch, out)).toBe(out);
  });
});
