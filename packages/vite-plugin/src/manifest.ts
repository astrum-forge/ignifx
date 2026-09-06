/**
 * The asset manifest: the file that maps addresses to URLs, sizes, content hashes, types, and
 * groups (`docs/architecture/05-assets-and-loading.md` §2 and §7).
 *
 * The shapes below are the build-time half of the contract; `@ignifx/core`'s assets service reads
 * exactly this JSON. The two declarations are kept in step by a test that pins the key set, because
 * `docs/architecture/00-overview.md` §2 gives this package no dependency it could import them from.
 */

import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { assetTypeForAddress, isSidecarFileName, META_SUFFIX } from "./asset-types.js";
import { VitePluginError, VitePluginErrorCode } from "./errors.js";
import { isJsonArray, isJsonObject, parseJsonValue } from "./json.js";
import type { AssetType } from "./asset-types.js";
import type { JsonObject, JsonValue } from "./json.js";

/**
 * The `format` header every generated manifest carries
 * (`docs/architecture/06-serialization-and-scene-format.md` §6).
 *
 * @public
 */
export const ASSET_MANIFEST_FORMAT = "ignifx.manifest";

/**
 * The manifest format version. It stays `1` for the whole `0.x` line (`CONSTITUTION.md` §4.2).
 *
 * @public
 */
export const ASSET_MANIFEST_VERSION = 1;

/**
 * One asset in the manifest.
 *
 * @public
 */
export interface AssetManifestEntry {
  /** The address, a `/`-separated path relative to the asset root. */
  readonly address: string;
  /** Where the asset is fetched from: root-relative in development, content-hashed in a build. */
  readonly url: string;
  /** The asset's size in bytes, used for bytes-weighted load progress. */
  readonly bytes: number;
  /** The truncated lowercase hex sha256 of the file's contents. */
  readonly hash: string;
  /** The asset type, which decides the loader (`docs/architecture/05-assets-and-loading.md` §5). */
  readonly type: AssetType;
  /** Group labels from the `.meta.json` sidecar; `[]` when the asset declares none. */
  readonly groups: readonly string[];
  /** The rest of the sidecar, passed through untouched for the loader that understands it. */
  readonly meta?: JsonObject;
}

/**
 * The generated `assets.manifest.json`.
 *
 * @public
 */
export interface AssetManifest {
  /** Always {@link ASSET_MANIFEST_FORMAT}. */
  readonly format: typeof ASSET_MANIFEST_FORMAT;
  /** Always {@link ASSET_MANIFEST_VERSION} before 1.0. */
  readonly formatVersion: typeof ASSET_MANIFEST_VERSION;
  /** The asset root the addresses are relative to, as configured, `/`-separated. */
  readonly root: string;
  /** Every asset, sorted by address so two builds of the same tree produce the same bytes. */
  readonly entries: readonly AssetManifestEntry[];
}

/**
 * An asset found on disk, before a URL has been decided for it.
 *
 * @public
 */
export interface ScannedAsset {
  /** The address, a `/`-separated path relative to the asset root. */
  readonly address: string;
  /** The absolute path of the file on disk. */
  readonly filePath: string;
  /** The file's size in bytes. */
  readonly bytes: number;
  /** The truncated lowercase hex sha256 of the file's contents. */
  readonly hash: string;
  /** The asset type derived from the address. */
  readonly type: AssetType;
  /** Group labels from the sidecar, or `[]`. */
  readonly groups: readonly string[];
  /** The sidecar minus its `groups` key, or `null` when there is no sidecar or nothing is left. */
  readonly meta: JsonObject | null;
}

/**
 * Options for {@link scanAssetRoot}.
 *
 * @public
 */
export interface ScanAssetRootOptions {
  /** Absolute path of the directory to scan. */
  readonly assetRoot: string;
  /**
   * How many hex characters of the sha256 to keep.
   *
   * @defaultValue `8`
   */
  readonly hashLength?: number;
}

/**
 * The default number of hex characters kept from a content hash, matching the length Vite itself
 * uses for asset file names.
 *
 * @public
 */
export const DEFAULT_HASH_LENGTH = 8;

/**
 * Reads a `.meta.json` sidecar next to an asset.
 *
 * @param filePath - The absolute path of the asset, without the sidecar suffix.
 * @returns The groups the asset belongs to and the remaining sidecar fields.
 * @throws A {@link VitePluginError} with code `IGX-0551` when the sidecar is not a JSON object or
 * its `groups` field is not an array of strings.
 */
async function readSidecar(filePath: string): Promise<{ groups: readonly string[]; meta: JsonObject | null }> {
  let text: string;
  try {
    text = await readFile(`${filePath}${META_SUFFIX}`, "utf8");
  } catch {
    return { groups: [], meta: null };
  }

  let parsed: JsonValue;
  try {
    parsed = parseJsonValue(text);
  } catch (error) {
    throw new VitePluginError(VitePluginErrorCode.invalidSidecar, `"${filePath}${META_SUFFIX}" is not valid JSON.`, {
      cause: error,
    });
  }
  if (!isJsonObject(parsed)) {
    throw new VitePluginError(
      VitePluginErrorCode.invalidSidecar,
      `"${filePath}${META_SUFFIX}" must contain a JSON object, for example { "groups": ["level1"] }.`,
    );
  }

  const rest: Record<string, JsonValue> = {};
  let groups: readonly string[] = [];
  for (const key of Object.keys(parsed)) {
    const value = parsed[key];
    if (value === undefined) {
      continue;
    }
    if (key === "groups") {
      if (!isJsonArray(value) || value.some((item) => typeof item !== "string")) {
        throw new VitePluginError(
          VitePluginErrorCode.invalidSidecar,
          `"${filePath}${META_SUFFIX}" declares "groups" as ${JSON.stringify(value)}; it must be an array of strings.`,
        );
      }
      groups = value.filter((item): item is string => typeof item === "string");
      continue;
    }
    rest[key] = value;
  }

  return { groups, meta: Object.keys(rest).length === 0 ? null : rest };
}

/**
 * Collects every file below a directory, skipping dot-prefixed entries and sidecars.
 *
 * @param directory - The absolute directory to read.
 * @param prefix - The `/`-separated address prefix of `directory`, `""` at the root.
 * @param addresses - Accumulator that receives one address per file found.
 */
async function collectAddresses(directory: string, prefix: string, addresses: string[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  // Sibling directories are independent, so they are read concurrently; the caller sorts once at
  // the end, which is what makes the result deterministic rather than the traversal order.
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.name.startsWith(".")) {
        return;
      }
      const address = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await collectAddresses(join(directory, entry.name), address, addresses);
      } else if (!isSidecarFileName(entry.name)) {
        addresses.push(address);
      }
    }),
  );
}

/**
 * Scans an asset root and describes every file it holds.
 *
 * @remarks
 * Dot-prefixed files and directories are skipped, and so are `*.meta.json` sidecars — they are read
 * for the asset they belong to instead of listed as assets of their own.
 *
 * @param options - The directory to scan and the hash length; see {@link ScanAssetRootOptions}.
 * @returns Every asset found, sorted by address.
 * @throws A {@link VitePluginError} with code `IGX-0550` when the asset root does not exist or is
 * not a directory, or `IGX-0551` when a sidecar is malformed.
 *
 * @example
 * ```ts
 * const assets = await scanAssetRoot({ assetRoot: "/project/assets" });
 * // [{ address: "sprites/hero.png", type: "texture", hash: "0a1b2c3d", … }]
 * ```
 *
 * @public
 */
export async function scanAssetRoot(options: ScanAssetRootOptions): Promise<readonly ScannedAsset[]> {
  const { assetRoot } = options;
  const hashLength = options.hashLength ?? DEFAULT_HASH_LENGTH;

  try {
    const stats = await stat(assetRoot);
    if (!stats.isDirectory()) {
      throw new VitePluginError(
        VitePluginErrorCode.assetRootMissing,
        `The ignifx asset root "${assetRoot}" is not a directory.`,
      );
    }
  } catch (error) {
    if (error instanceof VitePluginError) {
      throw error;
    }
    throw new VitePluginError(
      VitePluginErrorCode.assetRootMissing,
      `The ignifx asset root "${assetRoot}" could not be read. Create it, or set the plugin's "assetRoot" option.`,
      { cause: error },
    );
  }

  const addresses: string[] = [];
  await collectAddresses(assetRoot, "", addresses);
  addresses.sort();

  return Promise.all(
    addresses.map(async (address): Promise<ScannedAsset> => {
      const filePath = join(assetRoot, ...address.split("/"));
      const [contents, sidecar] = await Promise.all([readFile(filePath), readSidecar(filePath)]);
      return {
        address,
        filePath,
        bytes: contents.byteLength,
        hash: createHash("sha256").update(contents).digest("hex").slice(0, hashLength),
        type: assetTypeForAddress(address),
        groups: sidecar.groups,
        meta: sidecar.meta,
      };
    }),
  );
}

/**
 * Turns scanned assets into a manifest.
 *
 * @param assets - The assets to list, already sorted by address.
 * @param root - The asset root as configured, recorded in the manifest for diagnostics.
 * @param urlFor - Maps an asset to the URL the runtime fetches it from.
 * @returns The manifest, ready to be serialized.
 *
 * @example
 * ```ts
 * const manifest = buildManifest(assets, "assets", (asset) => `/assets/${asset.address}`);
 * ```
 *
 * @public
 */
export function buildManifest(
  assets: readonly ScannedAsset[],
  root: string,
  urlFor: (asset: ScannedAsset) => string,
): AssetManifest {
  const entries: AssetManifestEntry[] = [];
  for (const asset of assets) {
    const entry: AssetManifestEntry = {
      address: asset.address,
      url: urlFor(asset),
      bytes: asset.bytes,
      hash: asset.hash,
      type: asset.type,
      groups: asset.groups,
      ...(asset.meta === null ? {} : { meta: asset.meta }),
    };
    entries.push(entry);
  }
  return {
    format: ASSET_MANIFEST_FORMAT,
    formatVersion: ASSET_MANIFEST_VERSION,
    root,
    entries,
  };
}

/**
 * Serializes a manifest the way the plugin writes it: two-space indentation and a trailing newline,
 * so that a committed or inspected manifest reads as an ordinary JSON file.
 *
 * @param manifest - The manifest to serialize.
 * @returns The manifest as JSON text.
 *
 * @public
 */
export function serializeManifest(manifest: AssetManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Converts an OS path relative to the asset root into an address.
 *
 * @param relativePath - The path relative to the asset root, in platform separators.
 * @returns The `/`-separated address.
 *
 * @public
 */
export function addressFromRelativePath(relativePath: string): string {
  return sep === "/" ? relativePath : relativePath.split(sep).join("/");
}
