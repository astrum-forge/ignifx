/**
 * The downloadable archive.
 *
 * `ignifx-press-kit.zip` is committed, so it has to be reproducible: the same inputs must give the
 * same bytes, or every run of the generator shows up as a binary diff and a later CI check on
 * `pnpm --filter @ignifx/website press-kit` could never pass.
 *
 * Two things make a zip non-reproducible, and both are pinned here: the order entries are written
 * in, and their timestamps.
 */
import { zipSync } from "fflate";

/**
 * The timestamp every entry carries.
 *
 * fflate writes the DOS date field from a `Date`'s **local** components (`getFullYear`,
 * `getHours`, …), so a millisecond value or a `Z`-suffixed string would encode differently in
 * different time zones. A date-time string with no offset is parsed as local time, so 1980-01-01
 * 00:00 — the zero of the DOS date format — comes out the same on every machine.
 */
const FIXED_MTIME = "1980-01-01T00:00:00";

/** One file in the archive. */
export interface ArchiveEntry {
  /** Path inside the archive, forward slashes, no leading slash. */
  readonly path: string;
  /** The file's bytes. */
  readonly bytes: Uint8Array;
}

/**
 * Builds the archive.
 *
 * @param entries - The files to include. Sorted by path here, so the caller does not have to.
 * @returns The zip's bytes.
 * @throws When two entries claim the same path.
 */
export function buildArchive(entries: readonly ArchiveEntry[]): Uint8Array {
  const sorted = entries.toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const files: Record<string, Uint8Array> = {};
  for (const entry of sorted) {
    if (entry.path in files) {
      throw new Error(`two archive entries claim ${entry.path}`);
    }
    files[entry.path] = entry.bytes;
  }
  // `level` and `mem` are pinned because fflate's defaults could change between versions, and the
  // deflate stream is part of the committed bytes.
  return zipSync(files, { level: 9, mem: 12, mtime: FIXED_MTIME });
}
