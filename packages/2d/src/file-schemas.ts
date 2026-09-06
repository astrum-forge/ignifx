import { array, bool, defineSchema, enumOf, f32, i32, map, record, str, u32, vec2 } from "@ignifx/core";
import { SPRITE_ANIMATION_FORMAT, SPRITE_ANIMATION_FORMAT_VERSION } from "./animation/definition.js";
import { SPRITE_ATLAS_FORMAT, SPRITE_ATLAS_FORMAT_VERSION } from "./atlas/definition.js";
import { TILEMAP_FORMAT, TILEMAP_FORMAT_VERSION } from "./tilemap/definition.js";
import type { Schema } from "@ignifx/core";

/**
 * Declarative schemas for the three file formats `@ignifx/2d` reads
 * (`docs/architecture/06-serialization-and-scene-format.md` §6).
 *
 * These exist for **documentation and tooling**, not for the loaders: a loader validates with its
 * own `defineX` function, which produces an actionable `IGX-11##` message naming the offending
 * frame or clip. The schema here is what `pnpm docs:schemas` renders into
 * `skills/ignifx/references/formats/`, and what a JSON Schema for an editor is generated from.
 *
 * The two descriptions are deliberately kept in one package so they cannot drift apart in a
 * release; a test asserts that a fixture accepted by the loader also validates against the schema.
 */

/**
 * The `ignifx.spriteatlas` document schema.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 *
 * @public
 */
export function spriteAtlasFileSchema(): Schema {
  return defineSchema({
    format: str(SPRITE_ATLAS_FORMAT, { tooltip: "Always ignifx.spriteatlas." }),
    formatVersion: u32(SPRITE_ATLAS_FORMAT_VERSION, { tooltip: "The document version this build reads." }),
    image: str("", { tooltip: "The image address, relative to this document." }),
    sampling: enumOf(["linear", "nearest"] as const, "linear", { tooltip: "Min/mag filter; nearest for pixel art." }),
    premultipliedAlpha: bool(false, { tooltip: "Whether the image's RGB is already multiplied by its alpha." }),
    frames: array(
      record({
        name: str("", { tooltip: "The frame's name; what #frame: addresses." }),
        x: f32(0, { min: 0, tooltip: "The left edge, in image pixels." }),
        y: f32(0, { min: 0, tooltip: "The top edge, in image pixels." }),
        w: f32(0, { min: 0, tooltip: "The width, in image pixels." }),
        h: f32(0, { min: 0, tooltip: "The height, in image pixels." }),
        pivot: vec2({ x: 0.5, y: 0.5 }, { tooltip: "Pivot in [0,1] of the frame; [0,0] is top-left." }),
        sourceSize: vec2({ x: 0, y: 0 }, { tooltip: "The untrimmed size, when the packer trimmed the frame." }),
      }),
      [],
      {
        tooltip:
          "The frames, in the order they are indexed. Each is a record of " +
          "name (str, what #frame: addresses), x/y (f32, the top-left corner in image pixels), " +
          "w/h (f32, the size in image pixels), pivot (vec2 in [0,1] of the frame; [0,0] is top-left) " +
          "and sourceSize (vec2, the untrimmed size when the packer trimmed the frame).",
      },
    ),
  });
}

/**
 * The `ignifx.spriteanimation` document schema.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 *
 * @public
 */
export function spriteAnimationFileSchema(): Schema {
  return defineSchema({
    format: str(SPRITE_ANIMATION_FORMAT, { tooltip: "Always ignifx.spriteanimation." }),
    formatVersion: u32(SPRITE_ANIMATION_FORMAT_VERSION, { tooltip: "The document version this build reads." }),
    atlas: str("", { tooltip: "The .atlas.json address, relative to this document." }),
    clips: array(
      record({
        name: str("", { tooltip: "The clip's name; what SpriteAnimator.play takes." }),
        frames: array(str(), [], {
          tooltip: "Atlas frame names, in play order; they need not be adjacent in the atlas.",
        }),
        from: str("", {
          tooltip:
            "The atlas frame whose INDEX starts the range, when frames is empty. " +
            "Every atlas index between from and to is played, so the two must bracket a contiguous run.",
        }),
        to: str("", {
          tooltip: "The atlas frame whose INDEX ends the range, inclusive; an index below from plays it backwards.",
        }),
        fps: f32(12, { min: Number.EPSILON, tooltip: "Frames per second." }),
        loop: bool(true, { tooltip: "Whether the clip restarts at its end." }),
        events: array(
          record({
            frame: u32(0, { tooltip: "The zero-based index within the clip, not the atlas." }),
            name: str("", { tooltip: "The name emitted on SpriteAnimator.onEvent." }),
          }),
          [],
          { tooltip: "Events fired as the clip passes a frame." },
        ),
      }),
      [],
      {
        tooltip:
          "The clips; the first is the default. Each is a record of " +
          "name (str, what SpriteAnimator.play takes), " +
          "frames (array of atlas frame names in play order, which need not be adjacent), " +
          "from/to (str: an INCLUSIVE range over atlas INDICES used when frames is empty — every index " +
          "between the two endpoints is played, in atlas order, so a range over non-adjacent frames plays " +
          "everything in between; to before from plays it backwards), " +
          "fps (f32, default 12), loop (bool, default true) and " +
          "events (array of { frame: u32 index within the clip, not the atlas; name: str }).",
      },
    ),
  });
}

/**
 * The `ignifx.tilemap` document schema.
 *
 * @returns The schema, built fresh so no module holds state (`CONSTITUTION.md` §3.5).
 *
 * @public
 */
export function tilemapFileSchema(): Schema {
  return defineSchema({
    format: str(TILEMAP_FORMAT, { tooltip: "Always ignifx.tilemap." }),
    formatVersion: u32(TILEMAP_FORMAT_VERSION, { tooltip: "The document version this build reads." }),
    tileWidth: f32(32, { min: Number.EPSILON, tooltip: "One cell's width, in pixels." }),
    tileHeight: f32(32, { min: Number.EPSILON, tooltip: "One cell's height, in pixels." }),
    cellSize: f32(0.32, { min: Number.EPSILON, tooltip: "One cell's size, in world metres." }),
    width: u32(0, { tooltip: "The map's width, in cells." }),
    height: u32(0, { tooltip: "The map's height, in cells." }),
    tilesets: array(
      record({
        name: str("", { tooltip: "The tileset's name; the frame-name prefix." }),
        atlas: str("", { tooltip: "The .atlas.json address; empty means collision-only." }),
        firstId: u32(1, { min: 1, tooltip: "The global id of this tileset's first tile." }),
      }),
      [],
      { tooltip: "The tilesets, ascending by firstId." },
    ),
    layers: array(
      record({
        name: str("", { tooltip: "The layer's name." }),
        sortingLayer: str("Default", { tooltip: "Which sorting layer the tiles draw on." }),
        orderInLayer: i32(0, { tooltip: "Sub-order within the sorting layer." }),
        opacity: f32(1, { min: 0, max: 1, tooltip: "The layer's alpha." }),
        parallax: vec2({ x: 1, y: 1 }, { tooltip: "Fraction of the camera's motion the layer follows." }),
        collision: bool(false, { tooltip: "Whether this layer's tiles contribute colliders." }),
        width: u32(0, { tooltip: "The layer's width, in cells." }),
        height: u32(0, { tooltip: "The layer's height, in cells." }),
        tiles: array(u32(), [], { tooltip: "Tile ids, row-major, top row first; 0 is empty." }),
      }),
      [],
      { tooltip: "The tile layers, back to front." },
    ),
    objects: array(
      record({
        name: str("", { tooltip: "The object's name." }),
        type: str("", { tooltip: "The object's type; what selects a TileObjectFactory." }),
        x: f32(0, { tooltip: "The bottom-left corner, in world metres." }),
        y: f32(0, { tooltip: "The bottom-left corner, in world metres." }),
        width: f32(0, { min: 0, tooltip: "The width, in world metres." }),
        height: f32(0, { min: 0, tooltip: "The height, in world metres." }),
      }),
      [],
      { tooltip: "The objects layer." },
    ),
    properties: map(str(), { tooltip: "The map's custom properties." }),
  });
}
