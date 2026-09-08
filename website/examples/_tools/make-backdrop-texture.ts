// Writes `website/examples/assets/textures/backdrop.png`, the soft pool of light the kit's studio
// backdrop sphere is painted with. Run it from the website package:
//
//   pnpm --filter @ignifx/website exec node examples/_tools/make-backdrop-texture.ts
//
// The output is committed, and it is the repository's own art, so it carries the repository's
// licence and needs no third-party attribution — the same arrangement the templates use for their
// sprites.
//
// ## Why a sphere and a ramp rather than a skybox
//
// `Environment.skybox` draws the `.env`'s own cube map, and the studio probe's cube map is a
// mid-grey softbox room: correct as image-based lighting, wrong as a backdrop behind a product
// shot. Blurring it is not a way out either, because `Environment.blur` softens the *reflections*
// as well, and the reflections are the point of the hero. So the backdrop is what
// `templates/3d-third-person/src/level.ts` already does for its sky: one inverted sphere with an
// `unlit`, `doubleSided` material. A cube map cannot be generated from arithmetic the way every
// other asset in this repository is (`CONSTITUTION.md` §11.3); a 512-pixel ramp can.
//
// ## Why the bytes are darker than the tones they produce
//
// This file states the tones it wants **on screen** and solves for the bytes that produce them,
// because an unlit surface is lifted hard on its way to the frame: the material samples its
// base-colour texture as linear data, the exposure multiplies it, and the shadow end of ACES lifts
// what is left. Predicting that from the shader is not worth the risk of being wrong, so it was
// measured — a staircase of known bytes rendered into this scene at `SHOT.exposure`, read off the
// frame at 1280x720 on 2026-09-07:
//
// | byte   |  3 |  5 |  7 | 10 | 14 | 19 | 26 | 36 |
// | ------ | -- | -- | -- | -- | -- | -- | -- | -- |
// | frame  | 11 | 16 | 20 | 26 | 33 | 42 | 52 | 66 |
//
// which is `frame = 4.983 * byte ** 0.721` to within half a level everywhere, and neutral in every
// channel. {@link shown} is that law and {@link authored} inverts it. Re-measure both if
// `SHOT.exposure` changes, because the exposure is inside the constant.
//
// The tones themselves are the site's own dark tokens (`02-design-system.md` §2.3), because the
// page wraps this frame in an ember glow and the frame has to sit inside it: `--bg` (`#0D1015`) at
// the edges of the frame, and no more than a shade past `--sunk` (`#1B212A`) behind the subject.
//
// ## Why it is a narrow pool and not a ramp
//
// Key art is quiet at the edges of the frame. The engine has no vignette pass and no depth of field
// (`website/plan/04-examples-platform.md` §7.4 lists both as engine work), so the falloff has to be
// *in the scene*: one soft elliptical pool of light on the backdrop, behind the subject, with
// everything outside it at near-black. A sphere's `u` is longitude and its `v` is latitude, so the
// pool's size is an angle, and the angle that matters is the camera's: a 26-degree vertical field
// of view on a 16:9 frame spans about 45 degrees across, so a pool wider than about 22 degrees of
// azimuth either side of centre never falls off inside the frame at all. Measured 2026-09-07 at a
// half-width of 0.16 — 58 degrees — which lit every corner of the frame to `#1E2332`.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import sharp from "sharp";

/** Where the ramp is written, relative to `website/examples`. */
const OUT_PATH = "assets/textures/backdrop.png";

/** The texture's width in pixels: longitude, wrapping right round the sphere. */
const WIDTH: number = 512;

/** The texture's height in pixels: latitude, pole to pole. */
const HEIGHT: number = 512;

/**
 * The exposure the tones below are solved for: `SHOT.exposure` in `examples/pbr-model/shot.ts`.
 *
 * @remarks
 * The hero's lamps carry the subject and the exposure stays low, which is what leaves this texture
 * a wide enough range of bytes to be smooth: about fifteen of them between the two tones, where
 * exposure 1.55 would leave four and band the falloff visibly.
 */
const EXPOSURE = 0.8;

/** The tone the frame's edges are meant to show: `--bg`. */
const EDGE_TONE = "#0D1015";

/** The tone behind the subject: a shade past `--sunk`, and the brightest the backdrop ever goes. */
const POOL_TONE = "#1F2530";

/**
 * The pool's half-width, as a fraction of the texture: 0.085 is about 31 degrees of azimuth.
 *
 * @remarks
 * Wider than the frame's own half-width of 22.5 degrees, and that is the point: the subject fills
 * the middle of the frame, so a pool the size of the frame has its bright centre hidden behind the
 * hull and only its falloff on show. Measured 2026-09-07 at 0.06 and then 0.072, which left the
 * visible backdrop flat at the edge tone either side of the ship — two levels of lift across the
 * whole frame. At 0.085 by 0.13 the halo immediately around the hull sits at about two thirds of
 * the pool's lift, the top and bottom edges at 0.4, and the corners at 0.02, which is a soft glow
 * behind the subject falling to `--bg` at the corners.
 */
const POOL_U = 0.085;

/**
 * The pool's half-height, as a fraction of the texture: 0.13 is about 23 degrees of latitude,
 * against the frame's own 13.
 *
 * @remarks
 * Taller than the frame on purpose, for the reason {@link POOL_U} gives: the ship is a wide
 * horizontal shape across the middle of the frame, so a pool that ends inside the frame is a pool
 * the ship is standing in front of, and the glow has to reach past the hull's top and bottom edges
 * to be seen at all.
 */
const POOL_V = 0.13;

/**
 * Which row of the texture the pool's centre sits on.
 *
 * @remarks
 * Not 0.5, and this is the number that is easiest to get wrong. `0.5` is the sphere's equator,
 * which is the horizontal plane through the *world* origin — and the hero's camera sits below its
 * subject and looks upward, so the equator lands near the bottom edge of the frame rather than
 * behind the ship. Calibrated 2026-09-07 by rendering marker bands into this texture and reading
 * the rows they landed on: at `SHOT`'s lens and pitch, `v = 0.58` came out at row 280 of 720 and
 * `v = 0.50` at row 647, so v runs *upward* at about 4,588 rows per unit and the frame's centre is
 * `v = 0.563`. It follows that this number depends on `SHOT.pitch` and on the subject's `height`:
 * change either and the pool has to be re-centred, which is what the marker-band render is for.
 */
const POOL_V_CENTRE = 0.563;

/**
 * The frame's gain over a texture byte, at {@link EXPOSURE}. See the header's measurement.
 */
const FRAME_GAIN = 4.983;

/** The frame's exponent over a texture byte, at {@link EXPOSURE}. See the header's measurement. */
const FRAME_GAMMA = 0.721;

/** A colour as three channels, in whatever space the function taking it says. */
type Triple = readonly [number, number, number];

/**
 * Parses `#RRGGBB`.
 *
 * @param hex - The colour.
 * @returns Its bytes.
 */
function parse(hex: string): Triple {
  const at = (index: number): number => Number.parseInt(hex.slice(index, index + 2), 16);
  return [at(1), at(3), at(5)];
}

/**
 * Formats bytes as `#RRGGBB`.
 *
 * @param color - The bytes.
 * @returns The colour.
 */
function format(color: Triple): string {
  return `#${color.map((v: number): string => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * What the frame shows for a byte in this texture.
 *
 * @param bytes - The texture's bytes.
 * @returns The sRGB bytes the frame shows, unrounded.
 */
function shown(bytes: Triple): Triple {
  const frame = (channel: number): number => Math.min(255, FRAME_GAIN * channel ** FRAME_GAMMA);
  return [frame(bytes[0]), frame(bytes[1]), frame(bytes[2])];
}

/**
 * The bytes this texture needs so the frame shows a tone.
 *
 * @param tone - The `#RRGGBB` tone wanted on screen.
 * @returns The bytes, rounded.
 */
function authored(tone: string): Triple {
  const target = parse(tone);
  const byte = (channel: number): number =>
    Math.min(255, Math.max(0, Math.round((channel / FRAME_GAIN) ** (1 / FRAME_GAMMA))));
  return [byte(target[0]), byte(target[1]), byte(target[2])];
}

/**
 * The pool's weight at one texel.
 *
 * @remarks
 * A smoothstep over the elliptical distance from the centre: the eye finds the second derivative of
 * a linear falloff, and a pool that reads as light rather than as a shape must have no edge
 * anywhere in it. Everything at or beyond the ellipse is the edge tone.
 *
 * @param u - The column's position, `0` to `1`.
 * @param v - The row's position, `0` at one pole and `1` at the other.
 * @returns `1` at the centre of the pool and `0` outside it.
 */
function weight(u: number, v: number): number {
  const du = (u - 0.5) / POOL_U;
  const dv = (v - POOL_V_CENTRE) / POOL_V;
  const distance = Math.hypot(du, dv);
  if (distance >= 1) {
    return 0;
  }
  const t = 1 - distance;
  return t * t * (3 - 2 * t);
}

const dark = authored(EDGE_TONE);
const light = authored(POOL_TONE);
const pixels = Buffer.alloc(WIDTH * HEIGHT * 3);
for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    const mix = weight(x / (WIDTH - 1), y / (HEIGHT - 1));
    const offset = (y * WIDTH + x) * 3;
    for (let channel = 0; channel < 3; channel += 1) {
      const from = dark[channel] ?? 0;
      const to = light[channel] ?? 0;
      // The mix is linear in the bytes, which is linear in the light: the texture is sampled as
      // linear data, so a straight lerp is a straight lerp in radiance.
      pixels[offset + channel] = Math.round(from + (to - from) * mix);
    }
  }
}

const png = await sharp(pixels, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
  .png({ compressionLevel: 9, effort: 10 })
  .toBuffer();

const outPath = resolve(import.meta.dirname, "..", OUT_PATH);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, png);
process.stdout.write(
  `${OUT_PATH}  ${String(png.byteLength)} bytes  ${String(WIDTH)}x${String(HEIGHT)}  ` +
    `sha256 ${createHash("sha256").update(png).digest("hex")}\n` +
    `edge ${format(dark)} renders ${format(shown(dark))} (wanted ${EDGE_TONE}), ` +
    `pool ${format(light)} renders ${format(shown(light))} (wanted ${POOL_TONE}) ` +
    `at exposure ${String(EXPOSURE)}; ${String(light[2] - dark[2])} byte steps across the falloff\n`,
);
