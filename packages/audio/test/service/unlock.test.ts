import { describe, expect, it } from "vitest";
import { AudioSource } from "../../src/components/audio-source.js";
import { createAudioApp, makeClip } from "../support/harness.js";

/**
 * The unlock flow (`docs/architecture/10-audio.md` §1). A browser will not produce a sound before a
 * user gesture, and Babylon Lite quietly drops a non-looping play made while the context is
 * suspended (`lib/audio/static-sound.js`). ignifx queues those plays instead and flushes them the
 * moment the context runs.
 *
 * The headless backend reproduces the suspended state on request, so the whole flow is exercised
 * here without a browser; `web-backend.browser.test.ts` then proves the same transition happens for
 * a real `AudioContext` resumed by a real gesture.
 */
describe("the locked state", () => {
  it("reports `locked` and holds plays until the engine is unlocked", async () => {
    const h = await createAudioApp({ startSuspended: true });
    try {
      expect(h.audio.state).toBe("locked");
      expect(h.audio.isUnlocked).toBe(false);
      expect(h.audio.unlockedAtMs).toBeNull();

      const clip = makeClip(h.app, "sfx/step.wav", { duration: 0.5 });
      const source = h.world.createEntity("Speaker").addComponent(AudioSource, { clip });
      h.step(1 / 60);
      source.play();

      // The play is owed but the backend has started nothing.
      expect(source.instanceCount).toBe(1);
      expect(h.backend.sounds[0]?.instanceCount).toBe(0);

      h.advance(2);

      expect(source.isPlaying).toBe(true);

      await h.audio.unlock();

      expect(h.audio.state).toBe("running");
      expect(h.backend.sounds[0]?.instanceCount).toBe(1);
    } finally {
      h.dispose();
    }
  });

  it("flushes every queued play, in the order they were asked for", async () => {
    const h = await createAudioApp({ startSuspended: true });
    try {
      const clip = makeClip(h.app, "sfx/step.wav", { duration: 0.5 });
      const source = h.world.createEntity("Speaker").addComponent(AudioSource, { clip, maxInstances: 4 });
      h.step(1 / 60);
      source.play();
      source.play();
      source.play();

      expect(source.instanceCount).toBe(3);

      await h.audio.unlock();

      expect(h.backend.sounds[0]?.instanceCount).toBe(3);
    } finally {
      h.dispose();
    }
  });

  it("records when the unlock happened, on the app's realtime clock", async () => {
    const h = await createAudioApp({ startSuspended: true });
    try {
      h.advance(1);
      await h.audio.unlock();

      expect(h.audio.unlockedAtMs).toBeCloseTo(1000, 0);
    } finally {
      h.dispose();
    }
  });

  it("announces the transition once, and ignores a second unlock", async () => {
    const h = await createAudioApp({ startSuspended: true });
    try {
      const seen: string[] = [];
      h.audio.onStateChanged.connect((state) => {
        seen.push(state);
      });

      await h.audio.unlock();
      await h.audio.unlock();

      expect(seen).toEqual(["running"]);
    } finally {
      h.dispose();
    }
  });

  it("unlocks on its own when the context starts running, which is what a browser gesture does", async () => {
    const h = await createAudioApp({ startSuspended: true });
    try {
      expect(h.audio.state).toBe("locked");

      // What Lite's `resumeOnInteraction` produces: the context resumes and announces it.
      await h.backend.unlock();

      expect(h.audio.state).toBe("running");
      expect(h.audio.isUnlocked).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it("drops rather than queues a play made while locked when queueWhileLocked is off", async () => {
    const h = await createAudioApp({ startSuspended: true, audio: { queueWhileLocked: false } });
    try {
      const clip = makeClip(h.app, "sfx/step.wav", { duration: 0.5 });
      const source = h.world.createEntity("Speaker").addComponent(AudioSource, { clip });
      h.step(1 / 60);
      source.play();

      expect(source.instanceCount).toBe(0);

      await h.audio.unlock();

      expect(source.instanceCount).toBe(0);
    } finally {
      h.dispose();
    }
  });

  it("is already unlocked where the host needs no gesture, such as a headless run", async () => {
    const h = await createAudioApp();
    try {
      expect(h.audio.state).toBe("running");
      expect(h.audio.isUnlocked).toBe(true);
      expect(h.audio.unlockedAtMs).toBe(0);
    } finally {
      h.dispose();
    }
  });

  it("refuses to unlock a disposed service", async () => {
    const h = await createAudioApp({ startSuspended: true });
    const audio = h.audio;
    h.dispose();

    await expect(audio.unlock()).rejects.toMatchObject({ code: "IGX-1010" });
  });
});
