import { isIgnifxError } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { SPRITE_ATLAS_FORMAT } from "../../src/atlas/definition.js";
import {
  asepriteFrameName,
  gridAtlas,
  importAsepriteAtlas,
  importTexturePackerAtlas,
} from "../../src/atlas/importers.js";

/** Runs `run` and returns the `IGX-####` code it threw, or `null` when it did not throw one. */
function codeOf(run: () => unknown): string | null {
  try {
    run();
  } catch (error) {
    return isIgnifxError(error) ? error.code : null;
  }
  return null;
}

/** The corner of every frame, as `"x,y"`, so reading order is one readable assertion. */
function corners(frames: readonly { readonly x: number; readonly y: number }[]): string[] {
  return frames.map((frame) => `${String(frame.x)},${String(frame.y)}`);
}

describe("gridAtlas", () => {
  it("cuts a 64x64 sheet of 32x32 cells into four frames in reading order", () => {
    const atlas = gridAtlas({
      image: "2d/terrain.png",
      imageWidth: 64,
      imageHeight: 64,
      cellWidth: 32,
      cellHeight: 32,
    });

    expect(atlas.format).toBe(SPRITE_ATLAS_FORMAT);
    expect(atlas.image).toBe("2d/terrain.png");
    expect(atlas.frames).toHaveLength(4);
    expect(atlas.frames.map((frame) => frame.name)).toEqual(["tile_0", "tile_1", "tile_2", "tile_3"]);
    expect(corners(atlas.frames)).toEqual(["0,0", "32,0", "0,32", "32,32"]);
    expect(atlas.frames.every((frame) => frame.w === 32 && frame.h === 32)).toBe(true);
  });

  it("defaults every frame to a centre pivot and the linear sampler", () => {
    const atlas = gridAtlas({ image: "a.png", imageWidth: 32, imageHeight: 32, cellWidth: 32, cellHeight: 32 });

    expect(atlas.frames[0]?.pivot).toEqual({ x: 0.5, y: 0.5 });
    expect(atlas.sampling).toBe("linear");
    expect(atlas.premultipliedAlpha).toBe(false);
  });

  it("carries the sampling, premultiplied and pivot options through", () => {
    const atlas = gridAtlas({
      image: "a.png",
      imageWidth: 32,
      imageHeight: 32,
      cellWidth: 32,
      cellHeight: 32,
      pivot: { x: 0.5, y: 1 },
      sampling: "nearest",
      premultipliedAlpha: true,
    });

    expect(atlas.frames[0]?.pivot).toEqual({ x: 0.5, y: 1 });
    expect(atlas.sampling).toBe("nearest");
    expect(atlas.premultipliedAlpha).toBe(true);
  });

  it("shifts every rectangle by the margin", () => {
    const atlas = gridAtlas({
      image: "a.png",
      imageWidth: 68,
      imageHeight: 68,
      cellWidth: 32,
      cellHeight: 32,
      margin: 2,
    });

    expect(atlas.frames).toHaveLength(4);
    expect(corners(atlas.frames)).toEqual(["2,2", "34,2", "2,34", "34,34"]);
  });

  it("puts the spacing between adjacent cells but not around the sheet", () => {
    const atlas = gridAtlas({
      image: "a.png",
      imageWidth: 66,
      imageHeight: 66,
      cellWidth: 32,
      cellHeight: 32,
      spacing: 2,
    });

    expect(atlas.frames).toHaveLength(4);
    expect(corners(atlas.frames)).toEqual(["0,0", "34,0", "0,34", "34,34"]);
  });

  it("honours an explicit column and row count smaller than the sheet holds", () => {
    const atlas = gridAtlas({
      image: "a.png",
      imageWidth: 64,
      imageHeight: 64,
      cellWidth: 32,
      cellHeight: 32,
      columns: 1,
      rows: 1,
    });

    expect(atlas.frames.map((frame) => frame.name)).toEqual(["tile_0"]);
  });

  it("clamps an explicit count larger than the sheet holds", () => {
    const atlas = gridAtlas({
      image: "a.png",
      imageWidth: 64,
      imageHeight: 64,
      cellWidth: 32,
      cellHeight: 32,
      columns: 10,
      rows: 10,
    });

    expect(atlas.frames).toHaveLength(4);
  });

  it("renames frames with the prefix a Tiled tileset would use", () => {
    const atlas = gridAtlas({
      image: "a.png",
      imageWidth: 64,
      imageHeight: 32,
      cellWidth: 32,
      cellHeight: 32,
      namePrefix: "terrain",
    });

    expect(atlas.frames.map((frame) => frame.name)).toEqual(["terrain_0", "terrain_1"]);
  });

  it("rejects a non-positive cell size", () => {
    expect(
      codeOf(() => gridAtlas({ image: "a.png", imageWidth: 64, imageHeight: 64, cellWidth: 0, cellHeight: 32 })),
    ).toBe("IGX-1109");
    expect(
      codeOf(() => gridAtlas({ image: "a.png", imageWidth: 64, imageHeight: 64, cellWidth: 32, cellHeight: -1 })),
    ).toBe("IGX-1109");
  });

  it("rejects a geometry that yields no frames", () => {
    expect(
      codeOf(() => gridAtlas({ image: "a.png", imageWidth: 16, imageHeight: 16, cellWidth: 32, cellHeight: 32 })),
    ).toBe("IGX-1109");
    expect(
      codeOf(() =>
        gridAtlas({ image: "a.png", imageWidth: 64, imageHeight: 64, cellWidth: 32, cellHeight: 32, columns: 0 }),
      ),
    ).toBe("IGX-1109");
  });
});

/** The two frames every TexturePacker test shares, in the hash layout's shape. */
const TEXTURE_PACKER_ENTRIES = {
  "hero_0.png": {
    frame: { x: 0, y: 0, w: 32, h: 48 },
    rotated: false,
    trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: 32, h: 48 },
    sourceSize: { w: 32, h: 48 },
  },
  "hero_1.png": {
    frame: { x: 32, y: 0, w: 30, h: 44 },
    rotated: false,
    trimmed: true,
    spriteSourceSize: { x: 1, y: 2, w: 30, h: 44 },
    sourceSize: { w: 32, h: 48 },
  },
} as const;

/** The shared `meta` block. */
const TEXTURE_PACKER_META = { image: "hero.png", size: { w: 64, h: 48 }, scale: "1" } as const;

describe("importTexturePackerAtlas", () => {
  it("reads the hash layout", () => {
    const atlas = importTexturePackerAtlas({ frames: TEXTURE_PACKER_ENTRIES, meta: TEXTURE_PACKER_META });

    expect(atlas.image).toBe("hero.png");
    expect(atlas.frames.map((frame) => frame.name)).toEqual(["hero_0", "hero_1"]);
    expect(atlas.frames[0]).toEqual({ name: "hero_0", x: 0, y: 0, w: 32, h: 48, pivot: { x: 0.5, y: 0.5 } });
  });

  it("produces identical output from the array layout", () => {
    const hash = importTexturePackerAtlas({ frames: TEXTURE_PACKER_ENTRIES, meta: TEXTURE_PACKER_META });
    const array = importTexturePackerAtlas({
      frames: [
        { filename: "hero_0.png", ...TEXTURE_PACKER_ENTRIES["hero_0.png"] },
        { filename: "hero_1.png", ...TEXTURE_PACKER_ENTRIES["hero_1.png"] },
      ],
      meta: TEXTURE_PACKER_META,
    });

    expect(array).toEqual(hash);
  });

  it("keeps the file extension when asked", () => {
    const atlas = importTexturePackerAtlas(
      { frames: TEXTURE_PACKER_ENTRIES, meta: TEXTURE_PACKER_META },
      { keepExtensions: true },
    );

    expect(atlas.frames.map((frame) => frame.name)).toEqual(["hero_0.png", "hero_1.png"]);
  });

  it("carries the untrimmed source size of a trimmed frame", () => {
    const atlas = importTexturePackerAtlas({ frames: TEXTURE_PACKER_ENTRIES, meta: TEXTURE_PACKER_META });

    expect(atlas.frames[0]?.sourceSize).toBeUndefined();
    expect(atlas.frames[1]?.sourceSize).toEqual({ x: 32, y: 48 });
  });

  it("prefers a declared pivot over the centre default", () => {
    const atlas = importTexturePackerAtlas({
      frames: { "foot.png": { frame: { x: 0, y: 0, w: 8, h: 8 }, pivot: { x: 0.5, y: 1 } } },
      meta: TEXTURE_PACKER_META,
    });

    expect(atlas.frames[0]?.pivot).toEqual({ x: 0.5, y: 1 });
  });

  it("prefers an explicit image address over the document's own", () => {
    const atlas = importTexturePackerAtlas(
      { frames: TEXTURE_PACKER_ENTRIES, meta: TEXTURE_PACKER_META },
      { image: "2d/hero.png", sampling: "nearest", premultipliedAlpha: true },
    );

    expect(atlas.image).toBe("2d/hero.png");
    expect(atlas.sampling).toBe("nearest");
    expect(atlas.premultipliedAlpha).toBe(true);
  });

  it("rejects a rotated frame", () => {
    const code = codeOf(() =>
      importTexturePackerAtlas({
        frames: { "hero_0.png": { frame: { x: 0, y: 0, w: 32, h: 48 }, rotated: true } },
        meta: TEXTURE_PACKER_META,
      }),
    );

    expect(code).toBe("IGX-1109");
  });

  it("names the rotated frame and the remedy", () => {
    let message = "";
    try {
      importTexturePackerAtlas({
        frames: { "hero_0.png": { frame: { x: 0, y: 0, w: 32, h: 48 }, rotated: true } },
        meta: TEXTURE_PACKER_META,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }

    expect(message).toContain("hero_0.png");
    expect(message).toContain("rotated frames are not supported");
  });

  it("rejects a document that is not an object", () => {
    expect(codeOf(() => importTexturePackerAtlas("nope"))).toBe("IGX-1109");
    expect(codeOf(() => importTexturePackerAtlas(null))).toBe("IGX-1109");
  });

  it("rejects a frames field that is neither an object nor an array", () => {
    expect(codeOf(() => importTexturePackerAtlas({ frames: 42, meta: TEXTURE_PACKER_META }))).toBe("IGX-1109");
  });

  it("rejects an empty frames collection", () => {
    expect(codeOf(() => importTexturePackerAtlas({ frames: {}, meta: TEXTURE_PACKER_META }))).toBe("IGX-1109");
    expect(codeOf(() => importTexturePackerAtlas({ frames: [], meta: TEXTURE_PACKER_META }))).toBe("IGX-1109");
  });

  it("rejects a frame entry that is not an object", () => {
    expect(codeOf(() => importTexturePackerAtlas({ frames: [7], meta: TEXTURE_PACKER_META }))).toBe("IGX-1109");
    expect(codeOf(() => importTexturePackerAtlas({ frames: { a: 7 }, meta: TEXTURE_PACKER_META }))).toBe("IGX-1109");
  });

  it("rejects a frame with no rectangle", () => {
    expect(codeOf(() => importTexturePackerAtlas({ frames: { "a.png": {} }, meta: TEXTURE_PACKER_META }))).toBe(
      "IGX-1109",
    );
    expect(
      codeOf(() =>
        importTexturePackerAtlas({ frames: { "a.png": { frame: { x: 0, y: 0, w: "8" } } }, meta: TEXTURE_PACKER_META }),
      ),
    ).toBe("IGX-1109");
  });

  it("rejects a document that names no image", () => {
    expect(codeOf(() => importTexturePackerAtlas({ frames: TEXTURE_PACKER_ENTRIES }))).toBe("IGX-1109");
    expect(codeOf(() => importTexturePackerAtlas({ frames: TEXTURE_PACKER_ENTRIES, meta: { image: "" } }))).toBe(
      "IGX-1109",
    );
  });

  it("names an unnamed array entry positionally", () => {
    const atlas = importTexturePackerAtlas({
      frames: [{ frame: { x: 0, y: 0, w: 8, h: 8 } }],
      meta: TEXTURE_PACKER_META,
    });

    expect(atlas.frames[0]?.name).toBe("frame_0");
  });
});

describe("asepriteFrameName", () => {
  it("strips a file extension and collapses punctuation into single underscores", () => {
    expect(asepriteFrameName("hero (idle) 0.aseprite")).toBe("hero_idle_0");
    expect(asepriteFrameName("hero 0.aseprite")).toBe("hero_0");
    expect(asepriteFrameName("hero_0.png")).toBe("hero_0");
  });

  it("preserves case", () => {
    expect(asepriteFrameName("Hero (Idle) 0.aseprite")).toBe("Hero_Idle_0");
  });

  it("keeps a suffix that is not a plausible extension", () => {
    expect(asepriteFrameName("walk.2")).toBe("walk_2");
  });

  it("falls back to `frame` when nothing usable survives", () => {
    expect(asepriteFrameName("###.png")).toBe("frame");
  });
});

/** A two-frame Aseprite export with a tagged, sliced hero. */
const ASEPRITE_DOCUMENT = {
  frames: {
    "hero (idle) 0.aseprite": {
      frame: { x: 0, y: 0, w: 16, h: 16 },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: 16, h: 16 },
      sourceSize: { w: 16, h: 16 },
      duration: 100,
    },
    "hero (idle) 1.aseprite": {
      frame: { x: 16, y: 0, w: 14, h: 12 },
      rotated: false,
      trimmed: true,
      spriteSourceSize: { x: 1, y: 2, w: 14, h: 12 },
      sourceSize: { w: 16, h: 16 },
      duration: 100,
    },
  },
  meta: {
    app: "http://www.aseprite.org/",
    image: "hero.png",
    size: { w: 32, h: 16 },
    scale: "1",
    frameTags: [{ name: "idle", from: 0, to: 1, direction: "forward" }],
    layers: [{ name: "Layer 1", opacity: 255, blendMode: "normal" }],
    slices: [
      {
        name: "hero",
        color: "#0000ffff",
        keys: [{ frame: 0, bounds: { x: 4, y: 8, w: 8, h: 8 }, pivot: { x: 4, y: 8 } }],
      },
    ],
  },
} as const;

describe("importAsepriteAtlas", () => {
  it("normalises Aseprite's file-ish frame keys", () => {
    const atlas = importAsepriteAtlas(ASEPRITE_DOCUMENT);

    expect(atlas.frames.map((frame) => frame.name)).toEqual(["hero_idle_0", "hero_idle_1"]);
    expect(atlas.image).toBe("hero.png");
  });

  it("keeps the untrimmed source size of a trimmed frame only", () => {
    const atlas = importAsepriteAtlas(ASEPRITE_DOCUMENT);

    expect(atlas.frames[0]?.sourceSize).toBeUndefined();
    expect(atlas.frames[1]?.sourceSize).toEqual({ x: 16, y: 16 });
  });

  it("applies a slice pivot, normalised against the untrimmed frame size", () => {
    const atlas = importAsepriteAtlas(ASEPRITE_DOCUMENT);

    // bounds (4, 8) + pivot (4, 8) = (8, 16) over a 16x16 source.
    expect(atlas.frames[0]?.pivot).toEqual({ x: 0.5, y: 1 });
    expect(atlas.frames[1]?.pivot).toEqual({ x: 0.5, y: 1 });
  });

  it("clamps a slice pivot that falls outside the frame", () => {
    const atlas = importAsepriteAtlas({
      frames: { "a.png": { frame: { x: 0, y: 0, w: 8, h: 8 } } },
      meta: {
        image: "a.png",
        slices: [{ keys: [{ frame: 0, bounds: { x: 0, y: 0, w: 8, h: 8 }, pivot: { x: -4, y: 99 } }] }],
      },
    });

    expect(atlas.frames[0]?.pivot).toEqual({ x: 0, y: 1 });
  });

  it("falls back to the centre when no slice covers a frame", () => {
    const atlas = importAsepriteAtlas({
      frames: { "a.png": { frame: { x: 0, y: 0, w: 8, h: 8 } } },
      meta: {
        image: "a.png",
        slices: [{ keys: [{ frame: 3, bounds: { x: 0, y: 0, w: 8, h: 8 }, pivot: { x: 1, y: 1 } }] }],
      },
    });

    expect(atlas.frames[0]?.pivot).toEqual({ x: 0.5, y: 0.5 });
  });

  it("ignores slice entries it cannot read", () => {
    const atlas = importAsepriteAtlas({
      frames: { "a.png": { frame: { x: 0, y: 0, w: 8, h: 8 } } },
      meta: {
        image: "a.png",
        slices: [7, { keys: 3 }, { keys: [9, { frame: 0, bounds: { x: 0, y: 0, w: 8, h: 8 } }] }],
      },
    });

    expect(atlas.frames[0]?.pivot).toEqual({ x: 0.5, y: 0.5 });
  });

  it("ignores a slices field that is not an array, and a document with no meta at all", () => {
    const atlas = importAsepriteAtlas(
      { frames: { "a.png": { frame: { x: 0, y: 0, w: 8, h: 8 } } } },
      {
        image: "a.png",
      },
    );

    expect(atlas.frames[0]?.pivot).toEqual({ x: 0.5, y: 0.5 });
    expect(
      importAsepriteAtlas({
        frames: { "a.png": { frame: { x: 0, y: 0, w: 8, h: 8 } } },
        meta: { image: "a.png", slices: 4 },
      }).image,
    ).toBe("a.png");
  });

  it("takes the later slice key when several cover a frame", () => {
    const atlas = importAsepriteAtlas({
      frames: {
        "a.png": { frame: { x: 0, y: 0, w: 8, h: 8 } },
        "b.png": { frame: { x: 8, y: 0, w: 8, h: 8 } },
      },
      meta: {
        image: "a.png",
        slices: [
          {
            keys: [
              { frame: 0, bounds: { x: 0, y: 0, w: 8, h: 8 }, pivot: { x: 0, y: 0 } },
              { frame: 1, bounds: { x: 0, y: 0, w: 8, h: 8 }, pivot: { x: 8, y: 8 } },
            ],
          },
        ],
      },
    });

    expect(atlas.frames[0]?.pivot).toEqual({ x: 0, y: 0 });
    expect(atlas.frames[1]?.pivot).toEqual({ x: 1, y: 1 });
  });

  it("reads the array layout too, and the sampling options", () => {
    const atlas = importAsepriteAtlas(
      { frames: [{ filename: "hero 0.aseprite", frame: { x: 0, y: 0, w: 8, h: 8 } }], meta: { image: "hero.png" } },
      { sampling: "nearest", premultipliedAlpha: true },
    );

    expect(atlas.frames[0]?.name).toBe("hero_0");
    expect(atlas.sampling).toBe("nearest");
    expect(atlas.premultipliedAlpha).toBe(true);
  });

  it("rejects an unreadable document", () => {
    expect(codeOf(() => importAsepriteAtlas(42))).toBe("IGX-1109");
    expect(codeOf(() => importAsepriteAtlas({ frames: "nope", meta: { image: "a.png" } }))).toBe("IGX-1109");
    expect(codeOf(() => importAsepriteAtlas({ frames: {}, meta: { image: "a.png" } }))).toBe("IGX-1109");
    expect(codeOf(() => importAsepriteAtlas({ frames: { "a.png": {} }, meta: { image: "a.png" } }))).toBe("IGX-1109");
    expect(codeOf(() => importAsepriteAtlas({ frames: { "a.png": { frame: { x: 0, y: 0, w: 8, h: 8 } } } }))).toBe(
      "IGX-1109",
    );
  });
});
