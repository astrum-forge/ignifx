import { CoreErrorCode } from "../errors/error-codes.js";
import { IgnifxError } from "../errors/ignifx-error.js";
import type { AssetManifest, AssetManifestEntry } from "./types.js";

/**
 * The manifest (`docs/architecture/05-assets-and-loading.md` §7): the address-to-URL table
 * `@ignifx/vite-plugin` generates, plus the index the service reads it through.
 *
 * The default is an empty manifest rooted at `assets`, which is what makes a project with no build
 * step work: every address resolves to `assets/<address>` and nothing knows its byte size, so
 * progress falls back to whatever the loader reports.
 */

/**
 * The manifest format discriminator, written into `assets.manifest.json`.
 *
 * @public
 */
export const ASSET_MANIFEST_FORMAT = "ignifx.manifest";

/**
 * The only manifest format version this build reads.
 *
 * @public
 */
export const ASSET_MANIFEST_VERSION = 1;

/**
 * The asset root a project gets when it configures none (§2).
 *
 * @public
 */
export const DEFAULT_ASSET_ROOT = "assets";

/** No entries, rooted at `assets`. */
const EMPTY_ENTRIES: readonly AssetManifestEntry[] = Object.freeze([]);

/** Shared empty result so an unknown group allocates nothing. */
const EMPTY_GROUP: readonly string[] = Object.freeze([]);

/**
 * The manifest an app uses until a build supplies one.
 *
 * @public
 */
export const EMPTY_ASSET_MANIFEST: AssetManifest = Object.freeze({
  format: ASSET_MANIFEST_FORMAT,
  formatVersion: ASSET_MANIFEST_VERSION,
  root: DEFAULT_ASSET_ROOT,
  entries: EMPTY_ENTRIES,
});

/**
 * Builds a manifest from a list of entries — what a test, a tool, or a hand-written config uses in
 * place of the generated file.
 *
 * @param entries - The addressed files.
 * @param root - The asset root relative addresses resolve against. Defaults to `"assets"`.
 * @returns The manifest.
 *
 * @example
 * ```ts
 * const manifest = createAssetManifest([{ address: "data/x.json", url: "assets/data/x.abc123.json" }]);
 * const app = await createApp({ headless: true, assets: { manifest } });
 * ```
 *
 * @public
 */
export function createAssetManifest(
  entries: readonly AssetManifestEntry[],
  root: string = DEFAULT_ASSET_ROOT,
): AssetManifest {
  return Object.freeze({
    format: ASSET_MANIFEST_FORMAT,
    formatVersion: ASSET_MANIFEST_VERSION,
    root,
    entries: Object.freeze(entries.slice()),
  });
}

/**
 * Checks a manifest's discriminator and version.
 *
 * @param manifest - The manifest a project or a build supplied.
 * @returns The same manifest, so the check reads inline.
 * @throws IgnifxError with code `IGX-0603` when the format version is not
 * {@link ASSET_MANIFEST_VERSION}.
 *
 * @internal
 */
export function assertSupportedManifest(manifest: AssetManifest): AssetManifest {
  // The declared type pins `formatVersion` to the one version this build reads, but a manifest is
  // JSON that arrived from a build tool: the value has to be re-checked at the boundary, so it is
  // widened to `number` before the comparison (coding standards §5.2).
  const version: number = manifest.formatVersion;
  if (version !== ASSET_MANIFEST_VERSION) {
    throw new IgnifxError(
      CoreErrorCode.unsupportedFormatVersion,
      `The asset manifest declares format version ${String(version)}, which this build cannot read.`,
      {
        context: { file: "assets.manifest.json", version: String(version) },
        hint: `This build reads version ${String(ASSET_MANIFEST_VERSION)}; regenerate the manifest with a matching @ignifx/vite-plugin.`,
      },
    );
  }
  return manifest;
}

/**
 * The manifest indexed for lookup: address to entry, and group label to addresses.
 *
 * @internal
 */
export class ManifestIndex {
  /** The manifest this index was built from. */
  readonly manifest: AssetManifest;

  readonly #byAddress = new Map<string, AssetManifestEntry>();

  readonly #byGroup = new Map<string, string[]>();

  /**
   * Indexes a manifest.
   *
   * @param manifest - The table to index. A later entry for the same address replaces an earlier
   * one, which is what makes a hand-written override list work.
   */
  constructor(manifest: AssetManifest) {
    this.manifest = manifest;
    const entries = manifest.entries;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry === undefined) {
        continue;
      }
      this.#byAddress.set(entry.address, entry);
      const groups = entry.groups;
      if (groups === undefined) {
        continue;
      }
      for (let at = 0; at < groups.length; at += 1) {
        const group = groups[at];
        if (group === undefined) {
          continue;
        }
        const members = this.#byGroup.get(group);
        if (members === undefined) {
          this.#byGroup.set(group, [entry.address]);
        } else {
          members.push(entry.address);
        }
      }
    }
  }

  /**
   * Looks an address up.
   *
   * @param address - A fragment-free address.
   * @returns The entry, or `null` when the manifest does not list it.
   */
  entry(address: string): AssetManifestEntry | null {
    return this.#byAddress.get(address) ?? null;
  }

  /**
   * Lists the addresses carrying a group label.
   *
   * @param group - The label, such as `"boot"`.
   * @returns The addresses in manifest order; empty when no entry carries the label.
   */
  group(group: string): readonly string[] {
    return this.#byGroup.get(group) ?? EMPTY_GROUP;
  }
}
