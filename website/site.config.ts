/**
 * The one place the site knows about release state and about GitHub and npm URLs
 * (`website/plan/08-execution.md` §4.6). Every release-gated variant in
 * `website/plan/03-pages-and-copy.md` §8 branches on {@link site}`.published`, and nothing else in
 * `website/` hard-codes a repository URL.
 *
 * Read at build time by Node (the Vite plugin and the tests). It touches the file system, so it is
 * never bundled into the client.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/** Absolute path to the repository root, from this file's location. */
const repositoryRoot = path.resolve(import.meta.dirname, "..");

/**
 * Reads the version every `@ignifx/*` package carries.
 *
 * The site states no version it cannot read out of the tree: `packages/core/package.json` is the
 * authority, and Changesets moves every package together (fixed versioning).
 *
 * @returns The `version` field of `packages/core/package.json`.
 * @throws When the manifest is missing or has no string `version`.
 */
function readCoreVersion(): string {
  const manifestFile = path.join(repositoryRoot, "packages", "core", "package.json");
  const parsed: unknown = JSON.parse(readFileSync(manifestFile, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("version" in parsed) || typeof parsed.version !== "string") {
    throw new Error(`website: ${manifestFile} has no string "version" field.`);
  }
  return parsed.version;
}

/** The canonical repository URL. */
const repo = "https://github.com/astrum-forge/ignifx";

/** The shape of {@link site}. Annotated rather than inferred so `published` is a switch, not `false`. */
export interface SiteConfig {
  /** Whether `ignifx` and `@ignifx/*` are on npm. */
  readonly published: boolean;
  /** The workspace version. */
  readonly version: string;
  /** The repository. */
  readonly repo: string;
  /** The umbrella package on npm. */
  readonly npm: string;
  /** Prefix for a link to one file in the repository. */
  readonly blob: string;
  /** Prefix for a link to one directory in the repository. */
  readonly tree: string;
  /** The production origin. */
  readonly origin: string;
  /** Where press and partnership enquiries go. */
  readonly contactEmail: string;
  /** The studio's own site. */
  readonly studio: string;
}

/**
 * Site-wide configuration.
 *
 * `published` is the release gate: it stayed `false` until `npm view ignifx version` returned a real
 * release — `0.2.0`, on 2026-09-08 — and flipping this one line switched every install surface, the
 * header npm button, the footer link and the version chip at once (`06-engineering.md` §8). The
 * scaffolder ships as `@ignifx/cli` (bin `create-ignifx`); no `create-ignifx` package exists on npm,
 * so the install surfaces say `npx @ignifx/cli@latest`, which is the command that resolves.
 */
export const site: SiteConfig = {
  /** Whether `ignifx` and `@ignifx/*` are on npm. Flipped on 2026-09-08, when `0.2.0` shipped. */
  published: true,
  /** The workspace version, read from `packages/core/package.json`. */
  version: readCoreVersion(),
  /** The repository. */
  repo,
  /** The umbrella package on npm. Only linked when {@link site.published} is `true`. */
  npm: "https://www.npmjs.com/package/ignifx",
  /** Prefix for a link to one file in the repository. */
  blob: `${repo}/blob/main`,
  /** Prefix for a link to one directory in the repository. */
  tree: `${repo}/tree/main`,
  /** The production origin, used for canonical links, the sitemap and Open Graph. */
  origin: "https://ignifx.com",
  /** Where press and partnership enquiries go. */
  contactEmail: "info@astrumforge.com",
  /** The studio's own site. */
  studio: "https://astrumforge.com",
};

/**
 * The version chip's text: the real version once the packages are published, and an honest
 * placeholder before that (`03-pages-and-copy.md` §8).
 *
 * @returns The chip label.
 */
export function versionLabel(): string {
  return site.published ? site.version : "0.x · unreleased";
}

/**
 * Builds a link to one file in the repository.
 *
 * @param repoPath - Repository-relative path, without a leading slash.
 * @returns The absolute `blob/main` URL.
 */
export function blobUrl(repoPath: string): string {
  return `${site.blob}/${repoPath}`;
}

/**
 * Builds a link to one directory in the repository.
 *
 * @param repoPath - Repository-relative path, without a leading slash.
 * @returns The absolute `tree/main` URL.
 */
export function treeUrl(repoPath: string): string {
  return `${site.tree}/${repoPath}`;
}
