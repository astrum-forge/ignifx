// Regenerates every image, atlas document and sound the two 2D templates ship. Run with:
//   node tests/fixtures/assets/2d-templates/make-template-art.mjs
//
// Every byte is produced here, so the art is an original work (see ATTRIBUTION.md). Nothing is
// downloaded and no third-party asset pack is involved. The files are written straight into
// `templates/<name>/assets/`, because a template has to be self-contained: `create-ignifx` copies
// the directory verbatim into a player's project, so it cannot reference a path in this repository.
//
// The packer below pads every frame by one pixel and extrudes the frame's own border into the
// padding. That is what `@ignifx/2d`'s `IGX-1102` check asks for, and what keeps a `pixelPerfect`
// camera from sampling the neighbouring frame at a frame edge.
import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Canvas, encodePng, encodeWav, rng } from "./png.mjs";

const HERE = import.meta.dirname;
const REPO = join(HERE, "..", "..", "..", "..");
const TOPDOWN = join(REPO, "templates", "2d-topdown", "assets");
const SIDESCROLLER = join(REPO, "templates", "2d-sidescroller", "assets");

/**
 * Where the sheet images go, and why they are not in `assets/`.
 *
 * A `.atlas.json` names its image **relative to the document**, and `@ignifx/2d` resolves that
 * against the document's own URL. `@ignifx/vite-plugin` content-hashes everything under the asset
 * root on a production build, so `assets/tiles.a1b2c3d4.atlas.json` would look for
 * `assets/tiles.png` — a name that no longer exists — and the load would fail with `IGX-0505`.
 * Vite's `public/` directory is copied verbatim and unhashed, so an absolute `/tiles.png` resolves
 * in `pnpm dev` and in `pnpm build` alike. The documents themselves stay in `assets/`, where they
 * are hashed and reached by address through the manifest.
 * @param directory - A template's `assets/` directory.
 * @returns Its sibling `public/` directory.
 */
const PUBLIC = (directory) => join(directory, "..", "public");

/** The edge of one tile and one character cell, in pixels. `twoD.pixelsPerUnit` matches it. */
const TILE = 16;

/** The padding placed around every packed frame, in pixels. */
const PAD = 1;

/** Bottom-centre: an entity's origin sits at the sprite's feet, which is what Y-sort wants. */
const FEET = [0.5, 1];

const written = [];

/**
 * Writes one generated file and records its size for the closing report.
 * @param directory - Where to write it.
 * @param name - The file name.
 * @param bytes - The contents.
 */
function write(directory, name, bytes) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), bytes);
  const path = String(directory);
  const template = path.includes("2d-topdown") ? "2d-topdown" : "2d-sidescroller";
  const kind = path.endsWith("public") ? "public" : "assets";
  written.push([`${template}/${kind}/${name}`, bytes.length]);
}

/**
 * Writes a JSON document with the repository's two-space, trailing-newline shape.
 * @param directory - Where to write it.
 * @param name - The file name.
 * @param value - The document.
 */
function writeJson(directory, name, value) {
  write(directory, name, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}

// ---------------------------------------------------------------------------------------------
// The packer
// ---------------------------------------------------------------------------------------------

/**
 * Copies a frame's border pixels one pixel outwards, so a nearest sample cannot bleed.
 * @param canvas - The sheet being packed.
 * @param x - The frame's left edge.
 * @param y - The frame's top edge.
 * @param w - The frame's width.
 * @param h - The frame's height.
 */
function extrude(canvas, x, y, w, h) {
  for (let i = 0; i < w; i += 1) {
    canvas.set(x + i, y - 1, canvas.get(x + i, y));
    canvas.set(x + i, y + h, canvas.get(x + i, y + h - 1));
  }
  for (let i = -1; i <= h; i += 1) {
    canvas.set(x - 1, y + i, canvas.get(x, y + i));
    canvas.set(x + w, y + i, canvas.get(x + w - 1, y + i));
  }
}

/**
 * Lays a list of `{ name, w, h, pivot, draw }` cells out in a grid with one pixel of padding
 * around each, draws them, extrudes their borders, and returns the sheet plus the frame table an
 * `ignifx.spriteatlas` document needs.
 * @param cells - The cells to pack, each `{ name, w, h, pivot?, draw }`.
 * @param columns - How many cells fit on one row.
 * @returns The sheet canvas and its frame table.
 */
function packSheet(cells, columns) {
  const rows = [];
  for (let index = 0; index < cells.length; index += columns) rows.push(cells.slice(index, index + columns));
  const rowHeights = rows.map((row) => Math.max(...row.map((cell) => cell.h)));
  const columnWidth = Math.max(...cells.map((cell) => cell.w));
  const width = columns * (columnWidth + PAD * 2);
  const height = rowHeights.reduce((sum, h) => sum + h + PAD * 2, 0);

  const canvas = new Canvas(width, height);
  const frames = [];
  let top = 0;
  for (const [rowIndex, row] of rows.entries()) {
    for (const [columnIndex, cell] of row.entries()) {
      const x = columnIndex * (columnWidth + PAD * 2) + PAD;
      const y = top + PAD;
      cell.draw(canvas, x, y);
      extrude(canvas, x, y, cell.w, cell.h);
      const pivot = cell.pivot === undefined ? {} : { pivot: cell.pivot };
      frames.push({ name: cell.name, x, y, w: cell.w, h: cell.h, ...pivot });
    }
    top += rowHeights[rowIndex] + PAD * 2;
  }
  return { canvas, frames };
}

/**
 * Writes a packed sheet as `public/<name>.png` plus its `assets/<name>.atlas.json` document.
 * @param directory - The template's `assets/` directory.
 * @param name - The sheet's base name.
 * @param sheet - What {@link packSheet} produced.
 * @returns The same sheet, for chaining.
 */
function writeAtlas(directory, name, sheet) {
  write(PUBLIC(directory), `${name}.png`, encodePng(sheet.canvas));
  writeJson(directory, `${name}.atlas.json`, {
    format: "ignifx.spriteatlas",
    formatVersion: 1,
    // Absolute, and served from `public/`. See the comment on PUBLIC above.
    image: `/${name}.png`,
    // Pixel art is never filtered: a texture's sampler is fixed at upload, so `pixelPerfect` on the
    // camera is not enough on its own (`packages/2d/skills/2d/SKILL.md`, "Gotchas").
    sampling: "nearest",
    premultipliedAlpha: false,
    frames: sheet.frames,
  });
  return sheet;
}

// ---------------------------------------------------------------------------------------------
// Palettes. Two coherent ramps, one warm daylight and one cool dusk, so the two templates read as
// different games rather than the same art twice.
// ---------------------------------------------------------------------------------------------

const T = {
  grass: [74, 138, 74],
  grassDark: [56, 110, 60],
  grassLight: [110, 170, 92],
  path: [186, 149, 100],
  pathDark: [154, 118, 76],
  water: [56, 106, 156],
  waterLight: [86, 146, 196],
  stone: [122, 128, 140],
  stoneDark: [88, 94, 108],
  stoneLight: [162, 168, 180],
  wood: [138, 92, 52],
  woodDark: [98, 64, 36],
  leaf: [46, 104, 62],
  leafLight: [70, 138, 82],
  leafDark: [34, 78, 48],
  gold: [232, 190, 74],
  skin: [238, 198, 152],
  tunic: [186, 62, 58],
  tunicDark: [140, 42, 42],
  hair: [64, 42, 30],
  boot: [96, 68, 44],
  bootDark: [58, 42, 30],
  outline: [30, 26, 34],
  bloom: [220, 108, 128],
  bloomLight: [244, 232, 200],
};

const S = {
  skyTop: [36, 44, 88],
  skyMid: [92, 78, 132],
  skyLow: [206, 122, 108],
  skyHorizon: [240, 176, 110],
  sun: [252, 226, 158],
  hillFar: [72, 74, 122],
  hillNear: [50, 52, 92],
  tree: [26, 30, 54],
  treeLight: [38, 44, 74],
  dirt: [104, 72, 48],
  dirtDark: [74, 50, 34],
  grass: [86, 150, 72],
  grassLight: [110, 178, 92],
  grassDark: [62, 116, 56],
  brick: [126, 108, 96],
  brickDark: [92, 78, 70],
  plank: [154, 104, 58],
  plankLight: [186, 132, 78],
  plankDark: [114, 74, 42],
  coin: [246, 200, 74],
  coinDark: [198, 148, 42],
  skin: [238, 198, 152],
  suit: [78, 148, 190],
  suitDark: [52, 108, 148],
  hair: [46, 36, 52],
  boot: [96, 84, 132],
  bootDark: [56, 48, 78],
  outline: [22, 20, 32],
};

/**
 * Scatters single pixels over one tile, deterministically.
 * @param canvas - The sheet being drawn.
 * @param ox - The tile's left edge.
 * @param oy - The tile's top edge.
 * @param colour - The speck colour.
 * @param count - How many specks to place.
 * @param seed - The generator seed, so the tile is identical on every run.
 */
function speckle(canvas, ox, oy, colour, count, seed) {
  const random = rng(seed);
  for (let i = 0; i < count; i += 1) {
    canvas.set(ox + Math.floor(random() * TILE), oy + Math.floor(random() * TILE), colour);
  }
}

/**
 * Draws four staggered courses of brick inside one tile.
 * @param c - The sheet being drawn.
 * @param ox - The tile's left edge.
 * @param oy - The tile's top edge.
 * @param mortar - The colour behind the bricks.
 * @param face - The brick face colour.
 */
function brickCourses(c, ox, oy, mortar, face) {
  c.rect(ox, oy, TILE, TILE, mortar);
  for (let row = 0; row < 4; row += 1) {
    const offset = row % 2 === 0 ? 0 : 4;
    for (let brick = -1; brick < 3; brick += 1) {
      const left = Math.max(ox, ox + brick * 8 + offset + 1);
      const right = Math.min(ox + TILE, ox + brick * 8 + offset + 7);
      if (right > left) c.rect(left, oy + row * 4 + 1, right - left, 2, face);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 2d-topdown — tiles.png: eight terrain tiles and eight props.
// ---------------------------------------------------------------------------------------------

const TOPDOWN_TILES = [
  {
    name: "grass",
    draw: (c, x, y) => {
      c.rect(x, y, TILE, TILE, T.grass);
      speckle(c, x, y, T.grassDark, 26, 11);
    },
  },
  {
    name: "grass_tuft",
    draw: (c, x, y) => {
      c.rect(x, y, TILE, TILE, T.grass);
      speckle(c, x, y, T.grassDark, 20, 23);
      for (const [dx, dy] of [
        [3, 10],
        [9, 5],
        [12, 12],
      ]) {
        c.set(x + dx, y + dy, T.grassLight);
        c.set(x + dx, y + dy - 1, T.grassLight);
        c.set(x + dx + 1, y + dy, T.grassLight);
      }
    },
  },
  {
    name: "path",
    draw: (c, x, y) => {
      c.rect(x, y, TILE, TILE, T.path);
      speckle(c, x, y, T.pathDark, 30, 37);
    },
  },
  {
    name: "water",
    draw: (c, x, y) => {
      c.rect(x, y, TILE, TILE, T.water);
      for (let row = 2; row < TILE; row += 5) {
        c.rect(x + 2, y + row, 5, 1, T.waterLight);
        c.rect(x + 9, y + row + 2, 4, 1, T.waterLight);
      }
    },
  },
  { name: "wall", draw: (c, x, y) => brickCourses(c, x, y, T.stoneDark, T.stone) },
  {
    name: "wall_top",
    draw: (c, x, y) => {
      c.rect(x, y, TILE, TILE, T.stone);
      c.rect(x, y, TILE, 4, T.stoneLight);
      speckle(c, x, y, T.stoneDark, 14, 51);
    },
  },
  {
    name: "tree_canopy",
    draw: (c, x, y) => {
      c.rect(x, y, TILE, TILE, T.grass);
      c.disc(x + 8, y + 8, 7.2, T.leafDark);
      c.disc(x + 8, y + 7, 5.6, T.leaf);
      c.disc(x + 6, y + 5, 2.4, T.leafLight);
    },
  },
  {
    name: "flowers",
    draw: (c, x, y) => {
      c.rect(x, y, TILE, TILE, T.grass);
      speckle(c, x, y, T.grassDark, 18, 67);
      for (const [dx, dy] of [
        [4, 4],
        [11, 6],
        [7, 11],
      ]) {
        c.rect(x + dx, y + dy, 2, 2, T.bloom);
        c.set(x + dx + 1, y + dy + 1, T.bloomLight);
      }
    },
  },
  {
    name: "chest",
    pivot: FEET,
    draw: (c, x, y) => {
      c.rect(x + 3, y + 4, 10, 9, T.woodDark);
      c.rect(x + 4, y + 6, 8, 6, T.wood);
      c.rect(x + 3, y + 8, 10, 2, T.gold);
      c.rect(x + 7, y + 8, 2, 3, T.gold);
    },
  },
  {
    name: "barrel",
    pivot: FEET,
    draw: (c, x, y) => {
      c.rect(x + 4, y + 3, 8, 11, T.woodDark);
      c.rect(x + 5, y + 4, 6, 9, T.wood);
      c.rect(x + 4, y + 6, 8, 1, T.woodDark);
      c.rect(x + 4, y + 10, 8, 1, T.woodDark);
    },
  },
  {
    name: "sign",
    pivot: FEET,
    draw: (c, x, y) => {
      c.rect(x + 7, y + 7, 2, 7, T.woodDark);
      c.rect(x + 2, y + 2, 12, 6, T.wood);
      c.rect(x + 2, y + 2, 12, 1, T.woodDark);
      c.rect(x + 4, y + 4, 8, 1, T.woodDark);
      c.rect(x + 4, y + 6, 5, 1, T.woodDark);
    },
  },
  {
    name: "bush",
    pivot: FEET,
    draw: (c, x, y) => {
      c.disc(x + 8, y + 9, 5.4, T.leafDark);
      c.disc(x + 6, y + 8, 3.6, T.leaf);
      c.disc(x + 11, y + 9, 3, T.leaf);
    },
  },
  {
    name: "pad",
    pivot: FEET,
    draw: (c, x, y) => {
      c.rect(x + 1, y + 3, 14, 11, T.stoneDark);
      c.rect(x + 2, y + 4, 12, 9, T.stone);
      c.rect(x + 5, y + 6, 6, 5, T.gold);
    },
  },
  {
    name: "rock",
    pivot: FEET,
    draw: (c, x, y) => {
      c.disc(x + 8, y + 10, 5, T.stoneDark);
      c.disc(x + 7, y + 9, 3.4, T.stone);
      c.disc(x + 6, y + 8, 1.6, T.stoneLight);
    },
  },
  {
    name: "crate",
    pivot: FEET,
    draw: (c, x, y) => {
      c.rect(x + 2, y + 3, 12, 11, T.woodDark);
      c.rect(x + 3, y + 4, 10, 9, T.wood);
      for (let i = 0; i < 9; i += 1) {
        c.set(x + 3 + i, y + 4 + i, T.woodDark);
        c.set(x + 12 - i, y + 4 + i, T.woodDark);
      }
    },
  },
  {
    name: "tree_trunk",
    draw: (c, x, y) => {
      c.rect(x, y, TILE, TILE, T.grass);
      c.rect(x + 6, y + 4, 4, 10, T.woodDark);
      c.rect(x + 7, y + 4, 2, 10, T.wood);
    },
  },
];

// ---------------------------------------------------------------------------------------------
// 2d-topdown — hero.png: eight walk frames across, four facings down.
// ---------------------------------------------------------------------------------------------

const FACINGS = ["down", "left", "right", "up"];

/**
 * Draws one frame of the top-down character.
 * @param c - The sheet being drawn.
 * @param ox - The cell's left edge.
 * @param oy - The cell's top edge.
 * @param facing - `"down"`, `"left"`, `"right"` or `"up"`.
 * @param frame - The walk-cycle frame, 0 to 7.
 */
function drawWalker(c, ox, oy, facing, frame) {
  const swing = [0, 1, 2, 1, 0, -1, -2, -1][frame];
  const bob = [0, 0, -1, -1, 0, 0, -1, -1][frame];
  const cx = ox + 8;
  const top = oy + 2 + bob;
  const lead = facing === "left" ? -swing : swing;

  c.rect(cx - 3 + lead, top + 10, 2, 4, T.boot);
  c.rect(cx + 1 - lead, top + 10, 2, 4, T.boot);
  c.rect(cx - 3 + lead, top + 13, 2, 1, T.bootDark);
  c.rect(cx + 1 - lead, top + 13, 2, 1, T.bootDark);
  c.rect(cx - 4, top + 5, 8, 6, T.tunicDark);
  c.rect(cx - 3, top + 5, 6, 5, T.tunic);
  c.rect(cx - 5, top + 6, 2, 4, T.skin);
  c.rect(cx + 3, top + 6, 2, 4, T.skin);
  c.rect(cx - 3, top, 6, 6, T.skin);
  c.rect(cx - 4, top - 1, 8, 3, T.hair);
  c.rect(cx - 4, top + 1, 1, 2, T.hair);
  c.rect(cx + 3, top + 1, 1, 2, T.hair);

  if (facing === "down") {
    c.set(cx - 2, top + 3, T.outline);
    c.set(cx + 1, top + 3, T.outline);
  } else if (facing === "up") {
    c.rect(cx - 3, top, 6, 4, T.hair);
  } else {
    c.set(facing === "left" ? cx - 3 : cx + 2, top + 3, T.outline);
    c.rect(facing === "left" ? cx - 4 : cx + 3, top + 5, 1, 1, T.hair);
  }
}

const TOPDOWN_HERO = FACINGS.flatMap((facing) =>
  Array.from({ length: 8 }, (_, frame) => ({
    name: `walk_${facing}_${String(frame)}`,
    pivot: FEET,
    draw: (c, x, y) => drawWalker(c, x, y, facing, frame),
  })),
);

// ---------------------------------------------------------------------------------------------
// 2d-sidescroller — tiles.png: two solid tiles, two slopes, a one-way plank, brick, two edges.
// ---------------------------------------------------------------------------------------------

/**
 * Draws the lit grass cap that sits on top of a side-scroller ground tile.
 * @param c - The sheet being drawn.
 * @param x - The tile's left edge.
 * @param y - The tile's top edge.
 */
function grassCap(c, x, y) {
  c.rect(x, y, TILE, 4, S.grass);
  c.rect(x, y + 4, TILE, 1, S.grassDark);
  c.rect(x, y, TILE, 1, S.grassLight);
}

const SIDE_TILES = [
  {
    name: "ground_top",
    draw: (c, x, y) => {
      c.rect(x, y, TILE, TILE, S.dirt);
      speckle(c, x, y, S.dirtDark, 16, 101);
      grassCap(c, x, y);
    },
  },
  {
    name: "dirt",
    draw: (c, x, y) => {
      c.rect(x, y, TILE, TILE, S.dirt);
      speckle(c, x, y, S.dirtDark, 30, 103);
    },
  },
  {
    // The solid half is the lower-right triangle, so the surface rises left to right.
    name: "slope_up",
    draw: (c, x, y) => {
      for (let row = 0; row < TILE; row += 1) {
        const from = TILE - 1 - row;
        c.rect(x + from, y + row, TILE - from, 1, S.dirt);
        c.rect(x + from, y + row, Math.min(4, row + 1), 1, S.grass);
        c.set(x + from, y + row, S.grassLight);
      }
      speckle(c, x, y, S.dirtDark, 10, 107);
    },
  },
  {
    // The mirror image: the solid half is the lower-left triangle.
    name: "slope_down",
    draw: (c, x, y) => {
      for (let row = 0; row < TILE; row += 1) {
        c.rect(x, y + row, row + 1, 1, S.dirt);
        c.rect(x + Math.max(0, row - 3), y + row, Math.min(4, row + 1), 1, S.grass);
        c.set(x + row, y + row, S.grassLight);
      }
      speckle(c, x, y, S.dirtDark, 10, 109);
    },
  },
  {
    // Five pixels of plank at the top of the cell and nothing below: the shape a one-way platform
    // has to have, because the collider follows the art.
    name: "platform",
    draw: (c, x, y) => {
      c.rect(x, y, TILE, 5, S.plankDark);
      c.rect(x, y, TILE, 4, S.plank);
      c.rect(x, y, TILE, 1, S.plankLight);
      c.rect(x + 5, y, 1, 5, S.plankDark);
      c.rect(x + 11, y, 1, 5, S.plankDark);
    },
  },
  { name: "brick", draw: (c, x, y) => brickCourses(c, x, y, S.brickDark, S.brick) },
  ...["dirt_left", "dirt_right"].map((name, index) => ({
    name,
    draw: (c, x, y) => {
      c.rect(x, y, TILE, TILE, S.dirt);
      speckle(c, x, y, S.dirtDark, 20, 113 + index);
      grassCap(c, x, y);
      c.rect(index === 0 ? x : x + TILE - 2, y, 2, TILE, S.dirtDark);
    },
  })),
];

// ---------------------------------------------------------------------------------------------
// 2d-sidescroller — hero.png: idle, jump, fall, and an eight-frame run.
// ---------------------------------------------------------------------------------------------

/**
 * Draws one frame of the side-scroller character.
 * @param c - The sheet being drawn.
 * @param ox - The cell's left edge.
 * @param oy - The cell's top edge.
 * @param pose - `"idle"`, `"run"`, `"jump"` or `"fall"`.
 * @param phase - The frame within the pose.
 */
function drawRunner(c, ox, oy, pose, phase) {
  const cx = ox + 8;
  const bob = pose === "run" ? [0, -1, -1, 0, 0, -1, -1, 0][phase] : [0, 0, -1, 0][phase % 4];
  const top = oy + 2 + bob;
  const swing = pose === "run" ? [3, 2, 0, -2, -3, -2, 0, 2][phase] : 0;

  if (pose === "jump" || pose === "fall") {
    const lift = pose === "jump" ? -1 : 1;
    c.rect(cx - 3, top + 10 + lift, 3, 4, S.boot);
    c.rect(cx + 1, top + 9 - lift, 3, 4, S.boot);
    c.rect(cx - 3, top + 13 + lift, 3, 1, S.bootDark);
    c.rect(cx + 1, top + 12 - lift, 3, 1, S.bootDark);
  } else {
    c.rect(cx - 3 + swing, top + 10, 3, 4, S.boot);
    c.rect(cx + 1 - swing, top + 10, 3, 4, S.boot);
    c.rect(cx - 3 + swing, top + 13, 3, 1, S.bootDark);
    c.rect(cx + 1 - swing, top + 13, 3, 1, S.bootDark);
  }
  c.rect(cx - 4, top + 4, 8, 7, S.suitDark);
  c.rect(cx - 3, top + 4, 6, 6, S.suit);
  c.rect(cx + 3, top + 5 - Math.floor(swing / 2), 2, 4, S.skin);
  c.rect(cx - 5, top + 5 + Math.floor(swing / 2), 2, 4, S.skin);
  c.rect(cx - 3, top - 1, 6, 6, S.skin);
  c.rect(cx - 4, top - 2, 8, 3, S.hair);
  c.rect(cx + 3, top - 1, 1, 2, S.hair);
  c.set(cx + 2, top + 2, S.outline);
}

const SIDE_HERO = [
  ...Array.from({ length: 4 }, (_, frame) => ({
    name: `idle_${String(frame)}`,
    pivot: FEET,
    draw: (c, x, y) => drawRunner(c, x, y, "idle", frame),
  })),
  { name: "jump", pivot: FEET, draw: (c, x, y) => drawRunner(c, x, y, "jump", 0) },
  { name: "fall", pivot: FEET, draw: (c, x, y) => drawRunner(c, x, y, "fall", 0) },
  ...Array.from({ length: 8 }, (_, frame) => ({
    name: `run_${String(frame)}`,
    pivot: FEET,
    draw: (c, x, y) => drawRunner(c, x, y, "run", frame),
  })),
];

// ---------------------------------------------------------------------------------------------
// 2d-sidescroller — coin.png: six spin frames.
// ---------------------------------------------------------------------------------------------

const SIDE_COIN = [6, 5, 3, 1, 3, 5].map((half, frame) => ({
  name: `spin_${String(frame)}`,
  draw: (c, x, y) => {
    for (let dy = -6; dy <= 6; dy += 1) {
      const w = Math.round(half * Math.sqrt(Math.max(0, 1 - (dy / 6.5) ** 2)));
      if (w <= 0) continue;
      c.rect(x + 8 - w, y + 8 + dy, w * 2, 1, S.coinDark);
      if (w > 1) c.rect(x + 9 - w, y + 8 + dy, w * 2 - 2, 1, S.coin);
    }
  },
}));

// ---------------------------------------------------------------------------------------------
// 2d-sidescroller — parallax.png: a dusk sky, a hill band, and a tree band, each seamless at
// 320 px so `ParallaxLayer.repeatX` can wrap them.
// ---------------------------------------------------------------------------------------------

const PARALLAX_WIDTH = 320;
// The sky is pinned to the screen (parallax factor 0), so it has to be at least as large as the
// biggest view a pixel-perfect camera produces: 40 by 24 metres covers every window size the
// reference resolution of 320x180 rounds to.
const SKY_WIDTH = 640;
const SKY_HEIGHT = 384;
const HILL_HEIGHT = 112;
// The tree band is a treeline over a deep solid base: the trees stand on TREE_BASELINE and the
// rest of the strip is filled, so a pit in the level looks down into darkness instead of showing a
// rectangle of raw sky.
const TREE_HEIGHT = 176;
const TREE_BASELINE = 60;

/**
 * Blends two colours.
 * @param a - The colour at `t = 0`.
 * @param b - The colour at `t = 1`.
 * @param t - The blend, 0 to 1.
 * @returns The blended `[r, g, b]`.
 */
function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * A seamless ridge line: a sum of sines whose periods all divide the strip width.
 * @param x - The column, in strip pixels.
 * @param bands - `[periods, amplitude, phase]` triples.
 * @returns The ridge's height offset at that column, in pixels.
 */
function ridge(x, bands) {
  let sum = 0;
  for (const [periods, amplitude, phase] of bands) {
    sum += Math.sin(((x / PARALLAX_WIDTH) * periods + phase) * Math.PI * 2) * amplitude;
  }
  return sum;
}

const PARALLAX = [
  {
    name: "sky",
    w: SKY_WIDTH,
    h: SKY_HEIGHT,
    draw: (c, ox, oy) => {
      for (let row = 0; row < SKY_HEIGHT; row += 1) {
        const t = row / (SKY_HEIGHT - 1);
        const colour =
          t < 0.35
            ? mix(S.skyTop, S.skyMid, t / 0.35)
            : t < 0.62
              ? mix(S.skyMid, S.skyLow, (t - 0.35) / 0.27)
              : mix(S.skyLow, S.skyHorizon, Math.min(1, (t - 0.62) / 0.18));
        c.rect(ox, oy + row, SKY_WIDTH, 1, colour);
      }
      c.disc(ox + 452, oy + 214, 24, mix(S.skyLow, S.sun, 0.35));
      c.disc(ox + 452, oy + 214, 18, S.sun);
    },
  },
  {
    name: "hills",
    w: PARALLAX_WIDTH,
    h: HILL_HEIGHT,
    draw: (c, ox, oy) => {
      for (let x = 0; x < PARALLAX_WIDTH; x += 1) {
        const far = Math.round(
          34 +
            ridge(x, [
              [1, 14, 0.1],
              [3, 6, 0.6],
            ]),
        );
        const near = Math.round(
          62 +
            ridge(x, [
              [2, 16, 0.35],
              [5, 5, 0.2],
            ]),
        );
        for (let row = far; row < HILL_HEIGHT; row += 1) c.set(ox + x, oy + row, S.hillFar);
        for (let row = near; row < HILL_HEIGHT; row += 1) c.set(ox + x, oy + row, S.hillNear);
      }
    },
  },
  {
    name: "trees",
    w: PARALLAX_WIDTH,
    h: TREE_HEIGHT,
    draw: (c, ox, oy) => {
      const random = rng(2026);
      for (let i = 0; i < 20; i += 1) {
        const x = Math.round((i / 20) * PARALLAX_WIDTH + random() * 8);
        const height = 40 + Math.round(random() * 18);
        const width = 14 + Math.round(random() * 10);
        const shade = random() > 0.6 ? S.treeLight : S.tree;
        for (let row = 0; row < height; row += 1) {
          // A conifer widens fastest near its base, so the profile is a square root, not a line.
          const half = Math.max(1, Math.round((width / 2) * Math.sqrt((row + 1) / height)));
          // The two extra copies are what make the strip tile: a tree that overhangs one edge is
          // drawn again at the other.
          for (const wrap of [-PARALLAX_WIDTH, 0, PARALLAX_WIDTH]) {
            for (let dx = -half; dx < half; dx += 1) {
              const px = x + wrap + dx;
              if (px < 0 || px >= PARALLAX_WIDTH) continue;
              c.set(ox + px, oy + TREE_BASELINE - height + row, shade);
            }
          }
        }
      }
      // The solid base is what a pit looks down into.
      c.rect(ox, oy + TREE_BASELINE, PARALLAX_WIDTH, TREE_HEIGHT - TREE_BASELINE, S.tree);
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Sound: one short decaying bell per template, 22.05 kHz mono 16-bit.
// ---------------------------------------------------------------------------------------------

const SAMPLE_RATE = 22_050;

/**
 * Synthesises a decaying three-partial bell.
 * @param baseHz - The fundamental frequency.
 * @param seconds - How long the sound lasts.
 * @returns The samples, each in `[-1, 1]`.
 */
function chime(baseHz, seconds) {
  const count = Math.round(SAMPLE_RATE * seconds);
  const samples = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const t = i / SAMPLE_RATE;
    const envelope = Math.exp(-t * 9) * Math.min(1, t * 400);
    const partials =
      Math.sin(2 * Math.PI * baseHz * t) +
      0.45 * Math.sin(2 * Math.PI * baseHz * 2.02 * t) +
      0.2 * Math.sin(2 * Math.PI * baseHz * 3.01 * t);
    samples[i] = envelope * 0.55 * partials;
  }
  return samples;
}

// ---------------------------------------------------------------------------------------------

/**
 * Gives a list of tile-sized cells their default 16 by 16 dimensions.
 * @param cells - The cells.
 * @returns The same cells with `w` and `h` filled in.
 */
const withSize = (cells) => cells.map((cell) => ({ w: TILE, h: TILE, ...cell }));

writeAtlas(TOPDOWN, "tiles", packSheet(withSize(TOPDOWN_TILES), 8));
writeAtlas(TOPDOWN, "hero", packSheet(withSize(TOPDOWN_HERO), 8));
write(TOPDOWN, "chime.wav", encodeWav(chime(784, 0.35), SAMPLE_RATE));

writeAtlas(SIDESCROLLER, "tiles", packSheet(withSize(SIDE_TILES), 8));
writeAtlas(SIDESCROLLER, "hero", packSheet(withSize(SIDE_HERO), 8));
writeAtlas(SIDESCROLLER, "coin", packSheet(withSize(SIDE_COIN), 6));
writeAtlas(SIDESCROLLER, "parallax", packSheet(PARALLAX, 1));
write(SIDESCROLLER, "chime.wav", encodeWav(chime(1046, 0.35), SAMPLE_RATE));

for (const [name, bytes] of written) {
  process.stdout.write(`${name.padEnd(38)} ${String(bytes).padStart(7)} bytes\n`);
}
