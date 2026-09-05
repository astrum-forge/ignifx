/**
 * Address arithmetic (`docs/architecture/05-assets-and-loading.md` §2): splitting the sub-asset
 * fragment off, recognising the URL forms that bypass the asset root, joining a relative address
 * onto that root, and picking the longest registered extension an address ends with.
 *
 * Everything here is a pure function over strings so the rules can be tested without a service, an
 * app, or a network.
 */

/** The URL schemes §2 accepts verbatim: an address in one of these is never joined to the root. */
const ABSOLUTE_PREFIXES: readonly string[] = Object.freeze(["http://", "https://", "blob:", "data:"]);

/** The separator between an address and its sub-asset fragment. */
const FRAGMENT_SEPARATOR = "#";

/** The separator between the asset root and a relative address. */
const PATH_SEPARATOR = "/";

/**
 * An address split into the part that resolves to a URL and the part loaders interpret.
 *
 * @internal
 */
export interface SplitAddress {
  /** The address with the fragment removed. */
  readonly path: string;
  /** The text after the first `#`, or `null` when the address carries none. */
  readonly fragment: string | null;
}

/**
 * Splits a sub-asset fragment off an address.
 *
 * @remarks
 * Only the *first* `#` separates; everything after it is the fragment, so a grammar such as
 * `#frame:a#b` reaches the loader intact. A `data:` URL is never split: its payload may legitimately
 * contain a `#`, and it has no sub-assets to name.
 *
 * @param address - The address as game code wrote it.
 * @returns The path and the fragment.
 *
 * @example
 * ```ts
 * splitFragment("models/hero.glb#animation:Run"); // { path: "models/hero.glb", fragment: "animation:Run" }
 * ```
 *
 * @internal
 */
export function splitFragment(address: string): SplitAddress {
  if (address.startsWith("data:")) {
    return { path: address, fragment: null };
  }
  const index = address.indexOf(FRAGMENT_SEPARATOR);
  if (index < 0) {
    return { path: address, fragment: null };
  }
  return { path: address.slice(0, index), fragment: address.slice(index + 1) };
}

/**
 * Reports whether an address is already a URL the service can fetch as it stands.
 *
 * @param path - A fragment-free address.
 * @returns `true` for `http://`, `https://`, `blob:`, and `data:`.
 *
 * @internal
 */
export function isAbsoluteAddress(path: string): boolean {
  for (let index = 0; index < ABSOLUTE_PREFIXES.length; index += 1) {
    const prefix = ABSOLUTE_PREFIXES[index];
    if (prefix !== undefined && path.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * Joins a relative address onto the asset root with exactly one separator.
 *
 * @param root - The asset root; an empty root leaves the address alone.
 * @param path - A fragment-free relative address.
 * @returns The URL to fetch.
 *
 * @example
 * ```ts
 * joinRoot("assets/", "models/hero.glb"); // "assets/models/hero.glb"
 * ```
 *
 * @internal
 */
export function joinRoot(root: string, path: string): string {
  if (root.length === 0) {
    return path;
  }
  const base = root.endsWith(PATH_SEPARATOR) ? root.slice(0, -1) : root;
  const tail = path.startsWith(PATH_SEPARATOR) ? path.slice(1) : path;
  return `${base}${PATH_SEPARATOR}${tail}`;
}

/**
 * Picks the longest registered extension an address ends with, so `.scene.json` wins over `.json`.
 *
 * @param path - A fragment-free address.
 * @param extensions - Every registered extension, each with its leading dot.
 * @returns The winning extension in lower case, or `null` when none matches.
 *
 * @example
 * ```ts
 * matchExtension("levels/1.scene.json", [".json", ".scene.json"]); // ".scene.json"
 * ```
 *
 * @internal
 */
export function matchExtension(path: string, extensions: Iterable<string>): string | null {
  const lower = path.toLowerCase();
  let best: string | null = null;
  for (const extension of extensions) {
    if (lower.endsWith(extension) && (best === null || extension.length > best.length)) {
      best = extension;
    }
  }
  return best;
}

/**
 * Normalises an extension the way the registry stores it: lower case, with a leading dot.
 *
 * @param extension - The extension as an extension author wrote it.
 * @returns The normalised form.
 *
 * @internal
 */
export function normalizeExtension(extension: string): string {
  const lower = extension.toLowerCase();
  return lower.startsWith(".") ? lower : `.${lower}`;
}

/**
 * The scheme in-memory assets are registered under (`Assets.register`). An address that starts with
 * it names a value built in code — a `MeshAsset.box(...)`, a `MaterialAsset.pbr(...)` — rather than
 * a file, so nothing fetches it and nothing can write it into a scene file.
 *
 * @internal
 */
export const MEMORY_ADDRESS_PREFIX = "memory:";

/**
 * Reports whether an address names an in-memory asset rather than a file.
 *
 * @param address - The address to test.
 * @returns `true` when the address carries the `memory:` scheme.
 *
 * @example
 * ```ts
 * isMemoryAddress("memory:mesh/01J9Z6M7E5S3A0V2Q4R8T1Y6WX"); // true
 * ```
 *
 * @internal
 */
export function isMemoryAddress(address: string): boolean {
  return address.startsWith(MEMORY_ADDRESS_PREFIX);
}
