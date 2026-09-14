import { describe, expect, it } from "vitest";
import { PARTICLES_FORMAT, PARTICLES_FORMAT_VERSION } from "../src/definition/types.js";
import { particlesFileSchema } from "../src/file-schemas.js";
import { describeParticlesFormat, describeSchemas } from "../src/schemas.js";
import { defaultParticlesSettings, particlesSettingsSchema } from "../src/settings.js";

describe("the particles file schema", () => {
  it("declares every module the document format has", () => {
    expect(Object.keys(particlesFileSchema()).toSorted()).toEqual([
      "emission",
      "forces",
      "format",
      "formatVersion",
      "main",
      "overLifetime",
      "renderer",
      "shape",
      "start",
    ]);
  });

  it("is built fresh on every call, so nothing shares module state", () => {
    expect(particlesFileSchema()).not.toBe(particlesFileSchema());
  });
});

describe("describeParticlesFormat", () => {
  it("renders the ignifx.particles format for the docs harness", () => {
    const description = describeParticlesFormat();
    expect(description.title).toBe("Particles");
    expect(description.format).toBe(PARTICLES_FORMAT);
    expect(description.description).toContain("stateless GPU particle effect");
    expect(Object.keys(description.fields)).toContain("main");
    expect(description.fields["formatVersion"]?.default).toBe(PARTICLES_FORMAT_VERSION);
  });
});

describe("describeSchemas", () => {
  it("describes the component, the settings section and the file format", () => {
    const described = describeSchemas();
    expect(Object.keys(described).toSorted()).toEqual([
      "ignifx/ParticleSystem",
      "ignifx/particles-file",
      "ignifx/particles-settings",
    ]);
    expect(Object.keys(described["ignifx/ParticleSystem"]?.fields ?? {}).toSorted()).toEqual([
      "definition",
      "playOnAwake",
      "seed",
    ]);
    expect(described["ignifx/particles-settings"]?.title).toBe("Particles settings");
  });

  it("is frozen, so a harness cannot edit what it renders", () => {
    expect(Object.isFrozen(describeSchemas())).toBe(true);
  });
});

describe("the particles settings section", () => {
  it("matches its schema's defaults", () => {
    const defaults = defaultParticlesSettings();
    const described = particlesSettingsSchema();
    expect(Object.keys(described).toSorted()).toEqual(["gravity", "maxParticles", "qualityScale"]);
    expect(defaults.maxParticles).toBe(100_000);
    expect(defaults.qualityScale).toBe(1);
    expect(defaults.gravity).toEqual({ x: 0, y: -9.81, z: 0 });
  });

  it("hands back a fresh gravity object, so one project cannot edit another's default", () => {
    expect(defaultParticlesSettings().gravity).not.toBe(defaultParticlesSettings().gravity);
  });
});
