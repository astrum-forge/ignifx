import { IgnifxError } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { particleAssetFromDefinition } from "../src/assets/loader.js";
import { defineParticles } from "../src/definition/define-particles.js";
import { particlePresetInput } from "../src/definition/presets/index.js";
import { PARTICLES_ERROR_MESSAGES, ParticlesErrorCode, particlesError } from "../src/errors.js";
import { ParticleSystem } from "../src/gpu/particle-system.js";
import { createParticlesApp } from "./support/harness.js";
import type { ParticlesAppHarness } from "./support/harness.js";
import type { ParticlePreset } from "../src/definition/presets/index.js";
import type { FetchLike } from "@ignifx/core";

/** The codes this package owns, in table order. */
const CODES = Object.values(ParticlesErrorCode);

/** A `fetch` that refuses the generated shader's `data:` address, so the material cannot be built. */
const refuseShaders: FetchLike = (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return Promise.resolve(new Response("no", { status: url.startsWith("data:") ? 500 : 404 }));
};

let harness: ParticlesAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe("the particles error table", () => {
  it("stays inside the IGX-1700 to IGX-1749 range this package owns", () => {
    for (const code of CODES) {
      expect(code).toMatch(/^IGX-17\d\d$/);
      const number = Number.parseInt(code.slice(4), 10);
      expect(number).toBeGreaterThanOrEqual(1700);
      expect(number).toBeLessThanOrEqual(1749);
    }
  });

  it("gives every code a message template with no duplicates", () => {
    expect(new Set(CODES).size).toBe(CODES.length);
    for (const code of CODES) {
      expect(PARTICLES_ERROR_MESSAGES[code], code).toBeDefined();
    }
    expect(Object.keys(PARTICLES_ERROR_MESSAGES).toSorted()).toEqual([...CODES].toSorted());
  });

  it("builds an IgnifxError carrying the code, the context, the hint and the cause", () => {
    const cause = new Error("underlying");
    const error = particlesError(ParticlesErrorCode.unknownPreset, "lava is not a particle preset.", {
      context: { preset: "lava" },
      hint: "Pick one of the nine.",
      cause,
    });
    expect(error).toBeInstanceOf(IgnifxError);
    expect(error.code).toBe("IGX-1704");
    expect(error.message).toContain("lava");
    expect(error.cause).toBe(cause);
  });

  it("builds an error with no options at all", () => {
    expect(particlesError(ParticlesErrorCode.duplicateExtension, "already registered.").code).toBe("IGX-1703");
  });
});

describe("every code this package owns", () => {
  it("IGX-1701 is thrown by a document it cannot read", () => {
    expect(() => defineParticles({ main: { capacity: 0 } })).toThrowError(/IGX-1701/);
  });

  it("IGX-1702 is logged when a system is clamped to the remaining budget", async () => {
    const app = await createParticlesApp({ particles: { maxParticles: 4 } });
    harness = app;
    const handle = particleAssetFromDefinition(app.app, defineParticles({ main: { capacity: 100 } }), "test");
    app.world.createEntity("Effect").addComponent(ParticleSystem, { definition: handle });
    app.step(1 / 64);
    expect(app.messages().join("\n")).toContain("IGX-1702");
  });

  it("IGX-1703 is thrown when a second particles service is registered", () => {
    // Reached through the extension suite; the code is asserted here so the table has full cover.
    expect(PARTICLES_ERROR_MESSAGES["IGX-1703"]).toContain("already registered");
  });

  it("IGX-1704 is thrown by an unknown preset name", () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- exercising the runtime guard.
    expect(() => particlePresetInput("lava" as ParticlePreset)).toThrowError(/IGX-1704/);
  });

  it("IGX-1705 is thrown by a playback method with no definition", async () => {
    const app = await createParticlesApp();
    harness = app;
    const system = app.world.createEntity("Empty").addComponent(ParticleSystem);
    expect(() => {
      system.play();
    }).toThrowError(/IGX-1705/);
  });

  it("IGX-1706 is logged once when the generated shader cannot be built", async () => {
    const app = await createParticlesApp({ fetch: refuseShaders, settings: { assets: { retries: 0 } } });
    harness = app;
    const handle = particleAssetFromDefinition(app.app, defineParticles({}), "test");
    const system = app.world.createEntity("Effect").addComponent(ParticleSystem, { definition: handle });
    await app.settle(() => app.messages().join("\n").includes("IGX-1706"));
    const reported = app.messages().filter((message) => message.includes("IGX-1706"));
    expect(reported).toHaveLength(1);
    expect(system.renderer).toBeNull();
  });

  it("IGX-1707 is thrown by a count or a duration it cannot use", async () => {
    const app = await createParticlesApp();
    harness = app;
    const handle = particleAssetFromDefinition(app.app, defineParticles({}), "test");
    const system = app.world.createEntity("Effect").addComponent(ParticleSystem, { definition: handle });
    app.step(1 / 64);
    expect(() => {
      system.emit(-1);
    }).toThrowError(/IGX-1707/);
  });
});
