// Writes every file the five Terrain examples load into `website/examples/assets/terrain/`: the
// island heightmap as raw 16-bit `.r16`, the four layer albedo textures, the RGBA splat control
// map, and the two foliage cards. Run it from the repository root:
//
//   pnpm --filter @ignifx/website exec node examples/_tools/make-terrain-assets.ts
//
// The output is committed. It is the repository's own art, so it carries the repository's licence
// and needs no third-party attribution — the arrangement `make-grid-texture.ts` already uses.
// Everything below is seeded, so a re-run reproduces the same bytes and the committed posters and
// goldens stay valid.
//
// ## Why 16 bits, and why a raw file
//
// An 8-bit heightmap terraces: 256 steps over an 80 m range is a 31 cm stair on every slope, which
// is visible on any lit hillside. `.r16` — little-endian `uint16`, row-major, no header — is the
// canonical format `@ignifx/terrain` reads, because it is exact in Node and in the browser alike
// and no browser image API returns a 16-bit PNG losslessly.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import sharp from "sharp";

/** Where the files are written, relative to `website/examples`. */
const OUT_DIR = "assets/terrain";

/** Samples per side of the height field. `2^9 + 1`, which is what a 64-quad chunking needs. */
const RESOLUTION = 513;

/** The island's width and depth in metres; the `.terrain.json` declares the same figure. */
const EXTENT_METRES = 512;

/** The full height range in metres: sample `0` is `0 m` and sample `65535` is this. */
const HEIGHT_METRES = 80;

/** Where the water plane sits, in metres. Everything below it is sea floor nobody sees. */
const SEA_LEVEL_METRES = 3;

/** The edge length of one layer albedo texture, in pixels. */
const LAYER_SIZE = 256;

/** The edge length of the splat control map: one texel per quad of the field. */
const CONTROL_SIZE = 512;

/** The edge length of the two foliage cards, in pixels. */
const CARD_SIZE = 64;

/** The largest value a 16-bit sample holds. */
const MAX_SAMPLE = 65_535;

/** Bytes per RGBA texel. */
const RGBA = 4;

/** Bytes per RGB texel. */
const RGB = 3;

/** The cosine of the angle the island's long axis is turned by. */
const COAST_COS = Math.cos(0.55);

/** The sine of the angle the island's long axis is turned by. */
const COAST_SIN = Math.sin(0.55);

/**
 * A 32-bit integer hash of three integers, in `[0, 1)`.
 *
 * @remarks
 * Integer arithmetic rather than a `sin`/`fract` trick, so the value does not depend on how a
 * JavaScript engine rounds a transcendental and a re-run on another machine writes the same bytes.
 *
 * @param x - The first coordinate.
 * @param y - The second coordinate.
 * @param seed - The field's seed.
 * @returns A deterministic value in `[0, 1)`.
 */
function hash3(x: number, y: number, seed: number): number {
  // `| 0` is a 32-bit wrap, not a truncation: the hash is defined over 32-bit integers and
  // `Math.trunc` would let a product grow past 2^32 and change every value.
  // oxlint-disable unicorn/prefer-math-trunc -- see above.
  let h = Math.imul(x | 0, 0x27_d4_eb_2d) ^ Math.imul(y | 0, 0x16_56_67_b1) ^ Math.imul(seed | 0, 0x85_eb_ca_6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c_1b_3c_6d);
  h = Math.imul(h ^ (h >>> 12), 0x29_7a_2d_39);
  return ((h ^ (h >>> 15)) >>> 0) / 4_294_967_296;
  // oxlint-enable unicorn/prefer-math-trunc
}

/**
 * Smoothstep between two edges.
 *
 * @param edge0 - Where the ramp starts.
 * @param edge1 - Where the ramp ends.
 * @param value - The value to place on the ramp.
 * @returns `0` below `edge0`, `1` above `edge1`, a smooth ramp between.
 */
function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 === edge0) {
    return value < edge0 ? 0 : 1;
  }
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The dot product of a lattice point's pseudo-random gradient with the offset to the sample.
 *
 * @param ix - The lattice column.
 * @param iy - The lattice row.
 * @param seed - The field's seed.
 * @param dx - The sample's offset from the lattice point along X.
 * @param dy - The sample's offset from the lattice point along Y.
 * @returns The contribution of that corner.
 */
function gradientDot(ix: number, iy: number, seed: number, dx: number, dy: number): number {
  const angle = hash3(ix, iy, seed) * Math.PI * 2;
  return Math.cos(angle) * dx + Math.sin(angle) * dy;
}

/**
 * Gradient (Perlin) noise, in roughly `[-1, 1]`.
 *
 * @remarks
 * Gradient noise rather than value noise, because value noise leaves the lattice visible as
 * axis-aligned blocks on a lit hillside — which is exactly what a terrain example must not show.
 *
 * @param x - The sample position along X.
 * @param y - The sample position along Y.
 * @param seed - The field's seed.
 * @returns A value in roughly `[-1, 1]`.
 */
function gradientNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const n00 = gradientDot(ix, iy, seed, fx, fy);
  const n10 = gradientDot(ix + 1, iy, seed, fx - 1, fy);
  const n01 = gradientDot(ix, iy + 1, seed, fx, fy - 1);
  const n11 = gradientDot(ix + 1, iy + 1, seed, fx - 1, fy - 1);
  // 1.41 brings 2D gradient noise's natural ±0.707 range up to about ±1.
  return ((n00 + (n10 - n00) * ux) * (1 - uy) + (n01 + (n11 - n01) * ux) * uy) * 1.41;
}

/**
 * Fractional Brownian motion: several octaves of {@link gradientNoise}, each finer and quieter.
 *
 * @param x - The sample position along X.
 * @param y - The sample position along Y.
 * @param seed - The field's seed.
 * @param octaves - How many octaves to sum.
 * @param ridged - Whether to fold each octave into a ridge, which makes mountain crests.
 * @returns A value in `[0, 1]`.
 */
function fbm(x: number, y: number, seed: number, octaves: number, ridged = false): number {
  let sum = 0;
  let weight = 0;
  let amplitude = 1;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    const raw = gradientNoise(x * frequency, y * frequency, seed + octave * 131);
    sum += amplitude * (ridged ? 1 - Math.abs(raw) : raw * 0.5 + 0.5);
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return Math.min(1, Math.max(0, sum / weight));
}

/**
 * Builds the island's height field, in metres.
 *
 * @remarks
 * A warped radial falloff makes the coastline, a six-octave fbm makes the ground, and a ridged fbm
 * weighted by the falloff squared puts the peaks inland rather than in the surf.
 *
 * @returns `RESOLUTION * RESOLUTION` heights, row-major, north row first.
 */
function buildHeights(): Float32Array {
  const heights = new Float32Array(RESOLUTION * RESOLUTION);
  const last = RESOLUTION - 1;
  for (let z = 0; z < RESOLUTION; z += 1) {
    for (let x = 0; x < RESOLUTION; x += 1) {
      const u = x / last;
      const v = z / last;
      // The coastline is a turned ellipse pushed in and out by two octaves of noise, so the island
      // has bays and headlands rather than the disc a plain radial falloff gives.
      const dx = (u - 0.5) * 2;
      const dv = (v - 0.5) * 2;
      const rx = dx * COAST_COS - dv * COAST_SIN;
      const rz = dx * COAST_SIN + dv * COAST_COS;
      const warp = (fbm(u * 2.2, v * 2.2, 9001, 2) - 0.5) * 0.42 + (fbm(u * 5.3, v * 5.3, 4400, 2) - 0.5) * 0.14;
      const radius = Math.hypot(rx * 1.18, rz * 0.84) + warp;
      const shore = 1 - smoothstep(0.34, 0.86, radius);
      // The ground field is domain-warped: its own coordinates are bent by a coarser noise, which
      // is what turns parallel dunes into valleys that wander.
      const wx = u * 5.5 + gradientNoise(u * 2.4, v * 2.4, 55) * 0.45;
      const wz = v * 5.5 + gradientNoise(u * 2.4 + 5.7, v * 2.4 + 1.3, 56) * 0.45;
      const ground = fbm(wx, wz, 7, 6);
      const ridges = fbm(u * 4.2 + 11.3, v * 4.2 + 4.1, 21, 5, true);
      // One large, soft mask decides where the mountains are, so the rest of the island stays the
      // rolling grassland a walkable terrain needs.
      const massif = smoothstep(0.3, 0.68, fbm(u * 1.5 + 3.3, v * 1.5 + 7.7, 33, 3));
      const inland = shore * shore;
      let normalised = shore * (0.12 + 0.32 * ground) + inland * inland * massif * ridges * 0.95;
      // A gentle curve pulls the midtones down, which widens the beach and keeps the peaks sharp.
      normalised = Math.min(1, Math.max(0, normalised)) ** 1.45;
      heights[z * RESOLUTION + x] = normalised;
    }
  }
  // Scaled by the field's own maximum rather than clamped, so the summit lands just under the
  // document's height range whatever the weights above are and no peak is flattened into a mesa.
  let peak = 0;
  for (let index = 0; index < heights.length; index += 1) {
    peak = Math.max(peak, heights[index] ?? 0);
  }
  const scale = peak > 0 ? (HEIGHT_METRES * 0.98) / peak : 0;
  for (let index = 0; index < heights.length; index += 1) {
    heights[index] = (heights[index] ?? 0) * scale;
  }
  return heights;
}

/**
 * The slope of the field at one sample, in degrees.
 *
 * @param heights - The field.
 * @param x - The sample column.
 * @param z - The sample row.
 * @returns Degrees from horizontal: `0` flat, `90` vertical.
 */
function slopeAt(heights: Float32Array, x: number, z: number): number {
  const spacing = EXTENT_METRES / (RESOLUTION - 1);
  const left = heights[z * RESOLUTION + Math.max(0, x - 1)] ?? 0;
  const right = heights[z * RESOLUTION + Math.min(RESOLUTION - 1, x + 1)] ?? 0;
  const back = heights[Math.max(0, z - 1) * RESOLUTION + x] ?? 0;
  const front = heights[Math.min(RESOLUTION - 1, z + 1) * RESOLUTION + x] ?? 0;
  const dx = (right - left) / (2 * spacing);
  const dz = (front - back) / (2 * spacing);
  return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
}

/**
 * Encodes the height field as little-endian 16-bit samples.
 *
 * @param heights - The heights in metres.
 * @returns The `.r16` bytes.
 */
function encodeR16(heights: Float32Array): Buffer {
  const bytes = Buffer.alloc(heights.length * 2);
  for (let index = 0; index < heights.length; index += 1) {
    const sample = Math.round(((heights[index] ?? 0) / HEIGHT_METRES) * MAX_SAMPLE);
    bytes.writeUInt16LE(Math.min(MAX_SAMPLE, Math.max(0, sample)), index * 2);
  }
  return bytes;
}

/**
 * Paints the four-layer splat control map from the height field.
 *
 * @remarks
 * The channels are the document's layer order: red sand, green grass, blue rock, alpha snow. The
 * weights are not normalised here — the terrain's surface shader divides by their sum — so each
 * band may be feathered on its own, and a noise term breaks the rule-derived look into patches.
 *
 * @param heights - The heights in metres.
 * @returns `CONTROL_SIZE * CONTROL_SIZE * 4` bytes, row-major.
 */
function paintSplat(heights: Float32Array): Buffer {
  const pixels = Buffer.alloc(CONTROL_SIZE * CONTROL_SIZE * RGBA);
  const step = (RESOLUTION - 1) / CONTROL_SIZE;
  for (let row = 0; row < CONTROL_SIZE; row += 1) {
    for (let column = 0; column < CONTROL_SIZE; column += 1) {
      const sx = Math.min(RESOLUTION - 1, Math.round((column + 0.5) * step));
      const sz = Math.min(RESOLUTION - 1, Math.round((row + 0.5) * step));
      const height = heights[sz * RESOLUTION + sx] ?? 0;
      const slope = slopeAt(heights, sx, sz);
      const u = column / CONTROL_SIZE;
      const v = row / CONTROL_SIZE;
      // One patchy field, reused: it lifts the snow line on one slope and drops it on the next,
      // and it thins the grass where the rock takes over.
      const patch = (fbm(u * 14, v * 14, 4242, 4) - 0.5) * 2;
      const sand = 1 - smoothstep(SEA_LEVEL_METRES + 1.5, SEA_LEVEL_METRES + 8, height);
      const grass =
        smoothstep(SEA_LEVEL_METRES, SEA_LEVEL_METRES + 5, height) *
        (1 - smoothstep(34, 46 + patch * 8, slope)) *
        (1 - smoothstep(42, 56, height));
      const rock = smoothstep(34 + patch * 8, 50, slope) + smoothstep(48, 66, height) * 0.4;
      const snow = smoothstep(54 + patch * 8, 66, height) * (1 - smoothstep(48, 66, slope));
      const at = (row * CONTROL_SIZE + column) * RGBA;
      pixels[at] = Math.round(Math.min(1, Math.max(0, sand)) * 255);
      pixels[at + 1] = Math.round(Math.min(1, Math.max(0, grass)) * 255);
      pixels[at + 2] = Math.round(Math.min(1, Math.max(0, rock)) * 255);
      pixels[at + 3] = Math.round(Math.min(1, Math.max(0, snow)) * 255);
    }
  }
  return pixels;
}

/** How one ground layer's texture is tinted and roughened. */
interface LayerRecipe {
  /** The file stem, which is also the document's layer name. */
  readonly name: string;
  /** The base colour as three sRGB bytes. */
  readonly base: readonly [number, number, number];
  /** The colour the mottling moves towards, as three sRGB bytes. */
  readonly mottle: readonly [number, number, number];
  /** How much fine speckle to add, in sRGB bytes either side of the base. */
  readonly grain: number;
  /** The noise frequency across the tile: higher is finer. */
  readonly frequency: number;
}

/** The four ground layers, in the document's channel order. */
const LAYERS: readonly LayerRecipe[] = [
  { name: "sand", base: [214, 193, 148], mottle: [168, 145, 104], grain: 11, frequency: 5 },
  { name: "grass", base: [103, 136, 60], mottle: [58, 88, 40], grain: 13, frequency: 6 },
  { name: "rock", base: [131, 126, 118], mottle: [68, 66, 66], grain: 16, frequency: 4 },
  { name: "snow", base: [238, 242, 248], mottle: [196, 206, 224], grain: 7, frequency: 4 },
];

/**
 * Paints one ground layer's albedo tile.
 *
 * @remarks
 * The tile wraps: every noise coordinate is taken modulo the tile, so a layer repeating every few
 * metres across 512 m of ground shows no seam.
 *
 * @param recipe - The layer's colours and noise.
 * @param seed - The layer's seed.
 * @returns `LAYER_SIZE * LAYER_SIZE * 3` bytes, row-major.
 */
function paintLayer(recipe: LayerRecipe, seed: number): Buffer {
  const pixels = Buffer.alloc(LAYER_SIZE * LAYER_SIZE * RGB);
  const period = recipe.frequency;
  for (let row = 0; row < LAYER_SIZE; row += 1) {
    for (let column = 0; column < LAYER_SIZE; column += 1) {
      const u = (column / LAYER_SIZE) * period;
      const v = (row / LAYER_SIZE) * period;
      // The four corners of the tile are blended so the pattern is periodic in both directions.
      const a = fbm(u, v, seed, 4);
      const b = fbm(u - period, v, seed, 4);
      const c = fbm(u, v - period, seed, 4);
      const d = fbm(u - period, v - period, seed, 4);
      const fx = column / LAYER_SIZE;
      const fy = row / LAYER_SIZE;
      const blend = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      const speckle = (hash3(column, row, seed + 7) - 0.5) * 2 * recipe.grain;
      const at = (row * LAYER_SIZE + column) * RGB;
      for (let channel = 0; channel < RGB; channel += 1) {
        const base = recipe.base[channel] ?? 0;
        const mottle = recipe.mottle[channel] ?? 0;
        const value = base + (mottle - base) * blend + speckle;
        pixels[at + channel] = Math.round(Math.min(255, Math.max(0, value)));
      }
    }
  }
  return pixels;
}

/**
 * Paints the grass card: a few blades on transparent ground, which the foliage shader alpha-tests.
 *
 * @returns `CARD_SIZE * CARD_SIZE * 4` bytes, row-major, straight alpha.
 */
function paintGrassCard(): Buffer {
  const pixels = Buffer.alloc(CARD_SIZE * CARD_SIZE * RGBA);
  const blades = [
    { root: 0.2, lean: 0.16, width: 0.055 },
    { root: 0.42, lean: -0.05, width: 0.07 },
    { root: 0.62, lean: 0.09, width: 0.06 },
    { root: 0.82, lean: -0.14, width: 0.05 },
  ];
  for (let row = 0; row < CARD_SIZE; row += 1) {
    for (let column = 0; column < CARD_SIZE; column += 1) {
      const u = column / (CARD_SIZE - 1);
      // The card's origin is its bottom edge, so `t` is zero at the root and one at the tip.
      const t = 1 - row / (CARD_SIZE - 1);
      let covered = 0;
      for (const blade of blades) {
        const centre = blade.root + blade.lean * t * t;
        const halfWidth = blade.width * (1 - t * 0.85);
        if (Math.abs(u - centre) <= halfWidth && t <= 0.94) {
          covered = Math.max(covered, 1 - t * 0.35);
        }
      }
      const at = (row * CARD_SIZE + column) * RGBA;
      if (covered <= 0) {
        continue;
      }
      const shade = 0.55 + 0.45 * t + (hash3(column, row, 88) - 0.5) * 0.12;
      pixels[at] = Math.round(Math.min(255, 74 * shade + 18));
      pixels[at + 1] = Math.round(Math.min(255, 140 * shade + 26));
      pixels[at + 2] = Math.round(Math.min(255, 62 * shade + 14));
      pixels[at + 3] = 255;
    }
  }
  return pixels;
}

/**
 * Paints the tree atlas: bark in the bottom half, leaves in the top half.
 *
 * @remarks
 * One texture rather than two, because a `TerrainScatter` draws one mesh with one material; the
 * generated tree mesh puts its trunk's UVs in the lower half and its canopy's in the upper.
 *
 * @returns `CARD_SIZE * CARD_SIZE * 3` bytes, row-major.
 */
function paintTreeAtlas(): Buffer {
  const pixels = Buffer.alloc(CARD_SIZE * CARD_SIZE * RGB);
  for (let row = 0; row < CARD_SIZE; row += 1) {
    const isLeaf = row < CARD_SIZE / 2;
    for (let column = 0; column < CARD_SIZE; column += 1) {
      const grain = isLeaf
        ? fbm((column / CARD_SIZE) * 9, (row / CARD_SIZE) * 9, 515, 3)
        : fbm((column / CARD_SIZE) * 16, (row / CARD_SIZE) * 2, 616, 3);
      const at = (row * CARD_SIZE + column) * RGB;
      const base: readonly [number, number, number] = isLeaf ? [58, 104, 52] : [92, 71, 52];
      const range = isLeaf ? 34 : 26;
      for (let channel = 0; channel < RGB; channel += 1) {
        const value = (base[channel] ?? 0) + (grain - 0.5) * range;
        pixels[at + channel] = Math.round(Math.min(255, Math.max(0, value)));
      }
    }
  }
  return pixels;
}

/**
 * Writes one file and reports its size and digest.
 *
 * @param name - The file name inside {@link OUT_DIR}.
 * @param bytes - What to write.
 */
async function emit(name: string, bytes: Buffer | Uint8Array): Promise<void> {
  const outDir = resolve(import.meta.dirname, "..", OUT_DIR);
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, name), bytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  process.stdout.write(
    `${`${OUT_DIR}/${name}`.padEnd(38)} ${String(bytes.byteLength).padStart(8)} bytes  sha256 ${digest}\n`,
  );
}

const heights = buildHeights();
let peak = 0;
let land = 0;
for (let index = 0; index < heights.length; index += 1) {
  const height = heights[index] ?? 0;
  peak = Math.max(peak, height);
  if (height > SEA_LEVEL_METRES) {
    land += 1;
  }
}

await emit("island.r16", encodeR16(heights));
await emit(
  "island_splat.png",
  await sharp(paintSplat(heights), { raw: { width: CONTROL_SIZE, height: CONTROL_SIZE, channels: RGBA } })
    .png({ compressionLevel: 9 })
    .toBuffer(),
);
const layerFiles = await Promise.all(
  LAYERS.map(async (recipe: LayerRecipe, index: number) => ({
    name: `${recipe.name}_albedo.png`,
    bytes: await sharp(paintLayer(recipe, 300 + index * 97), {
      raw: { width: LAYER_SIZE, height: LAYER_SIZE, channels: RGB },
    })
      .png({ compressionLevel: 9 })
      .toBuffer(),
  })),
);
for (const file of layerFiles) {
  // Sequential on purpose: the encodes already ran in parallel above, and writing one at a time
  // keeps the report lines in layer order.
  // oxlint-disable-next-line no-await-in-loop -- see above.
  await emit(file.name, file.bytes);
}
await emit(
  "grass_card.png",
  await sharp(paintGrassCard(), { raw: { width: CARD_SIZE, height: CARD_SIZE, channels: RGBA } })
    .png({ compressionLevel: 9 })
    .toBuffer(),
);
await emit(
  "tree_atlas.png",
  await sharp(paintTreeAtlas(), { raw: { width: CARD_SIZE, height: CARD_SIZE, channels: RGB } })
    .png({ compressionLevel: 9 })
    .toBuffer(),
);

process.stdout.write(
  `island: ${String(RESOLUTION)}^2 samples over ${String(EXTENT_METRES)} m, peak ${peak.toFixed(1)} m, ` +
    `${((land / heights.length) * 100).toFixed(1)}% above the ${String(SEA_LEVEL_METRES)} m water line\n`,
);
