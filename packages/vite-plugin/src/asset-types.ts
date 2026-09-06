/**
 * The address → asset type mapping and the file-name arithmetic the manifest builder needs.
 *
 * The table is the build-time half of the loader table in
 * `docs/architecture/05-assets-and-loading.md` §5: the plugin records a `type` per entry so that
 * the assets service can pick a loader without re-deriving it from the extension at runtime.
 */

/**
 * Asset types keyed by the two-segment JSON extension that identifies them. These are checked
 * before {@link ASSET_TYPE_BY_EXTENSION} because every one of them also ends in `.json`
 * (`docs/architecture/06-serialization-and-scene-format.md` §6).
 *
 * @public
 */
export const ASSET_TYPE_BY_SUFFIX = {
  ".scene.json": "scene",
  ".prefab.json": "scene",
  ".material.json": "material",
  // Extension documents. The manifest is written once, by this plugin, for every extension that
  // will later read it (the same rule `ASSET_TYPE_BY_EXTENSION` applies to `audio`), so a document
  // suffix is typed here even though the loader lives in the extension package.
  ".input.json": "inputactions",
  ".audio.json": "audiobuses",
  ".physicsmaterial.json": "physicsmaterial",
  ".i18n.json": "i18n",
  ".animator.json": "animator",
  ".atlas.json": "spriteatlas",
  ".spriteanim.json": "spriteanimation",
  ".tilemap.json": "tilemap",
} as const;

/**
 * Asset types keyed by file extension, from the core loader table of
 * `docs/architecture/05-assets-and-loading.md` §5. `audio` is listed here even though
 * `@ignifx/audio` registers the loader: the manifest is written once, by this plugin, for every
 * extension that will later read it.
 *
 * @public
 */
export const ASSET_TYPE_BY_EXTENSION = {
  ".png": "texture",
  ".jpg": "texture",
  ".jpeg": "texture",
  ".webp": "texture",
  ".ktx2": "texture",
  ".basis": "texture",
  ".glb": "model",
  ".gltf": "model",
  ".env": "environment",
  ".hdr": "environment",
  ".dds": "environment",
  ".ttf": "font",
  ".otf": "font",
  ".mp3": "audio",
  ".ogg": "audio",
  ".wav": "audio",
  ".json": "json",
  ".txt": "text",
  ".md": "text",
  ".csv": "text",
  ".bin": "binary",
  ".wasm": "binary",
} as const;

/**
 * The asset type recorded in a manifest entry. Derived from the two tables so that adding a row
 * widens the union automatically (coding standards §5.2 prefers `as const` tables over enums).
 *
 * @public
 */
export type AssetType =
  | (typeof ASSET_TYPE_BY_SUFFIX)[keyof typeof ASSET_TYPE_BY_SUFFIX]
  | (typeof ASSET_TYPE_BY_EXTENSION)[keyof typeof ASSET_TYPE_BY_EXTENSION];

/**
 * The type given to a file whose extension is in neither table. Bytes are always loadable, so an
 * unknown extension is a `binary` asset rather than a build failure.
 *
 * @public
 */
export const DEFAULT_ASSET_TYPE = "binary";

/** The sidecar suffix that carries per-asset import options and group membership. */
export const META_SUFFIX = ".meta.json";

/**
 * Splits an asset file name into the part a content hash is inserted after and the extension that
 * must survive it.
 *
 * @remarks
 * Every compound ignifx format is a two-segment JSON extension (`.scene.json`, `.atlas.json`,
 * `.input.json`, …), and the runtime picks its loader from that whole suffix, so the hash has to go
 * in front of it: `level1.scene.json` becomes `level1.<hash>.scene.json`, not
 * `level1.scene.<hash>.json`. Every other name keeps the ordinary single extension.
 *
 * @param fileName - The base name of the file, without a directory.
 * @returns The stem and the extension, whose concatenation is `fileName`.
 *
 * @example
 * ```ts
 * splitAssetFileName("level1.scene.json"); // { stem: "level1", extension: ".scene.json" }
 * splitAssetFileName("hero.glb"); // { stem: "hero", extension: ".glb" }
 * ```
 *
 * @public
 */
export function splitAssetFileName(fileName: string): { readonly stem: string; readonly extension: string } {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot <= 0) {
    return { stem: fileName, extension: "" };
  }
  if (fileName.slice(lastDot) === ".json") {
    const previousDot = fileName.lastIndexOf(".", lastDot - 1);
    if (previousDot > 0) {
      return { stem: fileName.slice(0, previousDot), extension: fileName.slice(previousDot) };
    }
  }
  return { stem: fileName.slice(0, lastDot), extension: fileName.slice(lastDot) };
}

/**
 * Reads a lower-cased extension table without tripping `noPropertyAccessFromIndexSignature`.
 *
 * @param table - One of the two extension tables.
 * @param key - The key to look up, already lower-cased.
 * @returns The asset type, or `null` when the table has no such row.
 */
function lookup(table: Readonly<Record<string, AssetType>>, key: string): AssetType | null {
  return Object.hasOwn(table, key) ? (table[key] ?? null) : null;
}

/**
 * Classifies an asset address by its extension.
 *
 * @param address - The asset address, a `/`-separated path relative to the asset root.
 * @returns The asset type, or {@link DEFAULT_ASSET_TYPE} when the extension is unknown.
 *
 * @example
 * ```ts
 * assetTypeForAddress("levels/level1.scene.json"); // "scene"
 * assetTypeForAddress("sprites/hero.png"); // "texture"
 * assetTypeForAddress("data/loot.json"); // "json"
 * ```
 *
 * @public
 */
export function assetTypeForAddress(address: string): AssetType {
  const lowerCased = address.toLowerCase();
  const suffixType = lookup(ASSET_TYPE_BY_SUFFIX, splitAssetFileName(lowerCased).extension);
  if (suffixType !== null) {
    return suffixType;
  }
  const lastDot = lowerCased.lastIndexOf(".");
  if (lastDot <= 0) {
    return DEFAULT_ASSET_TYPE;
  }
  return lookup(ASSET_TYPE_BY_EXTENSION, lowerCased.slice(lastDot)) ?? DEFAULT_ASSET_TYPE;
}

/**
 * Builds the content-hashed output name for an address.
 *
 * @param address - The asset address, a `/`-separated path relative to the asset root.
 * @param hash - The truncated content hash to insert.
 * @returns The address with the hash inserted before the extension.
 *
 * @example
 * ```ts
 * hashedAddress("levels/level1.scene.json", "0a1b2c3d"); // "levels/level1.0a1b2c3d.scene.json"
 * ```
 *
 * @public
 */
export function hashedAddress(address: string, hash: string): string {
  const lastSlash = address.lastIndexOf("/");
  const directory = lastSlash === -1 ? "" : address.slice(0, lastSlash + 1);
  const { stem, extension } = splitAssetFileName(address.slice(lastSlash + 1));
  return `${directory}${stem}.${hash}${extension}`;
}

/**
 * Reports whether a file name is an asset sidecar rather than an asset.
 *
 * @param fileName - The base name of the file.
 * @returns `true` for `*.meta.json`, which the scanner reads but never lists as an entry.
 *
 * @public
 */
export function isSidecarFileName(fileName: string): boolean {
  return fileName.length > META_SUFFIX.length && fileName.endsWith(META_SUFFIX);
}
