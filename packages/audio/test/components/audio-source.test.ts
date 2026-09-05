import { isIgnifxError } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { AudioListener } from "../../src/components/audio-listener.js";
import { AudioSource } from "../../src/components/audio-source.js";
import { createAudioApp, makeClip } from "../support/harness.js";
import type { AudioHarness } from "../support/harness.js";
import type { Entity } from "@ignifx/core";

/** What {@link withSource} hands a test. */
interface SourceFixture {
  /** The harness. */
  readonly h: AudioHarness;
  /** The entity carrying the source. */
  readonly entity: Entity;
  /** The source under test. */
  readonly source: AudioSource;
}

/**
 * Builds an app with one entity carrying an `AudioSource` on a clip of a known length.
 *
 * @param seconds - The clip's duration, or `null` for a clip whose duration is unknown.
 * @returns The fixture.
 */
async function withSource(seconds: number | null = 0.5): Promise<SourceFixture> {
  const h = await createAudioApp();
  const entity = h.world.createEntity("Speaker");
  const clip = makeClip(h.app, "sfx/step.wav", { duration: seconds });
  const source = entity.addComponent(AudioSource, { clip });
  h.step(1 / 60);
  return { h, entity, source };
}

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

describe("AudioSource.play", () => {
  it("starts an instance and reports it as playing", async () => {
    const { h, source } = await withSource();
    try {
      expect(source.isPlaying).toBe(false);
      expect(source.instanceCount).toBe(0);
      expect(source.instance).toBeNull();

      const instance = source.play();

      expect(instance).not.toBeNull();
      expect(source.isPlaying).toBe(true);
      expect(source.instanceCount).toBe(1);
      expect(instance?.clip.address).toBe("sfx/step.wav");
      expect(instance?.bus?.name).toBe("SFX");
    } finally {
      h.dispose();
    }
  });

  it("answers null when the source has no clip", async () => {
    const h = await createAudioApp();
    try {
      const source = h.world.createEntity("Silent").addComponent(AudioSource);
      h.step(1 / 60);

      expect(source.play()).toBeNull();
      expect(source.isPlaying).toBe(false);
    } finally {
      h.dispose();
    }
  });

  it("hands back the same handle for every play, because Lite has no per-instance handle", async () => {
    const { h, source } = await withSource();
    try {
      const first = source.play();
      const second = source.play();

      expect(second).toBe(first);
      expect(source.instanceCount).toBe(2);
    } finally {
      h.dispose();
    }
  });

  it("throws IGX-1001 when the source names a bus the tree does not hold", async () => {
    const { h, source } = await withSource();
    try {
      source.bus = "Ambience";

      expect(codeOf(() => source.play())).toBe("IGX-1001");
    } finally {
      h.dispose();
    }
  });

  it("starts on its own when playOnAwake is set, once awake has run", async () => {
    const h = await createAudioApp();
    try {
      const clip = makeClip(h.app, "sfx/step.wav", { duration: 0.5 });
      const source = h.world.createEntity("Speaker").addComponent(AudioSource, { clip, playOnAwake: true });

      h.step(1 / 60);

      expect(source.isPlaying).toBe(true);
    } finally {
      h.dispose();
    }
  });
});

describe("AudioSource.onEnded", () => {
  it("fires after exactly the clip's duration of stepped time", async () => {
    const { h, source } = await withSource(0.5);
    try {
      let ended = 0;
      source.onEnded.connect(() => {
        ended += 1;
      });
      source.play();

      h.advance(0.4);

      expect(ended).toBe(0);
      expect(source.isPlaying).toBe(true);

      h.advance(0.15);

      expect(ended).toBe(1);
      expect(source.isPlaying).toBe(false);
      expect(source.instanceCount).toBe(0);
    } finally {
      h.dispose();
    }
  });

  it("divides the wait by the playback rate, because pitch is playbackRate", async () => {
    const { h, source } = await withSource(0.5);
    try {
      let ended = 0;
      source.onEnded.connect(() => {
        ended += 1;
      });
      source.play({ pitch: 2 });

      h.advance(0.2);

      expect(ended).toBe(0);

      h.advance(0.1);

      expect(ended).toBe(1);
    } finally {
      h.dispose();
    }
  });

  it("never fires for a looping instance", async () => {
    const { h, source } = await withSource(0.5);
    try {
      let ended = 0;
      source.onEnded.connect(() => {
        ended += 1;
      });
      source.loop = true;
      source.play();

      h.advance(5);

      expect(ended).toBe(0);
      expect(source.isPlaying).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it("never fires for a clip whose duration this build could not read", async () => {
    const { h, source } = await withSource(null);
    try {
      source.play();
      h.advance(5);

      expect(source.isPlaying).toBe(true);
    } finally {
      h.dispose();
    }
  });

  it("waits out a delayed play before it starts counting the clip down", async () => {
    const { h, source } = await withSource(0.5);
    try {
      source.play({ delay: 0.5 });

      h.advance(0.6);

      expect(source.isPlaying).toBe(true);

      h.advance(0.5);

      expect(source.isPlaying).toBe(false);
    } finally {
      h.dispose();
    }
  });

  it("respects a per-play duration shorter than the clip", async () => {
    const { h, source } = await withSource(0.5);
    try {
      source.play({ duration: 0.1 });

      h.advance(0.15);

      expect(source.isPlaying).toBe(false);
    } finally {
      h.dispose();
    }
  });
});

describe("AudioSource.maxInstances", () => {
  it("steals the oldest instance rather than refusing the newest, as Babylon Lite does", async () => {
    const { h, source } = await withSource(1);
    try {
      source.maxInstances = 2;
      h.step(1 / 60);

      source.play();
      h.advance(0.2);
      source.play();
      h.advance(0.2);
      source.play();

      expect(source.instanceCount).toBe(2);

      // The survivors are the two newest. The oldest was started 0.4 s ago and had 0.6 s left; if
      // it were still alive it would outlast the second, which has 0.8 s left.
      h.advance(0.85);

      expect(source.instanceCount).toBe(1);
    } finally {
      h.dispose();
    }
  });
});

describe("AudioSource.stop", () => {
  it("stops immediately with no fade", async () => {
    const { h, source } = await withSource();
    try {
      source.play();
      source.stop();

      expect(source.instanceCount).toBe(0);
    } finally {
      h.dispose();
    }
  });

  it("reaches silence after the fade and only then stops", async () => {
    const { h, source } = await withSource(5);
    try {
      const instance = source.play();
      source.stop(1);

      expect(instance?.volume).toBe(1);

      h.advance(0.5);

      expect(instance?.volume).toBeCloseTo(0.5, 1);
      expect(source.isPlaying).toBe(true);

      h.advance(0.6);

      expect(instance?.volume).toBe(0);
      expect(source.isPlaying).toBe(false);
    } finally {
      h.dispose();
    }
  });

  it("raises onEnded once the fade has run out", async () => {
    const { h, source } = await withSource(5);
    try {
      let ended = 0;
      source.onEnded.connect(() => {
        ended += 1;
      });
      source.play();
      source.stop(0.5);
      h.advance(0.6);

      expect(ended).toBe(1);
    } finally {
      h.dispose();
    }
  });
});

describe("AudioSource pausing", () => {
  it("keeps the instance alive while paused and resumes where it left off", async () => {
    const { h, source } = await withSource(0.5);
    try {
      let ended = 0;
      source.onEnded.connect(() => {
        ended += 1;
      });
      source.play();
      h.advance(0.2);
      source.pause();

      expect(source.instance?.isPaused).toBe(true);
      expect(source.isPlaying).toBe(false);

      h.advance(2);

      expect(ended).toBe(0);
      expect(source.instanceCount).toBe(1);

      source.resume();
      h.advance(0.2);

      expect(ended).toBe(0);

      h.advance(0.2);

      expect(ended).toBe(1);
    } finally {
      h.dispose();
    }
  });

  it("stops everything when the component is disabled", async () => {
    const { h, source } = await withSource(5);
    try {
      source.play();
      source.enabled = false;
      h.step(1 / 60);

      expect(source.instanceCount).toBe(0);
    } finally {
      h.dispose();
    }
  });
});

describe("AudioSource field reconciliation", () => {
  it("pushes a volume change to the running sound", async () => {
    const { h, source } = await withSource(5);
    try {
      source.play();
      source.volume = 0.25;
      h.step(1 / 60);

      expect(source.instance?.volume).toBe(0.25);
      expect(h.backend.sounds[0]?.volume).toBe(0.25);
    } finally {
      h.dispose();
    }
  });

  it("pushes a pan change to a non-spatial sound", async () => {
    const { h, source } = await withSource(5);
    try {
      source.play();
      source.pan = -0.5;
      h.step(1 / 60);

      expect(h.backend.sounds[0]?.pan).toBe(-0.5);
    } finally {
      h.dispose();
    }
  });

  it("leaves a fade alone: only a change to the field itself overwrites it", async () => {
    const { h, source } = await withSource(5);
    try {
      const instance = source.play();
      instance?.setVolume(0, 1);
      h.advance(0.5);

      expect(instance?.volume).toBeCloseTo(0.5, 1);
    } finally {
      h.dispose();
    }
  });

  it("rebuilds the voice when the bus changes, because a Web Audio route is fixed at creation", async () => {
    const { h, source } = await withSource(5);
    try {
      const first = source.play();
      source.bus = "UI";
      h.step(1 / 60);

      expect(source.instance).toBeNull();

      const second = source.play();

      expect(second).not.toBe(first);
      expect(second?.bus?.name).toBe("UI");
    } finally {
      h.dispose();
    }
  });

  it("rebuilds the voice when the clip, loop, maxInstances, or spatial flag changes", async () => {
    const { h, source } = await withSource(5);
    try {
      source.play();
      source.loop = true;
      h.step(1 / 60);

      expect(source.instance).toBeNull();

      source.play();
      source.maxInstances = 3;
      h.step(1 / 60);

      expect(source.instance).toBeNull();

      source.play();
      source.clip = makeClip(h.app, "sfx/other.wav", { duration: 1 });
      h.step(1 / 60);

      expect(source.instance).toBeNull();
    } finally {
      h.dispose();
    }
  });
});

describe("a spatial AudioSource", () => {
  it("converts the cone angles from degrees to radians for Babylon Lite", async () => {
    const { h, source } = await withSource(5);
    try {
      source.spatial = true;
      source.minDistance = 2;
      source.maxDistance = 80;
      source.rolloff = 1.5;
      source.distanceModel = "exponential";
      source.cone.innerAngle = 90;
      source.cone.outerAngle = 180;
      source.cone.outerVolume = 0.2;
      h.step(1 / 60);
      source.play();

      const spatial = h.backend.sounds.at(-1)?.spatial;

      expect(spatial).not.toBeNull();
      expect(spatial?.minDistance).toBe(2);
      expect(spatial?.maxDistance).toBe(80);
      expect(spatial?.rolloffFactor).toBe(1.5);
      expect(spatial?.distanceModel).toBe("exponential");
      expect(spatial?.coneInnerAngleRadians).toBeCloseTo(Math.PI / 2, 9);
      expect(spatial?.coneOuterAngleRadians).toBeCloseTo(Math.PI, 9);
      expect(spatial?.coneOuterVolume).toBe(0.2);
    } finally {
      h.dispose();
    }
  });

  it("attaches to the entity's own Lite node, so the sound follows the transform", async () => {
    const { h, entity, source } = await withSource(5);
    try {
      source.spatial = true;
      h.step(1 / 60);
      source.play();

      expect(h.backend.sounds.at(-1)?.spatial?.attachedTo).toBe(entity.transform.lite);
    } finally {
      h.dispose();
    }
  });

  it("logs IGX-1002 once when it plays with no listener enabled", async () => {
    const { h, source } = await withSource(5);
    try {
      source.spatial = true;
      h.step(1 / 60);
      source.play();
      source.stop();
      source.bus = "Music";
      h.step(1 / 60);
      source.play();

      const warnings = h.sink.toArray().filter((record) => record.message.includes("IGX-1002"));

      expect(warnings).toHaveLength(1);
    } finally {
      h.dispose();
    }
  });

  it("says nothing when a listener is enabled", async () => {
    const { h, source } = await withSource(5);
    try {
      h.world.createEntity("Ears").addComponent(AudioListener);
      h.step(1 / 60);
      source.spatial = true;
      h.step(1 / 60);
      source.play();

      expect(h.sink.toArray().some((record) => record.message.includes("IGX-1002"))).toBe(false);
    } finally {
      h.dispose();
    }
  });
});

describe("AudioSource.playOneShot", () => {
  it("plays another clip through this source's bus without disturbing it", async () => {
    const { h, source } = await withSource(5);
    try {
      source.bus = "UI";
      h.step(1 / 60);
      const other = makeClip(h.app, "sfx/click.wav", { duration: 0.2 }).value;

      const instance = source.playOneShot(other, { volume: 0.5 });

      expect(instance.clip).toBe(other);
      expect(instance.bus?.name).toBe("UI");
      expect(source.isPlaying).toBe(false);
    } finally {
      h.dispose();
    }
  });
});
