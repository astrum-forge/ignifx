import { describe, expect, it } from "vitest";
import { AudioSource } from "../src/components/audio-source.js";
import { createAudioApp, makeClip } from "./support/harness.js";

/**
 * `@ignifx/audio` in an edit-mode app (ADR-0028). `AudioSource` is a script, so the callback gate
 * alone keeps an editor silent; the pump keeps running so a preview the host starts still fades.
 */

describe("audio in an edit-mode app", () => {
  it("does not play a source on awake, because the source gets no awake", async () => {
    const h = await createAudioApp({ editMode: true });
    try {
      const clip = makeClip(h.app, "sfx/step.wav", { duration: 0.5 });
      const source = h.world.createEntity("Speaker").addComponent(AudioSource, { clip, playOnAwake: true });
      h.advance(0.5);
      expect(source.isPlaying).toBe(false);
    } finally {
      h.dispose();
    }
  });

  it("keeps pumping, so a preview the host starts fades out and stops", async () => {
    const h = await createAudioApp({ editMode: true });
    try {
      const clip = makeClip(h.app, "sfx/step.wav", { duration: 5 });
      const source = h.world.createEntity("Speaker").addComponent(AudioSource, { clip });
      h.step(1 / 60);
      const instance = source.play();
      source.stop(1);
      h.advance(0.5);
      expect(instance?.volume).toBeCloseTo(0.5, 1);
      h.advance(0.6);
      expect(instance?.volume).toBe(0);
      expect(source.isPlaying).toBe(false);
    } finally {
      h.dispose();
    }
  });
});
