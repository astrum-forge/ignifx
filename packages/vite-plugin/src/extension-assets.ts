/**
 * Resolves a declared public-asset path to an absolute file path.
 *
 * @remarks
 * A path that begins with `node_modules/` names a file inside one of the extension's own
 * dependencies (`@ignifx/physics` declares Havok's `.wasm` that way). pnpm links that dependency
 * into the extension's own `node_modules`, but a hoisting package manager installs it beside the
 * extension instead, so the path is tried against the extension's directory and then each ancestor
 * in turn; the nearest existing file wins. Any other path is relative to the extension's directory.
 * When nothing matches, the path relative to the extension is returned so that the `IGX-0553`
 * message names the declared location.
 *
 * @param directory - The installed extension's directory.
 * @param relativePath - The path as declared in `ignifx.assets.public`.
 * @returns The absolute path to check and copy.
 */
async function resolveDeclaredPath(directory: string, relativePath: string): Promise<string> {
  const direct = join(directory, relativePath);
  if (!relativePath.startsWith("node_modules/")) {
    return direct;
  }
  const candidates: string[] = [];
  for (let current = directory; ; current = dirname(current)) {
    candidates.push(join(current, relativePath));
    if (dirname(current) === current) {
      break;
    }
  }
  const existing = await Promise.all(candidates.map((candidate) => isExistingFile(candidate)));
  const nearest = candidates.find((_, index) => existing[index] === true);
  return nearest ?? direct;
}

/**
 * Whether a path exists and is a regular file.
 *
 * @param filePath - The absolute path.
 * @returns `true` for a file; `false` for anything else, including a missing path.
 */
async function isExistingFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

/**
 * Discovery of the static files extension packages need served verbatim
 * (`docs/architecture/04-extensions.md` §4, `05-assets-and-loading.md` §7).
 *
 * `@ignifx/physics` ships `HavokPhysics.wasm`, `@ignifx/3d` ships the Recast binary, and a WASM
 * loader locates its companion by file name, not by a hashed URL. Those files are therefore copied
 * unhashed into the public asset path, and the assets service resolves them through `resolveUrl`.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { VitePluginError, VitePluginErrorCode } from "./errors.js";
import { isJsonArray, isJsonObject, jsonProperty, parseJsonValue } from "./json.js";
import type { JsonObject, JsonValue } from "./json.js";
import type { Dirent } from "node:fs";

/** The npm scope whose packages are always inspected for a manifest. */
const IGNIFX_SCOPE = "@ignifx/";

/**
 * The keyword a package outside the `@ignifx` scope sets to opt into extension discovery
 * (`docs/architecture/04-extensions.md` §6).
 *
 * @public
 */
export const EXTENSION_KEYWORD = "ignifx-extension";

/**
 * One file an extension asked to have served as a static asset.
 *
 * @public
 */
export interface ExtensionPublicAsset {
  /** The npm name of the package that declared the file. */
  readonly packageName: string;
  /** The absolute path of the file inside the installed package. */
  readonly filePath: string;
  /** The name the file is copied under, which is the name its loader will ask for. */
  readonly fileName: string;
}

/** One package found in a `node_modules` directory. */
interface InstalledPackage {
  /** The npm name, including the scope when there is one. */
  readonly packageName: string;
  /** The absolute directory the package is installed in. */
  readonly directory: string;
}

/**
 * Every `node_modules` directory that applies to a root, nearest first.
 *
 * @param root - The absolute directory to start from.
 * @returns The candidate directories, from `root/node_modules` upwards.
 */
function nodeModulesDirectories(root: string): readonly string[] {
  const directories: string[] = [];
  let current = root;
  for (;;) {
    directories.push(join(current, "node_modules"));
    const parent = dirname(current);
    if (parent === current) {
      return directories;
    }
    current = parent;
  }
}

/**
 * Reads a directory, treating an unreadable one as empty.
 *
 * @param directory - The absolute directory to read.
 * @returns Its entries, or `[]` when it does not exist.
 */
async function readEntries(directory: string): Promise<readonly Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Lists the installed package directories of one `node_modules`, descending into npm scopes.
 *
 * @param nodeModules - The absolute `node_modules` directory.
 * @returns Package name and absolute directory, for every package installed directly there.
 */
async function listPackages(nodeModules: string): Promise<readonly InstalledPackage[]> {
  const entries = await readEntries(nodeModules);
  const groups = await Promise.all(
    entries.map(async (entry): Promise<readonly InstalledPackage[]> => {
      if (entry.name.startsWith(".") || !entry.isDirectory()) {
        return [];
      }
      if (!entry.name.startsWith("@")) {
        return [{ packageName: entry.name, directory: join(nodeModules, entry.name) }];
      }
      const scopeDirectory = join(nodeModules, entry.name);
      const scoped = await readEntries(scopeDirectory);
      return scoped
        .filter((inner) => inner.isDirectory() && !inner.name.startsWith("."))
        .map((inner) => ({
          packageName: `${entry.name}/${inner.name}`,
          directory: join(scopeDirectory, inner.name),
        }));
    }),
  );
  return groups.flat();
}

/**
 * Narrows a JSON value to an object.
 *
 * @param value - The value to narrow.
 * @returns The object, or `null` when the value is an array, `null`, or a primitive.
 */
function asObject(value: JsonValue | undefined): JsonObject | null {
  return value !== undefined && isJsonObject(value) ? value : null;
}

/**
 * Reads the `ignifx.assets.public` list of one installed package.
 *
 * @param packageName - The npm name of the package.
 * @param packageDirectory - The absolute directory the package is installed in.
 * @returns The relative paths the package declared, or `[]` when it declares none or is not an
 * ignifx extension at all.
 */
async function readPublicAssetPaths(packageName: string, packageDirectory: string): Promise<readonly string[]> {
  let text: string;
  try {
    text = await readFile(join(packageDirectory, "package.json"), "utf8");
  } catch {
    return [];
  }

  let parsed: JsonValue;
  try {
    // An installed package.json is untrusted JSON from outside this repository; every step below
    // re-checks the shape rather than trusting it (coding standards §5.2).
    parsed = parseJsonValue(text);
  } catch {
    return [];
  }
  const manifest = asObject(parsed);
  if (manifest === null) {
    return [];
  }

  const keywords = jsonProperty(manifest, "keywords");
  const isCandidate =
    packageName.startsWith(IGNIFX_SCOPE) ||
    (keywords !== undefined && isJsonArray(keywords) && keywords.some((keyword) => keyword === EXTENSION_KEYWORD));
  if (!isCandidate) {
    return [];
  }

  const ignifx = asObject(jsonProperty(manifest, "ignifx"));
  const assets = ignifx === null ? null : asObject(jsonProperty(ignifx, "assets"));
  const publicPaths = assets === null ? undefined : jsonProperty(assets, "public");
  if (publicPaths === undefined || !isJsonArray(publicPaths)) {
    return [];
  }
  return publicPaths.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Checks that a declared public asset exists and is a file.
 *
 * @param packageName - The package that declared it, for the message.
 * @param relativePath - The path as declared, for the message.
 * @param filePath - The absolute path to check.
 * @throws A {@link VitePluginError} with code `IGX-0553` when the path is missing or not a file.
 */
async function assertIsFile(packageName: string, relativePath: string, filePath: string): Promise<void> {
  let isFile: boolean;
  try {
    isFile = (await stat(filePath)).isFile();
  } catch (error) {
    throw new VitePluginError(
      VitePluginErrorCode.extensionAssetMissing,
      `"${packageName}" lists "${relativePath}" in ignifx.assets.public, but "${filePath}" could not be read.`,
      { cause: error },
    );
  }
  if (!isFile) {
    throw new VitePluginError(
      VitePluginErrorCode.extensionAssetMissing,
      `"${packageName}" lists "${relativePath}" in ignifx.assets.public, but it is not a file.`,
    );
  }
}

/**
 * Keeps the nearest installation of each package name: listings are ordered nearest first, so the
 * first occurrence of a name wins and later duplicates are dropped.
 *
 * @param listings - One package listing per `node_modules` directory, nearest first.
 * @returns The de-duplicated packages, in discovery order.
 */
function nearestInstallations(listings: readonly (readonly InstalledPackage[])[]): InstalledPackage[] {
  const seen = new Set<string>();
  const unique: InstalledPackage[] = [];
  for (const listing of listings) {
    for (const installed of listing) {
      if (!seen.has(installed.packageName)) {
        seen.add(installed.packageName);
        unique.push(installed);
      }
    }
  }
  return unique;
}

/**
 * Collects every file declared by an installed extension's `ignifx.assets.public`.
 *
 * @remarks
 * Packages in the `@ignifx` scope are always inspected; any other package must carry the
 * {@link EXTENSION_KEYWORD} keyword. `node_modules` directories are walked from the project root
 * upwards, so a pnpm workspace finds hoisted packages, and the nearest installation of a package
 * wins.
 *
 * @param root - The absolute project root to resolve packages from.
 * @returns The files to copy, sorted by package name and then file name.
 * @throws A {@link VitePluginError} with code `IGX-0553` when a declared file does not exist, or
 * when two packages declare files with the same name, which would silently overwrite one.
 *
 * @example
 * ```ts
 * const files = await collectExtensionPublicAssets("/project");
 * // [{ packageName: "@ignifx/physics", fileName: "HavokPhysics.wasm", filePath: "…" }]
 * ```
 *
 * @public
 */
export async function collectExtensionPublicAssets(root: string): Promise<readonly ExtensionPublicAsset[]> {
  const listings = await Promise.all(nodeModulesDirectories(root).map((directory) => listPackages(directory)));
  const unique = nearestInstallations(listings);

  const declared = await Promise.all(
    unique.map(async (installed) => ({
      installed,
      paths: await readPublicAssetPaths(installed.packageName, installed.directory),
    })),
  );
  const candidates = await Promise.all(
    declared.flatMap(({ installed, paths }) =>
      paths.map(async (relativePath) => {
        const filePath = await resolveDeclaredPath(installed.directory, relativePath);
        return { packageName: installed.packageName, relativePath, filePath, fileName: basename(filePath) };
      }),
    ),
  );
  await Promise.all(
    candidates.map((candidate) => assertIsFile(candidate.packageName, candidate.relativePath, candidate.filePath)),
  );

  const ownerByFileName = new Map<string, string>();
  for (const candidate of candidates) {
    const owner = ownerByFileName.get(candidate.fileName);
    if (owner !== undefined) {
      throw new VitePluginError(
        VitePluginErrorCode.extensionAssetMissing,
        `"${owner}" and "${candidate.packageName}" both publish a file named "${candidate.fileName}"; extension ` +
          "public assets are copied unhashed and must have unique names.",
      );
    }
    ownerByFileName.set(candidate.fileName, candidate.packageName);
  }

  return candidates
    .map((candidate) => ({
      packageName: candidate.packageName,
      filePath: candidate.filePath,
      fileName: candidate.fileName,
    }))
    .toSorted((left, right) =>
      left.packageName === right.packageName
        ? left.fileName.localeCompare(right.fileName)
        : left.packageName.localeCompare(right.packageName),
    );
}
