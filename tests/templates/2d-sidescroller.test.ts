import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serializeScene, stringifySceneFile, validateSceneFile } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { entitiesInTreeOrder, field, named } from "./headless-app.js";
import { createSidescrollerApp, SIDESCROLLER } from "./sidescroller-app.js";
import type { App, Entity, MemorySink } from "@ignifx/core";

/**
 * `templates/2d-sidescroller` is editor-ready (ignifx-editor plan, engine ask E2): its level is
 * `assets/scenes/main.scene.json`, loaded by a boilerplate `main.ts`. `entry-rules.test.ts` checks
 * the entry's imports for all four templates.
 */

/** The level's address, as `main.ts` loads it. */
const MAIN_SCENE = "scenes/main.scene.json";

/** The level as it sits on disk. */
const SCENE_TEXT = readFileSync(join(SIDESCROLLER.assetDir, MAIN_SCENE), "utf8");

/** The parallax bands: the sorting layer each one slows down, and how many strips it places. */
const BANDS: readonly (readonly [string, number])[] = [
  ["Sky", 1],
  ["Hills", 5],
  ["Trees", 5],
];

/** How many coins the tilemap's objects layer used to spawn. */
const COIN_COUNT = 18;

/** Every entity of the level, in tree order. */
const EXPECTED_ENTITIES: readonly string[] = [
  ...BANDS.flatMap(([band, copies]) => [
    `Parallax ${band}`,
    ...Array.from({ length: copies }, (_, index) => `${band} ${String(index)}`),
  ]),
  "Level",
  "Player",
  ...Array.from({ length: COIN_COUNT }, (_, index) => `Coin ${String(index + 1)}`),
  "Main Camera",
];

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
  const { app, sink } = await createSidescrollerApp();
  apps.push(app);
  const instance = await app.world.loadScene(MAIN_SCENE);
  return { app, sink, entities: entitiesInTreeOrder(instance) };
}

describe("2d-sidescroller's scene file", () => {
  it("validates against the scene format", () => {
    expect(validateSceneFile(JSON.parse(SCENE_TEXT))).toEqual([]);
  });

  it("loads headless through the template's own extensions and scripts", async () => {
    const { app, sink, entities } = await loadLevel();

    expect(entities.map((entity) => entity.name)).toEqual(EXPECTED_ENTITIES);
    // A dangling reference, an unknown layer or an unresolved asset is a warning, not a throw.
    expect(sink.toArray().filter((record) => record.level === "warn" || record.level === "error")).toEqual([]);

    const player = named(entities, "Player");
    expect(player.transform.position2D).toMatchObject({ x: 2.5, y: 3 });
    const camera = named(entities, "Main Camera");
    expect(field(camera, "ignifx/Camera2D", "follow")).toBe(player);
    expect(field(camera, "ignifx/Camera2D", "pixelPerfect")).toBe(true);
    // The tilemap's objects layer spawns nothing: no factory is registered.
    expect(app.world.findByName("Player")).toBe(player);

    // Each strip draws its band's frame, which `SpriteFrame` resolved by name in `awake`.
    for (const [band, copies] of BANDS) {
      expect(field(named(entities, `Parallax ${band}`), "ignifx/ParallaxLayer", "sortingLayer")).toBe(band);
      for (let index = 0; index < copies; index += 1) {
        const strip = named(entities, `${band} ${String(index)}`);
        const frame = band.toLowerCase();
        const sprite = strip.components.find((component) => Reflect.get(component, "sprite") !== undefined);
        const atlas = Reflect.get(Reflect.get(sprite as object, "sprite") as object, "value") as {
          requireFrame(name: string): number;
        };
        expect(field(strip, "sidescroller/SpriteFrame", "frame")).toBe(frame);
        expect(Reflect.get(sprite as object, "frame")).toBe(atlas.requireFrame(frame));
      }
    }
  });

  it("round-trips byte for byte through serializeScene and stringifySceneFile", async () => {
    const { app } = await createSidescrollerApp();
    apps.push(app);
    const instance = await app.world.loadScene(MAIN_SCENE);

    // The template's file records no `engineVersion`: core stamps its own version by default, and
    // a file that changed with every release could never round-trip. `null` keeps it out.
    const text = stringifySceneFile(serializeScene(instance, { engineVersion: null }));

    expect(text).toBe(SCENE_TEXT);
  });
});
