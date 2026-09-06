// Regenerates every texture and sound the two 3D templates ship, and copies the shared character
// rig into them under the two addresses the toolkit needs. Run with:
//   node tests/fixtures/assets/3d-templates/make-level-art.mjs
//
// Every byte is produced here or by `../3d/make-rig.mjs`, so the art is an original work (see
// ATTRIBUTION.md). Nothing is downloaded and no third-party asset pack is involved. The files are
// written straight into `templates/<name>/assets/`, because a template has to be self-contained:
// `create-ignifx` copies the directory verbatim into a player's project, so it cannot reference a
// path in this repository.
//
// The PNG and WAV encoders are the ones the 2D templates already use
// (`../2d-templates/png.mjs`); nothing new is written here except the images themselves.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { Canvas, encodePng, encodeWav, rng } from "../2d-templates/png.mjs";

const HERE = import.meta.dirname;
const REPO = join(HERE, "..", "..", "..", "..");
const SHARED_3D = join(REPO, "tests", "fixtures", "assets", "3d");
const THIRD = join(REPO, "templates", "3d-third-person", "assets");
const FIRST = join(REPO, "templates", "3d-first-person", "assets");

/** The edge of every generated texture, in pixels. A power of two, because mip chains want one. */
const SIZE = 128;

/** 22.05 kHz mono: a footstep has nothing above 11 kHz worth keeping, and it halves the file. */
const SAMPLE_RATE = 22_050;

const written = [];

/**
 * Writes one generated file and records its size for the closing report.
 * @param directory - The template `assets/` directory to write into.
 * @param name - The file name.
 * @param bytes - The encoded file.
 */
function write(directory, name, bytes) {
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
 * A footstep: a short burst of low-passed noise with a fast attack and a 90 ms tail.
 * @param seed - The noise seed, so the file is byte-identical on every run.
 * @returns The samples, each in `[-1, 1]`.
 */
function footstep(seed) {
  const random = rng(seed);
  const count = Math.round(SAMPLE_RATE * 0.12);
  const samples = new Float64Array(count);
  let low = 0;
  for (let i = 0; i < count; i += 1) {
    const t = i / SAMPLE_RATE;
    // A one-pole low pass turns white noise into the dull thud of a boot on concrete.
    low += (random() * 2 - 1 - low) * 0.18;
    const envelope = Math.exp(-t * 42) * Math.min(1, t * 900);
    samples[i] = low * envelope * 0.9;
  }
  return samples;
}

/**
 * An interaction blip: two short sine partials with a click at the front.
 * @param baseHz - The fundamental frequency.
 * @returns The samples, each in `[-1, 1]`.
 */
function blip(baseHz) {
  const count = Math.round(SAMPLE_RATE * 0.18);
  const samples = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const t = i / SAMPLE_RATE;
    const envelope = Math.exp(-t * 16) * Math.min(1, t * 1200);
    samples[i] = envelope * 0.5 * (Math.sin(2 * Math.PI * baseHz * t) + 0.35 * Math.sin(2 * Math.PI * baseHz * 3 * t));
  }
  return samples;
}

const floor = floorTexture();
const wall = wallTexture();

write(THIRD, "floor.png", floor);
write(THIRD, "wall.png", wall);
write(THIRD, "crate.png", crateTexture([146, 104, 62], 0x0bad_c0de));
write(THIRD, "footstep.wav", encodeWav(footstep(0x1234_5678), SAMPLE_RATE));
copyShared(THIRD, "rig.glb", "player.glb");
copyShared(THIRD, "rig.glb", "companion.glb");
copyShared(THIRD, "hero.animator.json", "hero.animator.json");

write(FIRST, "floor.png", floor);
write(FIRST, "wall.png", wall);
write(FIRST, "crate.png", crateTexture([70, 122, 138], 0x00c0_ffee));
write(FIRST, "blip.wav", encodeWav(blip(660), SAMPLE_RATE));
copyShared(FIRST, "rig.glb", "viewmodel.glb");
copyShared(FIRST, "hero.animator.json", "hero.animator.json");

for (const [name, bytes] of written) {
  process.stdout.write(`${name.padEnd(44)} ${bytes === 0 ? "(copied)" : `${String(bytes).padStart(7)} bytes`}\n`);
}
