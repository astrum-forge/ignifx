/**
 * A RIFF/WAVE header reader, so that a `.wav` clip knows its own duration under Node
 * (`docs/architecture/10-audio.md` §7: "the loader returns duration metadata only").
 *
 * Why only WAV: a WAV header states the sample rate, the channel count, and the size of the sample
 * data outright, so duration is one division and forty lines of code. MP3, OGG, WebM, and FLAC all
 * need a real container parser — variable-bit-rate frame scanning for MP3, page walking for OGG —
 * and coding standards §13 makes adding a dependency for that a decision with an ADR paragraph
 * behind it. Those four therefore load with `duration === null` in headless mode, which the
 * headless backend documents as "this instance plays until something stops it".
 *
 * In a browser none of this matters: the Web Audio backend decodes the bytes and reads the exact
 * duration off Lite's `SoundBuffer` (`index.d.ts` 11707).
 */

/** `"RIFF"` as a big-endian 32-bit integer. */
const RIFF_MAGIC = 0x52_49_46_46;

/** `"WAVE"` as a big-endian 32-bit integer. */
const WAVE_MAGIC = 0x57_41_56_45;

/** `"fmt "` as a big-endian 32-bit integer. */
const FMT_MAGIC = 0x66_6d_74_20;

/** `"data"` as a big-endian 32-bit integer. */
const DATA_MAGIC = 0x64_61_74_61;

/** Bytes in the RIFF header before the first chunk: `"RIFF"`, the size, and `"WAVE"`. */
const RIFF_HEADER_BYTES = 12;

/** Bytes in one chunk header: the four-character id and the 32-bit size. */
const CHUNK_HEADER_BYTES = 8;

/** The shortest `fmt ` chunk that carries a byte rate: through `byteRate` at offset 8. */
const MINIMUM_FMT_BYTES = 16;

/**
 * What a WAV header says about the audio it introduces.
 *
 * @public
 */
export interface WavHeader {
  /** How long the sample data plays, in seconds. */
  readonly duration: number;
  /** How many interleaved channels the data holds. */
  readonly channels: number;
  /** Samples per second per channel. */
  readonly sampleRate: number;
}

/**
 * Reads a RIFF/WAVE header.
 *
 * @remarks
 * Chunks are walked rather than assumed to be in a fixed order, because encoders routinely insert
 * `LIST`, `fact`, and `cue ` chunks between `fmt ` and `data`. Each chunk is padded to an even
 * length, which the walk honours.
 *
 * @param bytes - The whole file, or at least everything up to and including the `data` chunk header.
 * @returns The header, or `null` when the bytes are not a WAV this reader understands — a content
 * problem degrades rather than throwing (`CONSTITUTION.md` §3.9).
 *
 * @example
 * ```ts
 * const header = parseWavHeader(await ctx.fetchBytes());
 * const seconds = header?.duration ?? null;
 * ```
 *
 * @public
 */
export function parseWavHeader(bytes: ArrayBuffer): WavHeader | null {
  if (bytes.byteLength < RIFF_HEADER_BYTES + CHUNK_HEADER_BYTES) {
    return null;
  }
  const view = new DataView(bytes);
  if (view.getUint32(0, false) !== RIFF_MAGIC || view.getUint32(8, false) !== WAVE_MAGIC) {
    return null;
  }
  let channels = 0;
  let sampleRate = 0;
  let byteRate = 0;
  let offset = RIFF_HEADER_BYTES;
  while (offset + CHUNK_HEADER_BYTES <= view.byteLength) {
    const id = view.getUint32(offset, false);
    // The four-character id is big-endian by construction; every numeric field of a RIFF file,
    // chunk sizes included, is little-endian.
    const size = view.getUint32(offset + 4, true);
    const body = offset + CHUNK_HEADER_BYTES;
    if (id === FMT_MAGIC) {
      if (size < MINIMUM_FMT_BYTES || body + MINIMUM_FMT_BYTES > view.byteLength) {
        return null;
      }
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      byteRate = view.getUint32(body + 8, true);
    } else if (id === DATA_MAGIC) {
      if (byteRate === 0 || channels === 0 || sampleRate === 0) {
        return null;
      }
      // A streamed WAV can declare `0xFFFFFFFF`, or a size longer than the file; clamp to what is
      // really there so the duration describes the bytes rather than the claim.
      const available = Math.max(0, view.byteLength - body);
      return { duration: Math.min(size, available) / byteRate, channels, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  return null;
}
