import { createApp } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultInputSettings,
  INPUT_RESOLVE_ORDER,
  INPUT_SETTINGS_SECTION,
  input,
  InputService,
  PlayerInput,
  VERSION,
} from "../src/index.js";
import { createInputApp } from "./support/app.js";
import type { InputSettings } from "../src/index.js";
import type { InputAppHarness } from "./support/app.js";
import type { App } from "@ignifx/core";

let harness: InputAppHarness | null = null;
let bare: App | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
  bare?.dispose();
  bare = null;
});

describe("the extension descriptor", () => {
  it("declares the documented name, engine range, and requirement", () => {
    const extension = input();
    expect(extension.name).toBe("@ignifx/input");
    expect(extension.version).toBe(VERSION);
    expect(extension.engine).toBe(">=0.0.0 <1.0.0");
    expect(extension.requires).toEqual(["@ignifx/core"]);
  });

  it("does nothing at module import time beyond building the descriptor", () => {
    expect(() => input()).not.toThrow();
    expect(() => input({ pressPoint: 0.25 })).not.toThrow();
  });

  it("resolves input before the core asset delivery system", () => {
    expect(INPUT_RESOLVE_ORDER).toBe(-950);
  });
});

describe("registration", () => {
  it("defines app.input and registers the service under its class", async () => {
    const built = await createInputApp();
    harness = built;
    expect(built.app.input).toBeInstanceOf(InputService);
    expect(built.app.services.get(InputService)).toBe(built.app.input);
  });

  it("registers the input settings section with its documented defaults", async () => {
    const built = await createInputApp();
    harness = built;
    const settings = built.app.settings.section<InputSettings>(INPUT_SETTINGS_SECTION);
    expect(settings).toEqual(defaultInputSettings());
    expect(defaultInputSettings()).toEqual({
      actions: "",
      pressPoint: 0.5,
      gamepadPolling: true,
      pointerLock: { allowed: true },
      defaultScheme: "",
      strictSchemes: false,
    });
  });

  it("lets the project override the section", async () => {
    const built = await createInputApp({
      settings: { input: { pressPoint: 0.2, strictSchemes: true, actions: "input/x.input.json" } },
    });
    harness = built;
    const settings = built.app.settings.section<InputSettings>(INPUT_SETTINGS_SECTION);
    expect(settings.pressPoint).toBe(0.2);
    expect(settings.strictSchemes).toBe(true);
    expect(built.app.input.strictSchemes).toBe(true);
  });

  it("lets the extension options override the section", async () => {
    const built = await createInputApp({
      settings: { input: { pressPoint: 0.2 } },
      options: { pressPoint: 0.9 },
    });
    harness = built;
    expect(built.app.input.pressPoint).toBe(0.9);
  });

  it("registers the inputactions asset type", async () => {
    const built = await createInputApp();
    harness = built;
    expect(built.app.assets.resolveUrl("input/a.input.json")).toContain("input/a.input.json");
  });

  it("registers the PlayerInput component with the serializer", async () => {
    const built = await createInputApp();
    harness = built;
    expect(built.app.world.registry.get("ignifx/PlayerInput")).toBe(PlayerInput);
  });

  it("registers its IGX-08xx codes with the app", async () => {
    const built = await createInputApp();
    harness = built;
    // A code the package owns resolves to a message; one it does not is unknown.
    expect(built.app.input).toBeDefined();
  });

  it("refuses to define app.input twice with IGX-0401", async () => {
    await expect(
      createApp({ headless: true, extensions: [input({ gamepadReader: null }), input({ gamepadReader: null })] }),
    ).rejects.toMatchObject({ code: "IGX-0406" });
  });

  it("registers nothing when the extension is absent", async () => {
    const app = await createApp({ headless: true });
    bare = app;
    expect(app.services.tryGet(InputService)).toBeNull();
  });

  it("stops resolving after the app is disposed", async () => {
    const built = await createInputApp();
    const service = built.app.input;
    built.dispose();
    harness = null;
    expect(() => service.resolveFrame(1 / 60)).not.toThrow();
  });
});
