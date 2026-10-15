import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { MeshAsset, MeshRenderer, serializeScene, stringifySceneFile, validateSceneFile } from "@ignifx/core";
import { afterEach, describe, expect, it } from "vitest";
import { ASSET_DIR, createThirdPersonApp, TEMPLATE_DIR } from "./third-person-app.js";
import type { App, Component, Entity, MemorySink } from "@ignifx/core";

/**
 * `templates/3d-third-person` is editor-ready (ignifx-editor plan, engine ask E2): its level is
 * `assets/scenes/main.scene.json`, loaded by a boilerplate `main.ts`, and no module the entry
 * imports reaches a script except through `virtual:ignifx/scripts`.
 */

/** The level's address, as `main.ts` loads it. */
const MAIN_SCENE = "scenes/main.scene.json";

/** The level as it sits on disk. */
const SCENE_TEXT = readFileSync(join(ASSET_DIR, MAIN_SCENE), "utf8");

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
  const entities: Entity[] = [];
  const visit = (entity: Entity): void => {
    entities.push(entity);
    for (const child of entity.children) {
      visit(child);
    }
  };
  for (const root of instance.roots) {
    visit(root);
  }
  return { app, sink, entities };
}

/**
 * The one entity of a list with a given name.
 *
 * @param entities - Where to look.
 * @param name - The name.
 * @returns The entity.
 */
function named(entities: readonly Entity[], name: string): Entity {
  const found = entities.find((entity) => entity.name === name);
  if (found === undefined) {
    throw new Error(`no entity named ${name}`);
  }
  return found;
}

/**
 * Reads a schema field off a component by name, as a scene file names it.
 *
 * @param entity - The entity.
 * @param typeId - The component's type id.
 * @param name - The field.
 * @returns The field's value.
 */
function field(entity: Entity, typeId: string, name: string): unknown {
  const component = entity.components.find(
    (candidate: Component) => entity.world.registry.describe(candidate.constructor).typeId === typeId,
  );
  if (component === undefined) {
    throw new Error(`${entity.name} has no ${typeId}`);
  }
  return Reflect.get(component, name);
}

/**
 * Every TypeScript file under a directory, recursively.
 *
 * @param directory - Where to start.
 * @returns Absolute paths.
 */
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(directory, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(directory, entry.name)]
        : [],
  );
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

describe("3d-third-person's entry", () => {
  const source = join(TEMPLATE_DIR, "src");

  it("has no level.ts: the level is the scene file", () => {
    expect(existsSync(join(source, "level.ts"))).toBe(false);
  });

  it("publishes no asset in code: the primitive meshes are files", () => {
    expect(existsSync(join(source, "level-meshes.ts"))).toBe(false);
    const publishers = sources(source).filter((file) => /\bassets\.register\(/u.test(readFileSync(file, "utf8")));
    expect(publishers).toEqual([]);
  });

  // ignifx-editor spike S0.1 §6: an edit to a script that a module of the entry imports at run time
  // dead-ends at `main.ts` and reloads every page on the dev server. `import type` is erased first.
  it("reaches src/scripts/** only through virtual:ignifx/scripts", () => {
    const offenders: string[] = [];
    for (const file of sources(source)) {
      const path = relative(source, file);
      if (path.startsWith("scripts/")) {
        continue;
      }
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\bimport\s*(type\s)?[^;"']*?["']([^"']+)["']/gu)) {
        const isTypeOnly = match[1] !== undefined;
        const specifier = match[2] ?? "";
        if (!isTypeOnly && /(?:^|\/)scripts\//u.test(specifier)) {
          offenders.push(`${path}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    expect(readFileSync(join(source, "main.ts"), "utf8")).toContain('from "virtual:ignifx/scripts"');
  });
});
