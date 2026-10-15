import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serializeScene, stringifySceneFile, validateSceneFile } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { entitiesInTreeOrder, field, named } from "./headless-app.js";
import { createTopdownApp, TOPDOWN } from "./topdown-app.js";
import type { App, Entity, MemorySink } from "@ignifx/core";

/**
 * `templates/2d-topdown` is editor-ready (ignifx-editor plan, engine ask E2): its level is
 * `assets/scenes/main.scene.json`, loaded by a boilerplate `main.ts`. `entry-rules.test.ts` checks
 * the entry's imports for all four templates.
 */

/** The level's address, as `main.ts` loads it. */
const MAIN_SCENE = "scenes/main.scene.json";

/** The level as it sits on disk. */
const SCENE_TEXT = readFileSync(join(TOPDOWN.assetDir, MAIN_SCENE), "utf8");

/** The still props, which are scene entities rather than map objects, and the frame each draws. */
const PROPS: readonly (readonly [string, string])[] = [
  ["Chest", "chest"],
  ["Barrel", "barrel"],
  ["Crate", "crate"],
  ["Signpost", "sign"],
  ["Rock", "rock"],
  ["Bush", "bush"],
  ["Bush East", "bush"],
  ["Crate East", "crate"],
  ["Barrel East", "barrel"],
  ["Rock North", "rock"],
  ["Bush South", "bush"],
  ["Waymarker", "sign"],
  ["Cache", "chest"],
];

/** Every entity of the level, in tree order. */
const EXPECTED_ENTITIES: readonly string[] = [
  "Level",
  "Player",
  ...PROPS.map(([name]) => name),
  "Shrine",
  "Main Camera",
];

/** The part of `@ignifx/2d`'s `TilemapCollisionData` these checks read; this suite does not depend on it. */
interface CollisionSurface {
  readonly chunks: readonly { readonly polygons: readonly unknown[]; readonly oneWayEdges: readonly unknown[] }[];
}

const apps: App[] = [];

afterEach(() => {
  for (const app of apps.splice(0)) {
    app.dispose();
  }
});

/**
 * Creates the template's headless app and loads the level into it.
 *
 * @returns The app, its log, and the scene's entities in tree order.
 */
async function loadLevel(): Promise<{ readonly app: App; readonly sink: MemorySink; readonly entities: Entity[] }> {
  const { app, sink } = await createTopdownApp();
  apps.push(app);
  const instance = await app.world.loadScene(MAIN_SCENE);
  return { app, sink, entities: entitiesInTreeOrder(instance) };
}

describe("2d-topdown's scene file", () => {
  it("validates against the scene format", () => {
    expect(validateSceneFile(JSON.parse(SCENE_TEXT))).toEqual([]);
  });

  it("loads headless through the template's own extensions and scripts", async () => {
    const { app, sink, entities } = await loadLevel();

    expect(entities.map((entity) => entity.name)).toEqual(EXPECTED_ENTITIES);
    // A dangling reference, an unknown layer or an unresolved asset is a warning, not a throw.
    expect(sink.toArray().filter((record) => record.level === "warn" || record.level === "error")).toEqual([]);

    const player = named(entities, "Player");
    expect(player.transform.position2D).toMatchObject({ x: 9.5, y: 10.5 });
    expect(field(named(entities, "Main Camera"), "ignifx/Camera2D", "follow")).toBe(player);
    // Every entity above is the scene's own, and there is exactly one player.
    expect(app.world.findByName("Player")).toBe(player);

    // `SpriteFrame` turned each frame name into the atlas index in `awake`.
    for (const [name, frame] of [...PROPS, ["Shrine", "pad"] as const]) {
      const entity = named(entities, name);
      const sprite = entity.components.find((component) => Reflect.get(component, "sprite") !== undefined);
      const atlas = Reflect.get(Reflect.get(sprite as object, "sprite") as object, "value") as {
        requireFrame(frame: string): number;
      };
      expect(field(entity, "topdown/SpriteFrame", "frame")).toBe(frame);
      expect(Reflect.get(sprite as object, "frame")).toBe(atlas.requireFrame(frame));
    }
  });

  it("collides with the tilemap straight from the file, with no post-load code", async () => {
    const { entities } = await loadLevel();
    const level = named(entities, "Level");
    const data = field(level, "ignifx/TilemapCollider2D", "collisionData") as CollisionSurface | null;
    expect(data).toBe(field(level, "ignifx/Tilemap", "collisionData"));
    expect(data?.chunks.some((chunk) => chunk.polygons.length > 0)).toBe(true);
  });

  it("round-trips byte for byte through serializeScene and stringifySceneFile", async () => {
    const { app } = await createTopdownApp();
    apps.push(app);
    const instance = await app.world.loadScene(MAIN_SCENE);

    // The template's file records no `engineVersion`: core stamps its own version by default, and
    // a file that changed with every release could never round-trip. `null` keeps it out.
    const text = stringifySceneFile(serializeScene(instance, { engineVersion: null }));

    expect(text).toBe(SCENE_TEXT);
  });
});
