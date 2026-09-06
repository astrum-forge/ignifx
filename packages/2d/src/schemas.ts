import { describeSchema, toJsonSchema } from "@ignifx/core";
import { SPRITE_ANIMATION_FORMAT } from "./animation/definition.js";
import { SpriteAnimator } from "./animation/sprite-animator.js";
import { SPRITE_ATLAS_FORMAT } from "./atlas/definition.js";
import { Camera2D } from "./camera/camera-2d.js";
import { spriteAtlasFileSchema, spriteAnimationFileSchema, tilemapFileSchema } from "./file-schemas.js";
import { ParallaxLayer } from "./sprite/parallax-layer.js";
import { SpriteLayerEffect } from "./sprite/sprite-layer-effect.js";
import { SpriteRenderer } from "./sprite/sprite-renderer.js";
import { TILEMAP_FORMAT } from "./tilemap/definition.js";
import { TilemapRenderer } from "./tilemap/tilemap-renderer.js";
import { Tilemap } from "./tilemap/tilemap.js";
import type { JsonSchemaObject, SchemaDescription } from "@ignifx/core";

/**
 * The documentation harness's view of everything `@ignifx/2d` declares
 * (`scripts/README.md`, "Schema discovery convention";
 * `docs/architecture/16-docs-harness-and-skill.md` §3).
 *
 * The **function** form is what a package uses rather than a `schemas` object, because building the
 * record means calling `describeSchema` and module scope holds declarations only
 * (`CONSTITUTION.md` §3.5).
 */

/**
 * Describes the `ignifx.spriteatlas` file format.
 *
 * @returns The record `pnpm docs:schemas` renders.
 *
 * @public
 */
export function describeSpriteAtlasFormat(): SchemaDescription {
  return describeSchema("ignifx/spriteatlas-file", spriteAtlasFileSchema(), {
    title: "Sprite atlas",
    format: SPRITE_ATLAS_FORMAT,
    description: "An image plus the frame rectangles inside it, in pixels with a top-left origin.",
  });
}

/**
 * Describes the `ignifx.spriteanimation` file format.
 *
 * @returns The record `pnpm docs:schemas` renders.
 *
 * @public
 */
export function describeSpriteAnimationFormat(): SchemaDescription {
  return describeSchema("ignifx/spriteanimation-file", spriteAnimationFileSchema(), {
    title: "Sprite animation",
    format: SPRITE_ANIMATION_FORMAT,
    description: "Clips of atlas frames with a rate, a loop flag, and frame events.",
  });
}

/**
 * Describes the `ignifx.tilemap` file format.
 *
 * @returns The record `pnpm docs:schemas` renders.
 *
 * @public
 */
export function describeTilemapFormat(): SchemaDescription {
  return describeSchema("ignifx/tilemap-file", tilemapFileSchema(), {
    title: "Tilemap",
    format: TILEMAP_FORMAT,
    description: "Tile size, layers of tile ids, tilesets with colliders, and an objects layer.",
  });
}

/**
 * The JSON Schema a tool validates a `.atlas.json` document against.
 *
 * @returns The JSON Schema object.
 *
 * @public
 */
export function spriteAtlasJsonSchema(): JsonSchemaObject {
  return toJsonSchema(spriteAtlasFileSchema());
}

/**
 * The JSON Schema a tool validates a `.spriteanim.json` document against.
 *
 * @returns The JSON Schema object.
 *
 * @public
 */
export function spriteAnimationJsonSchema(): JsonSchemaObject {
  return toJsonSchema(spriteAnimationFileSchema());
}

/**
 * The JSON Schema a tool validates a `.tilemap.json` document against.
 *
 * @returns The JSON Schema object.
 *
 * @public
 */
export function tilemapJsonSchema(): JsonSchemaObject {
  return toJsonSchema(tilemapFileSchema());
}

/**
 * Describes every component and file format this package declares, for the documentation harness.
 *
 * @returns The records, keyed by namespaced type id.
 *
 * @example
 * ```ts
 * describeTwoDSchemas()["ignifx/Camera2D"].fields["orthographicSize"].default; // 5
 * ```
 *
 * @public
 */
export function describeTwoDSchemas(): Readonly<Record<string, SchemaDescription>> {
  return {
    "ignifx/Camera2D": describeSchema("ignifx/Camera2D", Camera2D.schema, {
      description: "The 2D camera: orthographic size in metres, pixel-perfect snapping, bounds, and follow fields.",
    }),
    "ignifx/SpriteRenderer": describeSchema("ignifx/SpriteRenderer", SpriteRenderer.schema, {
      description: "One sprite drawn from one frame of one atlas, on one sorting layer.",
    }),
    "ignifx/SpriteAnimator": describeSchema("ignifx/SpriteAnimator", SpriteAnimator.schema, {
      description: "Plays a clip of atlas frames on ignifx's clock, respecting timeScale and pause.",
    }),
    "ignifx/Tilemap": describeSchema("ignifx/Tilemap", Tilemap.schema, {
      description: "A grid of tile ids with cell arithmetic and merged collision geometry.",
    }),
    "ignifx/TilemapRenderer": describeSchema("ignifx/TilemapRenderer", TilemapRenderer.schema, {
      description: "Draws a Tilemap's cells as sprites, materialising only the chunks the camera sees.",
    }),
    "ignifx/ParallaxLayer": describeSchema("ignifx/ParallaxLayer", ParallaxLayer.schema, {
      description: "Scrolls one sorting layer at a fraction of the camera's speed.",
    }),
    "ignifx/SpriteLayerEffect": describeSchema("ignifx/SpriteLayerEffect", SpriteLayerEffect.schema, {
      description: "A per-layer WGSL fragment effect with an fx.params vec4.",
    }),
    "ignifx/spriteatlas-file": describeSpriteAtlasFormat(),
    "ignifx/spriteanimation-file": describeSpriteAnimationFormat(),
    "ignifx/tilemap-file": describeTilemapFormat(),
  };
}

/**
 * The name `pnpm docs:schemas` discovers this package's schemas under.
 *
 * @returns The same records {@link describeTwoDSchemas} returns.
 *
 * @public
 */
export function describeSchemas(): Readonly<Record<string, SchemaDescription>> {
  return describeTwoDSchemas();
}
