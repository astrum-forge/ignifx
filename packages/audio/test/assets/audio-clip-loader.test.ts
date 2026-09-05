import { describe, expect, it } from "vitest";
import { AUDIO_ASSET_TYPE, AUDIO_FILE_EXTENSIONS } from "../../src/assets/audio-clip.js";
import { AudioBusesAsset } from "../../src/assets/bus-file.js";
import { createAudioApp, manifestWithMeta } from "../support/harness.js";
import { createWav } from "../support/wav.js";
import type { AudioClip } from "../../src/assets/audio-clip.js";

describe("the audio clip loader", () => {
  it("claims the five browser-decodable extensions", () => {
    expect(AUDIO_FILE_EXTENSIONS).toEqual([".mp3", ".ogg", ".wav", ".webm", ".flac"]);
    expect(AUDIO_ASSET_TYPE).toBe("audio");
  });

  it("reads a wav's duration from its header under Node, where nothing is decoded", async () => {
    const h = await createAudioApp({ files: { "sfx/step.wav": createWav({ seconds: 0.5, sampleRate: 8000 }) } });
    try {
      const handle = await h.load<AudioClip>("sfx/step.wav");
      const clip = handle.value;

      expect(clip.duration).toBeCloseTo(0.5, 6);
      expect(clip.channels).toBe(1);
      expect(clip.sampleRate).toBe(8000);
      expect(clip.isStreaming).toBe(false);
      expect(clip.isDecoded).toBe(false);
      expect(clip.lite.buffer).toBeNull();
      expect(clip.address).toBe("sfx/step.wav");
    } finally {
      h.dispose();
    }
  });

  it("leaves the duration null for a container it cannot cheaply measure", async () => {
    const h = await createAudioApp({ files: { "music/theme.mp3": new ArrayBuffer(64) } });
    try {
      const handle = await h.load<AudioClip>("music/theme.mp3");

      expect(handle.value.duration).toBeNull();
      expect(handle.value.channels).toBeNull();
    } finally {
      h.dispose();
    }
  });

  it("never fetches a clip the sidecar marks as streaming", async () => {
    const h = await createAudioApp({
      manifest: manifestWithMeta("music/theme.ogg", { audio: { streaming: true } }),
      // No file is registered, so a fetch would 404 and the load would fail.
      files: {},
    });
    try {
      const handle = await h.load<AudioClip>("music/theme.ogg");

      expect(handle.value.isStreaming).toBe(true);
      expect(handle.value.duration).toBeNull();
      expect(handle.value.byteLength).toBe(0);
      expect(handle.value.url).toBe("assets/music/theme.ogg");
    } finally {
      h.dispose();
    }
  });

  it("drops the clip's bytes and buffer when the last holder releases it", async () => {
    const h = await createAudioApp({ files: { "sfx/step.wav": createWav({ seconds: 0.25 }) } });
    try {
      const handle = await h.load<AudioClip>("sfx/step.wav");
      const clip = handle.value;
      handle.release();
      h.app.assets.gc();

      expect(clip.bytes()).toBeNull();
      expect(clip.lite.buffer).toBeNull();
    } finally {
      h.dispose();
    }
  });

  it("loads an .audio.json through the audiobuses loader, not the generic json one", async () => {
    const document = JSON.stringify({
      format: "ignifx.audiobuses",
      formatVersion: 1,
      buses: [{ name: "Master" }, { name: "SFX", parent: "Master", volume: 0.5 }],
    });
    const h = await createAudioApp({ files: { "audio/buses.audio.json": document } });
    try {
      const handle = await h.load<AudioBusesAsset>("audio/buses.audio.json");

      expect(handle.type).toBe("audiobuses");
      expect(handle.value).toBeInstanceOf(AudioBusesAsset);
      expect(handle.value.buses.map((bus) => bus.name)).toEqual(["Master", "SFX"]);
    } finally {
      h.dispose();
    }
  });
});
