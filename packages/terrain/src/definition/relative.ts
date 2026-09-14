/**
 * Resolving a document's reference to another asset (`docs/architecture/05-assets-and-loading.md`
 * §2): every address a `.terrain.json` names is read relative to the document, which is what
 * exporters write.
 */

/** The URL schemes that are never joined to a base. */
const ABSOLUTE_PREFIXES: readonly string[] = Object.freeze(["http://", "https://", "blob:", "data:", "//", "memory:"]);

/**
 * Resolves a document-relative reference against the document's own address.
 *
 * @remarks
 * A reference that is absolute — a recognised URL scheme, or one starting with `/` — is returned
 * untouched. `.` and `..` segments are collapsed, and a base with no `/` is a file in the root.
 *
 * @param base - The address of the document holding the reference.
 * @param reference - What the document wrote.
 * @returns The resolved address.
 *
 * @example
 * ```ts
 * resolveTerrainAddress("levels/island.terrain.json", "island.r16"); // "levels/island.r16"
 * resolveTerrainAddress("levels/island.terrain.json", "../shared/grass.png"); // "shared/grass.png"
 * ```
 *
 * @public
 */
export function resolveTerrainAddress(base: string, reference: string): string {
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
  return normalisePath(directory === "" ? reference : `${directory}/${reference}`);
}

/**
 * Collapses `.` and `..` segments in a `/`-separated path.
 *
 * @param path - The path to normalise.
 * @returns The normalised path; leading `..` segments that escape the root are dropped.
 */
function normalisePath(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") {
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
