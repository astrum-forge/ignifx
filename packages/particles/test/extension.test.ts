import { createApp, createManualClock } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { PARTICLE_ASSET_TYPE } from "../src/definition/types.js";
import { ParticlesErrorCode } from "../src/errors.js";
import { particles } from "../src/extension.js";
import { PARTICLE_RENDER_ORDER, PARTICLE_UPDATE_ORDER, ParticleSystem } from "../src/gpu/particle-system.js";
import { ParticlesService } from "../src/service/particles-service.js";
import { defaultParticlesSettings, PARTICLES_SETTINGS_SECTION } from "../src/settings.js";
import { VERSION } from "../src/version.js";
import { createParticlesApp } from "./support/harness.js";
import type { ParticlesAppHarness } from "./support/harness.js";
import type { ParticlesSettings } from "../src/settings.js";
import type { Extension, ExtensionContext } from "@ignifx/core";

/** Builds an app that registers `particles()` twice under its own name. */
function registerTwice(): Promise<unknown> {
  return createApp({
    headless: true,
    clock: createManualClock(),
    logLevel: "silent",
    extensions: [particles(), particles()],
    mode: "development",
  });
}

let harness: ParticlesAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

describe("the particles extension", () => {
  it("describes itself with the package's name and version", () => {
    const extension = particles();
    expect(extension.name).toBe("@ignifx/particles");
    expect(extension.version).toBe(VERSION);
    expect([...(extension.requires ?? [])]).toEqual(["@ignifx/core"]);
    expect([...(extension.optional ?? [])]).toEqual(["@ignifx/physics"]);
  });

  it("registers the service, the component, the loader and the settings section", async () => {
    const app = await createParticlesApp();
    harness = app;
    expect(app.app.services.tryGet(ParticlesService)).not.toBeNull();
    expect(app.app.settings.section<ParticlesSettings>(PARTICLES_SETTINGS_SECTION).maxParticles).toBe(100_000);
    const entity = app.world.createEntity("Effect");
    expect(() => entity.addComponent(ParticleSystem)).not.toThrow();
    // A registered loader is what makes an explicit `{ type }` load resolve instead of `IGX-0504`.
    using handle = app.app.assets.load("memory:nothing.particles.json", { type: PARTICLE_ASSET_TYPE });
    expect(handle.state).not.toBe("failed");
  });

  it("puts emission late in Update and the upload before core's render sync", () => {
    expect(PARTICLE_UPDATE_ORDER).toBe(900);
    expect(PARTICLE_RENDER_ORDER).toBe(880);
  });

  it("refuses a second particles service on one app with IGX-1703", async () => {
    const hijack: Extension = {
      name: "test/hijack",
      version: "0.0.0",
      engine: ">=0.0.0 <1.0.0",
      requires: [],
      register(ctx: ExtensionContext): void {
        ctx.registerService(ParticlesService, new ParticlesService(ctx.app, defaultParticlesSettings()));
      },
    };
    const call = async (): Promise<unknown> =>
      createApp({
        headless: true,
        clock: createManualClock(),
        logLevel: "silent",
        extensions: [hijack, particles()],
        mode: "development",
      });
    await expect(call()).rejects.toThrow(new RegExp(ParticlesErrorCode.duplicateExtension));
  });

  it("is refused twice under one name by core, before it can look at its own service", async () => {
    await expect(registerTwice()).rejects.toThrow(/IGX-0406/u);
  });

  it("releases the service's shared resources when the app is disposed", async () => {
    const app = await createParticlesApp();
    const service = app.app.particles;
    app.dispose();
    harness = null;
    expect(service.systems).toHaveLength(0);
  });

  it("accepts being called with no options at all", async () => {
    const app = await createApp({
      headless: true,
      clock: createManualClock(),
      logLevel: "silent",
      extensions: [particles()],
      mode: "development",
    });
    await app.start();
    expect(app.particles.qualityScale).toBe(1);
    app.dispose();
  });
});
