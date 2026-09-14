import { describe, expect, it } from "vitest";
import * as barrel from "../src/index.js";

/**
 * The barrel's shape. It is asserted rather than described so that adding or dropping an export
 * without the API report, the skill and a changeset is a failing test rather than a release
 * surprise (`CONSTITUTION.md` Article IV). `@ignifx/particles-2d` builds on the names below.
 */
describe("the @ignifx/particles barrel", () => {
  it("exports the component, the extension, the service and the version", () => {
    expect(typeof barrel.ParticleSystem).toBe("function");
    expect(typeof barrel.particles).toBe("function");
    expect(typeof barrel.ParticlesService).toBe("function");
    expect(barrel.VERSION).toBe("0.2.1");
  });

  it("exports the definition layer another renderer reads", () => {
    for (const name of [
      "defineParticles",
      "particleDefinition",
      "particlePresetInput",
      "PARTICLE_PRESETS",
      "ParticleAsset",
      "createParticleLoader",
      "particleAssetFromDefinition",
      "resolveScalar",
      "resolveColor",
      "sampleRow",
      "bakeCurve",
      "bakeGradient",
      "srgbToLinear",
    ]) {
      expect(Object.hasOwn(barrel, name), name).toBe(true);
    }
  });

  it("exports the evaluator and the record layout a second host needs", () => {
    for (const name of [
      "ParticleEmitterCore",
      "SpawnRecordRing",
      "evaluateParticle",
      "createParticleState",
      "pcg3d",
      "hashToUnit",
      "particleUnits",
      "recordSeed",
      "EmitterRandom",
      "sampleShape",
      "MeshShapeTable",
      "noise3",
      "gradientNoise",
      "generateParticleWgsl",
      "particleShaderAddress",
    ]) {
      expect(Object.hasOwn(barrel, name), name).toBe(true);
    }
  });

  it("exports the record layout constants the WGSL struct mirrors", () => {
    expect(barrel.RECORD_FLOATS).toBe(12);
    expect(barrel.RECORD_BYTES).toBe(48);
    expect([
      barrel.RECORD_SPAWN_TIME,
      barrel.RECORD_LIFETIME,
      barrel.RECORD_SEED,
      barrel.RECORD_POSITION,
      barrel.RECORD_SIZE,
      barrel.RECORD_VELOCITY,
      barrel.RECORD_ROTATION,
    ]).toEqual([0, 1, 2, 4, 7, 8, 11]);
  });

  it("exports the error table and the documentation hooks", () => {
    expect(barrel.ParticlesErrorCode.invalidParticlesFile).toBe("IGX-1701");
    expect(typeof barrel.particlesError).toBe("function");
    expect(typeof barrel.describeSchemas).toBe("function");
    expect(typeof barrel.particlesFileSchema).toBe("function");
    expect(typeof barrel.particlesSettingsSchema).toBe("function");
  });

  it("keeps the package's internals out of the public surface", () => {
    for (const name of ["isDead", "transformPoint", "transformDirection", "rowMin", "rowMax", "RECORD_FLAGS"]) {
      expect(Object.hasOwn(barrel, name), name).toBe(false);
    }
  });

  it("does nothing at import time, so a game that never registers it pays nothing", () => {
    // Every export is a declaration or an immutable constant (`CONSTITUTION.md` §3.5); importing the
    // barrel must not build a service, touch a device, or register anything.
    expect(barrel.PARTICLE_PRESETS).toHaveLength(9);
    expect(Object.isFrozen(barrel.PARTICLE_FILE_EXTENSIONS)).toBe(true);
    expect(barrel.PARTICLE_FILE_EXTENSIONS).toEqual([".particles.json"]);
    expect(barrel.LOOKUP_SAMPLES).toBe(64);
  });
});
