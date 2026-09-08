/**
 * The one way the build reads a repository text file.
 *
 * Git on Windows checks files out with CRLF line endings when `core.autocrlf` is on, which is the
 * default on GitHub's Windows runners, and the repository has no `.gitattributes` to pin LF. Every
 * parser in this directory splits on `\n` and matches fences and headings at line starts, so a CRLF
 * checkout made `## First app` invisible and failed the build on `windows-latest`
 * (CI, 2026-09-08). Normalising here, once, keeps the parsers honest about what they saw.
 */
import { readFileSync } from "node:fs";

/**
 * Reads a UTF-8 text file with its line endings normalised to `\n`.
 *
 * @param file - Absolute path.
 * @returns The file's text, LF-terminated regardless of how it was checked out.
 */
export function readText(file: string): string {
  return readFileSync(file, "utf8").replaceAll("\r\n", "\n");
}
