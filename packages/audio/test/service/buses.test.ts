import { isIgnifxError } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { DEFAULT_AUDIO_BUSES } from "../../src/settings.js";
import { createAudioApp } from "../support/harness.js";

/**
 * The `IGX-####` code a call threw with.
 *
 * @param run - What should throw.
 * @returns The code, or `"none"`.
 */
function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return isIgnifxError(error) ? error.code : "not-an-ignifx-error";
  }
  return "none";
}

describe("the default bus tree", () => {
  it("is built before the first frame, with Master as the root of everything else", async () => {
    const h = await createAudioApp();
    try {
      expect([...h.audio.buses.keys()]).toEqual([...DEFAULT_AUDIO_BUSES]);
      expect(h.audio.isTreeReady).toBe(true);
      expect(h.audio.bus("Master").parent).toBeNull();
      expect(h.audio.bus("Music").parent).toBe(h.audio.bus("Master"));
      expect(h.audio.bus("Voice").parent).toBe(h.audio.bus("Master"));
    } finally {
      h.dispose();
    }
  });

  it("marks every bus but UI as pausable, so a pause menu can still click", async () => {
    const h = await createAudioApp();
    try {
      expect(h.audio.bus("SFX").pausable).toBe(true);
      expect(h.audio.bus("Music").pausable).toBe(true);
      expect(h.audio.bus("UI").pausable).toBe(false);
    } finally {
      h.dispose();
    }
  });
});

describe("bus volume", () => {
  it("multiplies down the parent chain", async () => {
    const h = await createAudioApp();
    try {
      h.audio.bus("Master").volume = 0.5;
      h.audio.bus("Music").volume = 0.4;

      expect(h.audio.bus("Music").volume).toBe(0.4);
      expect(h.audio.bus("Music").effectiveVolume).toBeCloseTo(0.2, 6);
      expect(h.audio.bus("Master").effectiveVolume).toBe(0.5);
    } finally {
      h.dispose();
    }
  });

  it("silences a bus and everything under it when it is muted, without losing its volume", async () => {
    const h = await createAudioApp();
    try {
      h.audio.bus("Music").volume = 0.6;
      h.audio.bus("Master").muted = true;

      expect(h.audio.bus("Music").effectiveVolume).toBe(0);
      expect(h.audio.bus("Music").volume).toBe(0.6);

      h.audio.bus("Master").muted = false;

      expect(h.audio.bus("Music").effectiveVolume).toBeCloseTo(0.6, 6);
    } finally {
      h.dispose();
    }
  });

  it("ignores a mute that does not change anything", async () => {
    const h = await createAudioApp();
    try {
      h.audio.bus("SFX").muted = false;

      expect(h.audio.bus("SFX").muted).toBe(false);
    } finally {
      h.dispose();
    }
  });

  it("ramps a fade over frame time and lands exactly on the target", async () => {
    const h = await createAudioApp();
    try {
      const music = h.audio.bus("Music");
      music.setVolume(0, 1);

      expect(music.volume).toBe(1);

      h.advance(0.5);

      expect(music.volume).toBeCloseTo(0.5, 1);

      h.advance(0.6);

      expect(music.volume).toBe(0);
    } finally {
      h.dispose();
    }
  });

  it("applies a zero-second fade immediately, with no frames in between", async () => {
    const h = await createAudioApp();
    try {
      h.audio.bus("SFX").setVolume(0.25);

      expect(h.audio.bus("SFX").volume).toBe(0.25);
    } finally {
      h.dispose();
    }
  });

  it("writes the applied gain through to the backend", async () => {
    const h = await createAudioApp();
    try {
      h.audio.bus("SFX").volume = 0.3;
      const backendBus = h.backend.buses.find((bus) => bus.name === "SFX");

      expect(backendBus?.volume).toBeCloseTo(0.3, 6);
      expect(h.audio.bus("SFX").lite).toBeNull();
    } finally {
      h.dispose();
    }
  });
});

describe("looking a bus up", () => {
  it("throws IGX-1001 for a name the tree does not hold", async () => {
    const h = await createAudioApp();
    try {
      expect(codeOf(() => h.audio.bus("Ambience"))).toBe("IGX-1001");
      expect(h.audio.tryBus("Ambience")).toBeNull();
      expect(h.audio.tryBus("SFX")).toBe(h.audio.bus("SFX"));
    } finally {
      h.dispose();
    }
  });
});

describe("createBus", () => {
  it("adds a bus under a named parent and routes it there", async () => {
    const h = await createAudioApp();
    try {
      const ambience = await h.audio.createBus("Ambience", { parent: "Master", volume: 0.4 });

      expect(ambience.name).toBe("Ambience");
      expect(ambience.parent).toBe(h.audio.bus("Master"));
      expect(ambience.volume).toBe(0.4);
      expect(h.audio.buses.get("Ambience")).toBe(ambience);
    } finally {
      h.dispose();
    }
  });

  it("routes a bus with no named parent to the root", async () => {
    const h = await createAudioApp();
    try {
      const ambience = await h.audio.createBus("Ambience");

      expect(ambience.parent).toBe(h.audio.bus("Master"));
      expect(ambience.pausable).toBe(false);
    } finally {
      h.dispose();
    }
  });

  it("refuses a name the tree already holds", async () => {
    const h = await createAudioApp();
    try {
      await expect(h.audio.createBus("SFX")).rejects.toMatchObject({ code: "IGX-1005" });
    } finally {
      h.dispose();
    }
  });

  it("refuses a parent the tree does not hold", async () => {
    const h = await createAudioApp();
    try {
      await expect(h.audio.createBus("Ambience", { parent: "Nowhere" })).rejects.toMatchObject({ code: "IGX-1001" });
    } finally {
      h.dispose();
    }
  });
});

describe("a tree from a .audio.json", () => {
  it("replaces the defaults when the document is delivered", async () => {
    const document = JSON.stringify({
      format: "ignifx.audiobuses",
      formatVersion: 1,
      buses: [
        { name: "Root" },
        { name: "Music", parent: "Root", volume: 0.8 },
        { name: "SFX", parent: "Root", pausable: false },
      ],
    });
    const h = await createAudioApp({
      audio: { buses: "audio/buses.audio.json" },
      files: { "audio/buses.audio.json": document },
    });
    try {
      expect(h.audio.isTreeReady).toBe(false);

      await h.app.start();
      await h.load("audio/buses.audio.json");
      h.step(1 / 60);

      expect(h.audio.isTreeReady).toBe(true);
      expect([...h.audio.buses.keys()]).toEqual(["Root", "Music", "SFX"]);
      expect(h.audio.bus("Music").volume).toBeCloseTo(0.8, 6);
      expect(h.audio.bus("SFX").pausable).toBe(false);
    } finally {
      h.dispose();
    }
  });

  it("takes an inline tree before the first frame, which a file cannot manage", async () => {
    const h = await createAudioApp({
      audio: {
        busTree: [
          { name: "Root", parent: null, volume: 1, pausable: null },
          { name: "Dialogue", parent: "Root", volume: 0.9, pausable: null },
        ],
      },
    });
    try {
      expect([...h.audio.buses.keys()]).toEqual(["Root", "Dialogue"]);
      expect(h.audio.bus("Dialogue").effectiveVolume).toBeCloseTo(0.9, 6);
    } finally {
      h.dispose();
    }
  });
});

describe("master volume", () => {
  it("is written straight through to the backend", async () => {
    const h = await createAudioApp();
    try {
      expect(h.audio.masterVolume).toBe(1);

      h.audio.masterVolume = 0.25;

      expect(h.audio.masterVolume).toBe(0.25);
      expect(h.backend.getMasterVolume()).toBe(0.25);
    } finally {
      h.dispose();
    }
  });

  it("starts at whatever the audio settings section says", async () => {
    const h = await createAudioApp({ settings: { audio: { masterVolume: 0.5 } } });
    try {
      expect(h.audio.masterVolume).toBe(0.5);
    } finally {
      h.dispose();
    }
  });
});
