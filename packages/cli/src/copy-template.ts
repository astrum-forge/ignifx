import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { CliError, CliErrorCode } from "./errors.js";
import type { Stats } from "node:fs";

/**
 * File names that `copyTemplate` rewrites by default.
 *
 * @remarks
 * npm refuses to publish a `.gitignore` inside a package and rewrites a nested `package.json`
 * during packing, so template files that must arrive under those names are stored with an
 * underscore prefix and restored on copy. This is the convention used by every scaffolder that
 * ships its templates inside an npm package.
 *
 * @public
 */
export const DEFAULT_TEMPLATE_RENAMES: Readonly<Record<string, string>> = {
  _gitignore: ".gitignore",
  "_package.json": "package.json",
};

/**
 * Directory and file names `copyTemplate` skips by default: build and tooling output that a
 * template checkout may contain locally but that must never reach a generated project.
 *
 * @public
 */
export const DEFAULT_IGNORED_ENTRIES: readonly string[] = ["node_modules", "dist", ".turbo"];

/**
 * Options for {@link copyTemplate}.
 *
 * @public
 */
export interface CopyTemplateOptions {
  /** Absolute or relative path of the template directory to read from. */
  readonly templateDir: string;
  /** Absolute or relative path of the directory to write into; created if it does not exist. */
  readonly targetDir: string;
  /**
   * Whether to write into a target directory that already contains entries.
   *
   * @defaultValue `false` — an existing, non-empty target throws `IGX-1401` instead.
   */
  readonly overwrite?: boolean;
  /**
   * Map of source file name to the name it is written under, applied to every entry at every
   * depth.
   *
   * @defaultValue {@link DEFAULT_TEMPLATE_RENAMES}
   */
  readonly rename?: Readonly<Record<string, string>>;
  /**
   * Entry names that are skipped, together with everything below them.
   *
   * @defaultValue {@link DEFAULT_IGNORED_ENTRIES}
   */
  readonly ignore?: readonly string[];
  /**
   * Signal that cancels the copy (coding standards §8). An already-aborted signal rejects with
   * the signal's reason before anything is written.
   *
   * @defaultValue no signal — the copy runs to completion.
   */
  readonly signal?: AbortSignal;
}

/**
 * What {@link copyTemplate} wrote.
 *
 * @public
 */
export interface CopyTemplateResult {
  /**
   * Paths of the files written, relative to `targetDir`, `/`-separated on every platform and
   * sorted lexicographically. Directories are not listed.
   */
  readonly files: readonly string[];
}

/**
 * Reads the `code` property of an unknown thrown value without asserting its type.
 *
 * @param error - The value caught from a rejected `node:fs` call.
 * @returns The `errno` code (for example `"ENOENT"`), or `null` when the value carries none.
 */
function errorCodeOf(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const { code } = error;
    return typeof code === "string" ? code : null;
  }
  return null;
}

/**
 * Reports whether a path exists and already holds at least one entry.
 *
 * @param directory - The directory to inspect.
 * @returns `true` when the directory exists and is not empty, `false` when it is empty or absent.
 */
async function isNonEmptyDirectory(directory: string): Promise<boolean> {
  try {
    const entries = await readdir(directory);
    return entries.length > 0;
  } catch (error) {
    if (errorCodeOf(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * The resolved settings shared by every level of the recursive walk.
 */
interface CopyContext {
  readonly renames: ReadonlyMap<string, string>;
  readonly ignored: ReadonlySet<string>;
  readonly signal: AbortSignal | null;
}

/**
 * Copies one directory level and recurses into its subdirectories.
 *
 * @param sourceDir - Directory being read.
 * @param destinationDir - Directory being written.
 * @param prefix - `/`-separated path of `destinationDir` relative to the copy root, `""` at the root.
 * @param context - Resolved renames, ignore set, and cancellation signal.
 * @param files - Accumulator that collects the relative path of every file written.
 * @returns A promise that settles when this level and everything below it has been copied.
 */
async function copyDirectory(
  sourceDir: string,
  destinationDir: string,
  prefix: string,
  context: CopyContext,
  files: string[],
): Promise<void> {
  context.signal?.throwIfAborted();
  await mkdir(destinationDir, { recursive: true });

  const entries = await readdir(sourceDir, { withFileTypes: true });
  // Entries of one level are independent, so they are copied concurrently; `files` is sorted once
  // at the end, which is what makes the result deterministic rather than the traversal order.
  await Promise.all(
    entries.map(async (entry) => {
      context.signal?.throwIfAborted();
      if (context.ignored.has(entry.name)) {
        return;
      }
      const targetName = context.renames.get(entry.name) ?? entry.name;
      const relativePath = prefix === "" ? targetName : `${prefix}/${targetName}`;
      const source = join(sourceDir, entry.name);
      const destination = join(destinationDir, targetName);

      if (entry.isDirectory()) {
        await copyDirectory(source, destination, relativePath, context, files);
      } else {
        await copyFile(source, destination);
        files.push(relativePath);
      }
    }),
  );
}

/**
 * Copies a template directory recursively into a target directory.
 *
 * @remarks
 * The template tree is copied verbatim apart from the `rename` map and the `ignore` list. Symbolic
 * links are followed and written as regular files, which is what a scaffolded project wants.
 *
 * @param options - Source, destination, and the documented defaults in {@link CopyTemplateOptions}.
 * @returns The relative paths of the files written, sorted.
 * @throws A {@link CliError} with code `IGX-1402` when `templateDir` is not an existing directory,
 * or `IGX-1401` when `targetDir` already holds entries and `overwrite` was not requested.
 *
 * @example
 * ```ts
 * const result = await copyTemplate({
 *   templateDir: "/path/to/templates/2d-topdown",
 *   targetDir: "./my-game",
 * });
 * console.log(`${String(result.files.length)} files written`);
 * ```
 *
 * @public
 */
export async function copyTemplate(options: CopyTemplateOptions): Promise<CopyTemplateResult> {
  const { templateDir, targetDir } = options;
  const signal = options.signal ?? null;
  signal?.throwIfAborted();

  let templateStats: Stats;
  try {
    templateStats = await stat(templateDir);
  } catch (error) {
    throw new CliError(
      CliErrorCode.templateNotFound,
      `Template directory "${templateDir}" could not be read. Check the template name and try again.`,
      { cause: error },
    );
  }
  if (!templateStats.isDirectory()) {
    throw new CliError(CliErrorCode.templateNotFound, `Template path "${templateDir}" is not a directory.`);
  }

  if (options.overwrite !== true && (await isNonEmptyDirectory(targetDir))) {
    throw new CliError(
      CliErrorCode.targetNotEmpty,
      `Target directory "${targetDir}" is not empty. Choose an empty directory or pass --overwrite.`,
    );
  }

  const context: CopyContext = {
    renames: new Map(Object.entries(options.rename ?? DEFAULT_TEMPLATE_RENAMES)),
    ignored: new Set(options.ignore ?? DEFAULT_IGNORED_ENTRIES),
    signal,
  };
  const files: string[] = [];
  await copyDirectory(templateDir, targetDir, "", context, files);
  files.sort();
  return { files };
}
