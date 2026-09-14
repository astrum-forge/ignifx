/**
 * A tiny PNG **encoder** for the suites: the decoder under test needs files to read, and the
 * package ships no encoder of its own. It writes the simplest legal PNG — one `IDAT`, filter 0 on
 * every scanline — at 8 or 16 bits, greyscale or RGBA.
 */

/** The eight bytes every PNG starts with. */
const SIGNATURE: readonly number[] = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The CRC-32 table, built once per process on first use. */
let crcTable: Uint32Array | null = null;

/**
 * The CRC-32 lookup table PNG chunks are checksummed with.
 *
 * @returns The table.
 */
function table(): Uint32Array {
  if (crcTable !== null) {
    return crcTable;
  }
  const built = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    built[index] = value >>> 0;
  }
  crcTable = built;
  return built;
}

/**
 * The CRC-32 of a byte range.
 *
 * @param bytes - The bytes.
 * @returns The checksum.
 */
function crc32(bytes: Uint8Array): number {
  const lookup = table();
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (lookup[(crc ^ (bytes[index] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Builds one PNG chunk: length, type, payload, CRC.
 *
 * @param type - The four-character chunk type.
 * @param payload - The chunk's bytes.
 * @returns The chunk.
 */
function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, payload.length);
  for (let index = 0; index < 4; index += 1) {
    out[4 + index] = type.charCodeAt(index);
  }
  out.set(payload, 8);
  view.setUint32(payload.length + 8, crc32(out.subarray(4, payload.length + 8)));
  return out;
}

/** What {@link encodeTestPng} writes. */
export interface TestPngOptions {
  /** Width in pixels. */
  readonly width: number;
  /** Height in pixels. */
  readonly height: number;
  /** Bits per sample. */
  readonly bitDepth: 8 | 16;
  /** Samples per pixel: 1 greyscale, 4 RGBA. */
  readonly channels: 1 | 4;
  /** `width * height * channels` samples, row-major. */
  readonly samples: ArrayLike<number>;
  /** The PNG scanline filter to apply to every row. Defaults to `0` (none). */
  readonly filter?: 0 | 1 | 2 | 3 | 4;
  /** A palette, three bytes per entry, which makes the image indexed colour. */
  readonly palette?: Uint8Array;
  /** A `tRNS` chunk, one alpha byte per palette entry. */
  readonly transparency?: Uint8Array;
}

/**
 * Encodes a PNG the package's decoder can read.
 *
 * @param options - The size, depth, channel count, and samples.
 * @returns The file's bytes.
 */
export async function encodeTestPng(options: TestPngOptions): Promise<Uint8Array> {
  const bytesPerSample = options.bitDepth === 16 ? 2 : 1;
  const stride = options.width * options.channels * bytesPerSample;
  const raw = new Uint8Array((stride + 1) * options.height);
  const view = new DataView(raw.buffer);
  for (let row = 0; row < options.height; row += 1) {
    const rowStart = row * (stride + 1) + 1;
    for (let index = 0; index < options.width * options.channels; index += 1) {
      const value = options.samples[row * options.width * options.channels + index] ?? 0;
      if (bytesPerSample === 2) {
        view.setUint16(rowStart + index * 2, value);
      } else {
        raw[rowStart + index] = value;
      }
    }
  }
  applyFilter(raw, options.filter ?? 0, stride, options.height, options.channels * bytesPerSample);
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, options.width);
  headerView.setUint32(4, options.height);
  header[8] = options.bitDepth;
  header[9] = options.palette === undefined ? (options.channels === 1 ? 0 : 6) : 3;
  const compressed = await deflate(raw);
  const parts = [
    Uint8Array.from(SIGNATURE),
    chunk("IHDR", header),
    ...(options.palette === undefined ? [] : [chunk("PLTE", options.palette)]),
    ...(options.transparency === undefined ? [] : [chunk("tRNS", options.transparency)]),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Rewrites every scanline in place with one of PNG's five filters, so the decoder's reverse of it
 * is what a test exercises.
 *
 * @param raw - The scanlines, each preceded by its filter byte.
 * @param filter - The filter to apply.
 * @param stride - Bytes per scanline, filter byte excluded.
 * @param height - How many rows.
 * @param bpp - Bytes per pixel.
 */
function applyFilter(raw: Uint8Array, filter: 0 | 1 | 2 | 3 | 4, stride: number, height: number, bpp: number): void {
  if (filter === 0) {
    return;
  }
  // Rows are filtered bottom-up so each one still reads the *unfiltered* row above it.
  for (let row = height - 1; row >= 0; row -= 1) {
    const start = row * (stride + 1);
    raw[start] = filter;
    const previous = row === 0 ? -1 : (row - 1) * (stride + 1) + 1;
    for (let index = stride - 1; index >= 0; index -= 1) {
      const at = start + 1 + index;
      const left = index >= bpp ? (raw[at - bpp] ?? 0) : 0;
      const up = previous >= 0 ? (raw[previous + index] ?? 0) : 0;
      const upLeft = previous >= 0 && index >= bpp ? (raw[previous + index - bpp] ?? 0) : 0;
      const value = raw[at] ?? 0;
      raw[at] = (value - predict(filter, left, up, upLeft)) & 0xff;
    }
  }
}

/**
 * The prediction one of PNG's filters subtracts.
 *
 * @param filter - The filter type, 1 to 4.
 * @param left - The byte to the left.
 * @param up - The byte above.
 * @param upLeft - The byte above-left.
 * @returns The prediction.
 */
function predict(filter: 1 | 2 | 3 | 4, left: number, up: number, upLeft: number): number {
  if (filter === 1) {
    return left;
  }
  if (filter === 2) {
    return up;
  }
  if (filter === 3) {
    return (left + up) >> 1;
  }
  const p = left + up - upLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - up);
  const pc = Math.abs(p - upLeft);
  if (pa <= pb && pa <= pc) {
    return left;
  }
  return pb <= pc ? up : upLeft;
}

/**
 * Compresses bytes as a zlib stream, which is what `IDAT` holds.
 *
 * @param bytes - The filtered scanlines.
 * @returns The compressed payload.
 */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `Blob` takes a `Uint8Array`.
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * A greyscale heightmap PNG whose samples ramp from 0 to full scale, row-major.
 *
 * @param resolution - Samples per side.
 * @param bitDepth - 8 or 16 bits per sample.
 * @returns The file's bytes.
 */
export function rampHeightmapPng(resolution: number, bitDepth: 8 | 16): Promise<Uint8Array> {
  const count = resolution * resolution;
  const maximum = bitDepth === 16 ? 65_535 : 255;
  const samples = Array.from<number>({ length: count });
  for (let index = 0; index < count; index += 1) {
    samples[index] = Math.round((index / Math.max(1, count - 1)) * maximum);
  }
  return encodeTestPng({ width: resolution, height: resolution, bitDepth, channels: 1, samples });
}

/**
 * An RGBA control map that paints one channel everywhere.
 *
 * @param size - Texels per side.
 * @param channel - Which channel carries the weight.
 * @returns The file's bytes.
 */
export function solidControlPng(size: number, channel: 0 | 1 | 2 | 3): Promise<Uint8Array> {
  const samples = new Uint8Array(size * size * 4);
  for (let texel = 0; texel < size * size; texel += 1) {
    samples[texel * 4 + channel] = 255;
  }
  return encodeTestPng({ width: size, height: size, bitDepth: 8, channels: 4, samples });
}

/**
 * A solid RGBA layer texture.
 *
 * @param size - Texels per side.
 * @param color - The RGBA texel every pixel carries.
 * @returns The file's bytes.
 */
export function solidLayerPng(size: number, color: readonly [number, number, number, number]): Promise<Uint8Array> {
  const samples = new Uint8Array(size * size * 4);
  for (let texel = 0; texel < size * size; texel += 1) {
    samples[texel * 4] = color[0];
    samples[texel * 4 + 1] = color[1];
    samples[texel * 4 + 2] = color[2];
    samples[texel * 4 + 3] = color[3];
  }
  return encodeTestPng({ width: size, height: size, bitDepth: 8, channels: 4, samples });
}
