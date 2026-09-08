// Writes every file the four 2D examples load into `website/examples/assets/2d/`. Run it from the
// repository root, after fetching the two Kenney sheets the way
// `website/examples/assets/README.md` records:
//
//   pnpm --filter @ignifx/website exec node examples/tilemap/tools/build-2d-assets.ts \
//     --tiny-town /tmp/kenney/tiny-town/Tilemap/tilemap.png \
//     --pixel-platformer /tmp/kenney/pixel-platformer/Tilemap/tilemap.png
//
// ## Why the four 2D examples share one generator, and why it lives here
//
// `website/examples/_tools/` belongs to the examples pipeline rather than to an example author
// (`website/plan/08-execution.md` §5), and a new directory directly under `website/examples/` is
// refused by `website/test/site.test.ts` because it has no catalogue entry. An example-local helper
// is what is left, so it sits in the directory of the example that needs the whole pipeline —
// `tilemap` — and serves `sprite-animation`, `platformer-controller` and `physics-2d` too, because
// they share its sheets.
//
// ## What it does, and what it deliberately does not do
//
// Three kinds of work, each of them the documented ignifx way of getting art into the engine:
//
// 1. **Crops** each Kenney sheet to the rectangular sub-grid the examples actually draw from, so
//    only the tiles in use are vendored (`04-examples-platform.md` §5.1). A rectangular crop keeps
//    the grid intact, which is what lets `gridAtlas` address it.
// 2. **Cuts** every grid sheet into an `ignifx.spriteatlas` document with `gridAtlas`. The frame
//    names are `<namePrefix>_<index>`, which is exactly what `@ignifx/2d`'s Tiled importer emits
//    for a tileset of that name — that contract is what lets `TilemapRenderer` resolve a tile's
//    sprite with no side table.
// 3. **Converts** each hand-authored Tiled map with `importTiledMap`, then run-length encodes its
//    layers. The importer is a pure function over parsed JSON with no file system, no network and
//    no asset system, so it belongs in a build step rather than in a game's first frame: the
//    runtime loads the `ignifx.tilemap` document it produced.
//
// It does not resample, recolour or repack anything: every pixel it writes came out of a source
// image unchanged, so a digest of an output is a digest of a crop.
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { encodeTileRle, gridAtlas, importTiledMap } from "ignifx";
import sharp from "sharp";
import type { SpriteAtlasDefinition, TilemapDefinition, TilemapLayerInput } from "ignifx";

/** The `website/examples` directory, two levels above this file's own directory. */
const EXAMPLES = path.resolve(import.meta.dirname, "..", "..");

/** Where every file this script writes lands. */
const OUT = path.join(EXAMPLES, "assets", "2d");

/** The repository root. */
const REPO = path.resolve(EXAMPLES, "..", "..");

/** One rectangular crop of a grid sheet, in cells. */
interface Crop {
  /** How many columns of the grid to keep, counting from the left. */
  readonly columns: number;
  /** How many rows to keep, counting from the top. */
  readonly rows: number;
  /** One cell's size, in pixels. Square in both packs. */
  readonly cell: number;
  /** The gap between adjacent cells, in pixels. */
  readonly spacing: number;
}

/**
 * The Kenney **Tiny Town** crop: the first eight rows of the sheet — grass, dirt, trees, roofs,
 * walls, doors and fences — which is everything the village is built from. The three rows left
 * behind are castle walls, arches and inventory props.
 */
const TINY_TOWN: Crop = { columns: 12, rows: 8, cell: 16, spacing: 1 };

/**
 * The Kenney **Pixel Platformer** crop: the first twelve columns of the first eight rows, which
 * holds the ground tiles, the crates, the planks and the coin. The eight columns left behind are
 * water, foliage and a number font.
 */
const PIXEL_PLATFORMER: Crop = { columns: 12, rows: 8, cell: 18, spacing: 1 };

/** The repository's own generated template art, copied rather than regenerated. */
const REPO_ART = {
  /** The top-down character: four facings, an eight-frame walk and a two-frame idle. */
  villager: "templates/2d-topdown/assets/hero",
  /** The side-on character: a four-frame idle, an eight-frame run, and a jump and fall pose. */
  runner: "templates/2d-sidescroller/assets/hero",
  /** The side-on terrain: ground, dirt, two slopes, a one-way plank, brick and two edges. */
  terrain: "templates/2d-sidescroller/assets/tiles",
} as const;

/**
 * The pixel size of a crop's output image.
 *
 * @param crop - The crop.
 * @returns The width and height in pixels.
 */
function cropSize(crop: Crop): { readonly width: number; readonly height: number } {
  const span = (count: number): number => count * (crop.cell + crop.spacing) - crop.spacing;
  return { width: span(crop.columns), height: span(crop.rows) };
}

/**
 * Reads a PNG's dimensions out of its IHDR chunk.
 *
 * @remarks
 * `sharp` could answer this, and does for the crops; this exists for the files that are copied
 * byte for byte, where loading them into an image pipeline only to ask their size would be the
 * long way round.
 *
 * @param file - The PNG's path.
 * @returns Its width and height in pixels.
 * @throws An `Error` when the file is not a PNG.
 */
async function pngSize(file: string): Promise<{ readonly width: number; readonly height: number }> {
  const bytes = await readFile(file);
  if (bytes.length < 24 || bytes.readUInt32BE(12) !== 0x49_48_44_52) {
    throw new Error(`${file} is not a PNG: its first chunk is not IHDR.`);
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * Writes a JSON document with a trailing newline, and reports it.
 *
 * @param name - The file's name inside `assets/2d/`.
 * @param value - The document.
 */
async function writeJson(name: string, value: unknown): Promise<void> {
  await writeFile(path.join(OUT, name), `${JSON.stringify(value, null, 2)}\n`);
  await report(name);
}

/**
 * Prints one output file's size and digest, which is what `ATTRIBUTION.md` records.
 *
 * @param name - The file's name inside `assets/2d/`.
 */
async function report(name: string): Promise<void> {
  const file = path.join(OUT, name);
  const [bytes, info] = await Promise.all([readFile(file), stat(file)]);
  const digest = createHash("sha256").update(bytes).digest("hex");
  process.stdout.write(`${`2d/${name}`.padEnd(30)} ${String(info.size).padStart(7)} bytes  ${digest}\n`);
}

/**
 * Crops one grid sheet and cuts the result into an atlas document.
 *
 * @param source - The sheet on disk.
 * @param stem - The output name, without an extension.
 * @param crop - How much of the grid to keep.
 * @param prefix - The `<prefix>_<index>` frame names, which is the tileset's name in a Tiled map.
 */
async function buildSheet(source: string, stem: string, crop: Crop, prefix: string): Promise<void> {
  const size = cropSize(crop);
  const cropped = await sharp(source)
    .extract({ left: 0, top: 0, width: size.width, height: size.height })
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();
  await writeFile(path.join(OUT, `${stem}.png`), cropped);
  await report(`${stem}.png`);
  await writeJson(
    `${stem}.atlas.json`,
    gridAtlas({
      // Relative, so the address resolves through the asset manifest and a content-hashed build
      // still finds the sheet (`packages/2d/src/atlas/loader.ts`, `resolveAtlasImageUrl`).
      image: `${stem}.png`,
      imageWidth: size.width,
      imageHeight: size.height,
      cellWidth: crop.cell,
      cellHeight: crop.cell,
      spacing: crop.spacing,
      namePrefix: prefix,
      // A texture's sampler is fixed at upload, so pixel art has to say so here; `pixelPerfect` on
      // the camera does not change it.
      sampling: "nearest",
    }) satisfies SpriteAtlasDefinition,
  );
}

/**
 * Copies one of the repository's own generated sheets and cuts it into a grid atlas.
 *
 * @param stem - The output name, without an extension.
 * @param source - The sheet's path under the repository root, without an extension.
 * @param cell - One cell's size in pixels.
 * @param margin - The border around the whole grid, in pixels.
 * @param spacing - The gap between adjacent cells, in pixels.
 * @param prefix - The frame-name prefix.
 */
async function copyGridSheet(
  stem: string,
  source: string,
  cell: number,
  margin: number,
  spacing: number,
  prefix: string,
): Promise<void> {
  const image = path.join(REPO, `${source}.png`);
  await copyFile(image, path.join(OUT, `${stem}.png`));
  await report(`${stem}.png`);
  const size = await pngSize(image);
  await writeJson(
    `${stem}.atlas.json`,
    gridAtlas({
      image: `${stem}.png`,
      imageWidth: size.width,
      imageHeight: size.height,
      cellWidth: cell,
      cellHeight: cell,
      margin,
      spacing,
      namePrefix: prefix,
      sampling: "nearest",
    }) satisfies SpriteAtlasDefinition,
  );
}

/**
 * Copies one of the repository's own generated characters: the sheet, its hand-packed atlas and its
 * clips, with each document's reference to the next rewritten to the new name.
 *
 * @remarks
 * The atlas is copied rather than re-cut, because its frames carry meaning — `idle_0`, `run_3`,
 * `jump` — and a grid atlas would name them `runner_0` to `runner_15`. A `.spriteanim.json`'s clips
 * address frames by name, so the names are the document.
 *
 * @param stem - The output name, without an extension.
 * @param source - The sheet's path under the repository root, without an extension.
 */
async function copyCharacter(stem: string, source: string): Promise<void> {
  await copyFile(path.join(REPO, `${source}.png`), path.join(OUT, `${stem}.png`));
  await report(`${stem}.png`);
  const atlas: unknown = JSON.parse(await readFile(path.join(REPO, `${source}.atlas.json`), "utf8"));
  if (typeof atlas !== "object" || atlas === null) {
    throw new Error(`${source}.atlas.json is not a JSON object.`);
  }
  await writeJson(`${stem}.atlas.json`, { ...atlas, image: `${stem}.png` });
  const clips: unknown = JSON.parse(await readFile(path.join(REPO, `${source}.spriteanim.json`), "utf8"));
  if (typeof clips !== "object" || clips === null) {
    throw new Error(`${source}.spriteanim.json is not a JSON object.`);
  }
  await writeJson(`${stem}.spriteanim.json`, { ...clips, atlas: `${stem}.atlas.json` });
}

/**
 * Run-length encodes every layer of an imported map, so the committed document is a grid rather
 * than a wall of zeros.
 *
 * @param map - What `importTiledMap` produced.
 * @returns The document to write.
 */
function packLayers(map: TilemapDefinition): unknown {
  const layers: TilemapLayerInput[] = [];
  for (const layer of map.layers) {
    layers.push({ ...layer, tiles: { rle: [...encodeTileRle(layer.tiles)] } });
  }
  return { ...map, layers };
}

/**
 * Converts one hand-authored Tiled map into an `ignifx.tilemap` document.
 *
 * @param slug - The example directory holding the `.tmj.json` source.
 * @param stem - Both the source's and the output's name, without an extension.
 * @param pixelsPerUnit - How many pixels one world metre spans, which fixes the map's `cellSize`.
 */
async function buildMap(slug: string, stem: string, pixelsPerUnit: number): Promise<void> {
  const source = path.join(EXAMPLES, slug, `${stem}.tmj.json`);
  const tmj: unknown = JSON.parse(await readFile(source, "utf8"));
  await writeJson(
    `${stem}.tilemap.json`,
    packLayers(
      importTiledMap(tmj, {
        pixelsPerUnit,
        // Every tile layer in both maps names its own sorting layer through a Tiled property, so
        // this default is only what an unlabelled layer would land in.
        sortingLayer: "Terrain",
        // The tileset's `image` names the sheet; the atlas beside it is what ignifx loads. The
        // default mapping would answer `tiny-town.atlas.json`, which is already right, and naming
        // it here is what makes that a decision rather than a coincidence.
        atlasFor: (image: string): string => image.replace(/\.png$/u, ".atlas.json"),
      }),
    ),
  );
}

/**
 * Reads one required `--flag value` pair out of the command line.
 *
 * @param flag - The flag, including its dashes.
 * @returns The value.
 * @throws An `Error` when the flag is absent or has no value.
 */
function argument(flag: string): string {
  const index = process.argv.indexOf(flag);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} <path> is required; see the header of this file.`);
  }
  return value;
}

await mkdir(OUT, { recursive: true });
await buildSheet(argument("--tiny-town"), "tiny-town", TINY_TOWN, "town");
await buildSheet(argument("--pixel-platformer"), "props", PIXEL_PLATFORMER, "props");
await copyGridSheet("terrain", REPO_ART.terrain, 16, 1, 2, "terrain");
await copyCharacter("villager", REPO_ART.villager);
await copyCharacter("runner", REPO_ART.runner);
await buildMap("tilemap", "village", 16);
await buildMap("platformer-controller", "course", 16);
