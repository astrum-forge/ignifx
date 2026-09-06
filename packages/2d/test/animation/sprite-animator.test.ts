import { afterEach, describe, expect, it } from "vitest";
import { SpriteAnimator } from "../../src/animation/sprite-animator.js";
import { SpriteRenderer } from "../../src/sprite/sprite-renderer.js";
import { createTwoDApp, fixtureFiles } from "../support/app.js";
import type { SpriteAnimationAsset } from "../../src/animation/sprite-animation-asset.js";
import type { SpriteAtlasAsset } from "../../src/atlas/sprite-atlas-asset.js";
import type { TwoDAppHarness } from "../support/app.js";

/**
 * `SpriteAnimator` on ignifx's own clock (`docs/architecture/11-2d-toolkit.md` §2.4, ADR-0003).
 *
 * The whole point of not using Lite's `SpriteAnimationManager` is that `timeScale`, `pause()` and
 * frame events behave for a 2D character exactly as they do for a 3D one — and that the result is
 * deterministic under `app.step`, which is what this suite leans on.
 *
 * The fixture declares `idle` (idle_0, idle_1 at 2 fps, looping) and `run` (run_0 to run_1 at
 * 4 fps, not looping, with a `footstep` event on clip frame 1).
 */

let harness: TwoDAppHarness | null = null;

afterEach(() => {
  harness?.dispose();
  harness = null;
});

/** One sixtieth of a second, the slice {@link Rig.advance} steps in. */
const FRAME = 1 / 60;

/** An entity carrying a loaded sprite and animator, ready to step. */
interface Rig {
  readonly sprite: SpriteRenderer;
  readonly animator: SpriteAnimator;
  /** Runs one frame. */
  readonly step: (deltaSeconds?: number) => void;
  /**
   * Runs enough frames to cover `seconds` of scaled time.
   *
   * The frame loop clamps a raw delta to `time.maximumDeltaTime`, which defaults to 0.1 s
   * (`docs/architecture/01-lifecycle-and-time.md` §2), so a single `step(0.5)` would deliver only
   * 0.1 s to `PostUpdate`. Stepping in real frame slices is both accurate and what a game does.
   */
  readonly advance: (seconds: number) => void;
}

/** Builds the hero rig off the checked-in fixtures. */
async function createRig(options?: {
  readonly playOnAwake?: boolean;
  readonly maximumDeltaTime?: number;
}): Promise<Rig> {
  const created = await createTwoDApp({
    files: fixtureFiles(),
    ...(options?.maximumDeltaTime === undefined
      ? {}
      : { settings: { time: { maximumDeltaTime: options.maximumDeltaTime } } }),
  });
  harness = created;
  const atlas = await created.load<SpriteAtlasAsset>("2d/hero.atlas.json");
  const clips = await created.load<SpriteAnimationAsset>("2d/hero.spriteanim.json");
  const entity = created.app.world.createEntity("hero");
  const sprite = entity.addComponent(SpriteRenderer);
  sprite.sprite = atlas.retain();
  const animator = entity.addComponent(SpriteAnimator);
  animator.animations = clips.retain();
  if (options?.playOnAwake === false) {
    animator.playOnAwake = false;
  }
  const advance = (seconds: number): void => {
    const frames = Math.round(seconds / FRAME);
    for (let index = 0; index < frames; index += 1) {
      created.step(FRAME);
    }
  };
  return { sprite, animator, step: created.step, advance };
}

describe("the document", () => {
  it("resolves its clips against the atlas", async () => {
    const rig = await createRig();
    const asset = rig.animator.asset;
    expect(asset?.clipNames()).toEqual(["idle", "run"]);
    expect(asset?.defaultClipName).toBe("idle");
    expect(asset?.atlasAddress).toBe("2d/hero.atlas.json");
    const atlas = rig.sprite.atlas;
    expect(atlas).not.toBeNull();
    if (atlas !== null && asset !== null) {
      const idle = asset.requireClip("idle", atlas);
      expect(idle.frames).toEqual([0, 1]);
      expect(idle.fps).toBe(2);
      expect(idle.loop).toBe(true);
      expect(idle.durationSeconds).toBe(1);
      const run = asset.requireClip("run", atlas);
      expect(run.frames).toEqual([2, 3]);
      expect(run.loop).toBe(false);
      expect(run.events).toEqual([{ frame: 1, name: "footstep" }]);
    }
  });

  it("caches the resolution against the atlas it was resolved with", async () => {
    const rig = await createRig();
    const asset = rig.animator.asset;
    const atlas = rig.sprite.atlas;
    if (asset !== null && atlas !== null) {
      expect(asset.resolve(atlas)).toBe(asset.resolve(atlas));
    }
  });
});

describe("playback", () => {
  it("starts the default clip once both assets have arrived", async () => {
    const rig = await createRig();
    rig.step();
    expect(rig.animator.isPlaying).toBe(true);
    expect(rig.animator.clip?.name).toBe("idle");
    expect(rig.sprite.frame).toBe(0);
  });

  it("stays still when playOnAwake is off", async () => {
    const rig = await createRig({ playOnAwake: false });
    rig.step();
    expect(rig.animator.isPlaying).toBe(false);
    expect(rig.animator.frame).toBe(-1);
  });

  it("advances one frame per half second at 2 fps", async () => {
    const rig = await createRig();
    rig.step();
    expect(rig.sprite.frame).toBe(0);
    rig.advance(0.5);
    expect(rig.sprite.frame).toBe(1);
    rig.advance(0.5);
    // Two frames at 2 fps is one second: the loop wraps back to the first.
    expect(rig.sprite.frame).toBe(0);
  });

  it("multiplies the rate by speed", async () => {
    const rig = await createRig();
    rig.step();
    rig.animator.speed = 2;
    rig.advance(0.25);
    expect(rig.sprite.frame).toBe(1);
  });

  it("does not advance at speed zero", async () => {
    const rig = await createRig();
    rig.step();
    rig.animator.speed = 0;
    rig.advance(10);
    expect(rig.sprite.frame).toBe(0);
  });

  it("follows time.timeScale", async () => {
    const rig = await createRig();
    rig.step();
    if (harness !== null) {
      harness.app.time.timeScale = 0.5;
    }
    rig.advance(0.5);
    // Half a second of real time is a quarter second of scaled time: not yet a frame.
    expect(rig.sprite.frame).toBe(0);
    rig.advance(0.5);
    expect(rig.sprite.frame).toBe(1);
  });

  it("freezes while the app is paused", async () => {
    const rig = await createRig();
    rig.step();
    harness?.app.pause();
    // Not a whole number of clip periods: 5 s at 2 fps over a 10-frame clip landed back on frame 0
    // and hid the fact that the animation was advancing under the pause (found in Phase 7).
    rig.advance(0.75);
    expect(rig.sprite.frame).toBe(0);
    rig.advance(5);
    expect(rig.sprite.frame).toBe(0);
    harness?.app.resume();
    rig.advance(0.5);
    expect(rig.sprite.frame).toBe(1);
  });
});

describe("transport", () => {
  it("rewinds on stop and continues on resume after pause", async () => {
    const rig = await createRig();
    rig.step();
    rig.advance(0.5);
    expect(rig.sprite.frame).toBe(1);
    rig.animator.pause();
    expect(rig.animator.isPlaying).toBe(false);
    rig.advance(5);
    expect(rig.sprite.frame).toBe(1);
    rig.animator.resume();
    expect(rig.animator.isPlaying).toBe(true);
    rig.animator.stop();
    expect(rig.animator.isPlaying).toBe(false);
    expect(rig.sprite.frame).toBe(0);
    expect(rig.animator.time).toBe(0);
  });

  it("switches clips and only rewinds when asked", async () => {
    const rig = await createRig();
    rig.step();
    rig.animator.play("run");
    expect(rig.animator.clip?.name).toBe("run");
    expect(rig.sprite.frame).toBe(2);
    rig.advance(0.3);
    const advanced = rig.sprite.frame;
    rig.animator.play("run");
    expect(rig.sprite.frame).toBe(advanced);
    rig.animator.play("run", { restart: true });
    expect(rig.sprite.frame).toBe(2);
    expect(rig.animator.time).toBe(0);
  });

  it("refuses a clip the document does not declare", async () => {
    const rig = await createRig();
    rig.step();
    let captured: unknown = null;
    try {
      rig.animator.play("nope");
    } catch (error) {
      captured = error;
    }
    expect((captured as { readonly code?: string }).code).toBe("IGX-1108");
  });
});

describe("signals", () => {
  it("ends a non-looping clip exactly once and stops", async () => {
    const rig = await createRig();
    rig.step();
    const ended: string[] = [];
    rig.animator.onClipEnded.connect((name) => ended.push(name));
    rig.animator.play("run");
    rig.advance(1);
    rig.advance(1);
    expect(ended).toEqual(["run"]);
    expect(rig.animator.isPlaying).toBe(false);
    expect(rig.sprite.frame).toBe(3);
  });

  it("fires a frame event once per pass", async () => {
    const rig = await createRig();
    rig.step();
    const events: string[] = [];
    rig.animator.onEvent.connect((name) => events.push(name));
    rig.animator.play("run");
    // 4 fps: a quarter second per frame. Step comfortably onto clip frame 1, which carries the
    // event — comfortably, because summing 1/60 slices lands a hair under an exact quarter second.
    rig.advance(0.3);
    expect(events).toEqual(["footstep"]);
    rig.advance(0.3);
    // `run` does not loop, so it has ended: no second pass, and no repeat of the event.
    expect(events).toEqual(["footstep"]);
  });

  it("fires every event a long step skipped over", async () => {
    // A genuinely long single frame, which needs the delta clamp lifted.
    const rig = await createRig({ maximumDeltaTime: 60 });
    rig.step();
    const events: string[] = [];
    rig.animator.onEvent.connect((name) => events.push(name));
    rig.animator.play("run");
    // One step straight past the end of the clip still has to pass frame 1.
    rig.step(10);

    expect(events).toEqual(["footstep"]);
  });
});

describe("degenerate rigs", () => {
  it("is a harmless no-op without a SpriteRenderer sibling", async () => {
    const created = await createTwoDApp({ files: fixtureFiles() });
    harness = created;
    const clips = await created.load<SpriteAnimationAsset>("2d/hero.spriteanim.json");
    const animator = created.app.world.createEntity("lonely").addComponent(SpriteAnimator);
    animator.animations = clips.retain();
    expect(() => {
      created.step();
      created.step(FRAME);
    }).not.toThrow();
    expect(animator.isPlaying).toBe(false);
  });

  it("remembers a play() issued before the document arrived", async () => {
    const created = await createTwoDApp({ files: fixtureFiles() });
    harness = created;
    const entity = created.app.world.createEntity("hero");
    const sprite = entity.addComponent(SpriteRenderer);
    const animator = entity.addComponent(SpriteAnimator);
    animator.play("run");
    expect(animator.isPlaying).toBe(false);
    sprite.sprite = (await created.load<SpriteAtlasAsset>("2d/hero.atlas.json")).retain();
    animator.animations = (await created.load<SpriteAnimationAsset>("2d/hero.spriteanim.json")).retain();
    created.step();
    expect(animator.clip?.name).toBe("run");
  });
});
