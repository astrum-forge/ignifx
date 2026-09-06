/**
 * Resolving one document's reference to another (`docs/architecture/05-assets-and-loading.md` §2).
 *
 * Every reference `@ignifx/2d` reads out of a file — an atlas's `image`, an animation document's
 * `atlas`, a tilemap tileset's `atlas` — is interpreted **relative to the document that names it**,
 * which is what every atlas packer and map editor emits. The same arithmetic serves an address and
 * a URL, because both are `/`-separated paths.
 */

/** The URL schemes that are never joined to a base. */
const ABSOLUTE_PREFIXES: readonly string[] = Object.freeze(["http://", "https://", "blob:", "data:", "//"]);

/**
 * Resolves a document-relative reference against the document's own address or URL.
 *
 * @remarks
 * A reference that is absolute — one of the recognised URL schemes, or one starting with `/` — is
 * returned untouched, so a project that prefers project-root addresses can write them. `.` and `..`
 * segments are collapsed, and a base with no `/` at all is treated as a file in the root.
 *
 * @param base - The address or URL of the document holding the reference.
 * @param reference - What the document wrote.
 * @returns The resolved address or URL.
 *
 * @example
 * ```ts
 * resolveRelative("2d/hero.atlas.json", "hero.png"); // "2d/hero.png"
 * resolveRelative("2d/hero.atlas.json", "../shared/pal.png"); // "shared/pal.png"
 * resolveRelative("2d/hero.atlas.json", "/sprites/hero.png"); // "/sprites/hero.png"
 * ```
 *
 * @public
 */
export function resolveRelative(base: string, reference: string): string {
  if (reference === "") {
    return "";
  }
  if (reference.startsWith("/")) {
    return reference;
  }
  for (let index = 0; index < ABSOLUTE_PREFIXES.length; index += 1) {
    const prefix = ABSOLUTE_PREFIXES[index];
    if (prefix !== undefined && reference.startsWith(prefix)) {
      return reference;
    }
  }
  const cut = base.lastIndexOf("/");
  const directory = cut < 0 ? "" : base.slice(0, cut);
  const joined = directory === "" ? reference : `${directory}/${reference}`;
  return normalisePath(joined);
}

/**
 * Collapses `.` and `..` segments in a `/`-separated path.
 *
 * @param path - The path to normalise.
 * @returns The normalised path; leading `..` segments that escape the root are dropped.
 *
 * @public
 */
export function normalisePath(path: string): string {
  const segments = path.split("/");
  const out: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined || segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

/**
 * Whether a reference is a URL in its own right rather than an address: root-relative (`/…`),
 * protocol-relative (`//…`), or carrying a scheme (`http(s)://`, `blob:`, `data:`).
 *
 * @param reference - The reference as written in a document.
 * @returns `true` when the reference must be fetched verbatim rather than resolved through the manifest.
 */
export function isAbsoluteReference(reference: string): boolean {
  if (reference.startsWith("/")) {
    return true;
  }
  for (let index = 0; index < ABSOLUTE_PREFIXES.length; index += 1) {
    const prefix = ABSOLUTE_PREFIXES[index];
    if (prefix !== undefined && reference.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}
