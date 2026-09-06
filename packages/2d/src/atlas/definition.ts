import { twoDError, TwoDErrorCode } from "../errors.js";
import type { Vec2Like } from "@ignifx/core";

/**
 * The `ignifx.spriteatlas` document — the `.atlas.json` file that names an image and the frame
 * rectangles inside it (`docs/architecture/06-serialization-and-scene-format.md` §6,
 * `11-2d-toolkit.md` §2.3).
 *
 * Frames are in **image pixels with a top-left origin**, which is what every atlas packer emits.
 * The conversion into Lite's normalised UVs happens in the loader, once.
 */

/**
 * The `format` discriminator every `.atlas.json` document carries.
 *
 * @public
 */
export const SPRITE_ATLAS_FORMAT = "ignifx.spriteatlas";

/**
 * The document version this build reads and writes.
 *
 * @public
 */
export const SPRITE_ATLAS_FORMAT_VERSION = 1;

/**
 * The asset type name the loader registers.
 *
 * @public
 */
export const SPRITE_ATLAS_ASSET_TYPE = "spriteatlas";

/**
 * The address suffixes that select the sprite-atlas loader.
 *
 * @public
 */
export const SPRITE_ATLAS_FILE_EXTENSIONS: readonly string[] = Object.freeze([".atlas.json"]);

/**
 * The fragment prefix that addresses one frame: `"sprites/hero.atlas.json#frame:idle_0"`.
 *
 * @public
 */
export const SPRITE_FRAME_FRAGMENT_PREFIX = "frame:";

/**
 * A 2D value as a document may write it: `[x, y]`, the form `@ignifx/core` encodes every `vec2`
 * field into a file as (`schema/encode.ts` line 393), or `{ x, y }`, the form an importer emits.
 *
 * @public
 */
export type Vec2Json = Vec2Like | readonly [number, number];

/**
 * Normalises either written form of a 2D value.
 *
 * @param value - What the document wrote, or `undefined`.
 * @param fallback - What to use when the document wrote nothing.
 * @returns The normalised vector.
 *
 * @public
 */
export function readVec2(value: Vec2Json | undefined, fallback: Vec2Like): Vec2Like {
  if (value === undefined) {
    return fallback;
  }
  if (isPair(value)) {
    return { x: value[0], y: value[1] };
  }
  return typeof value.x === "number" && typeof value.y === "number" ? { x: value.x, y: value.y } : fallback;
}

/**
 * Whether a written 2D value is the `[x, y]` array form.
 *
 * @param value - The value the document carried.
 * @returns `true` when it is a two-number array.
 */
function isPair(value: Vec2Json): value is readonly [number, number] {
  return Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number";
}

/**
 * One frame rectangle, in image pixels with a top-left origin.
 *
 * @public
 */
export interface SpriteFrameDefinition {
  /** The frame's name, unique within the document; what `#frame:` addresses. */
  readonly name: string;
  /** The left edge, in image pixels. */
  readonly x: number;
  /** The top edge, in image pixels. */
  readonly y: number;
  /** The width, in image pixels. */
  readonly w: number;
  /** The height, in image pixels. */
  readonly h: number;
  /**
   * The pivot in `[0, 1]` of the frame — `[0, 0]` top-left, `[0.5, 0.5]` centre, `[1, 1]`
   * bottom-right. Defaults to the centre. Written either as `[x, y]` or as `{ x, y }`.
   */
  readonly pivot?: Vec2Json;
  /** The untrimmed source size, when the packer trimmed transparent margins. Defaults to `w`/`h`. */
  readonly sourceSize?: Vec2Json;
}

/**
 * The parsed `.atlas.json` document.
 *
 * @example
 * ```ts
 * const atlas = defineSpriteAtlas({
 *   image: "2d/hero.png",
 *   sampling: "nearest",
 *   frames: [{ name: "idle_0", x: 0, y: 0, w: 32, h: 32, pivot: { x: 0.5, y: 1 } }],
 * });
 * ```
 *
 * @public
 */
export interface SpriteAtlasDefinition {
  /** Always `"ignifx.spriteatlas"`. */
  readonly format: typeof SPRITE_ATLAS_FORMAT;
  /** Always `1` in this build. */
  readonly formatVersion: number;
  /** The address of the image the frames are cut from. */
  readonly image: string;
  /** The min/mag filter. `"nearest"` is what pixel art wants. Defaults to `"linear"`. */
  readonly sampling: "linear" | "nearest";
  /** Whether the image's RGB is already multiplied by its alpha. Defaults to `false`. */
  readonly premultipliedAlpha: boolean;
  /** The frames, in the order they are indexed. */
  readonly frames: readonly SpriteFrameDefinition[];
}

/**
 * What {@link defineSpriteAtlas} accepts: the document with every defaulted field optional.
 *
 * @public
 */
export interface SpriteAtlasInput {
  /** Always `"ignifx.spriteatlas"` when present. */
  readonly format?: string;
  /** The document version. */
  readonly formatVersion?: number;
  /** The address of the image the frames are cut from. */
  readonly image: string;
  /** The min/mag filter. Defaults to `"linear"`. */
  readonly sampling?: "linear" | "nearest";
  /** Whether the image is premultiplied. Defaults to `false`. */
  readonly premultipliedAlpha?: boolean;
  /** The frames. */
  readonly frames: readonly SpriteFrameDefinition[];
}

/**
 * Fills in the defaults of an atlas document and checks the invariants a loader relies on.
 *
 * @param input - The document, as authored or as an importer emitted it.
 * @param address - What to name in an error; defaults to `"<inline>"`.
 * @returns The complete document.
 * @throws IgnifxError with code `IGX-1103` when the format tag, the version, the image address, or
 * a frame rectangle is wrong, or two frames share a name.
 *
 * @public
 */
export function defineSpriteAtlas(input: SpriteAtlasInput, address = "<inline>"): SpriteAtlasDefinition {
  const fail = (reason: string): never => {
    throw twoDError(
      TwoDErrorCode.invalidAtlasFile,
      `${address} is not a readable ignifx.spriteatlas document: ${reason}.`,
      {
        context: { file: address },
        hint: "Regenerate it with `ignifx import atlas`, or check the format and version fields.",
      },
    );
  };
  if (input.format !== undefined && input.format !== SPRITE_ATLAS_FORMAT) {
    fail(`its format is ${input.format}, not ${SPRITE_ATLAS_FORMAT}`);
  }
  if (input.formatVersion !== undefined && input.formatVersion !== SPRITE_ATLAS_FORMAT_VERSION) {
    fail(
      `its formatVersion is ${String(input.formatVersion)}, and this build reads ${String(SPRITE_ATLAS_FORMAT_VERSION)}`,
    );
  }
  if (typeof input.image !== "string" || input.image === "") {
    fail("it names no image");
  }
  if (!Array.isArray(input.frames) || input.frames.length === 0) {
    fail("it declares no frames");
  }
  const seen = new Set<string>();
  for (let index = 0; index < input.frames.length; index += 1) {
    const frame = input.frames[index];
    if (frame === undefined || typeof frame.name !== "string" || frame.name === "") {
      fail(`frame ${String(index)} has no name`);
      continue;
    }
    if (seen.has(frame.name)) {
      fail(`two frames are named ${frame.name}`);
    }
    seen.add(frame.name);
    if (!(frame.w > 0) || !(frame.h > 0)) {
      fail(`frame ${frame.name} has a non-positive size`);
    }
    if (!(frame.x >= 0) || !(frame.y >= 0)) {
      fail(`frame ${frame.name} starts outside the image`);
    }
  }
  const frames: SpriteFrameDefinition[] = [];
  for (let index = 0; index < input.frames.length; index += 1) {
    const frame = input.frames[index];
    if (frame === undefined) {
      continue;
    }
    // Normalise both written forms of a 2D value once, here, so nothing downstream has to care.
    // `sourceSize` keeps its absence: a frame that declares none is untrimmed, and saying so is
    // information an importer round trip should not invent.
    frames.push({
      ...frame,
      pivot: readVec2(frame.pivot, CENTRE_PIVOT),
      ...(frame.sourceSize === undefined ? {} : { sourceSize: readVec2(frame.sourceSize, { x: frame.w, y: frame.h }) }),
    });
  }
  return {
    format: SPRITE_ATLAS_FORMAT,
    formatVersion: SPRITE_ATLAS_FORMAT_VERSION,
    image: input.image,
    sampling: input.sampling ?? "linear",
    premultipliedAlpha: input.premultipliedAlpha ?? false,
    frames,
  };
}

/**
 * The pivot a frame that declares none uses.
 */
const CENTRE_PIVOT: Vec2Like = Object.freeze({ x: 0.5, y: 0.5 });

/**
 * Splits a sprite address into its atlas address and its frame name.
 *
 * @param fragment - The part after `#`, or `null` for a bare atlas address.
 * @returns The frame name, or `null` when the fragment does not select a frame.
 *
 * @example
 * ```ts
 * parseSpriteFragment("frame:idle_0"); // "idle_0"
 * ```
 *
 * @public
 */
export function parseSpriteFragment(fragment: string | null): string | null {
  if (fragment === null || !fragment.startsWith(SPRITE_FRAME_FRAGMENT_PREFIX)) {
    return null;
  }
  const name = fragment.slice(SPRITE_FRAME_FRAGMENT_PREFIX.length);
  return name === "" ? null : name;
}
