import { IgnifxError, Vec2 } from "@ignifx/core";
import { describe, expect, it } from "vitest";
import { defineSpriteAtlas } from "../../src/atlas/definition.js";
import { importTexturePackerAtlas } from "../../src/atlas/importers.js";
import { SpriteAtlasAsset } from "../../src/atlas/sprite-atlas-asset.js";
import { pivotedPositionToRef, trimmedPivotToRef } from "../../src/math/coords.js";

/**
 * A 30×44 rectangle cut from a 32×48 source, without `sourceOffset`: the legacy meaning, drawn
 * stretched to `sourceSize`.
 */
const UNTRIMMED = { name: "hero_1", x: 0, y: 0, w: 30, h: 44, sourceSize: [32, 48] } as const;

/**
 * The same frame placed as trimmed: 1 px from its source's left and 2 px from its top, as
 * TexturePacker's `spriteSourceSize` writes it.
 */
const TRIMMED = { ...UNTRIMMED, sourceOffset: { x: 1, y: 2 } } as const;

describe("a trimmed frame's sourceOffset", () => {
  it("is read from TexturePacker's spriteSourceSize and validated against sourceSize", () => {
    const imported = importTexturePackerAtlas({
      frames: {
        "hero_1.png": {
          frame: { x: 0, y: 0, w: 30, h: 44 },
          trimmed: true,
          spriteSourceSize: { x: 1, y: 2, w: 30, h: 44 },
          sourceSize: { w: 32, h: 48 },
        },
      },
      meta: { image: "hero.png" },
    });
    expect(imported.frames[0]?.sourceOffset).toEqual({ x: 1, y: 2 });

    expect(defineSpriteAtlas({ image: "a.png", frames: [TRIMMED] }).frames[0]?.sourceOffset).toEqual({ x: 1, y: 2 });
    const refused = (frame: object): unknown => {
      try {
        defineSpriteAtlas({ image: "a.png", frames: [{ ...TRIMMED, ...frame }] });
        return null;
      } catch (error) {
        return error instanceof IgnifxError ? error.code : error;
      }
    };
    expect(refused({ sourceSize: undefined })).toBe("IGX-1103");
    expect(refused({ sourceOffset: [3, 0] })).toBe("IGX-1103");
    expect(refused({ sourceOffset: { x: -1, y: 0 } })).toBe("IGX-1103");
  });

  it("draws the trimmed size and reports where it sits in its source", () => {
    const atlas = new SpriteAtlasAsset(
      "a.atlas.json",
      defineSpriteAtlas({ image: "a.png", frames: [TRIMMED] }),
      null,
      null,
    );
    expect(atlas.frame(0)).toMatchObject({
      widthPx: 30,
      heightPx: 44,
      pivot: { x: 0.5, y: 0.5 },
      trim: { offsetXPx: 1, offsetYPx: 2, sourceWidthPx: 32, sourceHeightPx: 48 },
    });
    const untrimmed = new SpriteAtlasAsset(
      "b.atlas.json",
      defineSpriteAtlas({ image: "a.png", frames: [UNTRIMMED] }),
      null,
      null,
    );
    expect(untrimmed.frame(0)).toMatchObject({ widthPx: 32, heightPx: 48, trim: null });
  });

  it("moves the pivot so the trimmed pixels land where the untrimmed frame put them, flipped or not", () => {
    const trim = { offsetXPx: 1, offsetYPx: 2, sourceWidthPx: 32, sourceHeightPx: 48 };
    const pivot = trimmedPivotToRef({ x: 0.5, y: 1 }, trim, 30, 44, false, false, new Vec2());
    // The source's bottom-centre (16, 48) is (15, 46) in the trimmed rectangle.
    expect(pivot.x).toBeCloseTo(15 / 30);
    expect(pivot.y).toBeCloseTo(46 / 44);
    // The quad's centre is then the trimmed rectangle's centre in source pixels, (16, 24), minus the pivot (16, 48).
    const placed = pivotedPositionToRef(0, 0, pivot, 30, 44, 0, new Vec2());
    expect(placed.x).toBeCloseTo(0);
    expect(placed.y).toBeCloseTo(-24);

    const flipped = trimmedPivotToRef({ x: 0.5, y: 0.5 }, trim, 30, 44, true, true, new Vec2());
    // Mirrored, the rectangle sits 1 px from the right and 2 px from the bottom of its source.
    expect(flipped.x).toBeCloseTo((16 - 1) / 30);
    expect(flipped.y).toBeCloseTo((24 - 2) / 44);
    expect(trimmedPivotToRef({ x: 0.5, y: 0.5 }, trim, 0, 0, false, false, new Vec2())).toMatchObject({
      x: 0.5,
      y: 0.5,
    });
  });
});
