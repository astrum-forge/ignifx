/**
 * Workspace lookups: where the repository root is, which packages exist, and what version the
 * release line currently carries (`@ignifx/core` is the version anchor — every package ships on one
 * fixed version line, `CONSTITUTION.md` §4.1).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exists, listDirectories, readText } from "./fs-tree.ts";

/** One workspace package under `packages/`. */
export interface WorkspacePackage {
  /** Directory name under `packages/`, for example `core`. */
  readonly directory: string;
  /** Absolute path to the package directory. */
  readonly absolutePath: string;
  /** The `name` field of its `package.json`, for example `@ignifx/core`. */
  readonly name: string;
  /** The `version` field of its `package.json`. */
  readonly version: string;
}

/**
 * Resolves the repository root from an entry script's `import.meta.url`.
 *
 * @param moduleUrl - The calling module's `import.meta.url`; it must live directly in `scripts/`.
 * @returns Absolute path to the repository root.
 */
export function repositoryRoot(moduleUrl: string): string {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "..");
}

/**
 * Narrows an unknown value to a plain object. A type predicate rather than an `as` assertion, so
 * the narrowing is checked by the compiler at the one place it happens (coding standards §5.2).
 *
 * @param value - The value to test.
 * @returns True when the value is a non-null, non-array object.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses a JSON file that is expected to contain an object.
 *
 * @param file - Absolute path to the JSON file.
 * @returns The parsed object.
 * @throws When the file does not contain a JSON object.
 */
export function readJsonObject(file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readText(file));
  if (!isRecord(parsed)) {
    throw new Error(`${file} does not contain a JSON object`);
  }
  return parsed;
}

/**
 * Reads a string property from a parsed JSON object.
 *
 * @param object - The parsed object.
 * @param key - Property name.
 * @returns The string value, or `null` when absent or not a string.
 */
export function readStringField(object: Record<string, unknown>, key: string): string | null {
  const value = object[key];
  return typeof value === "string" ? value : null;
}

/**
 * Lists every package under `packages/` that has a `package.json`.
 *
 * @param root - Absolute path to the repository root.
 * @returns The packages, sorted by directory name.
 */
export function listWorkspacePackages(root: string): readonly WorkspacePackage[] {
  const packagesDirectory = path.join(root, "packages");
  const found: WorkspacePackage[] = [];
  for (const directory of listDirectories(packagesDirectory)) {
    const absolutePath = path.join(packagesDirectory, directory);
    const manifest = path.join(absolutePath, "package.json");
    if (!exists(manifest)) {
      continue;
    }
    const json = readJsonObject(manifest);
    found.push({
      directory,
      absolutePath,
      name: readStringField(json, "name") ?? `@ignifx/${directory}`,
      version: readStringField(json, "version") ?? "0.0.0",
    });
  }
  return found;
}

/**
 * Reads the version of `@ignifx/core`, the anchor of the fixed version line.
 *
 * @param root - Absolute path to the repository root.
 * @returns The version string, or `"0.0.0"` when the package is not present yet.
 */
export function releaseVersion(root: string): string {
  const manifest = path.join(root, "packages", "core", "package.json");
  if (!exists(manifest)) {
    return "0.0.0";
  }
  return readStringField(readJsonObject(manifest), "version") ?? "0.0.0";
}
