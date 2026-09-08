/**
 * The Windows ICO container.
 *
 * `favicon.ico` is still the file a browser asks for when a page names no icon, and the only
 * portable way to ship 16, 32 and 48 px in one resource. The format is small enough to write by
 * hand, which is what happens here — no dependency, and the bytes are fully determined by the PNGs
 * that go in, so the file rebuilds identically.
 *
 * Layout (Microsoft's ICO/CUR specification):
 *
 * - `ICONDIR`, 6 bytes: reserved `0`, type `1` (icon), image count.
 * - `ICONDIRENTRY` × count, 16 bytes each: width, height (one byte each, `0` meaning 256),
 *   palette size `0`, reserved `0`, colour planes `1`, bits per pixel `32`, byte length, and the
 *   offset of the image data.
 * - The image blobs, in entry order. Since Windows Vista an entry may hold a whole PNG rather than
 *   a BMP, which is what every modern icon does and what this writer emits.
 */

/** One image inside the container. */
export interface IcoEntry {
  /** Side of the square image, 1–256 pixels. */
  readonly size: number;
  /** The PNG's bytes. */
  readonly png: Uint8Array;
}

/** Bytes in the `ICONDIR` header. */
const HEADER_BYTES = 6;

/** Bytes in one `ICONDIRENTRY`. */
const ENTRY_BYTES = 16;

/**
 * Builds an ICO file from square PNGs.
 *
 * @param entries - The images, in the order they should appear.
 * @returns The `.ico` bytes.
 * @throws When there are no entries, or one is outside the 1–256 pixel range the format allows.
 */
export function buildIco(entries: readonly IcoEntry[]): Uint8Array {
  if (entries.length === 0) {
    throw new Error("an ICO needs at least one image");
  }
  for (const entry of entries) {
    if (!Number.isInteger(entry.size) || entry.size < 1 || entry.size > 256) {
      throw new Error(`${String(entry.size)} px is not a size an ICO entry can declare (1–256)`);
    }
  }

  const directoryBytes = HEADER_BYTES + ENTRY_BYTES * entries.length;
  const total = entries.reduce((sum, entry) => sum + entry.png.byteLength, directoryBytes);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);

  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, entries.length, true);

  let offset = directoryBytes;
  for (const [index, entry] of entries.entries()) {
    const at = HEADER_BYTES + index * ENTRY_BYTES;
    // 256 is written as 0; the format has one byte per dimension.
    const dimension = entry.size === 256 ? 0 : entry.size;
    view.setUint8(at, dimension);
    view.setUint8(at + 1, dimension);
    view.setUint8(at + 2, 0);
    view.setUint8(at + 3, 0);
    view.setUint16(at + 4, 1, true);
    view.setUint16(at + 6, 32, true);
    view.setUint32(at + 8, entry.png.byteLength, true);
    view.setUint32(at + 12, offset, true);
    bytes.set(entry.png, offset);
    offset += entry.png.byteLength;
  }
  return bytes;
}
