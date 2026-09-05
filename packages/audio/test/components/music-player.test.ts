import { SCENE_FILE_FORMAT, SCENE_FORMAT_VERSION, stringifySceneFile } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { MusicPlayer } from "../../src/components/music-player.js";
import { createAudioApp, makeClip } from "../support/harness.js";
import type { AudioClip } from "../../src/assets/audio-clip.js";
import type { AudioHarness } from "../support/harness.js";

/**
 * `MusicPlayer` (`docs/architecture/10-audio.md` §5): crossfading, the playlist, and surviving a
 * `"single"` scene load from a persistent scene.
 */

/** What {@link withMusic} hands a test. */
interface MusicFixture {
  /** The harness. */
  readonly h: AudioHarness;
  /** The player under test. */
  readonly music: MusicPlayer;
}

/**
 * Builds an app with one `MusicPlayer` and a two-track playlist.
 *
 * @returns The fixture.
 */
async function withMusic(): Promise<MusicFixture> {
  const h = await createAudioApp();
  const playlist = [
    makeClip(h.app, "music/one.ogg", { duration: 2 }),
    makeClip(h.app, "music/two.ogg", { duration: 2 }),
  ];
  const music = h.world.createEntity("Jukebox").addComponent(MusicPlayer, { playlist, crossfadeSeconds: 1 });
  h.step(1 / 60);
  return { h, music };
}

describe("MusicPlayer.play", () => {
  it("routes to the Music bus and starts at full volume with no fade", async () => {
    const { h, music } = await withMusic();
    try {
      const clip = makeClip(h.app, "music/theme.ogg", { duration: 5 }).value;
      const instance = music.play(clip);

      expect(instance.bus?.name).toBe("Music");
      expect(instance.volume).toBe(1);
      expect(music.isPlaying).toBe(true);
      expect(music.current).toBe(instance);
    } finally {
      h.dispose();
    }
  });

  it("fades a track up over frame time when asked to", async () => {
    const { h, music } = await withMusic();
    try {
      const clip = makeClip(h.app, "music/theme.ogg", { duration: 5 }).value;
      const instance = music.play(clip, { fadeIn: 1 });

      expect(instance.volume).toBe(0);

      h.advance(0.5);

      expect(instance.volume).toBeCloseTo(0.5, 1);

      h.advance(0.6);

      expect(instance.volume).toBe(1);
    } finally {
      h.dispose();
    }
  });
});

describe("MusicPlayer.crossfadeTo", () => {
  it("holds two tracks at once and moves the volume from one to the other", async () => {
    const { h, music } = await withMusic();
    try {
      const first = makeClip(h.app, "music/one.ogg", { duration: 30 }).value;
      const second = makeClip(h.app, "music/two.ogg", { duration: 30 }).value;
      const outgoing = music.play(first);
      const incoming = music.crossfadeTo(second, 2);

      expect(music.previous).toBe(outgoing);
      expect(music.current).toBe(incoming);
      expect(incoming.volume).toBe(0);
      expect(outgoing.volume).toBe(1);

      h.advance(1);

      expect(incoming.volume).toBeCloseTo(0.5, 1);
      expect(outgoing.volume).toBeCloseTo(0.5, 1);

      h.advance(1.1);

      expect(incoming.volume).toBe(1);
      expect(outgoing.volume).toBe(0);
      expect(outgoing.isPlaying).toBe(false);
      expect(incoming.isPlaying).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it("takes crossfadeSeconds when the caller names no duration", async () => {
    const { h, music } = await withMusic();
    try {
      const clip = makeClip(h.app, "music/one.ogg", { duration: 30 }).value;
      const incoming = music.crossfadeTo(clip);

      h.advance(0.5);

      expect(incoming.volume).toBeCloseTo(0.5, 1);
    } finally {
      h.dispose();
    }
  });
});

describe("the playlist", () => {
  it("starts at the first entry on awake and reports which one is playing", async () => {
    const h = await createAudioApp();
    try {
      const playlist = [
        makeClip(h.app, "music/one.ogg", { duration: 1 }),
        makeClip(h.app, "music/two.ogg", { duration: 1 }),
      ];
      const music = h.world
        .createEntity("Jukebox")
        .addComponent(MusicPlayer, { playlist, playOnAwake: true, crossfadeSeconds: 0 });
      h.step(1 / 60);

      expect(music.index).toBe(0);
      expect(music.current?.clip.address).toBe("music/one.ogg");
    } finally {
      h.dispose();
    }
  });

  it("advances on its own when a track ends", async () => {
    const { h, music } = await withMusic();
    try {
      music.crossfadeSeconds = 0;
      music.next();

      expect(music.index).toBe(0);

      h.advance(2.2);

      expect(music.index).toBe(1);
      expect(music.current?.clip.address).toBe("music/two.ogg");
    } finally {
      h.dispose();
    }
  });

  it("wraps to the first track when loopPlaylist is set", async () => {
    const { h, music } = await withMusic();
    try {
      music.crossfadeSeconds = 0;
      music.next();
      music.next();
      music.next();

      expect(music.index).toBe(0);
    } finally {
      h.dispose();
    }
  });

  it("stops at the end when loopPlaylist is off", async () => {
    const { h, music } = await withMusic();
    try {
      music.loopPlaylist = false;
      music.crossfadeSeconds = 0;
      music.next();
      music.next();

      expect(music.index).toBe(1);
      expect(music.next()).toBeNull();
    } finally {
      h.dispose();
    }
  });

  it("does nothing with an empty playlist", async () => {
    const h = await createAudioApp();
    try {
      const music = h.world.createEntity("Jukebox").addComponent(MusicPlayer);
      h.step(1 / 60);

      expect(music.next()).toBeNull();
      expect(music.isPlaying).toBe(false);
    } finally {
      h.dispose();
    }
  });

  it("skips an entry whose clip has not been delivered", async () => {
    const h = await createAudioApp({ files: { "music/late.ogg": new ArrayBuffer(64) } });
    try {
      const pending = h.app.assets.load<AudioClip>("music/late.ogg");
      const music = h.world.createEntity("Jukebox").addComponent(MusicPlayer, { playlist: [pending] });
      h.step(1 / 60);

      expect(music.next()).toBeNull();
    } finally {
      h.dispose();
    }
  });
});

describe("MusicPlayer.stop", () => {
  it("fades out and does not advance the playlist, because a stop is a decision", async () => {
    const { h, music } = await withMusic();
    try {
      music.crossfadeSeconds = 0;
      music.next();
      music.stop({ fadeOut: 1 });

      h.advance(1.1);

      expect(music.index).toBe(0);
      expect(music.isPlaying).toBe(false);
    } finally {
      h.dispose();
    }
  });

  it("stops now when no fade is named", async () => {
    const { h, music } = await withMusic();
    try {
      music.crossfadeSeconds = 0;
      music.next();
      music.stop();

      expect(music.isPlaying).toBe(false);
    } finally {
      h.dispose();
    }
  });
});

describe("surviving a scene load", () => {
  it("keeps playing across a `single` load when it sits in a persistent scene", async () => {
    const document = stringifySceneFile({
      format: SCENE_FILE_FORMAT,
      formatVersion: SCENE_FORMAT_VERSION,
      name: "level-2",
      entities: [],
    });
    const h = await createAudioApp({ files: { "levels/2.scene.json": document } });
    try {
      h.world.activeScene.persistent = true;
      const clip = makeClip(h.app, "music/theme.ogg", { duration: 30 }).value;
      const music = h.world.createEntity("Jukebox").addComponent(MusicPlayer);
      h.step(1 / 60);
      music.play(clip);

      const loading = h.world.loadScene("levels/2.scene.json");
      await h.settle(loading);
      await loading;
      h.step(1 / 60);

      expect(music.isDestroyed).toBe(false);
      expect(music.isPlaying).toBe(true);
      expect(h.world.scenes).toHaveLength(2);
    } finally {
      h.dispose();
    }
  });

  it("releases its voices when the player is destroyed, so nothing is left sounding", async () => {
    const { h, music } = await withMusic();
    try {
      const first = makeClip(h.app, "music/one.ogg", { duration: 30 }).value;
      const second = makeClip(h.app, "music/two.ogg", { duration: 30 }).value;
      music.play(first);
      music.crossfadeTo(second, 2);

      expect(h.backend.sounds).toHaveLength(2);

      music.entity.destroy();
      h.step(1 / 60);

      expect(h.backend.sounds).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });
});
