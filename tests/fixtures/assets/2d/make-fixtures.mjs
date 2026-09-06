// Regenerates the PNG fixtures in this directory. Run with:
//   node tests/fixtures/assets/2d/make-fixtures.mjs
// Every byte is produced here, so the images are original works (see ATTRIBUTION.md).
import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = import.meta.dirname;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * Computes the CRC-32 of a byte range, as PNG's chunk trailer defines it.
 * @param bytes - The bytes to check.
 * @returns The checksum, as an unsigned 32-bit integer.
 */
function crc32(bytes) {
  let c = 0xff_ff_ff_ff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xff_ff_ff_ff) >>> 0;
}

/**
 * Wraps a payload in a PNG chunk: length, type, data, CRC.
 * @param type - The four-character chunk type, for example `"IHDR"`.
 * @param data - The chunk's payload.
 * @returns The complete chunk.
 */
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * Encodes straight-alpha RGBA8 pixels (row-major, top row first) as a colour-type-6 PNG.
 * @param width - The image width, in pixels.
 * @param height - The image height, in pixels.
 * @param rgba - The pixels, four bytes each.
 * @returns The complete PNG file.
 */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Builds an RGBA8 pixel buffer from a per-pixel function.
 * @param width - The image width, in pixels.
 * @param height - The image height, in pixels.
 * @param fn - Returns `[r, g, b, a]` for a pixel.
 * @returns The pixel buffer.
 */
function pixels(width, height, fn) {
  const buf = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = fn(x, y);
      const o = (y * width + x) * 4;
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
      buf[o + 3] = a;
    }
  }
  return buf;
}

// hero.png — 64x64, a 2x2 grid of 32x32 frames in reading order (top-left is frame 0).
// Each frame is one flat colour with a one-pixel extruded border of the same colour, so the
// atlas passes the pixel-perfect border check. Frame colours are far apart in every channel so a
// screenshot test can identify a frame from a single texel.
const FRAME_COLOURS = [
  [255, 0, 0, 255], // 0: idle_0  red
  [0, 255, 0, 255], // 1: idle_1  green
  [0, 0, 255, 255], // 2: run_0   blue
  [255, 255, 0, 255], // 3: run_1  yellow
];
writeFileSync(
  join(HERE, "hero.png"),
  encodePng(
    64,
    64,
    pixels(64, 64, (x, y) => FRAME_COLOURS[(y < 32 ? 0 : 2) + (x < 32 ? 0 : 1)]),
  ),
);

// checker.png — 16x16 magenta/black checkerboard, one pixel per cell. The S6.3 pixel-perfect
// spike reads this back: at an integer zoom every screen pixel must be pure magenta or pure
// black, never a blend of the two.
writeFileSync(
  join(HERE, "checker.png"),
  encodePng(
    16,
    16,
    pixels(16, 16, (x, y) => ((x + y) % 2 === 0 ? [255, 0, 255, 255] : [0, 0, 0, 255])),
  ),
);
