import { describe, expect, it } from "vitest";
import { defineParticles } from "../../src/definition/define-particles.js";
import { EmitterRandom } from "../../src/emitter/pcg3d.js";
import { MeshShapeTable, sampleShape } from "../../src/emitter/shapes.js";
import type { ParticleShape, ParticleShapeInput } from "../../src/definition/types.js";

/**
 * Builds a resolved shape module from an authored one.
 *
 * @param input - The authored shape.
 * @returns The resolved module.
 */
function shape(input: ParticleShapeInput): ParticleShape {
  return defineParticles({ shape: input }).shape;
}

/** One sampled spawn. */
interface Sample {
  readonly position: Float32Array;
  readonly direction: Float32Array;
}

/**
 * Draws `count` spawns from a shape with a fixed seed.
 *
 * @param module - The resolved shape.
 * @param count - How many samples.
 * @param mesh - The triangle table, for a mesh shape.
 * @returns The samples.
 */
function draw(module: ParticleShape, count: number, mesh: MeshShapeTable | null = null): Sample[] {
  const rng = new EmitterRandom(4242);
  const out: Sample[] = [];
  for (let index = 0; index < count; index += 1) {
    const position = new Float32Array(3);
    const direction = new Float32Array(3);
    sampleShape(module, rng, mesh, position, direction);
    out.push({ position, direction });
  }
  return out;
}

/**
 * The length of a vector.
 *
 * @param v - The vector.
 * @returns Its length.
 */
function length(v: Float32Array): number {
  return Math.hypot(v[0] ?? 0, v[1] ?? 0, v[2] ?? 0);
}

describe("every shape", () => {
  it("returns a unit direction", () => {
    for (const kind of ["point", "sphere", "hemisphere", "cone", "box", "circle", "edge"] as const) {
      for (const sample of draw(shape({ kind, radius: 1, length: 2 }), 40)) {
        expect(length(sample.direction), kind).toBeCloseTo(1, 5);
      }
    }
  });

  it("spawns the same particles twice from one seed", () => {
    const module = shape({ kind: "sphere", radius: 1, randomDirection: 0.5, spherizeDirection: 0.5 });
    const first = draw(module, 20);
    const second = draw(module, 20);
    for (let index = 0; index < first.length; index += 1) {
      expect([...(second[index]?.position ?? [])]).toEqual([...(first[index]?.position ?? [])]);
      expect([...(second[index]?.direction ?? [])]).toEqual([...(first[index]?.direction ?? [])]);
    }
  });
});

describe("the point shape", () => {
  it("spawns at the origin along local +Y", () => {
    const sample = draw(shape({ kind: "point" }), 1)[0];
    expect([...(sample?.position ?? [])]).toEqual([0, 0, 0]);
    expect([...(sample?.direction ?? [])]).toEqual([0, 1, 0]);
  });
});

describe("the sphere shape", () => {
  it("keeps every spawn inside the radius", () => {
    for (const sample of draw(shape({ kind: "sphere", radius: 2 }), 200)) {
      expect(length(sample.position)).toBeLessThanOrEqual(2 + 1e-5);
    }
  });

  it("puts every spawn on the surface when it emits from the shell", () => {
    for (const sample of draw(shape({ kind: "sphere", radius: 2, emitFrom: "shell" }), 100)) {
      expect(length(sample.position)).toBeCloseTo(2, 4);
    }
  });

  it("keeps a hemisphere above its own equator", () => {
    for (const sample of draw(shape({ kind: "hemisphere", radius: 1 }), 200)) {
      expect(sample.position[1] ?? 0).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it("keeps a thin shell inside the band the thickness describes", () => {
    for (const sample of draw(shape({ kind: "sphere", radius: 2, thickness: 0.25 }), 200)) {
      expect(length(sample.position)).toBeGreaterThanOrEqual(2 * 0.75 - 1e-4);
    }
  });
});

describe("the cone shape", () => {
  it("emits within the half-angle of local +Y", () => {
    const angle = 20;
    for (const sample of draw(shape({ kind: "cone", angle, radius: 0.5 }), 200)) {
      const tilt = Math.acos(Math.min(1, sample.direction[1] ?? 0)) * (180 / Math.PI);
      expect(tilt).toBeLessThanOrEqual(angle + 1e-3);
    }
  });

  it("spawns on the base disc by default and inside the volume when asked", () => {
    for (const sample of draw(shape({ kind: "cone", radius: 0.5, length: 3 }), 50)) {
      expect(sample.position[1] ?? 0).toBeCloseTo(0, 5);
    }
    const solid = draw(shape({ kind: "cone", radius: 0.5, length: 3, emitFrom: "volume" }), 100);
    expect(solid.some((sample) => (sample.position[1] ?? 0) > 0.1)).toBe(true);
    for (const sample of solid) {
      expect(sample.position[1] ?? 0).toBeLessThanOrEqual(3 + 1e-4);
    }
  });
});

describe("the box shape", () => {
  it("keeps every spawn inside the extents and emits along +Y", () => {
    for (const sample of draw(shape({ kind: "box", size: { x: 4, y: 2, z: 6 } }), 200)) {
      expect(Math.abs(sample.position[0] ?? 0)).toBeLessThanOrEqual(2);
      expect(Math.abs(sample.position[1] ?? 0)).toBeLessThanOrEqual(1);
      expect(Math.abs(sample.position[2] ?? 0)).toBeLessThanOrEqual(3);
      expect([...sample.direction]).toEqual([0, 1, 0]);
    }
  });

  it("puts a shell spawn on one of the six faces", () => {
    const faces = new Set<string>();
    for (const sample of draw(shape({ kind: "box", size: { x: 4, y: 2, z: 6 }, emitFrom: "shell" }), 300)) {
      const onFace =
        Math.abs(Math.abs(sample.position[0] ?? 0) - 2) < 1e-5 ||
        Math.abs(Math.abs(sample.position[1] ?? 0) - 1) < 1e-5 ||
        Math.abs(Math.abs(sample.position[2] ?? 0) - 3) < 1e-5;
      expect(onFace).toBe(true);
      faces.add(String(Math.sign(sample.position[0] ?? 0)));
    }
    expect(faces.size).toBeGreaterThan(1);
  });
});

describe("the circle shape", () => {
  it("spawns in the XZ plane and emits outward", () => {
    for (const sample of draw(shape({ kind: "circle", radius: 3 }), 100)) {
      expect(sample.position[1] ?? 0).toBe(0);
      expect(Math.hypot(sample.position[0] ?? 0, sample.position[2] ?? 0)).toBeLessThanOrEqual(3 + 1e-5);
      expect(sample.direction[1] ?? 0).toBe(0);
    }
  });

  it("keeps an arc inside its angular span", () => {
    for (const sample of draw(shape({ kind: "circle", radius: 1, arc: 90 }), 100)) {
      expect(sample.direction[0] ?? 0).toBeGreaterThanOrEqual(-1e-6);
      expect(sample.direction[2] ?? 0).toBeGreaterThanOrEqual(-1e-6);
    }
  });
});

describe("the edge shape", () => {
  it("spreads along X over the declared length and emits along +Y", () => {
    const samples = draw(shape({ kind: "edge", length: 4 }), 100);
    for (const sample of samples) {
      expect(Math.abs(sample.position[0] ?? 0)).toBeLessThanOrEqual(2);
      expect(sample.position[1] ?? 0).toBe(0);
      expect([...sample.direction]).toEqual([0, 1, 0]);
    }
    expect(Math.max(...samples.map((s) => s.position[0] ?? 0))).toBeGreaterThan(1);
    expect(Math.min(...samples.map((s) => s.position[0] ?? 0))).toBeLessThan(-1);
  });
});

describe("the mesh shape", () => {
  /** Two unit triangles in the XY plane, the second four times the area of the first. */
  const TRIANGLES = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 10, 0, 0, 12, 0, 0, 10, 2, 0]);

  it("measures the total area from the triangles", () => {
    const table = new MeshShapeTable(TRIANGLES);
    expect(table.area).toBeCloseTo(0.5 + 2, 5);
    expect(table.cumulative).toHaveLength(2);
  });

  it("samples by area, so the larger triangle gets most of the particles", () => {
    const table = new MeshShapeTable(TRIANGLES);
    let far = 0;
    for (const sample of draw(shape({ kind: "mesh", vertices: [...TRIANGLES] }), 400, table)) {
      if ((sample.position[0] ?? 0) > 5) {
        far += 1;
      }
    }
    expect(far / 400).toBeGreaterThan(0.6);
    expect(far / 400).toBeLessThan(0.95);
  });

  it("emits along the face normal", () => {
    const table = new MeshShapeTable(TRIANGLES);
    for (const sample of draw(shape({ kind: "mesh", vertices: [...TRIANGLES] }), 20, table)) {
      expect(Math.abs(sample.direction[2] ?? 0)).toBeCloseTo(1, 5);
    }
  });

  it("falls back to the origin and +Y with no triangle table", () => {
    const sample = draw(shape({ kind: "mesh", vertices: [...TRIANGLES] }), 1, null)[0];
    expect([...(sample?.position ?? [])]).toEqual([0, 0, 0]);
    expect([...(sample?.direction ?? [])]).toEqual([0, 1, 0]);
  });

  it("reports zero area for an empty table", () => {
    expect(new MeshShapeTable(new Float32Array(0)).area).toBe(0);
  });
});

describe("direction modifiers", () => {
  it("scatters the direction over the whole sphere at randomDirection 1", () => {
    const samples = draw(shape({ kind: "point", randomDirection: 1 }), 200);
    expect(samples.some((sample) => (sample.direction[1] ?? 0) < 0)).toBe(true);
  });

  it("points a spherized direction away from the emitter centre", () => {
    for (const sample of draw(shape({ kind: "box", size: { x: 4, y: 4, z: 4 }, spherizeDirection: 1 }), 100)) {
      const radial = Math.hypot(sample.position[0] ?? 0, sample.position[1] ?? 0, sample.position[2] ?? 0);
      if (radial > 0.5) {
        const dot =
          ((sample.position[0] ?? 0) * (sample.direction[0] ?? 0) +
            (sample.position[1] ?? 0) * (sample.direction[1] ?? 0) +
            (sample.position[2] ?? 0) * (sample.direction[2] ?? 0)) /
          radial;
        expect(dot).toBeCloseTo(1, 4);
      }
    }
  });

  it("leaves a spawn at the centre with its unmodified direction", () => {
    const sample = draw(shape({ kind: "point", spherizeDirection: 1 }), 1)[0];
    expect([...(sample?.direction ?? [])]).toEqual([0, 1, 0]);
  });
});
