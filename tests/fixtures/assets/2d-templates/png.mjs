// A minimal PNG and WAV encoder, written against the published specifications so that every byte
// of the template art is produced here rather than downloaded (CONSTITUTION.md §11.3). It uses
// only `node:zlib`; no image or audio library is involved.
//
// Shared by `make-template-art.mjs` and `make-template-levels.mjs`; kept separate so the art
// script reads as art.
import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";

/** The CRC-32 lookup table PNG chunks are checked with, built once. */
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
 * A mutable RGBA8 image with a top-left origin, the orientation every ignifx atlas is authored in.
 */
export class Canvas {
  /**
   * Builds a transparent image.
   * @param width - The width, in pixels.
   * @param height - The height, in pixels.
   */
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 4);
  }

  /**
   * Writes one pixel. Coordinates outside the image are ignored, so shapes may overhang.
   * @param x - The column.
   * @param y - The row.
   * @param colour - `[r, g, b]` or `[r, g, b, a]`, each 0 to 255.
   */
  set(x, y, colour) {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const o = (py * this.width + px) * 4;
    this.data[o] = colour[0];
    this.data[o + 1] = colour[1];
    this.data[o + 2] = colour[2];
    this.data[o + 3] = colour.length > 3 ? colour[3] : 255;
  }

  /**
   * Reads one pixel.
   * @param x - The column.
   * @param y - The row.
   * @returns `[r, g, b, a]`; transparent black outside the image.
   */
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return [0, 0, 0, 0];
    const o = (y * this.width + x) * 4;
    return [this.data[o], this.data[o + 1], this.data[o + 2], this.data[o + 3]];
  }

  /**
   * Fills an axis-aligned rectangle.
   * @param x - The left edge.
   * @param y - The top edge.
   * @param w - The width.
   * @param h - The height.
   * @param colour - The fill colour.
   */
  rect(x, y, w, h, colour) {
    for (let py = y; py < y + h; py += 1) for (let px = x; px < x + w; px += 1) this.set(px, py, colour);
  }

  /**
   * Fills the whole image.
   * @param colour - The fill colour.
   */
  fill(colour) {
    this.rect(0, 0, this.width, this.height, colour);
  }

  /**
   * Fills a disc.
   * @param cx - The centre's column.
   * @param cy - The centre's row.
   * @param r - The radius, in pixels.
   * @param colour - The fill colour.
   */
  disc(cx, cy, r, colour) {
    for (let py = Math.floor(cy - r); py <= cy + r; py += 1) {
      for (let px = Math.floor(cx - r); px <= cx + r; px += 1) {
        const dx = px + 0.5 - cx;
        const dy = py + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) this.set(px, py, colour);
      }
    }
  }

  /**
   * Copies a rectangle of another canvas into this one, skipping fully transparent pixels.
   * @param source - The canvas to read from.
   * @param sx - The source's left edge.
   * @param sy - The source's top edge.
   * @param w - The width to copy.
   * @param h - The height to copy.
   * @param dx - The destination's left edge.
   * @param dy - The destination's top edge.
   */
  blit(source, sx, sy, w, h, dx, dy) {
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const p = source.get(sx + x, sy + y);
        if (p[3] === 0) continue;
        this.set(dx + x, dy + y, p);
      }
    }
  }
}

/**
 * Encodes straight-alpha RGBA8 pixels as a colour-type-6 PNG.
 * @remarks
 * Every scanline is filtered with type 2 ("Up"), which turns a vertically uniform image — a
 * gradient sky, a run of identical tile rows — into a field of zero bytes that deflates to almost
 * nothing. That is what keeps every generated file well inside the 20 KB budget.
 * @param canvas - The image to encode.
 * @returns The complete PNG file.
 */
export function encodePng(canvas) {
  const { width, height, data } = canvas;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y += 1) {
    const out = y * (1 + stride);
    raw[out] = 2; // filter: Up
    for (let i = 0; i < stride; i += 1) {
      const here = data[y * stride + i];
      const above = y === 0 ? 0 : data[(y - 1) * stride + i];
      raw[out + 1 + i] = (here - above) & 0xff;
    }
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
 * Encodes mono 16-bit PCM samples as a RIFF/WAVE file.
 * @param samples - The samples, each in `[-1, 1]`.
 * @param sampleRate - The sample rate, in hertz.
 * @returns The complete WAV file.
 */
export function encodeWav(samples, sampleRate) {
  const body = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    body.writeInt16LE(Math.round(clamped * 32_767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + body.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format: PCM
  header.writeUInt16LE(1, 22); // channels
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(body.length, 40);
  return Buffer.concat([header, body]);
}

/**
 * A tiny deterministic generator, so noise (grass tufts, brick speckle) is identical on every run
 * and a regenerated PNG is byte for byte the file that is committed.
 * @param seed - The starting state.
 * @returns A function returning the next value in `[0, 1)`.
 */
export function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}
