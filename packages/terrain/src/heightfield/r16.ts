import { TerrainErrorCode, terrainError } from "../errors.js";

/**
 * The `.r16` codec (`docs/plan/2026-09-terrain-particles-shaders.md` §5.1): little-endian `uint16`,
 * row-major, `resolution * resolution` samples, `0..65535` mapped onto `0..size.height`. It is the
 * canonical heightmap because it is exact in every host — a `DataView` reads it in Node and in the
 * browser alike, whereas no browser image API decodes a 16-bit PNG losslessly (spike S0.3).
 */

/**
 * Decodes a `.r16` buffer into samples.
 *
 * @param buffer - The file's bytes.
 * @param resolution - The samples per side the terrain declares, checked against the byte count.
 * @param file - The file's address, for the message.
 * @returns `resolution * resolution` samples, row-major.
 * @throws IgnifxError with code `IGX-1608` when the byte count does not match.
 *
 * @example
 * ```ts
 * const samples = decodeR16(await ctx.fetchBytes(), 513, "terrain/island.r16");
 * ```
 *
 * @public
 */
export function decodeR16(buffer: ArrayBuffer, resolution: number, file = "<memory>"): Uint16Array {
  const expected = resolution * resolution;
  if (buffer.byteLength !== expected * 2) {
    throw terrainError(
      TerrainErrorCode.heightmapSizeMismatch,
      `${file} holds ${String(buffer.byteLength / 2)} samples, not the ${String(expected)} its resolution ${String(resolution)} declares.`,
      {
        context: { file, actual: buffer.byteLength / 2, expected },
        hint: "A .r16 is resolution * resolution little-endian uint16 samples with no header.",
      },
    );
  }
  const view = new DataView(buffer);
  const out = new Uint16Array(expected);
  for (let index = 0; index < expected; index += 1) {
    out[index] = view.getUint16(index * 2, true);
  }
  return out;
}

/**
 * Encodes samples as a `.r16` buffer.
 *
 * @param samples - The samples, row-major.
 * @returns The bytes, little-endian.
 *
 * @public
 */
export function encodeR16(samples: Uint16Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < samples.length; index += 1) {
    view.setUint16(index * 2, samples[index] ?? 0, true);
  }
  return buffer;
}
