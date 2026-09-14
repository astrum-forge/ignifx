import { describe, expect, it } from "vitest";
import * as barrel from "../src/index.js";

/**
 * The public surface (coding standards §4). The suite asserts the shape of the barrel rather than
 * an exact export list: an exact list churns on every addition, while the structural rules below
 * are the ones an API report cannot check on its own.
 */

/** The names a game reaches for first, which must never quietly disappear. */
const LOAD_BEARING: readonly string[] = [
  "PARTICLES_2D_DIAGNOSTICS_COUNTERS",
  "PARTICLES_2D_DIAGNOSTICS_GROUP",
  "PARTICLES_2D_ERROR_MESSAGES",
  "PARTICLE_2D_UPDATE_ORDER",
  "PARTICLE_2D_WRITE_ORDER",
  "ParticleSystem2D",
  "Particles2DErrorCode",
  "Particles2DService",
  "VERSION",
  "describeSchemas",
  "particles2D",
  "particles2DError",
];

describe("the barrel", () => {
  it("exports everything a game reaches for first", () => {
    for (const name of LOAD_BEARING) {
      expect(Object.hasOwn(barrel, name)).toBe(true);
    }
  });

  it("exports nothing undefined", () => {
    for (const [name, value] of Object.entries(barrel)) {
      expect(value, `${name} is undefined`).toBeDefined();
    }
  });

  it("gives its component class a namespaced typeId", () => {
    expect(barrel.ParticleSystem2D.typeId).toBe("ignifx/ParticleSystem2D");
  });

  it("describes its component for the documentation harness", () => {
    const schemas = barrel.describeSchemas();
    expect(Object.keys(schemas)).toEqual(["ignifx/ParticleSystem2D"]);
    expect(schemas["ignifx/ParticleSystem2D"]?.fields["sortingLayer"]?.default).toBe("Default");
  });

  it("runs nothing at import time", async () => {
    // Importing twice must be observably identical: no counters, no registries, no globals.
    const again = await import("../src/index.js");
    expect(again).toBe(barrel);
  });
});
