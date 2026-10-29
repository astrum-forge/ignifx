import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CliError,
  IMPORT_TILEMAP_USAGE,
  parseImportTilemapArgs,
  runImportTilemap,
  type ImportIo,
} from "../src/index.js";

/**
 * `ignifx import tilemap` (ADR-0030): a tilemap's objects layer moves into a scene file once, as
 * entities, and leaves the map.
 */

let workspace = "";

/** A ULID: 26 Crockford base32 characters. */
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

/**
 * Collects the lines a command writes so assertions can read them back.
 *
 * @returns The sinks and the arrays behind them.
 */
function recordingIo(): ImportIo & { readonly out: string[]; readonly err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (line: string) => {
      out.push(line);
    },
    stderr: (line: string) => {
      err.push(line);
    },
  };
}

/** A 4x2 map with a spawn point and a prop, rows top first. */
const MAP = {
  format: "ignifx.tilemap",
  formatVersion: 1,
  tileWidth: 16,
  tileHeight: 16,
  cellSize: 1,
  width: 4,
  height: 2,
  tilesets: [{ name: "terrain", atlas: "tiles.atlas.json", firstId: 1, tiles: [{ id: 0, frame: "ground" }] }],
  layers: [
    { name: "Ground", sortingLayer: "Default", orderInLayer: 0, collision: true, tiles: [0, 0, 0, 0, 1, 1, 1, 1] },
  ],
  objects: [
    { type: "spawn", name: "Player", x: 1, y: 1, width: 0, height: 0, properties: {} },
    { type: "prop", name: "Chest", x: 2, y: 1, width: 1, height: 1, properties: { frame: "chest", locked: true } },
    { type: "coin", name: "", x: 0.1, y: 1.2, width: 0.3, height: 0.3 },
  ],
};

/** A scene with a level entity and its child, then a camera, in the engine's canonical form. */
const SCENE = {
  format: "ignifx.scene",
  formatVersion: 1,
  name: "main",
  settings: {},
  entities: [
    {
      uid: "01M5019D56QN4RE9MGE5CG2Y05",
      name: "Level",
      parent: null,
      transform: { position: [10, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      components: [{ uid: "01M5019D57GNWGM08AR6VY0BYX", type: "ignifx/Tilemap", props: {} }],
    },
    {
      uid: "01M5019D57GNWGM08AR6VY0BZ0",
      name: "Sign",
      parent: "01M5019D56QN4RE9MGE5CG2Y05",
      transform: { position: [1, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
    {
      uid: "01M5019D57GNWGM08AR6VY0BZ1",
      name: "Main Camera",
      parent: null,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    },
  ],
};

/**
 * Writes the map and the scene into the workspace.
 *
 * @param map - The map document.
 * @returns The two paths.
 */
async function writeFiles(map: unknown = MAP): Promise<{ readonly map: string; readonly scene: string }> {
  const paths = { map: join(workspace, "level.tilemap.json"), scene: join(workspace, "main.scene.json") };
  await writeFile(paths.map, `${JSON.stringify(map, null, 2)}\n`);
  await writeFile(paths.scene, JSON.stringify(SCENE, null, 2));
  return paths;
}

/**
 * Reads a JSON file back.
 *
 * @param path - The file.
 * @returns The parsed document.
 */
async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "ignifx-import-tilemap-"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("parseImportTilemapArgs", () => {
  it("reads the two paths and an optional parent", () => {
    expect(parseImportTilemapArgs(["a.tilemap.json", "b.scene.json"])).toEqual({
      map: "a.tilemap.json",
      scene: "b.scene.json",
      parent: null,
    });
    expect(parseImportTilemapArgs(["a.tilemap.json", "b.scene.json", "--parent", "Level"]).parent).toBe("Level");
  });

  it.each([[[]], [["a.tilemap.json"]], [["a", "b", "c"]], [["a", "b", "--parent", ""]], [["a", "b", "--nope"]]])(
    "refuses %j with IGX-1403 and the usage line",
    (argv: readonly string[]) => {
      expect(() => parseImportTilemapArgs(argv)).toThrow(CliError);
      try {
        parseImportTilemapArgs(argv);
      } catch (error) {
        expect((error as CliError).code).toBe("IGX-1403");
        expect((error as CliError).message).toContain(IMPORT_TILEMAP_USAGE);
      }
    },
  );
});

describe("runImportTilemap", () => {
  it("moves each object into the scene as a tagged entity at its centre, under the parent", async () => {
    const paths = await writeFiles();
    const io = recordingIo();
    const result = await runImportTilemap([paths.map, paths.scene, "--parent", "Level"], io);

    expect(result.entities.map((entity) => [entity.name, entity.type, entity.position])).toEqual([
      ["Player", "spawn", [1, 1]],
      ["Chest", "prop", [2.5, 1.5]],
      ["coin", "coin", [0.25, 1.35]],
    ]);
    const scene = await readJson(paths.scene);
    const entities = scene["entities"] as Record<string, unknown>[];
    // After the parent's subtree (Level, Sign), before the next root.
    expect(entities.map((entity) => entity["name"])).toEqual([
      "Level",
      "Sign",
      "Player",
      "Chest",
      "coin",
      "Main Camera",
    ]);
    const chest = entities[3];
    expect(chest).toEqual({
      uid: expect.stringMatching(ULID) as unknown,
      name: "Chest",
      parent: "01M5019D56QN4RE9MGE5CG2Y05",
      tags: ["prop"],
      transform: { position: [2.5, 1.5, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    });
    expect(Object.keys(chest ?? {})).toEqual(["uid", "name", "parent", "tags", "transform"]);
    const uids = entities.map((entity) => entity["uid"]);
    expect(new Set(uids).size).toBe(uids.length);

    // Size and properties have no place in a scene, so the command prints them.
    expect(io.out.join("\n")).toContain('Chest [prop] at 2.5, 1.5 (1 x 1 m, frame="chest", locked=true)');
    expect(io.err).toEqual([]);
  });

  it("prints a property named __proto__ like any other", async () => {
    const objects: unknown = JSON.parse(
      '[{ "type": "prop", "name": "Odd", "x": 0, "y": 0, "width": 1, "height": 1, "properties": { "__proto__": "odd" } }]',
    );
    const paths = await writeFiles({ ...MAP, objects });
    const io = recordingIo();
    await runImportTilemap([paths.map, paths.scene], io);
    expect(io.out.join("\n")).toContain('__proto__="odd"');
  });

  it("writes canonical scene text and removes the objects from the map", async () => {
    const paths = await writeFiles();
    await runImportTilemap([paths.map, paths.scene], recordingIo());

    const sceneText = await readFile(paths.scene, "utf8");
    expect(sceneText).toBe(JSON.stringify(JSON.parse(sceneText), null, 2));
    const entities = (JSON.parse(sceneText) as { entities: Record<string, unknown>[] }).entities;
    // No parent: roots appended at the end.
    expect(entities.slice(-3).map((entity) => entity["parent"])).toEqual([null, null, null]);

    const mapText = await readFile(paths.map, "utf8");
    const map = JSON.parse(mapText) as Record<string, unknown>;
    expect(map["objects"]).toBeUndefined();
    const { objects, ...rest } = MAP;
    expect(objects).toHaveLength(3);
    expect(map).toEqual(rest);
    // A list of plain values stays on one line, and the final newline is kept.
    expect(mapText).toContain('"tiles": [0, 0, 0, 0, 1, 1, 1, 1]');
    expect(mapText.endsWith("}\n")).toBe(true);
  });

  it("finds nothing to move the second time", async () => {
    const paths = await writeFiles();
    await runImportTilemap([paths.map, paths.scene], recordingIo());
    const sceneBefore = await readFile(paths.scene, "utf8");
    const io = recordingIo();
    const result = await runImportTilemap([paths.map, paths.scene], io);
    expect(result.entities).toEqual([]);
    expect(io.out).toEqual([`${paths.map} has no objects; nothing to import.`]);
    expect(await readFile(paths.scene, "utf8")).toBe(sceneBefore);
  });

  it("refuses a parent that names no entity, and writes nothing", async () => {
    const paths = await writeFiles();
    await expect(runImportTilemap([paths.map, paths.scene, "--parent", "Nope"], recordingIo())).rejects.toMatchObject({
      code: "IGX-1403",
    });
    expect((await readJson(paths.map))["objects"]).toHaveLength(3);
  });

  it("refuses a file that is not the document it expects with IGX-1407", async () => {
    const paths = await writeFiles({ ...MAP, format: "ignifx.scene" });
    await expect(runImportTilemap([paths.map, paths.scene], recordingIo())).rejects.toMatchObject({
      code: "IGX-1407",
    });
    await writeFile(paths.map, JSON.stringify({ ...MAP, objects: [{ name: 3 }] }));
    await expect(runImportTilemap([paths.map, paths.scene], recordingIo())).rejects.toMatchObject({
      code: "IGX-1407",
    });
    await writeFile(paths.map, "{ nope");
    await expect(runImportTilemap([paths.map, paths.scene], recordingIo())).rejects.toMatchObject({
      code: "IGX-1407",
    });
  });

  it("reports a missing file with IGX-1405", async () => {
    await expect(
      runImportTilemap([join(workspace, "missing.tilemap.json"), join(workspace, "main.scene.json")], recordingIo()),
    ).rejects.toMatchObject({ code: "IGX-1405" });
  });
});
