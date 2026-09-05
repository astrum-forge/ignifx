/**
 * The URLs a browser test fetches the shared sample assets from. Vitest's browser project serves the
 * repository root over its dev server, so a repository-relative path is the URL path.
 *
 * Kept apart from `assets.ts` because that one reads the same files with `node:fs`, which Vite
 * externalizes in the browser.
 */

/**
 * The URL a browser test fetches a fixture asset from.
 *
 * @param name - The file name inside `tests/fixtures/assets/`.
 * @returns An absolute URL path.
 */
export function assetUrl(name: string): string {
  return `/tests/fixtures/assets/${name}`;
}
