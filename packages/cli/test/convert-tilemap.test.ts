import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CliError,
  CONVERT_TILEMAP_USAGE,
  isTilemapSource,
  parseConvertTilemapArgs,
  runConvertTilemap,
  type ImportIo,
} from "../src/index.js";

/**
 * `ignifx import tilemap <map.tmj | project.ldtk>`: Tiled and LDtk files become `.tilemap.json`
 * documents and missing `.atlas.json` files. The expected outputs are committed under
 * `tests/fixtures/assets/2d/import/expected`, and `packages/2d/test/tilemap/cli-import.test.ts`
 * loads those same files through the engine's loaders, so a byte match here means a load there.
 */

/** The 2D fixture folder. */
const FIXTURES = fileURLToPath(new URL("../../../tests/fixtures/assets/2d/", import.meta.url));

/** The committed expected outputs. */
const EXPECTED = join(FIXTURES, "import", "expected");

let workspace = "";

/**
 * Collects the lines a command writes.
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

/**
 * Reads a file as text.
 *
 * @param path - The file.
 * @returns Its text.
 */
async function text(path: string): Promise<string> {
  return readFile(path, "utf8");
}

/**
 * Writes a JSON document into the workspace.
 *
 * @param name - The file name.
 * @param value - The document.
 * @returns The file's path.
 */
async function writeJson(name: string, value: unknown): Promise<string> {
  const path = join(workspace, name);
  await writeFile(path, JSON.stringify(value), "utf8");
  return path;
}

/**
 * A one-layer Tiled map with an embedded tileset, for the refusal tests.
 *
 * @param patch - Fields to override on the map.
 * @param data - The layer's data.
 * @returns The map.
 */
function tinyTiledMap(patch: Readonly<Record<string, unknown>>, data: unknown = [1, 0]): Record<string, unknown> {
  return {
    type: "map",
    orientation: "orthogonal",
    width: 2,
    height: 1,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [
      {
        firstgid: 1,
        name: "t",
        image: "t.png",
        imagewidth: 16,
        imageheight: 16,
        tilewidth: 16,
        tileheight: 16,
        columns: 1,
        tilecount: 1,
      },
    ],
    layers: [{ type: "tilelayer", name: "L", width: 2, height: 1, data }],
    ...patch,
  };
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "ignifx-convert-tilemap-"));
  await cp(join(FIXTURES, "import", "tiled"), join(workspace, "tiled"), { recursive: true });
  await cp(join(FIXTURES, "import", "ldtk"), join(workspace, "ldtk"), { recursive: true });
  await cp(join(FIXTURES, "hero.png"), join(workspace, "tiled", "tilesets", "terrain.png"));
  await cp(join(FIXTURES, "hero.png"), join(workspace, "ldtk", "cave.png"));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("parseConvertTilemapArgs", () => {
  it("reads the source, the output and the options", () => {
    expect(
      parseConvertTilemapArgs(["a/cave.tmj", "out/cave.tilemap.json", "--pixels-per-unit", "16", "--drop-flips"]),
    ).toEqual({
      source: "a/cave.tmj",
      kind: "tiled",
      output: "out/cave.tilemap.json",
      pixelsPerUnit: 16,
      dropFlips: true,
    });
    expect(parseConvertTilemapArgs(["world.LDTK"])).toEqual({
      source: "world.LDTK",
      kind: "ldtk",
      output: null,
      pixelsPerUnit: 100,
      dropFlips: false,
    });
  });

  it("refuses bad command lines with IGX-1403 and the usage", () => {
    for (const argv of [
      [],
      ["map.tilemap.json"],
      ["a.tmj", "b.json"],
      ["a.tmj", "b.tilemap.json", "c"],
      ["a.tmj", "--pixels-per-unit", "0"],
      ["a.tmj", "--pixels-per-unit", "many"],
      ["a.tmj", "--bogus"],
    ]) {
      let caught: unknown = null;
      try {
        parseConvertTilemapArgs(argv);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CliError);
      expect((caught as CliError).code).toBe("IGX-1403");
      expect((caught as CliError).message).toContain(CONVERT_TILEMAP_USAGE);
    }
  });

  it("recognises .tmj and .ldtk sources only", () => {
    expect(isTilemapSource("maps/cave.tmj")).toBe(true);
    expect(isTilemapSource("world.ldtk")).toBe(true);
    expect(isTilemapSource("level.tilemap.json")).toBe(false);
    expect(isTilemapSource("cave.tmx")).toBe(false);
  });
});

describe("runConvertTilemap on a Tiled map", () => {
  it("writes the expected tilemap and atlas, resolving the external .tsj tileset", async () => {
    const io = recordingIo();
    const result = await runConvertTilemap([join(workspace, "tiled", "level.tmj")], io);
    const tilemap = join(workspace, "tiled", "level.tilemap.json");
    const atlas = join(workspace, "tiled", "tilesets", "terrain.atlas.json");
    expect(result.tilemaps).toEqual([tilemap]);
    expect(result.atlases).toEqual([atlas]);
    expect(await text(tilemap)).toBe(await text(join(EXPECTED, "tiled", "level.tilemap.json")));
    expect(await text(atlas)).toBe(await text(join(EXPECTED, "tiled", "tilesets", "terrain.atlas.json")));
    expect(io.err).toEqual([
      'warning: Skipped the layer "Reference" (imagelayer): a tilemap holds tile layers and objects only.',
    ]);
  });

  it("writes the same bytes on a second run and keeps the atlas it wrote", async () => {
    const source = join(workspace, "tiled", "level.tmj");
    await runConvertTilemap([source], recordingIo());
    const first = await text(join(workspace, "tiled", "level.tilemap.json"));
    const again = await runConvertTilemap([source], recordingIo());
    expect(again.atlases).toEqual([]);
    expect(again.warnings).toHaveLength(1);
    expect(await text(join(workspace, "tiled", "level.tilemap.json"))).toBe(first);
  });

  it("keeps an existing atlas and warns when it lacks the tileset's frames", async () => {
    const atlas = join(workspace, "tiled", "tilesets", "terrain.atlas.json");
    const mine = JSON.stringify({
      format: "ignifx.spriteatlas",
      image: "terrain.png",
      frames: [{ name: "grass", x: 0, y: 0, w: 32, h: 32 }],
    });
    await writeFile(atlas, mine, "utf8");
    const result = await runConvertTilemap([join(workspace, "tiled", "level.tmj")], recordingIo());
    expect(await text(atlas)).toBe(mine);
    expect(result.warnings.some((line) => line.includes('lacks 4 frame(s) tileset "terrain" uses'))).toBe(true);
  });

  it("writes to an explicit output path with atlas references relative to it", async () => {
    const out = join(workspace, "out", "maps", "cave.tilemap.json");
    await runConvertTilemap([join(workspace, "tiled", "level.tmj"), out, "--pixels-per-unit", "32"], recordingIo());
    const document = JSON.parse(await text(out)) as {
      readonly cellSize: number;
      readonly tilesets: readonly { readonly atlas: string }[];
      readonly objects: readonly { readonly x: number }[];
    };
    expect(document.cellSize).toBe(1);
    expect(document.tilesets[0]?.atlas).toBe("../../tiled/tilesets/terrain.atlas.json");
    expect(document.objects[0]?.x).toBe(0.5);
  });

  it("refuses flipped tiles with IGX-1408, and imports them unflipped with --drop-flips", async () => {
    const flipped = 0x80000001;
    const source = await writeJson("flip.tmj", tinyTiledMap({}, [flipped, 0]));
    await expect(runConvertTilemap([source], recordingIo())).rejects.toMatchObject({
      code: "IGX-1408",
      message: expect.stringContaining("--drop-flips") as unknown,
    });
    const result = await runConvertTilemap([source, "--drop-flips"], recordingIo());
    const document = JSON.parse(await text(join(workspace, "flip.tilemap.json"))) as {
      readonly layers: readonly { readonly tiles: readonly number[] }[];
    };
    expect(document.layers[0]?.tiles).toEqual([1, 0]);
    expect(result.warnings).toContain('Layer "L": 1 flipped or rotated tile(s) imported unflipped.');
  });

  it("refuses what the tilemap format cannot hold with IGX-1408", async () => {
    const cases: readonly Record<string, unknown>[] = [
      tinyTiledMap({ orientation: "isometric" }),
      tinyTiledMap({ infinite: true }),
      tinyTiledMap({}, "AQAAAA=="),
      tinyTiledMap({ tilesets: [{ firstgid: 1, source: "t.tsx" }] }),
      tinyTiledMap({ tilesets: [{ firstgid: 1, name: "images", tilecount: 1, tiles: [{ id: 0, image: "a.png" }] }] }),
    ];
    await Promise.all(
      cases.map(async (map, index) => {
        const source = await writeJson(`refuse-${String(index)}.tmj`, map);
        await expect(runConvertTilemap([source], recordingIo())).rejects.toMatchObject({ code: "IGX-1408" });
      }),
    );
  });

  it("reports an unreadable source with IGX-1405 and a non-JSON one with IGX-1407", async () => {
    await expect(runConvertTilemap([join(workspace, "missing.tmj")], recordingIo())).rejects.toMatchObject({
      code: "IGX-1405",
    });
    const broken = join(workspace, "broken.tmj");
    await writeFile(broken, "{ not json", "utf8");
    await expect(runConvertTilemap([broken], recordingIo())).rejects.toMatchObject({ code: "IGX-1407" });
  });
});

describe("runConvertTilemap on an LDtk project", () => {
  it("writes one expected tilemap per level, external levels included, and the atlas", async () => {
    const io = recordingIo();
    const result = await runConvertTilemap([join(workspace, "ldtk", "world.ldtk")], io);
    expect(result.tilemaps).toEqual([
      join(workspace, "ldtk", "Level_0.tilemap.json"),
      join(workspace, "ldtk", "Level_1.tilemap.json"),
    ]);
    expect(result.atlases).toEqual([join(workspace, "ldtk", "cave.atlas.json")]);
    const names = ["Level_0.tilemap.json", "Level_1.tilemap.json", "cave.atlas.json"];
    const written = await Promise.all(names.map(async (name) => text(join(workspace, "ldtk", name))));
    const expected = await Promise.all(names.map(async (name) => text(join(EXPECTED, "ldtk", name))));
    expect(written).toEqual(expected);
    expect(io.err).toEqual([
      'warning: Layer "Shadows" in level "Level_0": 1 stacked tile(s) dropped; a cell holds one tile.',
    ]);
  });

  it("writes into an output folder", async () => {
    const out = join(workspace, "levels");
    await runConvertTilemap([join(workspace, "ldtk", "world.ldtk"), out], recordingIo());
    const document = JSON.parse(await text(join(out, "Level_1.tilemap.json"))) as {
      readonly tilesets: readonly { readonly atlas: string }[];
    };
    expect(document.tilesets[0]?.atlas).toBe("../ldtk/cave.atlas.json");
  });

  it("refuses flipped tiles with IGX-1408 unless --drop-flips is passed", async () => {
    const project = JSON.parse(await text(join(workspace, "ldtk", "world.ldtk"))) as {
      levels: { layerInstances: { gridTiles: { f: number }[] }[] | null }[];
    };
    const decor = project.levels[0]?.layerInstances?.[2]?.gridTiles[0];
    if (decor === undefined) {
      throw new Error("The fixture lost its Decor tile.");
    }
    decor.f = 1;
    const source = join(workspace, "ldtk", "flipped.ldtk");
    await writeFile(source, JSON.stringify(project), "utf8");
    await expect(runConvertTilemap([source], recordingIo())).rejects.toMatchObject({ code: "IGX-1408" });
    const result = await runConvertTilemap([source, "--drop-flips"], recordingIo());
    expect(result.warnings).toContain('Layer "Decor" in level "Level_0": 1 flipped tile(s) imported unflipped.');
  });

  it("refuses an unknown layer type and a project with no levels with IGX-1408", async () => {
    const noLevels = await writeJson("empty.ldtk", { defs: { tilesets: [], layers: [] }, levels: [] });
    await expect(runConvertTilemap([noLevels], recordingIo())).rejects.toMatchObject({ code: "IGX-1408" });
    const odd = await writeJson("odd.ldtk", {
      defs: { tilesets: [], layers: [] },
      levels: [{ identifier: "L", pxWid: 16, pxHei: 16, layerInstances: [{ __identifier: "X", __type: "Mystery" }] }],
    });
    await expect(runConvertTilemap([odd], recordingIo())).rejects.toMatchObject({ code: "IGX-1408" });
  });
});

describe("the 2D package's own fixtures", () => {
  it("convert to the committed outputs the 2D importer drift test compares against", async () => {
    const folder = join(workspace, "sample");
    await cp(join(FIXTURES, "sample.tmj"), join(folder, "sample.tmj"));
    await cp(join(FIXTURES, "sample.ldtk"), join(folder, "sample.ldtk"));
    await runConvertTilemap([join(folder, "sample.tmj")], recordingIo());
    await runConvertTilemap([join(folder, "sample.ldtk"), "--drop-flips"], recordingIo());
    const names = ["sample.tilemap.json", "Level_0.tilemap.json"];
    const written = await Promise.all(names.map(async (name) => text(join(folder, name))));
    const expected = await Promise.all(names.map(async (name) => text(join(EXPECTED, "sample", name))));
    expect(written).toEqual(expected);
  });
});
