import { describe, expect, it } from "vitest";
import { AudioSource } from "../../src/components/audio-source.js";
import { createAudioApp, makeClip } from "../support/harness.js";
import type { AudioSource as Source } from "../../src/components/audio-source.js";
import type { AudioHarness } from "../support/harness.js";

/**
 * `app.pause()` and audio (`docs/architecture/10-audio.md` §6). The pause transition is polled in
 * the `PreRender` pump rather than delivered by a signal: `App` has no `onPaused`, and `time.paused`
 * is a plain flag. Polling one boolean once a frame costs nothing and needs no change to the kernel.
 */

/**
 * Starts a looping source on a named bus.
 *
 * @param h - The harness.
 * @param bus - Which bus to route through.
 * @returns The source, already playing.
 */
function playingSourceOn(h: AudioHarness, bus: string): Source {
  const clip = makeClip(h.app, `sfx/${bus}.wav`, { duration: 10 });
  const source = h.world.createEntity(bus).addComponent(AudioSource, { clip, bus, loop: true });
  h.step(1 / 60);
  source.play();
  return source;
}

describe("app.pause()", () => {
  it("pauses the sounds on pausable buses and leaves the others alone", async () => {
    const h = await createAudioApp();
    try {
      const sfx = playingSourceOn(h, "SFX");
      const ui = playingSourceOn(h, "UI");

      h.app.pause();
      h.step(1 / 60);

      expect(sfx.instance?.isPaused).toBe(true);
      expect(ui.instance?.isPaused).toBe(false);
      expect(ui.isPlaying).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it("restores exactly what it paused on resume", async () => {
    const h = await createAudioApp();
    try {
      const sfx = playingSourceOn(h, "SFX");
      const ui = playingSourceOn(h, "UI");
      ui.pause();

      h.app.pause();
      h.step(1 / 60);
      h.app.resume();
      h.step(1 / 60);

      expect(sfx.isPlaying).toBe(true);
      // The UI source was paused by the game, not by the app, so resuming does not un-pause it.
      expect(ui.instance?.isPaused).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it("does nothing at all when pauseWithApp is off", async () => {
    const h = await createAudioApp({ audio: { pauseWithApp: false } });
    try {
      const sfx = playingSourceOn(h, "SFX");

      h.app.pause();
      h.step(1 / 60);

      expect(sfx.isPlaying).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it("takes its list of pausable buses from the audio settings section", async () => {
    const h = await createAudioApp({ settings: { audio: { pausableBuses: ["UI"] } } });
    try {
      const sfx = playingSourceOn(h, "SFX");
      const ui = playingSourceOn(h, "UI");

      h.app.pause();
      h.step(1 / 60);

      expect(sfx.isPlaying).toBe(true);
      expect(ui.instance?.isPaused).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it("only acts on the transition, so a second pause frame changes nothing", async () => {
    const h = await createAudioApp();
    try {
      const sfx = playingSourceOn(h, "SFX");

      h.app.pause();
      h.step(1 / 60);
      sfx.resume();
      h.step(1 / 60);

      expect(sfx.isPlaying).toBe(true);
    } finally {
      h.dispose();
    }
  });
});
