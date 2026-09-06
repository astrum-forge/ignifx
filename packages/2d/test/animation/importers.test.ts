import { isIgnifxError } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { defineSpriteAnimation, SPRITE_ANIMATION_FORMAT } from "../../src/animation/definition.js";
import { importAsepriteAnimations } from "../../src/animation/importers.js";
import { importAsepriteAtlas } from "../../src/atlas/importers.js";

/** Runs `run` and returns the `IGX-####` code it threw, or `null` when it did not throw one. */
function codeOf(run: () => unknown): string | null {
  try {
    run();
  } catch (error) {
    return isIgnifxError(error) ? error.code : null;
  }
  return null;
}

/** Builds a hash-layout `frames` collection of `count` uniformly timed frames. */
function uniformFrames(count: number, duration: number): Record<string, unknown> {
  const frames: Record<string, unknown> = {};
  for (let index = 0; index < count; index += 1) {
    frames[`hero ${String(index)}.aseprite`] = {
      frame: { x: index * 16, y: 0, w: 16, h: 16 },
      duration,
    };
  }
  return frames;
}

/** Builds a document with one tag over three frames. */
function documentWithTag(tag: Record<string, unknown>, duration = 100): Record<string, unknown> {
  return {
    frames: uniformFrames(3, duration),
    meta: { image: "hero.png", size: { w: 48, h: 16 }, frameTags: [tag] },
  };
}

describe("importAsepriteAnimations", () => {
  it("turns a forward tag into a clip listing its frame names in order", () => {
    const animations = importAsepriteAnimations(
      documentWithTag({ name: "idle", from: 0, to: 2, direction: "forward" }),
    );

    expect(animations.format).toBe(SPRITE_ANIMATION_FORMAT);
    expect(animations.clips).toHaveLength(1);
    expect(animations.clips[0]?.name).toBe("idle");
    expect(animations.clips[0]?.frames).toEqual(["hero_0", "hero_1", "hero_2"]);
  });

  it("treats an unrecognised direction as forward", () => {
    const animations = importAsepriteAnimations(documentWithTag({ name: "idle", from: 0, to: 2 }));

    expect(animations.clips[0]?.frames).toEqual(["hero_0", "hero_1", "hero_2"]);
  });

  it("reverses a reverse tag", () => {
    const animations = importAsepriteAnimations(
      documentWithTag({ name: "back", from: 0, to: 2, direction: "reverse" }),
    );

    expect(animations.clips[0]?.frames).toEqual(["hero_2", "hero_1", "hero_0"]);
  });

  it("appends the interior frames in reverse for a pingpong tag", () => {
    const animations = importAsepriteAnimations(
      documentWithTag({ name: "bob", from: 0, to: 2, direction: "pingpong" }),
    );

    expect(animations.clips[0]?.frames).toEqual(["hero_0", "hero_1", "hero_2", "hero_1"]);
  });

  it("leaves a one-frame and a two-frame pingpong tag alone", () => {
    const one = importAsepriteAnimations(documentWithTag({ name: "a", from: 1, to: 1, direction: "pingpong" }));
    const two = importAsepriteAnimations(documentWithTag({ name: "b", from: 0, to: 1, direction: "pingpong" }));

    expect(one.clips[0]?.frames).toEqual(["hero_1"]);
    expect(two.clips[0]?.frames).toEqual(["hero_0", "hero_1"]);
  });

  it("derives an exact fps from uniform frame durations", () => {
    const animations = importAsepriteAnimations(documentWithTag({ name: "idle", from: 0, to: 2 }, 100));

    expect(animations.clips[0]?.fps).toBe(10);
  });

  it("approximates uneven frame durations by their mean, to three decimals", () => {
    const animations = importAsepriteAnimations({
      frames: {
        "hero 0.aseprite": { frame: { x: 0, y: 0, w: 16, h: 16 }, duration: 100 },
        "hero 1.aseprite": { frame: { x: 16, y: 0, w: 16, h: 16 }, duration: 200 },
      },
      meta: { image: "hero.png", frameTags: [{ name: "idle", from: 0, to: 1 }] },
    });

    // mean 150 ms -> 1000 / 150 = 6.6666..., rounded to 6.667.
    expect(animations.clips[0]?.fps).toBe(6.667);
  });

  it("falls back to the default fps when no duration is usable", () => {
    const missing = importAsepriteAnimations({
      frames: { "hero 0.aseprite": { frame: { x: 0, y: 0, w: 16, h: 16 } } },
      meta: { image: "hero.png", frameTags: [{ name: "idle", from: 0, to: 0 }] },
    });
    const zeroed = importAsepriteAnimations(documentWithTag({ name: "idle", from: 0, to: 2 }, 0), { defaultFps: 24 });

    expect(missing.clips[0]?.fps).toBe(12);
    expect(zeroed.clips[0]?.fps).toBe(24);
  });

  it("loops every tag except one Aseprite marked as playing once", () => {
    const looping = importAsepriteAnimations(documentWithTag({ name: "idle", from: 0, to: 2 }));
    const once = importAsepriteAnimations(documentWithTag({ name: "die", from: 0, to: 2, repeat: "1" }));
    const thrice = importAsepriteAnimations(documentWithTag({ name: "blink", from: 0, to: 2, repeat: "3" }));

    expect(looping.clips[0]?.loop).toBe(true);
    expect(once.clips[0]?.loop).toBe(false);
    expect(thrice.clips[0]?.loop).toBe(true);
  });

  it("emits no events, because Aseprite has no frame-event concept", () => {
    const animations = importAsepriteAnimations(documentWithTag({ name: "idle", from: 0, to: 2 }));

    expect(animations.clips[0]?.events).toBeUndefined();
    expect(Object.hasOwn(animations.clips[0] ?? {}, "events")).toBe(false);
  });

  it("carries the atlas address through, and defaults it to the renderer's own atlas", () => {
    const named = importAsepriteAnimations(documentWithTag({ name: "idle", from: 0, to: 2 }), {
      atlas: "2d/hero.atlas.json",
    });
    const bare = importAsepriteAnimations(documentWithTag({ name: "idle", from: 0, to: 2 }));

    expect(named.atlas).toBe("2d/hero.atlas.json");
    expect(bare.atlas).toBe("");
  });

  it("reads the array frame layout as well as the hash layout", () => {
    const animations = importAsepriteAnimations({
      frames: [
        { filename: "hero 0.aseprite", frame: { x: 0, y: 0, w: 16, h: 16 }, duration: 50 },
        { filename: "hero 1.aseprite", frame: { x: 16, y: 0, w: 16, h: 16 }, duration: 50 },
      ],
      meta: { image: "hero.png", frameTags: [{ name: "idle", from: 0, to: 1 }] },
    });

    expect(animations.clips[0]?.frames).toEqual(["hero_0", "hero_1"]);
    expect(animations.clips[0]?.fps).toBe(20);
  });

  it("lets a caller override how frames are named", () => {
    const animations = importAsepriteAnimations(documentWithTag({ name: "idle", from: 0, to: 1 }), {
      frameNameOf: (index) => `custom_${String(index)}`,
    });

    expect(animations.clips[0]?.frames).toEqual(["custom_0", "custom_1"]);
  });

  it("names a frame positionally when the tag runs past the document's frames", () => {
    const animations = importAsepriteAnimations({
      frames: { "hero 0.aseprite": { frame: { x: 0, y: 0, w: 16, h: 16 }, duration: 100 } },
      meta: { image: "hero.png", frameTags: [{ name: "idle", from: 0, to: 1 }] },
    });

    expect(animations.clips[0]?.frames).toEqual(["hero_0", "frame_1"]);
  });

  it("clamps a tag whose range runs backwards or below zero to a single frame", () => {
    const animations = importAsepriteAnimations(documentWithTag({ name: "idle", from: -3, to: -9 }));

    expect(animations.clips[0]?.frames).toEqual(["hero_0"]);
  });

  it("produces a document defineSpriteAnimation accepts unchanged", () => {
    const animations = importAsepriteAnimations(documentWithTag({ name: "idle", from: 0, to: 2 }), {
      atlas: "2d/hero.atlas.json",
    });

    expect(defineSpriteAnimation(animations)).toEqual(animations);
  });

  it("rejects a document with no frame tags", () => {
    expect(codeOf(() => importAsepriteAnimations(7))).toBe("IGX-1109");
    expect(codeOf(() => importAsepriteAnimations({ frames: uniformFrames(1, 100) }))).toBe("IGX-1109");
    expect(codeOf(() => importAsepriteAnimations({ frames: uniformFrames(1, 100), meta: {} }))).toBe("IGX-1109");
    expect(codeOf(() => importAsepriteAnimations({ frames: uniformFrames(1, 100), meta: { frameTags: [] } }))).toBe(
      "IGX-1109",
    );
    expect(codeOf(() => importAsepriteAnimations({ frames: uniformFrames(1, 100), meta: { frameTags: 3 } }))).toBe(
      "IGX-1109",
    );
  });

  it("says what was expected when the tags are missing", () => {
    let message = "";
    try {
      importAsepriteAnimations({ frames: uniformFrames(1, 100), meta: {} });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toContain("meta.frameTags");
  });

  it("rejects a malformed tag", () => {
    expect(codeOf(() => importAsepriteAnimations(documentWithTag({ from: 0, to: 1 })))).toBe("IGX-1109");
    expect(codeOf(() => importAsepriteAnimations(documentWithTag({ name: "", from: 0, to: 1 })))).toBe("IGX-1109");
    expect(
      codeOf(() =>
        importAsepriteAnimations({ frames: uniformFrames(1, 100), meta: { image: "a.png", frameTags: [5] } }),
      ),
    ).toBe("IGX-1109");
  });

  it("rejects a document with neither readable frames nor a frame namer", () => {
    expect(codeOf(() => importAsepriteAnimations({ meta: { frameTags: [{ name: "idle", from: 0, to: 1 }] } }))).toBe(
      "IGX-1109",
    );
  });

  it("still imports when frames are unreadable but the caller names them", () => {
    const animations = importAsepriteAnimations(
      { meta: { frameTags: [{ name: "idle", from: 0, to: 1 }] } },
      { frameNameOf: (index) => `hero_${String(index)}`, defaultFps: 8 },
    );

    expect(animations.clips[0]?.frames).toEqual(["hero_0", "hero_1"]);
    expect(animations.clips[0]?.fps).toBe(8);
  });

  it("skips frame entries that are not objects", () => {
    const animations = importAsepriteAnimations({
      frames: [7, { filename: "hero 1.aseprite", frame: { x: 0, y: 0, w: 8, h: 8 }, duration: 100 }],
      meta: { frameTags: [{ name: "idle", from: 0, to: 0 }] },
    });

    expect(animations.clips[0]?.frames).toEqual(["hero_1"]);
  });
});

describe("an Aseprite atlas and its animations", () => {
  const document = {
    frames: {
      "hero (idle) 0.aseprite": { frame: { x: 0, y: 0, w: 16, h: 16 }, duration: 80 },
      "hero (idle) 1.aseprite": { frame: { x: 16, y: 0, w: 16, h: 16 }, duration: 80 },
      "hero (run) 0.aseprite": { frame: { x: 32, y: 0, w: 16, h: 16 }, duration: 40 },
      "hero (run) 1.aseprite": { frame: { x: 48, y: 0, w: 16, h: 16 }, duration: 40 },
    },
    meta: {
      image: "hero.png",
      size: { w: 64, h: 16 },
      frameTags: [
        { name: "idle", from: 0, to: 1, direction: "forward" },
        { name: "run", from: 2, to: 3, direction: "pingpong" },
      ],
    },
  };

  it("agree on every frame name", () => {
    const atlas = importAsepriteAtlas(document, { sampling: "nearest" });
    const animations = importAsepriteAnimations(document, { atlas: "2d/hero.atlas.json" });
    const known = new Set(atlas.frames.map((frame) => frame.name));

    expect(known).toEqual(new Set(["hero_idle_0", "hero_idle_1", "hero_run_0", "hero_run_1"]));
    for (const clip of animations.clips) {
      for (const name of clip.frames ?? []) {
        expect(known.has(name)).toBe(true);
      }
    }
  });

  it("keeps each tag's own rate", () => {
    const animations = importAsepriteAnimations(document);

    expect(animations.clips.map((clip) => clip.fps)).toEqual([12.5, 25]);
  });
});
