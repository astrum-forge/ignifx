import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MeshAsset, MeshRenderer, serializeScene, stringifySceneFile, validateSceneFile } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { entitiesInTreeOrder, field, named } from "./headless-app.js";
import { createThirdPersonApp, THIRD_PERSON } from "./third-person-app.js";
import type { App, Entity, MemorySink } from "@ignifx/core";

/**
 * `templates/3d-third-person` is editor-ready (ignifx-editor plan, engine ask E2): its level is
 * `assets/scenes/main.scene.json`, loaded by a boilerplate `main.ts`. `entry-rules.test.ts` checks
 * the entry's imports for all four templates.
 */

/** The level's address, as `main.ts` loads it. */
const MAIN_SCENE = "scenes/main.scene.json";

/** The level as it sits on disk. */
const SCENE_TEXT = readFileSync(join(THIRD_PERSON.assetDir, MAIN_SCENE), "utf8");

/** Every entity of the level, in tree order. */
const EXPECTED_ENTITIES: readonly string[] = [
  "Sky",
  "Sun",
  "Fill",
  "Floor",
  ...[0, 1, 2, 3, 4, 5].flatMap((index) => ["N", "S", "W", "E"].map((side) => `Wall ${side}${String(index)}`)),
  "Stub A",
  "Stub B",
  ...[0, 1, 2, 3, 4, 5].map((index) => `Crate ${String(index)}`),
  ...[0, 1, 2].flatMap((index) => [
    `Beacon ${String(index)}`,
    `Beacon ${String(index)} Column`,
    `Beacon ${String(index)} Light`,
  ]),
  "Player",
  "Player Body",
  "Companion",
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
  const { app, sink } = await createThirdPersonApp();
  apps.push(app);
  const instance = await app.world.loadScene(MAIN_SCENE);
  return { app, sink, entities: entitiesInTreeOrder(instance) };
}

describe("3d-third-person's scene file", () => {
  it("validates against the scene format", () => {
    expect(validateSceneFile(JSON.parse(SCENE_TEXT))).toEqual([]);
  });

  it("loads headless through the template's own extensions and scripts", async () => {
    const { sink, entities } = await loadLevel();

    expect(entities.map((entity) => entity.name)).toEqual(EXPECTED_ENTITIES);
    // A dangling reference, an unknown layer or an unresolved asset is a warning, not a throw.
    expect(sink.toArray().filter((record) => record.level === "warn" || record.level === "error")).toEqual([]);

    const player = named(entities, "Player");
    expect(player.transform.position).toMatchObject({ x: 0, y: 0.75, z: -3 });
    expect(field(named(entities, "Companion"), "third-person/Companion", "target")).toBe(player);
    expect(field(named(entities, "Main Camera"), "ignifx/ThirdPersonCamera", "target")).toBe(player);
    for (const index of [0, 1, 2]) {
      const beacon = named(entities, `Beacon ${String(index)}`);
      expect(field(beacon, "third-person/Beacon", "player")).toBe(player);
      const lit = field(beacon, "third-person/Beacon", "column");
      expect(lit).toBe(named(entities, `Beacon ${String(index)} Light`).components[1]);
      // A beacon starts dark: the lit column is authored disabled.
      expect(Reflect.get(lit as object, "enabled")).toBe(false);
    }
  });

  // ignifx-editor plan, engine ask E15: `@ignifx/editor-host` builds the app from the extensions and
  // the scripts and loads the scene, with no game code in between. `createThirdPersonApp` does the
  // same, so every primitive has to come from a `.mesh.json` file the scene names.
  it("resolves every MeshRenderer's mesh from a .mesh.json file, with no code publishing one first", async () => {
    const { entities } = await loadLevel();

    const renderers = entities.flatMap((entity) => entity.getComponent(MeshRenderer) ?? []);
    expect(renderers).toHaveLength(43);
    for (const renderer of renderers) {
      expect(renderer.mesh?.state).toBe("loaded");
      expect(renderer.mesh?.value).toBeInstanceOf(MeshAsset);
      expect(renderer.mesh?.address).toMatch(/^meshes\/[a-z-]+\.mesh\.json$/u);
    }
    expect(new Set(renderers.map((renderer) => renderer.mesh?.address)).size).toBe(7);
  });

  it("round-trips byte for byte through serializeScene and stringifySceneFile", async () => {
    const { app } = await createThirdPersonApp();
    apps.push(app);
    const instance = await app.world.loadScene(MAIN_SCENE);

    // The template's file records no `engineVersion`: core stamps its own version by default, and
    // a file that changed with every release could never round-trip. `null` keeps it out.
    const text = stringifySceneFile(serializeScene(instance, { engineVersion: null }));

    expect(text).toBe(SCENE_TEXT);
  });
});
