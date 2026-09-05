import { describe, expect, it } from "vitest";
import { AudioListener } from "../../src/components/audio-listener.js";
import { createAudioApp } from "../support/harness.js";

/**
 * Listener selection (`docs/architecture/10-audio.md` §4): one listener is active, the most recently
 * enabled one wins, and disabling it hands the ears back.
 */
describe("AudioListener", () => {
  it("becomes the active listener when it is enabled, and points the backend at its node", async () => {
    const h = await createAudioApp();
    try {
      expect(h.audio.listener).toBeNull();

      const entity = h.world.createEntity("Ears");
      const listener = entity.addComponent(AudioListener);
      h.step(1 / 60);

      expect(h.audio.listener).toBe(listener);
      expect(h.backend.listener).toBe(entity.transform.lite);
      expect(listener.spatialTarget).toBe(entity.transform.lite);
    } finally {
      h.dispose();
    }
  });

  it("gives the ears to the listener enabled last, which during a scene load is the newest", async () => {
    const h = await createAudioApp();
    try {
      const first = h.world.createEntity("Ears A").addComponent(AudioListener);
      const secondEntity = h.world.createEntity("Ears B");
      const second = secondEntity.addComponent(AudioListener);
      h.step(1 / 60);

      expect(h.audio.listener).toBe(second);
      expect(h.backend.listener).toBe(secondEntity.transform.lite);
      expect(first.isEnabledInHierarchy).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it("falls back to the previous listener when the active one is disabled", async () => {
    const h = await createAudioApp();
    try {
      const first = h.world.createEntity("Ears A").addComponent(AudioListener);
      const second = h.world.createEntity("Ears B").addComponent(AudioListener);
      h.step(1 / 60);

      second.enabled = false;
      h.step(1 / 60);

      expect(h.audio.listener).toBe(first);
    } finally {
      h.dispose();
    }
  });

  it("leaves the listener at the world origin when the last one is destroyed", async () => {
    const h = await createAudioApp();
    try {
      const entity = h.world.createEntity("Ears");
      entity.addComponent(AudioListener);
      h.step(1 / 60);

      entity.destroy();
      h.step(1 / 60);

      expect(h.audio.listener).toBeNull();
      expect(h.backend.listener).toBeNull();
    } finally {
      h.dispose();
    }
  });

  it("comes back when a disabled listener is re-enabled", async () => {
    const h = await createAudioApp();
    try {
      const listener = h.world.createEntity("Ears").addComponent(AudioListener);
      h.step(1 / 60);
      listener.enabled = false;
      h.step(1 / 60);

      expect(h.audio.listener).toBeNull();

      listener.enabled = true;
      h.step(1 / 60);

      expect(h.audio.listener).toBe(listener);
    } finally {
      h.dispose();
    }
  });

  it("declares no serialized fields, because being enabled is the whole of its state", () => {
    expect(Object.keys(AudioListener.schema)).toEqual([]);
    expect(AudioListener.typeId).toBe("ignifx/AudioListener");
    expect(AudioListener.allowMultiple).toBe(false);
  });
});
