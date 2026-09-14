// Writes the four images the Particles examples draw with, and the three sprite atlases that name
// them. Run it from the website package:
//
//   pnpm --filter @ignifx/website exec node examples/_tools/make-particle-sprites.ts
//
// The output is committed. It is the repository's own art, so it carries the repository's licence
// and needs no third-party attribution — the same arrangement `make-grid-texture.ts` describes.
//
// ## Why there are any images at all
//
// A 3D `ParticleSystem` needs none: with no `renderer.texture` the generated program draws a soft
// procedural disc, which is what eight of the nine presets want. The one thing arithmetic in the
// shader will not give you is a *ring*, so `textures/shockwave.png` exists for the blast wave in
// `explosion`.
//
// A `ParticleSystem2D` is different: it writes into a `SpriteBatch`, and a batch draws an atlas.
// So the three 2D effects need one atlas each — and the sparkle's is a four-frame sheet, because
// the frame rule (`packages/particles-2d/skills/particles-2d/SKILL.md`) is that tile *n* of a
// document's `renderer.sheet` is frame *n* of the atlas, and showing that is worth one more file.
//
// Every sprite is painted white: a particle's colour is the document's, applied as a tint, so a
// white sprite is the one that can be any colour.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import sharp from "sharp";

/** One image to write, as raw RGBA. */
interface Image {
  /** Where it goes, relative to `website/examples`. */
  readonly path: string;
  /** Pixels across. */
  readonly width: number;
  /** Pixels down. */
  readonly height: number;
  /** The pixels, four bytes each. */
  readonly pixels: Uint8Array;
}

/** The ring's edge length in pixels. Large enough that the blast wave has no visible facets. */
const RING_SIZE = 128;

/** Where the ring's centre line sits, as a fraction of the half-width. */
const RING_RADIUS = 0.74;

/** How wide the ring's falloff is, in the same fraction. */
const RING_WIDTH = 0.16;

/** The edge length of one 2D sprite, in pixels: one tile of the village's 16-pixel grid. */
const SPRITE_SIZE = 16;

/**
 * The gap between sprite frames, in pixels.
 *
 * @remarks
 * One pixel of padding on every side, and the intensity is evaluated across it, so each frame's
 * edge colour is extruded into the border. Without it the loader reports `IGX-1102`: a
 * pixel-perfect camera can sample the neighbouring frame when a texel lands on a seam.
 */
const SPRITE_PITCH = SPRITE_SIZE + 2;

/** How many frames the sparkle's sheet has. */
const SPARKLE_FRAMES = 4;

/**
 * Builds an image by evaluating an intensity for every pixel.
 *
 * @remarks
 * Both channels carry the same number, which is what makes one image work under both blend modes:
 * `additive` may or may not scale by alpha depending on the pipeline state, and a sprite whose RGB
 * is already zero where its alpha is adds nothing either way.
 *
 * @param path - Where it goes, relative to `website/examples`.
 * @param width - Pixels across.
 * @param height - Pixels down.
 * @param intensity - The value at one pixel, `0` to `1`, from its centre in pixel coordinates.
 * @returns The image.
 */
function paint(path: string, width: number, height: number, intensity: (x: number, y: number) => number): Image {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = Math.round(255 * Math.max(0, Math.min(1, intensity(x + 0.5, y + 0.5))));
      const offset = (y * width + x) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = value;
    }
  }
  return { path, width, height, pixels };
}

/**
 * A soft disc that reaches zero at the edge of its tile.
 *
 * @param x - Pixel centre across.
 * @param y - Pixel centre down.
 * @param size - The tile's edge length.
 * @param power - How hard the falloff is; higher is tighter.
 * @returns The intensity.
 */
function disc(x: number, y: number, size: number, power: number): number {
  const half = size / 2;
  const d = Math.hypot(x - half, y - half) / half;
  return (1 - Math.min(1, d)) ** power;
}

/** The blast ring: one bright annulus with a gaussian falloff on both sides. */
const ring = paint("assets/textures/shockwave.png", RING_SIZE, RING_SIZE, (x: number, y: number): number => {
  const half = RING_SIZE / 2;
  const d = Math.hypot(x - half, y - half) / half;
  return Math.exp(-(((d - RING_RADIUS) / RING_WIDTH) ** 2));
});

/** The torch flame: a tall soft blob, brightest in its lower half where a flame is hottest. */
const flame = paint("assets/2d/fx-flame.png", SPRITE_PITCH, SPRITE_PITCH, (x: number, y: number): number => {
  const half = SPRITE_PITCH / 2;
  const dx = (x - half) / (half * 0.72);
  const dy = (y - half * 1.15) / half;
  return (1 - Math.min(1, Math.hypot(dx, dy))) ** 0.8;
});

/** The footstep puff: a plain soft disc, wide and weak. */
const dust = paint("assets/2d/fx-dust.png", SPRITE_PITCH, SPRITE_PITCH, (x: number, y: number): number =>
  disc(x, y, SPRITE_PITCH, 1.4),
);

/** The coin sparkle: four frames of a four-pointed star opening and closing. */
const sparkle = paint(
  "assets/2d/fx-spark.png",
  SPRITE_PITCH * SPARKLE_FRAMES,
  SPRITE_PITCH,
  (x: number, y: number): number => {
    const frame = Math.floor(x / SPRITE_PITCH);
    const half = SPRITE_PITCH / 2;
    const dx = Math.abs((x % SPRITE_PITCH) - half) / half;
    const dy = Math.abs(y - half) / half;
    // The star grows over the four frames: each arm reaches further while the waist stays thin.
    const reach = 0.4 + 0.2 * frame;
    const across = Math.max(0, 1 - dx / reach) * Math.max(0, 1 - dy / 0.2);
    const down = Math.max(0, 1 - dy / reach) * Math.max(0, 1 - dx / 0.2);
    const core = Math.max(0, 1 - Math.hypot(dx, dy) / 0.28);
    return Math.max(across, down) + core;
  },
);

/** One atlas document beside an image, naming its frames. */
interface Atlas {
  /** Where it goes, relative to `website/examples`. */
  readonly path: string;
  /** The image file it cuts up, relative to the atlas. */
  readonly image: string;
  /** How many frames across the image holds. */
  readonly frames: number;
}

/** The three atlases the 2D effects draw from. */
const ATLASES: readonly Atlas[] = [
  { path: "assets/2d/fx-flame.atlas.json", image: "fx-flame.png", frames: 1 },
  { path: "assets/2d/fx-dust.atlas.json", image: "fx-dust.png", frames: 1 },
  { path: "assets/2d/fx-spark.atlas.json", image: "fx-spark.png", frames: SPARKLE_FRAMES },
];

/**
 * Writes one file and prints its size and digest.
 *
 * @param path - Where it goes, relative to `website/examples`.
 * @param data - The bytes.
 */
async function emit(path: string, data: Uint8Array | string): Promise<void> {
  const outPath = resolve(import.meta.dirname, "..", path);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, data);
  const bytes = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  process.stdout.write(
    `${path.padEnd(34)} ${String(bytes.byteLength).padStart(6)} bytes  sha256 ${createHash("sha256")
      .update(bytes)
      .digest("hex")}\n`,
  );
}

await Promise.all(
  [ring, flame, dust, sparkle].map(async (image) => {
    const png = await sharp(Buffer.from(image.pixels), {
      raw: { width: image.width, height: image.height, channels: 4 },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await emit(image.path, png);
  }),
);

const atlasWrites: Promise<void>[] = [];
for (const atlas of ATLASES) {
  const frames = Array.from({ length: atlas.frames }, (_unused: unknown, index: number) => ({
    name: `frame_${String(index)}`,
    x: index * SPRITE_PITCH + 1,
    y: 1,
    w: SPRITE_SIZE,
    h: SPRITE_SIZE,
    pivot: [0.5, 0.5],
  }));
  const document = {
    format: "ignifx.spriteatlas",
    formatVersion: 1,
    image: atlas.image,
    sampling: "nearest",
    premultipliedAlpha: false,
    frames,
  };
  atlasWrites.push(emit(atlas.path, `${JSON.stringify(document, null, 2)}\n`));
}
await Promise.all(atlasWrites);
