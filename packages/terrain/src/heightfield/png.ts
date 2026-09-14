import { TerrainErrorCode, terrainError } from "../errors.js";

/**
 * A minimal PNG decoder for heightmaps and control maps
 * (`docs/plan/2026-09-terrain-particles-shaders.md` §5.1).
 *
 * No browser image API decodes a 16-bit PNG losslessly and Node has no image API at all, so the
 * loader reads PNG itself. It accepts non-interlaced greyscale, greyscale+alpha, RGB and RGBA at 8
 * or 16 bits and 8-bit indexed colour; anything else is `IGX-1606`.
 */

/**
 * A decoded PNG: samples in scanline order, one row after another, `channels` per pixel.
 *
 * @public
 */
export interface DecodedPng {
  /** Width in pixels. */
  readonly width: number;
  /** Height in pixels. */
  readonly height: number;
  /** Bits per sample. Indexed images decode to 8. */
  readonly bitDepth: 8 | 16;
  /** Samples per pixel: 1 grey, 2 grey+alpha, 3 RGB, 4 RGBA. */
  readonly channels: 1 | 2 | 3 | 4;
  /** `width * height * channels` samples; a `Uint16Array` for 16-bit images. */
  readonly data: Uint8Array | Uint16Array;
}

/** The eight bytes every PNG starts with. */
const SIGNATURE: readonly number[] = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Bytes per pixel of each colour type at 8 bits, keyed by colour type. */
const CHANNELS_BY_COLOR_TYPE: Readonly<Record<number, 1 | 2 | 3 | 4>> = Object.freeze({
  0: 1,
  2: 3,
  3: 1,
  4: 2,
  6: 4,
});

/** The colour type of an indexed image. */
const COLOR_TYPE_INDEXED = 3;

/** How a 16-bit sample is scaled to 8 bits, and an 8-bit one to 16: `255 * 257 = 65535`. */
const SCALE_8_TO_16 = 257;

/**
 * Whether a byte buffer starts with the PNG signature.
 *
 * @param bytes - The file's bytes.
 * @returns `true` for a PNG.
 *
 * @public
 */
export function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < SIGNATURE.length) {
    return false;
  }
  for (let index = 0; index < SIGNATURE.length; index += 1) {
    if (bytes[index] !== SIGNATURE[index]) {
      return false;
    }
  }
  return true;
}

/**
 * Decodes a PNG.
 *
 * @param bytes - The file's bytes.
 * @param file - The file's address, for messages.
 * @returns The decoded image.
 * @throws IgnifxError with code `IGX-1606` when the bytes are not a PNG this decoder reads.
 *
 * @example
 * ```ts
 * const png = await decodePng(new Uint8Array(await ctx.fetchBytes()), ctx.address);
 * png.bitDepth; // 16 for a heightmap that will not terrace
 * ```
 *
 * @public
 */
export async function decodePng(bytes: Uint8Array, file = "<memory>"): Promise<DecodedPng> {
  // The explicit type annotation is what lets TypeScript narrow after a call (coding standards §5.2).
  const refuse: (reason: string) => never = (reason: string): never => {
    throw terrainError(
      TerrainErrorCode.unsupportedImage,
      `${file} is not an image the built-in decoder reads: ${reason}.`,
      {
        context: { file, reason },
        hint: "Use a non-interlaced 8- or 16-bit PNG, or convert it with `ignifx import heightmap`.",
      },
    );
  };
  if (!isPng(bytes)) {
    refuse("it does not start with the PNG signature");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  let idatLength = 0;
  let sawHeader = false;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    );
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) {
      refuse(`the ${type} chunk runs past the end of the file`);
    }
    if (type === "IHDR") {
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      bitDepth = bytes[start + 8] ?? 0;
      colorType = bytes[start + 9] ?? 0;
      if ((bytes[start + 12] ?? 0) !== 0) {
        refuse("it is Adam7 interlaced");
      }
      sawHeader = true;
    } else if (type === "PLTE") {
      palette = bytes.subarray(start, end);
    } else if (type === "tRNS") {
      transparency = bytes.subarray(start, end);
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(start, end));
      idatLength += length;
    } else if (type === "IEND") {
      break;
    }
    offset = end + 4;
  }
  if (!sawHeader || width === 0 || height === 0) {
    refuse("it has no IHDR chunk");
  }
  const channels = CHANNELS_BY_COLOR_TYPE[colorType];
  if (channels === undefined) {
    refuse(`colour type ${String(colorType)} is unknown`);
  }
  const indexed = colorType === COLOR_TYPE_INDEXED;
  if (bitDepth !== 8 && bitDepth !== 16) {
    refuse(`bit depth ${String(bitDepth)} is not 8 or 16`);
  }
  if (indexed && bitDepth !== 8) {
    refuse("an indexed image must be 8-bit");
  }
  if (indexed && palette === null) {
    refuse("it is indexed but has no PLTE chunk");
  }
  const compressed = new Uint8Array(idatLength);
  let cursor = 0;
  for (let index = 0; index < idat.length; index += 1) {
    const chunk = idat[index];
    if (chunk !== undefined) {
      compressed.set(chunk, cursor);
      cursor += chunk.length;
    }
  }
  const raw = await inflate(compressed);
  const bytesPerSample = bitDepth === 16 ? 2 : 1;
  const bpp = channels * bytesPerSample;
  const stride = width * bpp;
  if (raw.length < height * (stride + 1)) {
    refuse(
      `its image data is ${String(raw.length)} bytes, shorter than the ${String(height * (stride + 1))} its size needs`,
    );
  }
  const pixels = unfilter(raw, width, height, bpp);
  if (indexed && palette !== null) {
    return expandPalette(pixels, width, height, palette, transparency);
  }
  if (bitDepth === 16) {
    const samples = new Uint16Array(width * height * channels);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = ((pixels[index * 2] ?? 0) << 8) | (pixels[index * 2 + 1] ?? 0);
    }
    return { width, height, bitDepth: 16, channels, data: samples };
  }
  return { width, height, bitDepth: 8, channels, data: pixels };
}

/**
 * Converts a decoded PNG into 16-bit height samples: greyscale as is, colour by luminance, 8-bit
 * scaled by 257 so full white stays full height.
 *
 * @param png - The decoded image.
 * @returns `width * height` samples, row-major.
 *
 * @public
 */
export function pngToSamples16(png: DecodedPng): Uint16Array {
  const count = png.width * png.height;
  const out = new Uint16Array(count);
  const scale = png.bitDepth === 16 ? 1 : SCALE_8_TO_16;
  const data = png.data;
  const channels = png.channels;
  for (let index = 0; index < count; index += 1) {
    const base = index * channels;
    let value: number;
    if (channels >= 3) {
      const r = data[base] ?? 0;
      const g = data[base + 1] ?? 0;
      const b = data[base + 2] ?? 0;
      value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    } else {
      value = data[base] ?? 0;
    }
    out[index] = Math.round(value * scale);
  }
  return out;
}

/**
 * Converts a decoded PNG into tightly packed RGBA8, the layout `TextureAsset.fromPixels` takes.
 *
 * @param png - The decoded image.
 * @returns `width * height * 4` bytes, row-major, top row first, straight alpha.
 *
 * @public
 */
export function pngToRgba8(png: DecodedPng): Uint8Array {
  const count = png.width * png.height;
  const out = new Uint8Array(count * 4);
  const shift = png.bitDepth === 16 ? 8 : 0;
  const data = png.data;
  const channels = png.channels;
  for (let index = 0; index < count; index += 1) {
    const base = index * channels;
    const to = index * 4;
    const first = (data[base] ?? 0) >> shift;
    if (channels === 1) {
      out[to] = first;
      out[to + 1] = first;
      out[to + 2] = first;
      out[to + 3] = 255;
    } else if (channels === 2) {
      out[to] = first;
      out[to + 1] = first;
      out[to + 2] = first;
      out[to + 3] = (data[base + 1] ?? 0) >> shift;
    } else {
      out[to] = first;
      out[to + 1] = (data[base + 1] ?? 0) >> shift;
      out[to + 2] = (data[base + 2] ?? 0) >> shift;
      out[to + 3] = channels === 4 ? (data[base + 3] ?? 0) >> shift : 255;
    }
  }
  return out;
}

/**
 * Inflates a zlib stream through the platform's `DecompressionStream`.
 *
 * @param compressed - The concatenated `IDAT` payload.
 * @returns The raw, filtered scanlines.
 */
async function inflate(compressed: Uint8Array): Promise<Uint8Array> {
  // `Blob` accepts a `Uint8Array` at runtime; the DOM typing wants `BlobPart`, which the array's
  // buffer-typed generic does not name in every TypeScript version (coding standards §5.2).
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Undoes the per-scanline filters, producing unfiltered pixel bytes.
 *
 * @param raw - The inflated data: each row is one filter byte then `width * bpp` bytes.
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param bpp - Bytes per pixel.
 * @returns `height * width * bpp` bytes.
 */
function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)] ?? 0;
    const from = row * (stride + 1) + 1;
    const to = row * stride;
    const previous = row === 0 ? -1 : (row - 1) * stride;
    for (let index = 0; index < stride; index += 1) {
      const x = raw[from + index] ?? 0;
      const left = index >= bpp ? (out[to + index - bpp] ?? 0) : 0;
      const up = previous >= 0 ? (out[previous + index] ?? 0) : 0;
      const upLeft = previous >= 0 && index >= bpp ? (out[previous + index - bpp] ?? 0) : 0;
      let value: number;
      switch (filter) {
        case 1:
          value = x + left;
          break;
        case 2:
          value = x + up;
          break;
        case 3:
          value = x + ((left + up) >> 1);
          break;
        case 4:
          value = x + paeth(left, up, upLeft);
          break;
        default:
          value = x;
      }
      out[to + index] = value & 0xff;
    }
  }
  return out;
}

/**
 * The Paeth predictor of PNG filter type 4.
 *
 * @param a - The byte to the left.
 * @param b - The byte above.
 * @param c - The byte above-left.
 * @returns The prediction.
 */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  return pb <= pc ? b : c;
}

/**
 * Expands 8-bit palette indices to RGB or RGBA.
 *
 * @param indices - One index per pixel.
 * @param width - Width in pixels.
 * @param height - Height in pixels.
 * @param palette - The `PLTE` chunk: three bytes per entry.
 * @param transparency - The `tRNS` chunk, or `null` for an opaque image.
 * @returns The expanded image.
 */
function expandPalette(
  indices: Uint8Array,
  width: number,
  height: number,
  palette: Uint8Array,
  transparency: Uint8Array | null,
): DecodedPng {
  const count = width * height;
  const channels = transparency === null ? 3 : 4;
  const out = new Uint8Array(count * channels);
  for (let index = 0; index < count; index += 1) {
    const entry = indices[index] ?? 0;
    const to = index * channels;
    out[to] = palette[entry * 3] ?? 0;
    out[to + 1] = palette[entry * 3 + 1] ?? 0;
    out[to + 2] = palette[entry * 3 + 2] ?? 0;
    if (transparency !== null) {
      out[to + 3] = entry < transparency.length ? (transparency[entry] ?? 255) : 255;
    }
  }
  return { width, height, bitDepth: 8, channels, data: out };
}
