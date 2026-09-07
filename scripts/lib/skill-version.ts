/**
 * Rewrites the `metadata.ignifx-version` line in a skill's frontmatter.
 *
 * The skills state which engine version they document, and `check-skill-lint.ts` holds them to
 * `@ignifx/core`'s version: while core is `0.0.0` the placeholder `"0.0.0-unreleased"` is also
 * accepted, and from the first real release nothing but the exact version is. Nothing regenerates
 * these files — they are written by hand — so the release has to carry the value across, which is
 * what `sync-skill-versions.ts` does inside the Changesets version step.
 *
 * Nothing here touches the file system; the caller reads, rewrites and writes
 * (`scripts/README.md`).
 */

/**
 * The `ignifx-version` entry, indented under `metadata:`, with or without quotes around the value.
 * Anchored to the start of a line so a mention of the key in prose is never rewritten.
 */
const VERSION_LINE = /^(?<indent>[ \t]+)ignifx-version:[ \t]*(?<quote>["']?)(?<value>[^"'\n]*)\k<quote>[ \t]*$/mu;

/**
 * Lists the values `metadata.ignifx-version` may take.
 *
 * While `@ignifx/core` is `0.0.0` nothing has been released, and `"0.0.0-unreleased"` says so more
 * honestly than a bare `0.0.0` would; both are accepted. From the first real release the skill has
 * to name the exact version it documents. `check-skill-lint.ts` enforces this and
 * `sync-skill-versions.ts` repairs it, so the rule lives here and neither owns a copy.
 *
 * @param releaseVersion - Version of `@ignifx/core`.
 * @returns The accepted values.
 */
export function acceptedVersions(releaseVersion: string): readonly string[] {
  return releaseVersion === "0.0.0" ? [releaseVersion, "0.0.0-unreleased"] : [releaseVersion];
}

/** What {@link rewriteSkillVersion} did to one file. */
export interface SkillVersionRewrite {
  /** The document, rewritten when it needed it and unchanged when it did not. */
  readonly text: string;
  /** The value that was there before, or `null` when the file declares no `ignifx-version`. */
  readonly previous: string | null;
  /** Whether the text actually changed. */
  readonly changed: boolean;
}

/**
 * Sets `metadata.ignifx-version` to a version, preserving the file's own indentation.
 *
 * @param source - The `SKILL.md` contents.
 * @param version - The version to write, for example `0.1.0`.
 * @returns The rewritten text, what was there before, and whether anything changed.
 */
export function rewriteSkillVersion(source: string, version: string): SkillVersionRewrite {
  const match = VERSION_LINE.exec(source);
  if (match?.groups === undefined) {
    return { text: source, previous: null, changed: false };
  }
  const previous = match.groups["value"] ?? "";
  // An already-accepted value is left alone: rewriting `"0.0.0-unreleased"` to a bare `0.0.0`
  // before anything is published would throw away the more honest of the two.
  if (acceptedVersions(version).includes(previous)) {
    return { text: source, previous, changed: false };
  }
  const indent = match.groups["indent"] ?? "  ";
  const replaced = source.replace(VERSION_LINE, `${indent}ignifx-version: ${JSON.stringify(version)}`);
  return { text: replaced, previous, changed: true };
}
