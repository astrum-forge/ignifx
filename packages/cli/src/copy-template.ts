import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { CliError, CliErrorCode } from "./errors.js";
import { VERSION } from "./version.js";
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
 * Entries that belong to a template's **desktop** variant and are skipped unless the scaffold asked
 * for one (`docs/architecture/14-platform-electron.md` §3).
 *
 * @remarks
 * A browser-only project should not carry them, and not only for tidiness: `electron` and
 * `electron-builder` are large binary downloads that a browser game never runs, and an
 * `electron.vite.config.ts` in a project with no `desktop/` directory is a config that names files
 * that are not there.
 *
 * @public
 */
export const DESKTOP_ONLY_ENTRIES: readonly string[] = Object.freeze([
  "desktop",
  "electron.vite.config.ts",
  "electron-builder.yml",
]);

/**
 * The `devDependencies` a template declares only for its desktop variant, removed from a
 * browser-only scaffold.
 *
 * @remarks
 * `@ignifx/electron` is deliberately **not** on this list. A template's `src/main.ts` registers
 * `electron()` unconditionally — the extension is inert without a preload bridge, which is what
 * gives one renderer bundle both builds — so removing the package would break the browser scaffold
 * it was meant to slim down. What is removed is the three build tools, which are large binary
 * downloads a browser game never runs.
 *
 * @public
 */
export const DESKTOP_ONLY_DEPENDENCIES: readonly string[] = Object.freeze([
  "electron",
  "electron-builder",
  "electron-vite",
]);

/**
 * The suffix marking a `package.json` script that belongs to the desktop variant.
 *
 * @public
 */
export const DESKTOP_SCRIPT_SUFFIX = ":desktop";

/**
 * The version a scaffolded project's `@ignifx/*` dependencies are pinned to.
 *
 * @remarks
 * A template inside this repository declares `"@ignifx/core": "workspace:*"`, which is pnpm's
 * workspace protocol: it means "whatever the checkout has" and is meaningless outside a workspace.
 * A generated project has to name a published range instead, and because the whole `@ignifx` scope
 * ships one version line (`docs/architecture/00-overview.md` §2) that range is this package's own
 * version.
 *
 * @public
 */
export const DEFAULT_DEPENDENCY_RANGE: string = `^${VERSION}`;

/** The dependency blocks {@link copyTemplate} rewrites. */
const DEPENDENCY_BLOCKS: readonly string[] = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

/** The workspace protocol prefix pnpm uses. */
const WORKSPACE_PROTOCOL = "workspace:";

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
   * The range that replaces a `workspace:` dependency specifier in the copied `package.json`.
   *
   * @remarks
   * `workspace:*` and `workspace:^` become `^<range>`; `workspace:~` becomes `~<range>`; any other
   * `workspace:<something>` keeps whatever followed the colon, which is what pnpm itself does when
   * it publishes. Pass `null` to copy `package.json` byte for byte.
   *
   * @defaultValue {@link DEFAULT_DEPENDENCY_RANGE}
   */
  readonly dependencyRange?: string | null;
  /**
   * The `name` written into the copied `package.json`. Defaults to the target directory's base
   * name, lower-cased, with any run of characters outside `a-z0-9._-` replaced by `-`; `null` keeps
   * the template's own name.
   */
  readonly projectName?: string | null;
  /**
   * Whether the template's desktop variant is copied.
   *
   * @remarks
   * `false` skips {@link DESKTOP_ONLY_ENTRIES} and strips the desktop scripts and dependencies from
   * the copied `package.json`; `true` copies the template whole. This is what `--desktop` sets.
   *
   * @defaultValue `false`
   */
  readonly desktop?: boolean;
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
  readonly dependencyRange: string | null;
  readonly projectName: string | null;
  readonly desktop: boolean;
}

/**
 * Turns one `workspace:` specifier into a publishable range.
 *
 * @param specifier - The dependency value, known to start with `workspace:`.
 * @param range - The version range configured for the copy, without a leading operator.
 * @returns The range to write instead.
 */
function resolveWorkspaceSpecifier(specifier: string, range: string): string {
  const suffix = specifier.slice(WORKSPACE_PROTOCOL.length);
  if (suffix === "*" || suffix === "^" || suffix === "") {
    return range;
  }
  if (suffix === "~") {
    return range.startsWith("^") ? `~${range.slice(1)}` : `~${range}`;
  }
  return suffix;
}

/**
 * Narrows an unknown JSON value to something whose keys can be read and written.
 *
 * @param value - The value to test.
 * @returns `true` for any non-null object, arrays included.
 */
/**
 * Derives a package name from the directory a project is scaffolded into.
 *
 * @param targetDir - The target directory, absolute or relative.
 * @returns The lower-cased base name with anything npm would reject replaced by `-` and leading or
 * trailing separators dropped, or `ignifx-game` when nothing usable remains.
 */
function projectNameFor(targetDir: string): string {
  const base = basename(resolve(targetDir)).toLowerCase();
  const cleaned = base.replaceAll(/[^a-z0-9._-]+/gu, "-").replaceAll(/^[._-]+|[._-]+$/gu, "");
  return cleaned.length > 0 ? cleaned : "ignifx-game";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Rewrites every `workspace:` specifier in a parsed `package.json`, in place.
 *
 * @param document - The parsed document; anything that is not an object is left alone.
 * @param range - The range configured for the copy.
 * @returns `true` when at least one specifier changed.
 */
function rewriteWorkspaceRanges(document: unknown, range: string): boolean {
  if (!isRecord(document)) {
    return false;
  }
  let changed = false;
  for (const blockName of DEPENDENCY_BLOCKS) {
    const entries: unknown = document[blockName];
    if (!isRecord(entries)) {
      continue;
    }
    for (const name of Object.keys(entries)) {
      const specifier: unknown = entries[name];
      if (typeof specifier === "string" && specifier.startsWith(WORKSPACE_PROTOCOL)) {
        entries[name] = resolveWorkspaceSpecifier(specifier, range);
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * Removes the desktop scripts and dependencies from a parsed `package.json`, in place.
 *
 * @param document - The parsed document; anything that is not an object is left alone.
 * @returns `true` when at least one entry was removed.
 */
function stripDesktopEntries(document: unknown): boolean {
  if (!isRecord(document)) {
    return false;
  }
  let changed = false;
  const scripts: unknown = document["scripts"];
  if (isRecord(scripts)) {
    for (const name of Object.keys(scripts)) {
      if (name.endsWith(DESKTOP_SCRIPT_SUFFIX)) {
        delete scripts[name];
        changed = true;
      }
    }
  }
  for (const blockName of DEPENDENCY_BLOCKS) {
    const entries: unknown = document[blockName];
    if (!isRecord(entries)) {
      continue;
    }
    for (const name of DESKTOP_ONLY_DEPENDENCIES) {
      if (name in entries) {
        delete entries[name];
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * Copies one file, rewriting a `package.json`'s workspace dependencies on the way through.
 *
 * @param source - The file to read.
 * @param destination - The file to write.
 * @param targetName - The name the file is written under, after any rename.
 * @param context - The resolved copy settings.
 * @returns A promise that settles when the file has been written.
 */
async function copyOne(source: string, destination: string, targetName: string, context: CopyContext): Promise<void> {
  const { dependencyRange: range, projectName } = context;
  if (targetName !== "package.json" || (range === null && projectName === null && context.desktop)) {
    await copyFile(source, destination);
    return;
  }
  const text = await readFile(source, "utf8");
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    // A template with an unreadable package.json is the template author's problem, not the
    // scaffolder's: copy it verbatim so the failure surfaces where it belongs.
    await copyFile(source, destination);
    return;
  }
  let changed = range !== null && rewriteWorkspaceRanges(document, range);
  if (projectName !== null && isRecord(document) && document["name"] !== projectName) {
    document["name"] = projectName;
    changed = true;
  }
  if (!context.desktop && stripDesktopEntries(document)) {
    changed = true;
  }
  if (!changed) {
    await copyFile(source, destination);
    return;
  }
  // Two-space JSON with a trailing newline is what npm itself writes, so the generated file looks
  // like one a person would commit.
  await writeFile(destination, `${JSON.stringify(document, null, 2)}\n`, "utf8");
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
        await copyOne(source, destination, targetName, context);
        files.push(relativePath);
      }
    }),
  );
}

/**
 * Copies a template directory recursively into a target directory.
 *
 * @remarks
 * The template tree is copied verbatim apart from four things: the `rename` map, the `ignore`
 * list, `package.json` — whose `workspace:` dependency specifiers are rewritten to
 * `dependencyRange` so that the generated project installs from the registry — and the desktop
 * variant, which is skipped unless `desktop` is `true`. Symbolic links are followed and written as
 * regular files, which is what a scaffolded project wants.
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

  const desktop = options.desktop ?? false;
  const context: CopyContext = {
    renames: new Map(Object.entries(options.rename ?? DEFAULT_TEMPLATE_RENAMES)),
    ignored: new Set([...(options.ignore ?? DEFAULT_IGNORED_ENTRIES), ...(desktop ? [] : DESKTOP_ONLY_ENTRIES)]),
    signal,
    dependencyRange: options.dependencyRange === undefined ? DEFAULT_DEPENDENCY_RANGE : options.dependencyRange,
    projectName: options.projectName === undefined ? projectNameFor(targetDir) : options.projectName,
    desktop,
  };
  const files: string[] = [];
  await copyDirectory(templateDir, targetDir, "", context, files);
  files.sort();
  return { files };
}
