// Regenerates the `ignifx.tilemap` document each template ships. Run with:
//   node tests/fixtures/assets/2d-templates/make-template-levels.mjs
//
// A 40x24 and a 64x20 grid of tile ids are not something a human edits by hand, so the *level
// design* lives here as rectangles and a column profile and the dense arrays are derived from it.
// The output is a plain `.tilemap.json`, the format `@ignifx/2d`'s loader consumes directly — no
// Tiled or LDtk import step is involved, and no editor file is redistributed.
//
// Coordinates: a document stores its rows **top first**, and `Tilemap` flips them on load so that
// cell (0, 0) is the bottom-left of the map in a +Y-up world.
import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { rng } from "./png.mjs";

const HERE = import.meta.dirname;
const REPO = join(HERE, "..", "..", "..", "..");

/** A whole-cell solid box, in the authoring space the format documents: top-left origin, 0 to 1. */
const SOLID = { kind: "box", x: 0, y: 0, width: 1, height: 1 };

/**
 * A 45-degree slope rising left to right. The winding is chosen so that, after the loader's flip
 * into +Y-up metres, the outline comes out counter-clockwise, which is what the collision merger
 * documents.
 */
const SLOPE_UP = {
  kind: "polygon",
  points: [
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
};

/** Its mirror image: a 45-degree slope falling left to right. */
const SLOPE_DOWN = {
  kind: "polygon",
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ],
};

/** The five pixels of plank at the top of the cell, and `oneWay` so it is solid only from above. */
const PLANK = { kind: "box", x: 0, y: 0, width: 1, height: 5 / 16, oneWay: true };

/** A dense grid of tile ids addressed by column and by **row from the top**. */
class Grid {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.cells = Array.from({ length: width * height }, () => 0);
  }

  set(x, row, id) {
    if (x < 0 || row < 0 || x >= this.width || row >= this.height) return;
    this.cells[row * this.width + x] = id;
  }

  get(x, row) {
    if (x < 0 || row < 0 || x >= this.width || row >= this.height) return 0;
    return this.cells[row * this.width + x];
  }

  /**
   * Fills a rectangle given in **cell coordinates with +Y up**, the way the level is designed.
   * @param x - The left column.
   * @param y - The bottom row, counted up from the map's floor.
   * @param w - The width, in cells.
   * @param h - The height, in cells.
   * @param id - The global tile id to write.
   */
  fill(x, y, w, h, id) {
    for (let dy = 0; dy < h; dy += 1) {
      for (let dx = 0; dx < w; dx += 1) this.set(x + dx, this.height - 1 - (y + dy), id);
    }
  }

  /**
   * Writes one cell in +Y-up coordinates.
   * @param x - The column.
   * @param y - The row, counted up from the map's floor.
   * @param id - The global tile id to write.
   */
  put(x, y, id) {
    this.set(x, this.height - 1 - y, id);
  }
}

/**
 * Run-length encodes a dense tile array into the `[count, value]` pairs the format accepts. A
 * tilemap is mostly runs of one id, so this is what keeps a 40x24 map a readable document rather
 * than a thousand lines of integers.
 * @param tiles - The dense tile ids, row-major and top row first.
 * @returns The `[count, value]` pairs.
 */
function encodeRle(tiles) {
  const out = [];
  let index = 0;
  while (index < tiles.length) {
    let run = 1;
    while (index + run < tiles.length && tiles[index + run] === tiles[index]) run += 1;
    out.push(run, tiles[index]);
    index += run;
  }
  return out;
}

/** The values held back for one-line serialisation, in the order they were registered. */
const inlineRuns = [];

/**
 * Registers a value that must be serialised on one line rather than one entry per line.
 * @param value - The value to inline, normally a run-length-encoded tile array.
 * @returns The placeholder string {@link writeJson} substitutes.
 */
function inline(value) {
  inlineRuns.push(value);
  return `\u0000inline${String(inlineRuns.length - 1)}\u0000`;
}

/**
 * Writes a JSON document, substituting the placeholders {@link inline} registered.
 * @param path - Where to write it.
 * @param value - The document.
 * @returns How many bytes were written.
 */
function writeJson(path, value) {
  let text = JSON.stringify(value, null, 2);
  for (const [index, run] of inlineRuns.entries()) {
    text = text.replace(`"\\u0000inline${String(index)}\\u0000"`, JSON.stringify(run));
  }
  const bytes = `${text}\n`;
  writeFileSync(path, bytes);
  return Buffer.byteLength(bytes);
}

// ---------------------------------------------------------------------------------------------
// 2d-topdown: a walled garden, 40 x 24 cells of one metre.
// ---------------------------------------------------------------------------------------------

// Global tile ids: the tileset's `firstId` is 1 and its tiles are indexed by their position in
// `tiles.atlas.json`, so `GRASS` is frame 0, `GRASS_TUFT` frame 1, and so on.
const [GRASS, GRASS_TUFT, PATH, WATER, WALL, WALL_TOP, TREE_CANOPY, FLOWERS] = [1, 2, 3, 4, 5, 6, 7, 8];
const TREE_TRUNK = 16;

const TOPDOWN_WIDTH = 40;
const TOPDOWN_HEIGHT = 24;

/**
 * Builds the top-down garden: a ground layer and a solid layer.
 * @returns The two grids, in draw order.
 */
function topdownLevel() {
  const ground = new Grid(TOPDOWN_WIDTH, TOPDOWN_HEIGHT);
  const walls = new Grid(TOPDOWN_WIDTH, TOPDOWN_HEIGHT);

  ground.fill(0, 0, TOPDOWN_WIDTH, TOPDOWN_HEIGHT, GRASS);

  // Decoration: a deterministic scatter, so a regenerated map is byte-for-byte the committed one.
  const random = rng(7);
  for (let i = 0; i < 150; i += 1) {
    const x = Math.floor(random() * TOPDOWN_WIDTH);
    const y = Math.floor(random() * TOPDOWN_HEIGHT);
    ground.put(x, y, random() > 0.72 ? FLOWERS : GRASS_TUFT);
  }

  // A cross of path, which is what the player walks along.
  ground.fill(1, 9, TOPDOWN_WIDTH - 2, 2, PATH);
  ground.fill(9, 2, 2, TOPDOWN_HEIGHT - 4, PATH);

  // The boundary wall. The top row is the lit cap, so the wall reads as having thickness.
  walls.fill(0, 0, TOPDOWN_WIDTH, 1, WALL);
  walls.fill(0, TOPDOWN_HEIGHT - 2, TOPDOWN_WIDTH, 1, WALL);
  walls.fill(0, TOPDOWN_HEIGHT - 1, TOPDOWN_WIDTH, 1, WALL_TOP);
  walls.fill(0, 1, 1, TOPDOWN_HEIGHT - 3, WALL);
  walls.fill(TOPDOWN_WIDTH - 1, 1, 1, TOPDOWN_HEIGHT - 3, WALL);

  // A pond on the east side, and an interior wall stub with its own cap.
  walls.fill(28, 13, 7, 6, WATER);
  walls.fill(16, 17, 7, 1, WALL);
  walls.fill(16, 18, 7, 1, WALL_TOP);

  // Three trees: a trunk cell with a canopy cell above it.
  for (const [x, y] of [
    [4, 4],
    [24, 4],
    [34, 6],
  ]) {
    walls.put(x, y, TREE_TRUNK);
    ground.put(x, y + 1, TREE_CANOPY);
  }

  return { ground, walls };
}

/**
 * Builds the top-down `ignifx.tilemap` document.
 * @returns The document, ready to serialise.
 */
function topdownDocument() {
  const { ground, walls } = topdownLevel();
  return {
    format: "ignifx.tilemap",
    formatVersion: 1,
    tileWidth: 16,
    tileHeight: 16,
    cellSize: 1,
    width: TOPDOWN_WIDTH,
    height: TOPDOWN_HEIGHT,
    tilesets: [
      {
        name: "garden",
        atlas: "tiles.atlas.json",
        firstId: 1,
        tiles: [
          { id: 0, frame: "grass" },
          { id: 1, frame: "grass_tuft" },
          { id: 2, frame: "path" },
          { id: 3, frame: "water", collider: SOLID, properties: { surface: "water" } },
          { id: 4, frame: "wall", collider: SOLID },
          { id: 5, frame: "wall_top", collider: SOLID },
          { id: 6, frame: "tree_canopy" },
          { id: 7, frame: "flowers" },
          { id: 8, frame: "chest" },
          { id: 9, frame: "barrel" },
          { id: 10, frame: "sign" },
          { id: 11, frame: "bush" },
          { id: 12, frame: "pad" },
          { id: 13, frame: "rock" },
          { id: 14, frame: "crate" },
          { id: 15, frame: "tree_trunk", collider: SOLID },
        ],
      },
    ],
    layers: [
      {
        name: "Ground",
        sortingLayer: "Background",
        orderInLayer: 0,
        collision: false,
        tiles: { rle: inline(encodeRle(ground.cells)) },
      },
      {
        name: "Solid",
        sortingLayer: "Background",
        orderInLayer: 1,
        collision: true,
        tiles: { rle: inline(encodeRle(walls.cells)) },
      },
    ],
    objects: [
      { type: "spawn", name: "Player", x: 9.5, y: 10.5, width: 1, height: 1, properties: {} },
      { type: "prop", name: "Chest", x: 13.5, y: 15.5, width: 1, height: 1, properties: { frame: "chest" } },
      { type: "prop", name: "Barrel", x: 5.5, y: 14.5, width: 1, height: 1, properties: { frame: "barrel" } },
      { type: "prop", name: "Crate", x: 6.5, y: 14.5, width: 1, height: 1, properties: { frame: "crate" } },
      { type: "prop", name: "Signpost", x: 11.5, y: 11.5, width: 1, height: 1, properties: { frame: "sign" } },
      { type: "prop", name: "Rock", x: 20.5, y: 6.5, width: 1, height: 1, properties: { frame: "rock" } },
      { type: "prop", name: "Bush", x: 30.5, y: 5.5, width: 1, height: 1, properties: { frame: "bush" } },
      { type: "prop", name: "Bush East", x: 31.5, y: 6.5, width: 1, height: 1, properties: { frame: "bush" } },
      { type: "prop", name: "Crate East", x: 17.5, y: 11.6, width: 1, height: 1, properties: { frame: "crate" } },
      { type: "prop", name: "Barrel East", x: 18.5, y: 10.2, width: 1, height: 1, properties: { frame: "barrel" } },
      { type: "prop", name: "Rock North", x: 14.5, y: 8.4, width: 1, height: 1, properties: { frame: "rock" } },
      { type: "prop", name: "Bush South", x: 22.5, y: 13.5, width: 1, height: 1, properties: { frame: "bush" } },
      { type: "prop", name: "Waymarker", x: 27.5, y: 12.5, width: 1, height: 1, properties: { frame: "sign" } },
      { type: "prop", name: "Cache", x: 21.5, y: 16.5, width: 1, height: 1, properties: { frame: "chest" } },
      { type: "shrine", name: "Shrine", x: 25.5, y: 10.5, width: 2, height: 2, properties: { frame: "pad" } },
    ],
    properties: { title: "Garden" },
  };
}

// ---------------------------------------------------------------------------------------------
// 2d-sidescroller: 64 x 20 cells of one metre, with slopes, one-way planks and two pits.
// ---------------------------------------------------------------------------------------------

const [GROUND_TOP, DIRT, SLOPE_UP_ID, SLOPE_DOWN_ID, PLATFORM, BRICK, DIRT_LEFT, DIRT_RIGHT] = [1, 2, 3, 4, 5, 6, 7, 8];

const SIDE_WIDTH = 64;
const SIDE_HEIGHT = 20;

/**
 * The ground profile, column by column: `height` is how many solid rows rise from the bottom and
 * `top` says what sits in the topmost of them. A `slopeUp` column's surface climbs to the next
 * column's height; a `slopeDown` column's surface falls to it.
 */
const PROFILE = [
  { from: 0, to: 7, height: 3, top: "flat" },
  { from: 8, to: 8, height: 4, top: "slopeUp" },
  { from: 9, to: 13, height: 4, top: "flat" },
  { from: 14, to: 14, height: 4, top: "slopeDown" },
  { from: 15, to: 19, height: 3, top: "flat" },
  { from: 20, to: 23, height: 0, top: "pit" },
  { from: 24, to: 31, height: 3, top: "flat" },
  { from: 32, to: 32, height: 4, top: "slopeUp" },
  { from: 33, to: 36, height: 4, top: "flat" },
  { from: 37, to: 37, height: 5, top: "slopeUp" },
  { from: 38, to: 43, height: 5, top: "flat" },
  { from: 44, to: 44, height: 5, top: "slopeDown" },
  { from: 45, to: 49, height: 4, top: "flat" },
  { from: 50, to: 50, height: 4, top: "slopeDown" },
  { from: 51, to: 57, height: 3, top: "flat" },
  { from: 58, to: 59, height: 0, top: "pit" },
  { from: 60, to: 63, height: 3, top: "flat" },
];

/**
 * Floating one-way planks: `[x, width, y]`. A plank's cell carries five pixels of collider at the
 * **top** of the cell, so a plank at row `y` is stood on at `y + 1`. Each is three metres above the
 * ground beneath it, which is inside the controller's jump arc: `jumpSpeed² / (2 · riseGravity)` is
 * 16² / 72 = 3.56 m.
 */
const PLANKS = [
  [3, 4, 5],
  [16, 4, 5],
  [26, 5, 5],
  [39, 5, 7],
  [52, 5, 5],
];

/** Solid floating brick blocks: `[x, width, y]`. Reachable from the surface below, like the planks. */
const BLOCKS = [
  [10, 3, 6],
  [46, 3, 6],
];

/**
 * Builds the side-scroller terrain from the column profile, the planks and the blocks.
 * @returns The terrain grid.
 */
function sidescrollerLevel() {
  const terrain = new Grid(SIDE_WIDTH, SIDE_HEIGHT);

  for (const span of PROFILE) {
    for (let x = span.from; x <= span.to; x += 1) {
      if (span.height === 0) continue;
      for (let y = 0; y < span.height - 1; y += 1) terrain.put(x, y, DIRT);
      const surface = span.height - 1;
      if (span.top === "slopeUp") terrain.put(x, surface, SLOPE_UP_ID);
      else if (span.top === "slopeDown") terrain.put(x, surface, SLOPE_DOWN_ID);
      else terrain.put(x, surface, GROUND_TOP);
    }
  }

  // Light the cells that face a pit, so the drop reads as a cliff rather than as missing tiles.
  for (const span of PROFILE) {
    if (span.height === 0) continue;
    for (let y = 0; y < span.height - 1; y += 1) {
      if (terrain.get(span.from - 1, terrain.height - 1 - y) === 0) terrain.put(span.from, y, DIRT_LEFT);
      if (terrain.get(span.to + 1, terrain.height - 1 - y) === 0) terrain.put(span.to, y, DIRT_RIGHT);
    }
  }

  for (const [x, width, y] of PLANKS) for (let dx = 0; dx < width; dx += 1) terrain.put(x + dx, y, PLATFORM);
  for (const [x, width, y] of BLOCKS) for (let dx = 0; dx < width; dx += 1) terrain.put(x + dx, y, BRICK);

  return terrain;
}

/** A coin above every plank and block, plus a couple over the pits. */
const COINS = [
  [4, 6],
  [5, 6],
  [11, 7],
  [12, 4],
  [17, 6],
  [18, 6],
  [21, 5],
  [22, 5],
  [27, 6],
  [28, 6],
  [33, 5],
  [39, 5],
  [40, 8],
  [41, 8],
  [47, 7],
  [53, 6],
  [54, 6],
  [58, 5],
];

/**
 * Builds the side-scroller `ignifx.tilemap` document.
 * @returns The document, ready to serialise.
 */
function sidescrollerDocument() {
  const terrain = sidescrollerLevel();
  return {
    format: "ignifx.tilemap",
    formatVersion: 1,
    tileWidth: 16,
    tileHeight: 16,
    cellSize: 1,
    width: SIDE_WIDTH,
    height: SIDE_HEIGHT,
    tilesets: [
      {
        name: "terrain",
        atlas: "tiles.atlas.json",
        firstId: 1,
        tiles: [
          { id: 0, frame: "ground_top", collider: SOLID },
          { id: 1, frame: "dirt", collider: SOLID },
          { id: 2, frame: "slope_up", collider: SLOPE_UP },
          { id: 3, frame: "slope_down", collider: SLOPE_DOWN },
          { id: 4, frame: "platform", collider: PLANK, properties: { oneWay: true } },
          { id: 5, frame: "brick", collider: SOLID },
          { id: 6, frame: "dirt_left", collider: SOLID },
          { id: 7, frame: "dirt_right", collider: SOLID },
        ],
      },
    ],
    layers: [
      {
        name: "Terrain",
        sortingLayer: "Terrain",
        orderInLayer: 0,
        collision: true,
        tiles: { rle: inline(encodeRle(terrain.cells)) },
      },
    ],
    objects: [
      { type: "spawn", name: "Player", x: 2.5, y: 3, width: 1, height: 1, properties: {} },
      ...COINS.map(([x, y], index) => ({
        type: "coin",
        name: `Coin ${String(index + 1)}`,
        x: x + 0.5,
        y: y + 0.5,
        width: 1,
        height: 1,
        properties: {},
      })),
    ],
    properties: { title: "Dusk Run" },
  };
}

// ---------------------------------------------------------------------------------------------

const OUTPUTS = [
  { template: "2d-topdown", build: topdownDocument },
  { template: "2d-sidescroller", build: sidescrollerDocument },
];

for (const output of OUTPUTS) {
  const { template } = output;
  const path = join(REPO, "templates", template, "assets", "level.tilemap.json");
  const bytes = writeJson(path, output.build());
  process.stdout.write(`${template}/assets/level.tilemap.json`.padEnd(46) + `${String(bytes).padStart(7)} bytes\n`);
}
