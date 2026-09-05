/**
 * Filesystem helpers for the docs scripts. Deliberately synchronous: these scripts are short-lived
 * batch tools, and synchronous walking keeps the error messages attached to the file that caused
 * them without a promise chain in between.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "coverage",
  ".git",
  ".turbo",
  ".tsbuild",
  ".tsbuild-test",
]);

/**
 * Reports whether a path exists.
 *
 * @param target - Absolute path to test.
 * @returns True when the path exists.
 */
export function exists(target: string): boolean {
  try {
    statSync(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads a UTF-8 text file.
 *
 * @param file - Absolute path to the file.
 * @returns The file contents.
 */
export function readText(file: string): string {
  return readFileSync(file, "utf8");
}

/**
 * Lists the immediate subdirectory names of a directory.
 *
 * @param directory - Absolute path to the directory.
 * @returns Sorted directory names; empty when the directory does not exist.
 */
export function listDirectories(directory: string): readonly string[] {
  if (!exists(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted((left, right) => left.localeCompare(right));
}

/**
 * Walks a directory tree and returns every file with the given extension.
 *
 * @param directory - Absolute path to the root of the walk.
 * @param extension - Extension to match, including the dot (for example `.md`).
 * @returns Sorted absolute file paths; empty when the directory does not exist.
 */
export function listFilesRecursive(directory: string, extension: string): readonly string[] {
  if (!exists(directory)) {
    return [];
  }
  const found: string[] = [];
  const pending: string[] = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          pending.push(full);
        }
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(extension)) {
        found.push(full);
      }
    }
  }
  return found.toSorted((left, right) => left.localeCompare(right));
}

/**
 * Writes a generated file, creating its directory if needed.
 *
 * @param file - Absolute path to write.
 * @param contents - File contents.
 */
export function writeGeneratedFile(file: string, contents: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, "utf8");
}
