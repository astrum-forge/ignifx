/**
 * npm registry lookups for `pnpm release:verify`: given a package name and a version, did that
 * exact version actually arrive on the registry?
 *
 * A publish can report success and still not land — a Trusted Publisher configured against the
 * wrong workflow file answers E404 for a scoped package (npm/cli#8976), and `changeset publish`
 * publishes one package at a time, so a failure part-way leaves the release half-shipped. The
 * release workflow therefore asks the registry rather than trusting the publisher's exit code.
 *
 * Nothing here exits or logs; results come back as data so `verify-published.ts` decides
 * (`scripts/README.md`).
 */

/** How one package looked to the registry. */
export type RegistryOutcome = "published" | "missing" | "error";

/** The result of asking the registry about one package version. */
export interface RegistryCheck {
  /** The package name, for example `@ignifx/core`. */
  readonly name: string;
  /** The version that was looked for. */
  readonly version: string;
  /** Whether the version is there, absent, or could not be determined. */
  readonly outcome: RegistryOutcome;
  /** A human-readable sentence: the tarball URL, the status code, or what went wrong. */
  readonly detail: string;
}

/** The part of a `fetch` response this module reads, so a test can supply its own. */
export interface RegistryResponse {
  /** HTTP status code. */
  readonly status: number;
  /**
   * The response body.
   *
   * @returns The body as text.
   */
  text: () => Promise<string>;
}

/**
 * The part of `fetch` this module calls.
 *
 * @param url - The URL to request.
 * @returns The response.
 */
export type FetchLike = (url: string) => Promise<RegistryResponse>;

/** The public npm registry, which is where `@ignifx/*` and `ignifx` are published. */
export const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/**
 * The URL of one version document. A scoped name has to be percent-encoded whole — `@ignifx/core`
 * becomes `%40ignifx%2Fcore` — because the slash in it is part of the name, not a path separator.
 *
 * @param registry - Registry base URL, without a trailing slash.
 * @param name - The package name.
 * @param version - The exact version.
 * @returns The absolute URL of the version document.
 */
export function versionUrl(registry: string, name: string, version: string): string {
  return `${registry.replace(/\/+$/u, "")}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`;
}

/**
 * The URL of a package's dist-tags document, which is small where the full packument is not.
 *
 * @param registry - Registry base URL, without a trailing slash.
 * @param name - The package name.
 * @returns The absolute URL of the dist-tags document.
 */
export function distTagsUrl(registry: string, name: string): string {
  return `${registry.replace(/\/+$/u, "")}/-/package/${encodeURIComponent(name)}/dist-tags`;
}

/**
 * Reads the `latest` dist-tag, best effort: the tag is reported beside a published version and is
 * never the reason a verification fails, so an unreadable document answers `null` rather than
 * throwing.
 *
 * @param fetchLike - The fetch implementation to use.
 * @param registry - Registry base URL.
 * @param name - The package name.
 * @returns The `latest` tag, or `null` when it could not be read.
 */
async function readLatestTag(fetchLike: FetchLike, registry: string, name: string): Promise<string | null> {
  try {
    const response = await fetchLike(distTagsUrl(registry, name));
    if (response.status !== 200) {
      return null;
    }
    const parsed: unknown = JSON.parse(await response.text());
    if (typeof parsed !== "object" || parsed === null || !("latest" in parsed)) {
      return null;
    }
    const latest: unknown = parsed.latest;
    return typeof latest === "string" ? latest : null;
  } catch {
    return null;
  }
}

/**
 * Reads the tarball URL out of a version document, which is what proves the version is really
 * there rather than merely named.
 *
 * @param body - The version document as text.
 * @returns The tarball URL, or `null` when the document does not carry one.
 */
function tarballOf(body: string): string | null {
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || !("dist" in parsed)) {
    return null;
  }
  const dist: unknown = parsed.dist;
  if (typeof dist !== "object" || dist === null || !("tarball" in dist)) {
    return null;
  }
  const tarball: unknown = dist.tarball;
  return typeof tarball === "string" ? tarball : null;
}

/**
 * Asks the registry whether one package version exists.
 *
 * @param fetchLike - The fetch implementation to use.
 * @param registry - Registry base URL.
 * @param name - The package name.
 * @param version - The exact version that should be there.
 * @returns What the registry said.
 */
export async function checkPackage(
  fetchLike: FetchLike,
  registry: string,
  name: string,
  version: string,
): Promise<RegistryCheck> {
  let response: RegistryResponse;
  try {
    response = await fetchLike(versionUrl(registry, name, version));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name, version, outcome: "error", detail: `the registry could not be reached: ${message}` };
  }
  // 404 is the registry's answer for both "no such package" and "no such version of it", and both
  // mean the same thing here: this release did not land.
  if (response.status === 404) {
    return { name, version, outcome: "missing", detail: "the registry has no such version" };
  }
  if (response.status !== 200) {
    return { name, version, outcome: "error", detail: `the registry answered HTTP ${String(response.status)}` };
  }
  let tarball: string | null;
  try {
    tarball = tarballOf(await response.text());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name, version, outcome: "error", detail: `the version document did not parse: ${message}` };
  }
  if (tarball === null) {
    return { name, version, outcome: "error", detail: "the version document carries no dist.tarball" };
  }
  const latest = await readLatestTag(fetchLike, registry, name);
  const tag = latest === null ? "latest tag unreadable" : `latest: ${latest}`;
  return { name, version, outcome: "published", detail: `${tarball} (${tag})` };
}

/**
 * Whether a check still has to be retried. Only a definite `published` ends the wait: the registry
 * is read through a CDN and a just-published version can 404 for a few seconds.
 *
 * @param check - One result.
 * @returns True when the package has not been seen on the registry yet.
 */
export function isUnresolved(check: RegistryCheck): boolean {
  return check.outcome !== "published";
}
