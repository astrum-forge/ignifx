// Regenerates every texture the two 3D templates ship, and copies the shared character rig into
// them under the two addresses the toolkit needs. Run with:
//   node tests/fixtures/assets/3d-templates/make-level-art.mjs
//
// Every byte is produced here or by `../3d/make-rig.mjs`, so the art is an original work (see
// ATTRIBUTION.md). Nothing is downloaded and no third-party asset pack is involved. The files are
// written straight into `templates/<name>/assets/`, because a template has to be self-contained:
// `create-ignifx` copies the directory verbatim into a player's project, so it cannot reference a
// path in this repository.
//
// The PNG encoder is the one the 2D templates already use (`../2d-templates/png.mjs`); nothing new
// is written here except the images themselves. Sound is not written here either:
// `../audio-templates/make-template-audio.mjs` owns every `.wav` in every template.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { Canvas, encodePng, rng } from "../2d-templates/png.mjs";

const HERE = import.meta.dirname;
const REPO = join(HERE, "..", "..", "..", "..");
const SHARED_3D = join(REPO, "tests", "fixtures", "assets", "3d");
const THIRD = join(REPO, "templates", "3d-third-person", "assets");
const FIRST = join(REPO, "templates", "3d-first-person", "assets");

/** The edge of every generated texture, in pixels. A power of two, because mip chains want one. */
const SIZE = 128;

/**
 * The edge of the sky texture, in pixels. Four times {@link SIZE}: a gradient wrapped around a
 * sphere needs many more steps than a tiling surface does before a band shows.
 */
const SKY_SIZE = 256;

/**
 * The per-file ceiling, in bytes. `create-ignifx` copies a template into a player's project, so a
 * generated file that grows past this is a bug in the art, not a budget to raise.
 */
const MAX_BYTES = 64 * 1024;

const written = [];

/**
 * Writes one generated file and records its size for the closing report.
 * @param directory - The template `assets/` directory to write into.
 * @param name - The file name.
 * @param bytes - The encoded file.
 * @throws {Error} If the file is over {@link MAX_BYTES}.
 */
function write(directory, name, bytes) {
  if (bytes.length > MAX_BYTES) {
    throw new Error(`${name} is ${String(bytes.length)} bytes, over the ${String(MAX_BYTES)}-byte ceiling`);
  }
  mkdirSync(directory, { recursive: true });
  const target = join(directory, name);
  writeFileSync(target, bytes);
  written.push([`${directory.split("/").at(-2)}/assets/${name}`, bytes.length]);
}

/**
 * Copies one of the shared 3D fixtures into a template under a new name.
 * @remarks
 * `@ignifx/3d` binds one `Animator` per **model asset**: two `Model`s of one `.glb` cannot animate
 * independently, because Babylon Lite binds an animation group to a single manager and a cloned
 * skinned mesh shares the template's skeleton. The player and the companion are therefore two
 * copies of the same generated rig at two addresses, which is the documented workaround.
 * @param directory - The template `assets/` directory to write into.
 * @param source - The file name under `tests/fixtures/assets/3d/`.
 * @param name - The name to copy it under.
 */
function copyShared(directory, source, name) {
  mkdirSync(directory, { recursive: true });
  copyFileSync(join(SHARED_3D, source), join(directory, name));
  written.push([`${directory.split("/").at(-2)}/assets/${name}`, 0]);
}

/**
 * Mixes two colours.
 * @param a - The first colour, `[r, g, b]`.
 * @param b - The second colour.
 * @param t - How much of `b`, in `[0, 1]`.
 * @returns The mix.
 */
function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * The floor: a poured slab scored into 32-pixel bays, with a fine speckle so a large `uvScale`
 * still has something to resolve.
 * @returns The image.
 */
function floorTexture() {
  const canvas = new Canvas(SIZE, SIZE);
  const random = rng(0x5f3d_1001);
  const base = [72, 78, 90];
  const light = [96, 103, 118];
  const groove = [46, 50, 60];
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const speckle = random() * 0.22 - 0.11;
      canvas.set(x, y, mix(base, speckle > 0 ? light : groove, Math.abs(speckle)));
    }
  }
  // Two scored lines per axis, one pixel of highlight on their lower-right lip.
  for (const offset of [0, 64]) {
    canvas.rect(offset, 0, 2, SIZE, groove);
    canvas.rect(0, offset, SIZE, 2, groove);
    canvas.rect(offset + 2, 0, 1, SIZE, mix(base, light, 0.5));
    canvas.rect(0, offset + 2, SIZE, 1, mix(base, light, 0.5));
  }
  return encodePng(canvas);
}

/**
 * The walls: a ribbed panel, so the camera-collision demo has something with a readable silhouette.
 * @returns The image.
 */
function wallTexture() {
  const canvas = new Canvas(SIZE, SIZE);
  const random = rng(0x21c8_4477);
  const base = [58, 64, 79];
  const rib = [82, 90, 108];
  const shadow = [38, 42, 53];
  // `rect` over the whole image rather than `Canvas.fill`: a linter cannot tell that method from
  // `Array.prototype.fill`, and reports the colour array as a shared reference value.
  canvas.rect(0, 0, SIZE, SIZE, base);
  for (let x = 0; x < SIZE; x += 16) {
    canvas.rect(x, 0, 10, SIZE, rib);
    canvas.rect(x + 10, 0, 3, SIZE, shadow);
  }
  // A skirting band along the bottom edge, which is what tells the eye which way is up.
  canvas.rect(0, SIZE - 14, SIZE, 14, mix(base, shadow, 0.5));
  canvas.rect(0, SIZE - 16, SIZE, 2, rib);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (random() > 0.94) {
        canvas.set(x, y, mix(canvas.get(x, y), shadow, 0.35));
      }
    }
  }
  return encodePng(canvas);
}

/**
 * The crates: planks, a diagonal brace, and a bevelled border.
 * @param tint - The plank colour, `[r, g, b]`.
 * @param seed - The speckle seed, so two crates are not the same image.
 * @returns The image.
 */
function crateTexture(tint, seed) {
  const canvas = new Canvas(SIZE, SIZE);
  const random = rng(seed);
  const dark = mix(tint, [24, 18, 14], 0.55);
  const light = mix(tint, [255, 236, 205], 0.3);
  canvas.rect(0, 0, SIZE, SIZE, tint);
  for (let y = 0; y < SIZE; y += 32) {
    canvas.rect(0, y, SIZE, 2, dark);
    canvas.rect(0, y + 2, SIZE, 1, light);
  }
  // The brace, drawn as a thick line from corner to corner.
  for (let i = 0; i < SIZE; i += 1) {
    for (let w = -4; w <= 4; w += 1) {
      canvas.set(i, i + w, light);
      canvas.set(i, SIZE - 1 - i + w, mix(tint, dark, 0.5));
    }
  }
  canvas.rect(0, 0, SIZE, 5, dark);
  canvas.rect(0, SIZE - 5, SIZE, 5, dark);
  canvas.rect(0, 0, 5, SIZE, dark);
  canvas.rect(SIZE - 5, 0, 5, SIZE, dark);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (random() > 0.9) {
        canvas.set(x, y, mix(canvas.get(x, y), dark, 0.3));
      }
    }
  }
  return encodePng(canvas);
}

/**
 * Mixes two colours without rounding, so the ordered dither below has a fraction left to spend.
 * @param a - The first colour, `[r, g, b]`.
 * @param b - The second colour.
 * @param t - How much of `b`, in `[0, 1]`.
 * @returns The mix, as three floats.
 */
function mixExact(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * The cubic ease `3t² − 2t³`, so the two halves of the sky meet without a crease at the join.
 * @param t - The position along the segment.
 * @returns The eased position, clamped to `[0, 1]`.
 */
function smoothstep(t) {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * The 4x4 ordered-dither matrix, in threshold order.
 * @remarks
 * A vertical gradient over 256 rows moves less than one code value per row in places, and the
 * rounding is what a viewer sees as a band. Nudging each pixel by up to half a code value on a
 * fixed 4x4 lattice turns the band into a texture the eye averages out. The lattice is used
 * because it is periodic: 256 is a whole number of tiles wide, so the pattern still meets itself
 * where the texture wraps around the sphere.
 */
const BAYER_4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * The sky: a vertical three-stop gradient, uniform across every row, ordered-dithered.
 * @remarks
 * `Environment.skybox` wants a `.dds` or `.env` cube map, which cannot be produced here, so the
 * sky is this texture on an inverted sphere with an unlit, double-sided material instead. Because
 * every row is one colour, the left and right edges of the image are identical and the seam where
 * the sphere's UVs wrap is invisible.
 * @param zenith - The colour straight overhead, `[r, g, b]`.
 * @param band - The paler colour partway down.
 * @param horizon - The colour at the bottom.
 * @returns The image.
 */
function skyTexture(zenith, band, horizon) {
  const canvas = new Canvas(SKY_SIZE, SKY_SIZE);
  // Where the pale band sits. Above it the sky darkens to the zenith; below it, it warms.
  const split = 0.58;
  for (let y = 0; y < SKY_SIZE; y += 1) {
    const t = y / (SKY_SIZE - 1);
    const colour =
      t < split
        ? mixExact(zenith, band, smoothstep(t / split))
        : mixExact(band, horizon, smoothstep((t - split) / (1 - split)));
    const bias = BAYER_4.slice((y % 4) * 4, (y % 4) * 4 + 4);
    for (let x = 0; x < SKY_SIZE; x += 1) {
      const nudge = bias[x % 4] / 16 - 0.469;
      canvas.set(x, y, [
        Math.max(0, Math.min(255, Math.round(colour[0] + nudge))),
        Math.max(0, Math.min(255, Math.round(colour[1] + nudge))),
        Math.max(0, Math.min(255, Math.round(colour[2] + nudge))),
      ]);
    }
  }
  return encodePng(canvas);
}

const floor = floorTexture();
const wall = wallTexture();

write(THIRD, "floor.png", floor);
write(THIRD, "wall.png", wall);
write(THIRD, "crate.png", crateTexture([146, 104, 62], 0x0bad_c0de));
// A clear late afternoon: a deep blue overhead falling through a pale band to a warm horizon.
write(THIRD, "sky.png", skyTexture([38, 78, 150], [146, 184, 216], [242, 198, 150]));
copyShared(THIRD, "rig.glb", "player.glb");
copyShared(THIRD, "rig.glb", "companion.glb");
copyShared(THIRD, "hero.animator.json", "hero.animator.json");

write(FIRST, "floor.png", floor);
write(FIRST, "wall.png", wall);
write(FIRST, "crate.png", crateTexture([70, 122, 138], 0x00c0_ffee));
// The same sky an hour later and indoors-adjacent: cooler, dimmer, and barely warm at the bottom.
write(FIRST, "sky.png", skyTexture([20, 28, 52], [70, 86, 116], [136, 124, 128]));
copyShared(FIRST, "rig.glb", "viewmodel.glb");
copyShared(FIRST, "hero.animator.json", "hero.animator.json");

for (const [name, bytes] of written) {
  process.stdout.write(`${name.padEnd(44)} ${bytes === 0 ? "(copied)" : `${String(bytes).padStart(7)} bytes`}\n`);
}
