import { describe, expect, it } from "vitest";
import { SpriteAnimator } from "../src/animation/sprite-animator.js";
import { Camera2D } from "../src/camera/camera-2d.js";
import {
  describeSchemas,
  describeTwoDSchemas,
  spriteAnimationJsonSchema,
  spriteAtlasJsonSchema,
  tilemapJsonSchema,
} from "../src/schemas.js";
import { ParallaxLayer } from "../src/sprite/parallax-layer.js";
import { SpriteLayerEffect } from "../src/sprite/sprite-layer-effect.js";
import { SpriteRenderer } from "../src/sprite/sprite-renderer.js";
import { TilemapRenderer } from "../src/tilemap/tilemap-renderer.js";
import { Tilemap } from "../src/tilemap/tilemap.js";
import type { ConcreteComponentType } from "@ignifx/core";

/**
 * What `pnpm docs:schemas` reads out of this package
 * (`docs/architecture/16-docs-harness-and-skill.md` §3).
 */

/** The component classes whose schemas the harness renders. */
const COMPONENTS: readonly (readonly [string, ConcreteComponentType])[] = [
  ["ignifx/Camera2D", Camera2D],
  ["ignifx/SpriteRenderer", SpriteRenderer],
  ["ignifx/SpriteAnimator", SpriteAnimator],
  ["ignifx/Tilemap", Tilemap],
  ["ignifx/TilemapRenderer", TilemapRenderer],
  ["ignifx/ParallaxLayer", ParallaxLayer],
  ["ignifx/SpriteLayerEffect", SpriteLayerEffect],
];

describe("discovery", () => {
  it("exposes the same records under both names", () => {
    expect(describeSchemas()).toEqual(describeTwoDSchemas());
  });

  it("namespaces every type id", () => {
    for (const key of Object.keys(describeTwoDSchemas())) {
      expect(key).toContain("/");
      expect(key.startsWith("ignifx/")).toBe(true);
    }
  });

  it("describes every component the extension registers", () => {
    const records = describeTwoDSchemas();
    for (const [id] of COMPONENTS) {
      expect(records[id]).toBeDefined();
    }
  });

  it("gives each component record the fields its class declares", () => {
    const records = describeTwoDSchemas();
    for (const [id, type] of COMPONENTS) {
      const record = records[id];
      expect(record).toBeDefined();
      const schema = type.schema;
      expect(schema).toBeDefined();
      if (record !== undefined && schema !== undefined) {
        expect(Object.keys(record.fields).toSorted()).toEqual(Object.keys(schema).toSorted());
      }
    }
  });

  it("describes the three file formats under their format tags", () => {
    const records = describeTwoDSchemas();
    expect(records["ignifx/spriteatlas-file"]?.format).toBe("ignifx.spriteatlas");
    expect(records["ignifx/spriteanimation-file"]?.format).toBe("ignifx.spriteanimation");
    expect(records["ignifx/tilemap-file"]?.format).toBe("ignifx.tilemap");
  });

  it("gives every record a one-line description", () => {
    for (const record of Object.values(describeTwoDSchemas())) {
      expect(typeof record.description).toBe("string");
      expect(record.description?.length ?? 0).toBeGreaterThan(10);
    }
  });

  it("builds the records fresh on every call, holding no module state", () => {
    expect(describeTwoDSchemas()).not.toBe(describeTwoDSchemas());
  });
});

describe("JSON Schema", () => {
  it("emits an object schema for each format", () => {
    for (const schema of [spriteAtlasJsonSchema(), spriteAnimationJsonSchema(), tilemapJsonSchema()]) {
      expect(schema["type"]).toBe("object");
      expect(schema["properties"]).toBeDefined();
    }
  });

  it("names the fields a document actually carries", () => {
    const atlas = spriteAtlasJsonSchema()["properties"] as Record<string, unknown>;
    expect(Object.keys(atlas)).toEqual(
      expect.arrayContaining(["format", "formatVersion", "image", "sampling", "premultipliedAlpha", "frames"]),
    );
    const tilemap = tilemapJsonSchema()["properties"] as Record<string, unknown>;
    expect(Object.keys(tilemap)).toEqual(
      expect.arrayContaining(["format", "tileWidth", "cellSize", "tilesets", "layers", "objects"]),
    );
  });
});
