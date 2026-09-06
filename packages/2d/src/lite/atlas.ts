import type { SpriteAtlas, SpriteFrame, Texture2D } from "@babylonjs/lite";

/**
 * The atlas half of the Babylon Lite sprite adapter: turning pixel rectangles into the normalised
 * UV records Lite's `SpriteAtlas` holds (`index.d.ts` 12041 and 12156).
 *
 * A `SpriteAtlas` is pure data — `{ texture, textureSizePx, frames, premultipliedAlpha }` — so
 * building one touches no device and this module stays Node-testable. Only the texture behind it
 * needs a GPU, and that lives in `./gpu/texture.ts`.
 *
 * Everything here is `@internal`.
 */

/**
 * One frame rectangle in image pixels, top-left origin — the shape a `.atlas.json` document and
 * every importer speak.
 *
 * @internal
 */
export interface FrameRect {
  /** The frame's name, carried onto `SpriteFrame.name`. */
  readonly name: string;
  /** The left edge, in image pixels. */
  readonly x: number;
  /** The top edge, in image pixels. */
  readonly y: number;
  /** The width, in image pixels. */
  readonly w: number;
  /** The height, in image pixels. */
  readonly h: number;
  /** The pivot in `[0, 1]` of the frame, `[0, 0]` top-left. */
  readonly pivotX: number;
  /** The pivot in `[0, 1]` of the frame. */
  readonly pivotY: number;
  /** The drawn size in pixels, which differs from `w`/`h` only for a trimmed frame. */
  readonly sourceW: number;
  /** The drawn size in pixels. */
  readonly sourceH: number;
}

/**
 * Converts pixel rectangles into Lite `SpriteFrame` records.
 *
 * @remarks
 * Lite's sprite UVs are **top-down**: `uvMin` is the frame's top-left corner in `[0, 1]`, which is
 * why the atlas texture is uploaded with `invertY: false` (Lite's own `loadSpriteAtlas` does the
 * same — `lib/sprite/shared/sprite-atlas.js`, "Sprite UVs are top-down (origin at image
 * top-left); do not flip").
 *
 * @param frames - The rectangles, in the order they should be indexed.
 * @param textureWidth - The atlas image width, in pixels.
 * @param textureHeight - The atlas image height, in pixels.
 * @returns The Lite frame records.
 *
 * @internal
 */
export function toSpriteFrames(
  frames: readonly FrameRect[],
  textureWidth: number,
  textureHeight: number,
): readonly SpriteFrame[] {
  const width = textureWidth > 0 ? textureWidth : 1;
  const height = textureHeight > 0 ? textureHeight : 1;
  const out: SpriteFrame[] = [];
  for (let index = 0; index < frames.length; index += 1) {
    const rect = frames[index];
    if (rect === undefined) {
      continue;
    }
    out.push({
      name: rect.name,
      uvMin: [rect.x / width, rect.y / height],
      uvMax: [(rect.x + rect.w) / width, (rect.y + rect.h) / height],
      sourceSizePx: [rect.sourceW, rect.sourceH],
      pivot: [rect.pivotX, rect.pivotY],
    });
  }
  return out;
}

/**
 * Assembles a `SpriteAtlas` from a texture and pixel rectangles.
 *
 * @param texture - The uploaded atlas image.
 * @param textureWidth - Its width, in pixels.
 * @param textureHeight - Its height, in pixels.
 * @param frames - The rectangles.
 * @param premultipliedAlpha - Whether the image's RGB is already multiplied by its alpha.
 * @returns The atlas.
 *
 * @internal
 */
export function buildAtlas(
  texture: Texture2D,
  textureWidth: number,
  textureHeight: number,
  frames: readonly FrameRect[],
  premultipliedAlpha: boolean,
): SpriteAtlas {
  return {
    texture,
    textureSizePx: [textureWidth, textureHeight],
    frames: toSpriteFrames(frames, textureWidth, textureHeight),
    premultipliedAlpha,
  };
}

/**
 * Finds a frame by name.
 *
 * @param atlas - The atlas to search.
 * @param name - The frame name.
 * @returns The frame index, or `-1`.
 *
 * @internal
 */
export function frameIndexOf(atlas: SpriteAtlas, name: string): number {
  const frames = atlas.frames;
  for (let index = 0; index < frames.length; index += 1) {
    if (frames[index]?.name === name) {
      return index;
    }
  }
  return -1;
}
