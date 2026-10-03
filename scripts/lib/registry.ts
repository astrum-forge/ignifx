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

/**
 * How one package looked to the registry. `unusable` is a version that is there but cannot be
 * installed: its manifest still names a dependency through pnpm's `workspace:` or `catalog:`
 * protocol, which only `pnpm publish` rewrites (0.3.0 of three packages went out through a plain
 * `npm publish` that way on 2026-10-03, and `npm install ignifx` failed with `Unsupported URL Type`).
 */
export type RegistryOutcome = "published" | "missing" | "unusable" | "error";

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

/** The dependency fields of a manifest whose specifiers a consumer's package manager resolves. */
const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

/** Specifier protocols that only mean something inside the pnpm workspace that published them. */
const WORKSPACE_PROTOCOL = /^(?:workspace|catalog):/u;

/**
 * Reads the tarball URL out of a version document, which is what proves the version is really
 * there rather than merely named.
 *
 * @param document - The parsed version document.
 * @returns The tarball URL, or `null` when the document does not carry one.
 */
function tarballOf(document: object): string | null {
  if (!("dist" in document)) {
    return null;
  }
  const dist: unknown = document.dist;
  if (typeof dist !== "object" || dist === null || !("tarball" in dist)) {
    return null;
  }
  const tarball: unknown = dist.tarball;
  return typeof tarball === "string" ? tarball : null;
}

/**
 * Lists the dependencies a published manifest still names through a workspace-only protocol.
 *
 * @param document - The parsed version document.
 * @returns `name@specifier` for each one, empty when the manifest installs anywhere.
 */
export function unresolvedDependencies(document: object): readonly string[] {
  const found: string[] = [];
  for (const field of DEPENDENCY_FIELDS) {
    const map: unknown = field in document ? Reflect.get(document, field) : undefined;
    if (typeof map !== "object" || map === null) {
      continue;
    }
    for (const [name, specifier] of Object.entries(map)) {
      if (typeof specifier === "string" && WORKSPACE_PROTOCOL.test(specifier)) {
        found.push(`${name}@${specifier}`);
      }
    }
  }
  return found;
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
  let document: unknown;
  try {
    document = JSON.parse(await response.text());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { name, version, outcome: "error", detail: `the version document did not parse: ${message}` };
  }
  const tarball = typeof document === "object" && document !== null ? tarballOf(document) : null;
  if (tarball === null || typeof document !== "object" || document === null) {
    return { name, version, outcome: "error", detail: "the version document carries no dist.tarball" };
  }
  const unresolved = unresolvedDependencies(document);
  if (unresolved.length > 0) {
    return {
      name,
      version,
      outcome: "unusable",
      detail: `published with unresolved dependencies (${unresolved.join(", ")}) — it was not published with pnpm`,
    };
  }
  const latest = await readLatestTag(fetchLike, registry, name);
  const tag = latest === null ? "latest tag unreadable" : `latest: ${latest}`;
  return { name, version, outcome: "published", detail: `${tarball} (${tag})` };
}

/**
 * Whether a check still has to be retried. `published` and `unusable` end the wait — the version
 * is there either way, and waiting will not change its manifest. Anything else is retried: the
 * registry is read through a CDN and a just-published version can 404 for a few seconds.
 *
 * @param check - One result.
 * @returns True when the package has not been seen on the registry yet.
 */
export function isUnresolved(check: RegistryCheck): boolean {
  return check.outcome !== "published" && check.outcome !== "unusable";
}
