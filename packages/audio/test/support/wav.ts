/**
 * A RIFF/WAVE writer, so the audio tests have a real audio file without downloading one
 * (`docs/plan/engineering-plan.md` Phase 5: "no downloads"). Half a second of an 8 kHz mono sine is
 * 8,044 bytes — small enough to build in memory on every test and real enough that a browser
 * decodes it and Lite reports the same duration the header claims.
 */

/** Bytes in the RIFF header before the first chunk. */
const RIFF_HEADER_BYTES = 12;

/** Bytes in the `fmt ` chunk, header included. */
const FMT_CHUNK_BYTES = 24;

/** Bytes in the `data` chunk header. */
const DATA_HEADER_BYTES = 8;

/** Bytes per sample: 16-bit PCM. */
const BYTES_PER_SAMPLE = 2;

/** The largest value a signed 16-bit sample can hold. */
const INT16_PEAK = 32_767;

/** WAVE format tag 1: uncompressed PCM. */
const FORMAT_PCM = 1;

/** Bits per sample. */
const BITS_PER_SAMPLE = 16;

/** Options accepted by {@link createWav}. */
export interface WavOptions {
  /** How long the file plays, in seconds. Defaults to `0.5`. */
  readonly seconds?: number;
  /** Samples per second. Defaults to `8000`. */
  readonly sampleRate?: number;
  /** How many interleaved channels. Defaults to `1`. */
  readonly channels?: number;
  /** The sine's frequency in hertz. Defaults to `440`. */
  readonly frequency?: number;
  /** The sine's peak amplitude, in `[0, 1]`. Defaults to `0.5`. */
  readonly amplitude?: number;
}

/**
 * Writes four ASCII characters as a big-endian tag.
 *
 * @param view - The view to write into.
 * @param offset - Where to write.
 * @param tag - Exactly four ASCII characters.
 */
function writeTag(view: DataView, offset: number, tag: string): void {
  for (let index = 0; index < 4; index += 1) {
    view.setUint8(offset + index, tag.codePointAt(index) ?? 0);
  }
}

/**
 * Builds a 16-bit PCM WAV holding a sine tone.
 *
 * @param options - Duration, sample rate, channel count, frequency, and amplitude.
 * @returns The whole file.
 *
 * @example
 * ```ts
 * const bytes = createWav({ seconds: 0.5 }); // 0.5 s, 8 kHz, mono
 * ```
 */
export function createWav(options?: WavOptions): ArrayBuffer {
  const seconds = options?.seconds ?? 0.5;
  const sampleRate = options?.sampleRate ?? 8000;
  const channels = options?.channels ?? 1;
  const frequency = options?.frequency ?? 440;
  const amplitude = options?.amplitude ?? 0.5;

  const frames = Math.round(seconds * sampleRate);
  const blockAlign = channels * BYTES_PER_SAMPLE;
  const byteRate = sampleRate * blockAlign;
  const dataBytes = frames * blockAlign;
  const buffer = new ArrayBuffer(RIFF_HEADER_BYTES + FMT_CHUNK_BYTES + DATA_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);

  writeTag(view, 0, "RIFF");
  view.setUint32(4, buffer.byteLength - 8, true);
  writeTag(view, 8, "WAVE");
  writeTag(view, 12, "fmt ");
  view.setUint32(16, FMT_CHUNK_BYTES - 8, true);
  view.setUint16(20, FORMAT_PCM, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, BITS_PER_SAMPLE, true);
  writeTag(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = RIFF_HEADER_BYTES + FMT_CHUNK_BYTES + DATA_HEADER_BYTES;
  for (let frame = 0; frame < frames; frame += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * frequency * frame) / sampleRate) * amplitude * INT16_PEAK);
    for (let channel = 0; channel < channels; channel += 1) {
      view.setInt16(offset, sample, true);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return buffer;
}
