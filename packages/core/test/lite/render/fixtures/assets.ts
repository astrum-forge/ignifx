import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Reads the shared sample assets in `tests/fixtures/assets/` from disk, for tests running under
 * Node. Browser tests fetch the same files over the Vitest dev server through `./asset-urls.ts`.
 */

/** Where the repository-level fixtures live, relative to this file. */
const ASSET_ROOT = new URL("../../../../../../tests/fixtures/assets/", import.meta.url);

/**
 * Reads a fixture asset into an `ArrayBuffer`, for tests running under Node.
 *
 * @param name - The file name inside `tests/fixtures/assets/`.
 * @returns The bytes.
 */
export function readAssetBytes(name: string): ArrayBuffer {
  const bytes = readFileSync(fileURLToPath(new URL(name, ASSET_ROOT)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
