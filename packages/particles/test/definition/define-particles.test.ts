import { describe, expect, it } from "vitest";
import { defineParticles } from "../../src/definition/define-particles.js";
import { LOOKUP_SAMPLES, PARTICLES_FORMAT } from "../../src/definition/types.js";
import { sampleRow } from "../../src/definition/values.js";
import { ParticlesErrorCode } from "../../src/errors.js";
import type { ParticleDefinitionInput } from "../../src/definition/types.js";

/**
 * Asserts that a document is refused with `IGX-1701` and that the message names a path.
 *
 * @param input - The document.
 * @param fragment - Text the reason must contain.
 */
function expectRejected(input: unknown, fragment: string): void {
  // The reader takes `unknown` at runtime; the signature is the authored shape.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the point of the test is a bad document.
  const call = (): unknown => defineParticles(input as ParticleDefinitionInput, "test.particles.json");
  expect(call).toThrowError(new RegExp(ParticlesErrorCode.invalidParticlesFile));
  expect(call).toThrowError(new RegExp(fragment.replaceAll(/[$()*+.?[\\\]^{|}]/g, "\\$&")));
}

describe("an empty particle document", () => {
  it("fills in every module with the documented defaults", () => {
    const definition = defineParticles({});
    expect(definition.format).toBe(PARTICLES_FORMAT);
    expect(definition.formatVersion).toBe(1);
    expect(definition.main).toMatchObject({
      capacity: 1000,
      duration: 5,
      looping: true,
      prewarm: false,
      startDelay: 0,
      simulationSpace: "local",
      seed: 0,
      playOnAwake: true,
      timeScale: 1,
      renderOrder: 0,
    });
    expect(definition.emission).toMatchObject({ rateOverTime: 10, rateOverDistance: 0, bursts: [] });
    expect(definition.shape).toMatchObject({ kind: "cone", radius: 0.2, angle: 25, emitFrom: "base", arc: 360 });
    expect(definition.start.lifetime).toEqual({ kind: "constant", value: 2 });
    expect(definition.start.size3D).toBeNull();
    expect(definition.forces).toMatchObject({ gravity: null, gravityMultiplier: 0, drag: 0, orbit: null, noise: null });
    expect(definition.overLifetime).toMatchObject({ color: null, size: null, rotation: null });
    expect(definition.renderer).toMatchObject({ mode: "billboard", blend: "premultiplied", lit: false, texture: null });
  });

  it("bakes a single white lookup row so the shader always has a texture to sample", () => {
    const lookup = defineParticles({}).lookup;
    expect(lookup.rows).toBe(1);
    expect(lookup.pixels).toHaveLength(LOOKUP_SAMPLES * 4);
    expect([...lookup.pixels.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
    expect(lookup.color).toBeNull();
    expect(lookup.size).toBeNull();
  });

  it("defaults a non-cone shape to emitting from the volume", () => {
    expect(defineParticles({ shape: { kind: "sphere" } }).shape.emitFrom).toBe("volume");
  });

  it("freezes the result so a shared preset cannot be edited in place", () => {
    expect(Object.isFrozen(defineParticles({}))).toBe(true);
  });
});

describe("document validation", () => {
  it("refuses a document that is not an object", () => {
    expectRejected(42, "document must be an object");
  });

  it("refuses a foreign format or a future version", () => {
    expectRejected({ format: "ignifx.sprites" }, "format is ignifx.sprites");
    expectRejected({ formatVersion: 2 }, "formatVersion is 2");
  });

  it("names the misspelled key rather than ignoring it", () => {
    expectRejected({ emision: {} }, "emision is not a field");
    expectRejected({ main: { capacty: 10 } }, "main.capacty is not a field");
  });

  it("refuses a value outside its documented range", () => {
    expectRejected({ main: { capacity: 0 } }, "main.capacity must be at least 1");
    expectRejected({ main: { capacity: 1.5 } }, "main.capacity must be an integer");
    expectRejected({ shape: { thickness: 2 } }, "shape.thickness must be at most 1");
    expectRejected({ renderer: { blend: "screen" } }, "renderer.blend must be one of");
    expectRejected({ main: { looping: "yes" } }, "main.looping must be true or false");
    expectRejected({ main: { duration: Number.NaN } }, "main.duration must be a finite number");
  });

  it("refuses a lifetime that can reach zero, because age over lifetime would divide by it", () => {
    expectRejected({ start: { lifetime: 0 } }, "start.lifetime must stay above zero");
    expectRejected({ start: { lifetime: { min: 0, max: 2 } } }, "start.lifetime must stay above zero");
  });

  it("refuses a malformed curve", () => {
    expectRejected({ start: { size: { curve: { keys: [] } } } }, "keys must be a non-empty array");
    expectRejected({ start: { size: { curve: { keys: [[0, 1]] } } } }, "must be [time, value, inTangent, outTangent]");
    expectRejected(
      {
        start: {
          size: {
            curve: {
              keys: [
                [1, 1, 0, 0],
                [0, 1, 0, 0],
              ],
            },
          },
        },
      },
      "keys must be sorted by time",
    );
    expectRejected({ start: { size: { curve: { keys: [[0, "x", 0, 0]] } } } }, "must hold finite numbers");
  });

  it("refuses a curve whose samples leave the field's range", () => {
    expectRejected(
      {
        start: {
          size: {
            curve: {
              keys: [
                [0, -1, 0, 0],
                [1, 1, 0, 0],
              ],
            },
          },
        },
      },
      "start.size.curve",
    );
  });

  it("refuses a scalar that is neither a number, a range, nor a curve", () => {
    expectRejected({ start: { speed: { min: 1 } } }, "start.speed must be a number, { min, max }, or { curve }");
  });

  it("refuses a malformed gradient", () => {
    expectRejected({ overLifetime: { color: { gradient: [] } } }, "must be a non-empty array");
    expectRejected({ overLifetime: { color: { gradient: [[0, 1, 1]] } } }, "must be [t, r, g, b, a]");
    expectRejected({ overLifetime: { color: { gradient: [[0, 2, 1, 1, 1]] } } }, "must hold numbers in 0..1");
    expectRejected(
      {
        overLifetime: {
          color: {
            gradient: [
              [1, 1, 1, 1, 1],
              [0, 1, 1, 1, 1],
            ],
          },
        },
      },
      "stops must be sorted by time",
    );
  });

  it("refuses a random colour over a lifetime, which has no meaning", () => {
    expectRejected(
      { overLifetime: { color: { min: [0, 0, 0, 1], max: [1, 1, 1, 1] } } },
      "a random colour has no meaning over a lifetime",
    );
  });

  it("refuses a random size over a lifetime but accepts a random angular speed", () => {
    expectRejected({ overLifetime: { size: { min: 0, max: 1 } } }, "overLifetime.size must be a number or a curve");
    const spun = defineParticles({ overLifetime: { rotation: { min: -90, max: 90 } } });
    expect(spun.overLifetime.rotation).toEqual({ kind: "random", min: -90, max: 90 });
    expect(spun.lookup.rotation).toBeNull();
  });

  it("refuses a zero orbit axis and normalizes a valid one", () => {
    expectRejected({ forces: { orbit: { axis: { x: 0, y: 0, z: 0 } } } }, "must not be the zero vector");
    const orbit = defineParticles({ forces: { orbit: { axis: { x: 0, y: 3, z: 4 }, speed: 45 } } }).forces.orbit;
    expect(orbit?.axis).toEqual({ x: 0, y: 0.6, z: 0.8 });
    expect(orbit?.speed).toBe(45);
  });

  it("refuses a random noise influence and accepts a curve", () => {
    expectRejected(
      { forces: { noise: { influenceOverLife: { min: 0, max: 1 } } } },
      "influenceOverLife must be a number or a curve",
    );
    const noise = defineParticles({
      forces: {
        noise: {
          strength: 1,
          influenceOverLife: {
            curve: {
              keys: [
                [0, 1, 0, 0],
                [1, 0, 0, 0],
              ],
            },
          },
        },
      },
    });
    expect(noise.lookup.noise).not.toBeNull();
  });

  it("refuses a mesh shape with no triangles and a vertex list that is not whole triangles", () => {
    expectRejected({ shape: { kind: "mesh" } }, "a mesh shape needs shape.vertices");
    expectRejected({ shape: { vertices: [0, 1, 2] } }, "nine numbers per triangle");
    expectRejected({ shape: { vertices: Array.from({ length: 9 }).fill("x") } }, "must be a finite number");
  });

  it("refuses an empty texture address", () => {
    expectRejected({ renderer: { texture: "" } }, "must be a non-empty asset address or null");
  });

  it("refuses a frame rule it cannot read", () => {
    expectRejected(
      { renderer: { sheet: { frameOverTime: { min: 0, max: 1 } } } },
      'must be a curve, a number, "random", or { fps }',
    );
    expectRejected({ renderer: { sheet: { tiles: { x: 0, y: 1 } } } }, "tiles.x must be at least 1");
  });
});

describe("the baked lookup", () => {
  it("gives a gradient its own row and encodes the stops as sRGB bytes", () => {
    const definition = defineParticles({
      overLifetime: {
        color: {
          gradient: [
            [0, 1, 0, 0, 1],
            [1, 0, 0, 1, 0],
          ],
        },
      },
    });
    const row = definition.lookup.color;
    expect(row).not.toBeNull();
    expect(definition.lookup.rows).toBe(1);
    const pixels = definition.lookup.pixels;
    expect([...pixels.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...pixels.subarray((LOOKUP_SAMPLES - 1) * 4, LOOKUP_SAMPLES * 4)]).toEqual([0, 0, 255, 0]);
  });

  it("packs the three size axes into one row and records its decode range", () => {
    const definition = defineParticles({
      overLifetime: {
        size: {
          curve: {
            keys: [
              [0, 1, 0, 0],
              [1, 3, 0, 0],
            ],
          },
        },
        sizeY: 2,
      },
    });
    const row = definition.lookup.size;
    expect(row).not.toBeNull();
    expect(row?.min).toBeCloseTo(1, 5);
    expect(row?.max).toBeCloseTo(3, 5);
    const base = (row?.index ?? 0) * LOOKUP_SAMPLES * 4;
    expect(definition.lookup.pixels[base]).toBe(0);
    expect(definition.lookup.pixels[base + 1]).toBe(Math.round(((2 - 1) / (3 - 1)) * 255));
  });

  it("orders the rows colour, size, rotation, noise, frame", () => {
    const definition = defineParticles({
      forces: {
        noise: {
          strength: 1,
          influenceOverLife: {
            curve: {
              keys: [
                [0, 1, 0, 0],
                [1, 0, 0, 0],
              ],
            },
          },
        },
      },
      overLifetime: {
        color: {
          gradient: [
            [0, 1, 1, 1, 1],
            [1, 0, 0, 0, 0],
          ],
        },
        size: {
          curve: {
            keys: [
              [0, 1, 0, 0],
              [1, 0, 0, 0],
            ],
          },
        },
        rotation: {
          curve: {
            keys: [
              [0, 0, 0, 0],
              [1, 90, 0, 0],
            ],
          },
        },
      },
      renderer: { sheet: { tiles: { x: 2, y: 2 } } },
    });
    expect(definition.lookup.rows).toBe(5);
    expect(definition.lookup.color?.index).toBe(0);
    expect(definition.lookup.size?.index).toBe(1);
    expect(definition.lookup.rotation?.index).toBe(2);
    expect(definition.lookup.noise?.index).toBe(3);
    expect(definition.lookup.frame?.index).toBe(4);
    expect(definition.lookup.pixels).toHaveLength(5 * LOOKUP_SAMPLES * 4);
  });

  it("keeps a flat row decodable by widening the range instead of dividing by zero", () => {
    const definition = defineParticles({ overLifetime: { size: 2 } });
    const row = definition.lookup.size;
    expect(row).toMatchObject({ min: 2, max: 3 });
    const base = (row?.index ?? 0) * LOOKUP_SAMPLES * 4;
    expect(definition.lookup.pixels[base]).toBe(0);
  });

  it("bakes the sheet's default frame ramp so a sheet with no rule still animates", () => {
    const definition = defineParticles({ renderer: { sheet: { tiles: { x: 4, y: 1 } } } });
    expect(definition.renderer.sheet?.mode).toBe("curve");
    expect(definition.lookup.frame).not.toBeNull();
    const samples = definition.renderer.sheet?.frameOverTime;
    expect(samples?.kind).toBe("curve");
    if (samples?.kind === "curve") {
      expect(sampleRow(samples.samples, 0)).toBeCloseTo(0, 5);
      expect(sampleRow(samples.samples, 1)).toBeCloseTo(1, 5);
    }
  });

  it("reads the three sheet frame rules", () => {
    expect(defineParticles({ renderer: { sheet: { frameOverTime: "random" } } }).renderer.sheet?.mode).toBe("random");
    const fps = defineParticles({ renderer: { sheet: { frameOverTime: { fps: 24 } } } }).renderer.sheet;
    expect(fps).toMatchObject({ mode: "fps", fps: 24 });
    expect(defineParticles({ renderer: { sheet: { frameOverTime: 0.5 } } }).renderer.sheet?.mode).toBe("curve");
  });
});

describe("colour and vector readers", () => {
  it("accepts a colour as an array or an object", () => {
    expect(defineParticles({ start: { color: [0.5, 0.25, 0.125, 1] } }).start.color).toEqual({
      kind: "constant",
      value: { r: 0.5, g: 0.25, b: 0.125, a: 1 },
    });
    expect(defineParticles({ start: { color: { r: 1, g: 0, b: 0, a: 0.5 } } }).start.color).toEqual({
      kind: "constant",
      value: { r: 1, g: 0, b: 0, a: 0.5 },
    });
  });

  it("allows a start colour above one, so an additive effect can over-brighten", () => {
    expect(defineParticles({ start: { color: [4, 1, 1, 1] } }).start.color).toMatchObject({ kind: "constant" });
  });

  it("reads a random start colour as two ends", () => {
    const value = defineParticles({ start: { color: { min: [0, 0, 0, 1], max: [1, 1, 1, 1] } } }).start.color;
    expect(value.kind).toBe("random");
  });

  it("refuses a vector with an unknown component", () => {
    expectRejected({ shape: { size: { x: 1, y: 1, w: 1 } } }, "shape.size.w is not a field");
    expectRejected({ renderer: { pivot: { x: 1, z: 1 } } }, "renderer.pivot.z is not a field");
  });
});

describe("bursts", () => {
  it("fills in each burst's defaults and keeps declaration order", () => {
    const bursts = defineParticles({
      emission: { bursts: [{ time: 0.5 }, { time: 1, count: { min: 2, max: 4 }, cycles: 0, probability: 0.5 }] },
    }).emission.bursts;
    expect(bursts).toHaveLength(2);
    expect(bursts[0]).toMatchObject({ time: 0.5, cycles: 1, interval: 0.1, probability: 1 });
    expect(bursts[0]?.count).toEqual({ kind: "constant", value: 10 });
    expect(bursts[1]).toMatchObject({ time: 1, cycles: 0, probability: 0.5 });
  });

  it("refuses bursts that are not an array", () => {
    expectRejected({ emission: { bursts: {} } }, "emission.bursts must be an array");
  });
});
