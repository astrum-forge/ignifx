import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CliError, convertTilemapSource, DEFAULT_TILEMAP_SOURCE_LIMITS } from "../src/tilemap.js";
import type { TilemapSourceReader } from "../src/tilemap.js";

/**
 * `@ignifx/cli/tilemap`: the pure converter behind `ignifx import tilemap`. It reads through the
 * callback it is given and returns the documents; the committed expected outputs are what the file
 * wrapper writes, so a byte match here is the same conversion.
 */

/** The import fixtures. */
const IMPORT = fileURLToPath(new URL("../../../tests/fixtures/assets/2d/import/", import.meta.url));

/**
 * Every file under a folder, by POSIX path relative to it.
 *
 * @param root - The folder.
 * @returns Path to text.
 */
async function filesUnder(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      // oxlint-disable-next-line no-await-in-loop -- a handful of small fixtures.
      files.set(relative(root, path).split(sep).join("/"), await readFile(path, "utf8"));
    }
  }
  return files;
}

/**
 * A reader over an in-memory file set that records what it was asked for.
 *
 * @param files - Path to text.
 * @returns The reader and the paths it read.
 */
function memoryReader(files: ReadonlyMap<string, string>): {
  readonly read: TilemapSourceReader;
  readonly asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    read: async (path) => {
      asked.push(path);
      return files.get(path) ?? null;
    },
  };
}

/**
 * A one-layer Tiled map with an embedded tileset.
 *
 * @param patch - Fields to override on the map.
 * @param tileset - Fields to override on the tileset.
 * @returns The map's text.
 */
function tinyMap(
  patch: Readonly<Record<string, unknown>> = {},
  tileset: Readonly<Record<string, unknown>> = {},
): string {
  return JSON.stringify({
    type: "map",
    orientation: "orthogonal",
    width: 2,
    height: 1,
    tilewidth: 16,
    tileheight: 16,
    tilesets: [
      { firstgid: 1, name: "t", image: "t.png", tilewidth: 16, tileheight: 16, columns: 1, tilecount: 1, ...tileset },
    ],
    layers: [{ type: "tilelayer", name: "L", width: 2, height: 1, data: [1, 0] }],
    ...patch,
  });
}

/**
 * A reader that finds nothing.
 *
 * @returns `null`.
 */
async function nothing(): Promise<string | null> {
  return null;
}

/**
 * Runs a conversion that must fail and returns the error.
 *
 * @param run - The conversion.
 * @returns The `CliError`.
 */
async function failure(run: Promise<unknown>): Promise<CliError> {
  const error: unknown = await run.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof CliError)) {
    throw new Error(`Expected a CliError, got ${String(error)}`);
  }
  return error;
}

describe("convertTilemapSource", () => {
  it("converts the Tiled fixture to the committed outputs without touching the file system", async () => {
    const files = await filesUnder(join(IMPORT, "tiled"));
    const expected = await filesUnder(join(IMPORT, "expected", "tiled"));
    const { read, asked } = memoryReader(files);
    const result = await convertTilemapSource(files.get("level.tmj") ?? "", "tiled", read, { path: "level.tmj" });
    expect(result.documents.map(({ path, kind }) => ({ path, kind }))).toEqual([
      { path: "level.tilemap.json", kind: "tilemap" },
      { path: "tilesets/terrain.atlas.json", kind: "atlas" },
    ]);
    for (const document of result.documents) {
      expect(document.text, document.path).toBe(expected.get(document.path));
      expect(JSON.parse(document.text)).toEqual(document.json);
    }
    expect(asked).toEqual(["tilesets/terrain.tsj", "tilesets/terrain.atlas.json"]);
    expect(result.warnings).toEqual([
      'Skipped the layer "Reference" (imagelayer): a tilemap holds tile layers and objects only.',
    ]);
  });

  it("resolves everything against the map's path under a base folder, and writes the output there", async () => {
    const tiled = await filesUnder(join(IMPORT, "tiled"));
    const files = new Map([...tiled].map(([path, text]) => [`assets/maps/${path}`, text]));
    const { read, asked } = memoryReader(files);
    const result = await convertTilemapSource(files.get("assets/maps/level.tmj") ?? "", "tiled", read, {
      path: "assets/maps/level.tmj",
      output: "assets/levels/level.tilemap.json",
      exists: async () => false,
    });
    expect(asked[0]).toBe("assets/maps/tilesets/terrain.tsj");
    expect(result.documents.map((document) => document.path)).toEqual([
      "assets/levels/level.tilemap.json",
      "assets/maps/tilesets/terrain.atlas.json",
    ]);
    const tilesets = result.documents[0]?.json["tilesets"];
    expect(Array.isArray(tilesets) ? tilesets[0] : null).toMatchObject({
      atlas: "../maps/tilesets/terrain.atlas.json",
    });
    expect(result.warnings).toContain(
      "The tileset image assets/maps/tilesets/terrain.png does not exist yet; its atlas names it anyway.",
    );
  });

  it("converts every level of the LDtk fixture, reading the external level through the callback", async () => {
    const files = await filesUnder(join(IMPORT, "ldtk"));
    const expected = await filesUnder(join(IMPORT, "expected", "ldtk"));
    const { read } = memoryReader(files);
    const result = await convertTilemapSource(files.get("world.ldtk") ?? "", "ldtk", read, { path: "world.ldtk" });
    expect(result.documents.length).toBeGreaterThan(1);
    for (const document of result.documents) {
      expect(document.text, document.path).toBe(expected.get(document.path));
    }
  });

  it("keeps an existing atlas, and fails with IGX-1405 when a referenced tileset is missing", async () => {
    const atlas = JSON.stringify({ format: "ignifx.spriteatlas", frames: [{ name: "t_0" }] });
    const kept = await convertTilemapSource(tinyMap(), "tiled", async (path) =>
      path === "t.atlas.json" ? atlas : null,
    );
    expect(kept.documents.map((document) => document.kind)).toEqual(["tilemap"]);
    expect(kept.documents[0]?.path).toBe("map.tilemap.json");

    const missing = await failure(
      convertTilemapSource(tinyMap({ tilesets: [{ firstgid: 1, source: "gone.tsj" }] }), "tiled", async () => null),
    );
    expect(missing.code).toBe("IGX-1405");
    expect(missing.message).toContain('"gone.tsj"');
  });

  it("refuses an output above the base folder, and a non-positive scale, with IGX-1403", async () => {
    const read = nothing;
    expect(
      (await failure(convertTilemapSource(tinyMap(), "tiled", read, { output: "../out.tilemap.json" }))).code,
    ).toBe("IGX-1403");
    expect((await failure(convertTilemapSource(tinyMap(), "tiled", read, { pixelsPerUnit: 0 }))).code).toBe("IGX-1403");
  });

  it("caps what a hostile map could make it allocate, with IGX-1408 naming the limit", async () => {
    const read = nothing;
    const cases: readonly (readonly [string, string, "tiled" | "ldtk"])[] = [
      [tinyMap({ width: 1e6, height: 1e6 }), "maxLayerCells", "tiled"],
      [tinyMap({}, { tilecount: 1e9 }), "maxTilesetTiles", "tiled"],
      [
        tinyMap({ layers: [{ type: "tilelayer", name: "L", width: 1e5, height: 1e5, data: [] }] }),
        "maxLayerCells",
        "tiled",
      ],
      [
        JSON.stringify({
          defs: { tilesets: [], layers: [] },
          levels: [
            {
              identifier: "Huge",
              pxWid: 16,
              pxHei: 16,
              layerInstances: [
                { __type: "IntGrid", __identifier: "C", __gridSize: 16, __cWid: 1e6, __cHei: 1e6, intGridCsv: [1] },
              ],
            },
          ],
        }),
        "maxLayerCells",
        "ldtk",
      ],
      [
        JSON.stringify({
          defs: { tilesets: [], layers: [] },
          levels: [
            {
              identifier: "V",
              pxWid: 16,
              pxHei: 16,
              layerInstances: [{ __type: "IntGrid", __gridSize: 16, intGridCsv: [1e9] }],
            },
          ],
        }),
        "maxTilesetTiles",
        "ldtk",
      ],
    ];
    for (const [text, limit, kind] of cases) {
      // oxlint-disable-next-line no-await-in-loop -- one case at a time keeps the failure readable.
      const error = await failure(convertTilemapSource(text, kind, read));
      expect(error.code, limit).toBe("IGX-1408");
      expect(error.message, limit).toContain(`(${limit})`);
    }
    const long = await failure(convertTilemapSource(tinyMap(), "tiled", read, { limits: { maxJsonLength: 10 } }));
    expect(long.message).toContain("(maxJsonLength)");
    const layers = await failure(convertTilemapSource(tinyMap(), "tiled", read, { limits: { maxLayers: 0 } }));
    expect(layers.message).toContain("(maxLayers)");
    const total = await failure(convertTilemapSource(tinyMap(), "tiled", read, { limits: { maxTotalCells: 2 } }));
    expect(total.message).toContain("(maxTotalCells)");
    expect(DEFAULT_TILEMAP_SOURCE_LIMITS.maxLayerCells).toBe(2048 * 2048);
  });
});
