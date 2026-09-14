import { describe, expect, it } from "vitest";
import { PARTICLE_PRESETS, particleDefinition, particlePresetInput } from "../../src/definition/presets/index.js";
import { PARTICLES_FORMAT } from "../../src/definition/types.js";
import { ParticlesErrorCode } from "../../src/errors.js";
import type { ParticlePreset } from "../../src/definition/presets/index.js";

describe("the shipped presets", () => {
  it("covers the nine the documentation lists", () => {
    expect([...PARTICLE_PRESETS]).toEqual([
      "fire",
      "smoke",
      "sparks",
      "explosion",
      "dust",
      "sparkle",
      "rain",
      "snow",
      "leaves",
    ]);
  });

  it.each(PARTICLE_PRESETS)("loads %s into a complete definition", (name) => {
    const definition = particleDefinition(name);
    expect(definition.format).toBe(PARTICLES_FORMAT);
    expect(definition.main.capacity).toBeGreaterThan(0);
    expect(definition.lookup.rows).toBeGreaterThanOrEqual(1);
    expect(definition.lookup.pixels).toHaveLength(definition.lookup.rows * 64 * 4);
    expect(definition.renderer.texture).toBeNull();
  });

  it.each(PARTICLE_PRESETS)("hands %s back as a fresh authored document every call", (name) => {
    const first = particlePresetInput(name);
    const second = particlePresetInput(name);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it("gives each preset an emission source: a rate, a burst, or both", () => {
    for (const name of PARTICLE_PRESETS) {
      const emission = particleDefinition(name).emission;
      expect(emission.rateOverTime + emission.bursts.length, name).toBeGreaterThan(0);
    }
  });

  it("makes the two world-space weather presets stay where they were emitted", () => {
    expect(particleDefinition("rain").main.simulationSpace).toBe("world");
    expect(particleDefinition("snow").main.simulationSpace).toBe("world");
  });

  it("makes explosion a one-shot and fire a looping effect", () => {
    expect(particleDefinition("explosion").main.looping).toBe(false);
    expect(particleDefinition("fire").main.looping).toBe(true);
  });
});

describe("particleDefinition overrides", () => {
  it("merges an object key by key and keeps the rest of the module", () => {
    const base = particleDefinition("fire");
    const louder = particleDefinition("fire", { emission: { rateOverTime: 200 } });
    expect(louder.emission.rateOverTime).toBe(200);
    expect(louder.main.capacity).toBe(base.main.capacity);
    expect(louder.start.lifetime).toEqual(base.start.lifetime);
  });

  it("replaces an array outright rather than merging it", () => {
    const quiet = particleDefinition("sparks", { emission: { bursts: [] } });
    expect(quiet.emission.bursts).toEqual([]);
    expect(particleDefinition("sparks").emission.bursts.length).toBeGreaterThan(0);
  });

  it("leaves a module alone when the override names none of its fields", () => {
    const merged = particleDefinition("fire", { main: {} });
    expect(merged.main).toEqual(particleDefinition("fire").main);
  });

  it("leaves the preset's own document untouched", () => {
    particleDefinition("smoke", { main: { capacity: 7 } });
    expect(particleDefinition("smoke").main.capacity).not.toBe(7);
  });

  it("reports an override that makes the document invalid", () => {
    expect(() => particleDefinition("fire", { main: { capacity: 0 } })).toThrowError(
      new RegExp(ParticlesErrorCode.invalidParticlesFile),
    );
  });

  it("names the preset in the failure, so an agent can find the file", () => {
    expect(() => particleDefinition("fire", { main: { capacity: 0 } })).toThrowError(/preset:fire/);
  });
});

/** The union rules a name out at compile time; the guard is for JSON and JavaScript callers. */
function readUnknownPreset(): unknown {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- exercising the runtime guard.
  return particlePresetInput("lava" as ParticlePreset);
}

describe("an unknown preset", () => {
  it("is refused with IGX-1704 and the list of names", () => {
    expect(readUnknownPreset).toThrow(new RegExp(ParticlesErrorCode.unknownPreset, "u"));
    expect(readUnknownPreset).toThrow(/lava is not a particle preset/u);
  });
});
