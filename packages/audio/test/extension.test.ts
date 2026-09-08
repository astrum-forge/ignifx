import { createApp, isIgnifxError, Phase } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { AudioSource } from "../src/components/audio-source.js";
import { AUDIO_ERROR_MESSAGES, AudioErrorCode, audioError } from "../src/errors.js";
import { audio } from "../src/extension.js";
import { HeadlessBackend } from "../src/headless/headless-backend.js";
import { describeSchemas } from "../src/schemas.js";
import { AUDIO_DIAGNOSTICS_COUNTERS, AUDIO_DIAGNOSTICS_GROUP, AudioService } from "../src/service/audio-service.js";
import { AUDIO_PUMP_ORDER } from "../src/service/audio-system.js";
import {
  AUDIO_SETTINGS_SECTION,
  DEFAULT_AUDIO_BUSES,
  DEFAULT_PAUSABLE_BUSES,
  defaultAudioSettings,
} from "../src/settings.js";
import { createAudioApp, makeClip } from "./support/harness.js";
import type { AudioSettings } from "../src/settings.js";

describe("the audio extension", () => {
  it("declares itself as an @ignifx/core extension with a version and an engine range", () => {
    const extension = audio();

    expect(extension.name).toBe("@ignifx/audio");
    expect(extension.requires).toEqual(["@ignifx/core"]);
    expect(extension.engine).toBe(">=0.0.0 <1.0.0");
    expect(typeof extension.version).toBe("string");
  });

  it("registers app.audio, the components, the loaders, and the diagnostics group", async () => {
    const h = await createAudioApp();
    try {
      expect(h.app.audio).toBeInstanceOf(AudioService);
      expect(h.app.services.get(AudioService)).toBe(h.app.audio);
      expect(h.world.registry.get("ignifx/AudioSource")).toBe(AudioSource);
      expect(h.world.registry.get("ignifx/AudioListener")).not.toBeNull();
      expect(h.world.registry.get("ignifx/MusicPlayer")).not.toBeNull();
      expect(h.app.diagnostics.group(AUDIO_DIAGNOSTICS_GROUP)).not.toBeNull();
      expect(h.app.assets.resolveUrl("sfx/a.wav")).toBe("assets/sfx/a.wav");
    } finally {
      h.dispose();
    }
  });

  it("pumps in PreRender, before the render sync", () => {
    // Physics writes its display pose at the top of `Update` (order -900) since 2026-09-08, so the
    // pump reads listener and source transforms the frame will present; the only order that has to
    // hold inside `PreRender` is "before core's render sync".
    expect(AUDIO_PUMP_ORDER).toBe(-400);
    expect(AUDIO_PUMP_ORDER).toBeLessThan(900);
    expect(Phase.PreRender).toBe(5);
  });

  it("falls back to the headless backend where there is no Web Audio", async () => {
    const app = await createApp({ headless: true, extensions: [audio()] });
    try {
      expect(app.audio.backend).toBeInstanceOf(HeadlessBackend);
      expect(app.audio.backend.kind).toBe("headless");
      expect(app.audio.lite.engine).toBeNull();
    } finally {
      app.dispose();
    }
  });
});

describe("the audio settings section", () => {
  it("defaults to the five documented buses, with everything but UI pausable", () => {
    const defaults = defaultAudioSettings();

    expect(AUDIO_SETTINGS_SECTION).toBe("audio");
    expect(defaults.defaultBuses).toEqual(["Master", "Music", "SFX", "UI", "Voice"]);
    expect(defaults.pausableBuses).toEqual(["Master", "Music", "SFX", "Voice"]);
    expect(defaults.queueWhileLocked).toBe(true);
    expect(defaults.pauseWithApp).toBe(true);
    expect(defaults.buses).toBe("");
    expect(DEFAULT_AUDIO_BUSES).toEqual(defaults.defaultBuses);
    expect(DEFAULT_PAUSABLE_BUSES).toEqual(defaults.pausableBuses);
  });

  it("is validated against its schema and readable through app.settings", async () => {
    const h = await createAudioApp({ settings: { audio: { defaultBuses: ["Main", "Sfx"] } } });
    try {
      const settings = h.app.settings.section<AudioSettings>(AUDIO_SETTINGS_SECTION);

      expect(settings.defaultBuses).toEqual(["Main", "Sfx"]);
      expect([...h.audio.buses.keys()]).toEqual(["Main", "Sfx"]);
    } finally {
      h.dispose();
    }
  });

  it("lets the extension's own options override the section", async () => {
    const h = await createAudioApp({
      settings: { audio: { masterVolume: 0.2 } },
      audio: { masterVolume: 0.9 },
    });
    try {
      expect(h.audio.masterVolume).toBe(0.9);
    } finally {
      h.dispose();
    }
  });
});

describe("the audio diagnostics group", () => {
  it("publishes the state, voice, instance, streaming, bus, and unlock counters", async () => {
    const h = await createAudioApp();
    try {
      const group = h.app.diagnostics.group(AUDIO_DIAGNOSTICS_GROUP);

      expect(group?.counterNames).toEqual([...AUDIO_DIAGNOSTICS_COUNTERS]);

      const clip = makeClip(h.app, "music/theme.ogg", { duration: 30, isStreaming: true });
      const source = h.world.createEntity("Speaker").addComponent(AudioSource, { clip });
      h.step(1 / 60);
      source.play();
      h.step(1 / 60);

      expect(group?.get(group.index("state"))).toBe(1);
      expect(group?.get(group.index("voices"))).toBe(1);
      expect(group?.get(group.index("instances"))).toBe(1);
      expect(group?.get(group.index("streaming"))).toBe(1);
      expect(group?.get(group.index("buses"))).toBe(5);
      expect(group?.get(group.index("unlockedAtMs"))).toBe(0);
    } finally {
      h.dispose();
    }
  });

  it("reports the locked state as index zero", async () => {
    const h = await createAudioApp({ startSuspended: true });
    try {
      h.step(1 / 60);
      const group = h.app.diagnostics.group(AUDIO_DIAGNOSTICS_GROUP);

      expect(group?.get(group.index("state"))).toBe(0);
    } finally {
      h.dispose();
    }
  });
});

describe("the IGX-10xx code space", () => {
  it("registers a message for every code it declares", async () => {
    const h = await createAudioApp();
    try {
      for (const code of Object.values(AudioErrorCode)) {
        expect(AUDIO_ERROR_MESSAGES[code]).toBeTypeOf("string");
        // The `10` subsystem range of 15-devtools-and-diagnostics.md §1, spelled out rather than
        // written as a literal prefix so it is not mistaken for a code.
        expect(code).toMatch(/^IGX-10\d\d$/u);
      }

      expect(Object.keys(AUDIO_ERROR_MESSAGES)).toHaveLength(Object.values(AudioErrorCode).length);
    } finally {
      h.dispose();
    }
  });

  it("builds an IgnifxError carrying the context, hint, and cause it was given", () => {
    const cause = new Error("underneath");
    const error = audioError(AudioErrorCode.unknownBus, "No such bus.", {
      context: { bus: "Ambience" },
      hint: "Declare it.",
      cause,
    });

    expect(isIgnifxError(error)).toBe(true);
    expect(error.code).toBe("IGX-1001");
    expect(error.cause).toBe(cause);
    expect(error.message).toContain("No such bus.");
  });

  it("builds one with nothing but a message when nothing else is given", () => {
    const error = audioError(AudioErrorCode.audioDisposed, "Gone.");

    expect(error.code).toBe("IGX-1010");
  });
});

describe("describeSchemas", () => {
  it("describes the three components and the bus file, under namespaced keys", () => {
    const schemas = describeSchemas();

    expect(Object.keys(schemas).toSorted()).toEqual([
      "ignifx/AudioListener",
      "ignifx/AudioSource",
      "ignifx/MusicPlayer",
      "ignifx/audiobuses-file",
    ]);
    for (const key of Object.keys(schemas)) {
      expect(key).toContain("/");
    }
  });

  it("carries the AudioSource defaults the design document names", () => {
    const source = describeSchemas()["ignifx/AudioSource"];

    expect(source?.fields["bus"]?.default).toBe("SFX");
    expect(source?.fields["volume"]?.default).toBe(1);
    expect(source?.fields["pitch"]?.default).toBe(1);
    expect(source?.fields["maxInstances"]?.default).toBe(8);
    expect(source?.fields["minDistance"]?.default).toBe(1);
    expect(source?.fields["maxDistance"]?.default).toBe(50);
    expect(source?.fields["distanceModel"]?.default).toBe("inverse");
    expect(source?.fields["clip"]?.default).toBeNull();
  });

  it("groups the components on the components page and the bus file on its own", () => {
    const schemas = describeSchemas();

    expect(schemas["ignifx/AudioSource"]?.format).toBe("components");
    expect(schemas["ignifx/audiobuses-file"]?.format).toBe("ignifx.audiobuses");
  });
});
