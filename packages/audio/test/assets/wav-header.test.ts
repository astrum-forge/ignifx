import { describe, expect, it } from "vitest";
import { parseWavHeader } from "../../src/assets/wav-header.js";
import { createWav } from "../support/wav.js";

describe("parseWavHeader", () => {
  it("reads the duration, channel count, and sample rate a RIFF header declares", () => {
    const header = parseWavHeader(createWav({ seconds: 0.5, sampleRate: 8000, channels: 1 }));

    expect(header).not.toBeNull();
    expect(header?.duration).toBeCloseTo(0.5, 6);
    expect(header?.channels).toBe(1);
    expect(header?.sampleRate).toBe(8000);
  });

  it("halves the duration of a stereo file at the same sample count per channel", () => {
    const mono = parseWavHeader(createWav({ seconds: 1, sampleRate: 8000, channels: 1 }));
    const stereo = parseWavHeader(createWav({ seconds: 1, sampleRate: 8000, channels: 2 }));

    expect(stereo?.duration).toBeCloseTo(mono?.duration ?? 0, 6);
    expect(stereo?.channels).toBe(2);
  });

  it("walks past chunks it does not know rather than giving up on them", () => {
    const wav = createWav({ seconds: 0.25 });
    const padded = new ArrayBuffer(wav.byteLength + 10);
    const source = new Uint8Array(wav);
    const target = new Uint8Array(padded);
    const view = new DataView(padded);
    // RIFF header, then a two-byte `LIST` chunk, then the rest of the original file.
    target.set(source.subarray(0, 12), 0);
    view.setUint32(12, 0x4c_49_53_54, false);
    view.setUint32(16, 2, true);
    target.set(source.subarray(12), 22);

    expect(parseWavHeader(padded)?.duration).toBeCloseTo(0.25, 6);
  });

  it("answers null for bytes that are not a RIFF/WAVE file", () => {
    expect(parseWavHeader(new TextEncoder().encode("this is not audio at all").buffer)).toBeNull();
  });

  it("answers null for a file too short to hold a header", () => {
    expect(parseWavHeader(new ArrayBuffer(8))).toBeNull();
  });

  it("answers null when the data chunk arrives before any fmt chunk", () => {
    const buffer = new ArrayBuffer(20);
    const view = new DataView(buffer);
    view.setUint32(0, 0x52_49_46_46, false);
    view.setUint32(4, 12, true);
    view.setUint32(8, 0x57_41_56_45, false);
    view.setUint32(12, 0x64_61_74_61, false);
    view.setUint32(16, 0, true);

    expect(parseWavHeader(buffer)).toBeNull();
  });

  it("answers null for a truncated fmt chunk", () => {
    const buffer = new ArrayBuffer(24);
    const view = new DataView(buffer);
    view.setUint32(0, 0x52_49_46_46, false);
    view.setUint32(4, 16, true);
    view.setUint32(8, 0x57_41_56_45, false);
    view.setUint32(12, 0x66_6d_74_20, false);
    view.setUint32(16, 4, true);

    expect(parseWavHeader(buffer)).toBeNull();
  });

  it("clamps a data size that claims more bytes than the file holds", () => {
    const wav = createWav({ seconds: 0.5, sampleRate: 8000 });
    const view = new DataView(wav);
    view.setUint32(40, 0xff_ff_ff_ff, true);

    expect(parseWavHeader(wav)?.duration).toBeCloseTo(0.5, 6);
  });
});
